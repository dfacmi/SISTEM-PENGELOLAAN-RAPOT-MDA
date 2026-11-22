import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PortfolioProject } from '../types/mda';
import { compressCanvasToJpegUnderLimit } from './imageHelper';

// Configure pdfjs worker locally via Vite asset URL (100% client-side, never sent to server)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ExtractedPdfPageCandidate {
  pageNumber: number;
  score: number;
  recommended: boolean;
  selected: boolean;
  title: string;
  subject: string;
  thumbnailDataUrl: string;
  byteLength: number;
  width: number;
  height: number;
  stats: {
    colorRichness: number;
    edgeDensity: number;
    whiteRatio: number;
    colorBucketCount: number;
  };
}

export interface PdfExtractionSummary {
  totalPagesInPdf: number;
  processedPages: number;
  pages: ExtractedPdfPageCandidate[];
}

function evaluateCanvasVisualScore(canvas: HTMLCanvasElement): {
  score: number;
  colorRichness: number;
  edgeDensity: number;
  whiteRatio: number;
  colorBucketCount: number;
} {
  // Sample on a fast downscaled grid for quick scoring even on mobile devices
  const sampleW = 160;
  const sampleH = Math.max(
    90,
    Math.min(220, Math.round((canvas.height / Math.max(1, canvas.width)) * sampleW))
  );
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = sampleW;
  sampleCanvas.height = sampleH;
  const sCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!sCtx) {
    return {
      score: 10,
      colorRichness: 0,
      edgeDensity: 0,
      whiteRatio: 1,
      colorBucketCount: 1,
    };
  }

  sCtx.fillStyle = '#FFFFFF';
  sCtx.fillRect(0, 0, sampleW, sampleH);
  sCtx.drawImage(canvas, 0, 0, sampleW, sampleH);
  const { data } = sCtx.getImageData(0, 0, sampleW, sampleH);

  let nonWhiteCount = 0;
  let saturationSum = 0;
  let edgeSum = 0;
  let totalPixels = 0;
  const buckets = new Set<number>();

  for (let y = 0; y < sampleH; y++) {
    for (let x = 0; x < sampleW; x++) {
      const idx = (y * sampleW + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      totalPixels += 1;
      const isWhite = r > 243 && g > 243 && b > 243;
      if (!isWhite) nonWhiteCount += 1;

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      saturationSum += sat;

      // 4-bit quantized RGB color bucket
      const qr = r >> 5;
      const qg = g >> 5;
      const qb = b >> 5;
      buckets.add((qr << 6) | (qg << 3) | qb);

      if (x > 0 && y > 0) {
        const leftIdx = (y * sampleW + (x - 1)) * 4;
        const topIdx = ((y - 1) * sampleW + x) * 4;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const lumL =
          0.299 * data[leftIdx] + 0.587 * data[leftIdx + 1] + 0.114 * data[leftIdx + 2];
        const lumT =
          0.299 * data[topIdx] + 0.587 * data[topIdx + 1] + 0.114 * data[topIdx + 2];
        const diff = Math.abs(lum - lumL) + Math.abs(lum - lumT);
        if (diff > 28) edgeSum += 1;
      }
    }
  }

  sampleCanvas.width = 0;
  sampleCanvas.height = 0;

  const whiteRatio = totalPixels > 0 ? 1 - nonWhiteCount / totalPixels : 1;
  const nonWhiteRatio = 1 - whiteRatio;
  const colorRichness = totalPixels > 0 ? saturationSum / totalPixels : 0;
  const edgeDensity = totalPixels > 0 ? edgeSum / totalPixels : 0;
  const bucketScore = Math.min(1, buckets.size / 64);

  // Reward rich graphic/UI layouts; penalize near-blank or sparse text-only white cover/TOC pages
  let rawScore =
    nonWhiteRatio * 34 +
    Math.min(1, colorRichness * 3.4) * 28 +
    bucketScore * 22 +
    Math.min(1, edgeDensity * 2.5) * 16;

  if (whiteRatio > 0.9 && colorRichness < 0.045) {
    rawScore *= 0.35;
  } else if (whiteRatio > 0.85 && buckets.size < 18) {
    rawScore *= 0.55;
  }

  return {
    score: Math.round(Math.max(1, Math.min(99, rawScore))),
    colorRichness: Number(colorRichness.toFixed(3)),
    edgeDensity: Number(edgeDensity.toFixed(3)),
    whiteRatio: Number(whiteRatio.toFixed(3)),
    colorBucketCount: buckets.size,
  };
}

export async function extractAndScorePdfPages(
  file: File,
  options: {
    defaultSubject: string;
    maxPages?: number;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<PdfExtractionSummary> {
  const maxPages = options.maxPages ?? 20;
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdfDoc = await loadingTask.promise;

  try {
    const totalPagesInPdf = pdfDoc.numPages;
    const processedPages = Math.min(totalPagesInPdf, maxPages);
    const candidates: ExtractedPdfPageCandidate[] = [];

    for (let pageNum = 1; pageNum <= processedPages; pageNum++) {
      options.onProgress?.(pageNum, processedPages);
      const page = await pdfDoc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const longestEdge = Math.max(baseViewport.width, baseViewport.height, 1);
      // Cap render size at 960px on longest edge so mobile devices never OOM
      const renderScale = Math.min(1.6, 960 / longestEdge);
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        page.cleanup();
        continue;
      }

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvas,
        canvasContext: ctx,
        viewport,
      }).promise;

      const stats = evaluateCanvasVisualScore(canvas);
      const compressed = compressCanvasToJpegUnderLimit(canvas, {
        maxWidth: 480,
        quality: 0.65,
        maxBytes: 20 * 1024,
        maxChars: 28000,
      });

      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();

      const cleanSubject = (options.defaultSubject || 'Desain & Skill Digital').trim();
      candidates.push({
        pageNumber: pageNum,
        score: stats.score,
        recommended: false,
        selected: false,
        title: `Karya ${cleanSubject} – Hal. ${pageNum}`,
        subject: cleanSubject,
        thumbnailDataUrl: compressed.dataUrl,
        byteLength: compressed.byteLength,
        width: compressed.width,
        height: compressed.height,
        stats,
      });
    }

    // Auto-select 2–4 visually strongest pages (skipping weak cover/TOC pages when better slides exist)
    const targetAutoCount = Math.min(
      candidates.length,
      candidates.length >= 6 ? 4 : candidates.length >= 3 ? 3 : 2
    );

    const nonCoverPool = candidates.filter(
      (c) => !(c.pageNumber === 1 && c.stats.whiteRatio > 0.78 && c.stats.colorRichness < 0.08)
    );
    const rankPool =
      nonCoverPool.length >= targetAutoCount ? [...nonCoverPool] : [...candidates];

    rankPool.sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber);
    const chosenPageNums = new Set(
      rankPool.slice(0, targetAutoCount).map((p) => p.pageNumber)
    );

    const finalized = candidates.map((c) => {
      const picked = chosenPageNums.has(c.pageNumber);
      return {
        ...c,
        recommended: picked,
        selected: picked,
      };
    });

    return {
      totalPagesInPdf,
      processedPages,
      pages: finalized,
    };
  } finally {
    await pdfDoc.cleanup();
    await loadingTask.destroy();
  }
}

export function buildPortfolioProjectsFromExtractedPages(params: {
  studentId: string;
  tahunAkademik: string;
  semester: 'Gasal' | 'Genap';
  subject: string;
  pdfExternalLink?: string;
  selectedPages: ExtractedPdfPageCandidate[];
}): PortfolioProject[] {
  const cleanSubject = (params.subject || 'Graphic Design / UI/UX').trim();
  const baseTs = Date.now();

  return params.selectedPages.map((page, idx) => {
    const cleanTitle = page.title.trim() || `Karya ${cleanSubject} – Hal. ${page.pageNumber}`;
    return {
      id: `port-pdf-${baseTs}-${page.pageNumber}-${idx}`,
      studentId: params.studentId,
      tahunAkademik: params.tahunAkademik,
      semester: params.semester,
      judul: cleanTitle,
      jenis: cleanSubject,
      keteranganSingkat: `Cuplikan Terbaik PDF (${cleanSubject}) · Hal. ${page.pageNumber}`,
      competence: `Eksplorasi & penyusunan karya pilihan pada mata pelajaran ${cleanSubject}.`,
      technology: cleanSubject.toLowerCase().includes('ui/ux')
        ? 'Figma, Design System, Layout'
        : 'Canva, Adobe Illustrator / Figma',
      description: `Halaman ${page.pageNumber} hasil ekstraksi visual pilihan dari PDF kumpulan karya 1 semester (${cleanSubject}).`,
      externalLink: (params.pdfExternalLink || '').trim(),
      mediaItems: [
        {
          url: page.thumbnailDataUrl,
          type: 'image',
          caption: cleanTitle,
          presetArt: cleanSubject.toLowerCase().includes('ui/ux') ? 'uiux' : 'poster',
        },
      ],
      featured: idx < 2,
    };
  });
}
