import React, { useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  Check,
  ExternalLink,
  FileSpreadsheet,
  FolderGit2,
  KeyRound,
  PenSquare,
  Printer,
  Search,
  Users,
} from 'lucide-react';
import { DEFAULT_TEMPLATE_CONFIG } from '../data/seedData';
import {
  BrandingTemplateConfig,
  MdaDatabase,
  PillarSummary,
  Student,
} from '../types/mda';
import {
  extractUniqueClasses,
  formatRupiah,
  generateSmartAccessPin,
  hitungPredikatByKkm,
  hitungRataRataDigital,
  hitungRataRataDiniyah,
  matchesClassFilter,
} from '../utils/grading';
import { getParentPortalAccessUrl, getThemeStyles, mergeTemplateConfig } from '../utils/theme';
import { RadarFivePillarsChart } from './Charts';
import { MdaLogo, StudentAvatar } from './MdaLogo';

interface AdminDashboardViewProps {
  db: MdaDatabase;
  selectedYear: string;
  selectedSemester: 'Gasal' | 'Genap';
  templateConfig?: BrandingTemplateConfig;
  onOpenGradeEditor: (studentId: string) => void;
  onOpenStudentPortal: (studentId: string) => void;
  onOpenPrintReport: (studentId: string) => void;
  onOpenPortfolio: (studentId: string) => void;
  onOpenNarrativeEditor?: () => void;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  db,
  selectedYear,
  selectedSemester,
  templateConfig,
  onOpenGradeEditor,
  onOpenStudentPortal,
  onOpenPrintReport,
  onOpenPortfolio,
  onOpenNarrativeEditor,
}) => {
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedStudentId, setCopiedStudentId] = useState<string | null>(null);

  const tpl = mergeTemplateConfig(templateConfig || db.templateConfig, DEFAULT_TEMPLATE_CONFIG);
  const theme = getThemeStyles(tpl.accentTheme);

  const activePeriod = useMemo(
    () =>
      db.periods.find(
        (p) => p.tahunAkademik === selectedYear && p.semester === selectedSemester
      ) || db.periods.find((p) => p.isActive),
    [db.periods, selectedYear, selectedSemester]
  );
  const kkmDiniyah = activePeriod?.kkmDiniyah || 60;
  const kkmDigital = activePeriod?.kkmDigital || 70;

  const classOptions = useMemo(
    () => extractUniqueClasses(db.students, db.teachers),
    [db.students, db.teachers]
  );

  const activeClassLabel =
    classFilter === 'ALL' ? 'Semua Kelas' : classFilter;

  const filteredStudents = useMemo(() => {
    return db.students.filter((s) => {
      const matchClass = matchesClassFilter(s.kelas, classFilter);
      const q = searchQuery.trim().toLowerCase();
      const matchSearch =
        q === '' ||
        s.nama.toLowerCase().includes(q) ||
        s.nisnMda.toLowerCase().includes(q) ||
        s.waliKelasNama.toLowerCase().includes(q);
      return matchClass && matchSearch;
    });
  }, [db.students, classFilter, searchQuery]);

  const periodReports = useMemo(() => {
    const ids = new Set(filteredStudents.map((s) => s.id));
    return db.reports.filter(
      (r) =>
        ids.has(r.studentId) &&
        r.tahunAkademik === selectedYear &&
        r.semester === selectedSemester
    );
  }, [db.reports, filteredStudents, selectedYear, selectedSemester]);

  const cohortStats = useMemo(() => {
    const count = periodReports.length || 1;
    const avgPilar: PillarSummary = {
      penguasaanMultimedia: Math.round(
        periodReports.reduce((a, r) => a + r.pilar.penguasaanMultimedia, 0) / count
      ),
      diniyahPembelajaran: Math.round(
        periodReports.reduce((a, r) => a + r.pilar.diniyahPembelajaran, 0) / count
      ),
      tahfidzulQuran: Math.round(
        periodReports.reduce((a, r) => a + r.pilar.tahfidzulQuran, 0) / count
      ),
      kesantrianKeasramaan: Math.round(
        periodReports.reduce((a, r) => a + r.pilar.kesantrianKeasramaan, 0) / count
      ),
      characterBuilding: Math.round(
        periodReports.reduce((a, r) => a + r.pilar.characterBuilding, 0) / count
      ),
      autoCalculate: false,
    };

    const avgTahfidz =
      Math.round(
        (periodReports.reduce((a, r) => a + r.tahfidz.nilaiAkhir, 0) / count) * 10
      ) / 10;

    const avgDiniyah =
      Math.round(
        (periodReports.reduce((a, r) => a + hitungRataRataDiniyah(r.diniyah), 0) / count) *
          10
      ) / 10;

    const avgDigital =
      Math.round(
        (periodReports.reduce((a, r) => a + hitungRataRataDigital(r.skillDigital), 0) /
          count) *
          10
      ) / 10;

    const totalIncome = periodReports.reduce((a, r) => a + (r.kpiMda.incomeRp || 0), 0);
    const totalProjects = db.portfolios.filter((p) =>
      filteredStudents.some((s) => s.id === p.studentId)
    ).length;

    return {
      avgPilar,
      avgTahfidz,
      avgDiniyah,
      avgDigital,
      totalIncome,
      totalProjects,
    };
  }, [periodReports, db.portfolios, filteredStudents]);

  const getReportForStudent = (student: Student) =>
    db.reports.find(
      (r) =>
        r.studentId === student.id &&
        r.tahunAkademik === selectedYear &&
        r.semester === selectedSemester
    );

  const handleCopyParentAccess = async (student: Student) => {
    const link = getParentPortalAccessUrl(
      student.nisnMda,
      student.accessPin || generateSmartAccessPin(student.nama, student.nisnMda),
      db.spreadsheetId
    );
    try {
      await navigator.clipboard.writeText(link);
      setCopiedStudentId(student.id);
      setTimeout(() => setCopiedStudentId(null), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Authentic MDA Branded Competence Hero Banner */}
      <div
        className="relative rounded-2xl p-6 sm:p-7 text-white overflow-hidden shadow-sm"
        style={{ background: theme.bannerGradient }}
      >
        {tpl.coverPhotoUrl && (
          <img
            src={tpl.coverPhotoUrl}
            alt="Latar MDA"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-luminosity"
          />
        )}
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2.5">
            <div className="inline-flex items-center justify-center bg-white/95 rounded-xl px-3.5 py-2 shadow-xs w-fit">
              <MdaLogo size="sm" customLogoUrl={tpl.customLogoUrl} />
            </div>
            <h1 className="font-['Outfit'] not-italic font-bold text-2xl sm:text-[28px] leading-tight tracking-tight pt-1">
              {tpl.subjudulCompetence}
            </h1>
            <p className="font-[Arial] text-sm sm:text-[15px] text-white/90 max-w-2xl leading-relaxed">
              {tpl.namaLembaga} · {tpl.namaPesantren} · Semester {selectedSemester} TA{' '}
              {selectedYear}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 shrink-0">
            <div className="bg-slate-950/35 border border-white/20 rounded-xl px-4 py-3 backdrop-blur-xs">
              <div className="text-xs sm:text-sm text-emerald-200 font-medium">Santri Aktif</div>
              <div className="font-[Arial] font-bold text-xl sm:text-2xl text-white tabular-nums mt-0.5">
                {filteredStudents.length} Santri
              </div>
            </div>
            <div className="bg-slate-950/35 border border-white/20 rounded-xl px-4 py-3 backdrop-blur-xs">
              <div className="text-xs sm:text-sm text-emerald-200 font-medium">Total Karya</div>
              <div className="font-[Arial] font-bold text-xl sm:text-2xl text-white tabular-nums mt-0.5">
                {cohortStats.totalProjects} Proyek
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 bg-[#1DF27A] text-slate-950 rounded-xl px-4 py-3 shadow-xs min-w-0">
              <div className="text-xs sm:text-sm font-bold">Total Income Santri</div>
              <div className="font-[Arial] font-extrabold text-base sm:text-xl tabular-nums break-words mt-0.5">
                {formatRupiah(cohortStats.totalIncome)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3.5 sm:gap-4">
        <div
          className="border border-emerald-200/80 rounded-2xl p-4 sm:p-5"
          style={{ backgroundColor: theme.pageTint }}
        >
          <div className="flex items-center justify-between gap-2 text-xs sm:text-sm text-slate-700 font-semibold">
            <span>Santri Terdaftar</span>
            <Users className="w-4 h-4 text-emerald-700 shrink-0" />
          </div>
          <div className="mt-2 font-display font-bold text-2xl sm:text-3xl text-slate-900 tabular-nums">
            {filteredStudents.length}
          </div>
          <div className="mt-1.5 text-xs text-slate-600">
            {periodReports.length} rapor aktif · {selectedSemester}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 text-xs sm:text-sm text-slate-600 font-medium">
            <span>Rata-rata Tahfidz</span>
            <BookOpen className="w-4 h-4 text-sky-600 shrink-0" />
          </div>
          <div className="mt-2 font-display font-bold text-2xl sm:text-3xl text-slate-900 tabular-nums">
            {cohortStats.avgTahfidz || '—'}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            Predikat {hitungPredikatByKkm(cohortStats.avgTahfidz || 0, activePeriod?.kkmTahfidz || 70)} · KKM {activePeriod?.kkmTahfidz || 70}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 text-xs sm:text-sm text-slate-600 font-medium">
            <span>Rata-rata Diniyah</span>
            <Award className="w-4 h-4 text-teal-600 shrink-0" />
          </div>
          <div className="mt-2 font-display font-bold text-2xl sm:text-3xl text-slate-900 tabular-nums">
            {cohortStats.avgDiniyah || '—'}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            5 Kitab Wajib · KKM 60
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 text-xs sm:text-sm text-slate-600 font-medium">
            <span>Skill Digital</span>
            <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
          </div>
          <div className="mt-2 font-display font-bold text-2xl sm:text-3xl text-slate-900 tabular-nums">
            {cohortStats.avgDigital || '—'}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            5 Mapel · UI/UX · Foto · Video · Canva
          </div>
        </div>

        <div
          className="col-span-2 sm:col-span-1 text-white rounded-2xl p-4 sm:p-5"
          style={{ backgroundColor: theme.darkPill }}
        >
          <div className="flex items-center justify-between gap-2 text-xs sm:text-sm text-emerald-300 font-semibold">
            <span>Portofolio &amp; Income</span>
            <FolderGit2 className="w-4 h-4 text-[#1DF27A] shrink-0" />
          </div>
          <div className="mt-2 font-display font-bold text-2xl sm:text-3xl text-white tabular-nums">
            {cohortStats.totalProjects} Karya
          </div>
          <div className="mt-1.5 font-[Arial] text-xs text-emerald-200 tabular-nums">
            Income {formatRupiah(cohortStats.totalIncome)}
          </div>
        </div>
      </div>

      {/* Cohort 5-Pillar Overview + MDA PDF Mint Bars */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-w-0">
        <div className="lg:col-span-5 min-w-0 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
          <div className="mb-3">
            <div
              className="inline-block text-slate-950 font-display font-extrabold text-xs px-3 py-1 rounded-full mb-2.5"
              style={{ backgroundColor: theme.sectionSky }}
            >
              RADAR 5 PILAR KOMPETENSI
            </div>
            <h2 className="font-['Outfit'] font-bold text-slate-900 text-lg sm:text-xl">
              {tpl.dashboardRadarTitle}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Rata-rata {activeClassLabel} · {selectedSemester} {selectedYear}
            </p>
          </div>

          <RadarFivePillarsChart
            current={cohortStats.avgPilar}
            currentLabel={`Rata-rata ${activeClassLabel}`}
          />
        </div>

        <div
          className="lg:col-span-7 min-w-0 border border-emerald-200 rounded-2xl p-5 sm:p-6 flex flex-col justify-between"
          style={{ backgroundColor: theme.pageTint }}
        >
          <div>
            <div
              className="inline-block text-slate-950 font-display font-extrabold text-xs px-3.5 py-1 rounded-full mb-2.5"
              style={{ backgroundColor: theme.sectionSky }}
            >
              RINGKASAN CAPAIAN 5 PILAR
            </div>
            <h2 className="font-display font-bold text-slate-900 text-lg sm:text-xl">
              {tpl.dashboardPillarTitle}
            </h2>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">
              {tpl.dashboardPillarSubtitle}
            </p>

            <div className="mt-5 space-y-3.5">
              {[
                {
                  label: 'Penguasaan Multimedia',
                  value: cohortStats.avgPilar.penguasaanMultimedia,
                },
                {
                  label: 'Diniyah dan Pembelajaran',
                  value: cohortStats.avgPilar.diniyahPembelajaran,
                },
                {
                  label: "Tahfidzul Qur'an",
                  value: cohortStats.avgPilar.tahfidzulQuran,
                },
                {
                  label: 'Kesantrian dan Keasramaan',
                  value: cohortStats.avgPilar.kesantrianKeasramaan,
                },
                {
                  label: 'Character Building',
                  value: cohortStats.avgPilar.characterBuilding,
                },
              ].map((row, idx) => (
                <div key={row.label} className="flex items-center gap-3">
                  <div className="relative flex-1 h-10 bg-white rounded-full border border-emerald-200 overflow-hidden flex items-center">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, row.value)}%`,
                        backgroundColor: theme.barTrack,
                      }}
                    />
                    <span className="absolute left-4 text-sm font-bold text-slate-900 truncate pr-2">
                      {row.label}
                    </span>
                  </div>
                  <div
                    className={`w-[68px] h-10 text-white rounded-full flex items-center justify-center ${
                      idx === 0 || idx === 1 || idx === 4 ? 'font-[Arial]' : 'font-mono'
                    } text-sm font-bold tabular-nums shrink-0`}
                    style={{ backgroundColor: theme.darkPill }}
                  >
                    {row.value}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 pt-3.5 border-t border-emerald-200/70 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm text-slate-600">
            <span className="font-[Arial] italic leading-relaxed">
              Tahfidz &amp; Digital (KKM {kkmDigital}): A (90–100) · B (80–89) · C (70–79) · D (&lt;70) | Diniyah (KKM {kkmDiniyah}): A (87–100) · B (73–86) · C (60–72) · D (&lt;60)
            </span>
            <span className="italic">{tpl.dashboardPillarNote}</span>
          </div>
        </div>
      </div>

      {/* Student Reports Table (Desktop) & Stacked Cards (Mobile) */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="font-display font-bold text-slate-900 text-lg sm:text-xl">
              {tpl.dashboardTableTitle}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {tpl.dashboardTableSubtitle}
            </p>
            {onOpenNarrativeEditor && (
              <button
                type="button"
                onClick={onOpenNarrativeEditor}
                className="mt-2 inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
              >
                <PenSquare className="w-3.5 h-3.5" />
                <span>Edit Narasi &amp; Tulisan Dashboard</span>
              </button>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 min-w-0">
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              aria-label="Filter Kelas"
              className="w-full sm:w-auto min-h-[44px] h-11 px-3.5 py-2.5 text-base sm:text-sm font-semibold bg-slate-100 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="ALL">Semua Kelas ({db.students.length})</option>
              {classOptions.map((cls) => (
                <option key={cls.key} value={cls.name}>
                  {cls.name} ({cls.count})
                </option>
              ))}
            </select>

            <div className="relative min-w-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama / ID santri..."
                className="min-h-[44px] h-11 pl-10 pr-3.5 py-2.5 text-base sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 w-full sm:w-60"
              />
            </div>
          </div>
        </div>

        {/* Mobile Card Stack */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredStudents.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Tidak ada santri yang cocok dengan filter pencarian.
            </div>
          ) : (
            filteredStudents.map((student, idx) => {
              const rep = getReportForStudent(student);
              const diniyahAvg = rep ? hitungRataRataDiniyah(rep.diniyah) : 0;
              const digitalAvg = rep ? hitungRataRataDigital(rep.skillDigital) : 0;
              const projectCount = db.portfolios.filter(
                (p) => p.studentId === student.id
              ).length;

              return (
                <div key={student.id} className="p-4 space-y-3.5">
                  <div className="flex items-start gap-3">
                    <StudentAvatar
                      name={student.nama}
                      fotoUrl={student.fotoUrl}
                      className="w-12 h-14 text-sm shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-display font-bold text-slate-900 text-base leading-snug">
                        {student.nama}
                      </div>
                      <div className="font-mono text-xs text-emerald-700 font-semibold mt-0.5">
                        {student.nisnMda}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {student.kelas} · Wali: {student.waliKelasNama}
                      </div>
                    </div>
                  </div>

                  <div
                    className="grid grid-cols-3 gap-2 p-3 rounded-xl border border-emerald-100 text-center text-sm"
                    style={{ backgroundColor: theme.pageTint }}
                  >
                    <div>
                      <div className="text-xs text-slate-500">Tahfidz</div>
                      <div
                        className={`${
                          idx === 0 ? 'font-[Arial]' : 'font-mono'
                        } font-bold text-slate-900 tabular-nums mt-0.5`}
                      >
                        {rep ? `${rep.tahfidz.nilaiAkhir} (${rep.tahfidz.predikat})` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Diniyah</div>
                      <div
                        className={`${
                          idx === 0 ? 'font-[Arial]' : 'font-mono'
                        } font-bold text-slate-900 tabular-nums mt-0.5`}
                      >
                        {rep ? `${diniyahAvg} (${hitungPredikatByKkm(diniyahAvg, kkmDiniyah)})` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Digital ({projectCount})</div>
                      <div
                        className={`${
                          idx === 0 ? 'font-[Arial]' : 'font-mono'
                        } font-bold text-slate-900 tabular-nums mt-0.5`}
                      >
                        {rep ? `${digitalAvg} (${hitungPredikatByKkm(digitalAvg, kkmDigital)})` : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenGradeEditor(student.id)}
                      className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold"
                    >
                      <PenSquare className="w-4 h-4" />
                      <span>Nilai</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenStudentPortal(student.id)}
                      className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm font-semibold"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Rapor</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenPortfolio(student.id)}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700"
                      title="Portofolio"
                    >
                      <FolderGit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyParentAccess(student)}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-2.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800"
                      title="Salin Link Akses Privat Wali"
                    >
                      {copiedStudentId === student.id ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <KeyRound className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenPrintReport(student.id)}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-2.5 py-2 rounded-xl bg-[#0E2228] text-white"
                      title="Cetak PDF"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr
                className="text-white text-sm font-semibold"
                style={{ backgroundColor: theme.darkPill }}
              >
                <th className="py-3.5 px-4">Santri &amp; ID</th>
                <th className="py-3.5 px-3">Kelas &amp; Wali</th>
                <th className="py-3.5 px-3 text-right">Tahfidz</th>
                <th className="py-3.5 px-3 text-right">Diniyah</th>
                <th className="py-3.5 px-3 text-right">Digital</th>
                <th className="py-3.5 px-3 text-center">Karya</th>
                <th className="py-3.5 px-3">PIN Wali</th>
                <th className="py-3.5 px-4 text-right">Aksi Cepat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-slate-500">
                    Tidak ada santri yang cocok dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((student, idx) => {
                  const rep = getReportForStudent(student);
                  const diniyahAvg = rep ? hitungRataRataDiniyah(rep.diniyah) : 0;
                  const digitalAvg = rep ? hitungRataRataDigital(rep.skillDigital) : 0;
                  const projectCount = db.portfolios.filter(
                    (p) => p.studentId === student.id
                  ).length;

                  return (
                    <tr
                      key={student.id}
                      className="hover:bg-emerald-50/40 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <StudentAvatar
                            name={student.nama}
                            fotoUrl={student.fotoUrl}
                            className="w-11 h-12 text-sm shrink-0"
                          />
                          <div>
                            <div className="font-semibold text-slate-900 text-sm">
                              {student.nama}
                            </div>
                            <div
                              className={`${
                                idx === 0 ? "font-['JetBrains_Mono']" : 'font-mono'
                              } text-xs text-emerald-700 font-semibold`}
                            >
                              {student.nisnMda}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="font-medium text-slate-800">{student.kelas}</div>
                        <div className="text-xs text-slate-500 truncate max-w-[180px]">
                          {student.waliKelasNama}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                        {rep ? (
                          <div>
                            <span
                              className={`${
                                idx === 0 ? 'font-[Arial] ' : ''
                              }font-semibold text-slate-900`}
                            >
                              {rep.tahfidz.nilaiAkhir}
                            </span>{' '}
                            <span className="text-emerald-700 font-bold">
                              ({rep.tahfidz.predikat})
                            </span>
                            <div className="text-xs text-slate-500 font-sans">
                              {rep.tahfidz.totalHafalan}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">Belum ada</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                        {rep ? (
                          <span
                            className={`${
                              idx === 0 ? 'font-[Arial] ' : ''
                            }font-semibold text-slate-900`}
                          >
                            {diniyahAvg} ({hitungPredikatByKkm(diniyahAvg, kkmDiniyah)})
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                        {rep ? (
                          <span
                            className={`${
                              idx === 0 ? 'font-[Arial] ' : ''
                            }font-semibold text-slate-900`}
                          >
                            {digitalAvg} ({hitungPredikatByKkm(digitalAvg, kkmDigital)})
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-center font-mono tabular-nums text-slate-700 font-semibold">
                        {projectCount}
                      </td>
                      <td className="py-3.5 px-3">
                        <button
                          type="button"
                          onClick={() => handleCopyParentAccess(student)}
                          className="min-h-[38px] inline-flex items-center gap-1.5 font-mono text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg whitespace-nowrap"
                          title="Salin link akses langsung untuk orang tua"
                        >
                          {copiedStudentId === student.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-700" />
                          ) : (
                            <KeyRound className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {copiedStudentId === student.id
                              ? 'Link Disalin'
                              : student.accessPin || 'MDA123'}
                          </span>
                        </button>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenGradeEditor(student.id)}
                            className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0"
                          >
                            <PenSquare className="w-3.5 h-3.5" />
                            <span>Nilai</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenStudentPortal(student.id)}
                            className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0"
                            title="Lihat tampilan Portal Santri / Orang Tua"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Rapor</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenPortfolio(student.id)}
                            className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors font-medium whitespace-nowrap shrink-0"
                            title="Buka Portofolio Santri"
                          >
                            <FolderGit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenPrintReport(student.id)}
                            className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-slate-200 bg-[#0E2228] text-white hover:bg-slate-800 transition-colors font-medium whitespace-nowrap shrink-0"
                            title="Cetak / Ekspor PDF Rapor 5 Halaman"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
