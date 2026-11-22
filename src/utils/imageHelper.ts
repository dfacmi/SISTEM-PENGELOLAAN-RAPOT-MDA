export async function compressImageToDataUrl(
  file: File,
  maxSize = 480,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak didukung.'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas tidak tersedia.'));
          return;
        }
        const preserveAlpha =
          file.type === 'image/png' ||
          file.type === 'image/webp' ||
          file.type === 'image/svg+xml';
        if (!preserveAlpha) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);
        let out = preserveAlpha
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', quality);

        // Keep fallback data URLs safely below Google Sheets' 50k cell character limit
        if (out.length > 42000) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
          out = canvas.toDataURL('image/jpeg', Math.min(quality, 0.72));
        }
        resolve(out);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Compresses an existing data:image/... URL until it fits safely under Google Sheets' 50,000-char cell limit.
 */
export async function shrinkDataUrlForSheet(
  dataUrl: string,
  maxChars = 42000
): Promise<string> {
  if (!dataUrl.startsWith('data:image/') || dataUrl.length <= maxChars) {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve('');
    img.onload = () => {
      const sizes = [320, 220, 150, 100];
      const qualities = [0.72, 0.55, 0.4];
      const isPng = dataUrl.startsWith('data:image/png');

      for (const maxDim of sizes) {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        if (isPng) {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const pngOut = canvas.toDataURL('image/png');
          if (pngOut.length <= maxChars) {
            resolve(pngOut);
            return;
          }
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        for (const q of qualities) {
          const jpgOut = canvas.toDataURL('image/jpeg', q);
          if (jpgOut.length <= maxChars) {
            resolve(jpgOut);
            return;
          }
        }
      }

      resolve('');
    };
    img.src = dataUrl;
  });
}

/**
 * Processes an uploaded logo image:
 * - Preserves transparency (PNG) so dark text or icons never sit on a black JPEG box
 * - Auto-trims empty transparent padding around the logo so it sits centered & snug
 */
export async function processLogoImageToDataUrl(
  file: File,
  maxSize = 360
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file logo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format logo tidak didukung.'));
      img.onload = () => {
        const srcW = Math.max(1, img.width);
        const srcH = Math.max(1, img.height);
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = srcW;
        srcCanvas.height = srcH;
        const srcCtx = srcCanvas.getContext('2d');
        if (!srcCtx) {
          reject(new Error('Canvas tidak tersedia.'));
          return;
        }
        srcCtx.drawImage(img, 0, 0, srcW, srcH);

        // Find tight bounding box around non-transparent pixels
        let minX = srcW;
        let minY = srcH;
        let maxX = 0;
        let maxY = 0;
        let hasOpaque = false;

        try {
          const pixels = srcCtx.getImageData(0, 0, srcW, srcH).data;
          for (let y = 0; y < srcH; y++) {
            for (let x = 0; x < srcW; x++) {
              const alpha = pixels[(y * srcW + x) * 4 + 3];
              if (alpha > 12) {
                hasOpaque = true;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
        } catch {
          hasOpaque = false;
        }

        const cropX = hasOpaque ? minX : 0;
        const cropY = hasOpaque ? minY : 0;
        const cropW = hasOpaque ? Math.max(1, maxX - minX + 1) : srcW;
        const cropH = hasOpaque ? Math.max(1, maxY - minY + 1) : srcH;

        const targetDims = [maxSize, 240, 180, 130];
        let finalOut = '';
        for (const dim of targetDims) {
          const scale = Math.min(1, dim / Math.max(cropW, cropH));
          const outW = Math.max(1, Math.round(cropW * scale));
          const outH = Math.max(1, Math.round(cropH * scale));

          const outCanvas = document.createElement('canvas');
          outCanvas.width = outW;
          outCanvas.height = outH;
          const outCtx = outCanvas.getContext('2d');
          if (!outCtx) continue;
          outCtx.drawImage(
            srcCanvas,
            cropX,
            cropY,
            cropW,
            cropH,
            0,
            0,
            outW,
            outH
          );
          finalOut = outCanvas.toDataURL('image/png');
          if (finalOut.length <= 42000) {
            break;
          }
        }
        resolve(finalOut);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlBinaryBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  const b64 = dataUrl.slice(commaIdx + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Compresses an arbitrary canvas into a white-backed JPEG DataURL strictly under both
 * binary byte limit and character limit (safe for Google Sheets 50k cell limit).
 */
export function compressCanvasToJpegUnderLimit(
  sourceCanvas: HTMLCanvasElement,
  options: {
    maxWidth?: number;
    quality?: number;
    maxBytes?: number;
    maxChars?: number;
  } = {}
): { dataUrl: string; byteLength: number; width: number; height: number } {
  const maxWidth = options.maxWidth ?? 480;
  const initialQuality = options.quality ?? 0.65;
  const maxBytes = options.maxBytes ?? 20 * 1024;
  const maxChars = options.maxChars ?? 28000;

  const srcW = Math.max(1, sourceCanvas.width);
  const srcH = Math.max(1, sourceCanvas.height);

  const widthCandidates = Array.from(
    new Set([
      Math.min(srcW, maxWidth),
      Math.min(srcW, Math.round(maxWidth * 0.8)),
      Math.min(srcW, Math.round(maxWidth * 0.62)),
      Math.min(srcW, 240),
      Math.min(srcW, 180),
    ])
  ).filter((w) => w >= 40);

  const qualitySteps = Array.from(
    new Set([
      initialQuality,
      Math.min(initialQuality, 0.56),
      0.46,
      0.38,
      0.3,
    ])
  );

  let bestResult = { dataUrl: '', byteLength: Number.MAX_SAFE_INTEGER, width: srcW, height: srcH };

  for (const targetW of widthCandidates) {
    const scale = targetW / srcW;
    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(sourceCanvas, 0, 0, outW, outH);

    for (const q of qualitySteps) {
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      const byteLength = estimateDataUrlBinaryBytes(dataUrl);
      if (byteLength < bestResult.byteLength) {
        bestResult = { dataUrl, byteLength, width: outW, height: outH };
      }
      if (byteLength <= maxBytes && dataUrl.length <= maxChars) {
        canvas.width = 0;
        canvas.height = 0;
        return { dataUrl, byteLength, width: outW, height: outH };
      }
    }
    canvas.width = 0;
    canvas.height = 0;
  }

  return bestResult;
}

/**
 * Compresses an uploaded image file directly to a JPEG DataURL under strict KB/char bounds.
 */
export async function compressImageToJpegUnderLimit(
  file: File,
  options: {
    maxWidth?: number;
    quality?: number;
    maxBytes?: number;
    maxChars?: number;
  } = {}
): Promise<{ dataUrl: string; byteLength: number; width: number; height: number }> {
  const maxWidth = options.maxWidth ?? 640;
  const quality = options.quality ?? 0.68;
  const maxBytes = options.maxBytes ?? 22 * 1024;
  const maxChars = options.maxChars ?? 30000;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak didukung.'));
      img.onload = () => {
        const srcW = Math.max(1, img.width);
        const srcH = Math.max(1, img.height);
        const scale = Math.min(1, maxWidth / srcW);
        const w = Math.max(1, Math.round(srcW * scale));
        const h = Math.max(1, Math.round(srcH * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas tidak tersedia.'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const result = compressCanvasToJpegUnderLimit(canvas, {
          maxWidth,
          quality,
          maxBytes,
          maxChars,
        });
        canvas.width = 0;
        canvas.height = 0;
        resolve(result);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
