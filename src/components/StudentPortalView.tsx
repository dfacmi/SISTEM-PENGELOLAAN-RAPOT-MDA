import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Camera,
  Check,
  Copy,
  ExternalLink,
  Eye,
  FolderGit2,
  Link2,
  Lock,
  Printer,
  X,
} from 'lucide-react';
import { DEFAULT_TEMPLATE_CONFIG } from '../data/seedData';
import {
  BrandingTemplateConfig,
  MdaDatabase,
  PortfolioMediaItem,
} from '../types/mda';
import {
  formatRupiah,
  getKategoriPredikat,
  getPortfolioUrl,
  hitungRataRataDigital,
  hitungRataRataDiniyah,
} from '../utils/grading';
import { compressImageToDataUrl } from '../utils/imageHelper';
import { getThemeStyles, mergeTemplateConfig } from '../utils/theme';
import {
  RadarFivePillarsChart,
  SemesterProgressChart,
  TrendSeriesPoint,
} from './Charts';
import { MdaLogo, PortfolioArtwork, StudentAvatar } from './MdaLogo';

interface StudentPortalViewProps {
  db: MdaDatabase;
  studentId: string;
  selectedYear: string;
  selectedSemester: 'Gasal' | 'Genap';
  allowStudentSwitch: boolean;
  templateConfig?: BrandingTemplateConfig;
  onSelectStudent: (id: string) => void;
  onUpdateStudentPhoto?: (studentId: string, fotoUrl: string) => void;
  onUploadPhotoToDrive?: (file: File) => Promise<string | null>;
  onOpenPrint: (studentId: string) => void;
  onOpenPortfolio: (studentId: string) => void;
}

export const StudentPortalView: React.FC<StudentPortalViewProps> = ({
  db,
  studentId,
  selectedYear,
  selectedSemester,
  allowStudentSwitch,
  templateConfig,
  onSelectStudent,
  onUpdateStudentPhoto,
  onUploadPhotoToDrive,
  onOpenPrint,
  onOpenPortfolio,
}) => {
  const [copied, setCopied] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<{
    item: PortfolioMediaItem;
    title: string;
    jenis: string;
  } | null>(null);

  const tpl = mergeTemplateConfig(templateConfig || db.templateConfig, DEFAULT_TEMPLATE_CONFIG);
  const theme = getThemeStyles(tpl.accentTheme);

  const student = useMemo(
    () => db.students.find((s) => s.id === studentId) || db.students[0],
    [db.students, studentId]
  );

  const studentReports = useMemo(() => {
    if (!student) return [];
    return db.reports
      .filter((r) => r.studentId === student.id)
      .sort((a, b) => {
        const keyA = `${a.tahunAkademik}-${a.semester === 'Gasal' ? '1' : '2'}`;
        const keyB = `${b.tahunAkademik}-${b.semester === 'Gasal' ? '1' : '2'}`;
        return keyA.localeCompare(keyB);
      });
  }, [db.reports, student]);

  const currentReport = useMemo(() => {
    return (
      studentReports.find(
        (r) => r.tahunAkademik === selectedYear && r.semester === selectedSemester
      ) || studentReports[studentReports.length - 1]
    );
  }, [studentReports, selectedYear, selectedSemester]);

  const previousReport = useMemo(() => {
    if (!currentReport) return undefined;
    const idx = studentReports.findIndex((r) => r.id === currentReport.id);
    return idx > 0 ? studentReports[idx - 1] : undefined;
  }, [studentReports, currentReport]);

  const trendData: TrendSeriesPoint[] = useMemo(() => {
    return studentReports.map((r) => {
      const avg =
        Math.round(
          ((r.pilar.penguasaanMultimedia +
            r.pilar.diniyahPembelajaran +
            r.pilar.tahfidzulQuran +
            r.pilar.characterBuilding) /
            4) *
            10
        ) / 10;
      return {
        label: `${r.semester} ${r.tahunAkademik}`,
        multimedia: r.pilar.penguasaanMultimedia,
        diniyah: r.pilar.diniyahPembelajaran,
        tahfidz: r.pilar.tahfidzulQuran,
        character: r.pilar.characterBuilding,
        rataRata: avg,
      };
    });
  }, [studentReports]);

  const studentProjects = useMemo(
    () => db.portfolios.filter((p) => p.studentId === student?.id),
    [db.portfolios, student]
  );

  if (!student || !currentReport) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
        Laporan hasil belajar untuk santri ini belum tersedia pada semester terpilih.
      </div>
    );
  }

  const portfolioUrl = getPortfolioUrl(student.portfolioSlug, db.spreadsheetId);
  const diniyahAvg = hitungRataRataDiniyah(currentReport.diniyah);
  const digitalAvg = hitungRataRataDigital(currentReport.skillDigital);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(portfolioUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard errors in restricted frames
    }
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpdateStudentPhoto) return;
    setUploadingPhoto(true);
    try {
      let url: string | null = null;
      if (onUploadPhotoToDrive) {
        url = await onUploadPhotoToDrive(file);
      }
      if (!url) {
        url = await compressImageToDataUrl(file, 360, 0.84);
      }
      if (url) {
        onUpdateStudentPhoto(student.id, url);
      }
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-4 sm:space-y-6 pb-4">
      {/* Mobile Quick Section Jump Bar */}
      <div className="sm:hidden -mx-1 px-1 flex items-center gap-1.5 overflow-x-auto pb-1">
        {[
          ['sec-identitas', 'Identitas'],
          ['sec-pilar', '5 Pilar'],
          ['sec-tahfidz', 'Tahfidz & Karakter'],
          ['sec-akademik', 'Diniyah & Skill'],
          ['sec-catatan', 'Catatan Wali'],
          ['sec-karya', `Hasil Karya (${studentProjects.length})`],
        ].map(([targetId, label]) => (
          <button
            key={targetId}
            type="button"
            onClick={() => scrollToSection(targetId)}
            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-emerald-200 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-900 whitespace-nowrap shrink-0 shadow-2xs"
          >
            {label}
          </button>
        ))}
      </div>

      {/* MDA Branded Top Competence Banner & Student Identity Card */}
      <div
        id="sec-identitas"
        className="rounded-2xl overflow-hidden border border-emerald-200 shadow-xs scroll-mt-20"
        style={{ backgroundColor: theme.pageTint }}
      >
        {/* MDA Gradient Strip Header */}
        <div
          className="px-4 sm:px-5 py-3.5 sm:py-4 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
          style={{ background: theme.bannerGradient }}
        >
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center bg-white rounded-xl px-3 py-1.5 sm:px-3.5 sm:py-2 shadow-xs shrink-0">
              <MdaLogo size="sm" customLogoUrl={tpl.customLogoUrl} />
            </div>
            <div className="min-w-0">
              <div className="font-display font-extrabold text-sm sm:text-base leading-tight">
                {tpl.subjudulCompetence}
              </div>
              <div className="text-[11px] sm:text-xs text-emerald-100 truncate">
                {tpl.namaLembaga} · {tpl.namaPesantren}
              </div>
            </div>
          </div>

          {!allowStudentSwitch && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950/35 border border-white/25 text-xs font-semibold text-white self-start sm:self-auto">
              <Lock className="w-3.5 h-3.5 text-[#1DF27A] shrink-0" />
              <span className="truncate">Akses Privat Wali · {student.nama}</span>
            </div>
          )}
        </div>

        {/* Clean Responsive Student Identity Layout */}
        <div className="p-4 sm:p-6 bg-white/90 flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 flex-1 min-w-0">
            {/* Avatar + Direct Photo Upload Button */}
            <div className="flex flex-col items-center gap-2 shrink-0">
              <StudentAvatar
                name={student.nama}
                fotoUrl={student.fotoUrl}
                className="w-24 h-28 sm:w-28 sm:h-32 text-2xl shadow-xs"
              />
              {allowStudentSwitch && onUpdateStudentPhoto && (
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-emerald-200 hover:bg-emerald-50 text-xs font-semibold text-emerald-800 cursor-pointer transition-colors">
                  <Camera className="w-3.5 h-3.5" />
                  <span>{uploadingPhoto ? 'Mengunggah...' : 'Ubah Foto'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarFileChange}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Identity Details Grid */}
            <div className="w-full space-y-3 text-left">
              <div className="text-center sm:text-left">
                <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                  Nama Lengkap Santri
                </div>
                {allowStudentSwitch ? (
                  <select
                    value={student.id}
                    onChange={(e) => onSelectStudent(e.target.value)}
                    className="mt-0.5 font-display font-extrabold text-xl sm:text-2xl text-slate-950 bg-transparent border-b border-dashed border-emerald-400 focus:outline-none focus:border-emerald-600 pr-4 max-w-full"
                  >
                    {db.students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nama}
                      </option>
                    ))}
                  </select>
                ) : (
                  <h1 className="font-display font-extrabold text-xl sm:text-2xl text-slate-950 leading-tight mt-0.5">
                    {student.nama}
                  </h1>
                )}
                <div className="font-mono font-bold text-xs text-emerald-700 mt-1">
                  ID: {student.nisnMda}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                    Program &amp; Kelas
                  </div>
                  <div className="text-xs sm:text-sm font-bold text-slate-800 mt-0.5">
                    {student.program}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                    Semester &amp; Tahun Akademik
                  </div>
                  <div className="text-xs sm:text-sm font-medium text-slate-700 mt-0.5">
                    Semester {currentReport.semester} · TA {currentReport.tahunAkademik}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                    Wali Kelas
                  </div>
                  <div className="text-xs sm:text-sm font-semibold text-slate-800 mt-0.5">
                    {student.waliKelasNama}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                    Tanggal Pembagian Rapor
                  </div>
                  <div className="text-xs sm:text-sm text-slate-700 mt-0.5">
                    {currentReport.tanggalRapor}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                    Keputusan Semester
                  </div>
                  <div className="text-xs sm:text-sm font-bold text-emerald-700 mt-0.5">
                    {currentReport.keputusanSemester}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onOpenPrint(student.id)}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0E2228] text-white hover:bg-slate-800 text-xs font-semibold whitespace-nowrap"
            >
              <Printer className="w-4 h-4 text-[#1DF27A]" />
              <span>Cetak / Ekspor PDF Rapor</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenPortfolio(student.id)}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-200 bg-white text-slate-800 hover:bg-emerald-50 text-xs font-semibold whitespace-nowrap"
            >
              <FolderGit2 className="w-4 h-4 text-emerald-600" />
              <span>Buka Semua Portofolio ({studentProjects.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* MDA 5-Pillar Horizontal Mint Progress Bars (Matching PDF Page 2) */}
      <div
        id="sec-pilar"
        className="border border-emerald-200 rounded-2xl p-4 sm:p-5 space-y-4 scroll-mt-20"
        style={{ backgroundColor: theme.pageTint }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div
              className="inline-block text-slate-950 font-display font-extrabold text-[11px] px-3.5 py-1 rounded-full mb-1.5"
              style={{ backgroundColor: theme.sectionSky }}
            >
              RINGKASAN CAPAIAN 5 PILAR
            </div>
            <h2 className="font-display font-bold text-slate-900 text-base">
              Capaian Kompetensi {student.nama}
            </h2>
          </div>
          <div className="text-[11px] text-slate-600 italic">
            Semester {currentReport.semester} TA {currentReport.tahunAkademik}
          </div>
        </div>

        <div className="space-y-2.5">
          {[
            ['Penguasaan Multimedia', currentReport.pilar.penguasaanMultimedia],
            ['Diniyah dan Pembelajaran', currentReport.pilar.diniyahPembelajaran],
            ["Tahfidzul Qur'an", currentReport.pilar.tahfidzulQuran],
            ['Kesantrian dan Keasramaan', currentReport.pilar.kesantrianKeasramaan],
            ['Character Building', currentReport.pilar.characterBuilding],
          ].map(([label, pct]) => (
            <div key={label as string} className="flex items-center gap-2.5 sm:gap-3">
              <div className="relative flex-1 h-9 bg-white rounded-full border border-emerald-200 overflow-hidden flex items-center">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: theme.barTrack,
                  }}
                />
                <span className="absolute left-3.5 sm:left-4 text-[11px] sm:text-xs font-bold text-slate-900 truncate pr-2">
                  {label}
                </span>
              </div>
              <div
                className="w-14 sm:w-18 h-9 text-white rounded-full flex items-center justify-center font-mono text-xs font-bold tabular-nums shrink-0"
                style={{ backgroundColor: theme.darkPill }}
              >
                {pct}%
              </div>
            </div>
          ))}
        </div>

        {/* 6 MDA KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2">
          {[
            ['Character Building', `${currentReport.kpiMda.characterBuildingCount}`],
            ['Multimedia Project', `${currentReport.kpiMda.multimediaProjectCount}`],
            ['Client Project', `${currentReport.kpiMda.clientProjectCount}`],
            ['MDA Mengajar', `${currentReport.kpiMda.mdaMengajarCount}x`],
            ['Income', formatRupiah(currentReport.kpiMda.incomeRp)],
            ['Produksi Konten', `${currentReport.kpiMda.produksiKontenCount}`],
          ].map(([title, val]) => (
            <div
              key={title}
              className="bg-white border border-emerald-100 rounded-xl p-3 flex flex-col justify-between gap-2 text-center"
            >
              <div className="text-[11px] font-semibold text-slate-700">{title}</div>
              <div className="bg-[#1DF27A] text-slate-950 font-mono font-bold text-xs py-1 px-2 rounded-full tabular-nums truncate">
                {val}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5 Pillars Radar + Multi-Semester Growth Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5">
          <h2 className="font-display font-bold text-slate-900 text-base">
            Grafik Radar 5 Pilar
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            Perbandingan kompetensi semester aktif vs sebelumnya
          </p>
          <RadarFivePillarsChart
            current={currentReport.pilar}
            previous={previousReport?.pilar}
            currentLabel={`${currentReport.semester} ${currentReport.tahunAkademik}`}
            previousLabel={
              previousReport
                ? `${previousReport.semester} ${previousReport.tahunAkademik}`
                : undefined
            }
          />
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <h2 className="font-display font-bold text-slate-900 text-base">
              {tpl.portalTrendTitle}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              {tpl.portalTrendSubtitle}
            </p>
            <SemesterProgressChart data={trendData} />
          </div>
        </div>
      </div>

      {/* Tahfidz + Sikap & Character Building */}
      <div id="sec-tahfidz" className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 scroll-mt-20">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-slate-900 text-base inline-flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-emerald-600" />
              <span>Tahfidz Al-Qur’an</span>
            </h2>
            <span className="font-mono text-xs font-bold text-emerald-700 tabular-nums">
              {currentReport.tahfidz.nilaiAkhir} ({currentReport.tahfidz.predikat})
            </span>
          </div>

          <div className="divide-y divide-slate-100 text-xs">
            {[
              ['Total Hafalan', currentReport.tahfidz.totalHafalan],
              ['Capaian Semester Ini', currentReport.tahfidz.capaianSemesterIni],
              ['Total Juziyah', currentReport.tahfidz.totalJuziyah],
              ['Setoran Ziyadah', currentReport.tahfidz.totalSetoranZiyadah],
              ['Total Murojaah', currentReport.tahfidz.totalMurojaah],
            ].map(([lbl, val]) => (
              <div key={lbl} className="py-2 flex items-center justify-between gap-2">
                <span className="text-slate-500">{lbl}</span>
                <span className="font-semibold text-slate-900 text-right">{val || '—'}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            {[
              ['Kelancaran', currentReport.tahfidz.kelancaran],
              ['Tajwid', currentReport.tahfidz.tajwid],
              ['Makhraj', currentReport.tahfidz.makhrajFashahah],
              ['Ketepatan Ayat', currentReport.tahfidz.ketepatanAyat],
            ].map(([lbl, score]) => (
              <div
                key={lbl as string}
                className="p-2.5 rounded-lg bg-[#E8FAF3] border border-emerald-100 flex items-center justify-between text-xs"
              >
                <span className="text-slate-700">{lbl}</span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {score}
                </span>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-700 leading-relaxed bg-emerald-50/70 border border-emerald-100 rounded-xl p-3">
            {currentReport.tahfidz.deskripsi}
          </p>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <h2 className="font-display font-bold text-slate-900 text-base">
            Sikap, Karakter &amp; Program Character Building
          </h2>

          {/* Mobile Stacked Attitude Cards */}
          <div className="space-y-2.5 md:hidden">
            {currentReport.sikap.map((s) => (
              <div
                key={s.aspek}
                className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{s.aspek}</span>
                  <span className="font-mono font-bold text-emerald-700 shrink-0">
                    {s.predikat} · {getKategoriPredikat(s.predikat)}
                  </span>
                </div>
                <p className="text-slate-600 leading-relaxed">{s.deskripsi}</p>
              </div>
            ))}
          </div>

          {/* Desktop Attitude Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-white" style={{ backgroundColor: theme.darkPill }}>
                  <th className="py-2 px-3">Aspek Sikap</th>
                  <th className="py-2 px-3 w-32">Predikat</th>
                  <th className="py-2 px-3">Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentReport.sikap.map((s) => (
                  <tr key={s.aspek}>
                    <td className="py-2 px-3 font-medium text-slate-800">{s.aspek}</td>
                    <td className="py-2 px-3 font-mono font-bold text-emerald-700">
                      {s.predikat} · {getKategoriPredikat(s.predikat)}
                    </td>
                    <td className="py-2 px-3 text-slate-600">{s.deskripsi}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2.5 pt-2 border-t border-slate-100">
            <h3 className="font-display font-bold text-sm sm:text-base text-slate-950">
              Program Character Building
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {currentReport.characterPrograms.map((c) => (
                <div
                  key={c.kegiatan}
                  className="p-3 rounded-xl bg-[#E8FAF3] border border-emerald-200/80 text-xs"
                >
                  <div className="font-bold text-slate-950 leading-snug">{c.kegiatan}</div>
                  <div className="text-slate-700 mt-1 leading-relaxed">
                    {c.keterangan || '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Diniyah & Skill Digital (Responsive Mobile Cards + Desktop Tables) */}
      <div id="sec-akademik" className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 scroll-mt-20">
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display font-bold text-slate-900 text-sm">
              Mata Pelajaran Diniyah
            </h3>
            <span className="font-mono text-xs font-bold text-emerald-700 tabular-nums">
              Rata-rata: {diniyahAvg}
            </span>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {currentReport.diniyah.map((d) => (
              <div key={d.no} className="p-4 space-y-1.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900">{d.mataPelajaran}</div>
                    <div className="text-slate-500">{d.kitabMateri}</div>
                  </div>
                  <div className="text-right font-mono shrink-0">
                    <div className="font-bold text-sm text-slate-900 tabular-nums">
                      {d.nilai} ({d.predikat})
                    </div>
                    <div className="text-[11px] text-emerald-700 font-sans font-semibold">
                      KKM {d.kkm} · {d.nilai >= d.kkm ? 'Tuntas' : 'Bimbingan'}
                    </div>
                  </div>
                </div>
                {d.deskripsi && <p className="text-slate-600">{d.deskripsi}</p>}
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <table className="hidden md:table w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-white" style={{ backgroundColor: theme.darkPill }}>
                <th className="py-2 px-3">Mapel &amp; Kitab</th>
                <th className="py-2 px-3 text-right">KKM</th>
                <th className="py-2 px-3 text-right">Nilai</th>
                <th className="py-2 px-3">Predikat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentReport.diniyah.map((d) => (
                <tr key={d.no}>
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-slate-900">{d.mataPelajaran}</div>
                    <div className="text-slate-500">{d.kitabMateri}</div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {d.kkm}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                    {d.nilai}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-emerald-700">
                    {d.predikat} · {d.nilai >= d.kkm ? 'Tuntas' : 'Perlu Bimbingan'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display font-bold text-slate-900 text-sm">
              Kompetensi Skill Digital
            </h3>
            <span className="font-mono text-xs font-bold text-emerald-700 tabular-nums">
              Rata-rata: {digitalAvg}
            </span>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {currentReport.skillDigital
              .filter((s) => s.nilaiAkhir > 0)
              .map((s) => (
                <div key={s.no} className="p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">{s.materiSkill}</span>
                    <span className="font-mono font-bold text-emerald-700 tabular-nums">
                      {s.nilaiAkhir} ({s.predikat})
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg">
                    <div>
                      Pengetahuan:{' '}
                      <strong className="font-mono text-slate-900">{s.pengetahuan}</strong>
                    </div>
                    <div>
                      Keterampilan:{' '}
                      <strong className="font-mono text-slate-900">{s.keterampilan}</strong>
                    </div>
                  </div>
                </div>
              ))}
          </div>

          {/* Desktop Table */}
          <table className="hidden md:table w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-white" style={{ backgroundColor: theme.darkPill }}>
                <th className="py-2 px-3">Materi Skill</th>
                <th className="py-2 px-3 text-right">Pengetahuan</th>
                <th className="py-2 px-3 text-right">Keterampilan</th>
                <th className="py-2 px-3 text-right">Akhir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentReport.skillDigital
                .filter((s) => s.nilaiAkhir > 0)
                .map((s) => (
                  <tr key={s.no}>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      {s.materiSkill}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {s.pengetahuan}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {s.keterampilan}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 tabular-nums">
                      {s.nilaiAkhir} ({s.predikat})
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Catatan Wali Kelas + Integrated QR Code Portfolio */}
      <div id="sec-catatan" className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 scroll-mt-20">
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3 text-xs sm:text-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <h3 className="font-display font-bold text-slate-900 text-base">
              Catatan Wali Kelas &amp; Kehadiran
            </h3>
            <div className="font-mono text-slate-600 tabular-nums">
              Sakit: {currentReport.kehadiran.sakit} hr · Izin: {currentReport.kehadiran.izin} hr ·
              Alpa: {currentReport.kehadiran.alpa} hr
            </div>
          </div>

          <div className="space-y-2 text-slate-700 leading-relaxed">
            <p>
              <strong className="text-slate-900">Perkembangan:</strong>{' '}
              {currentReport.catatanWali.perkembangan}
            </p>
            <p>
              <strong className="text-slate-900">Kekuatan:</strong>{' '}
              {currentReport.catatanWali.kekuatan}
            </p>
            <p>
              <strong className="text-slate-900">Saran Semester Depan:</strong>{' '}
              {currentReport.catatanWali.saranSemesterDepan}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-[#E8FAF3] border border-emerald-200 text-emerald-950 italic">
            “{currentReport.catatanWali.pesanSingkat}”
          </div>
        </div>

        <div
          className="lg:col-span-4 text-white rounded-2xl p-5 flex flex-col justify-between gap-4"
          style={{ backgroundColor: theme.darkPill }}
        >
          <div className="space-y-2.5">
            <div className="inline-flex items-center gap-1.5 text-[#1DF27A] text-xs font-semibold">
              <Link2 className="w-4 h-4" />
              <span>Link Portofolio Santri</span>
            </div>
            <h3 className="font-display font-bold text-base">
              {tpl.portalQrTitle}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              {tpl.portalQrDescription}
            </p>
            <a
              href={portfolioUrl}
              target="_blank"
              rel="noreferrer"
              className="block bg-white/10 hover:bg-white/15 border border-white/15 rounded-xl px-3 py-2 text-[11px] font-mono text-[#1DF27A] break-all transition-colors"
            >
              {portfolioUrl}
            </a>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-white/15">
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-[#1DF27A]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? 'Link Disalin' : 'Salin Link'}</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenPortfolio(student.id)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#1DF27A] hover:bg-emerald-400 text-xs font-bold text-slate-950 transition-colors"
            >
              <span>Buka</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* HASIL KARYA & PORTOFOLIO ANAK (Ditaruh di bagian akhir halaman rapor wali) */}
      <div
        id="sec-karya"
        className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 scroll-mt-20"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div
              className="inline-block text-slate-950 font-display font-extrabold text-[11px] px-3.5 py-1 rounded-full mb-1.5"
              style={{ backgroundColor: theme.sectionSky }}
            >
              HASIL KARYA &amp; PORTOFOLIO ANAK
            </div>
            <h2 className="font-display font-bold text-slate-900 text-base">
              Galeri Karya {student.nama} ({studentProjects.length} Karya)
            </h2>
            <p className="text-xs text-slate-500">
              {tpl.portalPortfolioSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenPortfolio(student.id)}
            className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap self-start sm:self-auto"
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            <span>Lihat Halaman Portofolio Penuh</span>
          </button>
        </div>

        {studentProjects.length === 0 ? (
          <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
            Belum ada karya portofolio yang diunggah untuk santri ini.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {studentProjects.map((proj) => {
              const firstMedia = proj.mediaItems[0];
              return (
                <div
                  key={proj.id}
                  className="border border-slate-200 rounded-xl overflow-hidden bg-white flex flex-col justify-between hover:border-emerald-300 transition-colors"
                >
                  <div>
                    <div className="h-44 sm:h-40 bg-slate-100 relative overflow-hidden">
                      {firstMedia?.url ? (
                        firstMedia.type === 'video' ? (
                          <iframe
                            src={firstMedia.url}
                            title={proj.judul}
                            className="w-full h-full pointer-events-none"
                          />
                        ) : (
                          <img
                            src={firstMedia.url}
                            alt={proj.judul}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        )
                      ) : (
                        <PortfolioArtwork
                          preset={firstMedia?.presetArt || 'poster'}
                          title={proj.judul}
                        />
                      )}
                    </div>

                    <div className="p-3.5 space-y-1.5">
                      <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide">
                        {proj.jenis} · {proj.semester} {proj.tahunAkademik}
                      </div>
                      <h3 className="font-display font-bold text-sm text-slate-900 leading-snug">
                        {proj.judul}
                      </h3>
                      <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                        {proj.keteranganSingkat || proj.description}
                      </p>
                      <div className="text-[11px] font-mono text-slate-500 pt-0.5 truncate">
                        Tools: {proj.technology || '—'}
                      </div>
                    </div>
                  </div>

                  <div className="px-3.5 pb-3.5 pt-2 flex items-center gap-2 border-t border-slate-100">
                    {firstMedia && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewMedia({
                            item: firstMedia,
                            title: proj.judul,
                            jenis: proj.jenis,
                          })
                        }
                        className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0E2228] text-white hover:bg-slate-800 text-xs font-semibold"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#1DF27A]" />
                        <span>Lihat Karya</span>
                      </button>
                    )}
                    {proj.externalLink && (
                      <a
                        href={proj.externalLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[40px] inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
                      >
                        <span>Link</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline Media Lightbox Modal */}
      {previewMedia && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setPreviewMedia(null)}
        >
          <div
            className="relative w-full max-w-3xl bg-white rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <div>
                <div className="text-[11px] font-bold text-emerald-700 uppercase">
                  {previewMedia.jenis}
                </div>
                <div className="font-display font-bold text-sm text-slate-900">
                  {previewMedia.title}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewMedia(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="h-[400px] bg-slate-900 flex items-center justify-center">
              {previewMedia.item.url ? (
                previewMedia.item.type === 'video' ? (
                  <iframe
                    src={previewMedia.item.url}
                    title={previewMedia.title}
                    className="w-full h-full"
                    allowFullScreen
                  />
                ) : (
                  <img
                    src={previewMedia.item.url}
                    alt={previewMedia.title}
                    referrerPolicy="no-referrer"
                    className="max-w-full max-h-full object-contain"
                  />
                )
              ) : (
                <PortfolioArtwork
                  preset={previewMedia.item.presetArt}
                  title={previewMedia.item.caption || previewMedia.title}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
