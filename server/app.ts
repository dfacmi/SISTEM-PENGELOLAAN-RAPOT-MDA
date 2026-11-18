import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  ConflictError,
  DEFAULT_TEMPLATE_CONFIG,
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
  upsertReportInSheet,
  upsertStudentInSheet,
  upsertTeacherInSheet,
} from './googleSheetsService.ts';
import {
  DEFAULT_APPS_SCRIPT_SECRET,
  DEFAULT_APPS_SCRIPT_URL,
  deletePortfolioInAppsScript,
  deleteStudentInAppsScript,
  deleteTeacherInAppsScript,
  isValidAppsScriptUrl,
  mergeLocalSnapshotIntoAppsScript,
  readDatabaseFromAppsScript,
  saveAllToAppsScript,
  saveTemplateConfigInAppsScript,
  saveUserAccessInAppsScript,
  upsertPeriodInAppsScript,
  upsertPortfolioInAppsScript,
  upsertReportInAppsScript,
  upsertStudentInAppsScript,
  upsertTeacherInAppsScript,
} from './appsScriptService.ts';
import type {
  AcademicPeriod,
  BrandingTemplateConfig,
  MdaDatabase,
  PortfolioProject,
  SemesterReport,
  Student,
  TeacherClass,
  UserAccess,
  UserRole,
} from '../src/types/mda.ts';

export interface SessionPayload {
  role: UserRole;
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
      templateConfig: db.templateConfig,
      spreadsheetId: db.spreadsheetId,
      spreadsheetUrl: db.spreadsheetUrl,
      spreadsheetTitle: db.spreadsheetTitle,
      lastSyncedAt: db.lastSyncedAt,
    };
  }

  // Strictly scoped parent/student view — ONLY 1 child, NO other students, NO PINs
  const myStudent = db.students.find((s) => s.id === session.studentId);
  const myId = myStudent?.id || '__none__';

  return {
    periods: db.periods,
    teachers: db.teachers.map((t) => ({
      id: t.id,
      nama: t.nama,
      jabatan: t.jabatan,
      email: '',
      kelasDiampu: t.kelasDiampu,
      role: t.role,
      ttdUrl: t.ttdUrl || '',
    })),
    students: myStudent ? [{ ...myStudent, accessPin: '' }] : [],
    reports: db.reports.filter((r) => r.studentId === myId),
    portfolios: db.portfolios.filter((p) => p.studentId === myId),
    userAccess: [],
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

  // 3. Parent/Student PIN Login (verified strictly on backend against students & userAccess!)
  app.post('/api/auth/login-parent', async (req, res) => {
    try {
      const { identifier, pin } = req.body as { identifier?: string; pin?: string };
      const q = (identifier || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const rawPin = (pin || '').trim();
      const normalizedPin = rawPin.toUpperCase();
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

      // A. Match direct Student record (NISN MDA, Nama Lengkap, ID, or Email Wali)
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
        // Also allow any active userAccess entry linked to this student with a matching custom PIN
        return db.userAccess.some(
          (u) =>
            u.statusAktif !== false &&
            u.role === 'santri_ortu' &&
            u.linkedStudentId === s.id &&
            Boolean(u.accessPin?.trim()) &&
            u.accessPin!.trim().toUpperCase() === normalizedPin
        );
      });

      // B. Match active UserAccess record for Orang Tua / Santri
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

  // 6. Authenticated Read (always reads fresh from Google Sheets / Apps Script & scopes strictly by role)
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
        };
        const result =
          storage.mode === 'apps_script'
            ? await upsertStudentInAppsScript(storage.apiUrl, storage.secret, safeStudent)
            : await upsertStudentInSheet(storage.token, storage.spreadsheetId, safeStudent);
        res.json({ data: scopeDatabaseForSession(result.db, session) });
        return;
      }

      const result =
        storage.mode === 'apps_script'
          ? await upsertStudentInAppsScript(storage.apiUrl, storage.secret, student)
          : await upsertStudentInSheet(storage.token, storage.spreadsheetId, student);
      res.json({ data: scopeDatabaseForSession(result.db, session) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Gagal menyimpan data santri ke Google Sheets.' });
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
      const nextDb =
        storage.mode === 'apps_script'
          ? await saveTemplateConfigInAppsScript(storage.apiUrl, storage.secret, templateConfig)
          : await saveTemplateConfigInSheet(storage.token, storage.spreadsheetId, templateConfig);
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

  return app;
}

export const app = createApiApp();
export default app;
