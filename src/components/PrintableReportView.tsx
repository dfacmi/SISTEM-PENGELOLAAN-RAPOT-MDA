import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Maximize2, Minimize2, Printer } from 'lucide-react';
import { DEFAULT_TEMPLATE_CONFIG } from '../data/seedData';
import { BrandingTemplateConfig, MdaDatabase } from '../types/mda';
import {
  formatRupiah,
  getPortfolioUrl,
  hitungPredikat,
  hitungRataRataDigital,
  hitungRataRataDiniyah,
} from '../utils/grading';
import { getThemeStyles, mergeTemplateConfig } from '../utils/theme';
import { MdaLogo, PortfolioArtwork, StudentAvatar } from './MdaLogo';

const A4_WIDTH_PX = 793.7;
const A4_HEIGHT_PX = 1122.5;

const ScaledA4Page: React.FC<{
  scale: number;
  pageNumber: number;
  children: React.ReactNode;
}> = ({ scale, pageNumber, children }) => (
  <div className="print:block">
    <div className="no-print text-center mb-1.5 sm:hidden">
      <span className="inline-block px-2.5 py-0.5 rounded-full bg-white/80 border border-slate-300 text-[10px] font-mono font-semibold text-slate-600">
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

  const portfolioUrl = getPortfolioUrl(student.portfolioSlug, db.spreadsheetId);
  const diniyahAvg = hitungRataRataDiniyah(report.diniyah);
  const digitalAvg = hitungRataRataDigital(report.skillDigital);
  const digitalPredikat = hitungPredikat(digitalAvg);
  const sidangProject =
    projects.find(
      (p) =>
        p.jenis.toLowerCase().includes('sidang') || p.judul.toLowerCase().includes('sidang')
    ) ||
    projects.find((p) => p.featured) ||
    projects[0];

  const MdaFooter = ({ showMotto = true }: { showMotto?: boolean }) => (
    <div
      className="shrink-0 px-8 py-3 flex items-center justify-between text-[10px] text-slate-950"
      style={{
        background: theme.footerGradient,
      }}
    >
      <div className="font-semibold max-w-[270px] leading-snug">
        {showMotto ? tpl.pesanPenutupHalaman2 : tpl.pesanPenutupHalaman6}
      </div>
      <div className="text-right leading-snug">
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
      {/* Screen-only Print Toolbar */}
      <div className="no-print max-w-[210mm] mx-auto mb-4 sm:mb-5 px-3 sm:px-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-800 text-xs font-semibold hover:bg-slate-50 shadow-xs"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali</span>
          </button>

          {autoScale < 0.98 && (
            <button
              type="button"
              onClick={() => setZoomMode((m) => (m === 'fit' ? 'actual' : 'fit'))}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 shadow-xs"
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

        <div className="flex items-center justify-between sm:justify-end gap-3">
          <span className="text-xs text-slate-700 font-medium hidden sm:inline">
            Format Resmi A4 · 5 Halaman (Termasuk Sidang Karya &amp; Link Portofolio)
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-sm"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak / Simpan sebagai PDF</span>
          </button>
        </div>
      </div>

      {/* 5 A4 Pages Stack */}
      <div className="w-full overflow-x-auto px-3 sm:px-0 space-y-5 sm:space-y-8 print:space-y-0 print:px-0">
        {/* ================= PAGE 1: COVER ================= */}
        <ScaledA4Page scale={activeScale} pageNumber={1}>
        <section
          className="rapor-a4-page relative w-[210mm] h-[297mm] overflow-hidden flex flex-col justify-between text-white shrink-0"
          style={{
            background: theme.bannerGradient,
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

          <div className="m-5 flex-1 border-2 border-white/80 rounded-2xl p-8 flex flex-col justify-between relative z-10 overflow-hidden">
            {/* Top row */}
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center justify-center bg-white rounded-2xl px-5 py-3 shadow-md">
                <MdaLogo size="md" customLogoUrl={tpl.customLogoUrl} />
              </div>
              <div className="bg-[#1DF27A] text-slate-950 font-display font-bold text-xs px-5 py-2.5 rounded-full tracking-wide shadow-sm">
                SEMESTER {report.semester.toUpperCase()} {report.tahunAkademik}
              </div>
            </div>

            {/* Cover Title */}
            <div className="my-auto py-8 space-y-3">
              <h1 className="font-display font-extrabold text-[46px] leading-[1.08] tracking-tight drop-shadow-xs">
                {tpl.judulRapor}
              </h1>
              <div className="text-xl font-semibold text-white/95">
                {tpl.namaLembaga}
              </div>
              <div className="text-base text-white/85 font-medium">
                Tahun Akademik {report.tahunAkademik} · {tpl.namaPesantren}
              </div>

              {/* Stylized MDA Studio Banner */}
              <div className="mt-8 rounded-2xl bg-slate-950/35 border border-white/25 p-5 space-y-3 backdrop-blur-[2px]">
                <div className="space-y-2">
                  <div className="text-xs font-mono text-emerald-300">
                    PROGRAM TAHFIDZ &amp; TEKNOLOGI DIGITAL
                  </div>
                  <div className="text-sm font-medium text-white/90 leading-relaxed">
                    {tpl.coverTagline}
                  </div>
                  <div className="flex flex-wrap gap-3 pt-1 text-xs font-mono text-emerald-200">
                    <span>ID: {student.nisnMda}</span>
                    <span>·</span>
                    <span>{student.kelas}</span>
                  </div>
                </div>
                <div className="pt-2.5 border-t border-white/15 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-200 font-semibold">
                    Link Portofolio Online Santri:
                  </span>
                  <a
                    href={portfolioUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] font-bold text-[#1DF27A] break-all underline decoration-emerald-300/50"
                  >
                    {portfolioUrl}
                  </a>
                </div>
              </div>
            </div>

            {/* Student Name Plaque */}
            <div className="mx-auto w-full max-w-[440px] bg-white border-[3px] border-[#00B0FF] rounded-md py-4 px-6 text-center shadow-lg">
              <div className="font-display font-extrabold text-2xl text-slate-950 tracking-wide uppercase">
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
          className="rapor-a4-page w-[210mm] h-[297mm] flex flex-col justify-between text-slate-900 overflow-hidden shrink-0"
          style={{ backgroundColor: theme.pageTint }}
        >
          <div className="p-8 space-y-5 flex-1">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <MdaLogo size="md" customLogoUrl={tpl.customLogoUrl} />
              <div className="text-right">
                <div className="font-display font-extrabold text-lg text-slate-900 uppercase">
                  {tpl.judulRapor}
                </div>
                <div className="text-xs font-bold text-sky-600">
                  Semester {report.semester} Tahun Akademik {report.tahunAkademik}
                </div>
                <div className="text-[11px] font-semibold text-slate-700">
                  {tpl.namaLembaga} {tpl.namaPesantren}
                </div>
                <div className="text-[10px] text-slate-500">
                  Alamat : {tpl.alamat}
                </div>
              </div>
            </div>

            {/* Banner Title */}
            <div className="bg-[#647D73] text-white text-center font-display font-bold text-base py-2 rounded-lg">
              {tpl.subjudulCompetence}
            </div>

            {/* Profile Card (Vertical Stacked Identity Details) */}
            <div className="bg-white/85 border border-[#728C81] rounded-xl p-4 flex items-center gap-5">
              <StudentAvatar
                name={student.nama}
                fotoUrl={student.fotoUrl}
                className="w-24 h-28 text-2xl shrink-0"
              />
              <div className="space-y-1 text-xs">
                <div className="font-mono font-bold text-slate-700">{student.nisnMda}</div>
                <div className="font-display font-extrabold text-xl text-slate-950">
                  {student.nama}
                </div>
                <div className="font-bold text-slate-900">{student.program}</div>
                <div className="text-slate-700">
                  Semester {report.semester} Tahun Akademik {report.tahunAkademik}
                </div>
                <div className="pt-0.5 text-slate-700">
                  Wali Kelas: <span className="font-semibold">{student.waliKelasNama}</span>
                </div>
                <div className="italic text-slate-600">
                  Tanggal pembagian rapor : {report.tanggalRapor}
                </div>
              </div>
            </div>

            {/* RINGKASAN CAPAIAN */}
            <div>
              <div
                className="inline-block text-slate-950 font-display font-extrabold text-xs px-4 py-1.5 rounded-full mb-3"
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
                      className="w-20 h-8 text-white rounded-full flex items-center justify-center font-mono text-xs font-bold tabular-nums"
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
                className="inline-block text-slate-950 font-display font-extrabold text-xs px-4 py-1.5 rounded-full mb-3"
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
                    <div className="bg-[#1DF27A] text-slate-950 font-mono font-bold text-xs py-1 rounded-full text-center tabular-nums">
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
          className="rapor-a4-page w-[210mm] h-[297mm] p-8 flex flex-col justify-between text-slate-900 overflow-hidden shrink-0"
          style={{ backgroundColor: theme.pageTint }}
        >
          <div className="space-y-4">
            {/* Sub-header */}
            <div className="flex items-start justify-between">
              <MdaLogo size="sm" customLogoUrl={tpl.customLogoUrl} />
              <div className="text-right">
                <div className="font-display font-extrabold text-base text-slate-900 uppercase">
                  {tpl.judulRapor}
                </div>
                <div className="text-xs font-bold text-sky-600">
                  Semester {report.semester} Tahun Akademik {report.tahunAkademik}
                </div>
                <div className="text-[11px] text-slate-700">
                  Nama Santri: {student.nama} · Kelas: {student.kelas}
                </div>
              </div>
            </div>

            {/* A. SIKAP DAN KARAKTER */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div
                  className="text-slate-950 font-display font-extrabold text-xs px-4 py-1.5 rounded-full"
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
                      <td className="border border-slate-300 py-1.5 px-2.5 font-medium">
                        {s.aspek}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono font-bold">
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
                className="inline-block text-slate-950 font-display font-extrabold text-xs px-4 py-1.5 rounded-full mb-2"
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
                        <td className="border border-slate-300 py-1.5 px-2.5">
                          {left?.keterangan || ''}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2.5 font-bold text-slate-950">
                          {right?.kegiatan || ''}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2.5">
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
                className="inline-block text-slate-950 font-display font-extrabold text-xs px-4 py-1.5 rounded-full mb-2"
                style={{ backgroundColor: theme.sectionSky }}
              >
                B. TAHFIDZ AL-QUR&apos;AN
              </div>

              <div className="grid grid-cols-2 gap-3">
                <table className="w-full border-collapse text-[11px] bg-white">
                  <thead>
                    <tr className="bg-[#5E746C] text-white">
                      <th className="border border-slate-400 py-1.5 px-2.5 text-left">
                        Capaian Hafalan
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2.5 text-center">
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
                        <td className="border border-slate-300 py-1.5 px-2.5 font-semibold">
                          {lbl}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2.5 text-center">
                          {val}
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
                      <th className="border border-slate-400 py-1.5 px-2 text-center">
                        Nilai
                      </th>
                      <th className="border border-slate-400 py-1.5 px-2 text-center">
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
                        <td className="border border-slate-300 py-1.5 px-2.5 font-semibold">
                          {lbl}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center font-mono tabular-nums">
                          {val}
                        </td>
                        <td className="border border-slate-300 py-1.5 px-2 text-center font-mono font-bold">
                          {hitungPredikat(Number(val))}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-emerald-50 font-bold">
                      <td className="border border-slate-300 py-1.5 px-2.5">
                        Nilai akhir tahfidz
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono tabular-nums">
                        {report.tahfidz.nilaiAkhir}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                        {report.tahfidz.predikat}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-2 bg-white border border-slate-300 rounded-lg p-2.5 text-[11px]">
                <span className="font-bold">Deskripsi capaian tahfidz:</span>{' '}
                <span className="text-slate-700">{report.tahfidz.deskripsi}</span>
              </div>
            </div>
          </div>

          {/* KETERANGAN PENILAIAN */}
          <div className="space-y-2">
            <div
              className="inline-block text-slate-950 font-display font-extrabold text-xs px-4 py-1 rounded-full"
              style={{ backgroundColor: theme.sectionSky }}
            >
              KETERANGAN PENILAIAN
            </div>
            <table className="w-full border-collapse text-[11px] bg-white text-center">
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
                    Rentang nilai
                  </td>
                  <td className="border border-slate-300 py-1 px-2 font-mono">90–100</td>
                  <td className="border border-slate-300 py-1 px-2 font-mono">80–89</td>
                  <td className="border border-slate-300 py-1 px-2 font-mono">70–79</td>
                  <td className="border border-slate-300 py-1 px-2">di bawah 70</td>
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
            <div className="text-[11px] text-slate-700">
              <span className="font-bold">KKM (Kriteria Ketuntasan Minimal):</span> Diniyah{' '}
              <span className="font-mono font-bold">{period?.kkmDiniyah || 60}</span> · Tahfidz{' '}
              <span className="font-mono font-bold">{period?.kkmTahfidz || 70}</span> · Skill Digital{' '}
              <span className="font-mono font-bold">{period?.kkmDigital || 60}</span>
            </div>
          </div>
        </section>
        </ScaledA4Page>

        {/* ================= PAGE 4: DINIYAH, SKILL DIGITAL, KEHADIRAN, TTD ================= */}
        <ScaledA4Page scale={activeScale} pageNumber={4}>
        <section
          className="rapor-a4-page w-[210mm] h-[297mm] p-8 flex flex-col justify-between text-slate-900 overflow-hidden shrink-0"
          style={{ backgroundColor: theme.pageTint }}
        >
          <div className="space-y-4">
            {/* Sub-header */}
            <div className="flex items-start justify-between">
              <MdaLogo size="sm" customLogoUrl={tpl.customLogoUrl} />
              <div className="text-right">
                <div className="font-display font-extrabold text-base text-slate-900 uppercase">
                  {tpl.judulRapor}
                </div>
                <div className="text-xs font-bold text-sky-600">
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
                className="inline-block text-slate-950 font-display font-extrabold text-xs px-4 py-1.5 rounded-full mb-2"
                style={{ backgroundColor: theme.sectionSky }}
              >
                C. MATA PELAJARAN DINIYAH
              </div>
              <table className="w-full border-collapse text-[11px] bg-white">
                <thead>
                  <tr className="bg-[#5E746C] text-white">
                    <th className="border border-slate-400 py-1.5 px-2 text-center w-8">No</th>
                    <th className="border border-slate-400 py-1.5 px-2.5 text-left">
                      Mata Pelajaran
                    </th>
                    <th className="border border-slate-400 py-1.5 px-2.5 text-left">
                      Kitab / Materi
                    </th>
                    <th className="border border-slate-400 py-1.5 px-2 text-center w-14">
                      KKM
                    </th>
                    <th className="border border-slate-400 py-1.5 px-2 text-center w-14">
                      Nilai
                    </th>
                    <th className="border border-slate-400 py-1.5 px-2.5 text-left">
                      Deskripsi Capaian
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.diniyah.map((d) => (
                    <tr key={d.no}>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                        {d.no}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2.5 font-semibold">
                        {d.mataPelajaran}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2.5">
                        {d.kitabMateri}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                        {d.kkm}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono font-bold">
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
                    <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                      {diniyahAvg}
                    </td>
                    <td className="border border-slate-300 py-1.5 px-2.5 font-mono">
                      Predikat: {hitungPredikat(diniyahAvg)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* D. SKILL DIGITAL */}
            <div>
              <div
                className="inline-block text-slate-950 font-display font-extrabold text-xs px-4 py-1.5 rounded-full mb-2"
                style={{ backgroundColor: theme.sectionSky }}
              >
                D. SKILL DIGITAL
              </div>
              <table className="w-full border-collapse text-[11px] bg-white">
                <thead>
                  <tr className="bg-[#5E746C] text-white">
                    <th className="border border-slate-400 py-1.5 px-2 text-center w-8">No</th>
                    <th className="border border-slate-400 py-1.5 px-2.5 text-left">
                      Materi Skill
                    </th>
                    <th className="border border-slate-400 py-1.5 px-2 text-center w-14">
                      KKM
                    </th>
                    <th className="border border-slate-400 py-1.5 px-2 text-center w-22">
                      Pengetahuan
                    </th>
                    <th className="border border-slate-400 py-1.5 px-2 text-center w-22">
                      Keterampilan
                    </th>
                    <th className="border border-slate-400 py-1.5 px-2 text-center w-20">
                      Nilai Akhir
                    </th>
                    <th className="border border-slate-400 py-1.5 px-2 text-center w-18">
                      Predikat
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.skillDigital.map((s) => (
                    <tr key={s.no}>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                        {s.no}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2.5 font-semibold">
                        {s.materiSkill}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                        {s.kkm}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                        {s.pengetahuan || '—'}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                        {s.keterampilan || '—'}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono font-bold">
                        {s.nilaiAkhir || '—'}
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono font-bold">
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
                    <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                      {digitalAvg}
                    </td>
                    <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
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
                  className="inline-block text-slate-950 font-display font-extrabold text-xs px-3 py-1 rounded-full mb-2"
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
                      <td className="border border-slate-300 py-1.5 px-2 font-semibold">
                        Sakit
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                        {report.kehadiran.sakit}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 py-1.5 px-2 font-semibold">
                        Izin
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                        {report.kehadiran.izin}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 py-1.5 px-2 font-semibold">
                        Alpa (tanpa keterangan)
                      </td>
                      <td className="border border-slate-300 py-1.5 px-2 text-center font-mono">
                        {report.kehadiran.alpa}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="col-span-8">
                <div
                  className="inline-block text-slate-950 font-display font-extrabold text-xs px-3 py-1 rounded-full mb-2"
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
                  <span className="font-mono font-bold">
                    ({report.keputusanSemester === opt ? '✓' : ' '})
                  </span>
                  <span>{opt}</span>
                </span>
              ))}
            </div>

            <div className="text-right text-[11px] text-slate-700 font-medium">
              {tpl.kotaTanggal}, {report.tanggalRapor}
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
                    <div>({period?.mudirPesantren || 'Ustadz Yahya Setiyawan, S. Pd.I, M. Pd'})</div>
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
          className="rapor-a4-page w-[210mm] h-[297mm] flex flex-col justify-between text-slate-900 overflow-hidden shrink-0"
          style={{ backgroundColor: theme.pageTint }}
        >
          <div className="px-8 pt-6 pb-3 flex-1 min-h-0 flex flex-col justify-start gap-3 overflow-hidden">
            {/* Header Page 5 */}
            <div className="shrink-0 flex items-center justify-between gap-4 border-b border-slate-300/70 pb-2.5">
              <MdaLogo size="sm" customLogoUrl={tpl.customLogoUrl} />
              <div className="text-right min-w-0">
                <div className="font-display font-extrabold text-base text-slate-900 uppercase tracking-tight leading-tight">
                  {tpl.labelCoverPortfolio}
                </div>
                <div className="text-[11px] font-bold text-sky-600">
                  Semester {report.semester} · Tahun Akademik {report.tahunAkademik}
                </div>
                <div className="text-[11px] text-slate-700 truncate">
                  Nama Santri: <span className="font-bold">{student.nama}</span> ({student.kelas})
                </div>
              </div>
            </div>

            {/* Bagian 1: Tampilan Sidang Karya */}
            <div className="shrink-0 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span
                    className="inline-block text-slate-950 font-display font-extrabold text-[10px] px-3 py-0.5 rounded-full tracking-wide uppercase"
                    style={{ backgroundColor: theme.sectionSky }}
                  >
                    Tampilan Sidang Karya &amp; Proyek Unggulan
                  </span>
                  <div className="font-display font-extrabold text-[17px] text-slate-950 leading-snug mt-1 line-clamp-1">
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
              <div className="grid grid-cols-12 gap-3 h-[68mm] overflow-hidden">
                <div className="col-span-7 h-full min-h-0 flex flex-col border border-emerald-400/80 rounded-xl overflow-hidden bg-white shadow-xs">
                  <div className="flex-1 min-h-0 w-full overflow-hidden">
                    {sidangProject?.mediaItems[0]?.url ? (
                      sidangProject.mediaItems[0].type === 'video' ? (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white p-4 text-center">
                          <span className="text-[10px] font-mono uppercase tracking-widest text-[#1DF27A] mb-1">
                            Video Sidang Karya
                          </span>
                          <p className="text-xs font-bold line-clamp-2">
                            {sidangProject.mediaItems[0].caption || sidangProject.judul}
                          </p>
                          <p className="text-[9px] font-mono text-slate-300 break-all mt-2 max-w-[90%] line-clamp-2">
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

                <div className="col-span-5 h-full min-h-0 grid grid-rows-2 gap-2.5 overflow-hidden">
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
                                <span className="text-[9px] font-mono text-[#1DF27A]">
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
                <div className="col-span-5 flex flex-col gap-1.5 min-w-0">
                  <div className="bg-white border border-slate-200 rounded-lg px-2.5 py-2">
                    <div className="font-bold text-slate-900 text-[10px] mb-0.5">
                      Kompetensi Sidang Karya
                    </div>
                    <div className="text-slate-700 leading-snug line-clamp-2">
                      {sidangProject?.competence || 'Presentasi & penguasaan proyek digital santri.'}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 truncate">
                    <span className="font-bold text-slate-900">Tools / Media: </span>
                    <span className="font-mono text-emerald-800 font-semibold">
                      {sidangProject?.technology || '—'}
                    </span>
                  </div>
                </div>
                <div className="col-span-7 bg-white border border-slate-200 rounded-lg px-3 py-2 flex flex-col justify-between min-w-0">
                  <div>
                    <div className="font-bold text-slate-900 text-[10px] mb-0.5">
                      Ringkasan Karya &amp; Catatan Sidang
                    </div>
                    <div className="text-slate-700 leading-snug line-clamp-3">
                      {sidangProject?.description ||
                        'Dokumentasi karya dan presentasi sidang santri pada semester berjalan.'}
                    </div>
                  </div>
                  {sidangProject?.externalLink && (
                    <div className="pt-1 mt-1 border-t border-slate-100 text-[9px] font-mono text-sky-700 truncate">
                      Tautan Karya: {sidangProject.externalLink}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Bagian 2: Daftar Ringkas Portofolio Terhubung */}
            <div className="shrink-0 space-y-1.5">
              <div className="text-[11px] font-display font-bold text-slate-900 flex items-center justify-between">
                <span>Daftar Karya &amp; Portofolio Semester Ini</span>
                <span className="text-[10px] font-normal text-slate-500">
                  Total {projects.length} karya tercatat
                </span>
              </div>
              <table className="w-full table-fixed border-collapse text-[10px] bg-white rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-slate-950 text-white">
                    <th className="border border-slate-700 py-1 px-2 text-center w-8">No</th>
                    <th className="border border-slate-700 py-1 px-2 text-left w-[36%]">
                      Judul Karya / Sidang
                    </th>
                    <th className="border border-slate-700 py-1 px-2 text-left w-[24%]">Jenis</th>
                    <th className="border border-slate-700 py-1 px-2 text-left">
                      Keterangan Singkat
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(projects.length > 0
                    ? projects.slice(0, 4)
                    : [
                        {
                          id: 'empty-1',
                          judul: 'Belum ada karya diinput',
                          jenis: 'Sidang Karya / Portofolio',
                          keteranganSingkat: 'Silakan input melalui menu Portofolio & Sidang Karya.',
                        },
                      ]
                  ).map((p, idx) => (
                    <tr key={p.id}>
                      <td className="border border-slate-300 py-1 px-2 text-center font-mono">
                        {idx + 1}
                      </td>
                      <td className="border border-slate-300 py-1 px-2 font-semibold text-slate-900">
                        <div className="truncate">{p.judul}</div>
                      </td>
                      <td className="border border-slate-300 py-1 px-2 text-emerald-800 font-medium">
                        <div className="truncate">{p.jenis}</div>
                      </td>
                      <td className="border border-slate-300 py-1 px-2 text-slate-600">
                        <div className="truncate">{p.keteranganSingkat || '—'}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bagian 3: Blok Utama Koneksi Link Portofolio Online */}
            <div
              className="mt-auto shrink-0 text-white rounded-2xl p-4 space-y-2 shadow-md"
              style={{ backgroundColor: theme.darkPill }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-block text-[9px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-white/10 text-[#1DF27A]">
                  Terhubung ke Portofolio Online Santri
                </div>
                <a
                  href={portfolioUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block bg-[#1DF27A] text-slate-950 font-display font-bold text-[10px] px-3 py-1 rounded-lg"
                >
                  Buka Portofolio Online ↗
                </a>
              </div>
              <div>
                <div className="font-display font-extrabold text-[15px] text-[#1DF27A] leading-tight">
                  {tpl.qrBannerTitle}
                </div>
                <p className="text-[10.5px] text-slate-200 leading-snug mt-0.5 line-clamp-2">
                  {tpl.qrBannerDescription}
                </p>
              </div>
              <div className="bg-slate-950/60 border border-emerald-400/40 rounded-lg px-3 py-1.5">
                <div className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold">
                  Link Resmi Portofolio &amp; Sidang Karya:
                </div>
                <a
                  href={portfolioUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] font-bold text-[#1DF27A] break-all line-clamp-2 underline decoration-emerald-400/50"
                >
                  {portfolioUrl}
                </a>
              </div>
            </div>
          </div>

          <MdaFooter showMotto={false} />
        </section>
        </ScaledA4Page>
      </div>
    </div>
  );
};
