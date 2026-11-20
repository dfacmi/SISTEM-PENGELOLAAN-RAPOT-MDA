import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ClipboardPaste,
  Clock,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldAlert,
  Shuffle,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import {
  DEFAULT_DIGITAL_SKILLS,
  DEFAULT_DINIYAH_MAPEL,
  generateRandomCbtToken,
} from '../data/seedData';
import type {
  CbtAttempt,
  CbtDigitalScoreTarget,
  CbtExam,
  CbtExamStatus,
  CbtOptionKey,
  CbtQuestion,
  CbtTargetRaporCategory,
  MdaDatabase,
} from '../types/mda';
import {
  applyBulkAnswerKey,
  downloadQuestionTemplateXlsx,
  hasArabicText,
  ParsedQuestionDraft,
  parseQuestionsFromRawText,
  parseSpreadsheetQuestions,
  parseWordOrTextFileQuestions,
  validateQuestionDraft,
} from '../utils/cbtImportParser';
import { extractUniqueClasses, matchesClassFilter } from '../utils/grading';

interface CbtAdminViewProps {
  db: MdaDatabase;
  canManageRaporLock: boolean;
  isBusy: boolean;
  onToggleRaporLock: (locked: boolean, message: string) => Promise<void>;
  onSeedDefaultExams: () => Promise<void>;
  onSaveExam: (exam: CbtExam) => Promise<void>;
  onDeleteExam: (examId: string) => Promise<void>;
  onSaveQuestions: (examId: string, questions: CbtQuestion[]) => Promise<void>;
  onProctorAction: (params: {
    action: 'unlock' | 'reset' | 'sync_rapor' | 'bulk_sync_rapor';
    examId: string;
    attemptId?: string;
  }) => Promise<void>;
  onRefreshLive: () => Promise<void>;
  onShowToast: (type: 'ok' | 'err', text: string) => void;
}

type CbtSubTab = 'settings' | 'questions' | 'monitor';

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const CbtAdminView: React.FC<CbtAdminViewProps> = ({
  db,
  canManageRaporLock,
  isBusy,
  onToggleRaporLock,
  onSeedDefaultExams,
  onSaveExam,
  onDeleteExam,
  onSaveQuestions,
  onProctorAction,
  onRefreshLive,
  onShowToast,
}) => {
  const exams = db.cbtExams || [];
  const allQuestions = db.cbtQuestions || [];
  const allAttempts = db.cbtAttempts || [];

  const [selectedExamId, setSelectedExamId] = useState<string>(() => exams[0]?.id || '');
  const [subTab, setSubTab] = useState<CbtSubTab>('settings');

  // Exam week Rapor lock state
  const [raporLocked, setRaporLocked] = useState<boolean>(
    Boolean(db.templateConfig?.lockRaporDuringExam)
  );
  const [raporLockMsg, setRaporLockMsg] = useState<string>(
    db.templateConfig?.lockRaporMessage ||
      'Portal Rapor & Portofolio Wali Santri ditutup sementara selama Pekan Ujian berlangsung hingga pengumuman nilai selesai. Santri silakan masuk melalui tab Ruang Ujian CBT.'
  );

  useEffect(() => {
    setRaporLocked(Boolean(db.templateConfig?.lockRaporDuringExam));
    if (db.templateConfig?.lockRaporMessage) {
      setRaporLockMsg(db.templateConfig.lockRaporMessage);
    }
  }, [db.templateConfig?.lockRaporDuringExam, db.templateConfig?.lockRaporMessage]);

  useEffect(() => {
    if (exams.length > 0 && !exams.some((e) => e.id === selectedExamId)) {
      setSelectedExamId(exams[0].id);
    }
  }, [exams, selectedExamId]);

  const selectedExam = useMemo(
    () => exams.find((e) => e.id === selectedExamId) || exams[0] || null,
    [exams, selectedExamId]
  );

  const [examDraft, setExamDraft] = useState<CbtExam | null>(selectedExam);
  useEffect(() => {
    setExamDraft(selectedExam ? { ...selectedExam } : null);
  }, [selectedExam]);

  // Question Bank Draft State for selected exam
  const savedQuestionsForExam = useMemo(
    () =>
      allQuestions
        .filter((q) => q.examId === selectedExam?.id)
        .sort((a, b) => a.orderNumber - b.orderNumber),
    [allQuestions, selectedExam?.id]
  );

  const [questionDrafts, setQuestionDrafts] = useState<CbtQuestion[]>(savedQuestionsForExam);
  const [questionsDirty, setQuestionsDirty] = useState(false);

  useEffect(() => {
    setQuestionDrafts(savedQuestionsForExam);
    setQuestionsDirty(false);
  }, [savedQuestionsForExam, selectedExam?.id]);

  // Import & Parser state
  const [pasteText, setPasteText] = useState('');
  const [bulkKeysText, setBulkKeysText] = useState('');
  const [parsedPreview, setParsedPreview] = useState<ParsedQuestionDraft[] | null>(null);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [editingQuestion, setEditingQuestion] = useState<CbtQuestion | null>(null);

  // Live Monitor auto-refresh & dynamic class filter
  const [autoRefreshMonitor, setAutoRefreshMonitor] = useState(false);
  const [monitorClassFilter, setMonitorClassFilter] = useState<string>('ALL');
  const [expandedViolationId, setExpandedViolationId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const dynamicClasses = useMemo(
    () => extractUniqueClasses(db.students, db.teachers),
    [db.students, db.teachers]
  );

  useEffect(() => {
    if (subTab !== 'monitor') return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [subTab]);

  useEffect(() => {
    if (subTab !== 'monitor' || !autoRefreshMonitor) return;
    const t = setInterval(() => {
      void onRefreshLive();
    }, 10000);
    return () => clearInterval(t);
  }, [subTab, autoRefreshMonitor, onRefreshLive]);

  const diniyahSubjects = useMemo(() => {
    const base = DEFAULT_DINIYAH_MAPEL.map((d) => d.mataPelajaran);
    const custom = db.reports.flatMap((r) => r.diniyah.map((d) => d.mataPelajaran));
    return Array.from(new Set([...base, ...custom].filter((s) => s.trim() !== '')));
  }, [db.reports]);

  const digitalSubjects = useMemo(() => {
    const base = DEFAULT_DIGITAL_SKILLS.map((d) => d.materiSkill);
    const custom = db.reports.flatMap((r) => r.skillDigital.map((d) => d.materiSkill));
    return Array.from(new Set([...base, ...custom].filter((s) => s.trim() !== '')));
  }, [db.reports]);

  const handleCreateBlankExam = async () => {
    const activePeriod =
      db.periods.find((p) => p.isActive) || db.periods[db.periods.length - 1];
    const num = exams.length + 1;
    const newExam: CbtExam = {
      id: `cbt-mapel-${num}-${Date.now().toString(36)}`,
      title: `Ujian Mapel ${num}`,
      mapelCode: `MDA-0${num}`,
      deskripsi: 'Paket Ujian CBT Pilihan Ganda mandiri.',
      status: 'draft',
      token: generateRandomCbtToken(6),
      durationMinutes: 60,
      shuffleQuestions: true,
      shuffleOptions: true,
      maxViolations: 3,
      targetRaporMapping: { category: 'none', subjectName: '' },
      autoSyncToRapor: true,
      showScoreAfterFinish: true,
      tahunAkademik: activePeriod?.tahunAkademik || '2026/2027',
      semester: activePeriod?.semester || 'Gasal',
      updatedAt: new Date().toISOString(),
    };
    await onSaveExam(newExam);
    setSelectedExamId(newExam.id);
    setSubTab('settings');
  };

  const handleFileSpreadsheetImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedExam) return;
    try {
      const parsed = await parseSpreadsheetQuestions(file, selectedExam.id);
      if (parsed.length === 0) {
        onShowToast('err', 'Tidak ditemukan soal valid di file Excel/CSV tersebut.');
        return;
      }
      setParsedPreview(parsed);
      onShowToast('ok', `Berhasil membaca ${parsed.length} soal dari ${file.name}. Periksa pratinjau di bawah.`);
    } catch (err: any) {
      onShowToast('err', err.message || 'Gagal membaca file Excel/CSV.');
    }
  };

  const handleFileWordOrTxtImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedExam) return;
    try {
      const parsed = await parseWordOrTextFileQuestions(file, selectedExam.id);
      if (parsed.length === 0) {
        onShowToast('err', 'Tidak ada format soal bernomor (1. ... A. ... B. ...) yang terdeteksi.');
        return;
      }
      setParsedPreview(parsed);
      onShowToast('ok', `Berhasil mengekstrak ${parsed.length} soal dari ${file.name}. Periksa pratinjau di bawah.`);
    } catch (err: any) {
      onShowToast('err', err.message || 'Gagal membaca file Word/Teks.');
    }
  };

  const handleParsePasteBox = () => {
    if (!selectedExam || !pasteText.trim()) {
      onShowToast('err', 'Tempelkan naskah soal terlebih dahulu ke kotak Paste.');
      return;
    }
    const parsed = parseQuestionsFromRawText(pasteText, selectedExam.id);
    if (parsed.length === 0) {
      onShowToast('err', 'Format soal belum terbaca. Pastikan ada nomor soal (1.) dan pilihan A/B/C/D.');
      return;
    }
    const withKeys = bulkKeysText.trim() ? applyBulkAnswerKey(parsed, bulkKeysText) : parsed;
    setParsedPreview(withKeys);
    onShowToast('ok', `${withKeys.length} soal terdeteksi! Periksa pratinjau sebelum disimpan.`);
  };

  const handleApplyBulkKeysToPreviewOrBank = () => {
    if (!bulkKeysText.trim()) {
      onShowToast('err', 'Masukkan daftar kunci jawaban massal terlebih dahulu (misal: 1.A, 2.C, 3.B atau ABCD...).');
      return;
    }
    if (parsedPreview && parsedPreview.length > 0) {
      setParsedPreview((prev) => (prev ? applyBulkAnswerKey(prev, bulkKeysText) : prev));
      onShowToast('ok', 'Kunci jawaban massal diterapkan ke tabel pratinjau import.');
    } else if (questionDrafts.length > 0) {
      const asDrafts: ParsedQuestionDraft[] = questionDrafts.map((q) => ({
        ...q,
        keyExplicit: true,
        warnings: [],
      }));
      const updated = applyBulkAnswerKey(asDrafts, bulkKeysText).map(
        ({ warnings: _w, keyExplicit: _k, ...rest }) => rest
      );
      setQuestionDrafts(updated);
      setQuestionsDirty(true);
      onShowToast('ok', 'Kunci jawaban massal diterapkan ke Bank Soal. Klik "Simpan Bank Soal" untuk menyimpan permanen.');
    }
  };

  const handleCommitParsedPreview = () => {
    if (!parsedPreview || !selectedExam) return;
    const cleaned: CbtQuestion[] = parsedPreview.map(
      ({ warnings: _w, keyExplicit: _k, ...q }, idx) => ({
        ...q,
        examId: selectedExam.id,
        orderNumber: idx + 1,
      })
    );
    const merged =
      importMode === 'replace'
        ? cleaned
        : [...questionDrafts, ...cleaned].map((q, idx) => ({
            ...q,
            orderNumber: idx + 1,
          }));
    setQuestionDrafts(merged);
    setQuestionsDirty(true);
    setParsedPreview(null);
    setPasteText('');
    onShowToast(
      'ok',
      `${cleaned.length} soal masuk ke daftar soal. Klik "Simpan Bank Soal ke Google Sheets" untuk menyimpan permanen.`
    );
  };

  const handleSaveManualOrEditedQuestion = (q: CbtQuestion) => {
    const exists = questionDrafts.some((item) => item.id === q.id);
    const next = exists
      ? questionDrafts.map((item) => (item.id === q.id ? q : item))
      : [...questionDrafts, { ...q, orderNumber: questionDrafts.length + 1 }];
    setQuestionDrafts(next.map((item, idx) => ({ ...item, orderNumber: idx + 1 })));
    setQuestionsDirty(true);
    setEditingQuestion(null);
  };

  const examAttempts = useMemo(() => {
    if (!selectedExam) return [];
    const byStudent = new Map<string, CbtAttempt>();
    for (const att of allAttempts) {
      if (att.examId === selectedExam.id) {
        byStudent.set(att.studentId, att);
      }
    }
    return db.students
      .filter((stu) => matchesClassFilter(stu.kelas, monitorClassFilter))
      .map((stu) => ({
        student: stu,
        attempt: byStudent.get(stu.id) || null,
      }));
  }, [allAttempts, db.students, selectedExam, monitorClassFilter]);

  const submittedCountForSelected = examAttempts.filter(
    (row) => row.attempt?.status === 'submitted'
  ).length;

  return (
    <div className="space-y-5 min-w-0 max-w-full">
      {/* Header & Mode Pekan Ujian (Lock Rapor Toggle) */}
      <div className="bg-white border border-emerald-200/80 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span className="break-words">Modul Ujian CBT Pilihan Ganda (Anti-AI &amp; Web Lockdown)</span>
            </div>
            <h2 className="font-display font-bold text-slate-900 text-lg sm:text-xl mt-0.5 break-words">
              Manajemen 7 Paket Mapel Ujian Mandiri &amp; Pengawasan Live
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 break-words">
              Setiap mata pelajaran memiliki token, bank soal, durasi, acak soal/opsi, monitoring pelanggaran, dan pemetaan nilai rapor tersendiri.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto shrink-0">
            {exams.length < 7 && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void onSeedDefaultExams()}
                className="w-full sm:w-auto min-h-[40px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>Buat 7 Paket Mapel Standar MDA</span>
              </button>
            )}
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleCreateBlankExam()}
              className="w-full sm:w-auto min-h-[40px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-bold disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>Tambah Mapel Ujian</span>
            </button>
          </div>
        </div>

        {/* Mode Pekan Ujian Toggle Card */}
        {canManageRaporLock && (
          <div
            className={`p-3.5 rounded-xl border flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
              raporLocked
                ? 'bg-amber-50 border-amber-300'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-start sm:items-center gap-2">
                {raporLocked ? (
                  <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5 sm:mt-0" />
                ) : (
                  <LockOpen className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5 sm:mt-0" />
                )}
                <span className="text-xs font-bold text-slate-900 break-words">
                  Kunci Sementara Akses Rapor (Mode Pekan Ujian):{' '}
                  <span className={raporLocked ? 'text-amber-700' : 'text-emerald-700'}>
                    {raporLocked ? 'AKTIF (Portal Rapor Ditutup Sementara)' : 'NONAKTIF (Portal Rapor Terbuka)'}
                  </span>
                </span>
              </div>
              <input
                type="text"
                value={raporLockMsg}
                onChange={(e) => setRaporLockMsg(e.target.value)}
                placeholder="Pesan pemberitahuan saat Portal Rapor dikunci..."
                className="w-full min-w-0 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-700"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto shrink-0">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void onToggleRaporLock(!raporLocked, raporLockMsg)}
                className={`w-full sm:w-auto min-h-[40px] sm:min-h-0 px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${
                  raporLocked
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                }`}
              >
                {raporLocked ? (
                  <>
                    <Unlock className="w-3.5 h-3.5 shrink-0" />
                    <span>Buka Kembali Portal Rapor</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>Aktifkan Kunci Rapor</span>
                  </>
                )}
              </button>
              {raporLocked && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void onToggleRaporLock(true, raporLockMsg)}
                  className="w-full sm:w-auto min-h-[40px] sm:min-h-0 px-3 py-2 rounded-xl border border-amber-300 bg-white hover:bg-amber-100 text-amber-900 text-xs font-semibold text-center"
                >
                  Simpan Pesan
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Subject Cards Strip (1 Mapel = 1 Paket Ujian) */}
      {exams.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
          <BookOpen className="w-10 h-10 text-emerald-600 mx-auto" />
          <h3 className="font-display font-bold text-slate-900 text-base">
            Belum Ada Paket Ujian CBT
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Klik tombol &ldquo;Buat 7 Paket Mapel Standar MDA&rdquo; untuk langsung membuat 7 paket ujian terpisah (Aqidah, Akhlak, Fikih, Dakwah, UI/UX, Graphic Design, Videography).
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {exams.map((exam) => {
              const qCount = allQuestions.filter((q) => q.examId === exam.id).length;
              const isSelected = selectedExam?.id === exam.id;
              return (
                <button
                  key={exam.id}
                  type="button"
                  onClick={() => setSelectedExamId(exam.id)}
                  className={`text-left p-3.5 rounded-2xl border transition-all ${
                    isSelected
                      ? 'bg-[#0E2228] text-white border-[#0E2228] shadow-md'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                        isSelected ? 'bg-white/15 text-[#1DF27A]' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {exam.mapelCode || 'CBT'}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase ${
                        exam.status === 'active'
                          ? 'bg-emerald-500 text-white'
                          : exam.status === 'finished'
                            ? 'bg-slate-600 text-white'
                            : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {exam.status === 'active'
                        ? 'Aktif'
                        : exam.status === 'finished'
                          ? 'Selesai'
                          : 'Draft'}
                    </span>
                  </div>
                  <div className="font-display font-bold text-sm mt-2 truncate">
                    {exam.title}
                  </div>
                  <div
                    className={`mt-1.5 flex items-center justify-between text-[11px] ${
                      isSelected ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    <span>
                      {qCount} soal · {exam.durationMinutes} mnt
                    </span>
                    <span className="font-mono font-bold">
                      Token: {exam.token}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Subject Workspace */}
          {selectedExam && examDraft && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs min-w-0">
              {/* Subtabs Bar */}
              <div className="p-3 sm:px-5 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-emerald-700">
                    Paket Aktif: {selectedExam.mapelCode || 'CBT'}
                  </div>
                  <h3 className="font-display font-bold text-slate-900 text-base break-words">
                    {selectedExam.title}
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 w-full lg:w-auto">
                  <button
                    type="button"
                    onClick={() => setSubTab('settings')}
                    className={`flex-1 sm:flex-initial justify-center min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                      subTab === 'settings'
                        ? 'bg-[#0E2228] text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Settings2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Pengaturan &amp; Pemetaan Rapor</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubTab('questions')}
                    className={`flex-1 sm:flex-initial justify-center min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                      subTab === 'questions'
                        ? 'bg-[#0E2228] text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span>Bank Soal &amp; Import ({questionDrafts.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubTab('monitor')}
                    className={`flex-1 sm:flex-initial justify-center min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                      subTab === 'monitor'
                        ? 'bg-[#0E2228] text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>Monitoring Pengawas</span>
                  </button>
                </div>
              </div>

              {/* SUBTAB 1: SETTINGS & RAPOR MAPPING */}
              {subTab === 'settings' && (
                <div className="p-4 sm:p-6 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Nama Mata Pelajaran / Paket Ujian
                      </label>
                      <input
                        type="text"
                        value={examDraft.title}
                        onChange={(e) =>
                          setExamDraft({ ...examDraft, title: e.target.value })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Kode Mapel
                      </label>
                      <input
                        type="text"
                        value={examDraft.mapelCode || ''}
                        onChange={(e) =>
                          setExamDraft({ ...examDraft, mapelCode: e.target.value })
                        }
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Status Sesi Ujian
                      </label>
                      <select
                        value={examDraft.status}
                        onChange={(e) =>
                          setExamDraft({
                            ...examDraft,
                            status: e.target.value as CbtExamStatus,
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-semibold border border-slate-200 rounded-xl bg-white"
                      >
                        <option value="draft">Draft (Belum Dibuka ke Santri)</option>
                        <option value="active">Aktif (Santri Bisa Mulai Ujian)</option>
                        <option value="finished">Selesai / Ditutup</option>
                      </select>
                    </div>

                    <div className="min-w-0">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Token Ujian (6 Karakter)
                      </label>
                      <div className="flex gap-1.5 min-w-0">
                        <input
                          type="text"
                          value={examDraft.token}
                          onChange={(e) =>
                            setExamDraft({
                              ...examDraft,
                              token: e.target.value.toUpperCase(),
                            })
                          }
                          className="flex-1 min-w-0 px-3 py-2 text-xs font-mono font-bold tracking-widest border border-slate-200 rounded-xl uppercase"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setExamDraft({
                              ...examDraft,
                              token: generateRandomCbtToken(6),
                            })
                          }
                          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold inline-flex items-center gap-1 shrink-0"
                        >
                          <Shuffle className="w-3.5 h-3.5" />
                          <span>Acak</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Durasi Pengerjaan (Menit)
                      </label>
                      <input
                        type="number"
                        min={5}
                        max={240}
                        value={examDraft.durationMinutes}
                        onChange={(e) =>
                          setExamDraft({
                            ...examDraft,
                            durationMinutes: Math.max(5, Number(e.target.value) || 60),
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Batas Pelanggaran Web Lockdown
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={examDraft.maxViolations}
                        onChange={(e) =>
                          setExamDraft({
                            ...examDraft,
                            maxViolations: Math.max(1, Number(e.target.value) || 3),
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl"
                      />
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                    <label className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center gap-2.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={examDraft.shuffleQuestions}
                        onChange={(e) =>
                          setExamDraft({
                            ...examDraft,
                            shuffleQuestions: e.target.checked,
                          })
                        }
                        className="rounded text-emerald-600"
                      />
                      <span className="font-semibold text-slate-800">
                        Acak Urutan Soal per Santri
                      </span>
                    </label>
                    <label className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center gap-2.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={examDraft.shuffleOptions}
                        onChange={(e) =>
                          setExamDraft({
                            ...examDraft,
                            shuffleOptions: e.target.checked,
                          })
                        }
                        className="rounded text-emerald-600"
                      />
                      <span className="font-semibold text-slate-800">
                        Acak Opsi Jawaban (A/B/C/D)
                      </span>
                    </label>
                    <label className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center gap-2.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={examDraft.autoSyncToRapor}
                        onChange={(e) =>
                          setExamDraft({
                            ...examDraft,
                            autoSyncToRapor: e.target.checked,
                          })
                        }
                        className="rounded text-emerald-600"
                      />
                      <span className="font-semibold text-slate-800">
                        Otomatis Masukkan Nilai ke Rapor Saat Selesai
                      </span>
                    </label>
                    <label className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center gap-2.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={examDraft.showScoreAfterFinish}
                        onChange={(e) =>
                          setExamDraft({
                            ...examDraft,
                            showScoreAfterFinish: e.target.checked,
                          })
                        }
                        className="rounded text-emerald-600"
                      />
                      <span className="font-semibold text-slate-800">
                        Tampilkan Nilai Langsung ke Santri Setelah Selesai
                      </span>
                    </label>
                  </div>

                  {/* Target Rapor Mapping */}
                  <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 space-y-3">
                    <div>
                      <div className="text-xs font-bold text-emerald-950">
                        Pemetaan Target Nilai Rapor Semester (Sinkronisasi Aman ke UAS, 5 Pilar &amp; KKM)
                      </div>
                      <p className="text-[11px] text-emerald-800/90 mt-0.5">
                        Untuk mapel Diniyah &amp; Skill Digital, skor CBT masuk khusus ke komponen <strong>UAS</strong> tanpa menimpa nilai SK (Sikap), TG (Tugas), atau UL, lalu NR dihitung otomatis.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Kategori Kolom Rapor
                        </label>
                        <select
                          value={examDraft.targetRaporMapping.category}
                          onChange={(e) => {
                            const cat = e.target.value as CbtTargetRaporCategory;
                            const defaultSubject =
                              cat === 'diniyah'
                                ? diniyahSubjects[0] || 'Aqidah'
                                : cat === 'skillDigital'
                                  ? digitalSubjects[0] || 'UI/UX Design'
                                  : cat === 'tahfidz'
                                    ? 'Tahfidz Nilai Akhir'
                                    : '';
                            setExamDraft({
                              ...examDraft,
                              targetRaporMapping: {
                                category: cat,
                                subjectName: defaultSubject,
                                ...(cat === 'skillDigital'
                                  ? { digitalField: 'pengetahuan' }
                                  : {}),
                              },
                            });
                          }}
                          className="w-full px-3 py-2 text-xs border border-emerald-200 rounded-xl bg-white"
                        >
                          <option value="none">Tidak Disinkronkan ke Rapor</option>
                          <option value="diniyah">Mata Pelajaran Diniyah</option>
                          <option value="skillDigital">Kompetensi Skill Digital</option>
                          <option value="tahfidz">Tahfidzul Qur&apos;an</option>
                        </select>
                      </div>

                      {examDraft.targetRaporMapping.category !== 'none' && (
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            Target Mata Pelajaran / Materi
                          </label>
                          <select
                            value={examDraft.targetRaporMapping.subjectName}
                            onChange={(e) =>
                              setExamDraft({
                                ...examDraft,
                                targetRaporMapping: {
                                  ...examDraft.targetRaporMapping,
                                  subjectName: e.target.value,
                                },
                              })
                            }
                            className="w-full px-3 py-2 text-xs border border-emerald-200 rounded-xl bg-white"
                          >
                            {examDraft.targetRaporMapping.category === 'diniyah' &&
                              diniyahSubjects.map((s) => (
                                <option key={s} value={s}>
                                  Diniyah: {s}
                                </option>
                              ))}
                            {examDraft.targetRaporMapping.category === 'skillDigital' &&
                              digitalSubjects.map((s) => (
                                <option key={s} value={s}>
                                  Skill Digital: {s}
                                </option>
                              ))}
                            {examDraft.targetRaporMapping.category === 'tahfidz' && (
                              <>
                                <option value="Tahfidz Nilai Akhir">
                                  Tahfidz Nilai Akhir (Semua Aspek)
                                </option>
                                <option value="Kelancaran">Tahfidz: Kelancaran</option>
                                <option value="Tajwid">Tahfidz: Tajwid</option>
                                <option value="Makhraj">Tahfidz: Makhraj &amp; Fashahah</option>
                                <option value="Ketepatan Ayat">Tahfidz: Ketepatan Ayat</option>
                              </>
                            )}
                          </select>
                        </div>
                      )}

                      {examDraft.targetRaporMapping.category === 'skillDigital' && (
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            Kolom Nilai Skill Digital
                          </label>
                          <select
                            value={examDraft.targetRaporMapping.digitalField || 'pengetahuan'}
                            onChange={(e) =>
                              setExamDraft({
                                ...examDraft,
                                targetRaporMapping: {
                                  ...examDraft.targetRaporMapping,
                                  digitalField: e.target.value as CbtDigitalScoreTarget,
                                },
                              })
                            }
                            className="w-full px-3 py-2 text-xs border border-emerald-200 rounded-xl bg-white"
                          >
                            <option value="pengetahuan">Nilai Pengetahuan (Teori CBT)</option>
                            <option value="keterampilan">Nilai Keterampilan</option>
                            <option value="nilaiAkhir">Pengetahuan &amp; Keterampilan (Nilai Akhir)</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onDeleteExam(selectedExam.id)}
                      className="w-full sm:w-auto min-h-[40px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus Paket Mapel Ini</span>
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onSaveExam(examDraft)}
                      className="w-full sm:w-auto min-h-[40px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      <span>Simpan Pengaturan Paket Mapel</span>
                    </button>
                  </div>
                </div>
              )}

              {/* SUBTAB 2: QUESTION BANK & BULK IMPORT */}
              {subTab === 'questions' && (
                <div className="p-4 sm:p-6 space-y-5 min-w-0">
                  {/* Bulk Import Cards */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
                    {/* File Upload Card */}
                    <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3 min-w-0">
                      <div className="font-display font-bold text-sm text-slate-900 flex items-center gap-2">
                        <Upload className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span className="break-words">Upload File Soal (Excel / CSV / Word .docx / TXT)</span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        Untuk Excel/CSV gunakan kolom: <strong>Pertanyaan, Opsi A, Opsi B, Opsi C, Opsi D, Opsi E (opsional), Kunci Jawaban, URL Gambar (opsional)</strong>. Mendukung teks Arab RTL.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>Pilih Excel / CSV</span>
                          <input
                            type="file"
                            accept=".xlsx,.xls,.csv,.tsv"
                            onChange={(e) => void handleFileSpreadsheetImport(e)}
                            className="hidden"
                          />
                        </label>
                        <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-bold">
                          <FileText className="w-3.5 h-3.5 text-[#1DF27A]" />
                          <span>Pilih Word (.docx) / TXT</span>
                          <input
                            type="file"
                            accept=".docx,.txt"
                            onChange={(e) => void handleFileWordOrTxtImport(e)}
                            className="hidden"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => downloadQuestionTemplateXlsx(selectedExam.title)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-semibold"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download Template Excel</span>
                        </button>
                      </div>
                    </div>

                    {/* Paste & Bulk Keys Card */}
                    <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-2.5 min-w-0">
                      <div className="font-display font-bold text-sm text-slate-900 flex items-center gap-2">
                        <ClipboardPaste className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span className="break-words">Copy-Paste Soal + Kunci Jawaban Massal</span>
                      </div>
                      <textarea
                        rows={4}
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        placeholder={'Tempel soal di sini, contoh:\n1. Rukun iman yang pertama adalah...\nA. Iman kepada Allah\nB. Iman kepada Malaikat\nC. Iman kepada Kitab\nD. Iman kepada Rasul\nKunci: A'}
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
                      />
                      <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                        <input
                          type="text"
                          value={bulkKeysText}
                          onChange={(e) => setBulkKeysText(e.target.value)}
                          placeholder="Kunci Massal (opsional): 1.A, 2.C, 3.B atau ABCD..."
                          className="flex-1 min-w-0 px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl bg-white"
                        />
                        <button
                          type="button"
                          onClick={handleParsePasteBox}
                          className="w-full sm:w-auto min-h-[40px] sm:min-h-0 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shrink-0"
                        >
                          Ekstrak Soal Paste
                        </button>
                        <button
                          type="button"
                          onClick={handleApplyBulkKeysToPreviewOrBank}
                          className="w-full sm:w-auto min-h-[40px] sm:min-h-0 px-3 py-2 rounded-xl border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-800 text-xs font-semibold shrink-0"
                        >
                          Cocokkan Kunci
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Preview Table Before Adding to Bank */}
                  {parsedPreview && parsedPreview.length > 0 && (
                    <div className="p-3.5 sm:p-4 rounded-2xl border-2 border-emerald-400 bg-emerald-50/40 space-y-3 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-emerald-900">
                            Pratinjau Import: {parsedPreview.length} Soal Terdeteksi
                          </div>
                          <div className="text-[11px] text-slate-600 break-words">
                            Periksa kelengkapan opsi, kunci jawaban, dan tampilan Arab RTL sebelum dimasukkan ke Bank Soal.
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={importMode}
                            onChange={(e) =>
                              setImportMode(e.target.value as 'append' | 'replace')
                            }
                            className="w-full sm:w-auto max-w-full min-w-0 px-2.5 py-1.5 text-xs font-semibold border border-emerald-300 rounded-lg bg-white"
                          >
                            <option value="append">Tambahkan ke Bank Soal</option>
                            <option value="replace">Ganti Seluruh Soal Mapel Ini</option>
                          </select>
                          <button
                            type="button"
                            onClick={handleCommitParsedPreview}
                            className="flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                          >
                            Terapkan {parsedPreview.length} Soal
                          </button>
                          <button
                            type="button"
                            onClick={() => setParsedPreview(null)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold"
                          >
                            Batal
                          </button>
                        </div>
                      </div>

                      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                        {parsedPreview.map((q, idx) => (
                          <div
                            key={q.id}
                            className="p-3 rounded-xl bg-white border border-slate-200 text-xs space-y-1.5 min-w-0"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div
                                dir={hasArabicText(q.pertanyaan) ? 'rtl' : 'ltr'}
                                className={`font-semibold text-slate-900 flex-1 min-w-0 break-words ${
                                  hasArabicText(q.pertanyaan) ? 'text-right text-sm' : ''
                                }`}
                              >
                                {idx + 1}. {q.pertanyaan || '(Pertanyaan kosong)'}
                              </div>
                              <select
                                value={q.kunciJawaban}
                                onChange={(e) => {
                                  const nextKey = e.target.value as CbtOptionKey;
                                  setParsedPreview((prev) =>
                                    prev
                                      ? prev.map((item) => {
                                          if (item.id !== q.id) return item;
                                          const updated: ParsedQuestionDraft = {
                                            ...item,
                                            kunciJawaban: nextKey,
                                            keyExplicit: true,
                                          };
                                          updated.warnings = validateQuestionDraft(updated);
                                          return updated;
                                        })
                                      : prev
                                  );
                                }}
                                className="px-2 py-1 text-[11px] font-mono font-bold border border-emerald-300 rounded-md bg-emerald-50 text-emerald-900 shrink-0"
                              >
                                <option value="A">Kunci: A</option>
                                <option value="B">Kunci: B</option>
                                <option value="C">Kunci: C</option>
                                <option value="D">Kunci: D</option>
                                {q.opsiE && <option value="E">Kunci: E</option>}
                              </select>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-slate-600">
                              <span dir={hasArabicText(q.opsiA) ? 'rtl' : 'ltr'}>A. {q.opsiA}</span>
                              <span dir={hasArabicText(q.opsiB) ? 'rtl' : 'ltr'}>B. {q.opsiB}</span>
                              <span dir={hasArabicText(q.opsiC) ? 'rtl' : 'ltr'}>C. {q.opsiC}</span>
                              <span dir={hasArabicText(q.opsiD) ? 'rtl' : 'ltr'}>D. {q.opsiD}</span>
                              {q.opsiE && (
                                <span dir={hasArabicText(q.opsiE) ? 'rtl' : 'ltr'}>E. {q.opsiE}</span>
                              )}
                            </div>
                            {q.warnings.length > 0 && (
                              <div className="text-[11px] text-amber-700 font-semibold flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span>{q.warnings.join(' · ')}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Question Bank Header & Save Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
                    <div className="text-xs font-bold text-slate-800">
                      Daftar Bank Soal ({questionDrafts.length} Butir)
                      {questionsDirty && (
                        <span className="ml-2 px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px]">
                          Belum disimpan ke Google Sheets
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingQuestion({
                            id: `q-${selectedExam.id}-${Date.now().toString(36)}`,
                            examId: selectedExam.id,
                            orderNumber: questionDrafts.length + 1,
                            pertanyaan: '',
                            opsiA: '',
                            opsiB: '',
                            opsiC: '',
                            opsiD: '',
                            kunciJawaban: 'A',
                          })
                        }
                        className="w-full sm:w-auto min-h-[40px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Tambah Soal Manual</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void onSaveQuestions(selectedExam.id, questionDrafts)
                        }
                        className="w-full sm:w-auto min-h-[40px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Simpan Bank Soal Mapel Ini</span>
                      </button>
                    </div>
                  </div>

                  {/* Manual/Edit Modal Inline */}
                  {editingQuestion && (
                    <div className="p-4 rounded-2xl border-2 border-slate-800 bg-slate-50 space-y-3">
                      <div className="text-xs font-bold text-slate-900">
                        {questionDrafts.some((q) => q.id === editingQuestion.id)
                          ? `Edit Soal No. ${editingQuestion.orderNumber}`
                          : 'Tambah Soal Baru'}
                      </div>
                      <textarea
                        rows={3}
                        dir={hasArabicText(editingQuestion.pertanyaan) ? 'rtl' : 'ltr'}
                        value={editingQuestion.pertanyaan}
                        onChange={(e) =>
                          setEditingQuestion({
                            ...editingQuestion,
                            pertanyaan: e.target.value,
                          })
                        }
                        placeholder="Tulis pertanyaan (mendukung Latin & Arab RTL)..."
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {(['A', 'B', 'C', 'D', 'E'] as CbtOptionKey[]).map((opt) => {
                          const field = `opsi${opt}` as
                            | 'opsiA'
                            | 'opsiB'
                            | 'opsiC'
                            | 'opsiD'
                            | 'opsiE';
                          const val = editingQuestion[field] || '';
                          return (
                            <div key={opt}>
                              <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                                Opsi {opt} {opt === 'E' ? '(Opsional)' : ''}
                              </label>
                              <input
                                type="text"
                                dir={hasArabicText(val) ? 'rtl' : 'ltr'}
                                value={val}
                                onChange={(e) =>
                                  setEditingQuestion({
                                    ...editingQuestion,
                                    [field]: e.target.value,
                                  })
                                }
                                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                              />
                            </div>
                          );
                        })}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                            Kunci Jawaban Benar
                          </label>
                          <select
                            value={editingQuestion.kunciJawaban}
                            onChange={(e) =>
                              setEditingQuestion({
                                ...editingQuestion,
                                kunciJawaban: e.target.value as CbtOptionKey,
                              })
                            }
                            className="w-full px-3 py-1.5 text-xs font-bold border border-emerald-300 rounded-lg bg-white"
                          >
                            <option value="A">A</option>
                            <option value="B">B</option>
                            <option value="C">C</option>
                            <option value="D">D</option>
                            {editingQuestion.opsiE?.trim() && <option value="E">E</option>}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                            URL Gambar Soal (Opsional)
                          </label>
                          <input
                            type="url"
                            value={editingQuestion.imageUrl || ''}
                            onChange={(e) =>
                              setEditingQuestion({
                                ...editingQuestion,
                                imageUrl: e.target.value,
                              })
                            }
                            placeholder="https://..."
                            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingQuestion(null)}
                          className="w-full sm:w-auto min-h-[40px] sm:min-h-0 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveManualOrEditedQuestion(editingQuestion)}
                          className="w-full sm:w-auto min-h-[40px] sm:min-h-0 px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                        >
                          Simpan Butir Soal
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Question List */}
                  {questionDrafts.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-2xl">
                      Belum ada soal pada paket mapel ini. Upload file Excel/CSV/Word, tempel teks di atas, atau tambah soal secara manual.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {questionDrafts.map((q, idx) => (
                        <div
                          key={q.id}
                          className="p-3.5 rounded-xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                        >
                          <div className="flex-1 space-y-1.5 min-w-0">
                            <div
                              dir={hasArabicText(q.pertanyaan) ? 'rtl' : 'ltr'}
                              className={`text-xs font-bold text-slate-900 whitespace-pre-line break-words ${
                                hasArabicText(q.pertanyaan) ? 'text-right text-sm' : ''
                              }`}
                            >
                              {idx + 1}. {q.pertanyaan}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-slate-600">
                              {(['A', 'B', 'C', 'D', 'E'] as CbtOptionKey[]).map((opt) => {
                                const text =
                                  opt === 'A'
                                    ? q.opsiA
                                    : opt === 'B'
                                      ? q.opsiB
                                      : opt === 'C'
                                        ? q.opsiC
                                        : opt === 'D'
                                          ? q.opsiD
                                          : q.opsiE;
                                if (!text) return null;
                                const isKey = q.kunciJawaban === opt;
                                return (
                                  <div
                                    key={opt}
                                    dir={hasArabicText(text) ? 'rtl' : 'ltr'}
                                    className={`px-2 py-1 rounded-md break-words ${
                                      isKey
                                        ? 'bg-emerald-50 text-emerald-900 font-bold border border-emerald-200'
                                        : 'bg-slate-50'
                                    }`}
                                  >
                                    {opt}. {text}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setEditingQuestion({ ...q })}
                              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700"
                              title="Edit Soal"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setQuestionDrafts((prev) =>
                                  prev
                                    .filter((item) => item.id !== q.id)
                                    .map((item, i) => ({ ...item, orderNumber: i + 1 }))
                                );
                                setQuestionsDirty(true);
                              }}
                              className="p-2 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-600"
                              title="Hapus Soal"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SUBTAB 3: PROCTOR MONITORING */}
              {subTab === 'monitor' && (
                <div className="p-4 sm:p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <select
                        value={monitorClassFilter}
                        onChange={(e) => setMonitorClassFilter(e.target.value)}
                        aria-label="Filter Kelas Monitoring CBT"
                        className="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                      >
                        <option value="ALL">Semua Kelas ({db.students.length})</option>
                        {dynamicClasses.map((cls) => (
                          <option key={cls.key} value={cls.name}>
                            {cls.name} ({cls.count})
                          </option>
                        ))}
                      </select>
                      <span className="px-2.5 py-1 rounded-lg bg-slate-100 font-mono font-bold text-slate-800 inline-flex items-center gap-1">
                        <KeyRound className="w-3.5 h-3.5 text-emerald-700" />
                        Token: {selectedExam.token}
                      </span>
                      <span className="text-slate-500">
                        Selesai: <strong>{submittedCountForSelected}</strong> / {examAttempts.length} santri
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer min-h-[38px]">
                        <input
                          type="checkbox"
                          checked={autoRefreshMonitor}
                          onChange={(e) => setAutoRefreshMonitor(e.target.checked)}
                          className="rounded text-emerald-600"
                        />
                        <span>Auto-Refresh 10 dtk</span>
                      </label>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void onRefreshLive()}
                        className="flex-1 sm:flex-initial min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                        <span>Muat Status Terbaru</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || submittedCountForSelected === 0}
                        onClick={() =>
                          void onProctorAction({
                            action: 'bulk_sync_rapor',
                            examId: selectedExam.id,
                          })
                        }
                        className="w-full sm:w-auto min-h-[40px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Sinkronkan Semua Nilai ke Rapor</span>
                      </button>
                    </div>
                  </div>

                  <div className="w-full max-w-full overflow-x-auto border border-slate-200 rounded-2xl">
                    <table className="w-full min-w-[760px] text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3 font-bold">Santri</th>
                          <th className="py-2.5 px-3 font-bold">Status</th>
                          <th className="py-2.5 px-3 font-bold">Progres</th>
                          <th className="py-2.5 px-3 font-bold">Sisa Waktu</th>
                          <th className="py-2.5 px-3 font-bold">Pelanggaran</th>
                          <th className="py-2.5 px-3 font-bold">Skor</th>
                          <th className="py-2.5 px-3 font-bold text-right">Aksi Pengawas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {examAttempts.map(({ student, attempt }) => {
                          const answeredCount = attempt
                            ? Object.keys(attempt.answers || {}).length
                            : 0;
                          const totalQ =
                            attempt?.totalQuestions || savedQuestionsForExam.length;
                          let remainingSec = selectedExam.durationMinutes * 60;
                          if (attempt?.startedAt) {
                            const endMs =
                              new Date(attempt.startedAt).getTime() +
                              selectedExam.durationMinutes * 60 * 1000;
                            remainingSec = Math.max(0, Math.floor((endMs - nowTick) / 1000));
                          }

                          return (
                            <React.Fragment key={student.id}>
                              <tr className="hover:bg-slate-50/70">
                                <td className="py-2.5 px-3">
                                  <div className="font-bold text-slate-900">{student.nama}</div>
                                  <div className="text-[11px] font-mono text-slate-500">
                                    {student.nisnMda} · {student.kelas}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3">
                                  {!attempt ? (
                                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-semibold">
                                      Belum Mulai
                                    </span>
                                  ) : attempt.status === 'locked' ? (
                                    <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[11px] font-bold">
                                      Terkunci Pelanggaran
                                    </span>
                                  ) : attempt.status === 'submitted' ? (
                                    <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                                      Selesai
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 text-[11px] font-bold">
                                      Mengerjakan
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono">
                                  {attempt ? `${answeredCount}/${totalQ}` : `0/${totalQ}`}
                                </td>
                                <td className="py-2.5 px-3 font-mono">
                                  {attempt?.status === 'submitted' ? (
                                    <span className="text-slate-400">Selesai</span>
                                  ) : attempt ? (
                                    <span className="inline-flex items-center gap-1 text-slate-800">
                                      <Clock className="w-3 h-3 text-slate-400" />
                                      {formatCountdown(remainingSec)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  {attempt ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedViolationId(
                                          expandedViolationId === attempt.id ? null : attempt.id
                                        )
                                      }
                                      className={`px-2 py-0.5 rounded-md font-mono font-bold text-[11px] ${
                                        attempt.violationCount >= selectedExam.maxViolations
                                          ? 'bg-rose-100 text-rose-800'
                                          : attempt.violationCount > 0
                                            ? 'bg-amber-100 text-amber-800'
                                            : 'bg-slate-100 text-slate-600'
                                      }`}
                                    >
                                      {attempt.violationCount}/{selectedExam.maxViolations} log
                                    </button>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono font-bold">
                                  {typeof attempt?.score === 'number' ? (
                                    <div className="space-y-0.5">
                                      <span className="text-emerald-700 text-sm">
                                        {attempt.score}
                                      </span>
                                      {attempt.syncedToRaporAt && (
                                        <div className="text-[10px] font-sans text-emerald-600">
                                          Tersinkron Rapor
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  {attempt && (
                                    <div className="inline-flex flex-wrap justify-end gap-1.5">
                                      {attempt.status === 'locked' && (
                                        <button
                                          type="button"
                                          disabled={isBusy}
                                          onClick={() =>
                                            void onProctorAction({
                                              action: 'unlock',
                                              examId: selectedExam.id,
                                              attemptId: attempt.id,
                                            })
                                          }
                                          className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold inline-flex items-center gap-1"
                                        >
                                          <Unlock className="w-3 h-3" />
                                          <span>Buka Kunci</span>
                                        </button>
                                      )}
                                      {attempt.status === 'submitted' && (
                                        <button
                                          type="button"
                                          disabled={isBusy}
                                          onClick={() =>
                                            void onProctorAction({
                                              action: 'sync_rapor',
                                              examId: selectedExam.id,
                                              attemptId: attempt.id,
                                            })
                                          }
                                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold"
                                        >
                                          Sinkron ke Rapor
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() =>
                                          void onProctorAction({
                                            action: 'reset',
                                            examId: selectedExam.id,
                                            attemptId: attempt.id,
                                          })
                                        }
                                        className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-semibold inline-flex items-center gap-1"
                                      >
                                        <RotateCcw className="w-3 h-3" />
                                        <span>Reset</span>
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                              {expandedViolationId === attempt?.id && (
                                <tr>
                                  <td colSpan={7} className="bg-slate-50 px-4 py-3 text-[11px]">
                                    <div className="font-bold text-slate-800 mb-1">
                                      Riwayat Log Pelanggaran ({attempt.violations.length}):
                                    </div>
                                    {attempt.violations.length === 0 ? (
                                      <span className="text-slate-500">
                                        Tidak ada catatan pelanggaran.
                                      </span>
                                    ) : (
                                      <ul className="space-y-1 text-rose-700">
                                        {attempt.violations.map((v, i) => (
                                          <li key={i} className="font-mono">
                                            [{new Date(v.timestamp).toLocaleTimeString('id-ID')}] {v.type}:{' '}
                                            {v.detail}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
