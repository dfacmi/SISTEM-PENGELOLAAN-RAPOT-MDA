import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  Calendar,
  Check,
  ClipboardList,
  Eye,
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
  InternProfile,
  InternTrackerGroup,
  InternTrackerItem,
  InternTrackerMode,
  MdaDatabase,
} from '../types/mda';
import { extractUniqueClasses, formatRupiah, matchesClassFilter } from '../utils/grading';
import {
  computeInternTrackerStats,
  EMPTY_HOURLY_BLOCKS,
  formatTanggalIndonesia,
  formatTanggalShort,
  getTodayIsoDateLocal,
  getTrackerButtonLabels,
  getTrackerGroupLabel,
  INTERN_HOURLY_BLOCK_DEFS,
  resolveInternTrackerItems,
} from '../utils/internship';
import { mergeTemplateConfig } from '../utils/theme';

interface InternAdminViewProps {
  db: MdaDatabase;
  canManageTrackerItems: boolean;
  templateConfig?: BrandingTemplateConfig;
  isBusy?: boolean;
  onSaveInternProfile: (profile: InternProfile) => Promise<boolean> | boolean;
  onSaveDailyLog: (log: InternDailyLog) => Promise<boolean> | boolean;
  onSaveTrackerItems: (items: InternTrackerItem[]) => Promise<boolean> | boolean;
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
  const tpl = mergeTemplateConfig(templateConfig || db.templateConfig, DEFAULT_TEMPLATE_CONFIG);
  const trackerItems = useMemo(() => resolveInternTrackerItems(tpl), [tpl]);

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

  // Detail & Pembimbing modal state
  const [inspectedStudentId, setInspectedStudentId] = useState<string | null>(null);
  const [modalDate, setModalDate] = useState<string>(() => getTodayIsoDateLocal());
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Modal Profile Edit state
  const [editTempat, setEditTempat] = useState('');
  const [editWaktu, setEditWaktu] = useState('');
  const [editKompetensi, setEditKompetensi] = useState('');
  const [editIncome, setEditIncome] = useState('0');
  const [editPembimbing, setEditPembimbing] = useState('');
  const [savingModalProfile, setSavingModalProfile] = useState(false);

  // Sub-tab 2: Tracker Items Config state
  const [draftItems, setDraftItems] = useState<InternTrackerItem[]>(trackerItems);
  const [newLabel, setNewLabel] = useState('');
  const [newGroup, setNewGroup] = useState<InternTrackerGroup>('lainnya');
  const [newMode, setNewMode] = useState<InternTrackerMode>('terlaksana');
  const [savingTrackerConfig, setSavingTrackerConfig] = useState(false);

  useEffect(() => {
    setDraftItems(trackerItems);
  }, [trackerItems]);

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
    return {
      totalStudentsInScope: studentsInClass.length,
      filledCount,
      missingCount: Math.max(0, studentsInClass.length - filledCount),
      trackerStatsOnDate,
    };
  }, [db.students, classFilter, logsByStudentDate, selectedDate, trackerItems]);

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

  const activeModalLog = useMemo(() => {
    if (!inspectedStudent) return undefined;
    return logsByStudentDate.get(`${inspectedStudent.id}_${modalDate}`);
  }, [inspectedStudent, logsByStudentDate, modalDate]);

  useEffect(() => {
    if (!inspectedStudent) return;
    setEditTempat(inspectedProfile?.tempatMagang || '');
    setEditWaktu(inspectedProfile?.waktuMagang || '');
    setEditKompetensi(inspectedProfile?.kompetensiMagang || '');
    setEditIncome(String(inspectedProfile?.incomeMagangRp ?? 0));
    setEditPembimbing(inspectedProfile?.pembimbingNama || '');
  }, [inspectedStudent, inspectedProfile]);

  useEffect(() => {
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

  const handleSaveSupervisorNote = async () => {
    if (!inspectedStudent || !activeModalLog) return;
    setSavingNote(true);
    try {
      await onSaveDailyLog({
        ...activeModalLog,
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
      await onSaveInternProfile({
        id: inspectedStudent.id,
        studentId: inspectedStudent.id,
        tempatMagang: editTempat.trim(),
        waktuMagang: editWaktu.trim(),
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
    setSavingTrackerConfig(true);
    try {
      await onSaveTrackerItems(cleaned);
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
            Magang &amp; Tracker Ibadah Harian
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pantau jurnaling 5 blok jam, mutabaah sholat berjamaah, amal kebersihan, catatan pembimbing, dan ekspor PDF.
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

          {/* Rekapitulasi Per Item Tracker Pada Tanggal Ini */}
          <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 space-y-2.5">
            <div className="text-xs font-bold text-slate-900 flex items-center justify-between gap-2">
              <span>
                Rekapitulasi ✓ vs ✗ Per Item ({formatTanggalShort(selectedDate)})
              </span>
              <span className="text-[11px] font-normal text-slate-500 tabular-nums">
                Dari {summaryStats.filledCount} santri yang mengisi
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
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
                              {prof?.kompetensiMagang && (
                                <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                                  {prof.kompetensiMagang}
                                </div>
                              )}
                              <div className="text-[11px] font-bold text-emerald-800 mt-0.5 tabular-nums">
                                Income: {formatRupiah(prof?.incomeMagangRp || 0)}
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top">
                              {log ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-[11px]">
                                  <Check className="w-3 h-3" />
                                  <span>Sudah Mengisi</span>
                                </span>
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
                                <div>
                                  <span className="font-bold text-emerald-700">
                                    ✓ {otherYes}/{nonSholatItems.length}
                                  </span>
                                  {(log.catatanPembimbing || '').trim() && (
                                    <div className="text-[10px] text-emerald-800 font-semibold mt-0.5">
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
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Detail</span>
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
                          <Eye className="w-3.5 h-3.5" />
                          <span>Detail &amp; Catatan</span>
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

          {/* Add New Item Form (Admin Only) */}
          {canManageTrackerItems && (
            <form
              onSubmit={handleAddTrackerItem}
              className="p-3.5 rounded-2xl bg-[#E8FAF3]/60 border border-emerald-200 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
            >
              <div className="sm:col-span-5">
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
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Label ✓ / ✗</label>
                <select
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value as InternTrackerMode)}
                  className="w-full min-h-[40px] px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-xl"
                >
                  <option value="terlaksana">Terlaksana / Tidak</option>
                  <option value="jamaah">Berjamaah / Tdk Jamaah</option>
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
            {draftItems.map((item, idx) => {
              const labels = getTrackerButtonLabels(item.mode);
              return (
                <div
                  key={item.id}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center"
                >
                  <div className="md:col-span-5">
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

                  <div className="md:col-span-2">
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
                      <option value="jamaah">✓ Berjamaah / ✗ Tdk Jamaah</option>
                      <option value="terlaksana">✓ Terlaksana / ✗ Tidak</option>
                    </select>
                    <div className="text-[10px] text-slate-500 mt-0.5 md:hidden">
                      Pilihan: ✓ {labels.yesLabel} / ✗ {labels.noLabel}
                    </div>
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
              );
            })}
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

            {/* Edit Profil Magang oleh Admin / Guru */}
            <form
              onSubmit={handleSaveModalProfile}
              className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-3"
            >
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-emerald-700" />
                <span>Profil Magang Santri</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Tempat Magang
                  </label>
                  <input
                    type="text"
                    value={editTempat}
                    onChange={(e) => setEditTempat(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Waktu Magang
                  </label>
                  <input
                    type="text"
                    value={editWaktu}
                    onChange={(e) => setEditWaktu(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl"
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
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl"
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
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-mono"
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
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
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

            {/* Date Selector & Journal Inspection */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Jurnal Tanggal: {formatTanggalIndonesia(modalDate)}</span>
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
                      <option value={modalDate}>Pilih riwayat ({inspectedStudentLogs.length} hari)</option>
                      {inspectedStudentLogs.map((l) => (
                        <option key={l.id} value={l.tanggal}>
                          {formatTanggalShort(l.tanggal)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {!activeModalLog ? (
                <div className="p-6 text-center border border-dashed border-slate-200 rounded-2xl text-xs text-slate-500">
                  Santri belum mengisi jurnal harian untuk tanggal {formatTanggalShort(modalDate)}.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Tracker Results */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {trackerItems.map((it) => {
                      const val = activeModalLog.trackerResults?.[it.id];
                      const labels = getTrackerButtonLabels(it.mode);
                      return (
                        <div
                          key={it.id}
                          className={`p-2.5 rounded-xl border text-xs ${
                            val === 'yes'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                              : val === 'no'
                                ? 'bg-rose-50 border-rose-200 text-rose-900'
                                : 'bg-slate-50 border-slate-200 text-slate-500'
                          }`}
                        >
                          <div className="font-bold truncate">{it.label}</div>
                          <div className="text-[11px] mt-0.5 font-semibold">
                            {val === 'yes'
                              ? `✓ ${labels.yesLabel}`
                              : val === 'no'
                                ? `✗ ${labels.noLabel}`
                                : 'Belum dipilih'}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 5 Blok Jam */}
                  <div className="space-y-2">
                    {INTERN_HOURLY_BLOCK_DEFS.map((def) => {
                      const txt = (
                        (activeModalLog.hourlyBlocks || EMPTY_HOURLY_BLOCKS)[def.key] || ''
                      ).trim();
                      return (
                        <div
                          key={def.key}
                          className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-xs"
                        >
                          <div className="font-bold font-mono text-emerald-800 text-[11px]">
                            {def.timeRange} · {def.shortLabel}
                          </div>
                          <p className="text-slate-700 mt-0.5 leading-relaxed whitespace-pre-line">
                            {txt || <span className="italic text-slate-400">Tidak diisi</span>}
                          </p>
                        </div>
                      );
                    })}
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
                        onClick={() => void handleSaveSupervisorNote()}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5 text-[#1DF27A]" />
                        <span>{savingNote ? 'Menyimpan...' : 'Simpan Catatan Pembimbing'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
