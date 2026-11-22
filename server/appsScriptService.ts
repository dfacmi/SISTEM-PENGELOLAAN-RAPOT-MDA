import {
  ConflictError,
  DEFAULT_TEMPLATE_CONFIG,
  enqueueSheetOperation,
} from './googleSheetsService.ts';
import {
  createDefaultCbtExams,
  DEFAULT_CHARACTER_PROGRAMS,
  DEFAULT_DIGITAL_SKILLS,
  DEFAULT_DINIYAH_MAPEL,
  DEFAULT_SIKAP_ASPEK,
} from '../src/data/seedData.ts';
import { recalculateReport } from '../src/utils/grading.ts';
import type {
  AcademicPeriod,
  BrandingTemplateConfig,
  CbtAttempt,
  CbtExam,
  CbtQuestion,
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
    cbtExams: Array.isArray(d.cbtExams) ? d.cbtExams : [],
    cbtQuestions: Array.isArray(d.cbtQuestions) ? d.cbtQuestions : [],
    cbtAttempts: Array.isArray(d.cbtAttempts) ? d.cbtAttempts : [],
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
      cbtExams: db.cbtExams || [],
      cbtQuestions: db.cbtQuestions || [],
      cbtAttempts: db.cbtAttempts || [],
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

export async function upsertReportsBatchInAppsScript(
  apiUrl: string,
  secret: string,
  incomingReports: SemesterReport[]
): Promise<{ reports: SemesterReport[]; db: MdaDatabase }> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const now = new Date().toISOString();
    const stampedMap = new Map<string, SemesterReport>();
    incomingReports.forEach((r) => {
      stampedMap.set(r.id, { ...r, updatedAt: now });
    });

    const nextReports = currentDb.reports.map((r) => stampedMap.get(r.id) || r);
    const existingIds = new Set(currentDb.reports.map((r) => r.id));
    incomingReports.forEach((r) => {
      if (!existingIds.has(r.id)) {
        nextReports.push(stampedMap.get(r.id)!);
      }
    });

    const nextDb: MdaDatabase = {
      ...currentDb,
      reports: nextReports,
      lastSyncedAt: now,
    };

    const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
    nextDb.lastSyncedAt = saved.updatedAt;
    return {
      reports: Array.from(stampedMap.values()),
      db: nextDb,
    };
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

export async function bulkImportStudentsInAppsScript(
  apiUrl: string,
  secret: string,
  payload: {
    students: Student[];
    userAccess: UserAccess[];
    duplicatePolicy?: 'skip' | 'update';
  }
): Promise<{
  db: MdaDatabase;
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  addedAccessCount: number;
}> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const policy = payload.duplicatePolicy === 'update' ? 'update' : 'skip';

    const nextStudents = [...currentDb.students];
    const idRemap = new Map<string, string>();
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const incoming of payload.students || []) {
      const nisnKey = (incoming.nisnMda || '').trim().toLowerCase();
      const idx = nextStudents.findIndex(
        (s) =>
          s.id === incoming.id ||
          (Boolean(nisnKey) && s.nisnMda.trim().toLowerCase() === nisnKey)
      );

      if (idx !== -1) {
        const existing = nextStudents[idx];
        idRemap.set(incoming.id, existing.id);
        if (policy === 'update') {
          nextStudents[idx] = {
            ...existing,
            ...incoming,
            id: existing.id,
            fotoUrl: incoming.fotoUrl || existing.fotoUrl,
            waliKelasId: incoming.waliKelasId || existing.waliKelasId,
            waliKelasNama: incoming.waliKelasNama || existing.waliKelasNama,
            emailSantriOrtu: incoming.emailSantriOrtu || existing.emailSantriOrtu,
            behanceUrl: incoming.behanceUrl || existing.behanceUrl || '',
            portfolioPdfUrl: incoming.portfolioPdfUrl || existing.portfolioPdfUrl || '',
            portfolioPdfSubject: incoming.portfolioPdfSubject || existing.portfolioPdfSubject || '',
          };
          updatedCount += 1;
        } else {
          skippedCount += 1;
        }
      } else {
        nextStudents.push(incoming);
        idRemap.set(incoming.id, incoming.id);
        addedCount += 1;
      }
    }

    const nextUserAccess = [...currentDb.userAccess];
    let addedAccessCount = 0;

    for (const rawAcc of payload.userAccess || []) {
      const resolvedLinkedId = idRemap.get(rawAcc.linkedStudentId) || rawAcc.linkedStudentId;
      const acc: UserAccess = {
        ...rawAcc,
        linkedStudentId: resolvedLinkedId,
      };
      const emailKey = (acc.email || '').trim().toLowerCase();
      const accIdx = nextUserAccess.findIndex(
        (u) =>
          u.id === acc.id ||
          (u.role === 'santri_ortu' &&
            Boolean(acc.linkedStudentId) &&
            u.linkedStudentId === acc.linkedStudentId) ||
          (Boolean(emailKey) && u.email.trim().toLowerCase() === emailKey)
      );

      if (accIdx !== -1) {
        if (policy === 'update') {
          nextUserAccess[accIdx] = {
            ...nextUserAccess[accIdx],
            nama: acc.nama || nextUserAccess[accIdx].nama,
            accessPin: acc.accessPin || nextUserAccess[accIdx].accessPin,
            statusAktif: acc.statusAktif,
          };
        }
      } else {
        nextUserAccess.push(acc);
        addedAccessCount += 1;
      }
    }

    const nextDb: MdaDatabase = {
      ...currentDb,
      students: nextStudents,
      userAccess: nextUserAccess,
      lastSyncedAt: new Date().toISOString(),
    };

    if (addedCount > 0 || updatedCount > 0 || addedAccessCount > 0) {
      const saved = await saveAllToAppsScript(apiUrl, secret, nextDb);
      nextDb.lastSyncedAt = saved.updatedAt;
    }

    return {
      db: nextDb,
      addedCount,
      updatedCount,
      skippedCount,
      addedAccessCount,
    };
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

export async function upsertPortfoliosBatchInAppsScript(
  apiUrl: string,
  secret: string,
  incomingProjects: PortfolioProject[]
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const incomingMap = new Map(incomingProjects.map((p) => [p.id, p]));
    const nextPortfolios = currentDb.portfolios.map((p) => incomingMap.get(p.id) || p);
    const existingIds = new Set(currentDb.portfolios.map((p) => p.id));
    incomingProjects.forEach((p) => {
      if (!existingIds.has(p.id)) {
        nextPortfolios.push(p);
      }
    });

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

export type AppsScriptSectionName =
  | 'periods'
  | 'teachers'
  | 'students'
  | 'reports'
  | 'portfolios'
  | 'userAccess'
  | 'cbtExams'
  | 'cbtQuestions'
  | 'cbtAttempts'
  | 'templateConfig';

async function postToAppsScript(
  apiUrl: string,
  secret: string,
  bodyPayload: Record<string, unknown>
): Promise<{ updatedAt: string; parsed: any }> {
  const targetUrl = assertValidAppsScriptUrl(apiUrl);
  const effectiveSecret = (secret || DEFAULT_APPS_SCRIPT_SECRET).trim();
  const res = await fetch(targetUrl, {
    method: 'POST',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      secret: effectiveSecret,
      ...bodyPayload,
    }),
  });
  const text = await res.text();
  const parsed = parseAppsScriptJsonResponse(text, res.status);
  if (!res.ok || parsed?.status === 'error') {
    throw new Error(
      parsed?.message ||
        parsed?.error ||
        `Gagal mengirim aksi ke Google Apps Script (HTTP ${res.status}).`
    );
  }
  return {
    updatedAt: parsed?.updatedAt || new Date().toISOString(),
    parsed,
  };
}

export async function saveSectionInAppsScript(
  apiUrl: string,
  secret: string,
  section: AppsScriptSectionName,
  payload: unknown
): Promise<{ updatedAt: string }> {
  const res = await postToAppsScript(apiUrl, secret, {
    action: 'saveSection',
    section,
    payload,
  });
  return { updatedAt: res.updatedAt };
}

export async function upsertCbtAttemptInAppsScript(
  apiUrl: string,
  secret: string,
  attempt: CbtAttempt
): Promise<{ updatedAt: string }> {
  const res = await postToAppsScript(apiUrl, secret, {
    action: 'upsertCbtAttempt',
    payload: attempt,
    attempt,
  });
  return { updatedAt: res.updatedAt };
}

export function gradeAttemptAgainstQuestions(
  attempt: CbtAttempt,
  examQuestions: CbtQuestion[]
): {
  benarCount: number;
  salahCount: number;
  totalQuestions: number;
  score: number;
} {
  const totalQuestions = examQuestions.length;
  if (totalQuestions === 0) {
    return { benarCount: 0, salahCount: 0, totalQuestions: 0, score: 0 };
  }
  let benarCount = 0;
  for (const q of examQuestions) {
    const ans = (attempt.answers?.[q.id] || '').toString().trim().toUpperCase();
    const key = (q.kunciJawaban || '').toString().trim().toUpperCase();
    if (ans && key && ans === key) {
      benarCount += 1;
    }
  }
  const salahCount = Math.max(0, totalQuestions - benarCount);
  const score = Math.round((benarCount / totalQuestions) * 100);
  return { benarCount, salahCount, totalQuestions, score };
}

export function applyCbtScoreToReport(
  db: MdaDatabase,
  exam: CbtExam,
  studentId: string,
  score: number
): { reports: SemesterReport[]; updatedReport: SemesterReport | null } {
  const mapping = exam.targetRaporMapping;
  if (!mapping || mapping.category === 'none' || !mapping.subjectName?.trim()) {
    return { reports: db.reports, updatedReport: null };
  }

  const activePeriod =
    db.periods.find((p) => p.isActive) || db.periods[db.periods.length - 1];
  const tahunAkademik =
    exam.tahunAkademik || activePeriod?.tahunAkademik || '2026/2027';
  const semester = exam.semester || activePeriod?.semester || 'Gasal';
  const periodConfig =
    db.periods.find(
      (p) => p.tahunAkademik === tahunAkademik && p.semester === semester
    ) || activePeriod;

  const existing = db.reports.find(
    (r) =>
      r.studentId === studentId &&
      r.tahunAkademik === tahunAkademik &&
      r.semester === semester
  );

  const baselineReport: SemesterReport = existing
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
        sikap: DEFAULT_SIKAP_ASPEK.map((aspek) => ({
          aspek,
          predikat: 'B',
          deskripsi: '',
        })),
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
    const idx = baselineReport.diniyah.findIndex(
      (d) => d.mataPelajaran.trim().toLowerCase() === targetNameNorm
    );
    if (idx >= 0) {
      baselineReport.diniyah[idx] = {
        ...baselineReport.diniyah[idx],
        uas: clampedScore,
        uasFromCbt: true,
      };
    } else {
      baselineReport.diniyah.push({
        no: baselineReport.diniyah.length + 1,
        mataPelajaran: mapping.subjectName.trim(),
        kitabMateri: '-',
        kkm: periodConfig?.kkmDiniyah || 60,
        uas: clampedScore,
        uasFromCbt: true,
        nilai: clampedScore,
        predikat: 'C',
        deskripsi: '',
      });
    }
  } else if (mapping.category === 'skillDigital') {
    const idx = baselineReport.skillDigital.findIndex(
      (s) => s.materiSkill.trim().toLowerCase() === targetNameNorm
    );
    const patchSkill = (prev: typeof baselineReport.skillDigital[number]) => ({
      ...prev,
      kkm: prev.kkm || periodConfig?.kkmDigital || 70,
      uas: clampedScore,
      uasFromCbt: true,
    });
    if (idx >= 0) {
      baselineReport.skillDigital[idx] = patchSkill(baselineReport.skillDigital[idx]);
    } else {
      baselineReport.skillDigital.push(
        patchSkill({
          no: baselineReport.skillDigital.length + 1,
          materiSkill: mapping.subjectName.trim(),
          kkm: periodConfig?.kkmDigital || 70,
          pengetahuan: clampedScore,
          keterampilan: 0,
          nilaiAkhir: clampedScore,
          predikat: 'C',
        })
      );
    }
  } else if (mapping.category === 'tahfidz') {
    if (targetNameNorm.includes('kelancaran')) {
      baselineReport.tahfidz.kelancaran = clampedScore;
    } else if (targetNameNorm.includes('tajwid')) {
      baselineReport.tahfidz.tajwid = clampedScore;
    } else if (targetNameNorm.includes('makhraj')) {
      baselineReport.tahfidz.makhrajFashahah = clampedScore;
    } else if (targetNameNorm.includes('ketepatan')) {
      baselineReport.tahfidz.ketepatanAyat = clampedScore;
    } else {
      baselineReport.tahfidz.kelancaran = clampedScore;
      baselineReport.tahfidz.tajwid = clampedScore;
      baselineReport.tahfidz.makhrajFashahah = clampedScore;
      baselineReport.tahfidz.ketepatanAyat = clampedScore;
    }
  }

  const recalculated = recalculateReport(
    {
      ...baselineReport,
      updatedAt: new Date().toISOString(),
    },
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

export async function saveCbtExamInAppsScript(
  apiUrl: string,
  secret: string,
  incomingExam: CbtExam
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const exams = currentDb.cbtExams || [];
    const stamped: CbtExam = {
      ...incomingExam,
      token: (incomingExam.token || '').trim().toUpperCase() || 'MDA123',
      updatedAt: new Date().toISOString(),
    };
    const exists = exams.some((e) => e.id === stamped.id);
    const nextExams = exists
      ? exams.map((e) => (e.id === stamped.id ? stamped : e))
      : [...exams, stamped];
    const saved = await saveSectionInAppsScript(apiUrl, secret, 'cbtExams', nextExams);
    return {
      ...currentDb,
      cbtExams: nextExams,
      lastSyncedAt: saved.updatedAt,
    };
  });
}

export async function deleteCbtExamInAppsScript(
  apiUrl: string,
  secret: string,
  examId: string
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const nextExams = (currentDb.cbtExams || []).filter((e) => e.id !== examId);
    const nextQuestions = (currentDb.cbtQuestions || []).filter((q) => q.examId !== examId);
    const nextAttempts = (currentDb.cbtAttempts || []).filter((a) => a.examId !== examId);
    await saveSectionInAppsScript(apiUrl, secret, 'cbtExams', nextExams);
    await saveSectionInAppsScript(apiUrl, secret, 'cbtQuestions', nextQuestions);
    const saved = await saveSectionInAppsScript(apiUrl, secret, 'cbtAttempts', nextAttempts);
    return {
      ...currentDb,
      cbtExams: nextExams,
      cbtQuestions: nextQuestions,
      cbtAttempts: nextAttempts,
      lastSyncedAt: saved.updatedAt,
    };
  });
}

export async function seedDefaultCbtExamsInAppsScript(
  apiUrl: string,
  secret: string
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const activePeriod =
      currentDb.periods.find((p) => p.isActive) ||
      currentDb.periods[currentDb.periods.length - 1];
    const defaults = createDefaultCbtExams(
      activePeriod?.tahunAkademik || '2026/2027',
      activePeriod?.semester || 'Gasal'
    );
    const existingIds = new Set((currentDb.cbtExams || []).map((e) => e.id));
    const toAdd = defaults.filter((d) => !existingIds.has(d.id));
    const nextExams = [...(currentDb.cbtExams || []), ...toAdd];
    const saved = await saveSectionInAppsScript(apiUrl, secret, 'cbtExams', nextExams);
    return {
      ...currentDb,
      cbtExams: nextExams,
      lastSyncedAt: saved.updatedAt,
    };
  });
}

export async function saveCbtQuestionsForExamInAppsScript(
  apiUrl: string,
  secret: string,
  examId: string,
  examQuestions: CbtQuestion[]
): Promise<MdaDatabase> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const otherQuestions = (currentDb.cbtQuestions || []).filter(
      (q) => q.examId !== examId
    );
    const normalized = examQuestions.map((q, idx) => ({
      ...q,
      examId,
      orderNumber: idx + 1,
      kunciJawaban: (q.kunciJawaban || 'A').toUpperCase() as CbtQuestion['kunciJawaban'],
    }));
    const nextQuestions = [...otherQuestions, ...normalized];
    const saved = await saveSectionInAppsScript(
      apiUrl,
      secret,
      'cbtQuestions',
      nextQuestions
    );
    return {
      ...currentDb,
      cbtQuestions: nextQuestions,
      lastSyncedAt: saved.updatedAt,
    };
  });
}

export async function syncAttemptAndMaybeRaporInAppsScript(
  apiUrl: string,
  secret: string,
  attempt: CbtAttempt,
  exam: CbtExam,
  shouldSyncRapor: boolean
): Promise<{ attempt: CbtAttempt; syncedToRapor: boolean; db: MdaDatabase }> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    let stampedAttempt: CbtAttempt = { ...attempt };
    let syncedToRapor = false;

    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    let nextReports = currentDb.reports;

    if (
      shouldSyncRapor &&
      typeof stampedAttempt.score === 'number' &&
      exam.targetRaporMapping &&
      exam.targetRaporMapping.category !== 'none'
    ) {
      const applied = applyCbtScoreToReport(
        currentDb,
        exam,
        stampedAttempt.studentId,
        stampedAttempt.score
      );
      if (applied.updatedReport) {
        nextReports = applied.reports;
        await saveSectionInAppsScript(apiUrl, secret, 'reports', nextReports);
        stampedAttempt = {
          ...stampedAttempt,
          syncedToRaporAt: new Date().toISOString(),
        };
        syncedToRapor = true;
      }
    }

    const savedAttempt = await upsertCbtAttemptInAppsScript(apiUrl, secret, stampedAttempt);
    const exists = (currentDb.cbtAttempts || []).some((a) => a.id === stampedAttempt.id);
    const nextAttempts = exists
      ? (currentDb.cbtAttempts || []).map((a) =>
          a.id === stampedAttempt.id ? stampedAttempt : a
        )
      : [...(currentDb.cbtAttempts || []), stampedAttempt];

    return {
      attempt: stampedAttempt,
      syncedToRapor,
      db: {
        ...currentDb,
        reports: nextReports,
        cbtAttempts: nextAttempts,
        lastSyncedAt: savedAttempt.updatedAt,
      },
    };
  });
}

export async function proctorActionInAppsScript(
  apiUrl: string,
  secret: string,
  params: {
    action: 'unlock' | 'reset' | 'sync_rapor' | 'bulk_sync_rapor';
    examId: string;
    attemptId?: string;
  }
): Promise<{ db: MdaDatabase; syncedCount?: number }> {
  return enqueueSheetOperation(`apps_script:${apiUrl}`, async () => {
    const currentDb = await readDatabaseFromAppsScript(apiUrl);
    const exam = (currentDb.cbtExams || []).find((e) => e.id === params.examId);
    if (!exam) {
      throw new Error('Paket ujian CBT tidak ditemukan.');
    }

    let nextAttempts = [...(currentDb.cbtAttempts || [])];
    let nextReports = [...currentDb.reports];
    let syncedCount = 0;

    if (params.action === 'unlock' && params.attemptId) {
      const target = nextAttempts.find((a) => a.id === params.attemptId);
      if (!target) throw new Error('Data pengerjaan santri tidak ditemukan.');
      const unlocked: CbtAttempt = {
        ...target,
        status: 'in_progress',
        violationCount: 0,
        lastSavedAt: new Date().toISOString(),
      };
      await upsertCbtAttemptInAppsScript(apiUrl, secret, unlocked);
      nextAttempts = nextAttempts.map((a) => (a.id === unlocked.id ? unlocked : a));
    } else if (params.action === 'reset' && params.attemptId) {
      nextAttempts = nextAttempts.filter((a) => a.id !== params.attemptId);
      await saveSectionInAppsScript(apiUrl, secret, 'cbtAttempts', nextAttempts);
    } else if (params.action === 'sync_rapor' && params.attemptId) {
      const target = nextAttempts.find((a) => a.id === params.attemptId);
      if (!target) throw new Error('Data pengerjaan santri tidak ditemukan.');
      const examQuestions = (currentDb.cbtQuestions || []).filter(
        (q) => q.examId === exam.id
      );
      const graded =
        typeof target.score === 'number'
          ? {
              benarCount: target.benarCount ?? 0,
              salahCount: target.salahCount ?? 0,
              totalQuestions: target.totalQuestions ?? examQuestions.length,
              score: target.score,
            }
          : gradeAttemptAgainstQuestions(target, examQuestions);

      const applied = applyCbtScoreToReport(
        { ...currentDb, reports: nextReports },
        exam,
        target.studentId,
        graded.score
      );
      if (!applied.updatedReport) {
        throw new Error(
          'Pemetaan Nilai Rapor pada mapel ini masih "Tidak disinkronkan". Pilih target mapel rapor terlebih dahulu.'
        );
      }
      nextReports = applied.reports;
      await saveSectionInAppsScript(apiUrl, secret, 'reports', nextReports);
      const updatedAttempt: CbtAttempt = {
        ...target,
        ...graded,
        status: 'submitted',
        submittedAt: target.submittedAt || new Date().toISOString(),
        syncedToRaporAt: new Date().toISOString(),
      };
      await upsertCbtAttemptInAppsScript(apiUrl, secret, updatedAttempt);
      nextAttempts = nextAttempts.map((a) =>
        a.id === updatedAttempt.id ? updatedAttempt : a
      );
      syncedCount = 1;
    } else if (params.action === 'bulk_sync_rapor') {
      const submittedForExam = nextAttempts.filter(
        (a) => a.examId === exam.id && a.status === 'submitted'
      );
      if (
        !exam.targetRaporMapping ||
        exam.targetRaporMapping.category === 'none'
      ) {
        throw new Error(
          'Pilih target Nilai Rapor pada Pengaturan Mapel sebelum menyinkronkan nilai.'
        );
      }
      const nowIso = new Date().toISOString();
      const examQuestions = (currentDb.cbtQuestions || []).filter(
        (q) => q.examId === exam.id
      );
      for (const att of submittedForExam) {
        const graded =
          typeof att.score === 'number'
            ? {
                benarCount: att.benarCount ?? 0,
                salahCount: att.salahCount ?? 0,
                totalQuestions: att.totalQuestions ?? examQuestions.length,
                score: att.score,
              }
            : gradeAttemptAgainstQuestions(att, examQuestions);
        const applied = applyCbtScoreToReport(
          { ...currentDb, reports: nextReports },
          exam,
          att.studentId,
          graded.score
        );
        if (applied.updatedReport) {
          nextReports = applied.reports;
          const updatedAttempt: CbtAttempt = {
            ...att,
            ...graded,
            syncedToRaporAt: nowIso,
          };
          nextAttempts = nextAttempts.map((a) =>
            a.id === updatedAttempt.id ? updatedAttempt : a
          );
          syncedCount += 1;
        }
      }
      if (syncedCount > 0) {
        await saveSectionInAppsScript(apiUrl, secret, 'reports', nextReports);
        await saveSectionInAppsScript(apiUrl, secret, 'cbtAttempts', nextAttempts);
      }
    }

    return {
      syncedCount,
      db: {
        ...currentDb,
        reports: nextReports,
        cbtAttempts: nextAttempts,
        lastSyncedAt: new Date().toISOString(),
      },
    };
  });
}
