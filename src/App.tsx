import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Database,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FolderGit2,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  Menu,
  Palette,
  PenSquare,
  Printer,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { AdminDashboardView } from './components/AdminDashboardView';
import { ConfirmDialog } from './components/ConfirmDialog';
import { GradeEditorView } from './components/GradeEditorView';
import { MasterManagementView } from './components/MasterManagementView';
import { MdaLogo } from './components/MdaLogo';
import { PortfolioHubView } from './components/PortfolioHubView';
import { PrintableReportView } from './components/PrintableReportView';
import { SettingsSheetsView } from './components/SettingsSheetsView';
import { StudentPortalView } from './components/StudentPortalView';
import { TemplateSettingsView } from './components/TemplateSettingsView';
import { DEFAULT_TEMPLATE_CONFIG, INITIAL_MDA_DATABASE } from './data/seedData';
import {
  ApiConflictError,
  BackendSessionUser,
  connectAppsScriptOnServer,
  connectSpreadsheetOnServer,
  deletePortfolioOnServer,
  deleteStudentOnServer,
  deleteTeacherOnServer,
  fetchPublicBrandingConfig,
  fetchPublicPortfolioFromServer,
  fetchScopedDataFromServer,
  fetchServerHealth,
  getStoredSessionToken,
  loginGoogleViaServer,
  loginParentViaServer,
  loginStaffPinViaServer,
  logoutViaServer,
  migrateLocalSnapshotToServer,
  saveAccessOnServer,
  saveAllAppsScriptOnServer,
  saveReportOnServer,
  saveTemplateOnServer,
  ServerHealthStatus,
  setStoredSessionToken,
  uploadAssetToDriveViaServer,
  upsertPeriodOnServer,
  upsertPortfolioOnServer,
  upsertStudentOnServer,
  upsertTeacherOnServer,
} from './services/backendApi';
import { getAccessToken, googleSignIn, initAuth, logout } from './services/googleAuth';
import {
  createMdaSpreadsheet,
  extractSpreadsheetId,
  syncDatabaseToSheet,
  uploadFileToDrive,
} from './services/sheetsDb';
import {
  AcademicPeriod,
  BrandingTemplateConfig,
  ConfirmDialogState,
  MdaDatabase,
  PortfolioProject,
  SemesterReport,
  Student,
  TeacherClass,
  UserAccess,
  UserRole,
} from './types/mda';
import { getThemeStyles, mergeTemplateConfig } from './utils/theme';

type NavSection =
  | 'overview'
  | 'master'
  | 'grading'
  | 'portal'
  | 'portfolio'
  | 'template'
  | 'sheets';

type SyncIndicatorState = 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'offline';

const STORAGE_SHEET_ID_KEY = 'mda_connected_spreadsheet_id';
const LEGACY_LOCAL_DB_KEY = 'mda_cached_db_snapshot';
const SERVER_CACHE_KEY = 'mda_server_read_cache_v2';

const EMPTY_DATABASE: MdaDatabase = {
  periods: [],
  teachers: [],
  students: [],
  reports: [],
  portfolios: [],
  userAccess: [],
  templateConfig: DEFAULT_TEMPLATE_CONFIG,
};

function readLegacyLocalSnapshot(): MdaDatabase | null {
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_DB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MdaDatabase;
    if (!Array.isArray(parsed.students) || !Array.isArray(parsed.reports)) return null;
    return parsed;
  } catch {
    return null;
  }
}

const SAVED_DEVICE_CREDS_KEY = 'mda_saved_device_creds_v1';

interface SavedDeviceCredential {
  roleGroup: 'admin' | 'parent';
  identifier: string;
  displayName: string;
  pin: string;
  savedAt: string;
}

function readSavedDeviceCreds(): SavedDeviceCredential[] {
  try {
    const raw = localStorage.getItem(SAVED_DEVICE_CREDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function upsertSavedDeviceCred(cred: SavedDeviceCredential) {
  try {
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    const list = readSavedDeviceCreds().filter(
      (c) => !(c.roleGroup === cred.roleGroup && norm(c.identifier) === norm(cred.identifier))
    );
    const next = [cred, ...list].slice(0, 10);
    localStorage.setItem(SAVED_DEVICE_CREDS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

function findSavedPinForInput(
  creds: SavedDeviceCredential[],
  roleGroup: 'admin' | 'parent',
  inputVal: string
): string | null {
  const q = inputVal.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!q) return null;
  const match = creds.find(
    (c) =>
      c.roleGroup === roleGroup &&
      (c.identifier.trim().replace(/\s+/g, ' ').toLowerCase() === q ||
        c.displayName.trim().replace(/\s+/g, ' ').toLowerCase() === q)
  );
  return match?.pin || null;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialPortfolioSlug = urlParams.get('portfolio');
  const initialSheetParam = urlParams.get('sheet');
  const initialNisnParam = urlParams.get('nisn');
  const initialPinParam = urlParams.get('pin');

  const [preferredSheetId, setPreferredSheetId] = useState<string | undefined>(() => {
    return initialSheetParam || localStorage.getItem(STORAGE_SHEET_ID_KEY) || undefined;
  });

  const [db, setDb] = useState<MdaDatabase>(EMPTY_DATABASE);
  const [publicTemplateConfig, setPublicTemplateConfig] =
    useState<BrandingTemplateConfig>(DEFAULT_TEMPLATE_CONFIG);
  const [serverHealth, setServerHealth] = useState<ServerHealthStatus | null>(null);

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [hasGoogleOAuthToken, setHasGoogleOAuthToken] = useState(false);
  const [backendUser, setBackendUser] = useState<BackendSessionUser | null>(null);
  const [previewSampleMode, setPreviewSampleMode] = useState(false);

  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [dbLoadError, setDbLoadError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncIndicatorState>('idle');
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const [loginTab, setLoginTab] = useState<'admin' | 'parent'>(() =>
    initialNisnParam ? 'parent' : 'admin'
  );
  const [loginNisn, setLoginNisn] = useState(initialNisnParam || '');
  const [loginPin, setLoginPin] = useState(initialPinParam || '');
  const [showParentPin, setShowParentPin] = useState(false);
  const [loginTeacherInput, setLoginTeacherInput] = useState('');
  const [loginTeacherPin, setLoginTeacherPin] = useState('');
  const [showTeacherPin, setShowTeacherPin] = useState(false);
  const [rememberLoginOnDevice, setRememberLoginOnDevice] = useState(true);
  const [savedDeviceCreds, setSavedDeviceCreds] = useState<SavedDeviceCredential[]>(() =>
    readSavedDeviceCreds()
  );

  const [publicPortfolioMode, setPublicPortfolioMode] = useState(
    Boolean(initialPortfolioSlug)
  );
  const [authError, setAuthError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [legacySnapshot, setLegacySnapshot] = useState<MdaDatabase | null>(() =>
    readLegacyLocalSnapshot()
  );

  const [conflictDialog, setConflictDialog] = useState<{
    report: SemesterReport;
    serverUpdatedAt: string;
    serverReport?: SemesterReport;
    message: string;
  } | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Konfirmasi',
    onConfirm: () => {},
  });

  const showToast = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 5000);
  }, []);

  // Track online/offline browser state accurately
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setSyncState((prev) => (prev === 'offline' ? 'idle' : prev));
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncState('offline');
      showToast(
        'err',
        'Koneksi internet terputus. Perubahan tidak dapat disimpan ke Google Sheets hingga kembali online.'
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showToast]);

  // Listen to Firebase Auth state changes (for OAuth access token helper)
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setAuthUser(user);
        setHasGoogleOAuthToken(Boolean(token));
      },
      (user) => {
        setAuthUser(user);
        setHasGoogleOAuthToken(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const applyServerDatabase = useCallback(
    (incomingDb: MdaDatabase) => {
      setDb(incomingDb);
      setDbLoadError(null);
      if (incomingDb.spreadsheetId) {
        setPreferredSheetId(incomingDb.spreadsheetId);
        try {
          localStorage.setItem(STORAGE_SHEET_ID_KEY, incomingDb.spreadsheetId);
        } catch {
          // ignore
        }
      }
      try {
        // Store strictly as read-only cache metadata; never overwrites legacy unmigrated snapshot
        sessionStorage.setItem(
          SERVER_CACHE_KEY,
          JSON.stringify({
            lastSyncedAt: incomingDb.lastSyncedAt || new Date().toISOString(),
            spreadsheetId: incomingDb.spreadsheetId,
          })
        );
      } catch {
        // ignore
      }
    },
    []
  );

  // Bootstrap app strictly from backend & Google Sheets (no dummy override on connected errors)
  const bootstrapApp = useCallback(async () => {
    setIsBootstrapping(true);
    setSyncState('loading');
    setDbLoadError(null);
    const targetSheetId = initialSheetParam || localStorage.getItem(STORAGE_SHEET_ID_KEY) || undefined;

    try {
      const [healthRes, publicCfgRes] = await Promise.allSettled([
        fetchServerHealth(targetSheetId),
        fetchPublicBrandingConfig(targetSheetId),
      ]);

      const health = healthRes.status === 'fulfilled' ? healthRes.value : null;
      if (health) {
        setServerHealth(health);
        if (health.spreadsheetId) {
          setPreferredSheetId(health.spreadsheetId);
        }
      }

      if (publicCfgRes.status === 'fulfilled') {
        setPublicTemplateConfig(
          mergeTemplateConfig(publicCfgRes.value.templateConfig, DEFAULT_TEMPLATE_CONFIG)
        );
        if (publicCfgRes.value.spreadsheetId) {
          setPreferredSheetId(publicCfgRes.value.spreadsheetId);
        }
      }

      const activeSheetId =
        targetSheetId ||
        (publicCfgRes.status === 'fulfilled' ? publicCfgRes.value.spreadsheetId : undefined) ||
        health?.spreadsheetId ||
        undefined;

      // 1. Standalone Public Portfolio Link
      if (initialPortfolioSlug) {
        try {
          const portData = await fetchPublicPortfolioFromServer({
            slug: initialPortfolioSlug,
            spreadsheetId: activeSheetId,
          });
          applyServerDatabase({
            periods: [],
            teachers: [],
            students: [portData.student],
            reports: [],
            portfolios: portData.portfolios,
            userAccess: [],
            templateConfig: portData.templateConfig,
            spreadsheetId: portData.spreadsheetId || activeSheetId,
          });
          setSelectedStudentId(portData.student.id);
          return;
        } catch (err: any) {
          // Only allow sample portfolio preview if server has NO spreadsheet configured yet
          if (!health?.spreadsheetConfigured) {
            const sampleStu = INITIAL_MDA_DATABASE.students.find(
              (s) =>
                s.portfolioSlug === initialPortfolioSlug ||
                s.id === initialPortfolioSlug
            );
            if (sampleStu) {
              setPreviewSampleMode(true);
              setDb(INITIAL_MDA_DATABASE);
              setSelectedStudentId(sampleStu.id);
              return;
            }
          }
          setDbLoadError(err.message || 'Gagal memuat portofolio santri dari Google Sheets.');
          return;
        }
      }

      // 2. Direct Parent URL Login (?nisn=...&pin=...)
      if (initialNisnParam && initialPinParam) {
        try {
          const res = await loginParentViaServer({
            identifier: initialNisnParam,
            pin: initialPinParam,
            spreadsheetId: activeSheetId,
          });
          setBackendUser(res.user);
          applyServerDatabase(res.data);
          if (res.data.students[0]) {
            setSelectedStudentId(res.data.students[0].id);
          }
          setActiveNav('portal');
          return;
        } catch (err: any) {
          setAuthError(err.message || 'Tautan akses wali tidak valid.');
          return;
        }
      }

      // 3. Restore existing signed session on refresh / page reload
      if (getStoredSessionToken()) {
        try {
          const oauthToken = await getAccessToken();
          const scoped = await fetchScopedDataFromServer({
            googleAccessToken: oauthToken,
            spreadsheetId: activeSheetId,
          });
          setBackendUser(scoped.user);
          applyServerDatabase(scoped.data);
          if (scoped.user.role === 'santri_ortu') {
            if (scoped.data.students[0]) {
              setSelectedStudentId(scoped.data.students[0].id);
            }
            setActiveNav('portal');
          }
          setSyncState('saved');
        } catch (err: any) {
          const msg = String(err?.message || '');
          // If session expired/unauthorized -> clear token cleanly and return to login gate
          if (msg.includes('Sesi login tidak valid') || msg.includes('401')) {
            setStoredSessionToken(null);
            setBackendUser(null);
          } else {
            // Keep authenticated error visible — NEVER fall back to dummy data!
            setDbLoadError(
              msg ||
                'Gagal memuat data terbaru dari Google Sheets. Pastikan koneksi aktif dan coba muat ulang.'
            );
            setSyncState('error');
          }
        }
      }
    } finally {
      setIsBootstrapping(false);
      setSyncState((prev) => (prev === 'loading' ? 'idle' : prev));
    }
  }, [
    applyServerDatabase,
    initialNisnParam,
    initialPinParam,
    initialPortfolioSlug,
    initialSheetParam,
  ]);

  useEffect(() => {
    void bootstrapApp();
  }, [bootstrapApp]);

  const tpl = useMemo(
    () =>
      mergeTemplateConfig(
        db.students.length > 0 || db.periods.length > 0 || previewSampleMode
          ? db.templateConfig
          : publicTemplateConfig,
        DEFAULT_TEMPLATE_CONFIG
      ),
    [db.templateConfig, db.students.length, db.periods.length, previewSampleMode, publicTemplateConfig]
  );
  const theme = useMemo(() => getThemeStyles(tpl.accentTheme), [tpl.accentTheme]);

  const activePeriod = useMemo(
    () => db.periods.find((p) => p.isActive) || db.periods[db.periods.length - 1],
    [db.periods]
  );

  const [selectedYear, setSelectedYear] = useState<string>('2026/2027');
  const [selectedSemester, setSelectedSemester] = useState<'Gasal' | 'Genap'>('Gasal');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('std-alwan');

  // Keep selectedYear/semester/student valid when Google Sheets data loads
  useEffect(() => {
    if (activePeriod) {
      setSelectedYear((prev) =>
        db.periods.some((p) => p.tahunAkademik === prev) ? prev : activePeriod.tahunAkademik
      );
      setSelectedSemester((prev) =>
        db.periods.some((p) => p.semester === prev) ? prev : activePeriod.semester
      );
    }
  }, [activePeriod, db.periods]);

  useEffect(() => {
    if (db.students.length > 0) {
      setSelectedStudentId((prev) =>
        db.students.some((s) => s.id === prev) ? prev : db.students[0].id
      );
    }
  }, [db.students]);

  const [activeNav, setActiveNav] = useState<NavSection>('overview');
  const [printMode, setPrintMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [previewRole, setPreviewRole] = useState<UserRole>('admin');

  const actualRole: UserRole | null = previewSampleMode
    ? 'admin'
    : backendUser?.role || null;

  const effectiveRole: UserRole =
    actualRole === 'admin' ? previewRole : actualRole || 'santri_ortu';

  const lockedStudentId = useMemo(() => {
    if (effectiveRole !== 'santri_ortu') return null;
    if (backendUser?.studentId) return backendUser.studentId;
    return db.students[0]?.id || null;
  }, [effectiveRole, backendUser?.studentId, db.students]);

  useEffect(() => {
    if (effectiveRole === 'santri_ortu') {
      if (lockedStudentId) setSelectedStudentId(lockedStudentId);
      if (activeNav !== 'portal' && activeNav !== 'portfolio') {
        setActiveNav('portal');
      }
    }
  }, [effectiveRole, lockedStudentId, activeNav]);

  const enterAlwanHanifPreview = (targetRole: UserRole = 'admin') => {
    setPreviewSampleMode(true);
    setBackendUser(null);
    setDbLoadError(null);
    setAuthError(null);
    setDb({ ...INITIAL_MDA_DATABASE });
    setSelectedStudentId('std-alwan');
    setSelectedYear('2026/2027');
    setSelectedSemester('Gasal');
    setPreviewRole(targetRole);
    setActiveNav(targetRole === 'santri_ortu' ? 'portal' : 'overview');
    showToast(
      'ok',
      'Mode Pratinjau aktif dengan data contoh santri Alwan Hanif (tidak mengubah Google Sheets).'
    );
  };

  const exitPreviewSampleMode = () => {
    setPreviewSampleMode(false);
    setDb(EMPTY_DATABASE);
    setPreviewRole('admin');
    setActiveNav('overview');
  };

  const refreshFromServer = async (silent = false) => {
    if (previewSampleMode) return;
    if (!isOnline) {
      setSyncState('offline');
      if (!silent) showToast('err', 'Tidak dapat memuat ulang: koneksi internet terputus.');
      return;
    }
    setIsSyncing(true);
    setSyncState('loading');
    try {
      const oauthToken = await getAccessToken();
      const res = await fetchScopedDataFromServer({
        googleAccessToken: oauthToken,
        spreadsheetId: preferredSheetId || db.spreadsheetId,
      });
      setBackendUser(res.user);
      applyServerDatabase(res.data);
      setSyncState('saved');
      if (!silent) showToast('ok', 'Data terbaru berhasil dimuat dari Google Sheets.');
    } catch (err: any) {
      setSyncState('error');
      const msg = err.message || 'Gagal memuat ulang data dari Google Sheets.';
      if (!silent) showToast('err', msg);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (isLoggingIn) return;
    setAuthError(null);
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      if (!res || res.cancelled) {
        setAuthError(
          'Jendela login Google ditutup sebelum selesai. Klik "Sign in with Google" lagi, atau gunakan PIN / mode pratinjau Alwan Hanif.'
        );
        return;
      }
      setAuthUser(res.user);
      setHasGoogleOAuthToken(true);

      const serverLogin = await loginGoogleViaServer({
        idToken: res.idToken,
        googleAccessToken: res.accessToken,
        spreadsheetId: preferredSheetId || db.spreadsheetId,
      });

      setPreviewSampleMode(false);
      setBackendUser(serverLogin.user);
      if (serverLogin.data) {
        applyServerDatabase(serverLogin.data);
        if (serverLogin.user.role === 'santri_ortu') {
          setActiveNav('portal');
        } else {
          setActiveNav('overview');
        }
        setSyncState('saved');
        showToast('ok', `Berhasil masuk & memuat Google Sheets (${res.user.email})`);
      } else {
        // Admin logged in before spreadsheet is connected yet -> direct to Sheets setup tab
        setDb({
          ...EMPTY_DATABASE,
          templateConfig: publicTemplateConfig,
        });
        setActiveNav('sheets');
        showToast(
          'ok',
          'Login Admin berhasil. Silakan buat atau hubungkan Google Spreadsheet MDA di tab Google Sheets & Akses.'
        );
      }
    } catch (err: any) {
      setAuthError(err.message || 'Gagal login dengan Google.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleParentPinLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!isOnline) {
      setAuthError('Koneksi internet terputus. Periksa jaringan Anda lalu coba masuk kembali.');
      return;
    }
    const identifier = loginNisn.trim();
    const pin = loginPin.trim();
    if (!identifier || !pin) {
      setAuthError('Masukkan ID Santri MDA atau Nama Lengkap Santri beserta PIN Akses.');
      return;
    }
    setIsLoggingIn(true);
    try {
      const res = await loginParentViaServer({
        identifier,
        pin,
        spreadsheetId: preferredSheetId || db.spreadsheetId,
      });
      setPreviewSampleMode(false);
      setBackendUser(res.user);
      applyServerDatabase(res.data);
      if (rememberLoginOnDevice) {
        const studentName = res.data.students[0]?.nama || identifier;
        setSavedDeviceCreds(
          upsertSavedDeviceCred({
            roleGroup: 'parent',
            identifier,
            displayName: studentName,
            pin,
            savedAt: new Date().toISOString(),
          })
        );
      }
      if (res.data.students[0]) {
        setSelectedStudentId(res.data.students[0].id);
      }
      setActiveNav('portal');
      setSyncState('saved');
      showToast('ok', `Selamat datang ${res.user.name}`);
    } catch (err: any) {
      setAuthError(err.message || 'ID/Nama Santri atau PIN Akses tidak sesuai.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleTeacherPinLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!isOnline) {
      setAuthError('Koneksi internet terputus. Periksa jaringan Anda lalu coba masuk kembali.');
      return;
    }
    const identifier = loginTeacherInput.trim();
    const pin = loginTeacherPin.trim();
    if (!identifier || !pin) {
      setAuthError('Masukkan Nama Lengkap, ID/Kode Guru, atau Email beserta PIN Akses.');
      return;
    }
    setIsLoggingIn(true);
    try {
      const res = await loginStaffPinViaServer({
        identifier,
        pin,
        spreadsheetId: preferredSheetId || db.spreadsheetId,
      });
      setPreviewSampleMode(false);
      setBackendUser(res.user);
      applyServerDatabase(res.data);
      if (rememberLoginOnDevice) {
        setSavedDeviceCreds(
          upsertSavedDeviceCred({
            roleGroup: 'admin',
            identifier,
            displayName: res.user.name || identifier,
            pin,
            savedAt: new Date().toISOString(),
          })
        );
      }
      setActiveNav('overview');
      setSyncState('saved');
      showToast(
        'ok',
        `Berhasil masuk sebagai ${res.user.name} (${res.user.role === 'admin' ? 'Admin MDA' : 'Guru / Wali'})`
      );
    } catch (err: any) {
      setAuthError(err.message || 'Nama/ID/Email Guru atau PIN Akses tidak sesuai.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await Promise.all([logout(), logoutViaServer()]);
    setAuthUser(null);
    setHasGoogleOAuthToken(false);
    setBackendUser(null);
    setPreviewSampleMode(false);
    setDb(EMPTY_DATABASE);
    setDbLoadError(null);
    setAuthError(null);
    setPreviewRole('admin');
    setSyncState('idle');
  };

  const ensureOnlineForWrite = () => {
    if (!isOnline) {
      setSyncState('offline');
      showToast(
        'err',
        'Koneksi internet terputus! Data TIDAK disimpan. Sambungkan internet terlebih dahulu lalu tekan Simpan ulang.'
      );
      return false;
    }
    return true;
  };

  const executeReportSave = async (
    report: SemesterReport,
    expectedUpdatedAt?: string,
    forceOverwrite = false
  ) => {
    if (!ensureOnlineForWrite()) return;
    setIsSyncing(true);
    setSyncState('saving');
    try {
      const oauthToken = await getAccessToken();
      const res = await saveReportOnServer({
        report,
        expectedUpdatedAt,
        forceOverwrite,
        googleAccessToken: oauthToken,
        spreadsheetId: db.spreadsheetId || preferredSheetId,
      });
      applyServerDatabase(res.data);
      setSyncState('saved');
      setConflictDialog(null);
      showToast('ok', 'Nilai rapor berhasil disimpan & tersinkron ke Google Sheets.');
    } catch (err: any) {
      if (err instanceof ApiConflictError) {
        setSyncState('error');
        setConflictDialog({
          report,
          serverUpdatedAt: err.serverUpdatedAt,
          serverReport: err.serverReport,
          message: err.message,
        });
        return;
      }
      setSyncState('error');
      showToast('err', `Gagal menyimpan ke Google Sheets: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveReport = (report: SemesterReport) => {
    const studentName =
      db.students.find((s) => s.id === report.studentId)?.nama || 'Santri';

    if (previewSampleMode) {
      const exists = db.reports.some((r) => r.id === report.id);
      const nextReports = exists
        ? db.reports.map((r) => (r.id === report.id ? report : r))
        : [...db.reports, report];
      setDb({ ...db, reports: nextReports });
      showToast(
        'ok',
        `Pratinjau rapor ${studentName} diperbarui (hanya simulasi, tidak mengubah Google Sheets).`
      );
      return;
    }

    const existing = db.reports.find((r) => r.id === report.id);
    setConfirmDialog({
      open: true,
      title: 'Simpan Perubahan Nilai Rapor?',
      message: `Nilai rapor semester ${report.semester} ${report.tahunAkademik} untuk ${studentName} akan disimpan permanen berdasarkan ID unik ke Google Sheets.`,
      confirmLabel: 'Simpan ke Google Sheets',
      onConfirm: async () => {
        await executeReportSave(report, existing?.updatedAt, false);
      },
    });
  };

  const handleSaveStudents = (nextStudents: Student[]) => {
    if (previewSampleMode) {
      setDb({ ...db, students: nextStudents });
      showToast('ok', 'Data santri diperbarui di mode pratinjau.');
      return;
    }

    const deleted = db.students.filter(
      (old) => !nextStudents.some((n) => n.id === old.id)
    );
    const upserted = nextStudents.filter((n) => {
      const prev = db.students.find((old) => old.id === n.id);
      return !prev || JSON.stringify(prev) !== JSON.stringify(n);
    });

    if (deleted.length === 0 && upserted.length === 0) return;

    setConfirmDialog({
      open: true,
      title:
        deleted.length > 0
          ? 'Hapus Data Santri dari Google Sheets?'
          : 'Simpan Perubahan Data Santri?',
      message:
        deleted.length > 0
          ? `Santri "${deleted[0].nama}" akan dihapus permanen dari tab Santri di Google Sheets.`
          : `Perubahan data (${upserted.map((s) => s.nama).join(', ')}) akan disimpan ke Google Sheets tanpa menimpa santri lain.`,
      confirmLabel: deleted.length > 0 ? 'Hapus Permanen' : 'Simpan ke Google Sheets',
      variant: deleted.length > 0 ? 'danger' : 'primary',
      onConfirm: async () => {
        if (!ensureOnlineForWrite()) return;
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const oauthToken = await getAccessToken();
          const sheetId = db.spreadsheetId || preferredSheetId;
          let latestDb = db;
          for (const d of deleted) {
            const res = await deleteStudentOnServer({
              studentId: d.id,
              googleAccessToken: oauthToken,
              spreadsheetId: sheetId,
            });
            latestDb = res.data;
          }
          for (const s of upserted) {
            const res = await upsertStudentOnServer({
              student: s,
              googleAccessToken: oauthToken,
              spreadsheetId: sheetId,
            });
            latestDb = res.data;
          }
          applyServerDatabase(latestDb);
          setSyncState('saved');
          showToast('ok', 'Data santri berhasil disimpan ke Google Sheets.');
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal menyimpan data santri.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleUpdateStudentPhoto = (studentId: string, fotoUrl: string) => {
    const target = db.students.find((s) => s.id === studentId);
    if (!target) return;
    const updatedStudent: Student = { ...target, fotoUrl };

    if (previewSampleMode) {
      setDb({
        ...db,
        students: db.students.map((s) => (s.id === studentId ? updatedStudent : s)),
      });
      showToast('ok', 'Foto santri diperbarui di mode pratinjau.');
      return;
    }

    setConfirmDialog({
      open: true,
      title: 'Simpan Foto Profil Santri?',
      message: `Foto profil ${target.nama} akan diperbarui di Google Sheets.`,
      confirmLabel: 'Simpan ke Google Sheets',
      onConfirm: async () => {
        if (!ensureOnlineForWrite()) return;
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const oauthToken = await getAccessToken();
          const res = await upsertStudentOnServer({
            student: updatedStudent,
            googleAccessToken: oauthToken,
            spreadsheetId: db.spreadsheetId || preferredSheetId,
          });
          applyServerDatabase(res.data);
          setSyncState('saved');
          showToast('ok', 'Foto profil santri tersimpan di Google Sheets.');
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal menyimpan foto santri.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleUpdateStudentPortfolioLink = (studentId: string, portfolioSlug: string) => {
    const target = db.students.find((s) => s.id === studentId);
    if (!target) return;
    const updatedStudent: Student = { ...target, portfolioSlug };

    if (previewSampleMode) {
      setDb({
        ...db,
        students: db.students.map((s) => (s.id === studentId ? updatedStudent : s)),
      });
      showToast('ok', 'Link portofolio diperbarui di mode pratinjau.');
      return;
    }

    setConfirmDialog({
      open: true,
      title: 'Simpan Link Portofolio Santri?',
      message: `Link portofolio ${target.nama} akan diperbarui di Google Sheets.`,
      confirmLabel: 'Simpan ke Google Sheets',
      onConfirm: async () => {
        if (!ensureOnlineForWrite()) return;
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const oauthToken = await getAccessToken();
          const res = await upsertStudentOnServer({
            student: updatedStudent,
            googleAccessToken: oauthToken,
            spreadsheetId: db.spreadsheetId || preferredSheetId,
          });
          applyServerDatabase(res.data);
          setSyncState('saved');
          showToast('ok', 'Link portofolio santri berhasil disimpan ke Google Sheets.');
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal menyimpan link portofolio.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleSaveTeachers = (nextTeachers: TeacherClass[]) => {
    if (previewSampleMode) {
      setDb({ ...db, teachers: nextTeachers });
      showToast('ok', 'Data guru diperbarui di mode pratinjau.');
      return;
    }

    const deleted = db.teachers.filter(
      (old) => !nextTeachers.some((n) => n.id === old.id)
    );
    const upserted = nextTeachers.filter((n) => {
      const prev = db.teachers.find((old) => old.id === n.id);
      return !prev || JSON.stringify(prev) !== JSON.stringify(n);
    });
    if (deleted.length === 0 && upserted.length === 0) return;

    setConfirmDialog({
      open: true,
      title:
        deleted.length > 0
          ? 'Hapus Data Guru dari Google Sheets?'
          : 'Simpan Data Guru, TTD & Wali Kelas?',
      message: `Perubahan pada tab Guru_Kelas akan disimpan permanen ke Google Sheets.`,
      confirmLabel: deleted.length > 0 ? 'Hapus' : 'Simpan ke Google Sheets',
      variant: deleted.length > 0 ? 'danger' : 'primary',
      onConfirm: async () => {
        if (!ensureOnlineForWrite()) return;
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const oauthToken = await getAccessToken();
          const sheetId = db.spreadsheetId || preferredSheetId;
          let latestDb = db;
          for (const d of deleted) {
            const res = await deleteTeacherOnServer({
              teacherId: d.id,
              googleAccessToken: oauthToken,
              spreadsheetId: sheetId,
            });
            latestDb = res.data;
          }
          for (const t of upserted) {
            const res = await upsertTeacherOnServer({
              teacher: t,
              googleAccessToken: oauthToken,
              spreadsheetId: sheetId,
            });
            latestDb = res.data;
          }
          applyServerDatabase(latestDb);
          setSyncState('saved');
          showToast('ok', 'Data guru & TTD digital berhasil disimpan ke Google Sheets.');
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal menyimpan data guru.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleSavePeriods = (nextPeriods: AcademicPeriod[]) => {
    if (previewSampleMode) {
      setDb({ ...db, periods: nextPeriods });
      showToast('ok', 'Periode akademik diperbarui di mode pratinjau.');
      return;
    }

    const changed = nextPeriods.filter((n) => {
      const prev = db.periods.find((old) => old.id === n.id);
      return !prev || JSON.stringify(prev) !== JSON.stringify(n);
    });
    const targetPeriod = changed.find((p) => p.isActive) || changed[0] || nextPeriods[0];
    if (!targetPeriod) return;

    setConfirmDialog({
      open: true,
      title: 'Simpan Pengaturan Semester, KKM & TTD Pengesahan?',
      message: `Pengaturan periode ${targetPeriod.semester} ${targetPeriod.tahunAkademik} akan disimpan ke tab Master_Akademik Google Sheets.`,
      confirmLabel: 'Simpan ke Google Sheets',
      onConfirm: async () => {
        if (!ensureOnlineForWrite()) return;
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const oauthToken = await getAccessToken();
          const sheetId = db.spreadsheetId || preferredSheetId;
          let latestDb = db;
          for (const p of changed) {
            const res = await upsertPeriodOnServer({
              period: p,
              googleAccessToken: oauthToken,
              spreadsheetId: sheetId,
            });
            latestDb = res.data;
          }
          applyServerDatabase(latestDb);
          setSyncState('saved');
          showToast('ok', 'Periode akademik & TTD pengesahan disimpan ke Google Sheets.');
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal menyimpan periode akademik.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleSavePortfolios = (nextPortfolios: PortfolioProject[]) => {
    if (previewSampleMode) {
      setDb({ ...db, portfolios: nextPortfolios });
      showToast('ok', 'Portofolio diperbarui di mode pratinjau.');
      return;
    }

    const deleted = db.portfolios.filter(
      (old) => !nextPortfolios.some((n) => n.id === old.id)
    );
    const upserted = nextPortfolios.filter((n) => {
      const prev = db.portfolios.find((old) => old.id === n.id);
      return !prev || JSON.stringify(prev) !== JSON.stringify(n);
    });
    if (deleted.length === 0 && upserted.length === 0) return;

    setConfirmDialog({
      open: true,
      title: deleted.length > 0 ? 'Hapus Karya Portofolio?' : 'Simpan Karya Portofolio?',
      message:
        deleted.length > 0
          ? `Karya "${deleted[0].judul}" akan dihapus dari tab Portofolio Google Sheets.`
          : `Perubahan karya Student Portfolio akan disimpan ke Google Sheets.`,
      confirmLabel: deleted.length > 0 ? 'Hapus' : 'Simpan ke Google Sheets',
      variant: deleted.length > 0 ? 'danger' : 'primary',
      onConfirm: async () => {
        if (!ensureOnlineForWrite()) return;
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const oauthToken = await getAccessToken();
          const sheetId = db.spreadsheetId || preferredSheetId;
          let latestDb = db;
          for (const d of deleted) {
            const res = await deletePortfolioOnServer({
              portfolioId: d.id,
              googleAccessToken: oauthToken,
              spreadsheetId: sheetId,
            });
            latestDb = res.data;
          }
          for (const p of upserted) {
            const res = await upsertPortfolioOnServer({
              project: p,
              googleAccessToken: oauthToken,
              spreadsheetId: sheetId,
            });
            latestDb = res.data;
          }
          applyServerDatabase(latestDb);
          setSyncState('saved');
          showToast('ok', 'Portofolio karya berhasil disimpan ke Google Sheets.');
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal menyimpan karya portofolio.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleSaveTemplateConfig = (templateConfig: BrandingTemplateConfig) => {
    if (previewSampleMode) {
      setDb({ ...db, templateConfig });
      showToast('ok', 'Template tampilan diperbarui di mode pratinjau.');
      return;
    }

    setConfirmDialog({
      open: true,
      title: 'Simpan Pengaturan Tampilan & Template?',
      message:
        'Perubahan tulisan sampul, kontak, logo, foto cover, dan tema warna MDA akan disimpan ke Google Sheets.',
      confirmLabel: 'Simpan ke Google Sheets',
      onConfirm: async () => {
        if (!ensureOnlineForWrite()) return;
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const oauthToken = await getAccessToken();
          const res = await saveTemplateOnServer({
            templateConfig,
            googleAccessToken: oauthToken,
            spreadsheetId: db.spreadsheetId || preferredSheetId,
          });
          applyServerDatabase(res.data);
          setPublicTemplateConfig(templateConfig);
          setSyncState('saved');
          showToast('ok', 'Template & branding berhasil disimpan ke Google Sheets.');
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal menyimpan template.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleSaveUserAccess = (userAccess: UserAccess[]) => {
    if (previewSampleMode) {
      setDb({ ...db, userAccess });
      showToast('ok', 'Hak akses diperbarui di mode pratinjau.');
      return;
    }

    setConfirmDialog({
      open: true,
      title: 'Perbarui Hak Akses Pengguna?',
      message: `Pengaturan hak akses (${userAccess.length} akun) akan disimpan ke tab Hak_Akses Google Sheets.`,
      confirmLabel: 'Simpan ke Google Sheets',
      onConfirm: async () => {
        if (!ensureOnlineForWrite()) return;
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const oauthToken = await getAccessToken();
          const res = await saveAccessOnServer({
            userAccess,
            googleAccessToken: oauthToken,
            spreadsheetId: db.spreadsheetId || preferredSheetId,
          });
          applyServerDatabase(res.data);
          setSyncState('saved');
          showToast('ok', 'Hak akses pengguna berhasil disimpan ke Google Sheets.');
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal menyimpan hak akses.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleCreateSpreadsheet = () => {
    setConfirmDialog({
      open: true,
      title: 'Buat Google Spreadsheet MDA Baru?',
      message:
        'Sistem akan membuat spreadsheet baru di Google Drive Anda berisi 11 tab terstruktur beserta data awal MDA dan langsung menautkannya ke backend server.',
      confirmLabel: 'Buat Spreadsheet',
      onConfirm: async () => {
        if (!ensureOnlineForWrite()) return;
        const token = await getAccessToken();
        if (!token) {
          showToast('err', 'Silakan Sign in with Google terlebih dahulu.');
          return;
        }
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const seedSource = db.students.length > 0 ? db : INITIAL_MDA_DATABASE;
          const created = await createMdaSpreadsheet(token, seedSource);
          const connected = await connectSpreadsheetOnServer({
            spreadsheetId: created.spreadsheetId,
            googleAccessToken: token,
          });
          applyServerDatabase(connected.data);
          setSyncState('saved');
          showToast(
            'ok',
            'Google Spreadsheet MDA berhasil dibuat & ditautkan ke server! Bagikan juga spreadsheet ini ke email Service Account sebagai Editor.'
          );
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal membuat Google Spreadsheet.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleConnectSpreadsheet = async (urlOrId: string) => {
    if (!ensureOnlineForWrite()) return;
    const id = extractSpreadsheetId(urlOrId);
    setIsSyncing(true);
    setSyncState('saving');
    try {
      const oauthToken = await getAccessToken();
      const connected = await connectSpreadsheetOnServer({
        spreadsheetId: id,
        googleAccessToken: oauthToken,
      });
      applyServerDatabase(connected.data);
      setSyncState('saved');
      showToast(
        'ok',
        `Berhasil terhubung ke "${connected.data.spreadsheetTitle}". Data diambil langsung dari Google Sheets.`
      );
    } catch (err: any) {
      setSyncState('error');
      showToast('err', err.message || 'Gagal menghubungkan spreadsheet tersebut.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConnectAppsScript = async (appsScriptUrl: string) => {
    if (!ensureOnlineForWrite()) return;
    setIsSyncing(true);
    setSyncState('loading');
    try {
      const connected = await connectAppsScriptOnServer({ appsScriptUrl });
      applyServerDatabase(connected.data);
      const latestHealth = await fetchServerHealth(connected.data.spreadsheetId);
      setServerHealth(latestHealth);
      setSyncState('saved');
      showToast(
        'ok',
        'Google Apps Script Web App berhasil terhubung & data terbaru dimuat dari Google Sheets.'
      );
    } catch (err: any) {
      setSyncState('error');
      showToast('err', err.message || 'Gagal menghubungkan URL Google Apps Script.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveAllAppsScript = () => {
    if (!ensureOnlineForWrite()) return;
    const sourceData =
      db.students.length > 0 || db.reports.length > 0 ? db : INITIAL_MDA_DATABASE;
    setConfirmDialog({
      open: true,
      title: 'Kirim Seluruh Data ke Google Apps Script (POST saveAll)?',
      message: `Sebanyak ${sourceData.students.length} santri, ${sourceData.reports.length} rapor, ${sourceData.teachers.length} guru, dan ${sourceData.portfolios.length} karya akan dikirim ke endpoint Google Apps Script Anda.`,
      confirmLabel: 'Kirim (POST saveAll)',
      onConfirm: async () => {
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const res = await saveAllAppsScriptOnServer({ data: sourceData });
          applyServerDatabase(res.data);
          setSyncState('saved');
          showToast('ok', 'Seluruh data berhasil dikirim & tersimpan di Google Sheets.');
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal menyimpan data ke Google Apps Script.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handlePushToSheets = () => {
    if (serverHealth?.appsScriptConfigured) {
      handleSaveAllAppsScript();
      return;
    }
    if (!db.spreadsheetId || !ensureOnlineForWrite()) return;
    setConfirmDialog({
      open: true,
      title: 'Sinkronkan Ulang Seluruh Tab ke Google Sheets?',
      message: `Seluruh data pada ${db.students.length} santri, ${db.reports.length} rapor semester, ${db.portfolios.length} karya portofolio, dan template rapor akan disinkronkan ke Google Spreadsheet "${db.spreadsheetTitle || db.spreadsheetId}".`,
      confirmLabel: 'Sinkronkan Sekarang',
      onConfirm: async () => {
        const token = await getAccessToken();
        if (!token || !db.spreadsheetId) {
          showToast('err', 'Gunakan tombol Edit pada setiap santri/rapor atau Sign in with Google.');
          return;
        }
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const synced = await syncDatabaseToSheet(token, db.spreadsheetId, db);
          applyServerDatabase({ ...synced, lastSyncedAt: new Date().toISOString() });
          setSyncState('saved');
          showToast('ok', 'Seluruh data berhasil disinkronkan ke Google Sheets.');
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal sinkronisasi ke Google Sheets.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleMigrateLocalToSheets = () => {
    if (!legacySnapshot || !(db.spreadsheetId || preferredSheetId)) return;
    setConfirmDialog({
      open: true,
      title: 'Migrasikan Data Lokal ke Google Sheets (Tanpa Duplikasi)?',
      message: `Data lama di browser (${legacySnapshot.students.length} santri, ${legacySnapshot.reports.length} rapor, ${legacySnapshot.portfolios.length} karya) akan digabungkan ke Google Sheets. Data yang ID/NISN-nya sudah ada di Google Sheets TIDAK akan ditimpa atau diduplikasi.`,
      confirmLabel: 'Migrasikan Sekarang',
      onConfirm: async () => {
        if (!ensureOnlineForWrite()) return;
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const oauthToken = await getAccessToken();
          const res = await migrateLocalSnapshotToServer({
            localDb: legacySnapshot,
            googleAccessToken: oauthToken,
            spreadsheetId: db.spreadsheetId || preferredSheetId,
          });
          applyServerDatabase(res.db);
          localStorage.removeItem(LEGACY_LOCAL_DB_KEY);
          setLegacySnapshot(null);
          setSyncState('saved');
          const totalAdded =
            res.addedCounts.students +
            res.addedCounts.reports +
            res.addedCounts.portfolios +
            res.addedCounts.teachers +
            res.addedCounts.periods +
            res.addedCounts.userAccess;
          showToast(
            'ok',
            totalAdded > 0
              ? `Migrasi sukses! ${totalAdded} entri baru ditambahkan tanpa menimpa data Google Sheets yang ada.`
              : 'Seluruh data lokal sudah ada di Google Sheets (0 duplikasi).'
          );
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal memigrasikan data lokal.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleRestoreBackup = (restored: MdaDatabase) => {
    setConfirmDialog({
      open: true,
      title: 'Pulihkan & Gabungkan Data dari File Backup JSON?',
      message: `Data dari file backup (${restored.students.length} santri, ${restored.reports.length} rapor) akan digabungkan/dipulihkan ke Google Sheets aktif tanpa duplikasi ID.`,
      confirmLabel: 'Pulihkan ke Sheets',
      variant: 'danger',
      onConfirm: async () => {
        if (previewSampleMode) {
          setDb(restored);
          showToast('ok', 'Data backup dimuat di mode pratinjau.');
          return;
        }
        if (!ensureOnlineForWrite()) return;
        setIsSyncing(true);
        setSyncState('saving');
        try {
          const oauthToken = await getAccessToken();
          const res = await migrateLocalSnapshotToServer({
            localDb: restored,
            googleAccessToken: oauthToken,
            spreadsheetId: db.spreadsheetId || preferredSheetId,
          });
          applyServerDatabase(res.db);
          setSyncState('saved');
          showToast('ok', 'Data backup berhasil dipulihkan ke Google Sheets.');
        } catch (err: any) {
          setSyncState('error');
          showToast('err', err.message || 'Gagal memulihkan backup.');
        } finally {
          setIsSyncing(false);
        }
      },
    });
  };

  const handleUploadToDrive = async (
    file: File
  ): Promise<{ url: string; type: 'image' | 'video' } | null> => {
    if (previewSampleMode) return null;
    const oauthToken = await getAccessToken();
    const canUploadViaServer = Boolean(serverHealth?.serviceAccountConfigured || oauthToken);
    if (!canUploadViaServer) return null;

    return new Promise((resolve) => {
      setConfirmDialog({
        open: true,
        title: 'Unggah File ke Google Drive?',
        message: `File "${file.name}" (${Math.round(
          file.size / 1024
        )} KB) akan diunggah ke Google Drive MDA dan diatur agar dapat tampil di rapor/portofolio santri.`,
        confirmLabel: 'Unggah ke Drive',
        onConfirm: async () => {
          try {
            if (oauthToken) {
              const uploaded = await uploadFileToDrive(oauthToken, file);
              showToast('ok', `File "${file.name}" berhasil diunggah ke Google Drive.`);
              resolve({
                url: uploaded.url,
                type: uploaded.mimeType.startsWith('video/') ? 'video' : 'image',
              });
              return;
            }
            const dataUrl = await fileToDataUrl(file);
            const uploaded = await uploadAssetToDriveViaServer({
              dataUrl,
              fileName: file.name,
              googleAccessToken: oauthToken,
            });
            showToast('ok', `File "${file.name}" berhasil diunggah ke Google Drive.`);
            resolve({
              url: uploaded.url,
              type: uploaded.mimeType.startsWith('video/') ? 'video' : 'image',
            });
          } catch (err: any) {
            showToast('err', err.message || 'Gagal mengunggah ke Google Drive.');
            resolve(null);
          }
        },
      });
    });
  };

  // Loading Screen on Initial Boot / Refresh
  if (isBootstrapping) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ backgroundColor: theme.pageTint }}
      >
        <div className="bg-white border border-emerald-200 rounded-3xl p-8 max-w-sm w-full text-center space-y-4 shadow-xs">
          <div className="inline-flex items-center justify-center bg-white rounded-2xl px-4 py-2 border border-slate-100">
            <MdaLogo size="md" customLogoUrl={tpl.customLogoUrl} />
          </div>
          <div className="flex items-center justify-center gap-2 text-emerald-700 text-sm font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Menghubungkan ke Google Sheets MDA...</span>
          </div>
          <p className="text-xs text-slate-500">
            Mengambil data akademik dan sesi terbaru secara aman.
          </p>
        </div>
      </div>
    );
  }

  // Explicit Database Error Screen (Never falls back silently to dummy data!)
  if (dbLoadError && !previewSampleMode) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ backgroundColor: theme.pageTint }}
      >
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-3xl p-7 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto">
            <CloudOff className="w-6 h-6 text-rose-600" />
          </div>
          <h2 className="font-display font-bold text-lg text-slate-900">
            Gagal Memuat Data Google Sheets
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">{dbLoadError}</p>
          <p className="text-[11px] text-slate-500">
            Demi keamanan data, sistem tidak menampilkan data contoh palsu sebagai pengganti database asli saat koneksi gagal.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              type="button"
              onClick={() => void refreshFromServer(false)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Coba Muat Ulang</span>
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="py-2.5 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold"
            >
              Kembali ke Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 1. Standalone Public QR Portfolio Mode
  if (publicPortfolioMode) {
    return (
      <>
        <PortfolioHubView
          db={db}
          studentId={selectedStudentId}
          canEdit={false}
          isPublicStandalone
          templateConfig={tpl}
          onSavePortfolios={() => {}}
          onUploadMediaToDrive={async () => null}
          onExitPublicStandalone={() => {
            setPublicPortfolioMode(false);
            setPreviewSampleMode(false);
            window.history.replaceState({}, '', window.location.pathname);
          }}
        />
        <ConfirmDialog
          dialog={confirmDialog}
          onClose={() => setConfirmDialog((d) => ({ ...d, open: false }))}
        />
      </>
    );
  }

  // 2. Printable 5-Page A4 PDF Report Mode
  if (printMode) {
    return (
      <PrintableReportView
        db={db}
        studentId={lockedStudentId || selectedStudentId}
        selectedYear={selectedYear}
        selectedSemester={selectedSemester}
        templateConfig={tpl}
        onBack={() => setPrintMode(false)}
      />
    );
  }

  // 3. Authentication Gate (Admin/Guru OR Private Parent/Student)
  if (!backendUser && !previewSampleMode) {
    return (
      <div
        className="min-h-screen flex flex-col justify-between p-4 sm:p-8"
        style={{ backgroundColor: theme.pageTint }}
      >
        <div className="max-w-5xl w-full mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-stretch">
          {/* Left MDA Branding Panel */}
          <div
            className="lg:col-span-6 rounded-3xl p-6 sm:p-8 text-white flex flex-col justify-between shadow-lg relative overflow-hidden"
            style={{ background: theme.bannerGradient }}
          >
            {tpl.coverPhotoUrl && (
              <img
                src={tpl.coverPhotoUrl}
                alt="Cover MDA"
                referrerPolicy="no-referrer"
                className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-luminosity"
              />
            )}
            <div className="relative z-10">
              <div className="inline-flex items-center justify-center bg-white rounded-2xl px-4 py-2.5 shadow-sm">
                <MdaLogo size="md" customLogoUrl={tpl.customLogoUrl} />
              </div>
              <h1 className="font-display font-extrabold text-2xl sm:text-4xl leading-tight mt-6 sm:mt-8 text-balance">
                {tpl.loginHeadline}
              </h1>
              <p className="mt-3 font-[Arial] text-xs sm:text-sm text-emerald-50/95 leading-relaxed">
                {tpl.loginDescription}
              </p>
            </div>

            <div className="relative z-10 mt-6 sm:mt-8 pt-5 border-t border-white/25 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="font-[Arial] font-bold text-[#1DF27A]">Admin &amp; Guru</div>
                <div className="font-[Arial] text-white/90 mt-1">{tpl.loginAdminInfo}</div>
              </div>
              <div>
                <div className="font-[Arial] font-bold text-sky-200">
                  Orang Tua &amp; Santri (Privat)
                </div>
                <div className="font-[Arial] text-white/90 mt-1">{tpl.loginParentInfo}</div>
              </div>
            </div>
          </div>

          {/* Right Sign-In Card */}
          <div className="lg:col-span-6 bg-white border border-emerald-200 rounded-3xl p-5 sm:p-8 flex flex-col justify-center space-y-5 shadow-xs">
            {/* Switch between Admin/Guru and Parent/Student */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setLoginTab('admin');
                  setAuthError(null);
                }}
                className={`min-h-[42px] py-2 px-3 rounded-lg font-[Arial] text-xs font-bold transition-colors ${
                  loginTab === 'admin'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Admin &amp; Guru
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginTab('parent');
                  setAuthError(null);
                }}
                className={`min-h-[42px] py-2 px-3 rounded-lg font-[Arial] text-xs font-bold transition-colors ${
                  loginTab === 'parent'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Orang Tua &amp; Santri
              </button>
            </div>

            {authError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 leading-relaxed">
                {authError}
              </div>
            )}

            {loginTab === 'admin' ? (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-[Arial] font-semibold text-emerald-700">
                    AKSES PENGELOLA LEMBAGA
                  </div>
                  <h2 className="font-display font-bold text-xl sm:text-2xl text-slate-900 mt-1">
                    Masuk Dashboard Admin / Guru
                  </h2>
                  <p className="font-[Arial] text-xs text-slate-500 mt-1 leading-relaxed">
                    Masuk dengan ID/Email Guru &amp; PIN yang tersimpan di Google Sheets, atau gunakan Google Sign-In untuk mengelola Spreadsheet.
                  </p>
                </div>

                <form onSubmit={handleTeacherPinLogin} autoComplete="on" className="space-y-3">
                  <div>
                    <label className="block font-[Arial] text-xs font-semibold text-slate-700 mb-1">
                      Nama Lengkap / ID Guru / Email
                    </label>
                    <input
                      type="text"
                      name="username"
                      autoComplete="username"
                      list="mda-saved-staff-names"
                      value={loginTeacherInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLoginTeacherInput(val);
                        const savedPin = findSavedPinForInput(savedDeviceCreds, 'admin', val);
                        if (savedPin) {
                          setLoginTeacherPin(savedPin);
                        }
                      }}
                      placeholder="Contoh: Nama Lengkap / ID Guru / Email"
                      className="w-full px-3.5 py-2.5 font-[Arial] text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                    <datalist id="mda-saved-staff-names">
                      {savedDeviceCreds
                        .filter((c) => c.roleGroup === 'admin')
                        .map((c) => (
                          <option key={c.identifier} value={c.displayName} />
                        ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block font-[Arial] text-xs font-semibold text-slate-700 mb-1">
                      PIN / Password Akses Admin / Guru
                    </label>
                    <div className="relative">
                      <input
                        type={showTeacherPin ? 'text' : 'password'}
                        name="password"
                        autoComplete="current-password"
                        value={loginTeacherPin}
                        onChange={(e) => setLoginTeacherPin(e.target.value)}
                        placeholder="Terisi otomatis jika tersimpan di perangkat ini"
                        className="w-full pl-3.5 pr-10 py-2.5 font-[Arial] text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowTeacherPin((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                        title={showTeacherPin ? 'Sembunyikan PIN' : 'Lihat PIN'}
                      >
                        {showTeacherPin ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberLoginOnDevice}
                        onChange={(e) => setRememberLoginOnDevice(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Isi otomatis PIN saat mengetik nama di perangkat ini</span>
                    </label>
                    {savedDeviceCreds.some((c) => c.roleGroup === 'admin') && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = savedDeviceCreds.filter((c) => c.roleGroup !== 'admin');
                          localStorage.setItem(SAVED_DEVICE_CREDS_KEY, JSON.stringify(next));
                          setSavedDeviceCreds(next);
                          setLoginTeacherPin('');
                        }}
                        className="text-rose-600 hover:underline shrink-0"
                      >
                        Hapus tersimpan
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                  >
                    <KeyRound className="w-4 h-4 text-[#1DF27A]" />
                    <span>{isLoggingIn ? 'Memverifikasi...' : 'Masuk Sebagai Admin / Guru'}</span>
                  </button>
                </form>

                <div className="relative py-0.5 flex items-center">
                  <div className="flex-grow border-t border-slate-200" />
                  <span className="px-3 text-[11px] text-slate-400">
                    atau masuk dengan Akun Google
                  </span>
                  <div className="flex-grow border-t border-slate-200" />
                </div>

                <div className="space-y-2.5">
                  <button
                    type="button"
                    disabled={isLoggingIn}
                    onClick={handleGoogleLogin}
                    className="gsi-material-button w-full disabled:opacity-60 disabled:cursor-wait"
                  >
                    <div className="gsi-material-button-state" />
                    <div className="gsi-material-button-content-wrapper">
                      <div className="gsi-material-button-icon">
                        <svg viewBox="0 0 48 48" className="block w-full h-full">
                          <path
                            fill="#EA4335"
                            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                          />
                          <path
                            fill="#4285F4"
                            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                          />
                          <path
                            fill="#34A853"
                            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                          />
                        </svg>
                      </div>
                      <span className="gsi-material-button-contents">
                        {isLoggingIn ? 'Menghubungkan ke Google...' : 'Sign in with Google'}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => enterAlwanHanifPreview('admin')}
                    className="w-full min-h-[42px] py-2.5 px-4 rounded-xl border border-emerald-300 bg-[#E8FAF3] hover:bg-emerald-100 text-xs font-semibold text-emerald-900 inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Pratinjau Data Contoh: Alwan Hanif</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-emerald-700">
                    <Lock className="w-3.5 h-3.5" />
                    <span className="font-[Arial]">PORTAL PRIVAT WALI &amp; SANTRI</span>
                  </div>
                  <h2 className="font-display font-bold text-xl sm:text-2xl text-slate-900 mt-1">
                    Masuk Melihat Rapor Putra Anda
                  </h2>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Masukkan ID Santri MDA atau Nama Lengkap Santri beserta PIN Akses. Data dibaca langsung dari Google Sheets secara privat — wali hanya melihat rapor anaknya sendiri.
                  </p>
                </div>

                <form onSubmit={handleParentPinLogin} autoComplete="on" className="space-y-3">
                  <div>
                    <label className="block font-[Arial] text-xs font-semibold text-slate-700 mb-1">
                      Nama Lengkap Santri atau ID Santri MDA
                    </label>
                    <input
                      type="text"
                      name="username"
                      autoComplete="username"
                      list="mda-saved-parent-names"
                      value={loginNisn}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLoginNisn(val);
                        const savedPin = findSavedPinForInput(savedDeviceCreds, 'parent', val);
                        if (savedPin) {
                          setLoginPin(savedPin);
                        }
                      }}
                      placeholder="Contoh: Nama Lengkap Santri atau MDA02.2526.791"
                      className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                    <datalist id="mda-saved-parent-names">
                      {savedDeviceCreds
                        .filter((c) => c.roleGroup === 'parent')
                        .map((c) => (
                          <option key={c.identifier} value={c.displayName} />
                        ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block font-[Arial] text-xs font-semibold text-slate-700 mb-1">
                      PIN / Password Akses Privat
                    </label>
                    <div className="relative">
                      <input
                        type={showParentPin ? 'text' : 'password'}
                        name="password"
                        autoComplete="current-password"
                        value={loginPin}
                        onChange={(e) => setLoginPin(e.target.value)}
                        placeholder="Terisi otomatis jika tersimpan di perangkat ini"
                        className="w-full pl-3.5 pr-10 py-2.5 text-xs font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowParentPin((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                        title={showParentPin ? 'Sembunyikan PIN' : 'Lihat PIN'}
                      >
                        {showParentPin ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberLoginOnDevice}
                        onChange={(e) => setRememberLoginOnDevice(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Isi otomatis PIN saat mengetik nama di HP/laptop ini</span>
                    </label>
                    {savedDeviceCreds.some((c) => c.roleGroup === 'parent') && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = savedDeviceCreds.filter((c) => c.roleGroup !== 'parent');
                          localStorage.setItem(SAVED_DEVICE_CREDS_KEY, JSON.stringify(next));
                          setSavedDeviceCreds(next);
                          setLoginPin('');
                        }}
                        className="text-rose-600 hover:underline shrink-0"
                      >
                        Hapus tersimpan
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>{isLoggingIn ? 'Memverifikasi...' : 'Buka Rapor Santri'}</span>
                  </button>
                </form>

                <div className="relative py-0.5 flex items-center">
                  <div className="flex-grow border-t border-slate-200" />
                  <span className="px-3 text-[11px] text-slate-400">
                    atau Gmail wali terdaftar
                  </span>
                  <div className="flex-grow border-t border-slate-200" />
                </div>

                <button
                  type="button"
                  disabled={isLoggingIn}
                  onClick={handleGoogleLogin}
                  className="gsi-material-button w-full disabled:opacity-60 disabled:cursor-wait"
                >
                  <div className="gsi-material-button-state" />
                  <div className="gsi-material-button-content-wrapper">
                    <div className="gsi-material-button-icon">
                      <svg viewBox="0 0 48 48" className="block w-full h-full">
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                      </svg>
                    </div>
                    <span className="gsi-material-button-contents">
                      {isLoggingIn
                        ? 'Menghubungkan ke Google...'
                        : 'Sign in with Google (Email Terdaftar)'}
                    </span>
                  </div>
                </button>
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500 leading-relaxed">
              {tpl.alamat} · {tpl.instagram}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 4. Authenticated Unauthorized Guard
  if (!previewSampleMode && !actualRole) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ backgroundColor: theme.pageTint }}
      >
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-3xl p-7 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6 text-rose-600" />
          </div>
          <h2 className="font-display font-bold text-lg text-slate-900">
            Akses Tidak Terdaftar di MDA
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Sesi login belum terdaftar pada peran Admin, Guru, maupun Wali Santri.
          </p>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
          >
            Kembali ke Halaman Login
          </button>
        </div>
      </div>
    );
  }

  const navItems: {
    id: NavSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    roles: UserRole[];
  }[] = [
    {
      id: 'overview',
      label: 'Ringkasan Akademik',
      icon: LayoutDashboard,
      roles: ['admin', 'guru'],
    },
    {
      id: 'master',
      label: 'Santri, Guru & Periode',
      icon: Users,
      roles: ['admin', 'guru'],
    },
    {
      id: 'grading',
      label: 'Input & Hitung Nilai',
      icon: PenSquare,
      roles: ['admin', 'guru'],
    },
    {
      id: 'portal',
      label: effectiveRole === 'santri_ortu' ? 'Rapor Digital Putra Saya' : 'Portal Santri & Ortu',
      icon: GraduationCap,
      roles: ['admin', 'guru', 'santri_ortu'],
    },
    {
      id: 'portfolio',
      label: 'Student Portfolio',
      icon: FolderGit2,
      roles: ['admin', 'guru', 'santri_ortu'],
    },
    {
      id: 'template',
      label: 'Tampilan & Template',
      icon: Palette,
      roles: ['admin'],
    },
    {
      id: 'sheets',
      label: 'Google Sheets & Akses',
      icon: Database,
      roles: ['admin'],
    },
  ];

  const visibleNavItems = navItems.filter((n) => n.roles.includes(effectiveRole));
  const uniqueYears = Array.from(new Set(db.periods.map((p) => p.tahunAkademik)));

  return (
    <div
      className="min-h-screen flex flex-col md:flex-row"
      style={{ backgroundColor: theme.pageTint }}
    >
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/45 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar (Desktop + Mobile Drawer) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-emerald-200/80 flex flex-col justify-between transition-transform duration-200 md:static md:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div
            className="h-16 px-3.5 border-b border-emerald-200/80 flex items-center justify-between md:justify-center gap-2 text-white"
            style={{ background: theme.bannerGradient }}
          >
            <div className="flex-1 md:w-full inline-flex items-center justify-center bg-white/95 rounded-xl px-3 py-1.5 shadow-xs">
              <MdaLogo size="sm" customLogoUrl={tpl.customLogoUrl} />
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="md:hidden p-1.5 rounded-lg text-white/90 hover:bg-white/15"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="p-3 space-y-1">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveNav(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                    active
                      ? 'text-white shadow-xs'
                      : 'text-slate-700 hover:bg-emerald-50 hover:text-emerald-900'
                  }`}
                  style={active ? { background: theme.bannerGradient } : undefined}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Google Sheets Sync Card (Admin & Guru only) */}
          {effectiveRole !== 'santri_ortu' && !previewSampleMode && (
            <div
              className="mx-3 mt-4 p-3.5 rounded-xl border border-emerald-200 space-y-2 text-xs"
              style={{ backgroundColor: theme.pageTint }}
            >
              <div className="flex items-center justify-between font-semibold text-slate-800">
                <span className="inline-flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Google Sheets</span>
                </span>
                <span className="text-[11px] font-mono text-emerald-800 font-bold">
                  {db.spreadsheetId ? 'Terhubung' : 'Belum Taut'}
                </span>
              </div>
              <div className="text-[11px] text-slate-600 truncate">
                {db.spreadsheetId
                  ? db.spreadsheetTitle || db.spreadsheetId
                  : 'Hubungkan Google Spreadsheet MDA'}
              </div>
              {db.spreadsheetId ? (
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => void refreshFromServer(false)}
                  className="w-full py-1.5 px-2.5 rounded-lg bg-white border border-emerald-200 text-slate-800 text-[11px] font-semibold hover:bg-emerald-50 inline-flex items-center justify-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Menyinkronkan...' : 'Muat Ulang Sheets'}</span>
                </button>
              ) : actualRole === 'admin' ? (
                <button
                  type="button"
                  onClick={() => setActiveNav('sheets')}
                  className="w-full py-1.5 px-2.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700"
                >
                  Buat / Pilih Spreadsheet
                </button>
              ) : null}
            </div>
          )}
        </div>

        {/* Account & Role Footer */}
        <div className="p-3 border-t border-slate-200 space-y-2">
          {actualRole === 'admin' && (
            <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] font-semibold text-slate-500 mb-1">
                Pratinjau Peran Portal
              </div>
              <select
                value={previewRole}
                onChange={(e) => setPreviewRole(e.target.value as UserRole)}
                className="w-full text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-md px-2 py-1"
              >
                <option value="admin">Dashboard Admin</option>
                <option value="guru">Dashboard Guru / Wali</option>
                <option value="santri_ortu">Portal Santri &amp; Ortu</option>
              </select>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">
                {previewSampleMode
                  ? 'Pratinjau Alwan Hanif'
                  : backendUser?.name || authUser?.displayName || 'Pengguna MDA'}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {previewSampleMode
                  ? 'Data Contoh MDA (Read-only Sheets)'
                  : `${
                      backendUser?.role === 'admin'
                        ? 'Admin'
                        : backendUser?.role === 'guru'
                          ? 'Guru'
                          : 'Wali Santri'
                    }${backendUser?.email ? ` · ${backendUser.email}` : ''}`}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                previewSampleMode ? exitPreviewSampleMode() : void handleLogout()
              }
              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
              title="Keluar"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header */}
        <header className="h-14 sm:h-16 bg-white/95 backdrop-blur-xs border-b border-emerald-200/80 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-3 shrink-0 sticky top-0 z-20">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-700 hover:bg-emerald-50 shrink-0"
              aria-label="Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs text-emerald-700 font-semibold truncate">
                {tpl.namaLembaga} · {tpl.namaPesantren}
              </div>
              <div className="font-display font-bold text-slate-900 text-xs sm:text-base truncate">
                {visibleNavItems.find((i) => i.id === activeNav)?.label || 'Dashboard Rapor'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Real Sync / Connection Indicator */}
            {!previewSampleMode && (
              <button
                type="button"
                onClick={() => void refreshFromServer(false)}
                disabled={isSyncing}
                title="Klik untuk memuat ulang data terbaru dari Google Sheets"
                className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  !isOnline || syncState === 'offline'
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : syncState === 'loading' || syncState === 'saving' || isSyncing
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : syncState === 'error'
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-[#E8FAF3] border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                {!isOnline || syncState === 'offline' ? (
                  <>
                    <WifiOff className="w-3.5 h-3.5" />
                    <span>Offline</span>
                  </>
                ) : syncState === 'loading' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Mengambil Data Sheets...</span>
                  </>
                ) : syncState === 'saving' || isSyncing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Menyimpan ke Sheets...</span>
                  </>
                ) : syncState === 'error' ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Gagal Sinkron</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3 h-3" />
                    <span>Tersinkron Sheets</span>
                  </>
                )}
              </button>
            )}

            {uniqueYears.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5">
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-mono font-semibold bg-[#E8FAF3] border border-emerald-200 rounded-lg text-slate-800"
                  aria-label="Tahun Akademik"
                >
                  {uniqueYears.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedSemester}
                  onChange={(e) =>
                    setSelectedSemester(e.target.value as 'Gasal' | 'Genap')
                  }
                  className="px-2.5 py-1.5 text-xs font-semibold bg-[#E8FAF3] border border-emerald-200 rounded-lg text-slate-800"
                  aria-label="Semester"
                >
                  <option value="Gasal">Gasal</option>
                  <option value="Genap">Genap</option>
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setPrintMode(true)}
              disabled={db.students.length === 0 || db.reports.length === 0}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-[#0E2228] text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0 disabled:opacity-45"
            >
              <Printer className="w-3.5 h-3.5 text-[#1DF27A]" />
              <span>Cetak PDF</span>
            </button>
          </div>
        </header>

        {/* Mobile Quick Period, Refresh & Tab Switcher */}
        <div className="sm:hidden bg-white border-b border-emerald-100 px-3 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {uniqueYears.length > 0 && (
              <>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="min-w-0 flex-1 px-2 py-1.5 text-xs font-mono font-semibold bg-[#E8FAF3] border border-emerald-200 rounded-lg"
                  aria-label="Tahun Akademik Mobile"
                >
                  {uniqueYears.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedSemester}
                  onChange={(e) =>
                    setSelectedSemester(e.target.value as 'Gasal' | 'Genap')
                  }
                  className="px-2 py-1.5 text-xs font-semibold bg-[#E8FAF3] border border-emerald-200 rounded-lg"
                  aria-label="Semester Mobile"
                >
                  <option value="Gasal">Gasal</option>
                  <option value="Genap">Genap</option>
                </select>
              </>
            )}
          </div>

          {effectiveRole === 'santri_ortu' && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setActiveNav('portal')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  activeNav === 'portal'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                Rapor
              </button>
              <button
                type="button"
                onClick={() => setActiveNav('portfolio')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  activeNav === 'portfolio'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                Karya
              </button>
            </div>
          )}

          {!previewSampleMode && (
            <button
              type="button"
              onClick={() => void refreshFromServer(false)}
              disabled={isSyncing}
              className="p-2 rounded-lg border border-emerald-200 bg-[#E8FAF3] text-emerald-800 shrink-0"
              aria-label="Muat Ulang Google Sheets"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

        {/* Toast Notification */}
        {toast && (
          <div className="px-4 sm:px-6 pt-3">
            <div
              className={`px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
                toast.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                {toast.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                <span>{toast.text}</span>
              </span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-slate-500 hover:text-slate-800 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Active Viewport */}
        <main className="flex-1 p-3 sm:p-6 max-w-[1360px] w-full mx-auto space-y-4">
          {/* Explicit Alwan Hanif Preview Sample Mode Banner */}
          {previewSampleMode && (
            <div className="p-3.5 rounded-2xl bg-[#0E2228] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs">
              <div className="space-y-0.5">
                <div className="font-bold text-[#1DF27A] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>MODE PRATINJAU · DATA CONTOH SANTRI ALWAN HANIF</span>
                </div>
                <p className="text-slate-300 text-[11px]">
                  Anda sedang melihat pratinjau struktur dashboard dengan data contoh Alwan Hanif. Perubahan di mode ini tidak dikirim ke Google Sheets.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPreviewRole('admin');
                    setActiveNav('overview');
                  }}
                  className={`px-2.5 py-1.5 rounded-lg font-semibold ${
                    previewRole === 'admin'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white/10 text-slate-200 hover:bg-white/20'
                  }`}
                >
                  Admin View
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewRole('santri_ortu');
                    setSelectedStudentId('std-alwan');
                    setActiveNav('portal');
                  }}
                  className={`px-2.5 py-1.5 rounded-lg font-semibold ${
                    previewRole === 'santri_ortu'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white/10 text-slate-200 hover:bg-white/20'
                  }`}
                >
                  Wali Alwan Hanif
                </button>
                <button
                  type="button"
                  onClick={exitPreviewSampleMode}
                  className="px-3 py-1.5 rounded-lg bg-white text-slate-950 font-bold hover:bg-slate-100"
                >
                  Keluar &amp; Login Asli
                </button>
              </div>
            </div>
          )}

          {/* Legacy LocalStorage Migration Banner for Admin */}
          {!previewSampleMode &&
            actualRole === 'admin' &&
            legacySnapshot &&
            db.spreadsheetId &&
            activeNav !== 'sheets' && (
              <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-sky-950">
                <div>
                  <strong>Data lokal browser lama terdeteksi:</strong> {legacySnapshot.students.length} santri,{' '}
                  {legacySnapshot.reports.length} rapor. Anda dapat memigrasikannya ke Google Sheets tanpa menimpa/duplikasi data.
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleMigrateLocalToSheets}
                    className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold"
                  >
                    Migrasikan Sekarang
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem(LEGACY_LOCAL_DB_KEY);
                      setLegacySnapshot(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-sky-200 bg-white text-sky-800 font-semibold"
                  >
                    Abaikan
                  </button>
                </div>
              </div>
            )}

          {activeNav === 'overview' && effectiveRole !== 'santri_ortu' && (
            <AdminDashboardView
              db={db}
              selectedYear={selectedYear}
              selectedSemester={selectedSemester}
              templateConfig={tpl}
              onOpenGradeEditor={(id) => {
                setSelectedStudentId(id);
                setActiveNav('grading');
              }}
              onOpenStudentPortal={(id) => {
                setSelectedStudentId(id);
                setActiveNav('portal');
              }}
              onOpenPrintReport={(id) => {
                setSelectedStudentId(id);
                setPrintMode(true);
              }}
              onOpenPortfolio={(id) => {
                setSelectedStudentId(id);
                setActiveNav('portfolio');
              }}
              onOpenNarrativeEditor={
                effectiveRole === 'admin' ? () => setActiveNav('template') : undefined
              }
            />
          )}

          {activeNav === 'master' && effectiveRole !== 'santri_ortu' && (
            <MasterManagementView
              db={db}
              canManageAll={effectiveRole === 'admin'}
              onSaveStudents={handleSaveStudents}
              onSaveTeachers={handleSaveTeachers}
              onSavePeriods={handleSavePeriods}
              onUploadPhotoToDrive={async (file) => {
                const res = await handleUploadToDrive(file);
                return res ? res.url : null;
              }}
            />
          )}

          {activeNav === 'grading' && effectiveRole !== 'santri_ortu' && (
            <GradeEditorView
              db={db}
              selectedStudentId={selectedStudentId}
              selectedYear={selectedYear}
              selectedSemester={selectedSemester}
              onSelectStudent={setSelectedStudentId}
              onSaveReport={handleSaveReport}
              onOpenPrint={(id) => {
                setSelectedStudentId(id);
                setPrintMode(true);
              }}
            />
          )}

          {activeNav === 'portal' && (
            <StudentPortalView
              db={db}
              studentId={lockedStudentId || selectedStudentId}
              selectedYear={selectedYear}
              selectedSemester={selectedSemester}
              allowStudentSwitch={effectiveRole !== 'santri_ortu'}
              templateConfig={tpl}
              onSelectStudent={setSelectedStudentId}
              onUpdateStudentPhoto={
                effectiveRole !== 'santri_ortu' ? handleUpdateStudentPhoto : undefined
              }
              onUploadPhotoToDrive={
                hasGoogleOAuthToken || serverHealth?.serviceAccountConfigured
                  ? async (file) => {
                      const res = await handleUploadToDrive(file);
                      return res ? res.url : null;
                    }
                  : undefined
              }
              onOpenPrint={(id) => {
                setSelectedStudentId(id);
                setPrintMode(true);
              }}
              onOpenPortfolio={(id) => {
                setSelectedStudentId(id);
                setActiveNav('portfolio');
              }}
            />
          )}

          {activeNav === 'portfolio' && (
            <PortfolioHubView
              db={db}
              studentId={lockedStudentId || selectedStudentId}
              canEdit={effectiveRole === 'admin' || effectiveRole === 'guru'}
              templateConfig={tpl}
              onSelectStudent={
                effectiveRole !== 'santri_ortu' ? setSelectedStudentId : undefined
              }
              onSavePortfolios={handleSavePortfolios}
              onUpdatePortfolioLink={
                effectiveRole === 'admin' || effectiveRole === 'guru'
                  ? handleUpdateStudentPortfolioLink
                  : undefined
              }
              onUploadMediaToDrive={handleUploadToDrive}
            />
          )}

          {activeNav === 'template' && effectiveRole === 'admin' && (
            <TemplateSettingsView
              config={tpl}
              isGoogleConnected={
                Boolean(
                  hasGoogleOAuthToken ||
                    serverHealth?.serviceAccountConfigured ||
                    serverHealth?.appsScriptConfigured
                )
              }
              onSaveConfig={handleSaveTemplateConfig}
              onUploadAssetToDrive={async (file) => {
                const res = await handleUploadToDrive(file);
                return res ? res.url : null;
              }}
            />
          )}

          {activeNav === 'sheets' && effectiveRole === 'admin' && (
            <SettingsSheetsView
              db={db}
              isGoogleConnected={hasGoogleOAuthToken}
              userEmail={authUser?.email || backendUser?.email || null}
              isSyncing={isSyncing}
              serverHealth={serverHealth}
              localSnapshotStats={
                legacySnapshot
                  ? {
                      hasData: true,
                      students: legacySnapshot.students.length,
                      reports: legacySnapshot.reports.length,
                      portfolios: legacySnapshot.portfolios.length,
                    }
                  : null
              }
              onGoogleLogin={handleGoogleLogin}
              onCreateSpreadsheet={handleCreateSpreadsheet}
              onConnectSpreadsheet={handleConnectSpreadsheet}
              onConnectAppsScript={handleConnectAppsScript}
              onSaveAllAppsScript={handleSaveAllAppsScript}
              onPushToSheets={handlePushToSheets}
              onPullFromSheets={() => void refreshFromServer(false)}
              onMigrateLocalToSheets={handleMigrateLocalToSheets}
              onRestoreBackupJson={handleRestoreBackup}
              onSaveUserAccess={handleSaveUserAccess}
            />
          )}
        </main>
      </div>

      {/* Optimistic Concurrency Conflict Resolution Dialog */}
      {conflictDialog && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setConflictDialog(null)}
        >
          <div
            className="w-full max-w-md bg-white border border-amber-200 rounded-2xl p-5 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-display font-bold text-sm text-slate-900">
                  Konflik Pembaruan Bersamaan Terdeteksi
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  {conflictDialog.message}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={async () => {
                  setConflictDialog(null);
                  await refreshFromServer(false);
                }}
                className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                Muat Data Terbaru dari Sheets
              </button>
              <button
                type="button"
                onClick={() =>
                  void executeReportSave(
                    conflictDialog.report,
                    conflictDialog.serverUpdatedAt,
                    true
                  )
                }
                className="py-2 px-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold"
              >
                Timpa Paksa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Confirmation Modal for Google Sheets / Drive Mutations */}
      <ConfirmDialog
        dialog={confirmDialog}
        onClose={() => setConfirmDialog((d) => ({ ...d, open: false }))}
      />
    </div>
  );
}
