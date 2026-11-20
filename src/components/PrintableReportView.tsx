import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  Printer,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { DEFAULT_TEMPLATE_CONFIG } from '../data/seedData';
import { BrandingTemplateConfig, MdaDatabase } from '../types/mda';
import {
  formatRupiah,
  getKkmPredicateBounds,
  getPortfolioUrl,
  hitungPredikatByKkm,
  hitungRataRataDigital,
  hitungRataRataDiniyah,
  resolveTanggalRapor,
} from '../utils/grading';
import { getThemeStyles, mergeTemplateConfig } from '../utils/theme';
import { MdaLogo, PortfolioArtwork, StudentAvatar } from './MdaLogo';

const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const ScaledA4Page: React.FC<{
  scale: number;
  pageNumber: number;
  children: React.ReactNode;
}> = ({ scale, pageNumber, children }) => (
  <div className="print:block">
    <div className="no-print text-center mb-1.5 sm:hidden">
      <span className="inline-block px-3 py-0.5 rounded-full bg-white/90 border border-slate-300 text-[11px] font-semibold text-slate-700 tabular-nums">
        Halaman {pageNumber} / 5
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

function normalizePdfLinkUrl(rawUrl: string | undefined | null): string {
  const cleanUrl = (rawUrl || '').replace(/[\r\n\t]+/g, '').trim();
  if (!cleanUrl || cleanUrl.startsWith('#') || /^javascript:/i.test(cleanUrl)) {
    return '';
  }
  if (/^https?:\/\//i.test(cleanUrl)) {
    return cleanUrl;
  }
  if (cleanUrl.startsWith('//')) {
    return `https:${cleanUrl}`;
  }
  if (cleanUrl.startsWith('/') && typeof window !== 'undefined') {
    return new URL(cleanUrl, window.location.origin).toString();
  }
  return `https://${cleanUrl}`;
}

interface PrintableReportViewProps {
  db: MdaDatabase;
  studentId: string;
  selectedYear: string;
  selectedSemester: 'Gasal' | 'Genap';
  templateConfig?: BrandingTemplateConfig;
  onBack: () => void;
}

export const PrintableReportView: React.FC<PrintableReportViewProps> = ({
  db,
  studentId,
  selectedYear,
  selectedSemester,
  templateConfig,
  onBack,
}) => {
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );
  const [zoomMode, setZoomMode] = useState<'fit' | 'actual'>('fit');
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const pageRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
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

  const report = useMemo(
    () =>
      db.reports.find(
        (r) =>
          r.studentId === student?.id &&
          r.tahunAkademik === selectedYear &&
          r.semester === selectedSemester
      ) || db.reports.find((r) => r.studentId === student?.id),
    [db.reports, student, selectedYear, selectedSemester]
  );

  const period = useMemo(
    () =>
      db.periods.find(
        (p) =>
          p.tahunAkademik === (report?.tahunAkademik || selectedYear) &&
          p.semester === (report?.semester || selectedSemester)
      ) || db.periods[0],
    [db.periods, report, selectedYear, selectedSemester]
  );

  const projects = useMemo(
    () => db.portfolios.filter((p) => p.studentId === student?.id),
    [db.portfolios, student]
  );

  const waliTeacher = useMemo(
    () =>
      db.teachers.find(
        (t) =>
          t.id === student?.waliKelasId ||
          t.nama.trim().toLowerCase() === (student?.waliKelasNama || '').trim().toLowerCase()
      ),
    [db.teachers, student]
  );

  if (!student || !report) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-slate-600 mb-4">Data rapor belum tersedia.</p>
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

  const portfolioUrl = normalizePdfLinkUrl(
    getPortfolioUrl(student.portfolioSlug, db.spreadsheetId)
  );
  const kkmDiniyah = period?.kkmDiniyah || 60;
  const kkmTahfidz = period?.kkmTahfidz || 70;
  const kkmDigital = period?.kkmDigital || 70;
  const boundsDigital = getKkmPredicateBounds(kkmDigital);
  const boundsDiniyah = getKkmPredicateBounds(kkmDiniyah);

  const diniyahAvg = hitungRataRataDiniyah(report.diniyah);
  const diniyahPredikat = hitungPredikatByKkm(diniyahAvg, kkmDiniyah);
  const digitalAvg = hitungRataRataDigital(report.skillDigital);
  const digitalPredikat = hitungPredikatByKkm(digitalAvg, kkmDigital);
  const effectiveTanggalRapor = resolveTanggalRapor(
    report.tanggalRapor || period?.tanggalRapor,
    report.semester,
    report.tahunAkademik
  );
  const sidangProject =
    projects.find(
      (p) =>
        p.jenis.toLowerCase().includes('sidang') || p.judul.toLowerCase().includes('sidang')
    ) ||
    projects.find((p) => p.featured) ||
    projects[0];

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

      const pages = pageRefs.current.filter((el): el is HTMLElement => Boolean(el));
      if (pages.length === 0) {
        throw new Error('Halaman rapor tidak ditemukan untuk diekspor.');
      }

      const imgX = 0;
      const imgY = 0;
      const imgWidth = 210;
      const imgHeight = 297;

      for (let i = 0; i < pages.length; i++) {
        setExportProgress(`Membuat PDF (${i + 1}/${pages.length})...`);
        const pageEl = pages[i];
        await waitForImagesInElement(pageEl);

        // Ukur koordinat link pada ukuran A4 murni (1:1 tanpa pengaruh scale/zoom layar HP)
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
        } finally {
          if (scaleContainer) {
            scaleContainer.style.transform = prevTransform;
          }
        }

        const pngDataUrl = await toPng(pageEl, {
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

        if (i > 0) {
          pdf.addPage('a4', 'portrait');
        }

        // 1. Lapisan teks URL asli di bawah gambar agar viewer PDF HP (Android/iOS/Drive/WA) mengenali URL
        for (const linkItem of pageLinks) {
          const primaryRect = linkItem.rects[0];
          const textX = Math.max(0, Math.min(imgWidth - 10, primaryRect.x));
          const textY = Math.max(3, Math.min(imgHeight - 2, primaryRect.y + primaryRect.h * 0.7));
          pdf.setFontSize(8);
          pdf.text(linkItem.cleanUrl, textX, textY);
        }

        // 2. Gambar halaman A4 penuh di atas lapisan teks
        pdf.addImage(pngDataUrl, 'PNG', imgX, imgY, imgWidth, imgHeight, undefined, 'FAST');

        // 3. Anotasi link PDF interaktif dengan area sentuh lebih lebar untuk jari di layar HP
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

      const safeStudent =
        student.nama
          .trim()
          .replace(/[^a-zA-Z0-9\s-]/g, '')
          .replace(/\s+/g, '_') || 'Santri';
      const safePeriod = `${report.semester}_${report.tahunAkademik.replace(/\//g, '-')}`;
      pdf.save(`Rapor-${safeStudent}-${safePeriod}.pdf`);
    } catch (err: any) {
      setExportError(
        err?.message ||
          'Gagal membuat file PDF otomatis. Anda dapat menggunakan tombol "Cetak" lalu pilih Save as PDF.'
      );
    } finally {
      setExportProgress(null);
    }
  };

  const MdaFooter = ({ showMotto = true }: { showMotto?: boolean }) => (
    <div
      className="mt-auto shrink-0 px-8 py-3 flex items-center justify-between gap-4 text-[10px] text-slate-950"
      style={{
        background: theme.footerGradient,
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      <div className="font-semibold max-w-[270px] leading-snug">
        {showMotto ? tpl.pesanPenutupHalaman2 : tpl.pesanPenutupHalaman6}
      </div>
      <div className="text-right leading-snug tabular-nums">
        <div className="font-bold">WhatsApp: {tpl.whatsapp}</div>
        <div className="font-semibold">
          {tpl.instagram} · {tpl.email}
        </div>
        <div>{tpl.alamat}</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-200 py-4 sm:py-6 print-only-wrapper">
      {/* Screen-only Print & PDF Toolbar */}
      <div className="no-print max-w-[210mm] mx-auto mb-4 sm:mb-5 px-3 sm:px-0 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onBack}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-800 text-xs font-semibold hover:bg-slate-50 shadow-xs"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Kembali</span>
            </button>

            {autoScale < 0.98 && (
              <button
                type="button"
                onClick={() => setZoomMode((m) => (m === 'fit' ? 'actual' : 'fit'))}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 shadow-xs"
              >
                {zoomMode === 'fit' ? (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Ukuran 100%</span>
                  </>
                ) : (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>Pas Layar</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => window.print()}
              disabled={Boolean(exportProgress)}
              className="min-h-[44px] w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0E2228] text-white text-xs font-bold hover:bg-slate-800 shadow-sm disabled:opacity-60"
            >
              <Printer className="w-4 h-4 text-[#1DF27A]" />
              <span>Cetak</span>
            </button>

            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={Boolean(exportProgress)}
              className="min-h-[44px] w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-sm disabled:opacity-70"
            >
              {exportProgress ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{exportProgress}</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Simpan / Unduh PDF</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 px-1">
          <span>
            Format Resmi A4 · 5 Halaman (Font Arial Konsisten · Termasuk Sidang Karya &amp; Link Portofolio)
          </span>
          {autoScale < 0.98 && (
            <span className="text-emerald-800 font-medium sm:hidden">
              {zoomMode === 'fit'
                ? 'Ketuk "Ukuran 100%" untuk memperbesar & menggeser tabel.'
                : 'Geser ke samping untuk membaca penuh lebar halaman A4.'}
            </span>
          )}
        </div>

        {exportError && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
            {exportError}
          </div>
        )}
      </div>

      {/* 5 A4 Pages Stack */}
      <div className="w-full overflow-x-auto px-3 sm:px-0 space-y-5 sm:space-y-8 print:space-y-0 print:px-0 print:overflow-visible">
        {/* ================= PAGE 1: COVER ================= */}
        <ScaledA4Page scale={activeScale} pageNumber={1}>
          <section
            ref={(el) => {
              pageRefs.current[0] = el;
            }}
            className="rapor-a4-page rapor-document-arial relative w-[210mm] h-[297mm] overflow-hidden flex flex-col justify-between text-white shrink-0"
            style={{
              background: theme.bannerGradient,
              fontFamily: 'Arial, Helvetica, sans-serif',
            }}
          >
            {tpl.coverPhotoUrl && (
              <img
                src={tpl.coverPhotoUrl}
                alt="Cover MDA"
                referrerPolicy="no-referrer"
                className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-luminosity pointer-events-none"
              />
            )}

            <div className="m-6 flex-1 border-2 border-white/80 rounded-2xl px-10 py-10 flex flex-col justify-between relative z-10 overflow-hidden">
              {/* 1. Top row */}
              <div className="flex items-start justify-between gap-4 shrink-0">
                <div className="inline-flex items-center justify-center bg-white rounded-2xl px-5 py-3 shadow-md shrink-0">
                  <MdaLogo size="md" customLogoUrl={tpl.customLogoUrl} />
                </div>
                <div className="bg-[#1DF27A] text-slate-950 font-bold text-xs px-5 py-2.5 rounded-full tracking-wide shadow-sm tabular-nums whitespace-nowrap">
                  SEMESTER {report.semester.toUpperCase()} {report.tahunAkademik}
                </div>
              </div>

              {/* 2. Cover Title & Tiered Institution Block */}
              <div className="pt-2 shrink-0">
                <h1
                  style={{
                    fontFamily: 'Arial, Helvetica, sans-serif',
                    fontWeight: 700,
                    fontSize: '56px',
                    lineHeight: 1.12,
                    color: '#FFFFFF',
                    textShadow: '0px 4px 10px rgba(0, 0, 0, 0.28)',
                  }}
                >
                  {tpl.judulRapor.trim().toLowerCase() === 'laporan hasil belajar santri' ? (
                    <>
                      Laporan Hasil
                      <br />
                      Belajar Santri
                    </>
                  ) : (
                    tpl.judulRapor.replace(
                      /\w\S*/g,
                      (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
                    )
                  )}
                </h1>

                <div
                  className="mt-3"
                  style={{
                    fontFamily: 'Arial, Helvetica, sans-serif',
                    fontWeight: 700,
                    fontSize: '24px',
                    lineHeight: 1.3,
                    color: 'rgba(255, 255, 255, 0.88)',
                    textShadow: '0px 2px 6px rgba(0, 0, 0, 0.22)',
                  }}
                >
                  <div>{tpl.namaLembaga}</div>
                  <div>{tpl.namaPesantren}</div>
                </div>

                <div
                  className="mt-2 tabular-nums"
                  style={{
                    fontFamily: 'Arial, Helvetica, sans-serif',
                    fontWeight: 400,
                    fontSize: '18px',
                    lineHeight: 1.35,
                    color: '#FFFFFF',
                    textShadow: '0px 1px 4px rgba(0, 0, 0, 0.15)',
                  }}
                >
                  Tahun Akademik {report.tahunAkademik}
                </div>
              </div>

              {/* 3. Stylized MDA Studio Banner */}
              <div className="shrink-0 rounded-2xl bg-slate-950/35 border border-white/25 p-6 space-y-3 backdrop-blur-[2px] shadow-sm">
                <div className="space-y-2">
                  <div className="text-xs font-bold tracking-wider text-emerald-300">
                    PROGRAM TAHFIDZ &amp; TEKNOLOGI DIGITAL
                  </div>
                  <div className="text-sm font-medium text-white/95 leading-relaxed">
                    {tpl.coverTagline}
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 pt-1 text-xs font-semibold text-emerald-200 tabular-nums">
                    <span>ID: {student.nisnMda}</span>
                    <span>·</span>
                    <span>{student.kelas}</span>
                  </div>
                </div>
                <a
                  href={portfolioUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-pdf-link="true"
                  className="pt-3 border-t border-white/15 flex flex-col gap-1 no-underline"
                >
                  <span className="text-[10px] uppercase tracking-wider text-emerald-200 font-bold">
                    Link Portofolio Online Santri:
                  </span>
                  <span className="text-[11px] font-bold text-[#1DF27A] break-all underline decoration-emerald-300/50 leading-snug">
                    {portfolioUrl}
                  </span>
                </a>
              </div>

              {/* 4. Student Name Plaque */}
              <div className="mb-8 shrink-0 mx-auto w-full max-w-[460px] bg-white border-[3px] border-[#00B0FF] rounded-lg py-4 px-6 text-center shadow-lg">
                <div className="font-bold text-[23px] leading-[1.3] text-slate-950 tracking-wide uppercase">
                  {student.nama}
                </div>
              </div>
            </div>

            <div className="relative z-10">
              <MdaFooter showMotto={false} />
            </div>
          </section>
        </ScaledA4Page>

        {/* ================= PAGE 2: PROFIL & RINGKASAN CAPAIAN ================= */}
        <ScaledA4Page scale={activeScale} pageNumber={2}>
          <section
            ref={(el) => {
              pageRefs.current[1] = el;
            }}
            className="rapor-a4-page rapor-document-arial w-[210mm] h-[297mm] flex flex-col justify-between text-slate-900 overflow-hidden shrink-0"
            style={{
              backgroundColor: theme.pageTint,
              fontFamily: 'Arial, Helvetica, sans-serif',
            }}
          >
            <div className="p-8 space-y-5 flex-1">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <MdaLogo size="md" customLogoUrl={tpl.customLogoUrl} />
                <div className="text-right leading-snug">
                  <div className="font-bold text-lg text-slate-900 uppercase">
                    {tpl.judulRapor}
                  </div>
                  <div className="text-xs font-bold text-sky-600 tabular-nums">
                    Semester {report.semester} Tahun Akademik {report.tahunAkademik}
                  </div>
                  <div className="text-[11px] font-semibold text-slate-700">
                    {tpl.namaLembaga} · {tpl.namaPesantren}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Alamat : {tpl.alamat}
                  </div>
                </div>
              </div>

              {/* Banner Title */}
              <div className="bg-[#647D73] text-white text-center font-bold text-base py-2.5 rounded-lg">
                {tpl.subjudulCompetence}
              </div>

              {/* Profile Card (Vertical Stacked Identity Details) */}
              <div className="bg-white/85 border border-[#728C81] rounded-xl p-4 flex items-center gap-5">
                <StudentAvatar
                  name={student.nama}
                  fotoUrl={student.fotoUrl}
                  className="w-24 h-28 text-2xl shrink-0"
                />
                <div className="space-y-1 text-xs leading-snug">
                  <div className="font-bold text-slate-700 tabular-nums">{student.nisnMda}</div>
                  <div className="font-bold text-xl text-slate-950">{student.nama}</div>
                  <div className="font-bold text-slate-900">{student.program}</div>
                  <div className="text-slate-700 tabular-nums">
                    Semester {report.semester} Tahun Akademik {report.tahunAkademik}
                  </div>
                  <div className="pt-0.5 text-slate-700">
                    Wali Kelas: <span className="font-bold">{student.waliKelasNama}</span>
                  </div>
                  <div className="italic text-slate-600 tabular-nums">
                    Tanggal pembagian rapor : {effectiveTanggalRapor}
                  </div>
                </div>
              </div>

              {/* RINGKASAN CAPAIAN */}
              <div>
                <div
                  className="inline-block text-slate-950 font-bold text-xs px-4 py-1.5 rounded-full mb-3"
                  style={{ backgroundColor: theme.sectionSky }}
                >
                  RINGKASAN CAPAIAN
                </div>

                <div className="space-y-2.5">
                  {[
                    ['Penguasaan Multimedia', report.pilar.penguasaanMultimedia],
                    ['Diniyah dan Pembelajaran', report.pilar.diniyahPembelajaran],
                    ["Tahfidzul Qur'an", report.pilar.tahfidzulQuran],
                    ['Kesantrian dan Keasramaan', report.pilar.kesantrianKeasramaan],
                    ['Character Building', report.pilar.characterBuilding],
                  ].map(([label, pct]) => (
                    <div key={label as string} className="flex items-center gap-3">
                      <div className="relative flex-1 h-8 bg-white rounded-full border border-emerald-200 overflow-hidden flex items-center">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: theme.barTrack,
                          }}
                        />
                        <span className="absolute left-4 text-xs font-bold text-slate-900">
                          {label}
                        </span>
                      </div>
                      <div
                        className="w-20 h-8 text-white rounded-full flex items-center justify-center text-xs font-bold tabular-nums shrink-0"
                        style={{ backgroundColor: theme.darkPill }}
                      >
                        {pct}%
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] italic text-slate-600 mt-2">
                  Dasar Perhitungan : Kalkulasi penilaian direktarium selama satu semester.
                </div>
              </div>

              {/* RINGKASAN MDA SEMESTER INI */}
              <div>
                <div
                  className="inline-block text-slate-950 font-bold text-xs px-4 py-1.5 rounded-full mb-3"
                  style={{ backgroundColor: theme.sectionSky }}
                >
                  RINGKASAN MDA SEMESTER INI
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[
                    ['Character Building', String(report.kpiMda.characterBuildingCount)],
                    ['Multimedia Project', String(report.kpiMda.multimediaProjectCount)],
                    ['Client Project', String(report.kpiMda.clientProjectCount)],
                    ['MDA Mengajar', String(report.kpiMda.mdaMengajarCount)],
                    ['Income', formatRupiah(report.kpiMda.incomeRp)],
                    ['Produksi Konten', String(report.kpiMda.produksiKontenCount)],
                  ].map(([title, val]) => (
                    <div
                      key={title}
                      className="bg-white border border-slate-200 rounded-xl p-2.5 flex flex-col justify-between gap-2"
                    >
                      <div className="text-xs font-semibold text-slate-800 text-center">
                        {title}
                      </div>
                      <div className="bg-[#1DF27A] text-slate-950 font-bold text-xs py-1 px-2 rounded-full text-center tabular-nums">
                        {val}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pesan Wali Kelas */}
              <div className="bg-white/75 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-center text-slate-800">
                <span className="font-bold">Pesan wali kelas:</span>{' '}
                <span className="italic">{report.catatanWali.pesanSingkat}</span>
              </div>
            </div>

            <MdaFooter showMotto />
          </section>
        </ScaledA4Page>

        {/* ================= PAGE 3: SIKAP, CHARACTER BUILDING, TAHFIDZ ================= */}
        <ScaledA4Page scale={activeScale} pageNumber={3}>
          <section
            ref={(el) => {
              pageRefs.current[2] = el;
            }}
            className="rapor-a4-page rapor-document-arial w-[210mm] h-[297mm] p-8 flex flex-col justify-between text-slate-900 overflow-hidden shrink-0"
            style={{
              backgroundColor: theme.pageTint,
              fontFamily: 'Arial, Helvetica, sans-serif',
            }}
          >
            <div className="space-y-4">
              {/* Sub-header */}
              <div className="flex items-start justify-between gap-4">
                <MdaLogo size="sm" customLogoUrl={tpl.customLogoUrl} />
                <div className="text-right leading-snug">
                  <div className="font-bold text-base text-slate-900 uppercase">
                    {tpl.judulRapor}
                  </div>
                  <div className="text-xs font-bold text-sky-600 tabular-nums">
                    Semester {report.semester} Tahun Akademik {report.tahunAkademik}
                  </div>
                  <div className="text-[11px] text-slate-700">
                    Nama Santri: {student.nama} · Kelas: {student.kelas}
                  </div>
                </div>
              </div>

              {/* A. SIKAP DAN KARAKTER */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div
                    className="text-slate-950 font-bold text-xs px-4 py-1.5 rounded-full"
                    style={{ backgroundColor: theme.sectionSky }}
                  >
                    A. SIKAP DAN KARAKTER
                  </div>
                  <div className="text-[10px] text-slate-600">
                    Predikat: A = Sangat Baik · B = Baik · C = Cukup · D = Perlu Bimbingan
                  </div>
                </div>

                <table className="w-full border-collapse text-[11px] bg-white">
                  <thead>
                    <tr className="bg-[#5E746C] text-white">
                      <th className="border border-slate-400 py-1.5 px-2.5 text-left w-[34%]">
                        Aspek
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2 text-center w-[12%]">
                        Predikat
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2.5 text-left">
                        Deskripsi Singkat
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sikap.map((s) => (
                      <tr key={s.aspek}>
                        <td className="border border-slate-300 py-1.5 px-2.5 font-normal text-slate-900">
                          {s.aspek}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center font-bold tabular-nums">
                          {s.predikat}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2.5 text-slate-700">
                          {s.deskripsi}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* CHARACTER BUILDING PROGRAM */}
              <div>
                <div
                  className="inline-block text-slate-950 font-bold text-xs px-4 py-1.5 rounded-full mb-2"
                  style={{ backgroundColor: theme.sectionSky }}
                >
                  CHARACTER BUILDING PROGRAM
                </div>

                <table className="w-full border-collapse text-[11px] bg-white">
                  <thead>
                    <tr className="bg-[#5E746C] text-white">
                      <th className="border border-slate-400 py-1.5 px-2.5 text-left w-[24%]">
                        Kegiatan
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2.5 text-left w-[26%]">
                        Keterangan
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2.5 text-left w-[24%]">
                        Kegiatan
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2.5 text-left w-[26%]">
                        Keterangan
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1, 2, 3].map((rowIdx) => {
                      const left = report.characterPrograms[rowIdx];
                      const right = report.characterPrograms[rowIdx + 4];
                      return (
                        <tr key={rowIdx}>
                          <td className="border border-slate-300 py-1.5 px-2.5 font-bold text-slate-950">
                            {left?.kegiatan || ''}
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2.5 text-slate-800">
                            {left?.keterangan || ''}
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2.5 font-bold text-slate-950">
                            {right?.kegiatan || ''}
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2.5 text-slate-800">
                            {right?.keterangan || ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* B. TAHFIDZ AL-QUR'AN */}
              <div>
                <div
                  className="inline-block text-slate-950 font-bold text-xs px-4 py-1.5 rounded-full mb-2"
                  style={{ backgroundColor: theme.sectionSky }}
                >
                  B. TAHFIDZ AL-QUR&apos;AN
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <table className="w-full border-collapse text-[11px] bg-white">
                    <thead>
                      <tr className="bg-[#5E746C] text-white">
                        <th className="border border-slate-400 py-1.5 px-2.5 text-left w-[56%]">
                          Capaian Hafalan
                        </th>
                        <th className="border border-slate-400 py-1.5 px-2.5 text-center w-[44%]">
                          Isian
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['Total Hafalan', report.tahfidz.totalHafalan],
                        ['Capaian hafalan semester ini', report.tahfidz.capaianSemesterIni],
                        ['Total Juziyah', report.tahfidz.totalJuziyah],
                        ['Total Setoran Ziyadah', report.tahfidz.totalSetoranZiyadah],
                        ['Total Murojaah', report.tahfidz.totalMurojaah],
                      ].map(([lbl, val]) => (
                        <tr key={lbl}>
                          <td className="border border-slate-300 py-1.5 px-2.5 font-normal text-slate-800">
                            {lbl}
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2.5 text-center font-bold text-slate-950 tabular-nums">
                            {val || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <table className="w-full border-collapse text-[11px] bg-white">
                    <thead>
                      <tr className="bg-[#5E746C] text-white">
                        <th className="border border-slate-400 py-1.5 px-2.5 text-left">
                          Aspek Penilaian
                        </th>
                        <th className="border border-slate-400 py-1.5 px-2 text-center w-[18%]">
                          Nilai
                        </th>
                        <th className="border border-slate-400 py-1.5 px-2 text-center w-[22%]">
                          Predikat
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['Kelancaran hafalan', report.tahfidz.kelancaran],
                        ['Tajwid', report.tahfidz.tajwid],
                        ['Makhraj dan fashahah', report.tahfidz.makhrajFashahah],
                        ['Ketepatan ayat', report.tahfidz.ketepatanAyat],
                      ].map(([lbl, val]) => (
                        <tr key={lbl as string}>
                          <td className="border border-slate-300 py-1.5 px-2.5 font-normal text-slate-800">
                            {lbl}
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2 text-center font-bold tabular-nums">
                            {val}
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2 text-center font-bold tabular-nums">
                            {hitungPredikatByKkm(Number(val), kkmTahfidz)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-emerald-50 font-bold">
                        <td className="border border-slate-300 py-1.5 px-2.5">
                          Nilai akhir tahfidz
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center tabular-nums">
                          {report.tahfidz.nilaiAkhir}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center tabular-nums">
                          {report.tahfidz.predikat}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="mt-2 bg-white border border-slate-300 rounded-lg p-2.5 text-[11px] leading-snug">
                  <span className="font-bold">Deskripsi capaian tahfidz:</span>{' '}
                  <span className="text-slate-700">{report.tahfidz.deskripsi}</span>
                </div>
              </div>
            </div>

            {/* KETERANGAN PENILAIAN */}
            <div className="space-y-2">
              <div
                className="inline-block text-slate-950 font-bold text-xs px-4 py-1 rounded-full"
                style={{ backgroundColor: theme.sectionSky }}
              >
                KETERANGAN PENILAIAN
              </div>
              <table className="w-full border-collapse text-[10.5px] bg-white text-center">
                <thead>
                  <tr className="bg-slate-950 text-white">
                    <th className="border border-slate-700 py-1 px-2 text-left">Predikat</th>
                    <th className="border border-slate-700 py-1 px-2">A</th>
                    <th className="border border-slate-700 py-1 px-2">B</th>
                    <th className="border border-slate-700 py-1 px-2">C</th>
                    <th className="border border-slate-700 py-1 px-2">D</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-300 py-1 px-2 text-left font-semibold">
                      Tahfidz &amp; Digital (KKM {boundsDigital.kkm})
                    </td>
                    <td className="border border-slate-300 py-1 px-2 tabular-nums">
                      {boundsDigital.minA}–100
                    </td>
                    <td className="border border-slate-300 py-1 px-2 tabular-nums">
                      {boundsDigital.minB}–{boundsDigital.minA - 1}
                    </td>
                    <td className="border border-slate-300 py-1 px-2 tabular-nums">
                      {boundsDigital.minC}–{boundsDigital.minB - 1}
                    </td>
                    <td className="border border-slate-300 py-1 px-2 tabular-nums">
                      &lt; {boundsDigital.minC}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-300 py-1 px-2 text-left font-semibold">
                      Diniyah (KKM {boundsDiniyah.kkm})
                    </td>
                    <td className="border border-slate-300 py-1 px-2 tabular-nums">
                      {boundsDiniyah.minA}–100
                    </td>
                    <td className="border border-slate-300 py-1 px-2 tabular-nums">
                      {boundsDiniyah.minB}–{boundsDiniyah.minA - 1}
                    </td>
                    <td className="border border-slate-300 py-1 px-2 tabular-nums">
                      {boundsDiniyah.minC}–{boundsDiniyah.minB - 1}
                    </td>
                    <td className="border border-slate-300 py-1 px-2 tabular-nums">
                      &lt; {boundsDiniyah.minC}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-300 py-1 px-2 text-left font-semibold">
                      Kategori
                    </td>
                    <td className="border border-slate-300 py-1 px-2">Sangat Baik</td>
                    <td className="border border-slate-300 py-1 px-2">Baik</td>
                    <td className="border border-slate-300 py-1 px-2">Cukup</td>
                    <td className="border border-slate-300 py-1 px-2">Perlu Bimbingan</td>
                  </tr>
                </tbody>
              </table>
              <div className="text-[11px] text-slate-700 tabular-nums">
                <span className="font-bold">KKM (Kriteria Ketuntasan Minimal):</span> Diniyah{' '}
                <span className="font-bold">{kkmDiniyah}</span> · Tahfidz{' '}
                <span className="font-bold">{kkmTahfidz}</span> · Skill Digital{' '}
                <span className="font-bold">{kkmDigital}</span>
              </div>
            </div>
          </section>
        </ScaledA4Page>

        {/* ================= PAGE 4: DINIYAH, SKILL DIGITAL, KEHADIRAN, TTD ================= */}
        <ScaledA4Page scale={activeScale} pageNumber={4}>
          <section
            ref={(el) => {
              pageRefs.current[3] = el;
            }}
            className="rapor-a4-page rapor-document-arial w-[210mm] h-[297mm] p-8 flex flex-col justify-between text-slate-900 overflow-hidden shrink-0"
            style={{
              backgroundColor: theme.pageTint,
              fontFamily: 'Arial, Helvetica, sans-serif',
            }}
          >
            <div className="space-y-4">
              {/* Sub-header */}
              <div className="flex items-start justify-between gap-4">
                <MdaLogo size="sm" customLogoUrl={tpl.customLogoUrl} />
                <div className="text-right leading-snug">
                  <div className="font-bold text-base text-slate-900 uppercase">
                    {tpl.judulRapor}
                  </div>
                  <div className="text-xs font-bold text-sky-600 tabular-nums">
                    Semester {report.semester} Tahun Akademik {report.tahunAkademik}
                  </div>
                  <div className="text-[11px] text-slate-700">
                    Nama Santri: {student.nama} · Kelas: {student.kelas}
                  </div>
                </div>
              </div>

              {/* C. MATA PELAJARAN DINIYAH */}
              <div>
                <div
                  className="inline-block text-slate-950 font-bold text-xs px-4 py-1.5 rounded-full mb-2"
                  style={{ backgroundColor: theme.sectionSky }}
                >
                  C. MATA PELAJARAN DINIYAH
                </div>
                <table className="w-full border-collapse text-[11px] bg-white">
                  <thead>
                    <tr className="bg-[#5E746C] text-white">
                      <th className="border border-slate-400 py-1.5 px-2 text-center w-[6%]">
                        No
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2.5 text-left w-[18%]">
                        Mata Pelajaran
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2.5 text-left w-[20%]">
                        Kitab / Materi
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2 text-center w-[9%]">
                        KKM
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2 text-center w-[9%]">
                        Nilai
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2.5 text-left w-[38%]">
                        Deskripsi Capaian
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.diniyah.map((d) => (
                      <tr key={d.no}>
                        <td className="border border-slate-300 py-1.5 px-2 text-center tabular-nums">
                          {d.no}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2.5 font-semibold">
                          {d.mataPelajaran}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2.5">
                          {d.kitabMateri}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center tabular-nums">
                          {d.kkm}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center font-bold tabular-nums">
                          {d.nilai}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2.5 text-slate-700">
                          {d.deskripsi}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-emerald-50 font-bold">
                      <td className="border border-slate-300 py-1.5 px-2" />
                      <td
                        colSpan={3}
                        className="border border-slate-300 py-1.5 px-2.5 text-center"
                      >
                        Rata-rata Nilai Diniyah
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center tabular-nums">
                        {diniyahAvg}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2.5 tabular-nums">
                        Predikat: {diniyahPredikat}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* D. SKILL DIGITAL */}
              <div>
                <div
                  className="inline-block text-slate-950 font-bold text-xs px-4 py-1.5 rounded-full mb-2"
                  style={{ backgroundColor: theme.sectionSky }}
                >
                  D. SKILL DIGITAL
                </div>
                <table className="w-full border-collapse text-[11px] bg-white">
                  <thead>
                    <tr className="bg-[#5E746C] text-white">
                      <th className="border border-slate-400 py-1.5 px-2 text-center w-[6%]">
                        No
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2.5 text-left w-[30%]">
                        Materi Skill
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2 text-center w-[10%]">
                        KKM
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2 text-center w-[14%]">
                        Pengetahuan
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2 text-center w-[14%]">
                        Keterampilan
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2 text-center w-[14%]">
                        Nilai Akhir
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2 text-center w-[12%]">
                        Predikat
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.skillDigital.map((s) => (
                      <tr key={s.no}>
                        <td className="border border-slate-300 py-1.5 px-2 text-center tabular-nums">
                          {s.no}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2.5 font-semibold">
                          {s.materiSkill}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center tabular-nums">
                          {s.kkm}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center tabular-nums">
                          {s.pengetahuan || '—'}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center tabular-nums">
                          {s.keterampilan || '—'}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center font-bold tabular-nums">
                          {s.nilaiAkhir || '—'}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center font-bold tabular-nums">
                          {s.nilaiAkhir ? s.predikat : '—'}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-emerald-50 font-bold">
                      <td className="border border-slate-300 py-1.5 px-2" />
                      <td
                        colSpan={4}
                        className="border border-slate-300 py-1.5 px-2.5 text-center"
                      >
                        Rata-rata Skill Digital
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center tabular-nums">
                        {digitalAvg}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center tabular-nums">
                        {digitalPredikat}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* E. KEHADIRAN & F. CATATAN WALI KELAS */}
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">
                  <div
                    className="inline-block text-slate-950 font-bold text-xs px-3 py-1 rounded-full mb-2"
                    style={{ backgroundColor: theme.sectionSky }}
                  >
                    E. KEHADIRAN
                  </div>
                  <table className="w-full border-collapse text-[11px] bg-white">
                    <thead>
                      <tr className="bg-[#5E746C] text-white">
                        <th className="border border-slate-400 py-1 px-2 text-left">
                          Keterangan
                        </th>
                        <th className="border border-slate-400 py-1 px-2 text-center w-14">
                          Hari
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border border-slate-300 py-1.5 px-2 font-normal">
                          Sakit
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center font-bold tabular-nums">
                          {report.kehadiran.sakit}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-slate-300 py-1.5 px-2 font-normal">
                          Izin
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center font-bold tabular-nums">
                          {report.kehadiran.izin}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-slate-300 py-1.5 px-2 font-normal">
                          Alpa (tanpa keterangan)
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center font-bold tabular-nums">
                          {report.kehadiran.alpa}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="col-span-8">
                  <div
                    className="inline-block text-slate-950 font-bold text-xs px-3 py-1 rounded-full mb-2"
                    style={{ backgroundColor: theme.sectionSky }}
                  >
                    F. CATATAN WALI KELAS
                  </div>
                  <div className="bg-white border border-slate-300 rounded-lg p-3 text-[11px] space-y-1.5 leading-snug">
                    <div>
                      <span className="font-bold">Perkembangan:</span>{' '}
                      {report.catatanWali.perkembangan}
                    </div>
                    <div>
                      <span className="font-bold">Kekuatan:</span>{' '}
                      {report.catatanWali.kekuatan}
                    </div>
                    <div>
                      <span className="font-bold">Saran semester depan:</span>{' '}
                      {report.catatanWali.saranSemesterDepan}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Keputusan Semester + Pengesahan */}
            <div className="space-y-3">
              <div className="bg-white/80 border border-[#728C81] rounded-lg px-3 py-2 text-[11px] flex flex-wrap items-center gap-3">
                <span className="font-bold">Keputusan semester:</span>
                {[
                  'Lanjut ke semester genap',
                  'Lanjut dengan bimbingan',
                  'Naik tingkat program',
                ].map((opt) => (
                  <span key={opt} className="inline-flex items-center gap-1">
                    <span className="font-bold tabular-nums">
                      ({report.keputusanSemester === opt ? '✓' : ' '})
                    </span>
                    <span>{opt}</span>
                  </span>
                ))}
              </div>

              <div className="text-right text-[11px] text-slate-800 font-semibold tabular-nums">
                {tpl.kotaTanggal}, {effectiveTanggalRapor}
              </div>

              <table className="w-full border-collapse text-[11px] bg-white text-center">
                <thead>
                  <tr className="bg-slate-950 text-white">
                    <th className="border border-slate-700 py-1.5 px-2 w-1/3">
                      Kepala Unit MDA
                    </th>
                    <th className="border border-slate-700 py-1.5 px-2 w-1/3">Wali Kelas</th>
                    <th className="border border-slate-700 py-1.5 px-2 w-1/3">
                      Mudir / Kepala Pesantren
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-300 py-2 px-2 align-bottom font-semibold">
                      <div className="h-14 flex items-center justify-center mb-1">
                        {period?.ttdKepalaUnitUrl && (
                          <img
                            src={period.ttdKepalaUnitUrl}
                            alt="TTD Kepala Unit MDA"
                            referrerPolicy="no-referrer"
                            className="max-h-14 max-w-[140px] object-contain"
                          />
                        )}
                      </div>
                      <div>({period?.kepalaUnitMda || 'Ustadz Azmuhu Syahid, S. Pd'})</div>
                    </td>
                    <td className="border border-slate-300 py-2 px-2 align-bottom font-semibold">
                      <div className="h-14 flex items-center justify-center mb-1">
                        {waliTeacher?.ttdUrl && (
                          <img
                            src={waliTeacher.ttdUrl}
                            alt="TTD Wali Kelas"
                            referrerPolicy="no-referrer"
                            className="max-h-14 max-w-[140px] object-contain"
                          />
                        )}
                      </div>
                      <div>({student.waliKelasNama})</div>
                    </td>
                    <td className="border border-slate-300 py-2 px-2 align-bottom font-semibold">
                      <div className="h-14 flex items-center justify-center mb-1">
                        {period?.ttdMudirUrl && (
                          <img
                            src={period.ttdMudirUrl}
                            alt="TTD Mudir Pesantren"
                            referrerPolicy="no-referrer"
                            className="max-h-14 max-w-[140px] object-contain"
                          />
                        )}
                      </div>
                      <div>
                        ({period?.mudirPesantren || 'Ustadz Yahya Setiyawan, S. Pd.I, M. Pd'})
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </ScaledA4Page>

        {/* ================= PAGE 5: SIDANG KARYA & LINK PORTOFOLIO ================= */}
        <ScaledA4Page scale={activeScale} pageNumber={5}>
          <section
            ref={(el) => {
              pageRefs.current[4] = el;
            }}
            className="rapor-a4-page rapor-document-arial w-[210mm] h-[297mm] flex flex-col text-slate-900 overflow-hidden shrink-0"
            style={{
              backgroundColor: theme.pageTint,
              fontFamily: 'Arial, Helvetica, sans-serif',
            }}
          >
            <div className="px-8 pt-6 pb-4 flex-1 min-h-0 flex flex-col gap-3.5 overflow-hidden">
              {/* Header Page 5 */}
              <div className="shrink-0 flex items-center justify-between gap-4 border-b border-slate-300/80 pb-3">
                <MdaLogo size="sm" customLogoUrl={tpl.customLogoUrl} />
                <div className="text-right min-w-0 leading-snug">
                  <div className="font-bold text-base text-slate-900 uppercase tracking-tight">
                    {tpl.labelCoverPortfolio}
                  </div>
                  <div className="text-[11px] font-bold text-sky-600 tabular-nums">
                    Semester {report.semester} · Tahun Akademik {report.tahunAkademik}
                  </div>
                  <div className="text-[11px] text-slate-700 truncate">
                    Nama Santri: <span className="font-bold">{student.nama}</span> ({student.kelas})
                  </div>
                </div>
              </div>

              {/* Bagian 1: Tampilan Sidang Karya */}
              <div className="shrink-0 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span
                      className="inline-block text-slate-950 font-bold text-[10px] px-3 py-1 rounded-full tracking-wide uppercase"
                      style={{ backgroundColor: theme.sectionSky }}
                    >
                      Tampilan Sidang Karya &amp; Proyek Unggulan
                    </span>
                    <div className="font-bold text-[18px] text-slate-950 leading-snug mt-1.5">
                      {sidangProject?.judul || 'Dokumentasi Sidang Karya Santri'}
                    </div>
                  </div>
                  <div className="text-right shrink-0 pt-0.5">
                    <span className="inline-block px-3 py-1 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-900 text-[10px] font-bold">
                      {sidangProject?.jenis || 'Sidang Karya'}
                    </span>
                  </div>
                </div>

                {/* Galeri Visual Sidang Karya (1 Panel Utama + 2 Panel Pendukung) */}
                <div className="grid grid-cols-12 gap-3 h-[76mm] overflow-hidden">
                  <div className="col-span-7 h-full min-h-0 flex flex-col border border-emerald-400/80 rounded-xl overflow-hidden bg-white shadow-xs">
                    <div className="flex-1 min-h-0 w-full overflow-hidden">
                      {sidangProject?.mediaItems[0]?.url ? (
                        sidangProject.mediaItems[0].type === 'video' ? (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white p-4 text-center">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#1DF27A] mb-1">
                              Video Sidang Karya
                            </span>
                            <p className="text-xs font-bold line-clamp-2">
                              {sidangProject.mediaItems[0].caption || sidangProject.judul}
                            </p>
                            <p className="text-[9px] text-slate-300 break-all mt-2 max-w-[90%] line-clamp-2">
                              {sidangProject.mediaItems[0].url}
                            </p>
                          </div>
                        ) : (
                          <img
                            src={sidangProject.mediaItems[0].url}
                            alt={sidangProject.mediaItems[0].caption || sidangProject.judul}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        )
                      ) : (
                        <PortfolioArtwork
                          preset={sidangProject?.mediaItems[0]?.presetArt || 'poster'}
                          title={
                            sidangProject?.mediaItems[0]?.caption ||
                            sidangProject?.judul ||
                            'Dokumentasi Sidang Karya'
                          }
                        />
                      )}
                    </div>
                    {sidangProject?.mediaItems[0]?.url && sidangProject?.mediaItems[0]?.caption && (
                      <div className="shrink-0 bg-slate-900 text-white text-[9px] px-2.5 py-1 truncate">
                        {sidangProject.mediaItems[0].caption}
                      </div>
                    )}
                  </div>

                  <div className="col-span-5 h-full min-h-0 grid grid-rows-2 gap-3 overflow-hidden">
                    {[1, 2].map((slotIdx) => {
                      const item = sidangProject?.mediaItems[slotIdx];
                      return (
                        <div
                          key={slotIdx}
                          className="h-full min-h-0 flex flex-col border border-emerald-400/80 rounded-xl overflow-hidden bg-white shadow-xs"
                        >
                          <div className="flex-1 min-h-0 w-full overflow-hidden">
                            {item?.url ? (
                              item.type === 'video' ? (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white p-2 text-center">
                                  <span className="text-[9px] font-bold text-[#1DF27A]">
                                    Video Dokumentasi
                                  </span>
                                  <p className="text-[10px] font-semibold line-clamp-1 mt-0.5">
                                    {item.caption || `Lampiran ${slotIdx + 1}`}
                                  </p>
                                </div>
                              ) : (
                                <img
                                  src={item.url}
                                  alt={item.caption || `Dokumentasi ${slotIdx + 1}`}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              )
                            ) : (
                              <PortfolioArtwork
                                preset={item?.presetArt || (slotIdx === 1 ? 'photo' : 'uiux')}
                                title={item?.caption || `Dokumentasi ${slotIdx + 1}`}
                              />
                            )}
                          </div>
                          {item?.url && item?.caption && (
                            <div className="shrink-0 bg-slate-900 text-white text-[8px] px-2 py-0.5 truncate">
                              {item.caption}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Ringkasan Singkat Sidang Karya */}
                <div className="grid grid-cols-12 gap-3 text-[10px]">
                  <div className="col-span-5 flex flex-col gap-2 min-w-0">
                    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 flex-1">
                      <div className="font-bold text-slate-900 text-[10px] mb-1">
                        Kompetensi Sidang Karya
                      </div>
                      <div className="text-slate-700 leading-snug line-clamp-3">
                        {sidangProject?.competence ||
                          'Presentasi & penguasaan proyek digital santri.'}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                      <span className="font-bold text-slate-900">Tools / Media: </span>
                      <span className="text-emerald-800 font-semibold break-words">
                        {sidangProject?.technology || '—'}
                      </span>
                    </div>
                  </div>
                  <div className="col-span-7 bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 flex flex-col justify-between min-w-0">
                    <div>
                      <div className="font-bold text-slate-900 text-[10px] mb-1">
                        Ringkasan Karya &amp; Catatan Sidang
                      </div>
                      <div className="text-slate-700 leading-relaxed line-clamp-4">
                        {sidangProject?.description ||
                          'Dokumentasi karya dan presentasi sidang santri pada semester berjalan.'}
                      </div>
                    </div>
                    {sidangProject?.externalLink && (() => {
                      const sidangUrl = normalizePdfLinkUrl(sidangProject.externalLink);
                      return sidangUrl ? (
                        <div className="pt-1.5 mt-1.5 border-t border-slate-100 text-[9.5px] font-semibold text-sky-700 break-all">
                          Tautan Karya:{' '}
                          <a
                            href={sidangUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-pdf-link="true"
                            className="underline text-sky-700"
                          >
                            {sidangUrl}
                          </a>
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>
              </div>

              {/* Bagian 2: Daftar Ringkas Portofolio Terhubung */}
              <div className="shrink-0 space-y-2">
                <div className="text-[11px] font-bold text-slate-900 flex items-center justify-between">
                  <span>Daftar Karya &amp; Portofolio Semester Ini</span>
                  <span className="text-[10px] font-normal text-slate-600 tabular-nums">
                    Total {projects.length} karya tercatat
                  </span>
                </div>
                <table className="w-full border-collapse text-[10.5px] bg-white rounded-lg overflow-hidden">
                  <thead>
                    <tr className="bg-slate-950 text-white">
                      <th className="border border-slate-700 py-1.5 px-2 text-center w-[7%]">
                        No
                      </th>
                      <th className="border border-slate-700 py-1.5 px-2.5 text-left w-[33%]">
                        Judul Karya / Sidang
                      </th>
                      <th className="border border-slate-700 py-1.5 px-2.5 text-left w-[24%]">
                        Jenis
                      </th>
                      <th className="border border-slate-700 py-1.5 px-2.5 text-left w-[36%]">
                        Keterangan Singkat
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(projects.length > 0
                      ? projects.slice(0, 5)
                      : [
                          {
                            id: 'empty-1',
                            judul: 'Belum ada karya diinput',
                            jenis: 'Sidang Karya / Portofolio',
                            keteranganSingkat:
                              'Silakan input melalui menu Portofolio & Sidang Karya.',
                            externalLink: '',
                          },
                        ]
                    ).map((p, idx) => {
                      const projectUrl = normalizePdfLinkUrl(p.externalLink);
                      return (
                        <tr key={p.id}>
                          <td className="border border-slate-300 py-1.5 px-2 text-center font-bold tabular-nums align-top">
                            {idx + 1}
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2.5 font-semibold text-slate-900 align-top break-words">
                            {p.judul}
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2.5 text-emerald-800 font-medium align-top break-words">
                            {p.jenis}
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2.5 text-slate-700 align-top break-words">
                            <div>{p.keteranganSingkat || '—'}</div>
                            {projectUrl && (
                              <div className="mt-0.5">
                                <a
                                  href={projectUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  data-pdf-link="true"
                                  className="text-[9px] font-semibold text-sky-700 underline break-all leading-tight"
                                >
                                  {projectUrl}
                                </a>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Bagian 3: Blok Utama Koneksi Link Portofolio Online (Rapat Proporsional Tanpa Gap Menganga) */}
              <div
                className="shrink-0 text-white rounded-2xl p-4 space-y-2 shadow-md"
                style={{ backgroundColor: theme.darkPill }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-block text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white/10 text-[#1DF27A]">
                    Terhubung ke Portofolio Online Santri
                  </div>
                  <a
                    href={portfolioUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-pdf-link="true"
                    className="inline-block bg-[#1DF27A] text-slate-950 font-bold text-[10.5px] px-3.5 py-1.5 rounded-lg"
                  >
                    Buka Portofolio Online ↗
                  </a>
                </div>
                <div>
                  <div className="font-bold text-[16px] text-[#1DF27A] leading-tight">
                    {tpl.qrBannerTitle}
                  </div>
                  <p className="text-[11px] text-slate-200 leading-snug mt-1">
                    {tpl.qrBannerDescription}
                  </p>
                </div>
                <a
                  href={portfolioUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-pdf-link="true"
                  className="block bg-slate-950/60 border border-emerald-400/40 rounded-lg px-3.5 py-2 no-underline"
                >
                  <div className="text-[9.5px] uppercase tracking-wide text-slate-300 font-bold">
                    Link Resmi Portofolio &amp; Sidang Karya:
                  </div>
                  <div className="text-[10.5px] font-bold text-[#1DF27A] break-all underline decoration-emerald-400/50 leading-snug">
                    {portfolioUrl}
                  </div>
                </a>
              </div>
            </div>

            <MdaFooter showMotto={false} />
          </section>
        </ScaledA4Page>
      </div>
    </div>
  );
};
