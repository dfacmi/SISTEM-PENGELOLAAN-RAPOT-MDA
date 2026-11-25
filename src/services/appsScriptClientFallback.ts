import {
  createDefaultCbtExams,
  DEFAULT_CHARACTER_PROGRAMS,
  DEFAULT_DIGITAL_SKILLS,
  DEFAULT_DINIYAH_MAPEL,
  DEFAULT_SIKAP_ASPEK,
  DEFAULT_TEMPLATE_CONFIG,
} from '../data/seedData';
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
} from '../types/mda';
import { generateSmartAccessPin, recalculateReport } from '../utils/grading';
import { safeLocalStorage, safeSessionStorage } from '../utils/safeStorage';

export const CLIENT_DEFAULT_APPS_SCRIPT_URL =
  import.meta.env.VITE_APPS_SCRIPT_URL?.trim() ||
  'https://script.google.com/macros/s/AKfycbyRsDtSpBMgDCekHjJvjlfrLNnUCiDMPDDRaMpwwk89TKahIqOmydYjgmS11pgCeGk7/exec';

const CLIENT_APPS_SCRIPT_SECRET =
  import.meta.env.VITE_APPS_SCRIPT_SECRET?.trim() || 'MDA-SECRET-2026';

const CUSTOM_APPS_SCRIPT_URL_KEY = 'mda_fallback_apps_script_url_v1';
const DIRECT_SESSION_USER_KEY = 'mda_direct_fallback_session_v1';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export interface DirectFallbackSessionUser {
  role: UserRole;
  portalMode?: 'rapor' | 'cbt';
  userId: string;
  teacherId?: string;
  studentId?: string;
  kelasDiampu?: string;
  email?: string;
  name: string;
  exp: number;
}

export function getDirectAppsScriptUrl(): string {
  const stored = safeLocalStorage.getItem(CUSTOM_APPS_SCRIPT_URL_KEY);
  return (stored || CLIENT_DEFAULT_APPS_SCRIPT_URL).trim();
}

export function setDirectAppsScriptUrl(url: string) {
  if (url.trim()) {
    safeLocalStorage.setItem(CUSTOM_APPS_SCRIPT_URL_KEY, url.trim());
  }
}

export function storeDirectSessionUser(user: DirectFallbackSessionUser | null) {
  if (user) {
    safeSessionStorage.setItem(DIRECT_SESSION_USER_KEY, JSON.stringify(user));
  } else {
    safeSessionStorage.removeItem(DIRECT_SESSION_USER_KEY);
  }
}

export function getStoredDirectSessionUser(token?: string | null): DirectFallbackSessionUser | null {
  try {
    const raw = safeSessionStorage.getItem(DIRECT_SESSION_USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DirectFallbackSessionUser;
      if (parsed && parsed.role && (!parsed.exp || Date.now() <= parsed.exp)) {
        return parsed;
      }
    }
  } catch {
    // ignore corrupt fallback session
  }
  if (token && token.startsWith('direct-v1.')) {
    try {
      const encoded = token.slice('direct-v1.'.length);
      const parsed = JSON.parse(decodeURIComponent(escape(atob(encoded)))) as DirectFallbackSessionUser;
      if (parsed && parsed.role && (!parsed.exp || Date.now() <= parsed.exp)) {
        return parsed;
      }
    } catch {
      // ignore invalid token
    }
  }
  return null;
}

function makeDirectSessionToken(user: DirectFallbackSessionUser): string {
  storeDirectSessionUser(user);
  try {
    return `direct-v1.${btoa(unescape(encodeURIComponent(JSON.stringify(user))))}`;
  } catch {
    return `direct-v1.${Date.now()}`;
  }
}

function parseAppsScriptJsonResponse(rawText: string, httpStatus: number): any {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    if (httpStatus >= 200 && httpStatus < 300) return { status: 'success' };
    throw new Error(`Google Apps Script mengembalikan respons kosong (HTTP ${httpStatus}).`);
  }
  if (trimmed.startsWith('<')) {
    throw new Error(
      'Google Apps Script mengembalikan HTML (bukan JSON). Pastikan Web App di-deploy dengan akses "Anyone".'
    );
  }
  return JSON.parse(trimmed);
}

function normalizeDbPayload(rawData: any, apiUrl: string, updatedAt?: string): MdaDatabase {
  const d = rawData && typeof rawData === 'object' ? rawData : {};
  const tpl: BrandingTemplateConfig =
    d.templateConfig && typeof d.templateConfig === 'object'
      ? {
          ...DEFAULT_TEMPLATE_CONFIG,
          ...d.templateConfig,
          internTrackerItems: Array.isArray(d.templateConfig.internTrackerItems)
            ? d.templateConfig.internTrackerItems
            : DEFAULT_TEMPLATE_CONFIG.internTrackerItems,
        }
      : { ...DEFAULT_TEMPLATE_CONFIG };

  return {
    periods: Array.isArray(d.periods) ? d.periods : [],
    teachers: Array.isArray(d.teachers) ? d.teachers : [],
    students: Array.isArray(d.students) ? d.students : [],
    reports: Array.isArray(d.reports) ? d.reports : [],
    portfolios: Array.isArray(d.portfolios) ? d.portfolios : [],
    userAccess: Array.isArray(d.userAccess) ? d.userAccess : [],
    cbtExams: Array.isArray(d.cbtExams) ? d.cbtExams : [],
    cbtQuestions: Array.isArray(d.cbtQuestions) ? d.cbtQuestions : [],
    cbtAttempts: Array.isArray(d.cbtAttempts) ? d.cbtAttempts : [],
    internProfiles: Array.isArray(d.internProfiles) ? d.internProfiles : [],
    internDailyLogs: Array.isArray(d.internDailyLogs) ? d.internDailyLogs : [],
    templateConfig: tpl,
    spreadsheetId: apiUrl,
    spreadsheetUrl: apiUrl,
    spreadsheetTitle: 'Google Sheets (Apps Script Direct)',
    lastSyncedAt: updatedAt || new Date().toISOString(),
  };
}

async function readDbDirect(overrideUrl?: string): Promise<MdaDatabase> {
  const targetUrl = (overrideUrl || getDirectAppsScriptUrl()).trim();
  const sep = targetUrl.includes('?') ? '&' : '?';
  const res = await fetch(`${targetUrl}${sep}_t=${Date.now()}`, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
  });
  const text = await res.text();
  const parsed = parseAppsScriptJsonResponse(text, res.status);
  if (!res.ok || parsed?.status === 'error') {
    throw new Error(parsed?.message || parsed?.error || `HTTP ${res.status}`);
  }
  const dataNode = parsed?.data !== undefined ? parsed.data : parsed;
  return normalizeDbPayload(dataNode, targetUrl, parsed?.updatedAt);
}

async function postAppsScriptDirect(
  bodyPayload: Record<string, unknown>,
  overrideUrl?: string
): Promise<{ updatedAt: string; parsed: any }> {
  const targetUrl = (overrideUrl || getDirectAppsScriptUrl()).trim();
  const res = await fetch(targetUrl, {
    method: 'POST',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      secret: CLIENT_APPS_SCRIPT_SECRET,
      ...bodyPayload,
    }),
  });
  const text = await res.text();
  const parsed = parseAppsScriptJsonResponse(text, res.status);
  if (!res.ok || parsed?.status === 'error') {
    throw new Error(parsed?.message || parsed?.error || `HTTP ${res.status}`);
  }
  return {
    updatedAt: parsed?.updatedAt || new Date().toISOString(),
    parsed,
  };
}

async function saveSectionDirect(section: string, payload: unknown): Promise<{ updatedAt: string }> {
  const res = await postAppsScriptDirect({
    action: 'saveSection',
    section,
    payload,
  });
  return { updatedAt: res.updatedAt };
}

async function saveAllDirect(db: MdaDatabase): Promise<{ updatedAt: string }> {
  const res = await postAppsScriptDirect({
    action: 'saveAll',
    payload: {
      periods: db.periods,
      teachers: db.teachers,
      students: db.students,
      reports: db.reports,
      portfolios: db.portfolios,
      userAccess: db.userAccess,
      cbtExams: db.cbtExams || [],
      cbtQuestions: db.cbtQuestions || [],
      cbtAttempts: db.cbtAttempts || [],
      internProfiles: db.internProfiles || [],
      internDailyLogs: db.internDailyLogs || [],
      templateConfig: db.templateConfig,
    },
  });
  return { updatedAt: res.updatedAt };
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
  return diampu
    .split(/[,;/|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .some((tok) => studentClass === tok || studentClass.includes(tok) || tok.includes(studentClass));
}

function sanitizeExamForStudent(exam: CbtExam): CbtExam {
  return { ...exam, token: '' };
}

function sanitizeAttemptForStudent(attempt: CbtAttempt, exam?: CbtExam): CbtAttempt {
  if (exam && exam.showScoreAfterFinish === false && attempt.status === 'submitted') {
    const { score: _s, benarCount: _b, salahCount: _w, ...rest } = attempt;
    return rest;
  }
  return attempt;
}

function sanitizeQuestionForStudent(q: CbtQuestion): StudentCbtQuestion {
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

function scopeDbForUser(db: MdaDatabase, session: DirectFallbackSessionUser): MdaDatabase {
  if (session.role === 'admin') return db;

  if (session.role === 'guru') {
    const teacher = db.teachers.find((t) => t.id === session.teacherId);
    const allowedStudents = db.students.filter((s) => isTeacherAuthorizedForStudent(teacher, s));
    const allowedIds = new Set(allowedStudents.map((s) => s.id));
    return {
      ...db,
      teachers: db.teachers.map((t) => ({
        ...t,
        email: t.id === teacher?.id ? t.email : '',
      })),
      students: allowedStudents.map((s) => ({ ...s, accessPin: '' })),
      reports: db.reports.filter((r) => allowedIds.has(r.studentId)),
      portfolios: db.portfolios.filter((p) => allowedIds.has(p.studentId)),
      userAccess: [],
      cbtAttempts: (db.cbtAttempts || []).filter((a) => allowedIds.has(a.studentId)),
      internProfiles: (db.internProfiles || []).filter((p) => allowedIds.has(p.studentId)),
      internDailyLogs: (db.internDailyLogs || []).filter((l) => allowedIds.has(l.studentId)),
    };
  }

  const myStudent = db.students.find((s) => s.id === session.studentId);
  const myId = myStudent?.id || '__none__';
  const isCbtPortal = session.portalMode === 'cbt';
  const isRaporLocked = !isCbtPortal && Boolean(db.templateConfig?.lockRaporDuringExam);
  const examsById = new Map((db.cbtExams || []).map((e) => [e.id, e]));

  return {
    periods: isCbtPortal ? [] : db.periods,
    teachers: isCbtPortal
      ? []
      : db.teachers.map((t) => ({ ...t, email: '' })),
    students: myStudent ? [{ ...myStudent, accessPin: '' }] : [],
    reports: isCbtPortal || isRaporLocked ? [] : db.reports.filter((r) => r.studentId === myId),
    portfolios:
      isCbtPortal || isRaporLocked ? [] : db.portfolios.filter((p) => p.studentId === myId),
    userAccess: [],
    cbtExams: isCbtPortal ? (db.cbtExams || []).map(sanitizeExamForStudent) : [],
    cbtQuestions: [],
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

function gradeAttemptDirect(attempt: CbtAttempt, examQuestions: CbtQuestion[]) {
  const totalQuestions = examQuestions.length;
  if (totalQuestions === 0) {
    return { benarCount: 0, salahCount: 0, totalQuestions: 0, score: 0 };
  }
  let benarCount = 0;
  for (const q of examQuestions) {
    const ans = (attempt.answers?.[q.id] || '').toString().trim().toUpperCase();
    const key = (q.kunciJawaban || '').toString().trim().toUpperCase();
    if (ans && key && ans === key) benarCount += 1;
  }
  return {
    benarCount,
    salahCount: Math.max(0, totalQuestions - benarCount),
    totalQuestions,
    score: Math.round((benarCount / totalQuestions) * 100),
  };
}

function applyCbtScoreDirect(
  db: MdaDatabase,
  exam: CbtExam,
  studentId: string,
  score: number
): { reports: SemesterReport[]; updatedReport: SemesterReport | null } {
  const mapping = exam.targetRaporMapping;
  if (!mapping || mapping.category === 'none' || !mapping.subjectName?.trim()) {
    return { reports: db.reports, updatedReport: null };
  }
  const activePeriod = db.periods.find((p) => p.isActive) || db.periods[db.periods.length - 1];
  const tahunAkademik = exam.tahunAkademik || activePeriod?.tahunAkademik || '2026/2027';
  const semester = exam.semester || activePeriod?.semester || 'Gasal';
  const periodConfig =
    db.periods.find((p) => p.tahunAkademik === tahunAkademik && p.semester === semester) ||
    activePeriod;

  const existing = db.reports.find(
    (r) => r.studentId === studentId && r.tahunAkademik === tahunAkademik && r.semester === semester
  );

  const baseline: SemesterReport = existing
    ? {
        ...existing,
        diniyah: existing.diniyah.map((d) => ({ ...d })),
        skillDigital: existing.skillDigital.map((s) => ({ ...s })),
        tahfidz: { ...existing.tahfidz },
        pilar: { ...existing.pilar },
      }
    : {
        id: `rep-${studentId}-${tahunAkademik}-${semester}`.replace(/\//g, '-'),
        studentId,
        tahunAkademik,
        semester,
        tanggalRapor: periodConfig?.tanggalRapor || '19 Desember 2026',
        pilar: {
          penguasaanMultimedia: 75,
          diniyahPembelajaran: 75,
          tahfidzulQuran: 75,
          kesantrianKeasramaan: 75,
          characterBuilding: 75,
          autoCalculate: true,
        },
        kpiMda: {
          characterBuildingCount: 0,
          multimediaProjectCount: 0,
          clientProjectCount: 0,
          mdaMengajarCount: 0,
          incomeRp: 0,
          produksiKontenCount: 0,
        },
        sikap: DEFAULT_SIKAP_ASPEK.map((aspek) => ({ aspek, predikat: 'B', deskripsi: '' })),
        characterPrograms: DEFAULT_CHARACTER_PROGRAMS.map((kegiatan) => ({
          kegiatan,
          keterangan: '',
        })),
        tahfidz: {
          totalHafalan: '',
          capaianSemesterIni: '',
          totalJuziyah: '',
          totalSetoranZiyadah: '',
          totalMurojaah: '',
          kelancaran: 80,
          tajwid: 80,
          makhrajFashahah: 80,
          ketepatanAyat: 80,
          nilaiAkhir: 80,
          predikat: 'B',
          deskripsi: '',
        },
        diniyah: DEFAULT_DINIYAH_MAPEL.map((m) => ({
          ...m,
          kkm: periodConfig?.kkmDiniyah || 60,
          nilai: 0,
          predikat: 'D',
          deskripsi: '',
        })),
        skillDigital: DEFAULT_DIGITAL_SKILLS.map((s) => ({
          ...s,
          kkm: periodConfig?.kkmDigital || 70,
          pengetahuan: 0,
          keterampilan: 0,
          nilaiAkhir: 0,
          predikat: 'D',
        })),
        kehadiran: { sakit: 0, izin: 0, alpa: 0 },
        catatanWali: {
          pesanSingkat: '',
          perkembangan: '',
          kekuatan: '',
          saranSemesterDepan: '',
        },
        keputusanSemester: 'Lanjut ke semester genap',
        published: false,
        updatedAt: new Date().toISOString(),
      };

  const targetNameNorm = mapping.subjectName.trim().toLowerCase();
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

  if (mapping.category === 'diniyah') {
    const idx = baseline.diniyah.findIndex(
      (d) => d.mataPelajaran.trim().toLowerCase() === targetNameNorm
    );
    if (idx >= 0) {
      baseline.diniyah[idx] = { ...baseline.diniyah[idx], uas: clampedScore, uasFromCbt: true };
    }
  } else if (mapping.category === 'skillDigital') {
    const idx = baseline.skillDigital.findIndex(
      (s) => s.materiSkill.trim().toLowerCase() === targetNameNorm
    );
    if (idx >= 0) {
      baseline.skillDigital[idx] = {
        ...baseline.skillDigital[idx],
        uas: clampedScore,
        uasFromCbt: true,
      };
    }
  } else if (mapping.category === 'tahfidz') {
    if (targetNameNorm.includes('kelancaran')) baseline.tahfidz.kelancaran = clampedScore;
    else if (targetNameNorm.includes('tajwid')) baseline.tahfidz.tajwid = clampedScore;
    else if (targetNameNorm.includes('makhraj')) baseline.tahfidz.makhrajFashahah = clampedScore;
    else if (targetNameNorm.includes('ketepatan')) baseline.tahfidz.ketepatanAyat = clampedScore;
  }

  const recalculated = recalculateReport(
    { ...baseline, updatedAt: new Date().toISOString() },
    undefined,
    {
      kkmDiniyah: periodConfig?.kkmDiniyah || 60,
      kkmTahfidz: periodConfig?.kkmTahfidz || 70,
      kkmDigital: periodConfig?.kkmDigital || 70,
    }
  );
  const exists = db.reports.some((r) => r.id === recalculated.id);
  const nextReports = exists
    ? db.reports.map((r) => (r.id === recalculated.id ? recalculated : r))
    : [...db.reports, recalculated];
  return { reports: nextReports, updatedReport: recalculated };
}

function makeDirectError(message: string, status = 400, extra?: Record<string, unknown>): Error {
  const err = new Error(message) as Error & Record<string, unknown>;
  err.status = status;
  if (extra) Object.assign(err, extra);
  return err;
}

export async function executeDirectAppsScriptFallback<T>(
  rawPath: string,
  method: string,
  body: any,
  sessionToken: string | null
): Promise<T> {
  const urlObj = new URL(rawPath, 'https://fallback.local');
  const pathname = urlObj.pathname;
  const appsScriptUrl = getDirectAppsScriptUrl();

  if (pathname === '/api/health') {
    return {
      ok: true,
      serviceAccountConfigured: false,
      serviceAccountEmail: null,
      spreadsheetConfigured: true,
      spreadsheetId: appsScriptUrl,
      spreadsheetTitle: 'Google Sheets (Apps Script Direct)',
      appsScriptConfigured: true,
      appsScriptUrl,
    } as T;
  }

  if (pathname === '/api/config/public') {
    try {
      const db = await readDbDirect();
      return {
        connected: true,
        spreadsheetId: appsScriptUrl,
        spreadsheetTitle: db.spreadsheetTitle,
        templateConfig: db.templateConfig || DEFAULT_TEMPLATE_CONFIG,
      } as T;
    } catch (err: any) {
      return {
        connected: false,
        spreadsheetId: null,
        error: err.message,
        templateConfig: DEFAULT_TEMPLATE_CONFIG,
      } as T;
    }
  }

  if (pathname === '/api/auth/logout') {
    storeDirectSessionUser(null);
    return { ok: true } as T;
  }

  if (pathname === '/api/auth/login-parent' || pathname === '/api/auth/login-cbt') {
    const identifier = String(body?.identifier || '').trim();
    const pin = String(body?.pin || '').trim();
    if (!identifier || !pin) {
      throw makeDirectError('Masukkan ID/Nama Santri beserta PIN Akses.', 400);
    }
    const db = await readDbDirect();
    const { matchedStudent, matchedAccess } = matchStudentCredential(db, identifier, pin);
    if (!matchedStudent && !matchedAccess) {
      throw makeDirectError('ID/Nama Santri atau PIN Akses tidak sesuai.', 401);
    }
    const isCbt = pathname === '/api/auth/login-cbt';
    const targetStudentId = matchedStudent?.id || matchedAccess?.linkedStudentId || '__none__';
    const session: DirectFallbackSessionUser = {
      role: 'santri_ortu',
      portalMode: isCbt ? 'cbt' : 'rapor',
      userId: matchedStudent
        ? `${isCbt ? 'cbt' : 'parent'}:${matchedStudent.id}`
        : `access:${matchedAccess!.id}`,
      studentId: targetStudentId,
      email: matchedAccess?.email || matchedStudent?.emailSantriOrtu || undefined,
      name: isCbt
        ? matchedStudent?.nama || matchedAccess?.nama || 'Peserta CBT'
        : matchedStudent
          ? `Wali ${matchedStudent.nama}`
          : matchedAccess?.nama || 'Wali Santri',
      exp: Date.now() + SESSION_TTL_MS,
    };
    const token = makeDirectSessionToken(session);
    return { sessionToken: token, user: session, data: scopeDbForUser(db, session) } as T;
  }

  if (pathname === '/api/auth/login-staff-pin') {
    const identifier = String(body?.identifier || '').trim();
    const rawPin = String(body?.pin || '').trim();
    const q = identifier.replace(/\s+/g, ' ').toLowerCase();
    const normPin = rawPin.toUpperCase();
    if (!q || !normPin) {
      throw makeDirectError('Masukkan Nama/ID/Email Guru beserta PIN Akses.', 400);
    }

    if (q === 'admin' && (rawPin === 'mda2026admin' || normPin === 'MDA2026ADMIN')) {
      let db: MdaDatabase = {
        periods: [],
        teachers: [],
        students: [],
        reports: [],
        portfolios: [],
        userAccess: [],
        templateConfig: DEFAULT_TEMPLATE_CONFIG,
      };
      try {
        db = await readDbDirect();
      } catch {
        // allow Super Admin entry even if Apps Script is temporarily unreachable
      }
      const session: DirectFallbackSessionUser = {
        role: 'admin',
        userId: 'superadmin:admin',
        email: 'dfacmi123@gmail.com',
        name: 'Super Admin MDA',
        exp: Date.now() + SESSION_TTL_MS,
      };
      const token = makeDirectSessionToken(session);
      return { sessionToken: token, user: session, data: db } as T;
    }

    const db = await readDbDirect();
    const matchedTeacher = db.teachers.find((t) => {
      const matchId =
        t.nama.trim().replace(/\s+/g, ' ').toLowerCase() === q ||
        (t.kodeGuru || '').trim().toLowerCase() === q ||
        t.id.trim().toLowerCase() === q ||
        t.email.trim().toLowerCase() === q;
      const expectedPin = (t.accessPin || generateSmartAccessPin(t.nama, t.kodeGuru || t.id))
        .trim()
        .toUpperCase();
      return matchId && expectedPin === normPin;
    });
    const matchedAccess = !matchedTeacher
      ? db.userAccess.find((u) => {
          if (u.statusAktif === false || (u.role !== 'admin' && u.role !== 'guru')) return false;
          const matchId =
            u.email.trim().toLowerCase() === q ||
            u.nama.trim().replace(/\s+/g, ' ').toLowerCase() === q ||
            u.id.trim().toLowerCase() === q;
          const customPin = (u.accessPin || '').trim().toUpperCase();
          return matchId && Boolean(customPin) && customPin === normPin;
        })
      : undefined;

    if (!matchedTeacher && !matchedAccess) {
      throw makeDirectError('Nama/ID/Email Guru atau PIN Akses tidak sesuai.', 401);
    }

    const session: DirectFallbackSessionUser = matchedTeacher
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
          role: matchedAccess!.role,
          userId: `access:${matchedAccess!.id}`,
          email: matchedAccess!.email,
          name: matchedAccess!.nama,
          exp: Date.now() + SESSION_TTL_MS,
        };
    const token = makeDirectSessionToken(session);
    return { sessionToken: token, user: session, data: scopeDbForUser(db, session) } as T;
  }

  if (pathname === '/api/public/portfolio') {
    const slug = (urlObj.searchParams.get('slug') || '').trim().toLowerCase();
    const db = await readDbDirect();
    const student = db.students.find(
      (s) =>
        s.portfolioSlug.trim().toLowerCase() === slug ||
        s.id.trim().toLowerCase() === slug ||
        s.nisnMda.trim().toLowerCase() === slug
    );
    if (!student) throw makeDirectError('Portofolio santri tidak ditemukan.', 404);
    return {
      student: { ...student, accessPin: '' },
      portfolios: db.portfolios.filter((p) => p.studentId === student.id),
      templateConfig: db.templateConfig || DEFAULT_TEMPLATE_CONFIG,
      spreadsheetId: db.spreadsheetId,
    } as T;
  }

  const session = getStoredDirectSessionUser(sessionToken);
  if (!session) {
    throw makeDirectError('Sesi login tidak valid atau telah berakhir. Silakan masuk ulang.', 401);
  }

  if (pathname === '/api/data') {
    const db = await readDbDirect();
    return { user: session, data: scopeDbForUser(db, session) } as T;
  }

  if (pathname === '/api/admin/apps-script/connect') {
    if (session.role !== 'admin') throw makeDirectError('Akses ditolak.', 403);
    const cleanUrl = String(body?.appsScriptUrl || '').trim();
    const db = await readDbDirect(cleanUrl);
    setDirectAppsScriptUrl(cleanUrl);
    return { data: db, appsScriptUrl: cleanUrl } as T;
  }

  if (pathname === '/api/admin/apps-script/save-all') {
    if (session.role !== 'admin') throw makeDirectError('Akses ditolak.', 403);
    const nextDb = body?.data as MdaDatabase;
    await saveAllDirect(nextDb);
    const freshDb = await readDbDirect();
    return { data: freshDb, updatedAt: freshDb.lastSyncedAt } as T;
  }

  if (pathname === '/api/reports/upsert') {
    if (session.role === 'santri_ortu') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const incoming = { ...(body.report as SemesterReport), updatedAt: new Date().toISOString() };
    const exists = currentDb.reports.some((r) => r.id === incoming.id);
    const nextReports = exists
      ? currentDb.reports.map((r) => (r.id === incoming.id ? incoming : r))
      : [...currentDb.reports, incoming];
    const nextDb = { ...currentDb, reports: nextReports, lastSyncedAt: incoming.updatedAt };
    await saveAllDirect(nextDb);
    return { report: incoming, data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname === '/api/reports/batch-upsert') {
    if (session.role === 'santri_ortu') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const incomingList = (body.reports || []) as SemesterReport[];
    const now = new Date().toISOString();
    const map = new Map(incomingList.map((r) => [r.id, { ...r, updatedAt: now }]));
    const nextReports = currentDb.reports.map((r) => map.get(r.id) || r);
    const existingIds = new Set(currentDb.reports.map((r) => r.id));
    incomingList.forEach((r) => {
      if (!existingIds.has(r.id)) nextReports.push(map.get(r.id)!);
    });
    const nextDb = { ...currentDb, reports: nextReports, lastSyncedAt: now };
    await saveAllDirect(nextDb);
    return { reports: Array.from(map.values()), data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname === '/api/students/upsert') {
    if (session.role === 'santri_ortu') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const stu = body.student as Student;
    const exists = currentDb.students.some((s) => s.id === stu.id);
    const nextStudents = exists
      ? currentDb.students.map((s) => (s.id === stu.id ? stu : s))
      : [...currentDb.students, stu];
    const nextDb = { ...currentDb, students: nextStudents, lastSyncedAt: new Date().toISOString() };
    await saveAllDirect(nextDb);
    return { data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname.startsWith('/api/students/') && method === 'DELETE') {
    if (session.role === 'santri_ortu') throw makeDirectError('Akses ditolak.', 403);
    const studentId = decodeURIComponent(pathname.slice('/api/students/'.length));
    const currentDb = await readDbDirect();
    const nextDb = {
      ...currentDb,
      students: currentDb.students.filter((s) => s.id !== studentId),
      lastSyncedAt: new Date().toISOString(),
    };
    await saveAllDirect(nextDb);
    return { data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname === '/api/teachers/upsert') {
    if (session.role !== 'admin') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const teacher = body.teacher as TeacherClass;
    const exists = currentDb.teachers.some((t) => t.id === teacher.id);
    const nextTeachers = exists
      ? currentDb.teachers.map((t) => (t.id === teacher.id ? teacher : t))
      : [...currentDb.teachers, teacher];
    const nextDb = { ...currentDb, teachers: nextTeachers, lastSyncedAt: new Date().toISOString() };
    await saveAllDirect(nextDb);
    return { data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname.startsWith('/api/teachers/') && method === 'DELETE') {
    if (session.role !== 'admin') throw makeDirectError('Akses ditolak.', 403);
    const teacherId = decodeURIComponent(pathname.slice('/api/teachers/'.length));
    const currentDb = await readDbDirect();
    const nextDb = {
      ...currentDb,
      teachers: currentDb.teachers.filter((t) => t.id !== teacherId),
      lastSyncedAt: new Date().toISOString(),
    };
    await saveAllDirect(nextDb);
    return { data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname === '/api/periods/upsert') {
    if (session.role !== 'admin') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const period = body.period as AcademicPeriod;
    const exists = currentDb.periods.some((p) => p.id === period.id);
    let nextPeriods = exists
      ? currentDb.periods.map((p) => (p.id === period.id ? period : p))
      : [...currentDb.periods, period];
    if (period.isActive) {
      nextPeriods = nextPeriods.map((p) => ({ ...p, isActive: p.id === period.id }));
    }
    const nextDb = { ...currentDb, periods: nextPeriods, lastSyncedAt: new Date().toISOString() };
    await saveAllDirect(nextDb);
    return { data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname === '/api/portfolios/upsert' || pathname === '/api/portfolios/batch-upsert') {
    if (session.role === 'santri_ortu') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const incoming: PortfolioProject[] =
      pathname === '/api/portfolios/upsert' ? [body.project] : body.projects || [];
    const map = new Map(incoming.map((p) => [p.id, p]));
    const nextPortfolios = currentDb.portfolios.map((p) => map.get(p.id) || p);
    const existingIds = new Set(currentDb.portfolios.map((p) => p.id));
    incoming.forEach((p) => {
      if (!existingIds.has(p.id)) nextPortfolios.push(p);
    });
    const nextDb = {
      ...currentDb,
      portfolios: nextPortfolios,
      lastSyncedAt: new Date().toISOString(),
    };
    await saveAllDirect(nextDb);
    return { data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname.startsWith('/api/portfolios/') && method === 'DELETE') {
    if (session.role === 'santri_ortu') throw makeDirectError('Akses ditolak.', 403);
    const id = decodeURIComponent(pathname.slice('/api/portfolios/'.length));
    const currentDb = await readDbDirect();
    const nextDb = {
      ...currentDb,
      portfolios: currentDb.portfolios.filter((p) => p.id !== id),
      lastSyncedAt: new Date().toISOString(),
    };
    await saveAllDirect(nextDb);
    return { data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname === '/api/template/save') {
    if (session.role !== 'admin') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const nextDb = {
      ...currentDb,
      templateConfig: body.templateConfig as BrandingTemplateConfig,
      lastSyncedAt: new Date().toISOString(),
    };
    await saveAllDirect(nextDb);
    return { data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname === '/api/access/save') {
    if (session.role !== 'admin') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const nextDb = {
      ...currentDb,
      userAccess: body.userAccess as UserAccess[],
      lastSyncedAt: new Date().toISOString(),
    };
    await saveAllDirect(nextDb);
    return { data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname === '/api/cbt/settings/rapor-lock') {
    if (session.role !== 'admin') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const nextTpl: BrandingTemplateConfig = {
      ...DEFAULT_TEMPLATE_CONFIG,
      ...(currentDb.templateConfig || {}),
      lockRaporDuringExam: Boolean(body?.lockRaporDuringExam),
      ...(typeof body?.lockRaporMessage === 'string' && body.lockRaporMessage.trim()
        ? { lockRaporMessage: body.lockRaporMessage.trim() }
        : {}),
    };
    await saveSectionDirect('templateConfig', nextTpl);
    const nextDb = { ...currentDb, templateConfig: nextTpl, lastSyncedAt: new Date().toISOString() };
    return { data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname === '/api/cbt/exams/seed-defaults') {
    if (session.role === 'santri_ortu') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const activePeriod =
      currentDb.periods.find((p) => p.isActive) ||
      currentDb.periods[currentDb.periods.length - 1];
    const defaults = createDefaultCbtExams(
      activePeriod?.tahunAkademik || '2026/2027',
      activePeriod?.semester || 'Gasal'
    );
    const existingIds = new Set((currentDb.cbtExams || []).map((e) => e.id));
    const nextExams = [...(currentDb.cbtExams || []), ...defaults.filter((d) => !existingIds.has(d.id))];
    const saved = await saveSectionDirect('cbtExams', nextExams);
    return {
      data: scopeDbForUser(
        { ...currentDb, cbtExams: nextExams, lastSyncedAt: saved.updatedAt },
        session
      ),
    } as T;
  }

  if (pathname === '/api/cbt/exams/upsert') {
    if (session.role === 'santri_ortu') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const incoming = body.exam as CbtExam;
    const stamped: CbtExam = {
      ...incoming,
      token: (incoming.token || '').trim().toUpperCase() || 'MDA123',
      updatedAt: new Date().toISOString(),
    };
    const exams = currentDb.cbtExams || [];
    const nextExams = exams.some((e) => e.id === stamped.id)
      ? exams.map((e) => (e.id === stamped.id ? stamped : e))
      : [...exams, stamped];
    const saved = await saveSectionDirect('cbtExams', nextExams);
    return {
      data: scopeDbForUser(
        { ...currentDb, cbtExams: nextExams, lastSyncedAt: saved.updatedAt },
        session
      ),
    } as T;
  }

  if (pathname.startsWith('/api/cbt/exams/') && method === 'DELETE') {
    if (session.role === 'santri_ortu') throw makeDirectError('Akses ditolak.', 403);
    const examId = decodeURIComponent(pathname.slice('/api/cbt/exams/'.length));
    const currentDb = await readDbDirect();
    const nextExams = (currentDb.cbtExams || []).filter((e) => e.id !== examId);
    const nextQuestions = (currentDb.cbtQuestions || []).filter((q) => q.examId !== examId);
    const nextAttempts = (currentDb.cbtAttempts || []).filter((a) => a.examId !== examId);
    await saveSectionDirect('cbtExams', nextExams);
    await saveSectionDirect('cbtQuestions', nextQuestions);
    const saved = await saveSectionDirect('cbtAttempts', nextAttempts);
    return {
      data: scopeDbForUser(
        {
          ...currentDb,
          cbtExams: nextExams,
          cbtQuestions: nextQuestions,
          cbtAttempts: nextAttempts,
          lastSyncedAt: saved.updatedAt,
        },
        session
      ),
    } as T;
  }

  if (pathname === '/api/cbt/questions/save') {
    if (session.role === 'santri_ortu') throw makeDirectError('Akses ditolak.', 403);
    const { examId, questions } = body as { examId: string; questions: CbtQuestion[] };
    const currentDb = await readDbDirect();
    const otherQuestions = (currentDb.cbtQuestions || []).filter((q) => q.examId !== examId);
    const normalized = questions.map((q, idx) => ({
      ...q,
      examId,
      orderNumber: idx + 1,
      kunciJawaban: (q.kunciJawaban || 'A').toUpperCase() as CbtOptionKey,
    }));
    const nextQuestions = [...otherQuestions, ...normalized];
    const saved = await saveSectionDirect('cbtQuestions', nextQuestions);
    return {
      data: scopeDbForUser(
        { ...currentDb, cbtQuestions: nextQuestions, lastSyncedAt: saved.updatedAt },
        session
      ),
    } as T;
  }

  if (pathname === '/api/cbt/attempts/proctor-action') {
    if (session.role === 'santri_ortu') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const { action, examId, attemptId } = body as {
      action: 'unlock' | 'reset' | 'sync_rapor' | 'bulk_sync_rapor';
      examId: string;
      attemptId?: string;
    };
    const exam = (currentDb.cbtExams || []).find((e) => e.id === examId);
    if (!exam) throw makeDirectError('Paket ujian CBT tidak ditemukan.', 404);
    let nextAttempts = [...(currentDb.cbtAttempts || [])];
    let nextReports = [...currentDb.reports];
    let syncedCount = 0;

    if (action === 'unlock' && attemptId) {
      nextAttempts = nextAttempts.map((a) =>
        a.id === attemptId
          ? { ...a, status: 'in_progress', violationCount: 0, lastSavedAt: new Date().toISOString() }
          : a
      );
      await saveSectionDirect('cbtAttempts', nextAttempts);
    } else if (action === 'reset' && attemptId) {
      nextAttempts = nextAttempts.filter((a) => a.id !== attemptId);
      await saveSectionDirect('cbtAttempts', nextAttempts);
    } else if ((action === 'sync_rapor' || action === 'bulk_sync_rapor')) {
      const targets =
        action === 'sync_rapor'
          ? nextAttempts.filter((a) => a.id === attemptId)
          : nextAttempts.filter((a) => a.examId === exam.id && a.status === 'submitted');
      const examQuestions = (currentDb.cbtQuestions || []).filter((q) => q.examId === exam.id);
      for (const att of targets) {
        const graded =
          typeof att.score === 'number'
            ? {
                benarCount: att.benarCount ?? 0,
                salahCount: att.salahCount ?? 0,
                totalQuestions: att.totalQuestions ?? examQuestions.length,
                score: att.score,
              }
            : gradeAttemptDirect(att, examQuestions);
        const applied = applyCbtScoreDirect(
          { ...currentDb, reports: nextReports },
          exam,
          att.studentId,
          graded.score
        );
        if (applied.updatedReport) {
          nextReports = applied.reports;
          nextAttempts = nextAttempts.map((a) =>
            a.id === att.id
              ? { ...att, ...graded, status: 'submitted', syncedToRaporAt: new Date().toISOString() }
              : a
          );
          syncedCount += 1;
        }
      }
      if (syncedCount > 0) {
        await saveSectionDirect('reports', nextReports);
        await saveSectionDirect('cbtAttempts', nextAttempts);
      }
    }

    return {
      syncedCount,
      data: scopeDbForUser(
        {
          ...currentDb,
          reports: nextReports,
          cbtAttempts: nextAttempts,
          lastSyncedAt: new Date().toISOString(),
        },
        session
      ),
    } as T;
  }

  if (pathname === '/api/cbt/student/overview') {
    const db = await readDbDirect();
    const studentId = session.studentId || '';
    const student = db.students.find((s) => s.id === studentId);
    const counts: Record<string, number> = {};
    for (const q of db.cbtQuestions || []) counts[q.examId] = (counts[q.examId] || 0) + 1;
    return {
      student: student ? { ...student, accessPin: '' } : null,
      exams: (db.cbtExams || []).map((e) => ({
        ...sanitizeExamForStudent(e),
        questionCount: counts[e.id] || 0,
      })),
      attempts: (db.cbtAttempts || [])
        .filter((a) => a.studentId === studentId)
        .map((a) =>
          sanitizeAttemptForStudent(
            a,
            (db.cbtExams || []).find((e) => e.id === a.examId)
          )
        ),
      serverNow: new Date().toISOString(),
    } as T;
  }

  if (pathname === '/api/cbt/student/start') {
    const { examId, token } = body as { examId: string; token?: string };
    const db = await readDbDirect();
    const exam = (db.cbtExams || []).find((e) => e.id === examId);
    if (!exam) throw makeDirectError('Paket ujian tidak ditemukan.', 404);
    if (exam.status !== 'active') throw makeDirectError('Ujian mata pelajaran ini belum dibuka.', 403);
    const examQuestions = (db.cbtQuestions || [])
      .filter((q) => q.examId === exam.id)
      .sort((a, b) => a.orderNumber - b.orderNumber);
    if (examQuestions.length === 0) throw makeDirectError('Bank soal ujian ini masih kosong.', 400);
    const student = db.students.find((s) => s.id === (session.studentId || ''));
    if (!student) throw makeDirectError('Identitas peserta tidak ditemukan.', 403);

    const attemptId = `${exam.id}__${student.id}`;
    let attempt = (db.cbtAttempts || []).find((a) => a.id === attemptId);
    if (attempt?.status === 'submitted') {
      return {
        alreadySubmitted: true,
        exam: sanitizeExamForStudent(exam),
        attempt: sanitizeAttemptForStudent(attempt, exam),
        questions: [],
        remainingSeconds: 0,
        serverNow: new Date().toISOString(),
      } as T;
    }
    if (attempt?.status === 'locked') {
      throw makeDirectError('Ujian terkunci karena pelanggaran Web Lockdown.', 423, {
        code: 'ATTEMPT_LOCKED',
        attempt: sanitizeAttemptForStudent(attempt, exam),
      });
    }
    if (!attempt) {
      const cleanToken = (token || '').trim().toUpperCase();
      if (!cleanToken || cleanToken !== exam.token.trim().toUpperCase()) {
        throw makeDirectError('Token Ujian salah atau tidak sesuai.', 401);
      }
      const rawIds = examQuestions.map((q) => q.id);
      const questionOrder = exam.shuffleQuestions
        ? [...rawIds].sort(() => Math.random() - 0.5)
        : rawIds;
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
      await postAppsScriptDirect({ action: 'upsertCbtAttempt', payload: attempt, attempt });
    }

    const endMs =
      new Date(attempt.startedAt).getTime() + Number(exam.durationMinutes || 60) * 60 * 1000;
    const remainingSeconds = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
    const qMap = new Map(examQuestions.map((q) => [q.id, q]));
    const orderedIds =
      attempt.questionOrder && attempt.questionOrder.length > 0
        ? attempt.questionOrder.filter((id) => qMap.has(id))
        : examQuestions.map((q) => q.id);
    for (const q of examQuestions) if (!orderedIds.includes(q.id)) orderedIds.push(q.id);
    return {
      alreadySubmitted: false,
      exam: sanitizeExamForStudent(exam),
      attempt: sanitizeAttemptForStudent(attempt, exam),
      questions: orderedIds.map((id) => qMap.get(id)!).map(sanitizeQuestionForStudent),
      remainingSeconds,
      serverNow: new Date().toISOString(),
    } as T;
  }

  if (pathname === '/api/cbt/student/save') {
    const { attemptId, answers, raguIds, currentQuestionIndex, newViolations } = body as {
      attemptId: string;
      answers?: Record<string, CbtOptionKey>;
      raguIds?: string[];
      currentQuestionIndex?: number;
      newViolations?: CbtViolationLog[];
    };
    const db = await readDbDirect();
    const attempt = (db.cbtAttempts || []).find((a) => a.id === attemptId);
    if (!attempt) throw makeDirectError('Sesi ujian tidak ditemukan.', 404);
    const exam = (db.cbtExams || []).find((e) => e.id === attempt.examId);
    const maxV = exam?.maxViolations || 3;
    const mergedViolations = [
      ...(attempt.violations || []),
      ...(Array.isArray(newViolations) ? newViolations : []),
    ];
    const nextViolationCount = mergedViolations.length;
    const shouldLock = nextViolationCount >= maxV;
    const updated: CbtAttempt = {
      ...attempt,
      answers: answers ?? attempt.answers,
      raguIds: raguIds ?? attempt.raguIds,
      currentQuestionIndex:
        typeof currentQuestionIndex === 'number'
          ? currentQuestionIndex
          : attempt.currentQuestionIndex,
      violations: mergedViolations,
      violationCount: nextViolationCount,
      status: shouldLock ? 'locked' : attempt.status,
      lastSavedAt: new Date().toISOString(),
    };
    await postAppsScriptDirect({ action: 'upsertCbtAttempt', payload: updated, attempt: updated });
    return {
      attempt: sanitizeAttemptForStudent(updated, exam),
      locked: shouldLock,
      serverNow: new Date().toISOString(),
    } as T;
  }

  if (pathname === '/api/cbt/student/submit') {
    const { attemptId, answers, raguIds } = body as {
      attemptId: string;
      answers: Record<string, CbtOptionKey>;
      raguIds: string[];
    };
    const db = await readDbDirect();
    const attempt = (db.cbtAttempts || []).find((a) => a.id === attemptId);
    if (!attempt) throw makeDirectError('Sesi ujian tidak ditemukan.', 404);
    const exam = (db.cbtExams || []).find((e) => e.id === attempt.examId)!;
    const examQuestions = (db.cbtQuestions || []).filter((q) => q.examId === exam.id);
    const merged: CbtAttempt = {
      ...attempt,
      answers: answers || attempt.answers,
      raguIds: raguIds || attempt.raguIds,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      lastSavedAt: new Date().toISOString(),
    };
    const graded = gradeAttemptDirect(merged, examQuestions);
    let finalAttempt: CbtAttempt = { ...merged, ...graded };
    let syncedToRapor = false;
    if (exam.autoSyncToRapor && exam.targetRaporMapping?.category !== 'none') {
      const applied = applyCbtScoreDirect(db, exam, finalAttempt.studentId, graded.score);
      if (applied.updatedReport) {
        await saveSectionDirect('reports', applied.reports);
        finalAttempt = { ...finalAttempt, syncedToRaporAt: new Date().toISOString() };
        syncedToRapor = true;
      }
    }
    await postAppsScriptDirect({
      action: 'upsertCbtAttempt',
      payload: finalAttempt,
      attempt: finalAttempt,
    });
    return {
      attempt: sanitizeAttemptForStudent(finalAttempt, exam),
      showScoreAfterFinish: exam.showScoreAfterFinish !== false,
      syncedToRapor,
    } as T;
  }

  if (pathname === '/api/internship/profile/upsert') {
    const currentDb = await readDbDirect();
    const incoming = body.profile as InternProfile;
    const stamped: InternProfile = {
      ...incoming,
      id: incoming.studentId,
      updatedAt: new Date().toISOString(),
    };
    const list = currentDb.internProfiles || [];
    const nextProfiles = list.some((p) => p.studentId === stamped.studentId)
      ? list.map((p) => (p.studentId === stamped.studentId ? stamped : p))
      : [...list, stamped];
    const nextDb = { ...currentDb, internProfiles: nextProfiles, lastSyncedAt: stamped.updatedAt };
    try {
      await postAppsScriptDirect({
        action: 'upsertInternProfile',
        payload: stamped,
        internProfile: stamped,
      });
    } catch {
      await saveAllDirect(nextDb);
    }
    return { profile: stamped, data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname === '/api/internship/daily-log/upsert') {
    const currentDb = await readDbDirect();
    const incoming = body.log as InternDailyLog;
    const canonicalId = `${incoming.studentId}_${incoming.tanggal}`;
    const stamped: InternDailyLog = {
      ...incoming,
      id: canonicalId,
      updatedAt: new Date().toISOString(),
    };
    const list = currentDb.internDailyLogs || [];
    const nextLogs = list.some(
      (l) => l.id === canonicalId || (l.studentId === stamped.studentId && l.tanggal === stamped.tanggal)
    )
      ? list.map((l) =>
          l.id === canonicalId || (l.studentId === stamped.studentId && l.tanggal === stamped.tanggal)
            ? stamped
            : l
        )
      : [...list, stamped];
    const nextDb = { ...currentDb, internDailyLogs: nextLogs, lastSyncedAt: stamped.updatedAt };
    try {
      await postAppsScriptDirect({
        action: 'upsertInternDailyLog',
        payload: stamped,
        internDailyLog: stamped,
      });
    } catch {
      await saveAllDirect(nextDb);
    }
    return { log: stamped, data: scopeDbForUser(nextDb, session) } as T;
  }

  if (pathname === '/api/internship/tracker-config/save') {
    if (session.role !== 'admin') throw makeDirectError('Akses ditolak.', 403);
    const currentDb = await readDbDirect();
    const nextTpl: BrandingTemplateConfig = {
      ...DEFAULT_TEMPLATE_CONFIG,
      ...(currentDb.templateConfig || {}),
      internTrackerItems: body.internTrackerItems as InternTrackerItem[],
      ...(typeof body.internHalamanPerJuz === 'number'
        ? { internHalamanPerJuz: body.internHalamanPerJuz }
        : {}),
    };
    await saveSectionDirect('templateConfig', nextTpl);
    const nextDb = { ...currentDb, templateConfig: nextTpl, lastSyncedAt: new Date().toISOString() };
    return { data: scopeDbForUser(nextDb, session) } as T;
  }

  throw makeDirectError(`Endpoint ${pathname} belum tersedia pada mode fallback langsung.`, 404);
}
