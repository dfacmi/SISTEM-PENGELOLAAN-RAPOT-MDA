import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, Loader2, Maximize2, Minimize2, Printer } from 'lucide-react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { DEFAULT_TEMPLATE_CONFIG } from '../data/seedData';
import { BrandingTemplateConfig, InternDailyLog, InternTrackerItem, MdaDatabase } from '../types/mda';
import { formatRupiah } from '../utils/grading';
import {
  computeInternTrackerStats,
  formatTanggalIndonesia,
  formatTanggalShort,
  getTrackerButtonLabels,
  INTERN_HOURLY_BLOCK_DEFS,
  resolveInternTrackerItems,
} from '../utils/internship';
import { getThemeStyles, mergeTemplateConfig } from '../utils/theme';
import { MdaLogo } from './MdaLogo';

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

function estimateDailyLogRowHeightPx(log: InternDailyLog, items: InternTrackerItem[]): number {
  const trackerRows = Math.max(1, Math.ceil(items.length / 2));
  const trackerColHeight = trackerRows * 16 + 22;

  let blockLinesHeight = 0;
  for (const def of INTERN_HOURLY_BLOCK_DEFS) {
    const val = (log.hourlyBlocks?.[def.key] || '').trim();
    if (!val) continue;
    const lines = Math.max(1, Math.ceil(val.length / 58));
    blockLinesHeight += lines * 12.5 + 4;
  }
  if (blockLinesHeight === 0) blockLinesHeight = 24;

  const noteText = (log.catatanPembimbing || '').trim();
  const noteHeight = noteText ? Math.max(1, Math.ceil(noteText.length / 62)) * 12 + 18 : 0;

  return Math.max(trackerColHeight, blockLinesHeight + noteHeight) + 18;
}

interface LogPageChunk {
  logs: InternDailyLog[];
  showHeaderMeta: boolean;
  showSignature: boolean;
  usedBudgetPx: number;
}

function paginateInternLogs(
  logs: InternDailyLog[],
  items: InternTrackerItem[]
): LogPageChunk[] {
  const page1TableBudget = Math.max(200, 420 - Math.ceil(items.length / 3) * 26);
  const nextPageTableBudget = 835;
  const signatureNeededPx = 170;

  if (logs.length === 0) {
    return [
      {
        logs: [],
        showHeaderMeta: true,
        showSignature: true,
        usedBudgetPx: 60,
      },
    ];
  }

  const pages: LogPageChunk[] = [];
  let currentLogs: InternDailyLog[] = [];
  let isFirstPage = true;
  let currentBudget = page1TableBudget;
  let usedPx = 0;

  for (const log of logs) {
    const rowH = Math.min(nextPageTableBudget - 20, estimateDailyLogRowHeightPx(log, items));
    if (currentLogs.length > 0 && usedPx + rowH > currentBudget) {
      pages.push({
        logs: currentLogs,
        showHeaderMeta: isFirstPage,
        showSignature: false,
        usedBudgetPx: usedPx,
      });
      isFirstPage = false;
      currentLogs = [log];
      currentBudget = nextPageTableBudget;
      usedPx = rowH;
    } else {
      currentLogs.push(log);
      usedPx += rowH;
    }
  }

  if (currentLogs.length > 0) {
    const fitsSignature = usedPx + signatureNeededPx <= currentBudget;
    pages.push({
      logs: currentLogs,
      showHeaderMeta: isFirstPage,
      showSignature: fitsSignature,
      usedBudgetPx: usedPx,
    });
    if (!fitsSignature) {
      pages.push({
        logs: [],
        showHeaderMeta: false,
        showSignature: true,
        usedBudgetPx: 0,
      });
    }
  }

  return pages;
}

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

  const tpl = mergeTemplateConfig(templateConfig || db.templateConfig, DEFAULT_TEMPLATE_CONFIG);
  const theme = getThemeStyles(tpl.accentTheme);

  const student = useMemo(
    () => db.students.find((s) => s.id === studentId) || db.students[0],
    [db.students, studentId]
  );

  const profile = useMemo(
    () => (db.internProfiles || []).find((p) => p.studentId === student?.id),
    [db.internProfiles, student?.id]
  );

  const studentLogs = useMemo(
    () =>
      (db.internDailyLogs || [])
        .filter((l) => l.studentId === student?.id)
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    [db.internDailyLogs, student?.id]
  );

  const trackerItems = useMemo(() => resolveInternTrackerItems(tpl), [tpl]);
  const stats = useMemo(
    () => computeInternTrackerStats(studentLogs, trackerItems),
    [studentLogs, trackerItems]
  );

  const activePeriod = useMemo(
    () => db.periods.find((p) => p.isActive) || db.periods[db.periods.length - 1],
    [db.periods]
  );

  const pages = useMemo(
    () => paginateInternLogs(studentLogs, trackerItems),
    [studentLogs, trackerItems]
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

      for (let i = 0; i < pageElements.length; i++) {
        setExportProgress(`Membuat PDF (${i + 1}/${pageElements.length})...`);
        const pageEl = pageElements[i];
        await waitForImagesInElement(pageEl);
        const restoreExternalImages = await inlineExternalImagesForPdf(pageEl);

        const scaleContainer = pageEl.closest('.a4-scale-inner') as HTMLElement | null;
        const prevTransform = scaleContainer ? scaleContainer.style.transform : '';
        if (scaleContainer) {
          scaleContainer.style.transform = 'none';
          void pageEl.offsetWidth;
        }

        let pngDataUrl = '';
        try {
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
        pdf.addImage(pngDataUrl, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
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

  return (
    <div className="min-h-screen bg-slate-200/90 pb-12 print:bg-white print:pb-0">
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
                Laporan Magang &amp; Mutabaah Ibadah · {pages.length} Halaman A4
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
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
      <div className="py-5 sm:py-8 px-2 sm:px-4 space-y-6 print:p-0 print:space-y-0">
        {pages.map((chunk, idx) => {
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
                className="a4-page relative w-[210mm] h-[297mm] mx-auto bg-white text-slate-900 flex flex-col justify-between overflow-hidden"
                style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
              >
                {/* Top Header */}
                <div className="px-9 pt-7 pb-3">
                  <div
                    className="flex items-center justify-between gap-4 pb-3 border-b-2"
                    style={{ borderColor: theme.darkPill }}
                  >
                    <div className="flex items-center gap-3">
                      <MdaLogo size="sm" customLogoUrl={tpl.customLogoUrl} />
                      <div>
                        <div
                          className="text-[11px] font-bold uppercase tracking-wide"
                          style={{ color: theme.darkPill }}
                        >
                          {tpl.namaLembaga} · {tpl.namaPesantren}
                        </div>
                        <div className="text-[14px] font-bold text-slate-900 mt-0.5">
                          LAPORAN KEGIATAN MAGANG &amp; MUTABAAH IBADAH SANTRI
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-[10px] text-slate-600 shrink-0">
                      <div className="font-bold text-slate-900">{student.nama}</div>
                      <div>
                        {student.nisnMda} · {student.kelas}
                      </div>
                      <div className="text-slate-500">
                        Hal. {pageNum} dari {totalPages}
                      </div>
                    </div>
                  </div>

                  {/* Page 1: Profile & Tracker Summary */}
                  {chunk.showHeaderMeta && (
                    <div className="mt-3 space-y-3">
                      {/* Identitas & Profil Magang */}
                      <div className="grid grid-cols-2 gap-3 border border-slate-300 rounded-md p-2.5 bg-slate-50/70 text-[10.5px]">
                        <table className="w-full">
                          <tbody>
                            <tr>
                              <td className="py-0.5 text-slate-500 w-32">Nama Santri</td>
                              <td className="py-0.5 font-bold text-slate-900">: {student.nama}</td>
                            </tr>
                            <tr>
                              <td className="py-0.5 text-slate-500">ID Santri MDA</td>
                              <td className="py-0.5 font-semibold">: {student.nisnMda}</td>
                            </tr>
                            <tr>
                              <td className="py-0.5 text-slate-500">Kelas / Program</td>
                              <td className="py-0.5">: {student.kelas}</td>
                            </tr>
                            <tr>
                              <td className="py-0.5 text-slate-500">Total Hari Log</td>
                              <td className="py-0.5 font-bold tabular-nums">
                                : {stats.totalDays} Hari Tercatat
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        <table className="w-full">
                          <tbody>
                            <tr>
                              <td className="py-0.5 text-slate-500 w-32">Tempat Magang</td>
                              <td className="py-0.5 font-bold text-slate-900">
                                : {profile?.tempatMagang || '-'}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-0.5 text-slate-500">Waktu Magang</td>
                              <td className="py-0.5">: {profile?.waktuMagang || '-'}</td>
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

                      {/* Ringkasan Statistik Tracker Ibadah & Amal */}
                      <div className="border border-slate-300 rounded-md overflow-hidden">
                        <div
                          className="px-3 py-1.5 text-[10.5px] font-bold text-white flex items-center justify-between"
                          style={{ backgroundColor: theme.darkPill }}
                        >
                          <span>RINGKASAN MUTABAAH IBADAH &amp; AMAL HARIAN</span>
                          <span className="tabular-nums">
                            Sholat Berjamaah: {stats.sholatPct}% · Amal &amp; Tilawah:{' '}
                            {stats.otherPct}%
                          </span>
                        </div>
                        <div className="p-2 grid grid-cols-3 gap-1.5 text-[9.5px] bg-white">
                          {stats.itemStats.map((st) => {
                            const labels = getTrackerButtonLabels(st.item.mode);
                            return (
                              <div
                                key={st.item.id}
                                className="border border-slate-200 rounded px-2 py-1 flex items-center justify-between gap-1.5"
                              >
                                <span className="font-semibold text-slate-800 truncate">
                                  {st.item.label}
                                </span>
                                <span className="shrink-0 tabular-nums font-bold">
                                  <span className="text-emerald-700">✓{st.yesCount}</span>{' '}
                                  <span className="text-rose-600">✗{st.noCount}</span>{' '}
                                  <span className="text-slate-500">({st.yesPct}%)</span>
                                  <span className="sr-only">{labels.yesLabel}</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Daily Log Table */}
                  {(chunk.logs.length > 0 || chunk.showHeaderMeta) && (
                    <div className="mt-3">
                      <div className="text-[10.5px] font-bold text-slate-900 mb-1.5 uppercase tracking-wide">
                        {chunk.showHeaderMeta
                          ? 'RINCIAN JURNAL HARIAN MAGANG & TRACKER IBADAH (5 BLOK JAM)'
                          : 'LANJUTAN RINCIAN JURNAL HARIAN MAGANG'}
                      </div>
                      {chunk.logs.length === 0 ? (
                        <div className="border border-dashed border-slate-300 rounded-md p-6 text-center text-[11px] text-slate-500">
                          Belum ada entri jurnal harian magang yang tersimpan untuk santri ini.
                        </div>
                      ) : (
                        <table className="w-full border-collapse text-[9.5px]">
                          <thead>
                            <tr
                              className="text-white text-left"
                              style={{ backgroundColor: theme.darkPill }}
                            >
                              <th className="border border-slate-400 px-2 py-1.5 w-[96px]">
                                Tanggal
                              </th>
                              <th className="border border-slate-400 px-2 py-1.5 w-[210px]">
                                Ringkasan Tracker Ibadah &amp; Amal
                              </th>
                              <th className="border border-slate-400 px-2 py-1.5">
                                Aktivitas Harian (05.00 – 03.00) &amp; Catatan
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {chunk.logs.map((log, rowIdx) => {
                              const yesTotal = trackerItems.filter(
                                (it) => log.trackerResults?.[it.id] === 'yes'
                              ).length;
                              const noTotal = trackerItems.filter(
                                (it) => log.trackerResults?.[it.id] === 'no'
                              ).length;

                              return (
                                <tr
                                  key={log.id}
                                  className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}
                                >
                                  <td className="border border-slate-300 px-2 py-1.5 align-top">
                                    <div className="font-bold text-slate-900">
                                      {formatTanggalShort(log.tanggal)}
                                    </div>
                                    <div className="text-[8.5px] text-slate-500 mt-0.5 leading-tight">
                                      {formatTanggalIndonesia(log.tanggal).split(',')[0]}
                                    </div>
                                    <div className="mt-1 text-[8.5px] font-bold tabular-nums">
                                      <span className="text-emerald-700">✓ {yesTotal}</span> ·{' '}
                                      <span className="text-rose-600">✗ {noTotal}</span>
                                    </div>
                                  </td>
                                  <td className="border border-slate-300 px-2 py-1.5 align-top">
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                                      {trackerItems.map((it) => {
                                        const val = log.trackerResults?.[it.id];
                                        return (
                                          <div
                                            key={it.id}
                                            className="flex items-center justify-between gap-1 text-[8.5px] leading-snug"
                                          >
                                            <span className="truncate text-slate-700">
                                              {it.label}
                                            </span>
                                            <span
                                              className={`font-bold shrink-0 ${
                                                val === 'yes'
                                                  ? 'text-emerald-700'
                                                  : val === 'no'
                                                    ? 'text-rose-600'
                                                    : 'text-slate-400'
                                              }`}
                                            >
                                              {val === 'yes' ? '✓' : val === 'no' ? '✗' : '-'}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </td>
                                  <td className="border border-slate-300 px-2 py-1.5 align-top space-y-1">
                                    {INTERN_HOURLY_BLOCK_DEFS.map((def) => {
                                      const text = (log.hourlyBlocks?.[def.key] || '').trim();
                                      if (!text) return null;
                                      return (
                                        <div key={def.key} className="leading-snug">
                                          <span className="font-bold text-slate-800">
                                            [{def.timeRange}]
                                          </span>{' '}
                                          <span className="text-slate-700">{text}</span>
                                        </div>
                                      );
                                    })}
                                    {(log.catatanPembimbing || '').trim() && (
                                      <div className="mt-1 pt-1 border-t border-slate-200 text-[8.5px] text-emerald-900">
                                        <strong>Catatan Pembimbing:</strong> {log.catatanPembimbing}
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

                  {/* Signature Block on Final Page */}
                  {chunk.showSignature && (
                    <div className="mt-5 pt-3 border-t border-slate-300">
                      <div className="text-right text-[10px] text-slate-700 mb-3">
                        {tpl.kotaTanggal || 'Sukoharjo'},{' '}
                        {new Date().toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-center text-[10px]">
                        <div className="flex flex-col items-center justify-between min-h-[105px]">
                          <div>
                            <div className="text-slate-600">Santri Peserta Magang,</div>
                          </div>
                          <div className="pt-12">
                            <div className="font-bold text-slate-900 underline">{student.nama}</div>
                            <div className="text-[9px] text-slate-500">ID: {student.nisnMda}</div>
                          </div>
                        </div>

                        <div className="flex flex-col items-center justify-between min-h-[105px]">
                          <div>
                            <div className="text-slate-600">Pembimbing Magang / Wali Kelas,</div>
                          </div>
                          <div className="pt-12">
                            <div className="font-bold text-slate-900 underline">
                              {profile?.pembimbingNama ||
                                student.waliKelasNama ||
                                'Pembimbing Magang'}
                            </div>
                            <div className="text-[9px] text-slate-500">Pembimbing Lapangan</div>
                          </div>
                        </div>

                        <div className="flex flex-col items-center justify-between min-h-[105px]">
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
                                className="h-11 object-contain mb-1"
                              />
                            ) : (
                              <div className="h-11" />
                            )}
                            <div className="font-bold text-slate-900 underline">
                              {activePeriod?.kepalaUnitMda || 'Kepala Unit MDA'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Page Footer */}
                <div className="px-9 py-2.5 border-t border-slate-200 flex items-center justify-between text-[9px] text-slate-500 bg-slate-50">
                  <span>
                    {tpl.namaLembaga} · {tpl.namaPesantren}
                  </span>
                  <span>Laporan Jurnaling Magang &amp; Mutabaah Ibadah Harian Santri</span>
                  <span className="font-bold tabular-nums">
                    Hal. {pageNum} / {totalPages}
                  </span>
                </div>
              </section>
            </ScaledA4Page>
          );
        })}
      </div>
    </div>
  );
};
