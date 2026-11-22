import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  Lock,
  PenLine,
  Printer,
  Save,
  Wallet,
  X,
} from 'lucide-react';
import { DEFAULT_TEMPLATE_CONFIG } from '../data/seedData';
import {
  BrandingTemplateConfig,
  InternDailyLog,
  InternHourlyBlocks,
  InternProfile,
  InternTrackerGroup,
  MdaDatabase,
} from '../types/mda';
import { formatRupiah } from '../utils/grading';
import {
  computeInternTrackerStats,
  computeTilawahProgress,
  EMPTY_HOURLY_BLOCKS,
  formatMagangPeriodRange,
  formatTanggalIndonesia,
  formatTanggalShort,
  getTodayIsoDateLocal,
  getTrackerGroupLabel,
  INTERN_HOURLY_BLOCK_DEFS,
  resolveInternLembarPerJuz,
  resolveInternTrackerItems,
} from '../utils/internship';
import { mergeTemplateConfig } from '../utils/theme';
import { MagangPeriodPicker } from './MagangPeriodPicker';
import { MutabaahMatrixTable } from './MutabaahMatrixTable';
import { TilawahDonutChart } from './TilawahDonutChart';

interface StudentInternshipViewProps {
  db: MdaDatabase;
  studentId: string;
  templateConfig?: BrandingTemplateConfig;
  isBusy?: boolean;
  onSaveInternProfile: (profile: InternProfile) => Promise<boolean> | boolean;
  onSaveDailyLog: (log: InternDailyLog) => Promise<boolean> | boolean;
  onOpenPrintInternReport: (studentId: string) => void;
}

type StudentInternTab = 'profil' | 'rekap' | 'isi';

const GROUP_ORDER: InternTrackerGroup[] = ['sholat', 'tilawah', 'kebersihan', 'lainnya'];

export const StudentInternshipView: React.FC<StudentInternshipViewProps> = ({
  db,
  studentId,
  templateConfig,
  isBusy = false,
  onSaveInternProfile,
  onSaveDailyLog,
  onOpenPrintInternReport,
}) => {
  const tpl = useMemo(
    () => mergeTemplateConfig(templateConfig || db.templateConfig, DEFAULT_TEMPLATE_CONFIG),
    [templateConfig, db.templateConfig]
  );
  const trackerItems = useMemo(() => resolveInternTrackerItems(tpl), [tpl]);
  const lembarPerJuz = useMemo(() => resolveInternLembarPerJuz(tpl), [tpl]);

  const student = useMemo(
    () => db.students.find((s) => s.id === studentId) || db.students[0],
    [db.students, studentId]
  );

  const existingProfile = useMemo(
    () => (db.internProfiles || []).find((p) => p.studentId === student?.id),
    [db.internProfiles, student?.id]
  );

  const studentLogs = useMemo(
    () =>
      (db.internDailyLogs || [])
        .filter((l) => l.studentId === student?.id)
        .sort((a, b) => b.tanggal.localeCompare(a.tanggal)),
    [db.internDailyLogs, student?.id]
  );

  const isProfileComplete = Boolean(
    existingProfile?.tempatMagang?.trim() &&
      ((existingProfile?.mulaiTanggal && existingProfile?.selesaiTanggal) ||
        existingProfile?.waktuMagang?.trim())
  );

  const [activeTab, setActiveTab] = useState<StudentInternTab>(() =>
    existingProfile?.tempatMagang?.trim() ? 'isi' : 'profil'
  );

  // Tab 1: Profil Tempat Magang state
  const [tempatMagang, setTempatMagang] = useState('');
  const [mulaiTanggal, setMulaiTanggal] = useState('');
  const [selesaiTanggal, setSelesaiTanggal] = useState('');
  const [jamKerjaHarian, setJamKerjaHarian] = useState('');
  const [kompetensiMagang, setKompetensiMagang] = useState('');
  const [incomeInput, setIncomeInput] = useState('0');
  const [pembimbingNama, setPembimbingNama] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    setTempatMagang(existingProfile?.tempatMagang || '');
    setMulaiTanggal(existingProfile?.mulaiTanggal || '');
    setSelesaiTanggal(existingProfile?.selesaiTanggal || '');
    setJamKerjaHarian(existingProfile?.jamKerjaHarian || '');
    setKompetensiMagang(existingProfile?.kompetensiMagang || '');
    setIncomeInput(String(existingProfile?.incomeMagangRp ?? 0));
    setPembimbingNama(existingProfile?.pembimbingNama || '');
    setProfileError(null);
  }, [existingProfile, student?.id]);

  // Tab 3: Isi Hari Ini state
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayIsoDateLocal());
  const [trackerResults, setTrackerResults] = useState<Record<string, 'yes' | 'no'>>({});
  const [tilawahLembarInput, setTilawahLembarInput] = useState('');
  const [hourlyBlocks, setHourlyBlocks] = useState<InternHourlyBlocks>({ ...EMPTY_HOURLY_BLOCKS });
  const [kejadianPenting, setKejadianPenting] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savingLog, setSavingLog] = useState(false);

  const logForSelectedDate = useMemo(
    () => studentLogs.find((l) => l.tanggal === selectedDate),
    [studentLogs, selectedDate]
  );

  useEffect(() => {
    setValidationError(null);
    if (logForSelectedDate) {
      setTrackerResults({ ...(logForSelectedDate.trackerResults || {}) });
      setTilawahLembarInput(
        typeof logForSelectedDate.tilawahLembar === 'number' && logForSelectedDate.tilawahLembar > 0
          ? String(logForSelectedDate.tilawahLembar)
          : ''
      );
      setHourlyBlocks({
        ...EMPTY_HOURLY_BLOCKS,
        ...(logForSelectedDate.hourlyBlocks || {}),
      });
      setKejadianPenting(logForSelectedDate.kejadianPenting || '');
    } else {
      setTrackerResults({});
      setTilawahLembarInput('');
      setHourlyBlocks({ ...EMPTY_HOURLY_BLOCKS });
      setKejadianPenting('');
    }
  }, [logForSelectedDate, selectedDate, student?.id]);

  const stats = useMemo(
    () => computeInternTrackerStats(studentLogs, trackerItems),
    [studentLogs, trackerItems]
  );
  const tilawahProgress = useMemo(
    () => computeTilawahProgress(studentLogs, lembarPerJuz),
    [studentLogs, lembarPerJuz]
  );

  const formattedMagangPeriod = useMemo(
    () =>
      formatMagangPeriodRange(
        existingProfile?.mulaiTanggal,
        existingProfile?.selesaiTanggal,
        existingProfile?.jamKerjaHarian,
        existingProfile?.waktuMagang
      ),
    [
      existingProfile?.mulaiTanggal,
      existingProfile?.selesaiTanggal,
      existingProfile?.jamKerjaHarian,
      existingProfile?.waktuMagang,
    ]
  );

  const groupedTrackerItems = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      title: getTrackerGroupLabel(group),
      items: trackerItems.filter((it) => it.group === group),
    })).filter((g) => g.items.length > 0);
  }, [trackerItems]);

  const answeredCount = useMemo(
    () =>
      trackerItems.filter(
        (it) => trackerResults[it.id] === 'yes' || trackerResults[it.id] === 'no'
      ).length,
    [trackerItems, trackerResults]
  );

  const missingTrackerLabels = useMemo(
    () =>
      trackerItems
        .filter((it) => trackerResults[it.id] !== 'yes' && trackerResults[it.id] !== 'no')
        .map((it) => it.label),
    [trackerItems, trackerResults]
  );

  if (!student) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-600">
        Data santri tidak ditemukan.
      </div>
    );
  }

  const handleSubmitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    if (!tempatMagang.trim()) {
      setProfileError('Isi Nama Tempat Magang terlebih dahulu.');
      return;
    }
    setSavingProfile(true);
    try {
      const parsedIncome = Math.max(
        0,
        Number(String(incomeInput).replace(/[^\d]/g, '')) || 0
      );
      const formattedWaktu = formatMagangPeriodRange(
        mulaiTanggal,
        selesaiTanggal,
        jamKerjaHarian,
        existingProfile?.waktuMagang
      );
      await onSaveInternProfile({
        id: student.id,
        studentId: student.id,
        tempatMagang: tempatMagang.trim(),
        waktuMagang: formattedWaktu,
        mulaiTanggal,
        selesaiTanggal,
        jamKerjaHarian: jamKerjaHarian.trim(),
        kompetensiMagang: kompetensiMagang.trim(),
        incomeMagangRp: parsedIncome,
        pembimbingNama: pembimbingNama.trim(),
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSubmitDailyLog = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      setValidationError('Pilih tanggal jurnal yang valid.');
      return;
    }

    if (missingTrackerLabels.length > 0) {
      setValidationError(
        `Semua item Tracker Ibadah & Amal wajib dipilih (✓ atau ✗) sebelum menyimpan. Belum dipilih: ${missingTrackerLabels.join(', ')}.`
      );
      return;
    }

    const hasAnyJournalText = INTERN_HOURLY_BLOCK_DEFS.some(
      (def) => (hourlyBlocks[def.key] || '').trim().length > 0
    );
    if (!hasAnyJournalText) {
      setValidationError(
        'Isi minimal satu blok jam aktivitas harian (misal 08.00 – 12.00) sebelum menyimpan jurnal.'
      );
      return;
    }

    const sanitizedResults: Record<string, 'yes' | 'no'> = {};
    for (const item of trackerItems) {
      const val = trackerResults[item.id];
      if (val === 'yes' || val === 'no') {
        sanitizedResults[item.id] = val;
      }
    }

    const parsedLembar = Number(String(tilawahLembarInput).replace(',', '.'));
    const tilawahLembar =
      Number.isFinite(parsedLembar) && parsedLembar >= 0
        ? Math.min(1000, Math.round(parsedLembar * 10) / 10)
        : 0;

    setSavingLog(true);
    try {
      await onSaveDailyLog({
        id: `${student.id}_${selectedDate}`,
        studentId: student.id,
        tanggal: selectedDate,
        trackerResults: sanitizedResults,
        tilawahLembar,
        hourlyBlocks: {
          block_05_08: (hourlyBlocks.block_05_08 || '').trim(),
          block_08_12: (hourlyBlocks.block_08_12 || '').trim(),
          block_13_17: (hourlyBlocks.block_13_17 || '').trim(),
          block_18_21: (hourlyBlocks.block_18_21 || '').trim(),
          block_22_03: (hourlyBlocks.block_22_03 || '').trim(),
        },
        kejadianPenting: kejadianPenting.trim(),
        catatanPembimbing: logForSelectedDate?.catatanPembimbing || '',
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSavingLog(false);
    }
  };

  const handleOpenDateInEditor = (isoDate: string) => {
    setSelectedDate(isoDate);
    setActiveTab('isi');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const tabs: Array<{
    id: StudentInternTab;
    label: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    { id: 'profil', label: 'Profil Tempat Magang', icon: Briefcase },
    { id: 'rekap', label: 'Rekap & Matriks', icon: BarChart3 },
    { id: 'isi', label: 'Isi Hari Ini', icon: PenLine },
  ];

  return (
    <div
      className="space-y-4 max-w-full"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      {/* Compact Header Banner */}
      <div className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
            Magang &amp; Jurnal Harian Santri
          </div>
          <h1 className="font-bold text-lg sm:text-xl text-slate-900 mt-0.5 truncate">
            {student.nama}
          </h1>
          <div className="text-xs text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
            <span className="font-bold text-slate-800">{student.nisnMda}</span>
            <span>·</span>
            <span>{student.kelas}</span>
            {existingProfile?.tempatMagang && (
              <>
                <span>·</span>
                <span className="font-bold text-emerald-800">
                  {existingProfile.tempatMagang}
                </span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenPrintInternReport(student.id)}
          className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-bold shrink-0 transition-colors"
        >
          <Printer className="w-4 h-4 text-[#1DF27A]" />
          <span>Unduh PDF / Cetak Laporan</span>
        </button>
      </div>

      {/* 3-Tab Navigation Switcher (Exact Order: Profil Tempat Magang | Rekap & Matriks | Isi Hari Ini) */}
      <div className="bg-white border border-slate-200 rounded-2xl p-1.5 shadow-xs">
        <div className="grid grid-cols-3 gap-1.5">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[44px] px-2 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  isActive
                    ? 'bg-[#0E2228] text-[#1DF27A] shadow-sm'
                    : 'bg-slate-50 text-slate-600 hover:bg-emerald-50 hover:text-emerald-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0 hidden min-[380px]:block" />
                <span className="truncate">
                  <span className="hidden sm:inline">{idx + 1}. </span>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= TAB 1: PROFIL TEMPAT MAGANG ================= */}
      {activeTab === 'profil' && (
        <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5">
          {/* Status Kelengkapan Profil */}
          {isProfileComplete ? (
            <div className="p-3.5 rounded-xl bg-[#E8FAF3] border border-emerald-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-emerald-950">Profil Magang Sudah Lengkap</div>
                  <div className="text-emerald-900 mt-0.5">
                    <span className="font-bold">{existingProfile?.tempatMagang}</span>
                    {formattedMagangPeriod ? ` · ${formattedMagangPeriod}` : ''}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('isi')}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold shrink-0 self-start sm:self-auto"
              >
                Lanjut Isi Hari Ini →
              </button>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 flex items-start gap-2.5 text-xs text-amber-950">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Profil Magang Belum Dilengkapi</div>
                <div className="text-amber-900 mt-0.5">
                  Lengkapi nama tempat mitra magang serta jadwal tanggal mulai dan selesai magang di bawah ini.
                </div>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2.5 border-b border-slate-100 pb-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <Briefcase className="w-4 h-4 text-emerald-700" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-sm sm:text-base text-slate-900">
                Profil Tempat &amp; Jadwal Magang
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Data ini otomatis tampil di kop identitas Laporan PDF Magang Anda.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmitProfile} className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Tempat Magang / Mitra Industri <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={tempatMagang}
                    onChange={(e) => setTempatMagang(e.target.value)}
                    placeholder="Contoh: Studio Kreatif Nusantara / PT Digital Media"
                    className="w-full min-h-[42px] px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Kompetensi Magang
                  </label>
                  <textarea
                    rows={3}
                    value={kompetensiMagang}
                    onChange={(e) => setKompetensiMagang(e.target.value)}
                    placeholder="Contoh: UI/UX Design, Video Editing, Konten Sosmed, Web Development"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      Income Saat Magang (Rupiah)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={incomeInput}
                      onChange={(e) => setIncomeInput(e.target.value.replace(/[^\d]/g, ''))}
                      placeholder="0"
                      className="w-full min-h-[42px] px-3 py-2 text-xs font-bold tabular-nums border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                    <div className="text-[11px] text-emerald-700 font-bold mt-1 tabular-nums">
                      Terbaca: {formatRupiah(Number(incomeInput || 0))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      Nama Pembimbing Magang (Opsional)
                    </label>
                    <input
                      type="text"
                      value={pembimbingNama}
                      onChange={(e) => setPembimbingNama(e.target.value)}
                      placeholder="Contoh: Ust. Ahmad / Mentor Lapangan"
                      className="w-full min-h-[42px] px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>
              </div>

              <div>
                <MagangPeriodPicker
                  mulaiTanggal={mulaiTanggal}
                  selesaiTanggal={selesaiTanggal}
                  jamKerjaHarian={jamKerjaHarian}
                  legacyWaktuMagang={existingProfile?.waktuMagang}
                  onChangeMulai={setMulaiTanggal}
                  onChangeSelesai={setSelesaiTanggal}
                  onChangeJamKerja={setJamKerjaHarian}
                />
              </div>
            </div>

            {profileError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{profileError}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-1">
              <button
                type="submit"
                disabled={savingProfile || isBusy}
                className="w-full sm:w-auto min-h-[44px] py-2.5 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{savingProfile ? 'Menyimpan...' : 'Simpan Profil Magang'}</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ================= TAB 2: REKAP & MATRIKS ================= */}
      {activeTab === 'rekap' && (
        <div className="space-y-4">
          {/* KPI Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5">
              <div className="text-[11px] font-bold text-slate-500">Total Hari Jurnal</div>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">
                {stats.totalDays}
                <span className="text-xs font-normal text-slate-500 ml-1">hari</span>
              </div>
            </div>
            <div className="bg-white border border-emerald-200 rounded-2xl p-3.5">
              <div className="text-[11px] font-bold text-emerald-700">Sholat Berjamaah ✓</div>
              <div className="text-xl sm:text-2xl font-extrabold text-emerald-800 mt-1 tabular-nums">
                {stats.sholatPct}%
                <span className="text-xs font-normal text-slate-500 ml-1.5">
                  ({stats.sholatYesTotal}/{stats.sholatAnsweredTotal})
                </span>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5">
              <div className="text-[11px] font-bold text-slate-500">Amal &amp; Kebersihan ✓</div>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">
                {stats.otherPct}%
                <span className="text-xs font-normal text-slate-500 ml-1.5">
                  ({stats.otherYesTotal}/{stats.otherAnsweredTotal})
                </span>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5">
              <div className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                <Wallet className="w-3.5 h-3.5 text-emerald-700" />
                <span>Income Magang</span>
              </div>
              <div className="text-base sm:text-lg font-extrabold text-emerald-800 mt-1.5 tabular-nums truncate">
                {formatRupiah(existingProfile?.incomeMagangRp || 0)}
              </div>
            </div>
          </div>

          {/* Diagram Lingkaran SVG Capaian Tilawah 30 Juz & Ringkasan Tempat Magang */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
            <div className="lg:col-span-7">
              <TilawahDonutChart
                summary={tilawahProgress}
                title="Capaian Tilawah Al-Qur’an (Target 30 Juz)"
                subtitle="Akumulasi lembar tilawah harian yang tercatat pada jurnal magang Anda."
              />
            </div>
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                  Tempat &amp; Periode Magang
                </div>
                <div className="text-sm font-bold text-slate-900 mt-1">
                  {existingProfile?.tempatMagang || 'Belum dilengkapi'}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {formattedMagangPeriod || 'Lengkapi di Tab 1: Profil Tempat Magang.'}
                </div>
                {existingProfile?.pembimbingNama && (
                  <div className="text-[11px] text-slate-500 mt-1.5">
                    Pembimbing:{' '}
                    <span className="font-bold text-slate-800">
                      {existingProfile.pembimbingNama}
                    </span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => onOpenPrintInternReport(student.id)}
                className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center justify-center gap-2"
              >
                <Printer className="w-4 h-4 text-[#1DF27A]" />
                <span>Unduh PDF / Cetak Laporan Magang</span>
              </button>
            </div>
          </div>

          {/* Tabel Matriks Mutabaah Per Tanggal (Gaya Excel) */}
          <MutabaahMatrixTable
            logs={studentLogs}
            trackerItems={trackerItems}
            studentName={student.nama}
            onSelectDate={handleOpenDateInEditor}
          />

          {/* Riwayat Jurnaling Harian (5 Blok Jam & Kejadian Penting) */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-bold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-700" />
                  <span>Riwayat Jurnal 5 Blok Jam ({studentLogs.length} Entri)</span>
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Diurutkan dari tanggal terbaru. Ketuk Edit untuk mengubah isian pada Tab Isi Hari Ini.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('isi')}
                className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#E8FAF3] hover:bg-emerald-100 border border-emerald-200 text-emerald-900 text-xs font-bold inline-flex items-center gap-1.5 self-start sm:self-auto"
              >
                <PenLine className="w-3.5 h-3.5" />
                <span>Isi Jurnal Baru</span>
              </button>
            </div>

            {studentLogs.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-slate-200 rounded-2xl text-xs text-slate-500 space-y-3">
                <div>
                  Belum ada riwayat jurnaling magang yang tersimpan.
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('isi')}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0E2228] text-[#1DF27A] text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <PenLine className="w-3.5 h-3.5" />
                  <span>Mulai Isi Hari Ini</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {studentLogs.map((log) => {
                  const yesCount = trackerItems.filter(
                    (it) => log.trackerResults?.[it.id] === 'yes'
                  ).length;
                  const noCount = trackerItems.filter(
                    (it) => log.trackerResults?.[it.id] === 'no'
                  ).length;

                  return (
                    <article
                      key={log.id}
                      className="border border-slate-200 rounded-2xl p-3.5 sm:p-4 space-y-3 bg-slate-50/40"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs sm:text-sm font-bold text-slate-900">
                            {formatTanggalIndonesia(log.tanggal)}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-bold text-emerald-700">✓ {yesCount} Terpenuhi</span>
                            <span>·</span>
                            <span className="font-bold text-rose-600">✗ {noCount} Tidak</span>
                            {Number(log.tilawahLembar || 0) > 0 && (
                              <>
                                <span>·</span>
                                <span className="font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                  Tilawah: {log.tilawahLembar} Lembar
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenDateInEditor(log.tanggal)}
                          className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-emerald-50 hover:border-emerald-300 text-xs font-bold text-slate-800 inline-flex items-center gap-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Edit Tanggal Ini</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        {INTERN_HOURLY_BLOCK_DEFS.map((def) => {
                          const text = (log.hourlyBlocks?.[def.key] || '').trim();
                          if (!text) return null;
                          return (
                            <div
                              key={def.key}
                              className="p-2.5 rounded-xl bg-white border border-slate-200 space-y-0.5"
                            >
                              <div className="text-[11px] font-bold text-emerald-800 tabular-nums">
                                {def.timeRange} · {def.shortLabel}
                              </div>
                              <p className="text-slate-700 leading-relaxed whitespace-pre-line">
                                {text}
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      {(log.kejadianPenting || '').trim() && (
                        <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-950">
                          <span className="font-bold text-amber-900">Kejadian Penting: </span>
                          <span className="whitespace-pre-line">{log.kejadianPenting}</span>
                        </div>
                      )}

                      {(log.catatanPembimbing || '').trim() && (
                        <div className="p-2.5 rounded-xl bg-[#E8FAF3] border border-emerald-200 text-xs text-emerald-950">
                          <span className="font-bold text-emerald-800">Catatan Pembimbing: </span>
                          <span>{log.catatanPembimbing}</span>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ================= TAB 3: ISI HARI INI ================= */}
      {activeTab === 'isi' && (
        <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5">
          {/* 1-Baris Ringkasan Info Magang */}
          <div className="px-3.5 py-2.5 rounded-xl bg-[#E8FAF3]/80 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              <Briefcase className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span className="font-bold text-emerald-950 truncate">
                {existingProfile?.tempatMagang || 'Tempat magang belum diisi'}
              </span>
              {formattedMagangPeriod && (
                <>
                  <span className="text-emerald-700">·</span>
                  <span className="text-emerald-900 truncate">{formattedMagangPeriod}</span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('profil')}
              className="text-[11px] font-bold text-emerald-800 hover:underline shrink-0"
            >
              Ubah Profil →
            </button>
          </div>

          {/* Pemilih Tanggal & Status */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#E8FAF3] border border-emerald-200 flex items-center justify-center shrink-0">
                <Calendar className="w-4 h-4 text-emerald-700" />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-sm sm:text-base text-slate-900">
                  Isi Jurnaling &amp; Tracker Ibadah
                </h2>
                <div className="text-[11px] text-slate-600 mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span>{formatTanggalIndonesia(selectedDate)}</span>
                  <span>·</span>
                  <span
                    className={`font-bold ${
                      logForSelectedDate ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {logForSelectedDate ? 'Sudah Tersimpan (Mode Edit)' : 'Entri Baru'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                aria-label="Tanggal Jurnal"
                className="min-h-[42px] px-3 py-1.5 text-xs font-bold tabular-nums border border-slate-300 rounded-xl bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
              <button
                type="button"
                onClick={() => setSelectedDate(getTodayIsoDateLocal())}
                className="min-h-[42px] px-3 py-1.5 rounded-xl border border-emerald-200 bg-[#E8FAF3] hover:bg-emerald-100 text-emerald-900 text-xs font-bold shrink-0"
              >
                Hari Ini
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmitDailyLog} className="space-y-5">
            {/* 1. Checklist Tracker Ibadah & Amal KOMPAK */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Checklist Tracker Ibadah &amp; Amal</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Ketuk tombol <strong>✓</strong> atau <strong>✗</strong> untuk setiap kegiatan di bawah ini.
                  </p>
                </div>
                <div className="text-xs font-bold tabular-nums text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg">
                  {answeredCount} / {trackerItems.length} dipilih
                </div>
              </div>

              <div className="space-y-2.5">
                {groupedTrackerItems.map((grp) => {
                  const legendText =
                    grp.group === 'sholat'
                      ? '✓ Berjamaah · ✗ Tidak Jamaah'
                      : '✓ Terlaksana · ✗ Tidak';

                  return (
                    <div
                      key={grp.group}
                      className="border border-slate-200 rounded-2xl overflow-hidden bg-white"
                    >
                      <div className="px-3.5 py-2 bg-slate-100/95 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-800">
                          {grp.title}
                        </span>
                        <span className="text-[11px] font-semibold text-emerald-800">
                          {legendText}
                        </span>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {grp.items.map((item) => {
                          const val = trackerResults[item.id];
                          return (
                            <div
                              key={item.id}
                              className="px-3 sm:px-4 py-2 flex items-center justify-between gap-2.5 hover:bg-slate-50/70"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs sm:text-sm font-semibold text-slate-900 leading-snug break-words">
                                  {item.label}
                                </div>
                                {!val && (
                                  <div className="text-[10px] font-semibold text-amber-700">
                                    Belum dipilih
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  aria-label={`${item.label}: ${
                                    item.mode === 'jamaah' ? 'Berjamaah' : 'Terlaksana'
                                  }`}
                                  onClick={() =>
                                    setTrackerResults((prev) => ({
                                      ...prev,
                                      [item.id]: 'yes',
                                    }))
                                  }
                                  className={`min-w-[46px] min-h-[38px] px-3 rounded-full border text-sm font-bold inline-flex items-center justify-center transition-all ${
                                    val === 'yes'
                                      ? 'bg-emerald-600 border-emerald-700 text-white shadow-xs'
                                      : 'bg-white border-slate-300 text-slate-600 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700'
                                  }`}
                                >
                                  <Check className="w-4 h-4 stroke-[2.5]" />
                                </button>

                                <button
                                  type="button"
                                  aria-label={`${item.label}: ${
                                    item.mode === 'jamaah' ? 'Tidak Jamaah' : 'Tidak'
                                  }`}
                                  onClick={() =>
                                    setTrackerResults((prev) => ({
                                      ...prev,
                                      [item.id]: 'no',
                                    }))
                                  }
                                  className={`min-w-[46px] min-h-[38px] px-3 rounded-full border text-sm font-bold inline-flex items-center justify-center transition-all ${
                                    val === 'no'
                                      ? 'bg-rose-600 border-rose-700 text-white shadow-xs'
                                      : 'bg-white border-slate-300 text-slate-600 hover:bg-rose-50 hover:border-rose-400 hover:text-rose-700'
                                  }`}
                                >
                                  <X className="w-4 h-4 stroke-[2.5]" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Input Tilawah Harian (Opsional Lembar) */}
              <div className="p-3.5 rounded-2xl border border-emerald-200 bg-[#E8FAF3]/60 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-emerald-950">
                      Input Tilawah Harian (Opsional Lembar)
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Dihitung ke diagram capaian 30 Juz (Konversi: 1 Juz = {lembarPerJuz} Lembar).
                    </div>
                  </div>
                  {Number(tilawahLembarInput) > 0 && (
                    <span className="px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-[11px] font-bold text-emerald-800 tabular-nums">
                      ≈ {(Number(tilawahLembarInput) / lembarPerJuz).toFixed(1).replace('.', ',')} Juz
                    </span>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step="0.5"
                      value={tilawahLembarInput}
                      onChange={(e) => setTilawahLembarInput(e.target.value)}
                      placeholder="0"
                      className="w-24 min-h-[40px] px-3 py-1.5 text-xs font-bold tabular-nums bg-white border border-emerald-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                    <span className="text-xs font-bold text-slate-700">Lembar</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {[1, 2, 5, 10].map((inc) => (
                      <button
                        key={inc}
                        type="button"
                        onClick={() =>
                          setTilawahLembarInput((prev) =>
                            String(Math.min(1000, (Number(prev) || 0) + inc))
                          )
                        }
                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-900 text-xs font-bold tabular-nums"
                      >
                        +{inc} Lbr
                      </button>
                    ))}
                    {tilawahLembarInput && (
                      <button
                        type="button"
                        onClick={() => setTilawahLembarInput('')}
                        className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-semibold"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 2. 5 Blok Jam Jurnaling Harian & Kejadian Penting */}
            <div className="space-y-3 pt-1">
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Jurnal Aktivitas Harian (5 Blok Jam)</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Catat kegiatan nyata selama magang dan keseharian santri pada masing-masing blok jam.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {INTERN_HOURLY_BLOCK_DEFS.map((def, idx) => (
                  <div
                    key={def.key}
                    className={`p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1.5 ${
                      idx === INTERN_HOURLY_BLOCK_DEFS.length - 1 ? 'md:col-span-2' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-xs font-bold text-slate-900 tabular-nums">
                        {def.timeRange}
                      </span>
                      <span className="text-[11px] font-bold text-emerald-800">
                        {def.shortLabel}
                      </span>
                    </div>
                    <textarea
                      rows={2}
                      value={hourlyBlocks[def.key]}
                      onChange={(e) =>
                        setHourlyBlocks((prev) => ({
                          ...prev,
                          [def.key]: e.target.value,
                        }))
                      }
                      placeholder={def.hint}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                ))}

                {/* Kejadian Penting Hari Ini */}
                <div className="md:col-span-2 p-3 rounded-xl border border-amber-200 bg-amber-50/45 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-xs font-bold text-slate-900">
                      Kejadian Penting Hari Ini
                    </span>
                    <span className="text-[11px] font-semibold text-amber-800">
                      Momen, Kendala, atau Pencapaian Khusus
                    </span>
                  </div>
                  <textarea
                    rows={2}
                    value={kejadianPenting}
                    onChange={(e) => setKejadianPenting(e.target.value)}
                    placeholder="Contoh: Presentasi desain disetujui klien, menemukan kendala teknis & cara mengatasinya, atau momen penting lainnya..."
                    className="w-full px-3 py-2 text-xs bg-white border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                </div>
              </div>
            </div>

            {(logForSelectedDate?.catatanPembimbing || '').trim() && (
              <div className="p-3.5 rounded-xl bg-[#E8FAF3] border border-emerald-200 text-xs text-emerald-950 space-y-1">
                <div className="font-bold text-emerald-800">
                  Catatan Pembimbing ({formatTanggalShort(selectedDate)})
                </div>
                <p className="leading-relaxed">{logForSelectedDate?.catatanPembimbing}</p>
              </div>
            )}

            {validationError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{validationError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={savingLog || isBusy}
              className="w-full min-h-[46px] py-3 px-4 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4 text-[#1DF27A]" />
              <span>
                {savingLog
                  ? 'Menyimpan Jurnal & Tracker...'
                  : `Simpan Jurnal & Tracker (${formatTanggalShort(selectedDate)})`}
              </span>
            </button>
          </form>
        </section>
      )}
    </div>
  );
};
