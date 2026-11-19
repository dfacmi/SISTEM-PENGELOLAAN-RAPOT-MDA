import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  Clock,
  Flag,
  Grid,
  KeyRound,
  Lock,
  LogOut,
  Maximize2,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  fetchStudentCbtOverview,
  saveCbtAttemptProgressOnServer,
  startCbtExamOnServer,
  StudentCbtExamSummary,
  submitCbtExamOnServer,
} from '../services/backendApi';
import type {
  BrandingTemplateConfig,
  CbtAttempt,
  CbtExam,
  CbtOptionKey,
  CbtViolationLog,
  Student,
  StudentCbtQuestion,
} from '../types/mda';
import { getDisplayOptionsForQuestion, hasArabicText } from '../utils/cbtImportParser';
import { MdaLogo } from './MdaLogo';

interface CbtStudentViewProps {
  studentFallback?: Student | null;
  displayName: string;
  templateConfig: BrandingTemplateConfig;
  onLogout: () => Promise<void>;
}

type Stage = 'list' | 'confirm' | 'exam' | 'locked' | 'result';
type FontScale = 'sm' | 'md' | 'lg';

function formatTimer(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const CbtStudentView: React.FC<CbtStudentViewProps> = ({
  studentFallback,
  displayName,
  templateConfig,
  onLogout,
}) => {
  const [stage, setStage] = useState<Stage>('list');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [student, setStudent] = useState<Student | null>(studentFallback || null);
  const [exams, setExams] = useState<StudentCbtExamSummary[]>([]);
  const [attempts, setAttempts] = useState<CbtAttempt[]>([]);

  // Confirm & Exam active state
  const [selectedExam, setSelectedExam] = useState<StudentCbtExamSummary | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [activeExam, setActiveExam] = useState<CbtExam | null>(null);
  const [activeAttempt, setActiveAttempt] = useState<CbtAttempt | null>(null);
  const [questions, setQuestions] = useState<StudentCbtQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, CbtOptionKey>>({});
  const [raguIds, setRaguIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [fontScale, setFontScale] = useState<FontScale>('md');
  const [mobileGridOpen, setMobileGridOpen] = useState(false);
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  // Result state
  const [resultData, setResultData] = useState<{
    attempt: CbtAttempt;
    showScoreAfterFinish: boolean;
    syncedToRapor: boolean;
  } | null>(null);

  // Web Lockdown state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    () => Boolean(typeof document !== 'undefined' && document.fullscreenElement)
  );
  const [lockdownWarning, setLockdownWarning] = useState<string | null>(null);
  const [clockLabel, setClockLabel] = useState(() =>
    new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  );

  // Refs for debounced auto-save and avoiding stale closures
  const answersRef = useRef(answers);
  const raguRef = useRef(raguIds);
  const indexRef = useRef(currentIndex);
  const dirtyRef = useRef(false);
  const submittingRef = useRef(false);
  const pendingViolationsRef = useRef<CbtViolationLog[]>([]);
  const lastViolationAtRef = useRef<number>(0);
  const initialWindowSizeRef = useRef<{ w: number; h: number } | null>(null);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  useEffect(() => {
    raguRef.current = raguIds;
  }, [raguIds]);
  useEffect(() => {
    indexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    const t = setInterval(() => {
      setClockLabel(
        new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      );
    }, 30000);
    return () => clearInterval(t);
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchStudentCbtOverview();
      if (res.student) setStudent(res.student);
      setExams(res.exams);
      setAttempts(res.attempts);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat daftar ujian CBT.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const requestFullscreenSafe = async () => {
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      setIsFullscreen(Boolean(document.fullscreenElement));
    } catch {
      // Browser may block fullscreen in some environments; overlay handles gracefully
    }
  };

  const exitFullscreenSafe = async () => {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  };

  const flushProgressToServer = useCallback(
    async (immediateViolations: CbtViolationLog[] = []) => {
      if (!activeAttempt || stage !== 'exam') return;
      const toSendViolations = [
        ...pendingViolationsRef.current,
        ...immediateViolations,
      ];
      pendingViolationsRef.current = [];
      if (!dirtyRef.current && toSendViolations.length === 0) return;

      dirtyRef.current = false;
      setSaveIndicator('saving');
      try {
        const res = await saveCbtAttemptProgressOnServer({
          attemptId: activeAttempt.id,
          answers: answersRef.current,
          raguIds: raguRef.current,
          currentQuestionIndex: indexRef.current,
          newViolations: toSendViolations.length > 0 ? toSendViolations : undefined,
        });
        setActiveAttempt(res.attempt);
        if (typeof res.remainingSeconds === 'number') {
          setRemainingSeconds(res.remainingSeconds);
        }
        if (res.locked || res.attempt.status === 'locked') {
          setStage('locked');
          void exitFullscreenSafe();
        }
        setSaveIndicator('saved');
      } catch (err: any) {
        if (err?.code === 'ATTEMPT_LOCKED') {
          if (err.attempt) setActiveAttempt(err.attempt);
          setStage('locked');
          void exitFullscreenSafe();
          return;
        }
        setSaveIndicator('error');
        if (toSendViolations.length > 0) {
          pendingViolationsRef.current = [
            ...toSendViolations,
            ...pendingViolationsRef.current,
          ];
        }
        dirtyRef.current = true;
      }
    },
    [activeAttempt, stage]
  );

  // Debounced auto-save every 10 seconds when answers/ragu/index changed
  useEffect(() => {
    if (stage !== 'exam' || !activeAttempt) return;
    const timer = setInterval(() => {
      if (dirtyRef.current || pendingViolationsRef.current.length > 0) {
        void flushProgressToServer();
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [stage, activeAttempt, flushProgressToServer]);

  const handleFinalSubmit = useCallback(async () => {
    if (!activeAttempt || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setShowSubmitConfirm(false);
    setErrorMsg(null);
    try {
      const res = await submitCbtExamOnServer({
        attemptId: activeAttempt.id,
        answers: answersRef.current,
        raguIds: raguRef.current,
      });
      setResultData(res);
      setStage('result');
      void exitFullscreenSafe();
      void loadOverview();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengumpulkan ujian. Coba tekan Selesai lagi.');
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }, [activeAttempt, loadOverview]);

  // Countdown tick + auto-submit on timeout
  useEffect(() => {
    if (stage !== 'exam') return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          void handleFinalSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [stage, handleFinalSubmit]);

  // Record Web Lockdown violation with 1.5s debounce to prevent double-counting blur + visibilitychange
  const recordViolation = useCallback(
    (type: CbtViolationLog['type'], detail: string) => {
      if (stage !== 'exam' || !activeExam || !activeAttempt) return;
      const now = Date.now();
      if (now - lastViolationAtRef.current < 1500 && type !== 'fullscreen_exit') {
        return;
      }
      lastViolationAtRef.current = now;
      const log: CbtViolationLog = {
        timestamp: new Date().toISOString(),
        type,
        detail,
      };
      setLockdownWarning(
        `Peringatan Web Lockdown: ${detail}. Pelanggaran tercatat ke Pengawas!`
      );
      void flushProgressToServer([log]);
    },
    [stage, activeExam, activeAttempt, flushProgressToServer]
  );

  // Fullscreen, visibilitychange, window blur, split-screen, and keyboard/copy lockdown listeners
  useEffect(() => {
    if (stage !== 'exam') return;

    initialWindowSizeRef.current = {
      w: window.innerWidth,
      h: window.innerHeight,
    };

    const onFullscreenChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (!fs) {
        recordViolation(
          'fullscreen_exit',
          'Keluar dari mode layar penuh (Fullscreen)'
        );
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        recordViolation(
          'tab_switch',
          'Berpindah tab atau meminimalkan browser saat ujian berlangsung'
        );
      }
    };

    const onWindowBlur = () => {
      if (document.activeElement && document.activeElement.tagName === 'IFRAME') return;
      recordViolation(
        'window_blur',
        'Fokus jendela ujian berpindah ke aplikasi atau jendela lain'
      );
    };

    const onResize = () => {
      const init = initialWindowSizeRef.current;
      if (!init) return;
      if (
        window.innerWidth < init.w * 0.65 ||
        window.innerHeight < init.h * 0.65
      ) {
        recordViolation(
          'split_screen',
          'Ukuran layar menyusut drastis (terdeteksi split-screen / floating window)'
        );
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (
        e.key === 'F12' ||
        (ctrlOrMeta && ['c', 'v', 'x', 'a', 'u', 's', 'p'].includes(key)) ||
        (ctrlOrMeta && e.shiftKey && ['i', 'j', 'c', 'k'].includes(key))
      ) {
        e.preventDefault();
        e.stopPropagation();
        setLockdownWarning(
          'Pintasan keyboard (Copy/Paste/Inspect/Print) dinonaktifkan selama ujian CBT.'
        );
      }
    };

    const blockEvent = (e: Event) => {
      e.preventDefault();
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('contextmenu', blockEvent);
    document.addEventListener('copy', blockEvent);
    document.addEventListener('cut', blockEvent);
    document.addEventListener('dragstart', blockEvent);

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('contextmenu', blockEvent);
      document.removeEventListener('copy', blockEvent);
      document.removeEventListener('cut', blockEvent);
      document.removeEventListener('dragstart', blockEvent);
    };
  }, [stage, recordViolation]);

  const handleStartExam = async (exam: StudentCbtExamSummary, existingAttempt?: CbtAttempt) => {
    setBusy(true);
    setErrorMsg(null);
    setLockdownWarning(null);
    await requestFullscreenSafe();
    try {
      const res = await startCbtExamOnServer({
        examId: exam.id,
        token: existingAttempt ? undefined : tokenInput.trim().toUpperCase(),
      });
      if (res.alreadySubmitted) {
        setActiveExam(res.exam);
        setResultData({
          attempt: res.attempt,
          showScoreAfterFinish: res.exam.showScoreAfterFinish,
          syncedToRapor: Boolean(res.syncedToRapor || res.attempt.syncedToRaporAt),
        });
        setStage('result');
        void exitFullscreenSafe();
        void loadOverview();
        return;
      }
      setActiveExam(res.exam);
      setActiveAttempt(res.attempt);
      setQuestions(res.questions);
      setAnswers(res.attempt.answers || {});
      setRaguIds(res.attempt.raguIds || []);
      setCurrentIndex(
        Math.min(
          Math.max(0, res.attempt.currentQuestionIndex || 0),
          Math.max(0, res.questions.length - 1)
        )
      );
      setRemainingSeconds(res.remainingSeconds);
      dirtyRef.current = false;
      setSaveIndicator('saved');
      setStage('exam');
    } catch (err: any) {
      if (err?.code === 'ATTEMPT_LOCKED') {
        if (err.attempt) setActiveAttempt(err.attempt);
        setActiveExam(exam);
        setStage('locked');
        void exitFullscreenSafe();
      } else {
        setErrorMsg(err.message || 'Gagal memulai ujian CBT.');
        void exitFullscreenSafe();
      }
    } finally {
      setBusy(false);
    }
  };

  const currentQuestion = questions[currentIndex] || null;
  const displayedOptions = useMemo(() => {
    if (!currentQuestion || !activeAttempt || !activeExam) return [];
    return getDisplayOptionsForQuestion(
      currentQuestion,
      activeAttempt.id,
      Boolean(activeExam.shuffleOptions)
    );
  }, [currentQuestion, activeAttempt, activeExam]);

  const answeredCount = Object.keys(answers).length;
  const raguSet = useMemo(() => new Set(raguIds), [raguIds]);
  const unansweredCount = Math.max(0, questions.length - answeredCount);

  const selectAnswer = (questionId: string, canonicalKey: CbtOptionKey) => {
    setAnswers((prev) => ({ ...prev, [questionId]: canonicalKey }));
    dirtyRef.current = true;
    setSaveIndicator('idle');
  };

  const toggleRagu = (questionId: string) => {
    setRaguIds((prev) =>
      prev.includes(questionId) ? prev.filter((id) => id !== questionId) : [...prev, questionId]
    );
    dirtyRef.current = true;
    setSaveIndicator('idle');
  };

  const studentTitle = student?.nama || displayName;
  const studentNisn = student?.nisnMda || '-';

  // ==========================================
  // STAGE 4: INSTANT RESULT CARD
  // ==========================================
  if (stage === 'result' && resultData && activeExam) {
    const att = resultData.attempt;
    return (
      <div className="min-h-screen bg-[#E8FAF3] flex items-center justify-center p-4 font-[Arial]">
        <div className="max-w-lg w-full bg-white border border-emerald-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-5 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 border border-emerald-200 flex items-center justify-center mx-auto">
            <Award className="w-8 h-8 text-emerald-700" />
          </div>
          <div>
            <div className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
              Ujian Selesai &amp; Tersimpan Aman
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
              {activeExam.title}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Peserta: <strong>{studentTitle}</strong> ({studentNisn})
            </p>
          </div>

          {resultData.showScoreAfterFinish && typeof att.score === 'number' ? (
            <div className="p-5 rounded-2xl bg-[#0E2228] text-white space-y-3">
              <div className="text-xs text-slate-300 uppercase tracking-wider">Nilai Akhir Ujian</div>
              <div className="text-5xl font-bold text-[#1DF27A]">{att.score}</div>
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/15 text-xs">
                <div>
                  <div className="text-slate-400">Benar</div>
                  <div className="font-bold text-emerald-300 text-base">{att.benarCount ?? 0}</div>
                </div>
                <div>
                  <div className="text-slate-400">Salah</div>
                  <div className="font-bold text-rose-300 text-base">{att.salahCount ?? 0}</div>
                </div>
                <div>
                  <div className="text-slate-400">Total Soal</div>
                  <div className="font-bold text-white text-base">{att.totalQuestions ?? 0}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 leading-relaxed">
              Seluruh jawaban Anda telah berhasil dikumpulkan dan dikunci di server. Nilai akan diumumkan oleh Ustadz / Pengawas sesuai jadwal.
            </div>
          )}

          {resultData.syncedToRapor && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
              <CheckCircle2 className="w-4 h-4" />
              <span>Nilai otomatis tersinkron ke Rapor Semester</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setStage('list');
              setResultData(null);
              setActiveExam(null);
              setActiveAttempt(null);
              setSelectedExam(null);
              setTokenInput('');
              void loadOverview();
            }}
            className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
          >
            Kembali ke Daftar Mapel Ujian
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // STAGE LOCKED: VIOLATION LOCK SCREEN
  // ==========================================
  if (stage === 'locked') {
    return (
      <div className="min-h-screen bg-rose-950 flex items-center justify-center p-4 font-[Arial]">
        <div className="max-w-md w-full bg-white border border-rose-300 rounded-3xl p-6 sm:p-8 text-center space-y-4 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-rose-100 border border-rose-200 flex items-center justify-center mx-auto">
            <Lock className="w-7 h-7 text-rose-700" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">
            Ujian Terkunci - Hubungi Pengawas
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Sistem Web Lockdown mendeteksi pelanggaran berulang ({activeAttempt?.violationCount ?? 0}{' '}
            kali) pada ujian <strong>{activeExam?.title || selectedExam?.title}</strong>. Jawaban Anda hingga detik terakhir telah tersimpan aman.
          </p>
          <p className="text-xs text-rose-700 font-semibold">
            Silakan lapor ke Pengawas Ruang Ujian agar akun Anda dibuka kuncinya untuk melanjutkan mengerjakan.
          </p>

          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const target = selectedExam || (activeExam as StudentCbtExamSummary | null);
                if (target) {
                  await handleStartExam(target, activeAttempt || undefined);
                } else {
                  setStage('list');
                  await loadOverview();
                }
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              <span>Cek Status Buka Kunci dari Pengawas</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setStage('list');
                void loadOverview();
              }}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
            >
              Kembali ke Daftar Mapel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // STAGE 3: ATK/ANBK CBT EXAM SHEET + LOCKDOWN
  // ==========================================
  if (stage === 'exam' && activeExam && activeAttempt) {
    const watermarkText = `${studentTitle} • ${studentNisn} • ${clockLabel}`;
    const questionTextSize =
      fontScale === 'sm' ? 'text-sm' : fontScale === 'lg' ? 'text-lg' : 'text-base';
    const optionTextSize =
      fontScale === 'sm' ? 'text-xs' : fontScale === 'lg' ? 'text-base' : 'text-sm';

    return (
      <div className="min-h-screen bg-slate-100 flex flex-col select-none font-[Arial] relative overflow-x-hidden">
        {/* Diagonal Repeating Anti-Screenshot/Anti-AI Watermark */}
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 pointer-events-none overflow-hidden opacity-[0.06]"
        >
          <div className="grid grid-cols-3 gap-12 -rotate-24 scale-125 py-8">
            {Array.from({ length: 18 }).map((_, idx) => (
              <div
                key={idx}
                className="text-xs font-bold text-slate-900 whitespace-nowrap text-center"
              >
                {watermarkText}
              </div>
            ))}
          </div>
        </div>

        {/* Fullscreen Re-entry Blocker Overlay if student exits fullscreen mid-exam */}
        {!isFullscreen && (
          <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-7 text-center space-y-4 shadow-2xl">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-amber-300 flex items-center justify-center mx-auto">
                <Maximize2 className="w-6 h-6 text-amber-700" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                Mode Layar Penuh (Fullscreen) Wajib Aktif
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Demi ketertiban dan Web Lockdown ujian CBT, lembar soal hanya dapat dilihat dalam mode layar penuh. Pelanggaran tercatat:{' '}
                <strong className="text-rose-700">
                  {activeAttempt.violationCount}/{activeExam.maxViolations}
                </strong>
                .
              </p>
              <button
                type="button"
                onClick={() => void requestFullscreenSafe()}
                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-2"
              >
                <Maximize2 className="w-4 h-4" />
                <span>Masuk Kembali ke Fullscreen &amp; Lanjutkan Ujian</span>
              </button>
            </div>
          </div>
        )}

        {/* Top ATK/ANBK Exam Header */}
        <header className="sticky top-0 z-20 bg-[#0E2228] text-white px-3 sm:px-6 py-3 shadow-md">
          <div className="max-w-[1360px] mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="bg-white rounded-xl px-2.5 py-1 shrink-0 hidden sm:block">
                <MdaLogo size="sm" customLogoUrl={templateConfig.customLogoUrl} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] text-[#1DF27A] font-bold truncate">
                  {activeExam.title} · {studentTitle} ({studentNisn})
                </div>
                <div className="text-xs text-slate-300 flex items-center gap-2 mt-0.5">
                  <span>
                    Soal {currentIndex + 1} / {questions.length}
                  </span>
                  <span>·</span>
                  <span>
                    {saveIndicator === 'saving'
                      ? 'Menyimpan...'
                      : saveIndicator === 'error'
                        ? 'Menunggu koneksi simpan'
                        : 'Tersimpan otomatis'}
                  </span>
                  {activeAttempt.violationCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/30 text-rose-200 font-bold text-[10px]">
                      Pelanggaran: {activeAttempt.violationCount}/{activeExam.maxViolations}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {/* Font Size Adjuster */}
              <div className="inline-flex items-center rounded-lg bg-white/10 p-0.5 text-xs">
                {(['sm', 'md', 'lg'] as FontScale[]).map((sz, idx) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setFontScale(sz)}
                    className={`px-2 py-1 rounded-md font-bold transition-colors ${
                      fontScale === sz
                        ? 'bg-white text-slate-900'
                        : 'text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    {idx === 0 ? 'A-' : idx === 1 ? 'A' : 'A+'}
                  </button>
                ))}
              </div>

              {/* Mobile Daftar Soal Drawer Toggle */}
              <button
                type="button"
                onClick={() => setMobileGridOpen(true)}
                className="lg:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold"
              >
                <Grid className="w-4 h-4 text-[#1DF27A]" />
                <span>
                  {answeredCount}/{questions.length}
                </span>
              </button>

              {/* Countdown Timer */}
              <div
                className={`px-3.5 py-2 rounded-xl font-mono font-bold text-base sm:text-lg flex items-center gap-1.5 ${
                  remainingSeconds <= 300
                    ? 'bg-rose-600 text-white animate-pulse'
                    : 'bg-emerald-500/20 border border-emerald-400/40 text-[#1DF27A]'
                }`}
              >
                <Clock className="w-4 h-4 shrink-0" />
                <span>{formatTimer(remainingSeconds)}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Lockdown Toast Banner */}
        {lockdownWarning && (
          <div className="bg-amber-50 border-b border-amber-300 px-4 py-2 text-xs text-amber-900 flex items-center justify-between gap-2 z-20">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
              <span>{lockdownWarning}</span>
            </span>
            <button
              type="button"
              onClick={() => setLockdownWarning(null)}
              className="text-amber-700 hover:text-amber-950 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="bg-rose-50 border-b border-rose-200 px-4 py-2 text-xs text-rose-800 font-semibold z-20">
            {errorMsg}
          </div>
        )}

        {/* Main Exam Body: 1 Question + Side Grid */}
        <main className="flex-1 max-w-[1360px] w-full mx-auto p-3 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start relative z-10">
          {/* Question Card */}
          <div className="lg:col-span-8 xl:col-span-9 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden flex flex-col">
            {currentQuestion && (
              <div className="p-5 sm:p-7 space-y-6 flex-1">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <span className="px-3 py-1 rounded-lg bg-[#0E2228] text-white text-xs font-bold">
                    SOAL NO. {currentIndex + 1}
                  </span>
                  {raguSet.has(currentQuestion.id) && (
                    <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 text-xs font-bold inline-flex items-center gap-1">
                      <Flag className="w-3.5 h-3.5" />
                      <span>Ditandai Ragu-Ragu</span>
                    </span>
                  )}
                </div>

                {/* Question Prompt (Arial + Auto RTL for Arabic) */}
                <div
                  dir={hasArabicText(currentQuestion.pertanyaan) ? 'rtl' : 'ltr'}
                  className={`font-[Arial] text-slate-900 whitespace-pre-line font-semibold ${questionTextSize} ${
                    hasArabicText(currentQuestion.pertanyaan)
                      ? 'text-right leading-loose text-xl'
                      : 'leading-relaxed'
                  }`}
                >
                  {currentQuestion.pertanyaan}
                </div>

                {currentQuestion.imageUrl && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 inline-block">
                    <img
                      src={currentQuestion.imageUrl}
                      alt={`Ilustrasi Soal ${currentIndex + 1}`}
                      referrerPolicy="no-referrer"
                      className="max-h-72 rounded-lg object-contain"
                    />
                  </div>
                )}

                {/* Answer Options */}
                <div className="space-y-2.5 pt-1">
                  {displayedOptions.map((opt) => {
                    const isSelected = answers[currentQuestion.id] === opt.canonicalKey;
                    const isArabicOpt = hasArabicText(opt.text);
                    return (
                      <button
                        key={opt.canonicalKey}
                        type="button"
                        onClick={() => selectAnswer(currentQuestion.id, opt.canonicalKey)}
                        className={`w-full text-left p-3.5 sm:p-4 rounded-xl border-2 flex items-center gap-3.5 transition-all ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-50 shadow-xs'
                            : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                            isSelected
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {opt.displayLetter}
                        </span>
                        <span
                          dir={isArabicOpt ? 'rtl' : 'ltr'}
                          className={`flex-1 font-[Arial] text-slate-800 ${optionTextSize} ${
                            isArabicOpt ? 'text-right leading-loose' : ''
                          } ${isSelected ? 'font-bold text-emerald-950' : ''}`}
                        >
                          {opt.text}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Bottom ATK/ANBK Navigation Bar */}
            <div className="p-4 sm:px-7 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => {
                  const nextIdx = Math.max(0, currentIndex - 1);
                  setCurrentIndex(nextIdx);
                  dirtyRef.current = true;
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold disabled:opacity-40"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Sebelumnya</span>
              </button>

              {currentQuestion && (
                <button
                  type="button"
                  onClick={() => toggleRagu(currentQuestion.id)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                    raguSet.has(currentQuestion.id)
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
                  }`}
                >
                  <Flag className="w-4 h-4" />
                  <span>Ragu-Ragu</span>
                </button>
              )}

              {currentIndex < questions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    const nextIdx = Math.min(questions.length - 1, currentIndex + 1);
                    setCurrentIndex(nextIdx);
                    dirtyRef.current = true;
                  }}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-bold"
                >
                  <span>Berikutnya</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowSubmitConfirm(true)}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Selesai &amp; Kumpulkan</span>
                </button>
              )}
            </div>
          </div>

          {/* Desktop Question Number Grid Panel */}
          <aside className="hidden lg:block lg:col-span-4 xl:col-span-3 bg-white border border-slate-200 rounded-2xl p-4 space-y-4 sticky top-24 shadow-xs">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                Daftar Nomor Soal
              </h4>
              <span className="text-xs font-bold text-emerald-700">
                {answeredCount}/{questions.length}
              </span>
            </div>

            <div className="grid grid-cols-5 gap-1.5 max-h-[55vh] overflow-y-auto pr-1">
              {questions.map((q, idx) => {
                const isCurrent = idx === currentIndex;
                const isRagu = raguSet.has(q.id);
                const isAnswered = Boolean(answers[q.id]);
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      setCurrentIndex(idx);
                      dirtyRef.current = true;
                    }}
                    className={`h-9 rounded-lg text-xs font-bold transition-all ${
                      isRagu
                        ? 'bg-amber-400 text-slate-950'
                        : isAnswered
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    } ${isCurrent ? 'ring-2 ring-slate-950 ring-offset-1 scale-105' : ''}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5 text-[11px] text-slate-600 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-emerald-600 inline-block" />
                <span>Sudah Dijawab ({answeredCount})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-amber-400 inline-block" />
                <span>Ragu-Ragu ({raguIds.length})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-slate-200 inline-block" />
                <span>Belum Dijawab ({unansweredCount})</span>
              </div>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => setShowSubmitConfirm(true)}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Selesai &amp; Kumpulkan</span>
            </button>
          </aside>
        </main>

        {/* Mobile Question Grid Drawer */}
        {mobileGridOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-950/60 flex items-end sm:items-center justify-center p-0 sm:p-4 lg:hidden"
            onClick={() => setMobileGridOpen(false)}
          >
            <div
              className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[82vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-900 text-sm">
                  Daftar Soal ({answeredCount}/{questions.length} Terjawab)
                </h4>
                <button
                  type="button"
                  onClick={() => setMobileGridOpen(false)}
                  className="p-1.5 rounded-lg bg-slate-100 text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {questions.map((q, idx) => {
                  const isCurrent = idx === currentIndex;
                  const isRagu = raguSet.has(q.id);
                  const isAnswered = Boolean(answers[q.id]);
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => {
                        setCurrentIndex(idx);
                        dirtyRef.current = true;
                        setMobileGridOpen(false);
                      }}
                      className={`h-10 rounded-xl text-xs font-bold ${
                        isRagu
                          ? 'bg-amber-400 text-slate-950'
                          : isAnswered
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 text-slate-700'
                      } ${isCurrent ? 'ring-2 ring-slate-950 ring-offset-1' : ''}`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMobileGridOpen(false);
                  setShowSubmitConfirm(true);
                }}
                className="w-full py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                Selesai &amp; Kumpulkan Ujian
              </button>
            </div>
          </div>
        )}

        {/* Submit Confirmation Modal */}
        {showSubmitConfirm && (
          <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-3xl p-6 space-y-4 shadow-2xl">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-700" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Kumpulkan Jawaban Ujian?
                  </h3>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Terjawab: <strong>{answeredCount}</strong> dari{' '}
                    <strong>{questions.length}</strong> soal.
                    {unansweredCount > 0 && (
                      <span className="text-rose-700 font-semibold">
                        {' '}
                        Masih ada {unansweredCount} soal belum dijawab.
                      </span>
                    )}
                    {raguIds.length > 0 && (
                      <span className="text-amber-700 font-semibold">
                        {' '}
                        Masih ada {raguIds.length} soal ditandai Ragu-Ragu.
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSubmitConfirm(false)}
                  className="flex-1 py-2.5 px-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50"
                >
                  Periksa Lagi
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleFinalSubmit()}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                >
                  {busy ? 'Mengumpulkan...' : 'Ya, Kumpulkan Sekarang'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // STAGE 2: CONFIRMATION & TOKEN SCREEN
  // ==========================================
  if (stage === 'confirm' && selectedExam) {
    const existingAttempt = attempts.find((a) => a.examId === selectedExam.id);
    const isResuming = existingAttempt?.status === 'in_progress';
    return (
      <div className="min-h-screen bg-[#E8FAF3] flex items-center justify-center p-4 font-[Arial]">
        <div className="max-w-lg w-full bg-white border border-emerald-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-5">
          <button
            type="button"
            onClick={() => {
              setStage('list');
              setErrorMsg(null);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Kembali ke Daftar Mapel</span>
          </button>

          <div>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-bold">
              {selectedExam.mapelCode || 'UJIAN CBT'}
            </span>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-2">
              {selectedExam.title}
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
            <div>
              <div className="text-slate-500">Nama Peserta</div>
              <div className="font-bold text-slate-900 mt-0.5">{studentTitle}</div>
            </div>
            <div>
              <div className="text-slate-500">ID / NISN MDA</div>
              <div className="font-mono font-bold text-slate-900 mt-0.5">{studentNisn}</div>
            </div>
            <div>
              <div className="text-slate-500">Jumlah Soal</div>
              <div className="font-bold text-slate-900 mt-0.5">
                {selectedExam.questionCount} Butir Pilihan Ganda
              </div>
            </div>
            <div>
              <div className="text-slate-500">Durasi Ujian</div>
              <div className="font-bold text-slate-900 mt-0.5">
                {selectedExam.durationMinutes} Menit
              </div>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-1.5">
            <div className="font-bold flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-700" />
              <span>Peraturan Web Lockdown &amp; Anti-AI:</span>
            </div>
            <ul className="list-disc pl-5 space-y-1 text-[11px]">
              <li>Ujian wajib berjalan dalam mode layar penuh (Fullscreen).</li>
              <li>Dilarang berpindah tab, membuka aplikasi lain, atau split-screen.</li>
              <li>Fitur Copy, Paste, Klik Kanan, dan Inspect Element dinonaktifkan.</li>
              <li>
                Batas pelanggaran maksimal: <strong>{selectedExam.maxViolations} kali</strong>{' '}
                sebelum ujian otomatis terkunci.
              </li>
            </ul>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-semibold">
              {errorMsg}
            </div>
          )}

          {!isResuming && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Token Ujian dari Pengawas
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
                  placeholder="Masukkan 6 karakter token ujian..."
                  className="w-full pl-10 pr-4 py-3 text-sm font-mono font-bold tracking-widest uppercase border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={busy || (!isResuming && !tokenInput.trim())}
            onClick={() => void handleStartExam(selectedExam, existingAttempt)}
            className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Maximize2 className="w-4 h-4" />
            <span>
              {busy
                ? 'Menyiapkan Lembar Soal...'
                : isResuming
                  ? 'Lanjutkan Ujian (Masuk Fullscreen)'
                  : 'Mulai Kerjakan (Masuk Fullscreen)'}
            </span>
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // STAGE 1: STUDENT EXAM SUBJECT CARDS DASHBOARD
  // ==========================================
  return (
    <div className="min-h-screen bg-[#E8FAF3] flex flex-col font-[Arial]">
      <header className="bg-white border-b border-emerald-200 px-4 sm:px-8 py-3.5 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <MdaLogo size="sm" customLogoUrl={templateConfig.customLogoUrl} />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-emerald-700 uppercase">
                Ruang Ujian CBT Santri
              </div>
              <div className="text-sm font-bold text-slate-900 truncate">
                {studentTitle} · <span className="font-mono text-xs">{studentNisn}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadOverview()}
              className="p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
              title="Muat Ulang Daftar Ujian"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Keluar</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-8 space-y-5">
        <div className="p-5 rounded-2xl bg-[#0E2228] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-bold">
              Pilih Mata Pelajaran Ujian CBT
            </h1>
            <p className="text-xs text-slate-300 mt-1">
              Sesi ini khusus untuk pengerjaan Ujian CBT Pilihan Ganda dengan Web Lockdown. Akses Rapor &amp; Portofolio dinonaktifkan pada ruang ujian ini.
            </p>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-white/10 text-[#1DF27A] text-xs font-bold shrink-0">
            {exams.filter((e) => e.status === 'active').length} Mapel Aktif
          </div>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-semibold">
            {errorMsg}
          </div>
        )}

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-xs text-slate-500">
            Memuat daftar mata pelajaran ujian CBT...
          </div>
        ) : exams.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-xs text-slate-500">
            Belum ada paket ujian yang tersedia dari Pengawas.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {exams.map((exam) => {
              const att = attempts.find((a) => a.examId === exam.id);
              const isSubmitted = att?.status === 'submitted';
              const isLocked = att?.status === 'locked';
              const isInProgress = att?.status === 'in_progress';
              const canEnter =
                exam.status === 'active' && exam.questionCount > 0 && !isSubmitted;

              return (
                <div
                  key={exam.id}
                  className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-4 shadow-xs"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        {exam.mapelCode || 'CBT'}
                      </span>
                      {isSubmitted ? (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Selesai Dikerjakan
                        </span>
                      ) : isLocked ? (
                        <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-bold">
                          Terkunci Pelanggaran
                        </span>
                      ) : isInProgress ? (
                        <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 text-[10px] font-bold">
                          Sedang Dikerjakan
                        </span>
                      ) : exam.status === 'active' ? (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-bold">
                          Aktif · Siap Ujian
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">
                          {exam.status === 'finished' ? 'Ditutup' : 'Draft / Belum Dibuka'}
                        </span>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-slate-900">{exam.title}</h3>
                    <div className="text-xs text-slate-500">
                      {exam.questionCount} Soal · {exam.durationMinutes} Menit
                    </div>
                  </div>

                  {isSubmitted ? (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs flex items-center justify-between">
                      <span className="font-semibold text-emerald-900">
                        {exam.showScoreAfterFinish && typeof att?.score === 'number'
                          ? 'Nilai Akhir Anda'
                          : 'Jawaban Tersimpan'}
                      </span>
                      {exam.showScoreAfterFinish && typeof att?.score === 'number' && (
                        <span className="text-lg font-bold text-emerald-700">{att.score}</span>
                      )}
                    </div>
                  ) : isLocked ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedExam(exam);
                        setActiveExam(exam);
                        setActiveAttempt(att || null);
                        setStage('locked');
                      }}
                      className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Terkunci · Hubungi Pengawas</span>
                    </button>
                  ) : canEnter ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedExam(exam);
                        setTokenInput('');
                        setErrorMsg(null);
                        setStage('confirm');
                      }}
                      className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                    >
                      {isInProgress ? 'Lanjutkan Ujian' : 'Masuk & Masukkan Token'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="w-full py-2.5 px-4 rounded-xl bg-slate-100 text-slate-400 text-xs font-bold cursor-not-allowed"
                    >
                      {exam.questionCount === 0
                        ? 'Soal Belum Tersedia'
                        : 'Ujian Belum Dibuka'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};
