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
} from '../types/mda';

const SESSION_TOKEN_STORAGE_KEY = 'mda_backend_session_token';

export interface BackendSessionUser {
  role: UserRole;
  userId: string;
  teacherId?: string;
  studentId?: string;
  kelasDiampu?: string;
  email?: string;
  name: string;
  exp: number;
}

export interface ServerHealthStatus {
  ok: boolean;
  serviceAccountConfigured: boolean;
  serviceAccountEmail: string | null;
  spreadsheetConfigured: boolean;
  spreadsheetId: string | null;
  spreadsheetTitle: string | null;
  appsScriptConfigured?: boolean;
  appsScriptUrl?: string;
}

export class ApiConflictError extends Error {
  serverUpdatedAt: string;
  serverReport?: SemesterReport;
  constructor(message: string, serverUpdatedAt: string, serverReport?: SemesterReport) {
    super(message);
    this.name = 'ApiConflictError';
    this.serverUpdatedAt = serverUpdatedAt;
    this.serverReport = serverReport;
  }
}

export function getStoredSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null) {
  try {
    if (token) {
      sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore sessionStorage restrictions
  }
}

async function apiFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    googleAccessToken?: string | null;
    spreadsheetId?: string | null;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const sessionToken = getStoredSessionToken();
  if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  if (options.googleAccessToken) {
    headers['X-Google-Access-Token'] = options.googleAccessToken;
  }
  if (options.spreadsheetId) {
    headers['X-Spreadsheet-Id'] = options.spreadsheetId;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method || 'GET',
      credentials: 'include',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error(
      'Koneksi internet atau server terputus. Perubahan belum tersimpan ke Google Sheets.'
    );
  }

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    if (res.status === 409 && data?.code === 'VERSION_CONFLICT') {
      throw new ApiConflictError(
        data.error || 'Terjadi konflik pembaruan data bersamaan.',
        data.serverUpdatedAt,
        data.serverReport
      );
    }
    throw new Error(
      data?.error || `Terjadi kesalahan server (${res.status}). Silakan coba lagi.`
    );
  }

  return data as T;
}

export async function fetchServerHealth(spreadsheetId?: string | null): Promise<ServerHealthStatus> {
  const qs = spreadsheetId ? `?sheet=${encodeURIComponent(spreadsheetId)}` : '';
  return apiFetch<ServerHealthStatus>(`/api/health${qs}`);
}

export async function fetchPublicBrandingConfig(spreadsheetId?: string | null): Promise<{
  connected: boolean;
  spreadsheetId: string | null;
  spreadsheetTitle?: string;
  templateConfig: BrandingTemplateConfig;
  error?: string;
}> {
  const qs = spreadsheetId ? `?sheet=${encodeURIComponent(spreadsheetId)}` : '';
  return apiFetch(`/api/config/public${qs}`);
}

export async function loginParentViaServer(params: {
  identifier: string;
  pin: string;
  spreadsheetId?: string | null;
}): Promise<{ sessionToken: string; user: BackendSessionUser; data: MdaDatabase }> {
  const res = await apiFetch<{
    sessionToken: string;
    user: BackendSessionUser;
    data: MdaDatabase;
  }>('/api/auth/login-parent', {
    method: 'POST',
    body: {
      identifier: params.identifier,
      pin: params.pin,
      spreadsheetId: params.spreadsheetId || undefined,
    },
    spreadsheetId: params.spreadsheetId,
  });
  setStoredSessionToken(res.sessionToken);
  return res;
}

export async function loginStaffPinViaServer(params: {
  identifier: string;
  pin: string;
  spreadsheetId?: string | null;
}): Promise<{ sessionToken: string; user: BackendSessionUser; data: MdaDatabase }> {
  const res = await apiFetch<{
    sessionToken: string;
    user: BackendSessionUser;
    data: MdaDatabase;
  }>('/api/auth/login-staff-pin', {
    method: 'POST',
    body: {
      identifier: params.identifier,
      pin: params.pin,
      spreadsheetId: params.spreadsheetId || undefined,
    },
    spreadsheetId: params.spreadsheetId,
  });
  setStoredSessionToken(res.sessionToken);
  return res;
}

export async function logoutViaServer() {
  setStoredSessionToken(null);
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // ignore logout network errors
  }
}

export async function fetchScopedDataFromServer(params?: {
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{ user: BackendSessionUser; data: MdaDatabase }> {
  const qs = params?.spreadsheetId
    ? `?sheet=${encodeURIComponent(params.spreadsheetId)}`
    : '';
  return apiFetch(`/api/data${qs}`, {
    googleAccessToken: params?.googleAccessToken,
    spreadsheetId: params?.spreadsheetId,
  });
}

export async function connectSpreadsheetOnServer(params: {
  spreadsheetId: string;
  googleAccessToken?: string | null;
}): Promise<{ data: MdaDatabase }> {
  return apiFetch('/api/admin/spreadsheet/connect', {
    method: 'POST',
    body: { spreadsheetId: params.spreadsheetId },
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function connectAppsScriptOnServer(params: {
  appsScriptUrl: string;
  secret?: string;
}): Promise<{ data: MdaDatabase; appsScriptUrl: string }> {
  return apiFetch('/api/admin/apps-script/connect', {
    method: 'POST',
    body: {
      appsScriptUrl: params.appsScriptUrl,
      secret: params.secret,
    },
  });
}

export async function saveAllAppsScriptOnServer(params: {
  data: MdaDatabase;
}): Promise<{ data: MdaDatabase; updatedAt: string }> {
  return apiFetch('/api/admin/apps-script/save-all', {
    method: 'POST',
    body: { data: params.data },
  });
}

export async function migrateLocalSnapshotToServer(params: {
  localDb: MdaDatabase;
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{
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
  return apiFetch('/api/admin/migrate-local', {
    method: 'POST',
    body: { localDb: params.localDb, spreadsheetId: params.spreadsheetId },
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function saveReportOnServer(params: {
  report: SemesterReport;
  expectedUpdatedAt?: string;
  forceOverwrite?: boolean;
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{ report: SemesterReport; data: MdaDatabase }> {
  return apiFetch('/api/reports/upsert', {
    method: 'POST',
    body: {
      report: params.report,
      expectedUpdatedAt: params.expectedUpdatedAt,
      forceOverwrite: params.forceOverwrite,
      spreadsheetId: params.spreadsheetId,
    },
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function upsertStudentOnServer(params: {
  student: Student;
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{ data: MdaDatabase }> {
  return apiFetch('/api/students/upsert', {
    method: 'POST',
    body: { student: params.student, spreadsheetId: params.spreadsheetId },
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function deleteStudentOnServer(params: {
  studentId: string;
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{ data: MdaDatabase }> {
  return apiFetch(`/api/students/${encodeURIComponent(params.studentId)}`, {
    method: 'DELETE',
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function upsertTeacherOnServer(params: {
  teacher: TeacherClass;
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{ data: MdaDatabase }> {
  return apiFetch('/api/teachers/upsert', {
    method: 'POST',
    body: { teacher: params.teacher, spreadsheetId: params.spreadsheetId },
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function deleteTeacherOnServer(params: {
  teacherId: string;
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{ data: MdaDatabase }> {
  return apiFetch(`/api/teachers/${encodeURIComponent(params.teacherId)}`, {
    method: 'DELETE',
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function upsertPeriodOnServer(params: {
  period: AcademicPeriod;
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{ data: MdaDatabase }> {
  return apiFetch('/api/periods/upsert', {
    method: 'POST',
    body: { period: params.period, spreadsheetId: params.spreadsheetId },
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function upsertPortfolioOnServer(params: {
  project: PortfolioProject;
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{ data: MdaDatabase }> {
  return apiFetch('/api/portfolios/upsert', {
    method: 'POST',
    body: { project: params.project, spreadsheetId: params.spreadsheetId },
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function deletePortfolioOnServer(params: {
  portfolioId: string;
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{ data: MdaDatabase }> {
  return apiFetch(`/api/portfolios/${encodeURIComponent(params.portfolioId)}`, {
    method: 'DELETE',
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function saveTemplateOnServer(params: {
  templateConfig: BrandingTemplateConfig;
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{ data: MdaDatabase }> {
  return apiFetch('/api/template/save', {
    method: 'POST',
    body: { templateConfig: params.templateConfig, spreadsheetId: params.spreadsheetId },
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function saveAccessOnServer(params: {
  userAccess: UserAccess[];
  googleAccessToken?: string | null;
  spreadsheetId?: string | null;
}): Promise<{ data: MdaDatabase }> {
  return apiFetch('/api/access/save', {
    method: 'POST',
    body: { userAccess: params.userAccess, spreadsheetId: params.spreadsheetId },
    googleAccessToken: params.googleAccessToken,
    spreadsheetId: params.spreadsheetId,
  });
}

export async function fetchPublicPortfolioFromServer(params: {
  slug: string;
  spreadsheetId?: string | null;
}): Promise<{
  student: Student;
  portfolios: PortfolioProject[];
  templateConfig: BrandingTemplateConfig;
  spreadsheetId?: string;
}> {
  const qs = new URLSearchParams({ slug: params.slug });
  if (params.spreadsheetId) qs.set('sheet', params.spreadsheetId);
  return apiFetch(`/api/public/portfolio?${qs.toString()}`);
}

export async function uploadAssetToDriveViaServer(params: {
  dataUrl: string;
  fileName: string;
  googleAccessToken?: string | null;
}): Promise<{ fileId: string; url: string; mimeType: string }> {
  return apiFetch('/api/drive/upload', {
    method: 'POST',
    body: { dataUrl: params.dataUrl, fileName: params.fileName },
    googleAccessToken: params.googleAccessToken,
  });
}
