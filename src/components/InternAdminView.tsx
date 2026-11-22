import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  Calendar,
  Check,
  ClipboardList,
  Edit3,
  Lock,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { DEFAULT_INTERN_TRACKER_ITEMS, DEFAULT_TEMPLATE_CONFIG } from '../data/seedData';
import {
  BrandingTemplateConfig,
  InternDailyLog,
  InternHourlyBlocks,
  InternProfile,
  InternTrackerGroup,
  InternTrackerItem,
  InternTrackerMode,
  MdaDatabase,
} from '../types/mda';
import { extractUniqueClasses, formatRupiah, matchesClassFilter } from '../utils/grading';
import {
  computeInternTrackerStats,
  computeTilawahProgress,
  EMPTY_HOURLY_BLOCKS,
  formatMagangPeriodRange,
  formatTanggalIndonesia,
  formatTanggalShort,
  getTodayIsoDateLocal,
  getTrackerButtonLabels,
  getTrackerGroupLabel,
  INTERN_HOURLY_BLOCK_DEFS,
  resolveInternLembarPerJuz,
  resolveInternTrackerItems,
} from '../utils/internship';
import { mergeTemplateConfig } from '../utils/theme';
import { MagangPeriodPicker } from './MagangPeriodPicker';
import { MutabaahMatrixTable } from './MutabaahMatrixTable';
import { TilawahDonutChart } from './TilawahDonutChart';

interface InternAdminViewProps {
  db: MdaDatabase;
  canManageTrackerItems: boolean;
  templateConfig?: BrandingTemplateConfig;
  isBusy?: boolean;
  onSaveInternProfile: (profile: InternProfile) => Promise<boolean> | boolean;
  onSaveDailyLog: (log: InternDailyLog) => Promise<boolean> | boolean;
  onSaveTrackerItems: (
    items: InternTrackerItem[],
    lembarPerJuz?: number
  ) => Promise<boolean> | boolean;
  onOpenPrintInternReport: (studentId: string) => void;
}

export const InternAdminView: React.FC<InternAdminViewProps> = ({
  db,
  canManageTrackerItems,
  templateConfig,
  isBusy = false,
  onSaveInternProfile,
  onSaveDailyLog,
  onSaveTrackerItems,
  onOpenPrintInternReport,
}) => {
  const tpl = useMemo(
    () => mergeTemplateConfig(templateConfig || db.templateConfig, DEFAULT_TEMPLATE_CONFIG),
    [templateConfig, db.templateConfig]
  );
  const trackerItems = useMemo(() => resolveInternTrackerItems(tpl), [tpl]);
  const trackerConfigSignature = useMemo(() => JSON.stringify(trackerItems), [trackerItems]);

  const [subTab, setSubTab] = useState<'monitoring' | 'tracker_config'>('monitoring');

  // Monitoring filters
  const dynamicClasses = useMemo(
    () => extractUniqueClasses(db.students, db.teachers),
    [db.students, db.teachers]
  );
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayIsoDateLocal());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'filled' | 'missing'>('all');
  const [matrixStudentId, setMatrixStudentId] = useState<string>(
    () => db.students[0]?.id || ''
  );

  const lembarPerJuzConfig = useMemo(() => resolveInternLembarPerJuz(tpl), [tpl]);

  // Detail & Pembimbing modal state
  const [inspectedStudentId, setInspectedStudentId] = useState<string | null>(null);
  const [modalDate, setModalDate] = useState<string>(() => getTodayIsoDateLocal());
  const [modalTrackerDraft, setModalTrackerDraft] = useState<Record<string, 'yes' | 'no'>>({});
  const [modalTilawahLembar, setModalTilawahLembar] = useState('');
  const [modalBlocksDraft, setModalBlocksDraft] = useState<InternHourlyBlocks>({
    ...EMPTY_HOURLY_BLOCKS,
  });
  const [modalKejadianPenting, setModalKejadianPenting] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Modal Profile Edit state
  const [editTempat, setEditTempat] = useState('');
  const [editMulaiTanggal, setEditMulaiTanggal] = useState('');
  const [editSelesaiTanggal, setEditSelesaiTanggal] = useState('');
  const [editJamKerja, setEditJamKerja] = useState('');
  const [editKompetensi, setEditKompetensi] = useState('');
  const [editIncome, setEditIncome] = useState('0');
  const [editPembimbing, setEditPembimbing] = useState('');
  const [savingModalProfile, setSavingModalProfile] = useState(false);

  // Sub-tab 2: Tracker Items Config state
  const [draftItems, setDraftItems] = useState<InternTrackerItem[]>(trackerItems);
  const [draftLembarPerJuz, setDraftLembarPerJuz] = useState<number>(lembarPerJuzConfig);
  const [newLabel, setNewLabel] = useState('');
  const [newGroup, setNewGroup] = useState<InternTrackerGroup>('lainnya');
  const [newMode, setNewMode] = useState<InternTrackerMode>('terlaksana');
  const [savingTrackerConfig, setSavingTrackerConfig] = useState(false);

  useEffect(() => {
    setDraftItems(trackerItems);
    // Only resync draftItems when the serialized server/template tracker config actually changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackerConfigSignature]);

  useEffect(() => {
    setDraftLembarPerJuz(lembarPerJuzConfig);
  }, [lembarPerJuzConfig]);

  const profileMap = useMemo(() => {
    const map = new Map<string, InternProfile>();
    for (const p of db.internProfiles || []) {
      map.set(p.studentId, p);
    }
    return map;
  }, [db.internProfiles]);

  const logsByStudentDate = useMemo(() => {
    const map = new Map<string, InternDailyLog>();
    for (const l of db.internDailyLogs || []) {
      map.set(`${l.studentId}_${l.tanggal}`, l);
    }
    return map;
  }, [db.internDailyLogs]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return db.students.filter((st) => {
      if (!matchesClassFilter(st.kelas, classFilter)) return false;
      const prof = profileMap.get(st.id);
      if (q) {
        const matchesText =
          st.nama.toLowerCase().includes(q) ||
          st.nisnMda.toLowerCase().includes(q) ||
          (prof?.tempatMagang || '').toLowerCase().includes(q);
        if (!matchesText) return false;
      }
      const hasLog = logsByStudentDate.has(`${st.id}_${selectedDate}`);
      if (statusFilter === 'filled' && !hasLog) return false;
      if (statusFilter === 'missing' && hasLog) return false;
      return true;
    });
  }, [db.students, classFilter, profileMap, searchQuery, logsByStudentDate, selectedDate, statusFilter]);

  const activeMatrixStudent = useMemo(() => {
    const pool = filteredStudents.length > 0 ? filteredStudents : db.students;
    return pool.find((s) => s.id === matrixStudentId) || pool[0] || null;
  }, [filteredStudents, db.students, matrixStudentId]);

  const activeMatrixLogs = useMemo(() => {
    if (!activeMatrixStudent) return [];
    return (db.internDailyLogs || []).filter((l) => l.studentId === activeMatrixStudent.id);
  }, [db.internDailyLogs, activeMatrixStudent]);

  const summaryStats = useMemo(() => {
    const logsForFilteredOnDate: InternDailyLog[] = [];
    let filledCount = 0;

    const studentsInClass = db.students.filter((st) => matchesClassFilter(st.kelas, classFilter));
    for (const st of studentsInClass) {
      const log = logsByStudentDate.get(`${st.id}_${selectedDate}`);
      if (log) {
        filledCount += 1;
        logsForFilteredOnDate.push(log);
      }
    }

    const trackerStatsOnDate = computeInternTrackerStats(logsForFilteredOnDate, trackerItems);
    const scopeStudentIds = new Set(studentsInClass.map((s) => s.id));
    const allLogsInScope = (db.internDailyLogs || []).filter((l) =>
      scopeStudentIds.has(l.studentId)
    );
    const totalScopeTilawah = computeTilawahProgress(allLogsInScope, lembarPerJuzConfig);
    const avgLembarPerStudent =
      studentsInClass.length > 0
        ? Math.round((totalScopeTilawah.totalLembar / studentsInClass.length) * 10) / 10
        : 0;
    const avgJuzPerStudent =
      Math.round((avgLembarPerStudent / lembarPerJuzConfig) * 10) / 10;
    const avgTilawahSummary = {
      ...totalScopeTilawah,
      totalLembar: avgLembarPerStudent,
      totalJuz: avgJuzPerStudent,
      pct:
        totalScopeTilawah.targetLembar > 0
          ? Math.min(100, Math.round((avgLembarPerStudent / totalScopeTilawah.targetLembar) * 100))
          : 0,
    };

    return {
      totalStudentsInScope: studentsInClass.length,
      filledCount,
      missingCount: Math.max(0, studentsInClass.length - filledCount),
      trackerStatsOnDate,
      totalScopeTilawah,
      avgTilawahSummary,
    };
  }, [
    db.students,
    db.internDailyLogs,
    classFilter,
    logsByStudentDate,
    selectedDate,
    trackerItems,
    lembarPerJuzConfig,
  ]);

  const sholatItems = useMemo(
    () => trackerItems.filter((it) => it.group === 'sholat'),
    [trackerItems]
  );
  const nonSholatItems = useMemo(
    () => trackerItems.filter((it) => it.group !== 'sholat'),
    [trackerItems]
  );

  // Inspected Student data for Modal
  const inspectedStudent = useMemo(
    () => db.students.find((s) => s.id === inspectedStudentId) || null,
    [db.students, inspectedStudentId]
  );
  const inspectedProfile = inspectedStudent ? profileMap.get(inspectedStudent.id) : undefined;
  const inspectedStudentLogs = useMemo(() => {
    if (!inspectedStudent) return [];
    return (db.internDailyLogs || [])
      .filter((l) => l.studentId === inspectedStudent.id)
      .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  }, [db.internDailyLogs, inspectedStudent]);

  const inspectedStudentTilawah = useMemo(
    () => computeTilawahProgress(inspectedStudentLogs, lembarPerJuzConfig),
    [inspectedStudentLogs, lembarPerJuzConfig]
  );

  const activeModalLog = useMemo(() => {
    if (!inspectedStudent) return undefined;
    return logsByStudentDate.get(`${inspectedStudent.id}_${modalDate}`);
  }, [inspectedStudent, logsByStudentDate, modalDate]);

  useEffect(() => {
    if (!inspectedStudent) return;
    setEditTempat(inspectedProfile?.tempatMagang || '');
    setEditMulaiTanggal(inspectedProfile?.mulaiTanggal || '');
    setEditSelesaiTanggal(inspectedProfile?.selesaiTanggal || '');
    setEditJamKerja(inspectedProfile?.jamKerjaHarian || '');
    setEditKompetensi(inspectedProfile?.kompetensiMagang || '');
    setEditIncome(String(inspectedProfile?.incomeMagangRp ?? 0));
    setEditPembimbing(inspectedProfile?.pembimbingNama || '');
  }, [inspectedStudent, inspectedProfile]);

  useEffect(() => {
    setModalTrackerDraft({ ...(activeModalLog?.trackerResults || {}) });
    setModalTilawahLembar(
      typeof activeModalLog?.tilawahLembar === 'number' && activeModalLog.tilawahLembar > 0
        ? String(activeModalLog.tilawahLembar)
        : ''
    );
    setModalBlocksDraft({
      ...EMPTY_HOURLY_BLOCKS,
      ...(activeModalLog?.hourlyBlocks || {}),
    });
    setModalKejadianPenting(activeModalLog?.kejadianPenting || '');
    setNoteDraft(activeModalLog?.catatanPembimbing || '');
  }, [activeModalLog, modalDate]);

  const openStudentDetail = (studentId: string) => {
    setInspectedStudentId(studentId);
    const hasSelectedDate = logsByStudentDate.has(`${studentId}_${selectedDate}`);
    if (hasSelectedDate) {
      setModalDate(selectedDate);
    } else {
      const latest = (db.internDailyLogs || [])
        .filter((l) => l.studentId === studentId)
        .sort((a, b) => b.tanggal.localeCompare(a.tanggal))[0];
      setModalDate(latest?.tanggal || selectedDate);
    }
  };

  const handleSaveModalDailyLog = async () => {
    if (!inspectedStudent || !/^\d{4}-\d{2}-\d{2}$/.test(modalDate)) return;
    const cleanResults: Record<string, 'yes' | 'no'> = {};
    for (const item of trackerItems) {
      const v = modalTrackerDraft[item.id];
      if (v === 'yes' || v === 'no') {
        cleanResults[item.id] = v;
      }
    }
    const parsedLembar = Number(String(modalTilawahLembar).replace(',', '.'));
    const tilawahLembar =
      Number.isFinite(parsedLembar) && parsedLembar >= 0
        ? Math.min(1000, Math.round(parsedLembar * 10) / 10)
        : 0;

    setSavingNote(true);
    try {
      await onSaveDailyLog({
        id: `${inspectedStudent.id}_${modalDate}`,
        studentId: inspectedStudent.id,
        tanggal: modalDate,
        trackerResults: cleanResults,
        tilawahLembar,
        hourlyBlocks: {
          block_05_08: (modalBlocksDraft.block_05_08 || '').trim(),
          block_08_12: (modalBlocksDraft.block_08_12 || '').trim(),
          block_13_17: (modalBlocksDraft.block_13_17 || '').trim(),
          block_18_21: (modalBlocksDraft.block_18_21 || '').trim(),
          block_22_03: (modalBlocksDraft.block_22_03 || '').trim(),
        },
        kejadianPenting: modalKejadianPenting.trim(),
        catatanPembimbing: noteDraft.trim(),
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSavingNote(false);
    }
  };

  const handleSaveModalProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectedStudent) return;
    setSavingModalProfile(true);
    try {
      const formattedWaktu = formatMagangPeriodRange(
        editMulaiTanggal,
        editSelesaiTanggal,
        editJamKerja,
        inspectedProfile?.waktuMagang
      );
      await onSaveInternProfile({
        id: inspectedStudent.id,
        studentId: inspectedStudent.id,
        tempatMagang: editTempat.trim(),
        waktuMagang: formattedWaktu,
        mulaiTanggal: editMulaiTanggal,
        selesaiTanggal: editSelesaiTanggal,
        jamKerjaHarian: editJamKerja.trim(),
        kompetensiMagang: editKompetensi.trim(),
        incomeMagangRp: Math.max(0, Number(editIncome.replace(/[^\d]/g, '')) || 0),
        pembimbingNama: editPembimbing.trim(),
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSavingModalProfile(false);
    }
  };

  const handleAddTrackerItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTrackerItems || !newLabel.trim()) return;
    const slug = newLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const uniqueId = `${slug || 'item'}_${Date.now().toString(36)}`;
    setDraftItems((prev) => [
      ...prev,
      {
        id: uniqueId,
        label: newLabel.trim(),
        group: newGroup,
        mode: newMode,
        active: true,
      },
    ]);
    setNewLabel('');
  };

  const handleMoveTrackerItem = (index: number, delta: -1 | 1) => {
    if (!canManageTrackerItems) return;
    const nextIdx = index + delta;
    if (nextIdx < 0 || nextIdx >= draftItems.length) return;
    setDraftItems((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(nextIdx, 0, moved);
      return copy;
    });
  };

  const handleSaveTrackerConfig = async () => {
    if (!canManageTrackerItems) return;
    const cleaned = draftItems
      .map((it) => ({ ...it, label: it.label.trim(), active: true }))
      .filter((it) => it.label.length > 0);
    if (cleaned.length === 0) return;
    const safePerJuz = Math.max(1, Math.min(100, Math.round(Number(draftLembarPerJuz) || 10)));
    setSavingTrackerConfig(true);
    try {
      await onSaveTrackerItems(cleaned, safePerJuz);
    } finally {
      setSavingTrackerConfig(false);
    }
  };

  return (
    <div className="space-y-5 max-w-full">
      {/* Header & Sub-Tab Switcher */}
      <div className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
            Kontrol &amp; Pembinaan Santri Magang
          </div>
          <h1 className="font-display font-bold text-lg sm:text-xl text-slate-900 mt-0.5">
            Magang &amp; Jurnal Harian
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pantau jurnaling 5 blok jam, matriks mutabaah sholat berjamaah, amal kebersihan, catatan pembimbing, dan ekspor PDF.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => setSubTab('monitoring')}
            className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
              subTab === 'monitoring'
                ? 'bg-[#0E2228] text-[#1DF27A] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Kontrol &amp; Monitoring</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('tracker_config')}
            className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
              subTab === 'tracker_config'
                ? 'bg-[#0E2228] text-[#1DF27A] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Item Tracker Ibadah</span>
          </button>
        </div>
      </div>

      {subTab === 'monitoring' ? (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-end">
            <div className="lg:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Filter Kelas
              </label>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="w-full min-h-[40px] px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
              >
                <option value="ALL">Semua Kelas ({db.students.length} Santri)</option>
                {dynamicClasses.map((cls) => (
                  <option key={cls.key} value={cls.name}>
                    {cls.name} ({cls.count} Santri)
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Tanggal Monitoring
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="flex-1 min-w-0 min-h-[40px] px-3 py-1.5 text-xs font-mono font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                />
                <button
                  type="button"
                  onClick={() => setSelectedDate(getTodayIsoDateLocal())}
                  className="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-[#E8FAF3] border border-emerald-200 text-emerald-900 text-xs font-bold shrink-0"
                >
                  Hari Ini
                </button>
              </div>
            </div>

            <div className="lg:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Status Pengisian
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'filled' | 'missing')}
                className="w-full min-h-[40px] px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
              >
                <option value="all">Semua Status</option>
                <option value="filled">Sudah Mengisi Tanggal Ini</option>
                <option value="missing">Belum Mengisi Tanggal Ini</option>
              </select>
            </div>

            <div className="lg:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Cari Santri / Tempat Magang
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Nama, ID, atau tempat magang..."
                  className="w-full min-h-[40px] pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>
            </div>
          </div>

          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-emerald-200 rounded-2xl p-3.5">
              <div className="text-[11px] font-semibold text-emerald-700">
                Sudah Mengisi ({formatTanggalShort(selectedDate)})
              </div>
              <div className="text-xl sm:text-2xl font-display font-extrabold text-emerald-800 mt-1 tabular-nums">
                {summaryStats.filledCount}
                <span className="text-xs font-normal text-slate-500 ml-1">
                  / {summaryStats.totalStudentsInScope} santri
                </span>
              </div>
            </div>

            <div className="bg-white border border-amber-200 rounded-2xl p-3.5">
              <div className="text-[11px] font-semibold text-amber-700">Belum Mengisi</div>
              <div className="text-xl sm:text-2xl font-display font-extrabold text-amber-800 mt-1 tabular-nums">
                {summaryStats.missingCount}
                <span className="text-xs font-normal text-slate-500 ml-1">santri</span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-3.5">
              <div className="text-[11px] font-semibold text-slate-500">
                Sholat Berjamaah ✓ (Tanggal Ini)
              </div>
              <div className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 mt-1 tabular-nums">
                {summaryStats.trackerStatsOnDate.sholatPct}%
                <span className="text-xs font-normal text-slate-500 ml-1.5">
                  ({summaryStats.trackerStatsOnDate.sholatYesTotal}/
                  {summaryStats.trackerStatsOnDate.sholatAnsweredTotal})
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-3.5">
              <div className="text-[11px] font-semibold text-slate-500">
                Tilawah &amp; Kebersihan ✓
              </div>
              <div className="text-xl sm:text-2xl font-display font-extrabold text-slate-900 mt-1 tabular-nums">
                {summaryStats.trackerStatsOnDate.otherPct}%
                <span className="text-xs font-normal text-slate-500 ml-1.5">
                  ({summaryStats.trackerStatsOnDate.otherYesTotal}/
                  {summaryStats.trackerStatsOnDate.otherAnsweredTotal})
                </span>
              </div>
            </div>
          </div>

          {/* Rekapitulasi Tilawah 30 Juz & Item Tracker Pada Tanggal Ini */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
            <div className="lg:col-span-5">
              <TilawahDonutChart
                summary={summaryStats.avgTilawahSummary}
                title="Rata-rata Capaian Tilawah (Target 30 Juz)"
                subtitle={`Total kelas/filter: ${summaryStats.totalScopeTilawah.totalLembar.toLocaleString('id-ID')} lembar (${summaryStats.totalScopeTilawah.totalJuz.toLocaleString('id-ID')} Juz) dari ${summaryStats.totalStudentsInScope} santri.`}
              />
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 space-y-2.5 flex flex-col justify-between">
              <div className="text-xs font-bold text-slate-900 flex flex-wrap items-center justify-between gap-2">
                <span>
                  Rekapitulasi ✓ vs ✗ Per Item ({formatTanggalShort(selectedDate)})
                </span>
                <span className="text-[11px] font-normal text-slate-500 tabular-nums">
                  Dari {summaryStats.filledCount} santri yang mengisi
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {summaryStats.trackerStatsOnDate.itemStats.map((st) => (
                  <div
                    key={st.item.id}
                    className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1"
                  >
                    <div className="text-[11px] font-bold text-slate-800 truncate">
                      {st.item.label}
                    </div>
                    <div className="flex items-center justify-between text-[11px] tabular-nums">
                      <span className="font-bold text-emerald-700">✓ {st.yesCount}</span>
                      <span className="font-bold text-rose-600">✗ {st.noCount}</span>
                      <span className="font-semibold text-slate-600">{st.yesPct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Daftar Monitoring Santri */}
          {filteredStudents.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-xs text-slate-500">
              Tidak ada santri yang sesuai dengan filter kelas/tanggal/pencarian.
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase">
                        <th className="py-3 px-4">Santri &amp; Kelas</th>
                        <th className="py-3 px-3">Profil Magang &amp; Income</th>
                        <th className="py-3 px-3">Status ({formatTanggalShort(selectedDate)})</th>
                        <th className="py-3 px-3">Sholat 5 Waktu</th>
                        <th className="py-3 px-3">Tilawah &amp; Amal</th>
                        <th className="py-3 px-4 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredStudents.map((st) => {
                        const prof = profileMap.get(st.id);
                        const log = logsByStudentDate.get(`${st.id}_${selectedDate}`);
                        const totalLogsCount = (db.internDailyLogs || []).filter(
                          (l) => l.studentId === st.id
                        ).length;

                        const sholatYes = sholatItems.filter(
                          (it) => log?.trackerResults?.[it.id] === 'yes'
                        ).length;
                        const otherYes = nonSholatItems.filter(
                          (it) => log?.trackerResults?.[it.id] === 'yes'
                        ).length;

                        return (
                          <tr key={st.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 align-top">
                              <div className="font-bold text-slate-900">{st.nama}</div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                <span className="font-mono">{st.nisnMda}</span> · {st.kelas}
                              </div>
                              <div className="text-[11px] text-emerald-700 font-semibold mt-0.5 tabular-nums">
                                {totalLogsCount} total hari log
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top">
                              <div className="font-semibold text-slate-800">
                                {prof?.tempatMagang || (
                                  <span className="text-slate-400 italic">Belum diisi</span>
                                )}
                              </div>
                              {formatMagangPeriodRange(
                                prof?.mulaiTanggal,
                                prof?.selesaiTanggal,
                                prof?.jamKerjaHarian,
                                prof?.waktuMagang
                              ) && (
                                <div className="text-[11px] text-slate-500 truncate max-w-[210px]">
                                  {formatMagangPeriodRange(
                                    prof?.mulaiTanggal,
                                    prof?.selesaiTanggal,
                                    prof?.jamKerjaHarian,
                                    prof?.waktuMagang
                                  )}
                                </div>
                              )}
                              <div className="text-[11px] font-bold text-emerald-800 mt-0.5 tabular-nums">
                                Income: {formatRupiah(prof?.incomeMagangRp || 0)}
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top">
                              {log ? (
                                <div className="space-y-1">
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-[11px]">
                                    <Check className="w-3 h-3" />
                                    <span>Sudah Mengisi</span>
                                  </span>
                                  {Number(log.tilawahLembar || 0) > 0 && (
                                    <div className="text-[10px] font-semibold text-emerald-700 tabular-nums">
                                      Tilawah: {log.tilawahLembar} Lbr
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold text-[11px]">
                                  Belum Mengisi
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-3 align-top">
                              {log ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1">
                                    {sholatItems.map((it) => {
                                      const val = log.trackerResults?.[it.id];
                                      return (
                                        <span
                                          key={it.id}
                                          title={`${it.label}: ${
                                            val === 'yes' ? 'Berjamaah' : val === 'no' ? 'Tidak Jamaah' : '-'
                                          }`}
                                          className={`w-6 h-6 rounded-md text-[10px] font-bold inline-flex items-center justify-center border ${
                                            val === 'yes'
                                              ? 'bg-emerald-600 border-emerald-700 text-white'
                                              : val === 'no'
                                                ? 'bg-rose-100 border-rose-300 text-rose-700'
                                                : 'bg-slate-100 border-slate-200 text-slate-400'
                                          }`}
                                        >
                                          {it.label.slice(0, 1).toUpperCase()}
                                        </span>
                                      );
                                    })}
                                  </div>
                                  <div className="text-[11px] text-slate-600 tabular-nums">
                                    ✓ {sholatYes}/{sholatItems.length} Jamaah
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-400 text-[11px]">—</span>
                              )}
                            </td>

                            <td className="py-3 px-3 align-top tabular-nums">
                              {log ? (
                                <div className="space-y-0.5">
                                  <span className="font-bold text-emerald-700">
                                    ✓ {otherYes}/{nonSholatItems.length}
                                  </span>
                                  {(log.kejadianPenting || '').trim() && (
                                    <div className="text-[10px] text-amber-800 font-semibold">
                                      Ada kejadian penting
                                    </div>
                                  )}
                                  {(log.catatanPembimbing || '').trim() && (
                                    <div className="text-[10px] text-emerald-800 font-semibold">
                                      Ada catatan pembimbing
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400 text-[11px]">—</span>
                              )}
                            </td>

                            <td className="py-3 px-4 align-top text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openStudentDetail(st.id)}
                                  className="px-3 py-1.5 rounded-lg bg-[#E8FAF3] hover:bg-emerald-100 border border-emerald-200 text-emerald-900 font-bold inline-flex items-center gap-1"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>Detail &amp; Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onOpenPrintInternReport(st.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-[#0E2228] hover:bg-slate-800 text-white font-bold inline-flex items-center gap-1"
                                  title="Unduh PDF Laporan Magang"
                                >
                                  <Printer className="w-3.5 h-3.5 text-[#1DF27A]" />
                                  <span>PDF</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Stacked Cards */}
              <div className="md:hidden space-y-3">
                {filteredStudents.map((st) => {
                  const prof = profileMap.get(st.id);
                  const log = logsByStudentDate.get(`${st.id}_${selectedDate}`);
                  const totalLogsCount = (db.internDailyLogs || []).filter(
                    (l) => l.studentId === st.id
                  ).length;
                  const sholatYes = sholatItems.filter(
                    (it) => log?.trackerResults?.[it.id] === 'yes'
                  ).length;

                  return (
                    <div
                      key={st.id}
                      className="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-slate-900 truncate">{st.nama}</div>
                          <div className="text-[11px] text-slate-500">
                            {st.nisnMda} · {st.kelas} · {totalLogsCount} log
                          </div>
                        </div>
                        {log ? (
                          <span className="shrink-0 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold">
                            ✓ Mengisi
                          </span>
                        ) : (
                          <span className="shrink-0 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
                            Belum
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-700 bg-slate-50 rounded-xl p-2.5 space-y-1">
                        <div className="font-semibold">
                          {prof?.tempatMagang || 'Tempat magang belum diisi'}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                          <span>Income: {formatRupiah(prof?.incomeMagangRp || 0)}</span>
                          {log && (
                            <span className="font-bold text-emerald-700">
                              Sholat ✓ {sholatYes}/{sholatItems.length}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => openStudentDetail(st.id)}
                          className="min-h-[42px] px-3 py-2 rounded-xl bg-[#E8FAF3] border border-emerald-200 text-emerald-900 text-xs font-bold inline-flex items-center justify-center gap-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Detail &amp; Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenPrintInternReport(st.id)}
                          className="min-h-[42px] px-3 py-2 rounded-xl bg-[#0E2228] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
                        >
                          <Printer className="w-3.5 h-3.5 text-[#1DF27A]" />
                          <span>Unduh PDF</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Matriks Mutabaah Ibadah Per Tanggal (Ala Excel) Untuk Santri Terpilih */}
          {activeMatrixStudent && (
            <div className="space-y-2.5">
              <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900">
                    Pantau Matriks Mutabaah Ibadah Per Tanggal (1–15 / 16–31)
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Pilih santri untuk melihat bolong tidaknya ibadah dalam satu tampilan tabel bulanan. Ketuk tanggal untuk koreksi jurnal &amp; catatan.
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <select
                    value={activeMatrixStudent.id}
                    onChange={(e) => setMatrixStudentId(e.target.value)}
                    aria-label="Pilih Santri untuk Matriks Mutabaah"
                    className="min-h-[40px] px-3 py-1.5 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl text-slate-900 max-w-[260px]"
                  >
                    {(filteredStudents.length > 0 ? filteredStudents : db.students).map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.nama} ({st.kelas})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => openStudentDetail(activeMatrixStudent.id)}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#E8FAF3] hover:bg-emerald-100 border border-emerald-200 text-emerald-900 text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit Santri</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenPrintInternReport(activeMatrixStudent.id)}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5 text-[#1DF27A]" />
                    <span>PDF</span>
                  </button>
                </div>
              </div>

              <MutabaahMatrixTable
                logs={activeMatrixLogs}
                trackerItems={trackerItems}
                studentName={activeMatrixStudent.nama}
                onSelectDate={(isoDate) => {
                  setInspectedStudentId(activeMatrixStudent.id);
                  setModalDate(isoDate);
                }}
              />
            </div>
          )}
        </div>
      ) : (
        /* Sub-Tab 2: Pengaturan Item Tracker Ibadah & Amal */
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="font-display font-bold text-base text-slate-900">
                Pengaturan Item Tracker Ibadah &amp; Amal
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Daftar ini tampil otomatis di akun seluruh santri sebagai pilihan ✓ / ✗ yang tidak dapat diubah oleh santri.
              </p>
            </div>
            {canManageTrackerItems && (
              <button
                type="button"
                onClick={() => setDraftItems(DEFAULT_INTERN_TRACKER_ITEMS)}
                className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5 self-start sm:self-auto"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Default (9 Item)</span>
              </button>
            )}
          </div>

          {!canManageTrackerItems && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
              <Lock className="w-4 h-4 shrink-0" />
              <span>
                Hanya Admin MDA yang dapat menambah, mengubah, atau menghapus item checklist tracker ibadah santri.
              </span>
            </div>
          )}

          {/* Konversi Lembar ke Juz (Target 30 Juz) */}
          <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900">
                Pengaturan Konversi Tilawah (Target 30 Juz)
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Dipakai menghitung persentase diagram lingkaran 30 Juz di dashboard Admin, Santri, &amp; PDF Magang.
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-semibold text-slate-700">1 Juz =</span>
              <input
                type="number"
                min={1}
                max={100}
                disabled={!canManageTrackerItems}
                value={draftLembarPerJuz}
                onChange={(e) =>
                  setDraftLembarPerJuz(
                    Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 10)))
                  )
                }
                className="w-20 min-h-[38px] px-2.5 py-1 text-xs font-mono font-bold bg-white border border-slate-200 rounded-xl text-center disabled:bg-slate-100"
              />
              <span className="text-xs font-semibold text-slate-700">
                Lembar (30 Juz = {draftLembarPerJuz * 30} Lbr)
              </span>
            </div>
          </div>

          {/* Add New Item Form (Admin Only) */}
          {canManageTrackerItems && (
            <form
              onSubmit={handleAddTrackerItem}
              className="p-3.5 rounded-2xl bg-[#E8FAF3]/60 border border-emerald-200 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
            >
              <div className="sm:col-span-4">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Nama Item Ibadah / Amal Baru
                </label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Contoh: Sholat Dhuha / Kebersihan Meja Kerja"
                  className="w-full min-h-[40px] px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Kelompok</label>
                <select
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value as InternTrackerGroup)}
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-xl"
                >
                  <option value="sholat">Sholat 5 Waktu</option>
                  <option value="tilawah">Tilawah Al-Qur’an</option>
                  <option value="kebersihan">Amal Kebersihan</option>
                  <option value="lainnya">Amal &amp; Ibadah Tambahan</option>
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Label ✓ / ✗</label>
                <select
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value as InternTrackerMode)}
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-xl"
                >
                  <option value="terlaksana">✓ Terlaksana / ✗ Tidak</option>
                  <option value="jamaah">✓ Berjamaah / ✗ Tidak Jamaah</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tambah</span>
                </button>
              </div>
            </form>
          )}

          {/* Items List */}
          <div className="space-y-2">
            {draftItems.map((item, idx) => (
              <div
                key={item.id}
                className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center"
              >
                <div className="md:col-span-4">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 md:hidden">
                    Nama Item Tracker
                  </label>
                  <input
                    type="text"
                    disabled={!canManageTrackerItems}
                    value={item.label}
                    onChange={(e) =>
                      setDraftItems((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, label: e.target.value } : p))
                      )
                    }
                    className="w-full min-h-[38px] px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 md:hidden">
                    Kelompok
                  </label>
                  <select
                    disabled={!canManageTrackerItems}
                    value={item.group}
                    onChange={(e) =>
                      setDraftItems((prev) =>
                        prev.map((p, i) =>
                          i === idx
                            ? { ...p, group: e.target.value as InternTrackerGroup }
                            : p
                        )
                      )
                    }
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg disabled:bg-slate-100"
                  >
                    <option value="sholat">{getTrackerGroupLabel('sholat')}</option>
                    <option value="tilawah">{getTrackerGroupLabel('tilawah')}</option>
                    <option value="kebersihan">{getTrackerGroupLabel('kebersihan')}</option>
                    <option value="lainnya">{getTrackerGroupLabel('lainnya')}</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 md:hidden">
                    Label Pilihan ✓ / ✗
                  </label>
                  <select
                    disabled={!canManageTrackerItems}
                    value={item.mode}
                    onChange={(e) =>
                      setDraftItems((prev) =>
                        prev.map((p, i) =>
                          i === idx ? { ...p, mode: e.target.value as InternTrackerMode } : p
                        )
                      )
                    }
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg disabled:bg-slate-100"
                  >
                    <option value="jamaah">✓ Berjamaah / ✗ Tidak Jamaah</option>
                    <option value="terlaksana">✓ Terlaksana / ✗ Tidak</option>
                  </select>
                </div>

                <div className="md:col-span-2 flex items-center justify-end gap-1">
                  {canManageTrackerItems && (
                    <>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveTrackerItem(idx, -1)}
                        className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 disabled:opacity-35"
                        title="Naikkan"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === draftItems.length - 1}
                        onClick={() => handleMoveTrackerItem(idx, 1)}
                        className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 disabled:opacity-35"
                        title="Turunkan"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={draftItems.length <= 1}
                        onClick={() =>
                          setDraftItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="p-2 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 disabled:opacity-35"
                        title="Hapus Item"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {canManageTrackerItems && (
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                disabled={savingTrackerConfig || isBusy}
                onClick={() => void handleSaveTrackerConfig()}
                className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Save className="w-4 h-4 text-[#1DF27A]" />
                <span>
                  {savingTrackerConfig
                    ? 'Menyimpan ke Google Sheets...'
                    : `Simpan Pengaturan Item Tracker (${draftItems.length} Item)`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Detail & Catatan Pembimbing Modal */}
      {inspectedStudent && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => setInspectedStudentId(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[90dvh] overflow-y-auto bg-white border border-emerald-200 rounded-3xl p-4 sm:p-6 space-y-5 shadow-2xl my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-emerald-700 uppercase">
                  Detail Magang &amp; Pembinaan Santri
                </div>
                <h3 className="font-display font-bold text-base sm:text-lg text-slate-900 mt-0.5 truncate">
                  {inspectedStudent.nama}
                </h3>
                <div className="text-xs text-slate-500">
                  {inspectedStudent.nisnMda} · {inspectedStudent.kelas}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onOpenPrintInternReport(inspectedStudent.id)}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#0E2228] text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5 text-[#1DF27A]" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInspectedStudentId(null)}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Ringkasan Tilawah Personal Santri */}
            <TilawahDonutChart
              summary={inspectedStudentTilawah}
              title={`Capaian Tilawah ${inspectedStudent.nama} (Target 30 Juz)`}
              subtitle="Akumulasi lembar tilawah dari seluruh jurnal magang santri ini."
            />

            {/* Edit Profil Magang oleh Admin / Guru */}
            <form
              onSubmit={handleSaveModalProfile}
              className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-3"
            >
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-emerald-700" />
                <span>Edit Profil Magang Santri</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Tempat Magang
                    </label>
                    <input
                      type="text"
                      value={editTempat}
                      onChange={(e) => setEditTempat(e.target.value)}
                      className="w-full min-h-[40px] px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Kompetensi Magang
                    </label>
                    <input
                      type="text"
                      value={editKompetensi}
                      onChange={(e) => setEditKompetensi(e.target.value)}
                      className="w-full min-h-[40px] px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Income (Rp)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={editIncome}
                        onChange={(e) => setEditIncome(e.target.value.replace(/[^\d]/g, ''))}
                        className="w-full min-h-[40px] px-3 py-2 bg-white border border-slate-200 rounded-xl font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Pembimbing
                      </label>
                      <input
                        type="text"
                        value={editPembimbing}
                        onChange={(e) => setEditPembimbing(e.target.value)}
                        className="w-full min-h-[40px] px-3 py-2 bg-white border border-slate-200 rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <MagangPeriodPicker
                    mulaiTanggal={editMulaiTanggal}
                    selesaiTanggal={editSelesaiTanggal}
                    jamKerjaHarian={editJamKerja}
                    legacyWaktuMagang={inspectedProfile?.waktuMagang}
                    onChangeMulai={setEditMulaiTanggal}
                    onChangeSelesai={setEditSelesaiTanggal}
                    onChangeJamKerja={setEditJamKerja}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingModalProfile || isBusy}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingModalProfile ? 'Menyimpan...' : 'Simpan Profil Magang'}</span>
                </button>
              </div>
            </form>

            {/* Date Selector & Full Admin/Guru Daily Journal Editor */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                  <span>
                    Koreksi / Isi Jurnal Tanggal: {formatTanggalIndonesia(modalDate)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                    className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-slate-50"
                  />
                  {inspectedStudentLogs.length > 0 && (
                    <select
                      value={modalDate}
                      onChange={(e) => setModalDate(e.target.value)}
                      className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      <option value={modalDate}>
                        Riwayat ({inspectedStudentLogs.length} hari)
                      </option>
                      {inspectedStudentLogs.map((l) => (
                        <option key={l.id} value={l.tanggal}>
                          {formatTanggalShort(l.tanggal)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {!activeModalLog && (
                <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                  Santri belum mengisi jurnal pada {formatTanggalShort(modalDate)}. Admin / Guru tetap dapat mengisikan atau mengoreksi tracker &amp; jurnal di bawah ini lalu klik Simpan.
                </div>
              )}

              <div className="space-y-3">
                {/* Editable Tracker Results (✓ / ✗) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {trackerItems.map((it) => {
                    const val = modalTrackerDraft[it.id];
                    const labels = getTrackerButtonLabels(it.mode);
                    return (
                      <div
                        key={it.id}
                        className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2 text-xs"
                      >
                        <div className="font-bold text-slate-900">{it.label}</div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setModalTrackerDraft((prev) => ({ ...prev, [it.id]: 'yes' }))
                            }
                            className={`min-h-[34px] px-2 py-1 rounded-lg border text-[11px] font-bold inline-flex items-center justify-center gap-1 ${
                              val === 'yes'
                                ? 'bg-emerald-600 border-emerald-700 text-white'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-emerald-50'
                            }`}
                          >
                            <Check className="w-3 h-3 shrink-0" />
                            <span className="truncate">{labels.yesLabel}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setModalTrackerDraft((prev) => ({ ...prev, [it.id]: 'no' }))
                            }
                            className={`min-h-[34px] px-2 py-1 rounded-lg border text-[11px] font-bold inline-flex items-center justify-center gap-1 ${
                              val === 'no'
                                ? 'bg-rose-600 border-rose-700 text-white'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-rose-50'
                            }`}
                          >
                            <X className="w-3 h-3 shrink-0" />
                            <span className="truncate">{labels.noLabel}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Editable Tilawah Lembar */}
                <div className="p-3 rounded-xl border border-emerald-200 bg-[#E8FAF3]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div>
                    <div className="font-bold text-emerald-950">
                      Lembar Tilawah Hari Ini (Opsional)
                    </div>
                    <div className="text-[11px] text-slate-600">
                      1 Juz = {lembarPerJuzConfig} Lembar
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step="0.5"
                      value={modalTilawahLembar}
                      onChange={(e) => setModalTilawahLembar(e.target.value)}
                      placeholder="0"
                      className="w-24 min-h-[36px] px-2.5 py-1 text-xs font-mono font-bold bg-white border border-emerald-200 rounded-lg"
                    />
                    <span className="text-xs font-semibold text-slate-700">Lbr</span>
                    {[1, 5, 10].map((inc) => (
                      <button
                        key={inc}
                        type="button"
                        onClick={() =>
                          setModalTilawahLembar((prev) =>
                            String(Math.min(1000, (Number(prev) || 0) + inc))
                          )
                        }
                        className="min-h-[34px] px-2 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-900 text-[11px] font-bold"
                      >
                        +{inc}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Editable 5 Blok Jam */}
                <div className="space-y-2">
                  {INTERN_HOURLY_BLOCK_DEFS.map((def) => (
                    <div
                      key={def.key}
                      className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-xs space-y-1"
                    >
                      <div className="font-bold font-mono text-emerald-800 text-[11px]">
                        {def.timeRange} · {def.shortLabel}
                      </div>
                      <textarea
                        rows={2}
                        value={modalBlocksDraft[def.key]}
                        onChange={(e) =>
                          setModalBlocksDraft((prev) => ({
                            ...prev,
                            [def.key]: e.target.value,
                          }))
                        }
                        placeholder={def.hint}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                  ))}
                </div>

                {/* Editable Kejadian Penting */}
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/40 space-y-1.5 text-xs">
                  <label className="block font-bold text-amber-950">
                    Kejadian Penting Hari Ini
                  </label>
                  <textarea
                    rows={2}
                    value={modalKejadianPenting}
                    onChange={(e) => setModalKejadianPenting(e.target.value)}
                    placeholder="Catat momen penting, kendala, atau pencapaian hari ini..."
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-amber-200 rounded-lg"
                  />
                </div>

                {/* Catatan Pembimbing */}
                <div className="p-3.5 rounded-2xl bg-[#E8FAF3] border border-emerald-200 space-y-2">
                  <label className="block text-xs font-bold text-emerald-950">
                    Catatan Pembimbing untuk Tanggal {formatTanggalShort(modalDate)}
                  </label>
                  <textarea
                    rows={3}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Tulis apresiasi, evaluasi ibadah, atau arahan magang untuk santri..."
                    className="w-full px-3 py-2 text-xs bg-white border border-emerald-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={savingNote || isBusy}
                      onClick={() => void handleSaveModalDailyLog()}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5 text-[#1DF27A]" />
                      <span>
                        {savingNote
                          ? 'Menyimpan...'
                          : 'Simpan Jurnal, Tracker & Catatan Pembimbing'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
