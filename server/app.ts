import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  ConflictError,
  DEFAULT_TEMPLATE_CONFIG,
  bulkImportStudentsInSheet,
  deletePortfolioInSheet,
  deleteStudentInSheet,
  deleteTeacherInSheet,
  extractSpreadsheetId,
  generateSmartAccessPin,
  getServiceAccountAccessToken,
  getServiceAccountStatus,
  mergeLocalSnapshotIntoSheet,
  readDatabaseFromSheet,
  saveTemplateConfigInSheet,
  saveUserAccessInSheet,
  uploadBufferToDrive,
  upsertPeriodInSheet,
  upsertPortfolioInSheet,
  upsertPortfoliosBatchInSheet,
  upsertReportInSheet,
  upsertReportsBatchInSheet,
  upsertStudentInSheet,
  upsertTeacherInSheet,
} from './googleSheetsService.ts';
import {
  DEFAULT_APPS_SCRIPT_SECRET,
  DEFAULT_APPS_SCRIPT_URL,
  bulkImportStudentsInAppsScript,
  deleteCbtExamInAppsScript,
  deletePortfolioInAppsScript,
  deleteStudentInAppsScript,
  deleteTeacherInAppsScript,
  gradeAttemptAgainstQuestions,
  isValidAppsScriptUrl,
  mergeLocalSnapshotIntoAppsScript,
  proctorActionInAppsScript,
  readDatabaseFromAppsScript,
  saveAllToAppsScript,
  saveCbtExamInAppsScript,
  saveCbtQuestionsForExamInAppsScript,
  saveSectionInAppsScript,
  saveTemplateConfigInAppsScript,
  saveUserAccessInAppsScript,
  seedDefaultCbtExamsInAppsScript,
  syncAttemptAndMaybeRaporInAppsScript,
  upsertCbtAttemptInAppsScript,
  upsertInternDailyLogInAppsScript,
  upsertInternProfileInAppsScript,
  upsertPeriodInAppsScript,
  upsertPortfolioInAppsScript,
  upsertPortfoliosBatchInAppsScript,
  upsertReportInAppsScript,
  upsertReportsBatchInAppsScript,
  upsertStudentInAppsScript,
  upsertTeacherInAppsScript,
} from './appsScriptService.ts';
import type {
  AcademicPeriod,
  BrandingTemplateConfig,
  CbtAttempt,
  CbtExam,
  CbtOptionKey,
  CbtQuestion,
  CbtViolationLog,
  InternDailyLog,
  InternProfile,
  InternTrackerItem,
  MdaDatabase,
  PortfolioProject,
  SemesterReport,
  Student,
  StudentCbtQuestion,
  TeacherClass,
  UserAccess,
  UserRole,
} from '../src/types/mda.ts';

export type PortalMode = 'rapor' | 'cbt';

export interface SessionPayload {
  role: UserRole;
  portalMode?: PortalMode;
  userId: string;
  teacherId?: string;
  studentId?: string;
  kelasDiampu?: string;
  email?: string;
  name: string;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  session?: SessionPayload;
}

const RUNTIME_CONFIG_PATH = process.env.VERCEL
  ? '/tmp/.mda-server-config.json'
  : path.resolve(process.cwd(), '.mda-server-config.json');
const SESSION_COOKIE_NAME = 'mda_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

// Stateless HMAC secret: prefers SESSION_SECRET env var; otherwise derives a deterministic
// cross-instance secret so signed cookies remain valid across Vercel serverless cold starts.
function getSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret) return envSecret;
  const appsScriptSecret = process.env.MDA_APPS_SCRIPT_SECRET?.trim() || DEFAULT_APPS_SCRIPT_SECRET;
  const appsScriptUrl = process.env.MDA_APPS_SCRIPT_URL?.trim() || DEFAULT_APPS_SCRIPT_URL;
  return crypto
    .createHmac('sha256', 'mda-darul-fithrah-stateless-session-v1')
    .update(`${appsScriptSecret}::${appsScriptUrl}`)
    .digest('hex');
}

interface RuntimeServerConfig {
  spreadsheetId?: string;
  spreadsheetTitle?: string;
  spreadsheetUrl?: string;
  appsScriptUrl?: string;
  appsScriptSecret?: string;
}

function readRuntimeSpreadsheetConfig(): RuntimeServerConfig {
  try {
    if (fs.existsSync(RUNTIME_CONFIG_PATH)) {
      const raw = fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8');
      return JSON.parse(raw) as RuntimeServerConfig;
    }
  } catch {
    // ignore corrupt runtime file
  }
  return {};
}

function writeRuntimeSpreadsheetConfig(cfg: RuntimeServerConfig) {
  try {
    const prev = readRuntimeSpreadsheetConfig();
    fs.writeFileSync(RUNTIME_CONFIG_PATH, JSON.stringify({ ...prev, ...cfg }, null, 2), 'utf8');
  } catch {
    // Read-only FS fallback: handled cleanly via env vars / default config
  }
}

function resolveAppsScriptConfig(): { url: string; secret: string; configured: boolean } {
  const runtimeCfg = readRuntimeSpreadsheetConfig();
  const url =
    process.env.MDA_APPS_SCRIPT_URL?.trim() ||
    runtimeCfg.appsScriptUrl?.trim() ||
    DEFAULT_APPS_SCRIPT_URL;
  const secret =
    process.env.MDA_APPS_SCRIPT_SECRET?.trim() ||
    runtimeCfg.appsScriptSecret?.trim() ||
    DEFAULT_APPS_SCRIPT_SECRET;
  return {
    url,
    secret,
    configured: isValidAppsScriptUrl(url),
  };
}

function resolveSpreadsheetId(req: Request): string {
  const fromQuery = typeof req.query.sheet === 'string' ? req.query.sheet : '';
  const fromHeader =
    typeof req.headers['x-spreadsheet-id'] === 'string'
      ? req.headers['x-spreadsheet-id']
      : '';
  const fromBody =
    req.body && typeof req.body === 'object' && typeof req.body.spreadsheetId === 'string'
      ? req.body.spreadsheetId
      : '';
  const fromEnv = process.env.MDA_SPREADSHEET_ID || '';
  const fromFile = readRuntimeSpreadsheetConfig().spreadsheetId || '';

  const candidate = fromQuery || fromBody || fromHeader || fromEnv || fromFile;
  return candidate ? extractSpreadsheetId(candidate) : '';
}

async function resolveSheetsAccessToken(req: Request): Promise<string | null> {
  const saToken = await getServiceAccountAccessToken();
  if (saToken) return saToken;

  const headerToken = req.headers['x-google-access-token'];
  if (typeof headerToken === 'string' && headerToken.trim() !== '') {
    return headerToken.trim();
  }
  return null;
}

type BackendStorage =
  | { mode: 'apps_script'; apiUrl: string; secret: string }
  | { mode: 'sheets_api'; token: string; spreadsheetId: string }
  | { mode: 'none' };

async function resolveBackendStorage(req: Request): Promise<BackendStorage> {
  const appsScript = resolveAppsScriptConfig();
  if (appsScript.configured) {
    return {
      mode: 'apps_script',
      apiUrl: appsScript.url,
      secret: appsScript.secret,
    };
  }
  const spreadsheetId = resolveSpreadsheetId(req);
  const token = await resolveSheetsAccessToken(req);
  if (spreadsheetId && token) {
    return { mode: 'sheets_api', token, spreadsheetId };
  }
  return { mode: 'none' };
}

async function loadDbFromStorage(
  storage: Exclude<BackendStorage, { mode: 'none' }>
): Promise<MdaDatabase> {
  if (storage.mode === 'apps_script') {
    return readDatabaseFromAppsScript(storage.apiUrl);
  }
  return readDatabaseFromSheet(storage.token, storage.spreadsheetId);
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function signSessionToken(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.', 2);
  if (!encoded || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed || !parsed.role || !parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function setSessionCookie(req: Request, res: Response, token: string) {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.VERCEL);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const bearerToken =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  const session = verifySessionToken(bearerToken || cookieToken);
  if (!session) {
    res.status(401).json({ error: 'Sesi login tidak valid atau telah berakhir. Silakan masuk ulang.' });
    return;
  }
  req.session = session;
  next();
}

function isTeacherAuthorizedForStudent(
  teacher: TeacherClass | undefined,
  student: Student | undefined
): boolean {
  if (!teacher || !student) return false;
  if (teacher.role === 'admin') return true;
  if (student.waliKelasId === teacher.id) return true;
  const diampu = (teacher.kelasDiampu || '').trim().toLowerCase();
  if (!diampu) return false;
  if (diampu.includes('semua')) return true;
  const studentClass = (student.kelas || '').trim().toLowerCase();
  const tokens = diampu
    .split(/[,;/|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  return tokens.some((tok) => studentClass === tok || studentClass.includes(tok) || tok.includes(studentClass));
}

function sanitizeStudentCbtQuestion(q: CbtQuestion): StudentCbtQuestion {
  return {
    id: q.id,
    examId: q.examId,
    orderNumber: q.orderNumber,
    pertanyaan: q.pertanyaan,
    opsiA: q.opsiA,
    opsiB: q.opsiB,
    opsiC: q.opsiC,
    opsiD: q.opsiD,
    ...(q.opsiE ? { opsiE: q.opsiE } : {}),
    ...(q.imageUrl ? { imageUrl: q.imageUrl } : {}),
  };
}

function sanitizeExamForStudent(exam: CbtExam): CbtExam {
  return {
    ...exam,
    token: '', // Never expose exam token to students
  };
}

function sanitizeAttemptForStudent(attempt: CbtAttempt, exam?: CbtExam): CbtAttempt {
  if (exam && exam.showScoreAfterFinish === false && attempt.status === 'submitted') {
    const { score: _s, benarCount: _b, salahCount: _w, ...rest } = attempt;
    return rest;
  }
  return attempt;
}

function shuffleIds(ids: string[]): string[] {
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function scopeDatabaseForSession(db: MdaDatabase, session: SessionPayload): MdaDatabase {
  if (session.role === 'admin') {
    return db;
  }

  if (session.role === 'guru') {
    const teacher = db.teachers.find((t) => t.id === session.teacherId);
    const allowedStudents = db.students.filter((s) =>
      isTeacherAuthorizedForStudent(teacher, s)
    );
    const allowedIds = new Set(allowedStudents.map((s) => s.id));

    return {
      periods: db.periods,
      teachers: db.teachers.map((t) => ({
        id: t.id,
        nama: t.nama,
        jabatan: t.jabatan,
        email: t.id === teacher?.id ? t.email : '',
        kelasDiampu: t.kelasDiampu,
        role: t.role,
        ttdUrl: t.ttdUrl || '',
      })),
      students: allowedStudents.map((s) => ({
        ...s,
        accessPin: '', // Never expose parent PINs in bulk unless needed by admin
      })),
      reports: db.reports.filter((r) => allowedIds.has(r.studentId)),
      portfolios: db.portfolios.filter((p) => allowedIds.has(p.studentId)),
      userAccess: [],
      cbtExams: db.cbtExams || [],
      cbtQuestions: db.cbtQuestions || [],
      cbtAttempts: (db.cbtAttempts || []).filter((a) => allowedIds.has(a.studentId)),
      internProfiles: (db.internProfiles || []).filter((p) => allowedIds.has(p.studentId)),
      internDailyLogs: (db.internDailyLogs || []).filter((l) => allowedIds.has(l.studentId)),
      templateConfig: db.templateConfig,
      spreadsheetId: db.spreadsheetId,
      spreadsheetUrl: db.spreadsheetUrl,
      spreadsheetTitle: db.spreadsheetTitle,
      lastSyncedAt: db.lastSyncedAt,
    };
  }

  // Strictly scoped parent/student view — ONLY 1 child, NO other students, NO PINs, NO answer keys
  const myStudent = db.students.find((s) => s.id === session.studentId);
  const myId = myStudent?.id || '__none__';
  const isCbtPortal = session.portalMode === 'cbt';
  const isRaporLocked = !isCbtPortal && Boolean(db.templateConfig?.lockRaporDuringExam);
  const examsById = new Map((db.cbtExams || []).map((e) => [e.id, e]));

  return {
    periods: isCbtPortal ? [] : db.periods,
    teachers: isCbtPortal
      ? []
      : db.teachers.map((t) => ({
          id: t.id,
          nama: t.nama,
          jabatan: t.jabatan,
          email: '',
          kelasDiampu: t.kelasDiampu,
          role: t.role,
          ttdUrl: t.ttdUrl || '',
        })),
    students: myStudent ? [{ ...myStudent, accessPin: '' }] : [],
    reports: isCbtPortal || isRaporLocked ? [] : db.reports.filter((r) => r.studentId === myId),
    portfolios:
      isCbtPortal || isRaporLocked ? [] : db.portfolios.filter((p) => p.studentId === myId),
    userAccess: [],
    cbtExams: isCbtPortal ? (db.cbtExams || []).map(sanitizeExamForStudent) : [],
    cbtQuestions: [], // Never send answer keys in /api/data for students
    cbtAttempts: isCbtPortal
      ? (db.cbtAttempts || [])
          .filter((a) => a.studentId === myId)
          .map((a) => sanitizeAttemptForStudent(a, examsById.get(a.examId)))
      : [],
    internProfiles: isCbtPortal
      ? []
      : (db.internProfiles || []).filter((p) => p.studentId === myId),
    internDailyLogs: isCbtPortal
      ? []
      : (db.internDailyLogs || []).filter((l) => l.studentId === myId),
    templateConfig: db.templateConfig,
    spreadsheetId: db.spreadsheetId,
    spreadsheetUrl: db.spreadsheetUrl,
    spreadsheetTitle: db.spreadsheetTitle,
    lastSyncedAt: db.lastSyncedAt,
  };
}

export function createApiApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '15mb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    next();
  });

  // 1. Safe server diagnostics (NO private keys / secrets exposed)
  app.get('/api/health', async (req, res) => {
    const sa = getServiceAccountStatus();
    const spreadsheetId = resolveSpreadsheetId(req);
    const runtimeCfg = readRuntimeSpreadsheetConfig();
    const appsScript = resolveAppsScriptConfig();
    res.json({
      ok: true,
      serviceAccountConfigured: sa.configured,
      serviceAccountEmail: sa.clientEmail,
      spreadsheetConfigured: Boolean(spreadsheetId) || appsScript.configured,
      spreadsheetId: spreadsheetId || null,
      spreadsheetTitle: runtimeCfg.spreadsheetTitle || null,
      appsScriptConfigured: appsScript.configured,
      appsScriptUrl: appsScript.url,
    });
  });

  // 2. Public safe branding config for login screen (no student records or PINs!)
  app.get('/api/config/public', async (req, res) => {
    const storage = await resolveBackendStorage(req);
    if (storage.mode !== 'none') {
      try {
        const db = await loadDbFromStorage(storage);
        res.json({
          connected: true,
          spreadsheetId: db.spreadsheetId || null,
          spreadsheetTitle: db.spreadsheetTitle,
          templateConfig: db.templateConfig || DEFAULT_TEMPLATE_CONFIG,
        });
        return;
      } catch (err: any) {
        res.status(502).json({
          connected: false,
          spreadsheetId: storage.mode === 'sheets_api' ? storage.spreadsheetId : null,
          error: err.message || 'Gagal membaca konfigurasi dari Google Sheets.',
          templateConfig: DEFAULT_TEMPLATE_CONFIG,
        });
        return;
      }
    }
    res.json({
      connected: false,
      spreadsheetId: resolveSpreadsheetId(req) || null,
      templateConfig: DEFAULT_TEMPLATE_CONFIG,
    });
  });

  // Helper for matching Student / Parent credentials cleanly across both Rapor & CBT doors
  function matchStudentCredential(
    db: MdaDatabase,
    identifier: string,
    pin: string
  ): { matchedStudent?: Student; matchedAccess?: UserAccess } {
    const q = identifier.trim().replace(/\s+/g, ' ').toLowerCase();
    const normalizedPin = pin.trim().toUpperCase();

    let matchedStudent = db.students.find((s) => {
      const matchIdentity =
        s.nisnMda.trim().toLowerCase() === q ||
        s.id.trim().toLowerCase() === q ||
        s.nama.trim().replace(/\s+/g, ' ').toLowerCase() === q ||
        (s.emailSantriOrtu || '').trim().toLowerCase() === q;
      if (!matchIdentity) return false;
      const expectedPin = (s.accessPin || generateSmartAccessPin(s.nama, s.nisnMda))
        .trim()
        .toUpperCase();
      if (expectedPin === normalizedPin) return true;
      return db.userAccess.some(
        (u) =>
          u.statusAktif !== false &&
          u.role === 'santri_ortu' &&
          u.linkedStudentId === s.id &&
          Boolean(u.accessPin?.trim()) &&
          u.accessPin!.trim().toUpperCase() === normalizedPin
      );
    });

    let matchedAccess: UserAccess | undefined;
    if (!matchedStudent) {
      matchedAccess = db.userAccess.find((u) => {
        if (u.statusAktif === false || u.role !== 'santri_ortu') return false;
        const linked = db.students.find((s) => s.id === u.linkedStudentId);
        const matchUserIdentity =
          u.email.trim().toLowerCase() === q ||
          u.nama.trim().replace(/\s+/g, ' ').toLowerCase() === q ||
          u.id.trim().toLowerCase() === q ||
          Boolean(
            linked &&
              (linked.nisnMda.trim().toLowerCase() === q ||
                linked.nama.trim().replace(/\s+/g, ' ').toLowerCase() === q)
          );
        if (!matchUserIdentity) return false;

        const customPin = (u.accessPin || '').trim().toUpperCase();
        if (customPin && customPin === normalizedPin) return true;

        if (linked) {
          const studentPin = (
            linked.accessPin || generateSmartAccessPin(linked.nama, linked.nisnMda)
          )
            .trim()
            .toUpperCase();
          return studentPin === normalizedPin;
        }
        return false;
      });

      if (matchedAccess) {
        matchedStudent = db.students.find((s) => s.id === matchedAccess!.linkedStudentId);
      }
    }

    return { matchedStudent, matchedAccess };
  }

  // 3A. Portal Rapor & Portofolio (Wali/Santri) Login — honors lockRaporDuringExam!
  app.post('/api/auth/login-parent', async (req, res) => {
    try {
      const { identifier, pin } = req.body as { identifier?: string; pin?: string };
      const q = (identifier || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const normalizedPin = (pin || '').trim().toUpperCase();
      if (!q || !normalizedPin) {
        res.status(400).json({ error: 'Masukkan ID/Nama/Email Santri & Wali beserta PIN Akses.' });
        return;
      }

      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({
          error:
            'Koneksi database Google Sheets / Apps Script belum aktif. Hubungi Admin MDA untuk menempelkan URL Web App Apps Script di Pengaturan.',
        });
        return;
      }

      const db = await loadDbFromStorage(storage);

      // Saat lockRaporDuringExam aktif, santri/wali TETAP bisa masuk untuk mengisi
      // Jurnaling Magang & Tracker Ibadah. Hanya tab Rapor & Portofolio yang dikunci.
      const { matchedStudent, matchedAccess } = matchStudentCredential(db, q, normalizedPin);

      if (!matchedStudent && !matchedAccess) {
        res.status(401).json({
          error: 'ID/Nama Santri atau PIN Akses tidak sesuai. Periksa kembali kartu akses wali.',
        });
        return;
      }

      const targetStudentId = matchedStudent?.id || matchedAccess?.linkedStudentId || '__none__';
      const displayName = matchedStudent
        ? `Wali ${matchedStudent.nama}`
        : matchedAccess?.nama || 'Wali Santri';

      const session: SessionPayload = {
        role: 'santri_ortu',
        portalMode: 'rapor',
        userId: matchedStudent ? `parent:${matchedStudent.id}` : `access:${matchedAccess!.id}`,
        studentId: targetStudentId,
        email: matchedAccess?.email || matchedStudent?.emailSantriOrtu || undefined,
        name: displayName,
        exp: Date.now() + SESSION_TTL_MS,
      };
      const sessionToken = signSessionToken(session);
      setSessionCookie(req, res, sessionToken);

      res.json({
        sessionToken,
        user: session,
        data: scopeDatabaseForSession(db, session),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Gagal memverifikasi login wali santri.' });
    }
  });

  // 3B. Ruang Ujian CBT (Santri) Login — stays OPEN during Exam Week, strictly isolated from Rapor!
  app.post('/api/auth/login-cbt', async (req, res) => {
    try {
      const { identifier, pin } = req.body as { identifier?: string; pin?: string };
      const q = (identifier || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const normalizedPin = (pin || '').trim().toUpperCase();
      if (!q || !normalizedPin) {
        res.status(400).json({ error: 'Masukkan ID/NIS/Nama Santri beserta PIN Akses CBT.' });
        return;
      }

      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({
          error:
            'Koneksi database Google Sheets / Apps Script belum aktif. Hubungi Pengawas / Admin MDA.',
        });
        return;
      }

      const db = await loadDbFromStorage(storage);
      const { matchedStudent, matchedAccess } = matchStudentCredential(db, q, normalizedPin);

      if (!matchedStudent && !matchedAccess) {
        res.status(401).json({
          error: 'ID/NIS/Nama Santri atau PIN Akses tidak sesuai. Periksa kartu peserta ujian Anda.',
        });
        return;
      }

      const targetStudentId = matchedStudent?.id || matchedAccess?.linkedStudentId || '__none__';
      const displayName = matchedStudent?.nama || matchedAccess?.nama || 'Peserta CBT';

      const session: SessionPayload = {
        role: 'santri_ortu',
        portalMode: 'cbt',
        userId: matchedStudent ? `cbt:${matchedStudent.id}` : `cbt-access:${matchedAccess!.id}`,
        studentId: targetStudentId,
        email: matchedAccess?.email || matchedStudent?.emailSantriOrtu || undefined,
        name: displayName,
        exp: Date.now() + SESSION_TTL_MS,
      };
      const sessionToken = signSessionToken(session);
      setSessionCookie(req, res, sessionToken);

      res.json({
        sessionToken,
        user: session,
        data: scopeDatabaseForSession(db, session),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Gagal memverifikasi login Ruang Ujian CBT.' });
    }
  });

  // 4. Staff (Admin / Guru) PIN Login (Super Admin fallback + live teachers & userAccess)
  app.post('/api/auth/login-staff-pin', async (req, res) => {
    try {
      const { identifier, pin } = req.body as { identifier?: string; pin?: string };
      const q = (identifier || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const rawPin = (pin || '').trim();
      const normalizedPin = rawPin.toUpperCase();
      if (!q || !normalizedPin) {
        res.status(400).json({ error: 'Masukkan Nama/ID/Email Guru beserta PIN Akses.' });
        return;
      }

      const storage = await resolveBackendStorage(req);

      // Built-in Super Admin fallback (works even when Google Sheets teachers table is empty [])
      const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
      const adminPin = (process.env.ADMIN_PIN || 'mda2026admin').trim();
      const isSuperAdmin =
        q === adminUsername &&
        (rawPin === adminPin || normalizedPin === adminPin.toUpperCase());

      if (isSuperAdmin) {
        let db: MdaDatabase = {
          periods: [],
          teachers: [],
          students: [],
          reports: [],
          portfolios: [],
          userAccess: [],
          templateConfig: DEFAULT_TEMPLATE_CONFIG,
        };
        if (storage.mode !== 'none') {
          try {
            db = await loadDbFromStorage(storage);
          } catch {
            // Keep empty DB fallback so Super Admin can enter dashboard and inspect/fix settings
          }
        }
        const session: SessionPayload = {
          role: 'admin',
          userId: `superadmin:${adminUsername}`,
          email: 'dfacmi123@gmail.com',
          name: 'Super Admin MDA',
          exp: Date.now() + SESSION_TTL_MS,
        };
        const sessionToken = signSessionToken(session);
        setSessionCookie(req, res, sessionToken);
        res.json({
          sessionToken,
          user: session,
          data: scopeDatabaseForSession(db, session),
        });
        return;
      }

      if (storage.mode === 'none') {
        res.status(503).json({
          error:
            'Koneksi database Google Sheets / Apps Script belum aktif. Masuk sebagai Super Admin untuk menempelkan URL Web App Apps Script di Pengaturan.',
        });
        return;
      }

      const db = await loadDbFromStorage(storage);
      const matchedTeacher = db.teachers.find((t) => {
        const matchIdentity =
          t.nama.trim().replace(/\s+/g, ' ').toLowerCase() === q ||
          (t.kodeGuru || '').trim().toLowerCase() === q ||
          t.id.trim().toLowerCase() === q ||
          t.email.trim().toLowerCase() === q;
        const expectedPin = (t.accessPin || generateSmartAccessPin(t.nama, t.kodeGuru || t.id))
          .trim()
          .toUpperCase();
        return matchIdentity && expectedPin === normalizedPin;
      });

      const matchedStaffAccess = !matchedTeacher
        ? db.userAccess.find((u) => {
            if (u.statusAktif === false || (u.role !== 'admin' && u.role !== 'guru')) {
              return false;
            }
            const matchIdentity =
              u.email.trim().toLowerCase() === q ||
              u.nama.trim().replace(/\s+/g, ' ').toLowerCase() === q ||
              u.id.trim().toLowerCase() === q;
            const customPin = (u.accessPin || '').trim().toUpperCase();
            return matchIdentity && Boolean(customPin) && customPin === normalizedPin;
          })
        : undefined;

      if (!matchedTeacher && !matchedStaffAccess) {
        res.status(401).json({
          error: 'Nama/ID/Email Guru atau PIN Akses tidak sesuai.',
        });
        return;
      }

      const session: SessionPayload = matchedTeacher
        ? {
            role: matchedTeacher.role,
            userId: `teacher:${matchedTeacher.id}`,
            teacherId: matchedTeacher.id,
            kelasDiampu: matchedTeacher.kelasDiampu,
            email: matchedTeacher.email,
            name: matchedTeacher.nama,
            exp: Date.now() + SESSION_TTL_MS,
          }
        : {
            role: matchedStaffAccess!.role,
            userId: `access:${matchedStaffAccess!.id}`,
            email: matchedStaffAccess!.email,
            name: matchedStaffAccess!.nama,
            exp: Date.now() + SESSION_TTL_MS,
          };

      const sessionToken = signSessionToken(session);
      setSessionCookie(req, res, sessionToken);

      res.json({
        sessionToken,
        user: session,
        data: scopeDatabaseForSession(db, session),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Gagal memverifikasi login guru/admin.' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const isHttps =
      req.secure ||
      req.headers['x-forwarded-proto'] === 'https' ||
      process.env.NODE_ENV === 'production' ||
      Boolean(process.env.VERCEL);
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      path: '/',
    });
    res.json({ ok: true });
  });

  // 6. Authenticated Read (always reads fresh from Google Sheets / Apps Script & scopes strictly by role & portalMode)
  app.get('/api/data', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({
          error: 'Spreadsheet / Apps Script Google Sheets belum terhubung di server.',
          spreadsheetId: resolveSpreadsheetId(req) || null,
        });
        return;
      }
      const db = await loadDbFromStorage(storage);
      res.json({
        user: session,
        data: scopeDatabaseForSession(db, session),
      });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal membaca data dari Google Sheets.' });
    }
  });

  // 7. Admin Connect Spreadsheet (persists ID in runtime config & validates access)
  app.post('/api/admin/spreadsheet/connect', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat menghubungkan Google Spreadsheet.' });
        return;
      }
      const { spreadsheetId: rawId } = req.body as { spreadsheetId?: string };
      const spreadsheetId = extractSpreadsheetId(rawId || '');
      if (!spreadsheetId) {
        res.status(400).json({ error: 'ID atau URL Google Spreadsheet tidak valid.' });
        return;
      }
      const token = await resolveSheetsAccessToken(req);
      if (!token) {
        res.status(503).json({
          error:
            'Kredensial akses Google Sheets tidak tersedia. Gunakan URL Web App Apps Script, GOOGLE_SERVICE_ACCOUNT_JSON, atau login dengan Google.',
        });
        return;
      }

      const db = await readDatabaseFromSheet(token, spreadsheetId);
      writeRuntimeSpreadsheetConfig({
        spreadsheetId: db.spreadsheetId || spreadsheetId,
        spreadsheetTitle: db.spreadsheetTitle,
        spreadsheetUrl: db.spreadsheetUrl,
      });

      res.json({ data: db });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menghubungkan Spreadsheet.' });
    }
  });

  // 7B. Admin Connect Google Apps Script Web App URL & Secret
  app.post('/api/admin/apps-script/connect', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat menghubungkan Google Apps Script.' });
        return;
      }
      const { appsScriptUrl, secret } = req.body as { appsScriptUrl?: string; secret?: string };
      const cleanUrl = (appsScriptUrl || '').trim();
      if (!isValidAppsScriptUrl(cleanUrl)) {
        res.status(400).json({
          error:
            'URL Web App Google Apps Script tidak valid. Tempel URL asli deployment Anda (berawalan https://script.google.com/macros/s/.../exec).',
        });
        return;
      }

      const db = await readDatabaseFromAppsScript(cleanUrl);
      writeRuntimeSpreadsheetConfig({
        appsScriptUrl: cleanUrl,
        ...(secret?.trim() ? { appsScriptSecret: secret.trim() } : {}),
        spreadsheetTitle: 'Google Sheets (Apps Script API)',
        spreadsheetUrl: cleanUrl,
      });

      res.json({ data: db, appsScriptUrl: cleanUrl });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menguji koneksi Google Apps Script.' });
    }
  });

  // 7C. Admin Save All payload directly to Google Apps Script (POST saveAll with text/plain)
  app.post('/api/admin/apps-script/save-all', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat menjalankan saveAll ke Apps Script.' });
        return;
      }
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({
          error:
            'URL Web App Google Apps Script masih berisi contoh "https://script.google.com/macros/s/XXXX/exec". Ganti XXXX dengan ID deployment Web App asli Anda.',
        });
        return;
      }
      const { data } = req.body as { data?: MdaDatabase };
      if (!data) {
        res.status(400).json({ error: 'Payload database tidak ditemukan.' });
        return;
      }

      const saved = await saveAllToAppsScript(appsScript.url, appsScript.secret, data);
      const freshDb = await readDatabaseFromAppsScript(appsScript.url);
      res.json({ data: freshDb, updatedAt: saved.updatedAt });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan data ke Google Apps Script.' });
    }
  });

  // 8. Safe non-duplicating migration from localStorage snapshot to Google Sheets / Apps Script
  app.post('/api/admin/migrate-local', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat melakukan migrasi data.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets / Apps Script belum terhubung.' });
        return;
      }
      const { localDb } = req.body as { localDb?: MdaDatabase };
      if (!localDb) {
        res.status(400).json({ error: 'Data lokal tidak ditemukan.' });
        return;
      }
      const result =
        storage.mode === 'apps_script'
          ? await mergeLocalSnapshotIntoAppsScript(storage.apiUrl, storage.secret, localDb)
          : await mergeLocalSnapshotIntoSheet(storage.token, storage.spreadsheetId, localDb);
      res.json(result);
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal migrasi data lokal.' });
    }
  });

  // 9. Upsert Report by Unique ID (with Guru scope check + optimistic concurrency guard)
  app.post('/api/reports/upsert', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role === 'santri_ortu') {
        res.status(403).json({ error: 'Wali santri hanya memiliki akses membaca rapor.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }

      const { report, expectedUpdatedAt, forceOverwrite } = req.body as {
        report?: SemesterReport;
        expectedUpdatedAt?: string;
        forceOverwrite?: boolean;
      };
      if (!report || !report.id || !report.studentId) {
        res.status(400).json({ error: 'Data rapor atau ID santri tidak lengkap.' });
        return;
      }

      if (session.role === 'guru') {
        const snapshot = await loadDbFromStorage(storage);
        const teacher = snapshot.teachers.find((t) => t.id === session.teacherId);
        const targetStudent = snapshot.students.find((s) => s.id === report.studentId);
        if (!isTeacherAuthorizedForStudent(teacher, targetStudent)) {
          res.status(403).json({
            error: 'Anda tidak memiliki kewenangan mengubah nilai santri di luar kelas yang Anda ampu.',
          });
          return;
        }
      }

      const saved =
        storage.mode === 'apps_script'
          ? await upsertReportInAppsScript(
              storage.apiUrl,
              storage.secret,
              report,
              expectedUpdatedAt,
              Boolean(forceOverwrite)
            )
          : await upsertReportInSheet(
              storage.token,
              storage.spreadsheetId,
              report,
              expectedUpdatedAt,
              Boolean(forceOverwrite)
            );
      res.json({
        report: saved.report,
        data: scopeDatabaseForSession(saved.db, session),
      });
    } catch (err: any) {
      if (err instanceof ConflictError) {
        res.status(409).json({
          code: 'VERSION_CONFLICT',
          error: err.message,
          serverUpdatedAt: err.serverUpdatedAt,
          serverReport: err.serverReport,
        });
        return;
      }
      res.status(502).json({ error: err.message || 'Gagal menyimpan rapor ke Google Sheets.' });
    }
  });

  // 9B. Batch Upsert Reports for Bulk Subject Grade Entry ("Nilai Mata Pelajaran")
  app.post('/api/reports/batch-upsert', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role === 'santri_ortu') {
        res.status(403).json({ error: 'Wali santri hanya memiliki akses membaca rapor.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }

      const { reports } = req.body as { reports?: SemesterReport[] };
      if (!Array.isArray(reports) || reports.length === 0) {
        res.status(400).json({ error: 'Daftar rapor yang akan disimpan tidak ditemukan.' });
        return;
      }

      for (const r of reports) {
        if (!r?.id || !r?.studentId) {
          res.status(400).json({ error: 'Setiap item rapor wajib memiliki ID rapor dan ID santri.' });
          return;
        }
      }

      if (session.role === 'guru') {
        const snapshot = await loadDbFromStorage(storage);
        const teacher = snapshot.teachers.find((t) => t.id === session.teacherId);
        for (const r of reports) {
          const targetStudent = snapshot.students.find((s) => s.id === r.studentId);
          if (!isTeacherAuthorizedForStudent(teacher, targetStudent)) {
            res.status(403).json({
              error: 'Anda tidak memiliki kewenangan mengubah nilai santri di luar kelas yang Anda ampu.',
            });
            return;
          }
        }
      }

      const saved =
        storage.mode === 'apps_script'
          ? await upsertReportsBatchInAppsScript(storage.apiUrl, storage.secret, reports)
          : await upsertReportsBatchInSheet(storage.token, storage.spreadsheetId, reports);

      res.json({
        reports: saved.reports,
        data: scopeDatabaseForSession(saved.db, session),
      });
    } catch (err: any) {
      res.status(502).json({
        error: err.message || 'Gagal menyimpan nilai massal ke Google Sheets.',
      });
    }
  });

  // 10. Upsert / Delete Student by Unique ID
  app.post('/api/students/upsert', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role === 'santri_ortu') {
        res.status(403).json({ error: 'Wali santri tidak diizinkan mengubah data santri.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }

      const { student } = req.body as { student?: Student };
      if (!student || !student.id || !student.nama) {
        res.status(400).json({ error: 'Data santri tidak lengkap.' });
        return;
      }

      const currentDb = await loadDbFromStorage(storage);
      const existing = currentDb.students.find((s) => s.id === student.id);

      const sanitizeExternalUrl = (raw?: string) => {
        const clean = String(raw || '').replace(/[\r\n\t]+/g, '').trim();
        if (!clean || /^(javascript|data|vbscript):/i.test(clean)) return '';
        if (/^https?:\/\//i.test(clean)) return clean;
        if (clean.startsWith('//')) return `https:${clean}`;
        return `https://${clean}`;
      };

      if (session.role === 'guru') {
        const teacher = currentDb.teachers.find((t) => t.id === session.teacherId);
        if (!existing || !isTeacherAuthorizedForStudent(teacher, existing)) {
          res.status(403).json({
            error: 'Guru hanya dapat memperbarui foto atau link portofolio santri binaannya sendiri.',
          });
          return;
        }
        // Guru cannot alter PIN, waliKelasId, or statusAktif
        const safeStudent: Student = {
          ...existing,
          fotoUrl: student.fotoUrl ?? existing.fotoUrl,
          portfolioSlug: student.portfolioSlug ?? existing.portfolioSlug,
          behanceUrl:
            student.behanceUrl !== undefined
              ? sanitizeExternalUrl(student.behanceUrl)
              : existing.behanceUrl || '',
          portfolioPdfUrl:
            student.portfolioPdfUrl !== undefined
              ? sanitizeExternalUrl(student.portfolioPdfUrl)
              : existing.portfolioPdfUrl || '',
          portfolioPdfSubject:
            student.portfolioPdfSubject !== undefined
              ? String(student.portfolioPdfSubject || '').trim()
              : existing.portfolioPdfSubject || '',
        };
        const result =
          storage.mode === 'apps_script'
            ? await upsertStudentInAppsScript(storage.apiUrl, storage.secret, safeStudent)
            : await upsertStudentInSheet(storage.token, storage.spreadsheetId, safeStudent);
        res.json({ data: scopeDatabaseForSession(result.db, session) });
        return;
      }

      const sanitizedAdminStudent: Student = {
        ...student,
        behanceUrl: sanitizeExternalUrl(student.behanceUrl),
        portfolioPdfUrl: sanitizeExternalUrl(student.portfolioPdfUrl),
        portfolioPdfSubject: String(student.portfolioPdfSubject || '').trim(),
      };

      const result =
        storage.mode === 'apps_script'
          ? await upsertStudentInAppsScript(storage.apiUrl, storage.secret, sanitizedAdminStudent)
          : await upsertStudentInSheet(storage.token, storage.spreadsheetId, sanitizedAdminStudent);
      res.json({ data: scopeDatabaseForSession(result.db, session) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan data santri ke Google Sheets.' });
    }
  });

  app.post('/api/students/bulk-import', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat mengimpor data santri secara massal.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }

      const {
        students,
        userAccess = [],
        duplicatePolicy = 'skip',
      } = req.body as {
        students?: Student[];
        userAccess?: UserAccess[];
        duplicatePolicy?: 'skip' | 'update';
      };

      if (!Array.isArray(students) || students.length === 0) {
        res.status(400).json({ error: 'Daftar santri yang akan diimpor masih kosong.' });
        return;
      }

      const sanitizedStudents: Student[] = students
        .filter((s) => s && (s.nisnMda || s.id) && s.nama)
        .map((s) => {
          const nisnMda = String(s.nisnMda || s.id).trim();
          const nama = String(s.nama).trim();
          const kelas = String(s.kelas || 'MDA Putri').trim();
          const id =
            String(s.id || '').trim() ||
            `std-${nisnMda.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          const accessPin =
            String(s.accessPin || '').trim().toUpperCase() ||
            generateSmartAccessPin(nama, nisnMda);
          return {
            id,
            nisnMda,
            nama,
            kelas,
            program:
              String(s.program || '').trim() ||
              `Muslim Digital Academy – ${kelas.replace(/^MDA\s+/i, '')}`,
            waliKelasId: String(s.waliKelasId || ''),
            waliKelasNama: String(s.waliKelasNama || ''),
            fotoUrl: String(s.fotoUrl || ''),
            emailSantriOrtu: String(s.emailSantriOrtu || ''),
            portfolioSlug:
              String(s.portfolioSlug || '').trim() ||
              nama
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-'),
            behanceUrl: String(s.behanceUrl || '').trim(),
            portfolioPdfUrl: String(s.portfolioPdfUrl || '').trim(),
            portfolioPdfSubject: String(s.portfolioPdfSubject || '').trim(),
            accessPin,
            statusAktif:
              s.statusAktif === 'Alumni' || s.statusAktif === 'Cuti'
                ? s.statusAktif
                : 'Aktif',
          };
        });

      if (sanitizedStudents.length === 0) {
        res.status(400).json({ error: 'Tidak ada baris santri valid (wajib memiliki ID dan Nama).' });
        return;
      }

      const sanitizedAccess: UserAccess[] = (Array.isArray(userAccess) ? userAccess : []).map(
        (u) => ({
          id: String(u.id || `usr-${u.linkedStudentId}`),
          email: String(u.email || `${u.linkedStudentId}@santri.mda.sch.id`),
          nama: String(u.nama || ''),
          role: 'santri_ortu',
          linkedStudentId: String(u.linkedStudentId || ''),
          accessPin: u.accessPin ? String(u.accessPin).trim().toUpperCase() : undefined,
          statusAktif: u.statusAktif !== false,
        })
      );

      const result =
        storage.mode === 'apps_script'
          ? await bulkImportStudentsInAppsScript(storage.apiUrl, storage.secret, {
              students: sanitizedStudents,
              userAccess: sanitizedAccess,
              duplicatePolicy,
            })
          : await bulkImportStudentsInSheet(storage.token, storage.spreadsheetId, {
              students: sanitizedStudents,
              userAccess: sanitizedAccess,
              duplicatePolicy,
            });

      res.json({
        data: scopeDatabaseForSession(result.db, session),
        addedCount: result.addedCount,
        updatedCount: result.updatedCount,
        skippedCount: result.skippedCount,
        addedAccessCount: result.addedAccessCount,
      });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal mengimpor data santri ke Google Sheets.' });
    }
  });

  app.delete('/api/students/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat menghapus data santri.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }
      const nextDb =
        storage.mode === 'apps_script'
          ? await deleteStudentInAppsScript(storage.apiUrl, storage.secret, String(req.params.id))
          : await deleteStudentInSheet(storage.token, storage.spreadsheetId, String(req.params.id));
      res.json({ data: scopeDatabaseForSession(nextDb, session) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menghapus data santri.' });
    }
  });

  // 11. Teachers, Periods, Template, User Access (Admin-only writes)
  app.post('/api/teachers/upsert', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.session!.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat mengelola data guru.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }
      const { teacher } = req.body as { teacher?: TeacherClass };
      if (!teacher || !teacher.id || !teacher.nama) {
        res.status(400).json({ error: 'Data guru tidak lengkap.' });
        return;
      }
      const nextDb =
        storage.mode === 'apps_script'
          ? await upsertTeacherInAppsScript(storage.apiUrl, storage.secret, teacher)
          : await upsertTeacherInSheet(storage.token, storage.spreadsheetId, teacher);
      res.json({ data: scopeDatabaseForSession(nextDb, req.session!) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan data guru.' });
    }
  });

  app.delete('/api/teachers/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.session!.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat menghapus data guru.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }
      const nextDb =
        storage.mode === 'apps_script'
          ? await deleteTeacherInAppsScript(storage.apiUrl, storage.secret, String(req.params.id))
          : await deleteTeacherInSheet(storage.token, storage.spreadsheetId, String(req.params.id));
      res.json({ data: scopeDatabaseForSession(nextDb, req.session!) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menghapus data guru.' });
    }
  });

  app.post('/api/periods/upsert', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.session!.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat mengubah periode akademik & KKM.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }
      const { period } = req.body as { period?: AcademicPeriod };
      if (!period || !period.id) {
        res.status(400).json({ error: 'Data periode tidak lengkap.' });
        return;
      }
      const nextDb =
        storage.mode === 'apps_script'
          ? await upsertPeriodInAppsScript(storage.apiUrl, storage.secret, period)
          : await upsertPeriodInSheet(storage.token, storage.spreadsheetId, period);
      res.json({ data: scopeDatabaseForSession(nextDb, req.session!) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan periode.' });
    }
  });

  app.post('/api/portfolios/upsert', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role === 'santri_ortu') {
        res.status(403).json({ error: 'Wali santri tidak dapat mengubah portofolio.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }
      const { project } = req.body as { project?: PortfolioProject };
      if (!project || !project.id || !project.studentId) {
        res.status(400).json({ error: 'Data portofolio tidak lengkap.' });
        return;
      }

      if (session.role === 'guru') {
        const snapshot = await loadDbFromStorage(storage);
        const teacher = snapshot.teachers.find((t) => t.id === session.teacherId);
        const targetStudent = snapshot.students.find((s) => s.id === project.studentId);
        if (!isTeacherAuthorizedForStudent(teacher, targetStudent)) {
          res.status(403).json({
            error: 'Anda tidak memiliki akses mengubah portofolio santri di luar kelas binaan Anda.',
          });
          return;
        }
      }

      const nextDb =
        storage.mode === 'apps_script'
          ? await upsertPortfolioInAppsScript(storage.apiUrl, storage.secret, project)
          : await upsertPortfolioInSheet(storage.token, storage.spreadsheetId, project);
      res.json({ data: scopeDatabaseForSession(nextDb, session) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan karya portofolio.' });
    }
  });

  app.post('/api/portfolios/batch-upsert', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role === 'santri_ortu') {
        res.status(403).json({ error: 'Wali santri tidak dapat mengubah portofolio.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }
      const { projects } = req.body as { projects?: PortfolioProject[] };
      if (!Array.isArray(projects) || projects.length === 0) {
        res.status(400).json({ error: 'Daftar karya portofolio kosong.' });
        return;
      }
      const validProjects = projects.filter((p) => p && p.id && p.studentId);
      if (validProjects.length === 0) {
        res.status(400).json({ error: 'Data karya portofolio tidak lengkap.' });
        return;
      }

      if (session.role === 'guru') {
        const snapshot = await loadDbFromStorage(storage);
        const teacher = snapshot.teachers.find((t) => t.id === session.teacherId);
        for (const proj of validProjects) {
          const targetStudent = snapshot.students.find((s) => s.id === proj.studentId);
          if (!isTeacherAuthorizedForStudent(teacher, targetStudent)) {
            res.status(403).json({
              error: 'Anda tidak memiliki akses mengubah portofolio santri di luar kelas binaan Anda.',
            });
            return;
          }
        }
      }

      const nextDb =
        storage.mode === 'apps_script'
          ? await upsertPortfoliosBatchInAppsScript(storage.apiUrl, storage.secret, validProjects)
          : await upsertPortfoliosBatchInSheet(storage.token, storage.spreadsheetId, validProjects);
      res.json({ data: scopeDatabaseForSession(nextDb, session) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan beberapa karya portofolio.' });
    }
  });

  app.delete('/api/portfolios/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role === 'santri_ortu') {
        res.status(403).json({ error: 'Wali santri tidak dapat menghapus portofolio.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }

      if (session.role === 'guru') {
        const snapshot = await loadDbFromStorage(storage);
        const project = snapshot.portfolios.find((p) => p.id === String(req.params.id));
        const teacher = snapshot.teachers.find((t) => t.id === session.teacherId);
        const targetStudent = snapshot.students.find((s) => s.id === project?.studentId);
        if (!project || !isTeacherAuthorizedForStudent(teacher, targetStudent)) {
          res.status(403).json({ error: 'Tidak berwenang menghapus portofolio ini.' });
          return;
        }
      }

      const nextDb =
        storage.mode === 'apps_script'
          ? await deletePortfolioInAppsScript(storage.apiUrl, storage.secret, String(req.params.id))
          : await deletePortfolioInSheet(storage.token, storage.spreadsheetId, String(req.params.id));
      res.json({ data: scopeDatabaseForSession(nextDb, session) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menghapus portofolio.' });
    }
  });

  app.post('/api/template/save', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.session!.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat mengubah template & branding.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }
      const { templateConfig } = req.body as { templateConfig?: BrandingTemplateConfig };
      if (!templateConfig) {
        res.status(400).json({ error: 'Konfigurasi template kosong.' });
        return;
      }
      const currentDb = await loadDbFromStorage(storage);
      const rawPerJuz = Number(templateConfig.internLembarPerJuz);
      const existingPerJuz = Number(currentDb.templateConfig?.internLembarPerJuz);
      const mergedTemplate: BrandingTemplateConfig = {
        ...DEFAULT_TEMPLATE_CONFIG,
        ...(currentDb.templateConfig || {}),
        ...templateConfig,
        internTrackerItems: Array.isArray(templateConfig.internTrackerItems)
          ? templateConfig.internTrackerItems
          : currentDb.templateConfig?.internTrackerItems ||
            DEFAULT_TEMPLATE_CONFIG.internTrackerItems,
        internLembarPerJuz:
          Number.isFinite(rawPerJuz) && rawPerJuz >= 1 && rawPerJuz <= 100
            ? Math.round(rawPerJuz)
            : Number.isFinite(existingPerJuz) && existingPerJuz >= 1 && existingPerJuz <= 100
              ? Math.round(existingPerJuz)
              : DEFAULT_TEMPLATE_CONFIG.internLembarPerJuz || 10,
      };
      const nextDb =
        storage.mode === 'apps_script'
          ? await saveTemplateConfigInAppsScript(storage.apiUrl, storage.secret, mergedTemplate)
          : await saveTemplateConfigInSheet(storage.token, storage.spreadsheetId, mergedTemplate);
      res.json({ data: scopeDatabaseForSession(nextDb, req.session!) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan template.' });
    }
  });

  app.post('/api/access/save', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.session!.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat mengelola hak akses pengguna.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }
      const { userAccess } = req.body as { userAccess?: UserAccess[] };
      if (!Array.isArray(userAccess)) {
        res.status(400).json({ error: 'Daftar hak akses tidak valid.' });
        return;
      }
      const nextDb =
        storage.mode === 'apps_script'
          ? await saveUserAccessInAppsScript(storage.apiUrl, storage.secret, userAccess)
          : await saveUserAccessInSheet(storage.token, storage.spreadsheetId, userAccess);
      res.json({ data: scopeDatabaseForSession(nextDb, req.session!) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan hak akses.' });
    }
  });

  app.post('/api/drive/upload', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.session!.role === 'santri_ortu') {
        res.status(403).json({ error: 'Wali santri tidak dapat mengunggah file.' });
        return;
      }
      const token = await resolveSheetsAccessToken(req);
      if (!token) {
        res.status(503).json({ error: 'Token Google Drive tidak tersedia.' });
        return;
      }
      const { dataUrl, fileName } = req.body as { dataUrl?: string; fileName?: string };
      if (!dataUrl) {
        res.status(400).json({ error: 'Data file kosong.' });
        return;
      }
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: 'Format file tidak didukung.' });
        return;
      }
      const mimeType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const uploaded = await uploadBufferToDrive(
        token,
        buffer,
        fileName || `asset_${Date.now()}.png`,
        mimeType
      );
      res.json(uploaded);
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal mengunggah ke Google Drive.' });
    }
  });

  // Safe Image Proxy for PDF export (inlines Google Drive / public HTTPS images without CORS failure)
  app.get('/api/image-proxy', async (req, res) => {
    try {
      const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
      if (!rawUrl) {
        res.status(400).json({ error: 'Parameter url diperlukan.' });
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        res.status(400).json({ error: 'URL tidak valid.' });
        return;
      }
      if (parsed.protocol !== 'https:') {
        res.status(400).json({ error: 'Hanya URL HTTPS yang didukung.' });
        return;
      }
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host.endsWith('.local') ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      ) {
        res.status(403).json({ error: 'Host tidak diizinkan.' });
        return;
      }

      const upstream = await fetch(parsed.toString(), {
        redirect: 'follow',
        headers: { Accept: 'image/*,*/*;q=0.8' },
      });
      if (!upstream.ok) {
        res.status(502).json({ error: `Gagal memuat gambar (${upstream.status}).` });
        return;
      }
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      if (!contentType.toLowerCase().startsWith('image/')) {
        res.status(415).json({ error: 'Tautan tidak mengembalikan file gambar.' });
        return;
      }
      const arrayBuf = await upstream.arrayBuffer();
      if (arrayBuf.byteLength > 8 * 1024 * 1024) {
        res.status(413).json({ error: 'Ukuran gambar melebihi batas 8 MB.' });
        return;
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(Buffer.from(arrayBuf));
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal memuat proxy gambar.' });
    }
  });

  // 12. Standalone Public Portfolio Link (NO PINs, NO grades, NO other students)
  app.get('/api/public/portfolio', async (req, res) => {
    try {
      const slug = typeof req.query.slug === 'string' ? req.query.slug.trim().toLowerCase() : '';
      if (!slug) {
        res.status(400).json({ error: 'Parameter slug portofolio diperlukan.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Database Google Sheets belum tersambung di server.' });
        return;
      }

      const db = await loadDbFromStorage(storage);
      const student = db.students.find(
        (s) =>
          s.portfolioSlug.trim().toLowerCase() === slug ||
          s.id.trim().toLowerCase() === slug ||
          s.nisnMda.trim().toLowerCase() === slug
      );
      if (!student) {
        res.status(404).json({ error: 'Portofolio santri tidak ditemukan.' });
        return;
      }

      res.json({
        student: {
          id: student.id,
          nama: student.nama,
          nisnMda: student.nisnMda,
          kelas: student.kelas,
          program: student.program,
          waliKelasId: student.waliKelasId,
          waliKelasNama: student.waliKelasNama,
          fotoUrl: student.fotoUrl,
          emailSantriOrtu: '',
          portfolioSlug: student.portfolioSlug,
          behanceUrl: student.behanceUrl || '',
          portfolioPdfUrl: student.portfolioPdfUrl || '',
          portfolioPdfSubject: student.portfolioPdfSubject || '',
          accessPin: '',
          statusAktif: student.statusAktif,
        },
        portfolios: db.portfolios.filter((p) => p.studentId === student.id),
        templateConfig: db.templateConfig || DEFAULT_TEMPLATE_CONFIG,
        spreadsheetId: db.spreadsheetId,
      });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal memuat portofolio.' });
    }
  });

  // 13. CBT Module Endpoints (Admin/Guru Management + Server-Side Graded Student Exam Flow)
  app.post('/api/cbt/settings/rapor-lock', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.session!.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat mengunci atau membuka akses Portal Rapor.' });
        return;
      }
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
        return;
      }
      const { lockRaporDuringExam, lockRaporMessage } = req.body as {
        lockRaporDuringExam?: boolean;
        lockRaporMessage?: string;
      };
      const currentDb = await readDatabaseFromAppsScript(appsScript.url);
      const nextTemplate: BrandingTemplateConfig = {
        ...DEFAULT_TEMPLATE_CONFIG,
        ...(currentDb.templateConfig || {}),
        lockRaporDuringExam: Boolean(lockRaporDuringExam),
        ...(typeof lockRaporMessage === 'string' && lockRaporMessage.trim()
          ? { lockRaporMessage: lockRaporMessage.trim() }
          : {}),
      };
      const nextDb = await saveTemplateConfigInAppsScript(
        appsScript.url,
        appsScript.secret,
        nextTemplate
      );
      res.json({ data: scopeDatabaseForSession(nextDb, req.session!) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan status Mode Pekan Ujian.' });
    }
  });

  app.post('/api/cbt/exams/seed-defaults', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.session!.role === 'santri_ortu') {
        res.status(403).json({ error: 'Akses ditolak.' });
        return;
      }
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
        return;
      }
      const nextDb = await seedDefaultCbtExamsInAppsScript(appsScript.url, appsScript.secret);
      res.json({ data: scopeDatabaseForSession(nextDb, req.session!) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal membuat 7 paket mapel CBT.' });
    }
  });

  app.post('/api/cbt/exams/upsert', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.session!.role === 'santri_ortu') {
        res.status(403).json({ error: 'Akses ditolak.' });
        return;
      }
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
        return;
      }
      const { exam } = req.body as { exam?: CbtExam };
      if (!exam || !exam.id || !exam.title?.trim()) {
        res.status(400).json({ error: 'Data paket ujian tidak lengkap.' });
        return;
      }
      const nextDb = await saveCbtExamInAppsScript(appsScript.url, appsScript.secret, exam);
      res.json({ data: scopeDatabaseForSession(nextDb, req.session!) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan pengaturan paket ujian.' });
    }
  });

  app.delete('/api/cbt/exams/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.session!.role === 'santri_ortu') {
        res.status(403).json({ error: 'Akses ditolak.' });
        return;
      }
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
        return;
      }
      const nextDb = await deleteCbtExamInAppsScript(
        appsScript.url,
        appsScript.secret,
        String(req.params.id)
      );
      res.json({ data: scopeDatabaseForSession(nextDb, req.session!) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menghapus paket ujian.' });
    }
  });

  app.post('/api/cbt/questions/save', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.session!.role === 'santri_ortu') {
        res.status(403).json({ error: 'Akses ditolak.' });
        return;
      }
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
        return;
      }
      const { examId, questions } = req.body as {
        examId?: string;
        questions?: CbtQuestion[];
      };
      if (!examId || !Array.isArray(questions)) {
        res.status(400).json({ error: 'Data bank soal tidak valid.' });
        return;
      }
      const nextDb = await saveCbtQuestionsForExamInAppsScript(
        appsScript.url,
        appsScript.secret,
        examId,
        questions
      );
      res.json({ data: scopeDatabaseForSession(nextDb, req.session!) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan bank soal ke Google Sheets.' });
    }
  });

  app.post(
    '/api/cbt/attempts/proctor-action',
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      try {
        if (req.session!.role === 'santri_ortu') {
          res.status(403).json({ error: 'Hanya Pengawas (Admin/Guru) yang diizinkan.' });
          return;
        }
        const appsScript = resolveAppsScriptConfig();
        if (!appsScript.configured) {
          res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
          return;
        }
        const { action, examId, attemptId } = req.body as {
          action?: 'unlock' | 'reset' | 'sync_rapor' | 'bulk_sync_rapor';
          examId?: string;
          attemptId?: string;
        };
        if (!action || !examId) {
          res.status(400).json({ error: 'Parameter aksi pengawas tidak lengkap.' });
          return;
        }
        const result = await proctorActionInAppsScript(appsScript.url, appsScript.secret, {
          action,
          examId,
          attemptId,
        });
        res.json({
          data: scopeDatabaseForSession(result.db, req.session!),
          syncedCount: result.syncedCount || 0,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Gagal menjalankan aksi pengawas.' });
      }
    }
  );

  // Student CBT Overview (NO answer keys, NO exam tokens, NO rapor grades!)
  app.get('/api/cbt/student/overview', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
        return;
      }
      const db = await readDatabaseFromAppsScript(appsScript.url);
      const studentId = session.studentId || '';
      const student = db.students.find((s) => s.id === studentId);
      const questionCountByExam: Record<string, number> = {};
      for (const q of db.cbtQuestions || []) {
        questionCountByExam[q.examId] = (questionCountByExam[q.examId] || 0) + 1;
      }
      const exams = (db.cbtExams || []).map((e) => ({
        ...sanitizeExamForStudent(e),
        questionCount: questionCountByExam[e.id] || 0,
      }));
      const attempts = (db.cbtAttempts || [])
        .filter((a) => a.studentId === studentId)
        .map((a) => {
          const exam = (db.cbtExams || []).find((e) => e.id === a.examId);
          return sanitizeAttemptForStudent(a, exam);
        });
      res.json({
        student: student ? { ...student, accessPin: '' } : null,
        exams,
        attempts,
        serverNow: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal memuat daftar ujian CBT.' });
    }
  });

  // Start / Resume CBT Exam (verifies token on start, never returns kunciJawaban!)
  app.post('/api/cbt/student/start', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
        return;
      }
      const { examId, token } = req.body as { examId?: string; token?: string };
      if (!examId) {
        res.status(400).json({ error: 'ID Paket Ujian diperlukan.' });
        return;
      }
      const db = await readDatabaseFromAppsScript(appsScript.url);
      const exam = (db.cbtExams || []).find((e) => e.id === examId);
      if (!exam) {
        res.status(404).json({ error: 'Paket ujian tidak ditemukan.' });
        return;
      }
      if (exam.status !== 'active') {
        res.status(403).json({
          error:
            exam.status === 'finished'
              ? 'Sesi ujian mata pelajaran ini telah ditutup.'
              : 'Ujian mata pelajaran ini belum dibuka oleh Pengawas (masih Draft).',
        });
        return;
      }
      const examQuestions = (db.cbtQuestions || [])
        .filter((q) => q.examId === exam.id)
        .sort((a, b) => a.orderNumber - b.orderNumber);
      if (examQuestions.length === 0) {
        res.status(400).json({ error: 'Bank soal untuk ujian ini masih kosong.' });
        return;
      }

      const studentId = session.studentId || '';
      const student = db.students.find((s) => s.id === studentId);
      if (!student) {
        res.status(403).json({ error: 'Identitas peserta santri tidak ditemukan.' });
        return;
      }

      const attemptId = `${exam.id}__${student.id}`;
      let attempt = (db.cbtAttempts || []).find((a) => a.id === attemptId);

      if (attempt?.status === 'submitted') {
        res.json({
          alreadySubmitted: true,
          exam: sanitizeExamForStudent(exam),
          attempt: sanitizeAttemptForStudent(attempt, exam),
          questions: [],
          remainingSeconds: 0,
          serverNow: new Date().toISOString(),
        });
        return;
      }

      if (attempt?.status === 'locked') {
        res.status(423).json({
          code: 'ATTEMPT_LOCKED',
          error:
            'Ujian Anda terkunci karena melebihi batas pelanggaran Web Lockdown. Hubungi Pengawas untuk membuka kunci.',
          attempt: sanitizeAttemptForStudent(attempt, exam),
        });
        return;
      }

      if (!attempt) {
        const cleanToken = (token || '').trim().toUpperCase();
        if (!cleanToken || cleanToken !== exam.token.trim().toUpperCase()) {
          res.status(401).json({ error: 'Token Ujian salah atau tidak sesuai. Minta token aktif dari Pengawas.' });
          return;
        }
        const rawIds = examQuestions.map((q) => q.id);
        const questionOrder = exam.shuffleQuestions ? shuffleIds(rawIds) : rawIds;
        const nowIso = new Date().toISOString();
        attempt = {
          id: attemptId,
          examId: exam.id,
          studentId: student.id,
          studentName: student.nama,
          studentNisn: student.nisnMda,
          studentKelas: student.kelas,
          status: 'in_progress',
          startedAt: nowIso,
          lastSavedAt: nowIso,
          questionOrder,
          answers: {},
          raguIds: [],
          currentQuestionIndex: 0,
          violationCount: 0,
          violations: [],
          totalQuestions: examQuestions.length,
        };
        await upsertCbtAttemptInAppsScript(appsScript.url, appsScript.secret, attempt);
      }

      const endMs =
        new Date(attempt.startedAt).getTime() + Number(exam.durationMinutes || 60) * 60 * 1000;
      const remainingSeconds = Math.max(0, Math.floor((endMs - Date.now()) / 1000));

      // If timer already expired while offline/closed, auto-grade & submit cleanly on server!
      if (remainingSeconds <= 0) {
        const graded = gradeAttemptAgainstQuestions(attempt, examQuestions);
        const finishedAttempt: CbtAttempt = {
          ...attempt,
          ...graded,
          status: 'submitted',
          submittedAt: new Date().toISOString(),
          lastSavedAt: new Date().toISOString(),
        };
        const synced = await syncAttemptAndMaybeRaporInAppsScript(
          appsScript.url,
          appsScript.secret,
          finishedAttempt,
          exam,
          Boolean(exam.autoSyncToRapor)
        );
        res.json({
          alreadySubmitted: true,
          autoTimedOut: true,
          exam: sanitizeExamForStudent(exam),
          attempt: sanitizeAttemptForStudent(synced.attempt, exam),
          questions: [],
          remainingSeconds: 0,
          syncedToRapor: synced.syncedToRapor,
          serverNow: new Date().toISOString(),
        });
        return;
      }

      // Build ordered sanitized questions WITHOUT kunciJawaban
      const questionMap = new Map(examQuestions.map((q) => [q.id, q]));
      const orderedIds =
        attempt.questionOrder && attempt.questionOrder.length > 0
          ? attempt.questionOrder.filter((id) => questionMap.has(id))
          : examQuestions.map((q) => q.id);
      for (const q of examQuestions) {
        if (!orderedIds.includes(q.id)) orderedIds.push(q.id);
      }
      const sanitizedQuestions = orderedIds
        .map((id) => questionMap.get(id)!)
        .map(sanitizeStudentCbtQuestion);

      res.json({
        alreadySubmitted: false,
        exam: sanitizeExamForStudent(exam),
        attempt: sanitizeAttemptForStudent(attempt, exam),
        questions: sanitizedQuestions,
        remainingSeconds,
        serverNow: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Gagal memulai sesi ujian CBT.' });
    }
  });

  // Auto-save answers, ragu status, and Web Lockdown violations via upsertCbtAttempt
  app.post('/api/cbt/student/save', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
        return;
      }
      const {
        attemptId,
        answers,
        raguIds,
        currentQuestionIndex,
        newViolations,
      } = req.body as {
        attemptId?: string;
        answers?: Record<string, CbtOptionKey>;
        raguIds?: string[];
        currentQuestionIndex?: number;
        newViolations?: CbtViolationLog[];
      };

      if (!attemptId) {
        res.status(400).json({ error: 'ID Attempt diperlukan.' });
        return;
      }

      const db = await readDatabaseFromAppsScript(appsScript.url);
      const existing = (db.cbtAttempts || []).find((a) => a.id === attemptId);
      if (!existing) {
        res.status(404).json({ error: 'Sesi pengerjaan ujian tidak ditemukan.' });
        return;
      }
      if (session.role === 'santri_ortu' && existing.studentId !== session.studentId) {
        res.status(403).json({ error: 'Tidak berhak mengubah sesi ujian peserta lain.' });
        return;
      }
      const exam = (db.cbtExams || []).find((e) => e.id === existing.examId);
      if (!exam) {
        res.status(404).json({ error: 'Paket ujian tidak ditemukan.' });
        return;
      }
      if (existing.status === 'submitted') {
        res.json({
          attempt: sanitizeAttemptForStudent(existing, exam),
          locked: false,
          submitted: true,
        });
        return;
      }
      if (existing.status === 'locked') {
        res.status(423).json({
          code: 'ATTEMPT_LOCKED',
          error: 'Ujian Anda sedang terkunci oleh sistem pengawasan.',
          attempt: sanitizeAttemptForStudent(existing, exam),
        });
        return;
      }

      const incomingViolations = Array.isArray(newViolations) ? newViolations : [];
      const mergedViolations = [...(existing.violations || []), ...incomingViolations].slice(-50);
      const nextViolationCount = (existing.violationCount || 0) + incomingViolations.length;
      const maxViolations = Math.max(1, Number(exam.maxViolations || 3));
      const shouldLock = nextViolationCount >= maxViolations;

      const updated: CbtAttempt = {
        ...existing,
        answers: answers && typeof answers === 'object' ? answers : existing.answers,
        raguIds: Array.isArray(raguIds) ? raguIds : existing.raguIds,
        currentQuestionIndex:
          typeof currentQuestionIndex === 'number'
            ? currentQuestionIndex
            : existing.currentQuestionIndex,
        violationCount: nextViolationCount,
        violations: mergedViolations,
        status: shouldLock ? 'locked' : 'in_progress',
        lastSavedAt: new Date().toISOString(),
      };

      await upsertCbtAttemptInAppsScript(appsScript.url, appsScript.secret, updated);

      const endMs =
        new Date(updated.startedAt).getTime() + Number(exam.durationMinutes || 60) * 60 * 1000;
      const remainingSeconds = Math.max(0, Math.floor((endMs - Date.now()) / 1000));

      res.json({
        attempt: sanitizeAttemptForStudent(updated, exam),
        locked: shouldLock,
        remainingSeconds,
        serverNow: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan progres ujian.' });
    }
  });

  // Final Submit & 100% Server-Side Grading + Auto-Sync to Rapor
  app.post('/api/cbt/student/submit', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
        return;
      }
      const { attemptId, answers, raguIds } = req.body as {
        attemptId?: string;
        answers?: Record<string, CbtOptionKey>;
        raguIds?: string[];
      };
      if (!attemptId) {
        res.status(400).json({ error: 'ID Attempt diperlukan.' });
        return;
      }

      const db = await readDatabaseFromAppsScript(appsScript.url);
      const existing = (db.cbtAttempts || []).find((a) => a.id === attemptId);
      if (!existing) {
        res.status(404).json({ error: 'Sesi pengerjaan ujian tidak ditemukan.' });
        return;
      }
      if (session.role === 'santri_ortu' && existing.studentId !== session.studentId) {
        res.status(403).json({ error: 'Tidak berhak mengumpulkan ujian peserta lain.' });
        return;
      }
      const exam = (db.cbtExams || []).find((e) => e.id === existing.examId);
      if (!exam) {
        res.status(404).json({ error: 'Paket ujian tidak ditemukan.' });
        return;
      }

      if (existing.status === 'submitted') {
        res.json({
          attempt: sanitizeAttemptForStudent(existing, exam),
          showScoreAfterFinish: exam.showScoreAfterFinish,
          syncedToRapor: Boolean(existing.syncedToRaporAt),
        });
        return;
      }

      const examQuestions = (db.cbtQuestions || []).filter((q) => q.examId === exam.id);
      const finalAnswers = answers && typeof answers === 'object' ? answers : existing.answers;
      const mergedAttempt: CbtAttempt = {
        ...existing,
        answers: finalAnswers,
        raguIds: Array.isArray(raguIds) ? raguIds : existing.raguIds,
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
      };
      const graded = gradeAttemptAgainstQuestions(mergedAttempt, examQuestions);
      const scoredAttempt: CbtAttempt = {
        ...mergedAttempt,
        ...graded,
      };

      const synced = await syncAttemptAndMaybeRaporInAppsScript(
        appsScript.url,
        appsScript.secret,
        scoredAttempt,
        exam,
        Boolean(exam.autoSyncToRapor)
      );

      res.json({
        attempt: sanitizeAttemptForStudent(synced.attempt, exam),
        showScoreAfterFinish: exam.showScoreAfterFinish,
        syncedToRapor: synced.syncedToRapor,
      });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal mengumpulkan jawaban ujian.' });
    }
  });

  // 14. Internship & Ibadah Tracker Module Endpoints
  app.post('/api/internship/profile/upsert', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.portalMode === 'cbt') {
        res.status(403).json({ error: 'Jalur CBT Lockdown tidak dapat mengubah data magang.' });
        return;
      }
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
        return;
      }
      const { profile } = req.body as { profile?: Partial<InternProfile> };
      const studentId = String(profile?.studentId || '').trim();
      if (!profile || !studentId) {
        res.status(400).json({ error: 'ID Santri pada profil magang tidak boleh kosong.' });
        return;
      }

      if (session.role === 'santri_ortu') {
        if (!session.studentId || session.studentId !== studentId) {
          res.status(403).json({ error: 'Anda hanya dapat memperbarui profil magang milik Anda sendiri.' });
          return;
        }
      }

      const db = await readDatabaseFromAppsScript(appsScript.url);
      const targetStudent = db.students.find((s) => s.id === studentId);
      if (!targetStudent) {
        res.status(404).json({ error: 'Data santri tidak ditemukan.' });
        return;
      }

      if (session.role === 'guru') {
        const teacher = db.teachers.find((t) => t.id === session.teacherId);
        if (!isTeacherAuthorizedForStudent(teacher, targetStudent)) {
          res.status(403).json({ error: 'Anda tidak memiliki akses ke kelas santri ini.' });
          return;
        }
      }

      const incomeRaw = Number(profile.incomeMagangRp || 0);
      const rawMulai = String(profile.mulaiTanggal || '').trim();
      const rawSelesai = String(profile.selesaiTanggal || '').trim();
      const mulaiTanggal = /^\d{4}-\d{2}-\d{2}$/.test(rawMulai) ? rawMulai : '';
      const selesaiTanggal = /^\d{4}-\d{2}-\d{2}$/.test(rawSelesai) ? rawSelesai : '';
      const jamKerjaHarian = String(profile.jamKerjaHarian || '').trim().slice(0, 120);
      const sanitizedProfile: InternProfile = {
        id: studentId,
        studentId,
        tempatMagang: String(profile.tempatMagang || '').trim().slice(0, 300),
        waktuMagang: String(profile.waktuMagang || '').trim().slice(0, 200),
        mulaiTanggal,
        selesaiTanggal,
        jamKerjaHarian,
        kompetensiMagang: String(profile.kompetensiMagang || '').trim().slice(0, 500),
        incomeMagangRp: Number.isFinite(incomeRaw) && incomeRaw >= 0 ? Math.round(incomeRaw) : 0,
        pembimbingNama: String(profile.pembimbingNama || '').trim().slice(0, 150),
        updatedAt: new Date().toISOString(),
      };

      const saved = await upsertInternProfileInAppsScript(
        appsScript.url,
        appsScript.secret,
        sanitizedProfile
      );

      res.json({
        profile: saved.profile,
        data: scopeDatabaseForSession(saved.db, session),
      });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan profil magang.' });
    }
  });

  app.post('/api/internship/daily-log/upsert', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.portalMode === 'cbt') {
        res.status(403).json({ error: 'Jalur CBT Lockdown tidak dapat mengisi jurnal magang.' });
        return;
      }
      const appsScript = resolveAppsScriptConfig();
      if (!appsScript.configured) {
        res.status(503).json({ error: 'Google Apps Script belum terhubung.' });
        return;
      }

      const { log } = req.body as { log?: Partial<InternDailyLog> };
      const studentId = String(log?.studentId || '').trim();
      const tanggal = String(log?.tanggal || '').trim();
      if (!log || !studentId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
        res.status(400).json({ error: 'Format ID santri atau tanggal jurnal (YYYY-MM-DD) tidak valid.' });
        return;
      }

      if (session.role === 'santri_ortu') {
        if (!session.studentId || session.studentId !== studentId) {
          res.status(403).json({ error: 'Akses ditolak: santri hanya dapat mengisi jurnal miliknya sendiri.' });
          return;
        }
      }

      const db = await readDatabaseFromAppsScript(appsScript.url);
      const targetStudent = db.students.find((s) => s.id === studentId);
      if (!targetStudent) {
        res.status(404).json({ error: 'Data santri tidak ditemukan.' });
        return;
      }

      if (session.role === 'guru') {
        const teacher = db.teachers.find((t) => t.id === session.teacherId);
        if (!isTeacherAuthorizedForStudent(teacher, targetStudent)) {
          res.status(403).json({ error: 'Anda tidak memiliki akses ke kelas santri ini.' });
          return;
        }
      }

      const rawResults =
        log.trackerResults && typeof log.trackerResults === 'object' ? log.trackerResults : {};
      const cleanResults: Record<string, 'yes' | 'no'> = {};
      for (const [k, v] of Object.entries(rawResults)) {
        const cleanKey = String(k || '').trim().slice(0, 80);
        if (!cleanKey) continue;
        if (v === 'yes' || v === 'no') {
          cleanResults[cleanKey] = v;
        }
      }

      const blocks = log.hourlyBlocks || ({} as InternDailyLog['hourlyBlocks']);
      const existing = (db.internDailyLogs || []).find(
        (l) => l.id === `${studentId}_${tanggal}` || (l.studentId === studentId && l.tanggal === tanggal)
      );

      const rawLembar = Number(log.tilawahLembar);
      const tilawahLembar =
        Number.isFinite(rawLembar) && rawLembar >= 0
          ? Math.min(1000, Math.round(rawLembar * 10) / 10)
          : 0;

      const sanitizedLog: InternDailyLog = {
        id: `${studentId}_${tanggal}`,
        studentId,
        tanggal,
        trackerResults: cleanResults,
        tilawahLembar,
        hourlyBlocks: {
          block_05_08: String(blocks.block_05_08 || '').trim().slice(0, 2000),
          block_08_12: String(blocks.block_08_12 || '').trim().slice(0, 2000),
          block_13_17: String(blocks.block_13_17 || '').trim().slice(0, 2000),
          block_18_21: String(blocks.block_18_21 || '').trim().slice(0, 2000),
          block_22_03: String(blocks.block_22_03 || '').trim().slice(0, 2000),
        },
        kejadianPenting: String(log.kejadianPenting || '').trim().slice(0, 2000),
        // Santri tidak boleh menimpa catatan pembimbing
        catatanPembimbing:
          session.role === 'santri_ortu'
            ? existing?.catatanPembimbing || ''
            : log.catatanPembimbing !== undefined
              ? String(log.catatanPembimbing || '').trim().slice(0, 1000)
              : existing?.catatanPembimbing || '',
        updatedAt: new Date().toISOString(),
      };

      const saved = await upsertInternDailyLogInAppsScript(
        appsScript.url,
        appsScript.secret,
        sanitizedLog
      );

      res.json({
        log: saved.log,
        data: scopeDatabaseForSession(saved.db, session),
      });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan jurnal harian magang.' });
    }
  });

  app.post('/api/internship/tracker-config/save', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const session = req.session!;
      if (session.role !== 'admin') {
        res.status(403).json({ error: 'Hanya Admin yang dapat mengubah daftar item tracker ibadah & amal.' });
        return;
      }
      const storage = await resolveBackendStorage(req);
      if (storage.mode === 'none') {
        res.status(503).json({ error: 'Google Sheets belum terhubung.' });
        return;
      }

      const { internTrackerItems, internLembarPerJuz } = req.body as {
        internTrackerItems?: InternTrackerItem[];
        internLembarPerJuz?: number;
      };
      if (!Array.isArray(internTrackerItems)) {
        res.status(400).json({ error: 'Daftar item tracker tidak valid.' });
        return;
      }

      const cleanItems: InternTrackerItem[] = internTrackerItems
        .map((item, idx) => {
          const group = (['sholat', 'tilawah', 'kebersihan', 'lainnya'].includes(String(item?.group))
            ? item.group
            : 'lainnya') as InternTrackerItem['group'];
          const mode = (item?.mode === 'jamaah' ? 'jamaah' : 'terlaksana') as InternTrackerItem['mode'];
          const rawId = String(item?.id || `item-${idx + 1}`).trim().slice(0, 64);
          const rawLabel = String(item?.label || '').trim().slice(0, 140);
          return {
            id: rawId || `item-${idx + 1}`,
            label: rawLabel,
            group,
            mode,
            active: item?.active !== false,
          };
        })
        .filter((item) => item.label.length > 0);

      const currentDb = await loadDbFromStorage(storage);
      const rawPerJuz = Number(internLembarPerJuz);
      const existingPerJuz = Number(currentDb.templateConfig?.internLembarPerJuz);
      const cleanLembarPerJuz =
        Number.isFinite(rawPerJuz) && rawPerJuz >= 1 && rawPerJuz <= 100
          ? Math.round(rawPerJuz)
          : Number.isFinite(existingPerJuz) && existingPerJuz >= 1 && existingPerJuz <= 100
            ? Math.round(existingPerJuz)
            : 10;

      const nextTemplate: BrandingTemplateConfig = {
        ...DEFAULT_TEMPLATE_CONFIG,
        ...(currentDb.templateConfig || {}),
        internTrackerItems: cleanItems,
        internLembarPerJuz: cleanLembarPerJuz,
      };

      const nextDb =
        storage.mode === 'apps_script'
          ? await saveTemplateConfigInAppsScript(storage.apiUrl, storage.secret, nextTemplate)
          : await saveTemplateConfigInSheet(storage.token, storage.spreadsheetId, nextTemplate);

      res.json({ data: scopeDatabaseForSession(nextDb, session) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan pengaturan item tracker.' });
    }
  });

  return app;
}

export const app = createApiApp();
export default app;
