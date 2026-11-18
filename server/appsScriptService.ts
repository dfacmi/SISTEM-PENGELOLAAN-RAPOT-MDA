import {
  ConflictError,
  DEFAULT_TEMPLATE_CONFIG,
  enqueueSheetOperation,
} from './googleSheetsService.ts';
import type {
  AcademicPeriod,
  BrandingTemplateConfig,
  MdaDatabase,
  PortfolioProject,
  SemesterReport,
  Student,
  TeacherClass,
  UserAccess,
} from '../src/types/mda.ts';

export const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyRsDtSpBMgDCekHjJvjlfrLNnUCiDMPDDRaMpwwk89TKahIqOmydYjgmS11pgCeGk7/exec';
export const DEFAULT_APPS_SCRIPT_SECRET = 'MDA-SECRET-2026';

export function isValidAppsScriptUrl(url: string | undefined | null): boolean {
  const trimmed = (url || '').trim();
  if (
    !trimmed ||
    trimmed === 'TEMPEL_URL_EXEC_ANDA' ||
    trimmed === 'TEMPEL_URL_WEB_APP_ANDA_DI_SINI' ||
    trimmed === 'https://script.google.com/macros/s/XXXX/exec' ||
    trimmed.includes('/macros/s/XXXX/')
  ) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function assertValidAppsScriptUrl(apiUrl: string): string {
  const trimmed = (apiUrl || '').trim();
  if (!isValidAppsScriptUrl(trimmed)) {
    throw new Error(
      'URL Web App Google Apps Script masih menggunakan contoh template ("https://script.google.com/macros/s/XXXX/exec"). Ganti bagian XXXX dengan ID Deployment Web App Anda yang asli di Pengaturan & Sheets atau env MDA_APPS_SCRIPT_URL.'
    );
  }
  return trimmed;
}

function parseAppsScriptJsonResponse(rawText: string, httpStatus: number): any {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    if (httpStatus >= 200 && httpStatus < 300) {
      return { status: 'success' };
    }
    throw new Error(`Google Apps Script mengembalikan respons kosong (HTTP ${httpStatus}).`);
  }

  if (trimmed.startsWith('<')) {
    throw new Error(
      'Google Apps Script mengembalikan halaman HTML (bukan JSON). Pastikan Web App di-deploy dengan akses "Anyone" (Siapa saja) dan URL berakhiran /exec.'
    );
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(
      `Respons Google Apps Script tidak valid (${httpStatus}): ${trimmed.slice(0, 140)}`
    );
  }
}

function normalizeDatabasePayload(
  rawData: any,
  apiUrl: string,
  updatedAt?: string
): MdaDatabase {
  const d = rawData && typeof rawData === 'object' ? rawData : {};
  const tpl =
    d.templateConfig && typeof d.templateConfig === 'object'
      ? { ...DEFAULT_TEMPLATE_CONFIG, ...d.templateConfig }
      : { ...DEFAULT_TEMPLATE_CONFIG };

  return {
    periods: Array.isArray(d.periods) ? d.periods : [],
    teachers: Array.isArray(d.teachers) ? d.teachers : [],
    students: Array.isArray(d.students) ? d.students : [],
    reports: Array.isArray(d.reports) ? d.reports : [],
    portfolios: Array.isArray(d.portfolios) ? d.portfolios : [],
    userAccess: Array.isArray(d.userAccess) ? d.userAccess : [],
    templateConfig: tpl,
    spreadsheetId: apiUrl,
    spreadsheetUrl: apiUrl,
    spreadsheetTitle: 'Google Sheets (Apps Script API)',
    lastSyncedAt: updatedAt || new Date().toISOString(),
  };
}

export async function readDatabaseFromAppsScript(apiUrl: string): Promise<MdaDatabase> {
  const targetUrl = assertValidAppsScriptUrl(apiUrl);
  const sep = targetUrl.includes('?') ? '&' : '?';
  const cacheBustedUrl = `${targetUrl}${sep}_t=${Date.now()}`;

  const res = await fetch(cacheBustedUrl, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  const text = await res.text();
  const parsed = parseAppsScriptJsonResponse(text, res.status);

  if (!res.ok || parsed?.status === 'error') {
    throw new Error(
      parsed?.message ||
        parsed?.error ||
        `Gagal membaca data dari Google Apps Script (HTTP ${res.status}).`
    );
  }

  const dataNode = parsed?.data !== undefined ? parsed.data : parsed;
  return normalizeDatabasePayload(dataNode, targetUrl, parsed?.updatedAt);
}

export async function saveAllToAppsScript(
  apiUrl: string,
  secret: string,
  db: MdaDatabase
): Promise<{ updatedAt: string }> {
  const targetUrl = assertValidAppsScriptUrl(apiUrl);
  const effectiveSecret = (secret || DEFAULT_APPS_SCRIPT_SECRET).trim();

  const body = JSON.stringify({
    secret: effectiveSecret,
    action: 'saveAll',
    payload: {
      periods: db.periods,
      teachers: db.teachers,
      students: db.students,
      reports: db.reports,
      portfolios: db.portfolios,
      userAccess: db.userAccess,
      templateConfig: db.templateConfig,
    },
  });

  const res = await fetch(targetUrl, {
    method: 'POST',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body,
  });

  const text = await res.text();
  const parsed = parseAppsScriptJsonResponse(text, res.status);

  if (!res.ok || parsed?.status === 'error') {
    throw new Error(
      parsed?.message ||
        parsed?.error ||
        `Gagal menyimpan data ke Google Apps Script (HTTP ${res.status}).`
    );
  }

  return {
    updatedAt: parsed?.updatedAt || new Date().toISOString(),
  };
}

export async function upsertReportInAppsScript(
  apiUrl: string,
  secret: string,
  incomingReport: SemesterReport,
  expectedUpdatedAt?: string,
  forceOverwrite = false
): Promise<{ report: SemesterReport; db: MdaDatabase }> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const existing = currentDb.reports.find((r) => r.id === incomingReport.id);

    if (
      existing &&
      expectedUpdatedAt &&
      existing.updatedAt &&
      existing.updatedAt !== expectedUpdatedAt &&
      !forceOverwrite
    ) {
      throw new ConflictError(
        `Nilai rapor ini baru saja diubah oleh pengguna lain (${new Date(existing.updatedAt).toLocaleString('id-ID')}). Muat data terbaru sebelum menyimpan ulang agar tidak saling menimpa.`,
        existing.updatedAt,
        existing
      );
    }

    const stampedReport: SemesterReport = {
      ...incomingReport,
      updatedAt: new Date().toISOString(),
    };

    const nextReports = existing
      ? currentDb.reports.map((r) => (r.id === stampedReport.id ? stampedReport : r))
      : [...currentDb.reports, stampedReport];

    const nextDb: MdaDatabase = {
      ...currentDb,
      reports: nextReports,
      lastSyncedAt: new Date().toISOString(),
    };

    const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
    nextDb.lastSyncedAt = saved.updatedAt;
    return { report: stampedReport, db: nextDb };
  });
}

export async function upsertStudentInAppsScript(
  apiUrl: string,
  secret: string,
  incomingStudent: Student
): Promise<{ student: Student; db: MdaDatabase }> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const exists = currentDb.students.some((s) => s.id === incomingStudent.id);
    const nextStudents = exists
      ? currentDb.students.map((s) => (s.id === incomingStudent.id ? incomingStudent : s))
      : [...currentDb.students, incomingStudent];

    const nextDb: MdaDatabase = {
      ...currentDb,
      students: nextStudents,
      lastSyncedAt: new Date().toISOString(),
    };

    const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
    nextDb.lastSyncedAt = saved.updatedAt;
    return { student: incomingStudent, db: nextDb };
  });
}

export async function deleteStudentInAppsScript(
  apiUrl: string,
  secret: string,
  studentId: string
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const nextDb: MdaDatabase = {
      ...currentDb,
      students: currentDb.students.filter((s) => s.id !== studentId),
      lastSyncedAt: new Date().toISOString(),
    };
    const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
    nextDb.lastSyncedAt = saved.updatedAt;
    return nextDb;
  });
}

export async function upsertTeacherInAppsScript(
  apiUrl: string,
  secret: string,
  incomingTeacher: TeacherClass
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const exists = currentDb.teachers.some((t) => t.id === incomingTeacher.id);
    const nextTeachers = exists
      ? currentDb.teachers.map((t) => (t.id === incomingTeacher.id ? incomingTeacher : t))
      : [...currentDb.teachers, incomingTeacher];

    const nextDb: MdaDatabase = {
      ...currentDb,
      teachers: nextTeachers,
      lastSyncedAt: new Date().toISOString(),
    };
    const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
    nextDb.lastSyncedAt = saved.updatedAt;
    return nextDb;
  });
}

export async function deleteTeacherInAppsScript(
  apiUrl: string,
  secret: string,
  teacherId: string
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const nextDb: MdaDatabase = {
      ...currentDb,
      teachers: currentDb.teachers.filter((t) => t.id !== teacherId),
      lastSyncedAt: new Date().toISOString(),
    };
    const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
    nextDb.lastSyncedAt = saved.updatedAt;
    return nextDb;
  });
}

export async function upsertPeriodInAppsScript(
  apiUrl: string,
  secret: string,
  incomingPeriod: AcademicPeriod
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const exists = currentDb.periods.some((p) => p.id === incomingPeriod.id);
    let nextPeriods = exists
      ? currentDb.periods.map((p) => (p.id === incomingPeriod.id ? incomingPeriod : p))
      : [...currentDb.periods, incomingPeriod];

    if (incomingPeriod.isActive) {
      nextPeriods = nextPeriods.map((p) => ({
        ...p,
        isActive: p.id === incomingPeriod.id,
      }));
    }

    const nextDb: MdaDatabase = {
      ...currentDb,
      periods: nextPeriods,
      lastSyncedAt: new Date().toISOString(),
    };
    const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
    nextDb.lastSyncedAt = saved.updatedAt;
    return nextDb;
  });
}

export async function upsertPortfolioInAppsScript(
  apiUrl: string,
  secret: string,
  incomingProject: PortfolioProject
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const exists = currentDb.portfolios.some((p) => p.id === incomingProject.id);
    const nextPortfolios = exists
      ? currentDb.portfolios.map((p) => (p.id === incomingProject.id ? incomingProject : p))
      : [...currentDb.portfolios, incomingProject];

    const nextDb: MdaDatabase = {
      ...currentDb,
      portfolios: nextPortfolios,
      lastSyncedAt: new Date().toISOString(),
    };
    const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
    nextDb.lastSyncedAt = saved.updatedAt;
    return nextDb;
  });
}

export async function deletePortfolioInAppsScript(
  apiUrl: string,
  secret: string,
  portfolioId: string
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const nextDb: MdaDatabase = {
      ...currentDb,
      portfolios: currentDb.portfolios.filter((p) => p.id !== portfolioId),
      lastSyncedAt: new Date().toISOString(),
    };
    const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
    nextDb.lastSyncedAt = saved.updatedAt;
    return nextDb;
  });
}

export async function saveTemplateConfigInAppsScript(
  apiUrl: string,
  secret: string,
  config: BrandingTemplateConfig
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const nextDb: MdaDatabase = {
      ...currentDb,
      templateConfig: config,
      lastSyncedAt: new Date().toISOString(),
    };
    const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
    nextDb.lastSyncedAt = saved.updatedAt;
    return nextDb;
  });
}

export async function saveUserAccessInAppsScript(
  apiUrl: string,
  secret: string,
  userAccessList: UserAccess[]
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const nextDb: MdaDatabase = {
      ...currentDb,
      userAccess: userAccessList,
      lastSyncedAt: new Date().toISOString(),
    };
    const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
    nextDb.lastSyncedAt = saved.updatedAt;
    return nextDb;
  });
}

export async function mergeLocalSnapshotIntoAppsScript(
  apiUrl: string,
  secret: string,
  localDb: MdaDatabase
): Promise<{
  db: MdaDatabase;
  addedCounts: {
    periods: number;
    teachers: number;
    students: number;
    reports: number;
    portfolios: number;
    userAccess: number;
  };
}> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);

    const periodIds = new Set(currentDb.periods.map((p) => p.id));
    const addedPeriods = (localDb.periods || []).filter((p) => !periodIds.has(p.id));

    const teacherIds = new Set(currentDb.teachers.map((t) => t.id));
    const addedTeachers = (localDb.teachers || []).filter((t) => !teacherIds.has(t.id));

    const studentIds = new Set(currentDb.students.map((s) => s.id));
    const studentNisns = new Set(currentDb.students.map((s) => s.nisnMda.trim().toLowerCase()));
    const addedStudents = (localDb.students || []).filter(
      (s) => !studentIds.has(s.id) && !studentNisns.has(s.nisnMda.trim().toLowerCase())
    );

    const reportIds = new Set(currentDb.reports.map((r) => r.id));
    const reportKeys = new Set(
      currentDb.reports.map((r) => `${r.studentId}::${r.tahunAkademik}::${r.semester}`)
    );
    const addedReports = (localDb.reports || []).filter(
      (r) =>
        !reportIds.has(r.id) &&
        !reportKeys.has(`${r.studentId}::${r.tahunAkademik}::${r.semester}`)
    );

    const portIds = new Set(currentDb.portfolios.map((p) => p.id));
    const addedPortfolios = (localDb.portfolios || []).filter((p) => !portIds.has(p.id));

    const accessIds = new Set(currentDb.userAccess.map((u) => u.id));
    const accessEmails = new Set(currentDb.userAccess.map((u) => u.email.trim().toLowerCase()));
    const addedAccess = (localDb.userAccess || []).filter(
      (u) => !accessIds.has(u.id) && !accessEmails.has(u.email.trim().toLowerCase())
    );

    const mergedDb: MdaDatabase = {
      ...currentDb,
      periods: [...currentDb.periods, ...addedPeriods],
      teachers: [...currentDb.teachers, ...addedTeachers],
      students: [...currentDb.students, ...addedStudents],
      reports: [...currentDb.reports, ...addedReports],
      portfolios: [...currentDb.portfolios, ...addedPortfolios],
      userAccess: [...currentDb.userAccess, ...addedAccess],
      templateConfig:
        currentDb.templateConfig || localDb.templateConfig || DEFAULT_TEMPLATE_CONFIG,
      lastSyncedAt: new Date().toISOString(),
    };

    const totalAdded =
      addedPeriods.length +
      addedTeachers.length +
      addedStudents.length +
      addedReports.length +
      addedPortfolios.length +
      addedAccess.length;

    if (totalAdded > 0) {
      const saved = await saveAllToAppsScript(apiUrl, secret, mergedDb);
      mergedDb.lastSyncedAt = saved.updatedAt;
    }

    return {
      db: mergedDb,
      addedCounts: {
        periods: addedPeriods.length,
        teachers: addedTeachers.length,
        students: addedStudents.length,
        reports: addedReports.length,
        portfolios: addedPortfolios.length,
        userAccess: addedAccess.length,
      },
    };
  });
}
