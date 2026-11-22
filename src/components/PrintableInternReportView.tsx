import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, Loader2, Maximize2, Minimize2, PlayCircle, Printer } from 'lucide-react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { DEFAULT_TEMPLATE_CONFIG } from '../data/seedData';
import {
  BrandingTemplateConfig,
  InternDailyLog,
  MdaDatabase,
} from '../types/mda';
import { formatRupiah } from '../utils/grading';
import { normalizeDisplayImageUrl } from '../utils/imageHelper';
import {
  buildMutabaahMatrixData,
  computeInternTrackerStats,
  computeTilawahProgress,
  formatMagangPeriodRange,
  formatMonthYearIndonesia,
  formatTanggalIndonesia,
  formatTanggalShort,
  getAvailableLogMonths,
  getCurrentYearMonthLocal,
  getDaysInYearMonth,
  INTERN_HOURLY_BLOCK_DEFS,
  type MutabaahMatrixResult,
  normalizeExternalMediaUrl,
  resolveInternHalamanPerJuz,
  resolveInternTrackerItems,
  resolveLogTilawahHalaman,
} from '../utils/internship';
import { getThemeStyles, mergeTemplateConfig } from '../utils/theme';
import { MdaLogo } from './MdaLogo';
import { TilawahDonutChart } from './TilawahDonutChart';

const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const ScaledA4Page: React.FC<{
  scale: number;
  pageNumber: number;
  totalPages: number;
  children: React.ReactNode;
}> = ({ scale, pageNumber, totalPages, children }) => (
  <div className="print:block">
    <div className="no-print text-center mb-1.5 sm:hidden">
      <span className="inline-block px-3 py-0.5 rounded-full bg-white/90 border border-slate-300 text-[11px] font-semibold text-slate-700 tabular-nums">
        Halaman {pageNumber} / {totalPages}
      </span>
    </div>
    <div
      className="a4-scale-outer relative mx-auto rounded-lg sm:rounded-none shadow-xl print:shadow-none overflow-hidden bg-white"
      style={{
        width: `${A4_WIDTH_PX * scale}px`,
        height: `${A4_HEIGHT_PX * scale}px`,
      }}
    >
      <div
        className="a4-scale-inner origin-top-left"
        style={{
          width: `${A4_WIDTH_PX}px`,
          height: `${A4_HEIGHT_PX}px`,
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  </div>
);

async function waitForImagesInElement(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll('img'));
  await Promise.all(
    imgs.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 2500);
        const done = () => {
          window.clearTimeout(timer);
          resolve();
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
    })
  );
}

async function inlineExternalImagesForPdf(el: HTMLElement): Promise<() => void> {
  const imgs = Array.from(el.querySelectorAll('img'));
  const restorations: Array<{ img: HTMLImageElement; prevSrc: string }> = [];

  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') || '';
      if (!/^https?:\/\//i.test(src)) return;
      try {
        let res: Response | null = null;
        try {
          res = await fetch(`/api/image-proxy?url=${encodeURIComponent(src)}`);
          if (!res.ok) res = null;
        } catch {
          res = null;
        }
        if (!res) {
          res = await fetch(src, { mode: 'cors' });
          if (!res.ok) return;
        }
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('read error'));
          reader.readAsDataURL(blob);
        });
        if (dataUrl.startsWith('data:')) {
          restorations.push({ img, prevSrc: src });
          img.setAttribute('src', dataUrl);
        }
      } catch {
        // Keep original src if unavailable
      }
    })
  );

  if (restorations.length > 0) {
    await waitForImagesInElement(el);
  }

  return () => {
    for (const item of restorations) {
      item.img.setAttribute('src', item.prevSrc);
    }
  };
}

function normalizePdfLinkUrl(rawUrl?: string | null): string {
  return normalizeExternalMediaUrl(rawUrl);
}

function estimateTwoColJournalRowHeightPx(log: InternDailyLog): number {
  const kejadianText = (log.kejadianPenting || '').trim();
  const kejadianLeftHeight = kejadianText
    ? Math.max(1, Math.ceil(kejadianText.length / 26)) * 12 + 24
    : 0;
  const tilawahHalaman = resolveLogTilawahHalaman(log);
  const leftHeight =
    52 + (tilawahHalaman > 0 ? 18 : 0) + kejadianLeftHeight;

  let blockLinesHeight = 0;
  for (const def of INTERN_HOURLY_BLOCK_DEFS) {
    const val = (log.hourlyBlocks?.[def.key] || '').trim();
    if (!val) continue;
    const lines = Math.max(1, Math.ceil(val.length / 72));
    blockLinesHeight += lines * 13 + 6;
  }
  if (blockLinesHeight === 0) blockLinesHeight = 28;

  const noteText = (log.catatanPembimbing || '').trim();
  const noteHeight = noteText
    ? Math.max(1, Math.ceil(noteText.length / 70)) * 12.5 + 22
    : 0;

  const fotoCount = Array.isArray(log.fotoUrls) ? log.fotoUrls.filter(Boolean).slice(0, 2).length : 0;
  const photoHeight = fotoCount > 0 ? 116 : 0;
  const videoHeight = normalizeExternalMediaUrl(log.videoUrl) ? 34 : 0;

  return Math.max(leftHeight, blockLinesHeight + noteHeight + photoHeight + videoHeight) + 22;
}

interface InternPageSpec {
  type: 'summary' | 'journal';
  logs: InternDailyLog[];
  showOverflowSecondMatrix?: boolean;
  showSignature: boolean;
}

function buildInternPdfPages(
  logs: InternDailyLog[],
  itemsCount: number,
  hasSecondMatrixBlock: boolean
): InternPageSpec[] {
  const singleMatrixPage1WithSigPossible =
    logs.length === 0 && !hasSecondMatrixBlock && itemsCount <= 12;

  if (logs.length === 0 && !hasSecondMatrixBlock) {
    return [
      {
        type: 'summary',
        logs: [],
        showOverflowSecondMatrix: false,
        showSignature: singleMatrixPage1WithSigPossible,
      },
      ...(singleMatrixPage1WithSigPossible
        ? []
        : [
            {
              type: 'journal' as const,
              logs: [],
              showOverflowSecondMatrix: false,
              showSignature: true,
            },
          ]),
    ];
  }

  const secondMatrixNeedsPage2 = hasSecondMatrixBlock && itemsCount > 10;
  const pages: InternPageSpec[] = [
    {
      type: 'summary',
      logs: [],
      showOverflowSecondMatrix: false,
      showSignature: false,
    },
  ];

  const journalPageBudget = 875;
  const signatureNeededPx = 175;
  const secondMatrixReservePx = secondMatrixNeedsPage2 ? itemsCount * 22 + 70 : 0;

  let currentBudget = journalPageBudget - secondMatrixReservePx;
  let currentLogs: InternDailyLog[] = [];
  let usedPx = 0;
  let firstJournalPage = true;

  if (logs.length === 0) {
    pages.push({
      type: 'journal',
      logs: [],
      showOverflowSecondMatrix: secondMatrixNeedsPage2,
      showSignature: true,
    });
    return pages;
  }

  for (const log of logs) {
    const rowH = Math.min(journalPageBudget - 25, estimateTwoColJournalRowHeightPx(log));
    if (currentLogs.length > 0 && usedPx + rowH > currentBudget) {
      pages.push({
        type: 'journal',
        logs: currentLogs,
        showOverflowSecondMatrix: firstJournalPage && secondMatrixNeedsPage2,
        showSignature: false,
      });
      firstJournalPage = false;
      currentLogs = [log];
      currentBudget = journalPageBudget;
      usedPx = rowH;
    } else {
      currentLogs.push(log);
      usedPx += rowH;
    }
  }

  if (currentLogs.length > 0) {
    const fitsSignature = usedPx + signatureNeededPx <= currentBudget;
    pages.push({
      type: 'journal',
      logs: currentLogs,
      showOverflowSecondMatrix: firstJournalPage && secondMatrixNeedsPage2,
      showSignature: fitsSignature,
    });
    if (!fitsSignature) {
      pages.push({
        type: 'journal',
        logs: [],
        showOverflowSecondMatrix: false,
        showSignature: true,
      });
    }
  }

  return pages;
}

const MatrixBlockTable: React.FC<{
  matrix: MutabaahMatrixResult;
  darkPill: string;
}> = ({ matrix, darkPill }) => (
  <table
    className="w-full border-collapse text-[9.5px] bg-white"
    style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
  >
    <thead>
      <tr className="text-white" style={{ backgroundColor: darkPill }}>
        <th
          rowSpan={2}
          className="border border-slate-500 px-1 py-1 text-center font-bold w-[26px]"
        >
          No
        </th>
        <th
          rowSpan={2}
          className="border border-slate-500 px-2 py-1 text-left font-bold w-[235px]"
        >
          Kegiatan Ibadah &amp; Amal
        </th>
        <th
          colSpan={matrix.dayNumbers.length}
          className="border border-slate-500 px-1 py-0.5 text-center font-bold tracking-wide text-[#1DF27A]"
        >
          Tanggal ({matrix.monthLabel})
        </th>
        <th
          rowSpan={2}
          className="border border-slate-500 px-1.5 py-1 text-center font-bold w-[42px]"
        >
          Total
        </th>
      </tr>
      <tr className="bg-[#163842] text-white">
        {matrix.dayNumbers.map((d) => {
          const hasLog = Boolean(matrix.logByDay[d]);
          return (
            <th
              key={d}
              className={`border border-slate-500 py-0.5 px-0 text-center font-bold tabular-nums ${
                hasLog ? 'text-[#1DF27A]' : 'text-slate-200'
              }`}
            >
              {d}
            </th>
          );
        })}
      </tr>
    </thead>
    <tbody>
      {matrix.rows.map((row, idx) => (
        <tr key={row.item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/80'}>
          <td className="border border-slate-300 px-1 py-1 text-center font-bold text-slate-600 tabular-nums">
            {row.no}
          </td>
          <td className="border border-slate-300 px-2 py-1 font-semibold text-slate-900 whitespace-normal leading-tight">
            {row.item.label}
          </td>
          {row.cells.map((cell, cIdx) => {
            const dNum = matrix.dayNumbers[cIdx];
            return (
              <td
                key={`${row.item.id}-${dNum}`}
                className={`border border-slate-300 py-1 px-0 text-center font-bold tabular-nums ${
                  cell === 'yes'
                    ? 'bg-emerald-50 text-emerald-700'
                    : cell === 'no'
                      ? 'bg-rose-50 text-rose-600'
                      : 'text-slate-300'
                }`}
              >
                {cell === 'yes' ? '✓' : cell === 'no' ? '✗' : '-'}
              </td>
            );
          })}
          <td className="border border-slate-300 px-1 py-1 text-center font-bold tabular-nums bg-slate-50 text-slate-900">
            <span className="text-emerald-700">{row.yesCount}</span>
            <span className="text-slate-400 font-normal">/{row.answeredCount}</span>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

interface PrintableInternReportViewProps {
  db: MdaDatabase;
  studentId: string;
  templateConfig?: BrandingTemplateConfig;
  onBack: () => void;
}

export const PrintableInternReportView: React.FC<PrintableInternReportViewProps> = ({
  db,
  studentId,
  templateConfig,
  onBack,
}) => {
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined'
      ? Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth)
      : 1024
  );
  const [zoomMode, setZoomMode] = useState<'fit' | 'actual'>('fit');
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const pageRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const handleResize = () =>
      setViewportWidth(
        Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth)
      );
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const autoScale = Math.min(1, Math.max(0.32, (viewportWidth - 24) / A4_WIDTH_PX));
  const activeScale = zoomMode === 'fit' ? autoScale : 1;

  const tpl = useMemo(
    () => mergeTemplateConfig(templateConfig || db.templateConfig, DEFAULT_TEMPLATE_CONFIG),
    [templateConfig, db.templateConfig]
  );
  const theme = getThemeStyles(tpl.accentTheme);

  const student = useMemo(
    () => db.students.find((s) => s.id === studentId) || db.students[0],
    [db.students, studentId]
  );

  const profile = useMemo(
    () => (db.internProfiles || []).find((p) => p.studentId === student?.id),
    [db.internProfiles, student?.id]
  );

  const formattedMagangPeriod = useMemo(
    () =>
      formatMagangPeriodRange(
        profile?.mulaiTanggal,
        profile?.selesaiTanggal,
        profile?.jamKerjaHarian,
        profile?.waktuMagang
      ),
    [profile?.mulaiTanggal, profile?.selesaiTanggal, profile?.jamKerjaHarian, profile?.waktuMagang]
  );

  const studentLogs = useMemo(
    () =>
      (db.internDailyLogs || [])
        .filter((l) => l.studentId === student?.id)
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    [db.internDailyLogs, student?.id]
  );

  const availableMonths = useMemo(() => getAvailableLogMonths(studentLogs), [studentLogs]);
  const preferredInitialMonth = useMemo(() => {
    if (studentLogs.length > 0) {
      return studentLogs[studentLogs.length - 1].tanggal.slice(0, 7);
    }
    return availableMonths[0] || getCurrentYearMonthLocal();
  }, [studentLogs, availableMonths]);

  const [selectedMatrixMonth, setSelectedMatrixMonth] = useState<string>(preferredInitialMonth);

  useEffect(() => {
    if (!availableMonths.includes(selectedMatrixMonth)) {
      setSelectedMatrixMonth(preferredInitialMonth);
    }
  }, [availableMonths, preferredInitialMonth, selectedMatrixMonth]);

  const trackerItems = useMemo(() => resolveInternTrackerItems(tpl), [tpl]);
  const sholatItems = useMemo(
    () => trackerItems.filter((it) => it.group === 'sholat'),
    [trackerItems]
  );
  const nonSholatItems = useMemo(
    () => trackerItems.filter((it) => it.group !== 'sholat'),
    [trackerItems]
  );
  const halamanPerJuz = useMemo(() => resolveInternHalamanPerJuz(tpl), [tpl]);

  const stats = useMemo(
    () => computeInternTrackerStats(studentLogs, trackerItems),
    [studentLogs, trackerItems]
  );
  const tilawahProgress = useMemo(
    () => computeTilawahProgress(studentLogs, halamanPerJuz),
    [studentLogs, halamanPerJuz]
  );

  const matrixFirstHalf = useMemo(
    () => buildMutabaahMatrixData(studentLogs, trackerItems, selectedMatrixMonth, '1-15'),
    [studentLogs, trackerItems, selectedMatrixMonth]
  );
  const matrixSecondHalf = useMemo(
    () => buildMutabaahMatrixData(studentLogs, trackerItems, selectedMatrixMonth, '16-end'),
    [studentLogs, trackerItems, selectedMatrixMonth]
  );
  const showSecondHalfBlock = matrixFirstHalf.hasSecondHalfLogs;
  const secondHalfOnPage1 = showSecondHalfBlock && trackerItems.length <= 10;

  const activePeriod = useMemo(
    () => db.periods.find((p) => p.isActive) || db.periods[db.periods.length - 1],
    [db.periods]
  );

  const pages = useMemo(
    () => buildInternPdfPages(studentLogs, trackerItems.length, showSecondHalfBlock),
    [studentLogs, trackerItems.length, showSecondHalfBlock]
  );

  if (!student) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-slate-600 mb-4">Data santri tidak ditemukan.</p>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold"
        >
          Kembali
        </button>
      </div>
    );
  }

  const handleDownloadPdf = async () => {
    setExportError(null);
    setExportProgress('Menyiapkan halaman...');
    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });

      const pageElements = pageRefs.current.filter((el): el is HTMLElement => Boolean(el));
      if (pageElements.length === 0) {
        throw new Error('Halaman laporan magang tidak ditemukan.');
      }

      const imgX = 0;
      const imgY = 0;
      const imgWidth = 210;
      const imgHeight = 297;

      for (let i = 0; i < pageElements.length; i++) {
        setExportProgress(`Membuat PDF (${i + 1}/${pageElements.length})...`);
        const pageEl = pageElements[i];
        await waitForImagesInElement(pageEl);
        const restoreExternalImages = await inlineExternalImagesForPdf(pageEl);

        interface MeasuredPdfLink {
          cleanUrl: string;
          rects: Array<{ x: number; y: number; w: number; h: number }>;
        }
        const pageLinks: MeasuredPdfLink[] = [];
        const scaleContainer = pageEl.closest('.a4-scale-inner') as HTMLElement | null;
        const prevTransform = scaleContainer ? scaleContainer.style.transform : '';
        if (scaleContainer) {
          scaleContainer.style.transform = 'none';
          void pageEl.offsetWidth;
        }

        let pngDataUrl = '';
        try {
          const pageRect = pageEl.getBoundingClientRect();
          if (pageRect.width > 0 && pageRect.height > 0) {
            const linkElements = Array.from(
              pageEl.querySelectorAll<HTMLElement>('a[href], [data-pdf-link]')
            );
            for (const linkEl of linkElements) {
              const cleanUrl = normalizePdfLinkUrl(
                linkEl.getAttribute('href') || linkEl.getAttribute('data-pdf-link-url')
              );
              if (!cleanUrl) continue;

              const clientRects = linkEl.getClientRects();
              const rawRects =
                clientRects.length > 0
                  ? Array.from(clientRects)
                  : [linkEl.getBoundingClientRect()];

              const mappedRects: Array<{ x: number; y: number; w: number; h: number }> = [];
              for (const rect of rawRects) {
                const x = imgX + ((rect.left - pageRect.left) / pageRect.width) * imgWidth;
                const y = imgY + ((rect.top - pageRect.top) / pageRect.height) * imgHeight;
                const w = (rect.width / pageRect.width) * imgWidth;
                const h = (rect.height / pageRect.height) * imgHeight;

                if (
                  w > 0 &&
                  h > 0 &&
                  x + w > imgX &&
                  y + h > imgY &&
                  x < imgX + imgWidth &&
                  y < imgY + imgHeight
                ) {
                  mappedRects.push({ x, y, w, h });
                }
              }

              if (mappedRects.length > 0) {
                pageLinks.push({ cleanUrl, rects: mappedRects });
              }
            }
          }

          pngDataUrl = await toPng(pageEl, {
            width: A4_WIDTH_PX,
            height: A4_HEIGHT_PX,
            canvasWidth: A4_WIDTH_PX * 2,
            canvasHeight: A4_HEIGHT_PX * 2,
            pixelRatio: 2,
            backgroundColor: '#ffffff',
            skipFonts: true,
            skipAutoScale: true,
            cacheBust: false,
            imagePlaceholder: TRANSPARENT_PIXEL,
            style: {
              transform: 'none',
              margin: '0',
              width: `${A4_WIDTH_PX}px`,
              height: `${A4_HEIGHT_PX}px`,
            },
          });
        } finally {
          if (scaleContainer) {
            scaleContainer.style.transform = prevTransform;
          }
          restoreExternalImages();
        }

        if (i > 0) {
          pdf.addPage('a4', 'portrait');
        }

        // 1. Lapisan teks URL asli di bawah gambar agar viewer PDF HP mengenali tautan video
        for (const linkItem of pageLinks) {
          const primaryRect = linkItem.rects[0];
          const textX = Math.max(0, Math.min(imgWidth - 10, primaryRect.x));
          const textY = Math.max(3, Math.min(imgHeight - 2, primaryRect.y + primaryRect.h * 0.7));
          pdf.setFontSize(8);
          pdf.text(linkItem.cleanUrl, textX, textY);
        }

        // 2. Gambar halaman A4 penuh di atas lapisan teks
        pdf.addImage(pngDataUrl, 'PNG', imgX, imgY, imgWidth, imgHeight, undefined, 'FAST');

        // 3. Anotasi link PDF interaktif
        for (const linkItem of pageLinks) {
          for (const rect of linkItem.rects) {
            const linkX = Math.max(0, rect.x - 1.5);
            const linkY = Math.max(0, rect.y - 1.5);
            const linkW = Math.min(imgWidth - linkX, rect.w + 3);
            const linkH = Math.min(imgHeight - linkY, Math.max(rect.h + 3, 9));
            if (linkW > 0 && linkH > 0) {
              pdf.link(linkX, linkY, linkW, linkH, { url: linkItem.cleanUrl });
            }
          }
        }
      }

      const safeName = student.nama.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
      pdf.save(`Laporan_Magang_Ibadah_${safeName || student.nisnMda}.pdf`);
      setExportProgress(null);
    } catch (err: any) {
      setExportProgress(null);
      setExportError(
        err?.message || 'Gagal mengunduh file PDF. Gunakan tombol Cetak untuk simpan PDF.'
      );
    }
  };

  const MdaInternFooter = ({ pageNum, totalPages }: { pageNum: number; totalPages: number }) => (
    <div
      className="mt-auto shrink-0 px-8 py-2.5 flex items-center justify-between gap-4 text-[9.5px] text-slate-950"
      style={{
        background: theme.footerGradient,
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      <div className="font-semibold max-w-[290px] leading-snug">
        {tpl.pesanPenutupHalaman2 ||
          'Semoga ilmu, akhlak, dan amal ibadah yang terjaga selama magang membawa keberkahan.'}
      </div>
      <div className="text-right leading-snug tabular-nums">
        <div className="font-bold">
          WhatsApp: {tpl.whatsapp} · Hal. {pageNum} / {totalPages}
        </div>
        <div className="font-semibold">
          {tpl.instagram} · {tpl.email}
        </div>
        <div>{tpl.alamat}</div>
      </div>
    </div>
  );

  const SignatureBlock = () => (
    <div className="mt-4 pt-3 border-t border-emerald-700/25 bg-white/80 rounded-xl px-4 py-3 border border-emerald-200/70">
      <div className="text-right text-[10px] text-slate-700 mb-2">
        {tpl.kotaTanggal || 'Sukoharjo'},{' '}
        {new Date().toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </div>
      <div className="grid grid-cols-3 gap-4 text-center text-[10px]">
        <div className="flex flex-col items-center justify-between min-h-[96px]">
          <div className="text-slate-600">Santri Peserta Magang,</div>
          <div className="pt-10">
            <div className="font-bold text-slate-900 underline">{student.nama}</div>
            <div className="text-[9px] text-slate-500">ID: {student.nisnMda}</div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between min-h-[96px]">
          <div className="text-slate-600">Pembimbing Magang / Wali Kelas,</div>
          <div className="pt-10">
            <div className="font-bold text-slate-900 underline">
              {profile?.pembimbingNama || student.waliKelasNama || 'Pembimbing Magang'}
            </div>
            <div className="text-[9px] text-slate-500">Pembimbing Lapangan</div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between min-h-[96px]">
          <div>
            <div className="text-slate-600">Mengetahui,</div>
            <div className="font-semibold text-slate-800">Kepala Unit MDA</div>
          </div>
          <div className="flex flex-col items-center">
            {activePeriod?.ttdKepalaUnitUrl ? (
              <img
                src={activePeriod.ttdKepalaUnitUrl}
                alt="TTD Kepala Unit"
                referrerPolicy="no-referrer"
                className="h-10 object-contain mb-1"
              />
            ) : (
              <div className="h-10" />
            )}
            <div className="font-bold text-slate-900 underline">
              {activePeriod?.kepalaUnitMda || 'Kepala Unit MDA'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const daysInSelectedMonth = getDaysInYearMonth(selectedMatrixMonth);
  const activeRatioPct = Math.min(100, Math.round((stats.totalDays / 30) * 100));

  return (
    <div
      className="min-h-screen bg-slate-200/90 pb-12 print:bg-white print:pb-0"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      {/* Screen Toolbar */}
      <div className="no-print sticky top-0 z-30 bg-[#0E2228] text-white border-b border-slate-700 px-3 sm:px-6 py-2.5 shadow-md">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Kembali</span>
            </button>
            <div className="min-w-0 hidden sm:block">
              <div className="text-xs font-bold truncate">{student.nama}</div>
              <div className="text-[11px] text-slate-300 truncate">
                Laporan Magang &amp; Mutabaah Ibadah · {pages.length} Halaman A4 (Font Arial)
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <select
              value={selectedMatrixMonth}
              onChange={(e) => setSelectedMatrixMonth(e.target.value)}
              aria-label="Bulan Matriks PDF"
              className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-xs font-semibold"
            >
              {availableMonths.map((ym) => (
                <option key={ym} value={ym} className="text-slate-900">
                  Matriks: {formatMonthYearIndonesia(ym)}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setZoomMode((m) => (m === 'fit' ? 'actual' : 'fit'))}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold sm:hidden"
            >
              {zoomMode === 'fit' ? (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>100%</span>
                </>
              ) : (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Pas Layar</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak</span>
            </button>

            <button
              type="button"
              disabled={Boolean(exportProgress)}
              onClick={() => void handleDownloadPdf()}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1DF27A] hover:bg-emerald-400 text-[#0E2228] text-xs font-bold disabled:opacity-60"
            >
              {exportProgress ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{exportProgress}</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh PDF Laporan Magang</span>
                </>
              )}
            </button>
          </div>
        </div>
        {exportError && (
          <div className="max-w-5xl mx-auto mt-2 px-3 py-2 rounded-lg bg-rose-500/20 border border-rose-400/50 text-xs text-rose-100">
            {exportError}
          </div>
        )}
      </div>

      {/* A4 Pages */}
      <div
        className={`py-5 sm:py-8 px-2 sm:px-4 space-y-6 print:p-0 print:space-y-0 ${
          zoomMode === 'fit' ? 'overflow-x-hidden' : 'overflow-x-auto'
        }`}
      >
        {pages.map((page, idx) => {
          const pageNum = idx + 1;
          const totalPages = pages.length;

          return (
            <ScaledA4Page
              key={`intern-page-${pageNum}`}
              scale={activeScale}
              pageNumber={pageNum}
              totalPages={totalPages}
            >
              <section
                ref={(el) => {
                  pageRefs.current[idx] = el;
                }}
                className="a4-page rapor-a4-page relative w-[210mm] h-[297mm] mx-auto text-slate-900 flex flex-col justify-between overflow-hidden"
                style={{
                  backgroundColor: theme.pageTint,
                  fontFamily: 'Arial, Helvetica, sans-serif',
                }}
              >
                {/* Page Main Body */}
                <div className="px-8 pt-6 pb-3 flex-1 flex flex-col justify-between">
                  <div className="space-y-3">
                    {/* MDA Rapor Header */}
                    <div
                      className="flex items-center justify-between gap-4 pb-2.5 border-b-2"
                      style={{ borderColor: theme.darkPill }}
                    >
                      <div className="flex items-center gap-3">
                        <MdaLogo size="sm" customLogoUrl={tpl.customLogoUrl} />
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wide text-sky-700">
                            {tpl.namaLembaga} · {tpl.namaPesantren}
                          </div>
                          <div className="text-[14px] font-bold text-slate-950 mt-0.5 uppercase">
                            LAPORAN KEGIATAN MAGANG &amp; MUTABAAH IBADAH
                          </div>
                          <div className="text-[9.5px] text-slate-600">
                            Alamat: {tpl.alamat}
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-[10px] text-slate-700 shrink-0 tabular-nums">
                        <div className="font-bold text-slate-950">{student.nama}</div>
                        <div>
                          {student.nisnMda} · {student.kelas}
                        </div>
                        <div className="font-bold text-emerald-800">
                          Hal. {pageNum} dari {totalPages}
                        </div>
                      </div>
                    </div>

                    {/* ================= PAGE 1: RINGKASAN EKSEKUTIF & MATRIKS ================= */}
                    {page.type === 'summary' && (
                      <div className="space-y-3">
                        {/* Pill Judul Seksi 1 */}
                        <div className="flex items-center justify-between gap-2">
                          <div
                            className="inline-block text-slate-950 font-bold text-[10.5px] px-3.5 py-1 rounded-full tracking-wide"
                            style={{ backgroundColor: theme.sectionSky }}
                          >
                            PROFIL &amp; CAPAIAN MAGANG
                          </div>
                          <div className="text-[10px] font-bold text-slate-600 tabular-nums">
                            {stats.totalDays} Hari Log Tercatat
                          </div>
                        </div>

                        {/* Kartu Profil Magang 2 Kolom */}
                        <div className="bg-white/95 border border-[#728C81] rounded-xl p-3 text-[10.5px] shadow-xs">
                          <div className="grid grid-cols-2 gap-4">
                            <table className="w-full">
                              <tbody>
                                <tr>
                                  <td className="py-0.5 text-slate-500 w-28">Nama Santri</td>
                                  <td className="py-0.5 font-bold text-slate-950">
                                    : {student.nama}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="py-0.5 text-slate-500">ID Santri MDA</td>
                                  <td className="py-0.5 font-bold tabular-nums">
                                    : {student.nisnMda}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="py-0.5 text-slate-500">Kelas / Program</td>
                                  <td className="py-0.5">: {student.kelas}</td>
                                </tr>
                                <tr>
                                  <td className="py-0.5 text-slate-500">Pembimbing</td>
                                  <td className="py-0.5 font-semibold">
                                    : {profile?.pembimbingNama || student.waliKelasNama || '-'}
                                  </td>
                                </tr>
                              </tbody>
                            </table>

                            <table className="w-full">
                              <tbody>
                                <tr>
                                  <td className="py-0.5 text-slate-500 w-28">Tempat Magang</td>
                                  <td className="py-0.5 font-bold text-slate-950">
                                    : {profile?.tempatMagang || '-'}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="py-0.5 text-slate-500">Periode Magang</td>
                                  <td className="py-0.5">: {formattedMagangPeriod || '-'}</td>
                                </tr>
                                <tr>
                                  <td className="py-0.5 text-slate-500">Kompetensi</td>
                                  <td className="py-0.5">: {profile?.kompetensiMagang || '-'}</td>
                                </tr>
                                <tr>
                                  <td className="py-0.5 text-slate-500">Income Magang</td>
                                  <td className="py-0.5 font-bold text-emerald-800 tabular-nums">
                                    : {formatRupiah(profile?.incomeMagangRp || 0)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Kartu Capaian Visual: Bar Progres Emerald (Kiri) + Donut Tilawah 30 Juz (Kanan) */}
                        <div className="grid grid-cols-12 gap-3 items-stretch">
                          <div className="col-span-7 bg-white/95 border border-[#728C81] rounded-xl p-3 flex flex-col justify-between gap-2">
                            <div className="text-[10px] font-bold text-slate-800 uppercase tracking-wide">
                              Ringkasan Capaian Ibadah &amp; Jurnal
                            </div>
                            <div className="space-y-2">
                              {[
                                {
                                  label: 'Sholat Berjamaah',
                                  pct: stats.sholatPct,
                                  pill: `${stats.sholatPct}%`,
                                },
                                {
                                  label: 'Amal Kebersihan & Tambahan',
                                  pct: stats.otherPct,
                                  pill: `${stats.otherPct}%`,
                                },
                                {
                                  label: 'Keaktifan Jurnal Magang',
                                  pct: activeRatioPct,
                                  pill: `${stats.totalDays} Hr`,
                                },
                              ].map((bar) => (
                                <div key={bar.label} className="flex items-center gap-2">
                                  <div className="relative flex-1 h-7 bg-slate-50 rounded-full border border-emerald-300 overflow-hidden flex items-center">
                                    <div
                                      className="h-full rounded-full"
                                      style={{
                                        width: `${Math.max(4, bar.pct)}%`,
                                        backgroundColor: theme.barTrack,
                                      }}
                                    />
                                    <span className="absolute left-3 text-[10px] font-bold text-slate-900">
                                      {bar.label}
                                    </span>
                                  </div>
                                  <div
                                    className="w-16 h-7 text-white rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums shrink-0"
                                    style={{ backgroundColor: theme.darkPill }}
                                  >
                                    {bar.pill}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="col-span-5 flex items-stretch">
                            <div className="w-full flex">
                              <TilawahDonutChart
                                compact
                                summary={tilawahProgress}
                                accentColor={theme.barFill}
                                title="Capaian Tilawah (Target 30 Juz)"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Pill Judul Seksi 2: Matriks Mutabaah */}
                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <div
                            className="inline-block text-slate-950 font-bold text-[10.5px] px-3.5 py-1 rounded-full tracking-wide"
                            style={{ backgroundColor: theme.sectionSky }}
                          >
                            MATRIKS MUTABAAH IBADAH
                          </div>
                          <div className="text-[10px] font-bold text-slate-700">
                            Periode: {matrixFirstHalf.monthLabel} ·{' '}
                            <span className="text-emerald-700">✓ Terpenuhi</span> /{' '}
                            <span className="text-rose-600">✗ Tidak</span>
                          </div>
                        </div>

                        {/* Tabel Matriks Blok 1 (Tgl 1..15) */}
                        <div className="rounded-lg overflow-hidden border border-slate-400 shadow-xs">
                          <MatrixBlockTable matrix={matrixFirstHalf} darkPill={theme.darkPill} />
                        </div>

                        {/* Tabel Matriks Blok 2 (Tgl 16..31) jika ada data di paruh kedua & muat di Hal 1 */}
                        {secondHalfOnPage1 && (
                          <div className="space-y-1">
                            <div className="text-[9.5px] font-bold text-slate-700">
                              Lanjutan Tanggal 16 – {daysInSelectedMonth} ({matrixSecondHalf.monthLabel})
                            </div>
                            <div className="rounded-lg overflow-hidden border border-slate-400 shadow-xs">
                              <MatrixBlockTable
                                matrix={matrixSecondHalf}
                                darkPill={theme.darkPill}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ================= PAGE 2+: RINCIAN JURNAL 2 KOLOM LEGA ================= */}
                    {page.type === 'journal' && (
                      <div className="space-y-3">
                        {page.showOverflowSecondMatrix && (
                          <div className="space-y-1.5">
                            <div
                              className="inline-block text-slate-950 font-bold text-[10.5px] px-3.5 py-1 rounded-full tracking-wide"
                              style={{ backgroundColor: theme.sectionSky }}
                            >
                              LANJUTAN MATRIKS MUTABAAH IBADAH (TGL 16–{daysInSelectedMonth})
                            </div>
                            <div className="rounded-lg overflow-hidden border border-slate-400 shadow-xs">
                              <MatrixBlockTable
                                matrix={matrixSecondHalf}
                                darkPill={theme.darkPill}
                              />
                            </div>
                          </div>
                        )}

                        {(page.logs.length > 0 || !page.showSignature) && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div
                                className="inline-block text-slate-950 font-bold text-[10.5px] px-3.5 py-1 rounded-full tracking-wide"
                                style={{ backgroundColor: theme.sectionSky }}
                              >
                                RINCIAN JURNAL AKTIVITAS HARIAN MAGANG (5 BLOK JAM)
                              </div>
                              <div className="text-[10px] font-semibold text-slate-600 tabular-nums">
                                {page.logs.length} entri pada halaman ini
                              </div>
                            </div>

                            {page.logs.length === 0 ? (
                              <div className="bg-white/90 border border-dashed border-slate-300 rounded-xl p-6 text-center text-[11px] text-slate-500">
                                Belum ada entri jurnal aktivitas harian magang yang tersimpan untuk santri ini.
                              </div>
                            ) : (
                              <table className="w-full border-collapse text-[9.5px] bg-white rounded-lg overflow-hidden">
                                <thead>
                                  <tr
                                    className="text-white text-left"
                                    style={{ backgroundColor: theme.darkPill }}
                                  >
                                    <th className="border border-slate-500 px-2.5 py-1.5 w-[26%]">
                                      Tanggal, Ringkasan &amp; Kejadian Penting
                                    </th>
                                    <th className="border border-slate-500 px-3 py-1.5 w-[74%]">
                                      Aktivitas Harian (5 Blok Jam: 05.00 – 03.00) &amp; Catatan
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {page.logs.map((log, rowIdx) => {
                                    const sholatYes = sholatItems.filter(
                                      (it) => log.trackerResults?.[it.id] === 'yes'
                                    ).length;
                                    const otherYes = nonSholatItems.filter(
                                      (it) => log.trackerResults?.[it.id] === 'yes'
                                    ).length;
                                    const logTilawahHalaman = resolveLogTilawahHalaman(log);
                                    const logFotos = Array.isArray(log.fotoUrls)
                                      ? log.fotoUrls.filter(Boolean).slice(0, 2)
                                      : [];
                                    const logVideoUrl = normalizeExternalMediaUrl(log.videoUrl);

                                    return (
                                      <tr
                                        key={log.id}
                                        className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/75'}
                                      >
                                        <td className="border border-slate-300 px-2.5 py-2 align-top space-y-1.5">
                                          <div>
                                            <div className="font-bold text-[10px] text-slate-950">
                                              {formatTanggalShort(log.tanggal)}
                                            </div>
                                            <div className="text-[8.5px] text-slate-500 leading-tight">
                                              {formatTanggalIndonesia(log.tanggal).split(',')[0]}
                                            </div>
                                          </div>

                                          <div className="text-[8.5px] font-bold tabular-nums text-slate-800 bg-slate-100 rounded px-1.5 py-1 border border-slate-200 leading-snug">
                                            <div>
                                              Sholat:{' '}
                                              <span className="text-emerald-700">
                                                {sholatYes}/{sholatItems.length}
                                              </span>
                                            </div>
                                            <div>
                                              Amal:{' '}
                                              <span className="text-emerald-700">
                                                {otherYes}/{nonSholatItems.length}
                                              </span>
                                            </div>
                                          </div>

                                          {logTilawahHalaman > 0 && (
                                            <div className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[8.5px] font-bold text-emerald-800 tabular-nums">
                                              Tilawah {logTilawahHalaman} Hal
                                            </div>
                                          )}

                                          {(log.kejadianPenting || '').trim() && (
                                            <div className="p-1.5 rounded bg-amber-50 border border-amber-200 text-[8.5px] text-amber-950 leading-snug">
                                              <div className="font-bold text-amber-900">
                                                Kejadian Penting:
                                              </div>
                                              <div>{log.kejadianPenting}</div>
                                            </div>
                                          )}
                                        </td>

                                        <td className="border border-slate-300 px-3 py-2 align-top space-y-1.5">
                                          {INTERN_HOURLY_BLOCK_DEFS.map((def) => {
                                            const text = (log.hourlyBlocks?.[def.key] || '').trim();
                                            if (!text) return null;
                                            return (
                                              <div key={def.key} className="leading-relaxed">
                                                <span className="font-bold text-emerald-900 tabular-nums">
                                                  [{def.timeRange}]
                                                </span>{' '}
                                                <span className="text-slate-800">{text}</span>
                                              </div>
                                            );
                                          })}

                                          {(log.catatanPembimbing || '').trim() && (
                                            <div className="mt-1.5 px-2 py-1 rounded bg-[#E8FAF3] border border-emerald-200 text-[8.5px] text-emerald-950 leading-snug">
                                              <strong>Catatan Pembimbing:</strong>{' '}
                                              {log.catatanPembimbing}
                                            </div>
                                          )}

                                          {(logFotos.length > 0 || logVideoUrl) && (
                                            <div className="mt-1.5 pt-1.5 border-t border-slate-200/80 space-y-1.5">
                                              {logFotos.length > 0 && (
                                                <div>
                                                  <div className="text-[8px] font-bold uppercase tracking-wide text-slate-600 mb-1">
                                                    Dokumentasi Foto Kegiatan ({logFotos.length})
                                                  </div>
                                                  <div
                                                    className={`grid gap-2 ${
                                                      logFotos.length > 1
                                                        ? 'grid-cols-2 max-w-[340px]'
                                                        : 'grid-cols-1 max-w-[170px]'
                                                    }`}
                                                  >
                                                    {logFotos.map((foto, fIdx) => (
                                                      <div
                                                        key={`${log.id}-pdf-foto-${fIdx}`}
                                                        className="rounded border border-slate-300 bg-slate-50 overflow-hidden h-[84px] flex items-center justify-center p-0.5"
                                                      >
                                                        <img
                                                          src={normalizeDisplayImageUrl(foto)}
                                                          alt={`Dokumentasi ${fIdx + 1}`}
                                                          referrerPolicy="no-referrer"
                                                          className="max-w-full max-h-full object-contain"
                                                        />
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                              )}

                                              {logVideoUrl && (
                                                <div>
                                                  <a
                                                    href={logVideoUrl}
                                                    data-pdf-link="true"
                                                    data-pdf-link-url={logVideoUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0E2228] text-white text-[8.5px] font-bold underline decoration-[#1DF27A]"
                                                  >
                                                    <PlayCircle className="w-3 h-3 text-[#1DF27A] shrink-0" />
                                                    <span>
                                                      Putar / Buka Video Kegiatan ↗ ({logVideoUrl})
                                                    </span>
                                                  </a>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Signature Block on Final Page */}
                  {page.showSignature && <SignatureBlock />}
                </div>

                {/* MDA Gradient Footer Bar */}
                <MdaInternFooter pageNum={pageNum} totalPages={totalPages} />
              </section>
            </ScaledA4Page>
          );
        })}
      </div>
    </div>
  );
};
