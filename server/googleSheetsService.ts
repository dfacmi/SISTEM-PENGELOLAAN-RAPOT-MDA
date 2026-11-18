import crypto from 'node:crypto';
import type {
  AcademicPeriod,
  BrandingTemplateConfig,
  MdaDatabase,
  PortfolioProject,
  Predikat,
  SemesterReport,
  Student,
  TeacherClass,
  UserAccess,
} from '../src/types/mda.ts';

export const DEFAULT_TEMPLATE_CONFIG: BrandingTemplateConfig = {
  namaLembaga: 'Muslim Digital Academy (MDA)',
  namaPesantren: 'Pondok Pesantren Darul Fithrah',
  judulRapor: 'LAPORAN HASIL BELAJAR SANTRI',
  subjudulCompetence: 'Competence Report Of Muslim Digital Academy',
  labelCoverPortfolio: 'STUDENT PROJECT',
  pesanPenutupHalaman2:
    'Barakallahu fiikum. Teruslah belajar, berkarya, dan berakhlak mulia.',
  pesanPenutupHalaman6:
    'Semoga ilmu yang dipelajari menjadi manfaat dan berkah untuk umat.',
  whatsapp: '08953 7400 4000',
  instagram: '@muslimdigitalacademy',
  email: 'info@mda.sch.id',
  alamat: 'Nuricik Rt 3/V Desa Grajegan Tawangsari Sukoharjo, Jawa Tengah 57561',
  kotaTanggal: 'Sukoharjo',
  coverPhotoUrl: '',
  customLogoUrl: '',
  accentTheme: 'mda-emerald',
  loginHeadline: 'Dashboard Rapor Digital & Student Portfolio',
  loginDescription:
    'Sistem pengelolaan hasil belajar terpadu Muslim Digital Academy (MDA) Pondok Pesantren Darul Fithrah dengan penyimpanan permanen di Google Sheets dan akses privat bagi setiap wali santri.',
  loginAdminInfo:
    'Kelola santri, input nilai otomatis, template rapor, portofolio, & ekspor PDF resmi.',
  loginParentInfo:
    'Setiap wali masuk dengan ID & PIN pribadi — hanya melihat rapor putranya sendiri.',
  dashboardRadarTitle: 'Profil Kompetensi Santri MDA',
  dashboardPillarTitle: 'Kalkulasi 5 Pilar Utama Semester Ini',
  dashboardPillarSubtitle:
    'Mengacu pada format resmi Competence Report Muslim Digital Academy',
  dashboardPillarNote: 'Kalkulasi penilaian direktarium',
  dashboardTableTitle: 'Daftar Rapor & Portofolio Santri',
  dashboardTableSubtitle:
    'Pilih santri untuk input nilai, buka rapor, salin akses privat wali, atau cetak PDF resmi',
  portalTrendTitle: 'Grafik Perkembangan Kompetensi Antar Semester',
  portalTrendSubtitle:
    'Tren nilai Multimedia, Tahfidz, Diniyah, dan Character Building per semester',
  portalPortfolioSubtitle:
    'Klik langsung pada kartu karya untuk melihat hasil proyek secara jelas.',
  portalQrTitle: 'Akses Karya Online',
  portalQrDescription:
    'Klik atau salin link berikut untuk melihat seluruh proyek desain, UI/UX, dan video santri.',
  coverTagline:
    'Dokumentasi Capaian Kompetensi Multimedia, Diniyah Islamiyah, Tahfidzul Qur’an, Kesantrian, dan Character Building.',
  qrBannerTitle: 'LIHAT KARYA SELENGKAPNYA',
  qrBannerDescription:
    'Semua proyek, sidang karya, dan video santri semester ini dapat dilihat melalui link portofolio online di bawah ini.',
};

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MAX_SHEETS_CELL_CHARS = 49000;

export const MDA_SHEET_TABS = [
  'Master_Akademik',
  'Guru_Kelas',
  'Santri',
  'Rapor_Semester',
  'Sikap_Character',
  'Tahfidz',
  'Nilai_Diniyah',
  'Nilai_Digital',
  'Portofolio',
  'Hak_Akses',
  'Template_Branding',
] as const;

export type MdaTabName = (typeof MDA_SHEET_TABS)[number];

export class ConflictError extends Error {
  serverUpdatedAt: string;
  serverReport?: SemesterReport;
  constructor(message: string, serverUpdatedAt: string, serverReport?: SemesterReport) {
    super(message);
    this.name = 'ConflictError';
    this.serverUpdatedAt = serverUpdatedAt;
    this.serverReport = serverReport;
  }
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedServiceToken: { token: string; expiresAt: number } | null = null;

function parseServiceAccountFromEnv(): ServiceAccountKey | null {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ||
    (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
      ? Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64.trim(), 'base64').toString('utf8')
      : '');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
      token_uri: parsed.token_uri || GOOGLE_TOKEN_URL,
    };
  } catch {
    return null;
  }
}

export function getServiceAccountStatus(): {
  configured: boolean;
  clientEmail: string | null;
} {
  const sa = parseServiceAccountFromEnv();
  return {
    configured: Boolean(sa),
    clientEmail: sa ? sa.client_email : null,
  };
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export async function getServiceAccountAccessToken(): Promise<string | null> {
  const sa = parseServiceAccountFromEnv();
  if (!sa) return null;

  const now = Math.floor(Date.now() / 1000);
  if (cachedServiceToken && cachedServiceToken.expiresAt - 120 > now) {
    return cachedServiceToken.token;
  }

  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
      aud: sa.token_uri || GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(sa.private_key));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(sa.token_uri || GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gagal autentikasi Google Service Account: ${errText}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in?: number };
  cachedServiceToken = {
    token: json.access_token,
    expiresAt: now + Number(json.expires_in || 3600),
  };
  return cachedServiceToken.token;
}

export function extractSpreadsheetId(input: string): string {
  const trimmed = (input || '').trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  return trimmed;
}

export function generateSmartAccessPin(
  nama: string,
  nomorIdentitas: string,
  fallbackDigits = '001'
): string {
  const cleanedTokens = (nama || '')
    .replace(/[.,]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(
      (t) =>
        t.length > 0 &&
        !/^(ust|ustadz|ustadzah|h|hj|kh|dr|drs|ir)$/i.test(t)
    );
  const firstWord = (cleanedTokens[0] || 'MDA').replace(/[^a-zA-Z]/g, '');
  const prefix = (firstWord || 'MDA').toUpperCase();

  const allDigits = (nomorIdentitas || '').replace(/\D/g, '');
  const lastThree =
    allDigits.length >= 3
      ? allDigits.slice(-3)
      : (allDigits || fallbackDigits).padStart(3, '0').slice(-3);

  return `${prefix}${lastThree}`;
}

async function fetchGoogleJson(url: string, accessToken: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let errText = '';
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      errText = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      errText = await res.text();
    }
    throw new Error(`Google API Error (${res.status}): ${errText}`);
  }
  return res.json();
}

function clampCell(value: string | number | boolean): string | number | boolean {
  if (typeof value !== 'string') return value;
  if (value.length <= MAX_SHEETS_CELL_CHARS) return value;
  if (value.startsWith('data:')) {
    return '';
  }
  return value.slice(0, MAX_SHEETS_CELL_CHARS);
}

function clampRows(rows: (string | number | boolean)[][]): (string | number | boolean)[][] {
  return rows.map((row) => row.map(clampCell));
}

function dataUrlToBuffer(dataUrl: string, baseName: string): { buffer: Buffer; mime: string; fileName: string } | null {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const ext = mime.split('/')[1]?.split('+')[0] || 'png';
    return { buffer, mime, fileName: `${baseName}.${ext}` };
  } catch {
    return null;
  }
}

export async function uploadBufferToDrive(
  accessToken: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<{ fileId: string; url: string; mimeType: string }> {
  const metadata = {
    name: `MDA_${Date.now()}_${fileName}`,
    mimeType: mimeType || 'application/octet-stream',
  };

  const boundary = `mda_boundary_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metaPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
  );
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`
  );
  const ending = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([metaPart, fileHeader, buffer, ending]);

  const uploadRes = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Gagal mengunggah ke Google Drive: ${text}`);
  }

  const fileData = (await uploadRes.json()) as { id: string };
  const fileId = fileData.id;

  await fetch(`${DRIVE_API_BASE}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  const isVideo = mimeType.startsWith('video/');
  const url = isVideo
    ? `https://drive.google.com/file/d/${fileId}/preview`
    : `https://lh3.googleusercontent.com/d/${fileId}`;

  return { fileId, url, mimeType };
}

async function resolveAssetForSheet(
  accessToken: string,
  url: string | undefined,
  label: string
): Promise<string> {
  if (!url) return '';
  if (!url.startsWith('data:')) return url;
  if (url.length > 20000) {
    const parsed = dataUrlToBuffer(url, label);
    if (parsed) {
      try {
        const uploaded = await uploadBufferToDrive(
          accessToken,
          parsed.buffer,
          parsed.fileName,
          parsed.mime
        );
        if (uploaded?.url) return uploaded.url;
      } catch (err) {
        console.warn(`Upload Drive otomatis untuk ${label} gagal:`, err);
      }
    }
    return '';
  }
  return url;
}

function serializeDbToTabs(db: MdaDatabase): Record<MdaTabName, (string | number | boolean)[][]> {
  const masterRows: (string | number | boolean)[][] = [
    [
      'ID',
      'Tahun_Akademik',
      'Semester',
      'Tanggal_Rapor',
      'KKM_Diniyah',
      'KKM_Tahfidz',
      'KKM_Digital',
      'Kepala_Unit_MDA',
      'Mudir_Pesantren',
      'Aktif',
      'TTD_Kepala_Unit_URL',
      'TTD_Mudir_URL',
    ],
    ...db.periods.map((p) => [
      p.id,
      p.tahunAkademik,
      p.semester,
      p.tanggalRapor,
      p.kkmDiniyah,
      p.kkmTahfidz,
      p.kkmDigital,
      p.kepalaUnitMda,
      p.mudirPesantren,
      p.isActive ? 'YA' : 'TIDAK',
      p.ttdKepalaUnitUrl || '',
      p.ttdMudirUrl || '',
    ]),
  ];

  const teacherRows: (string | number | boolean)[][] = [
    ['ID_Guru', 'Nama', 'Jabatan', 'Email', 'Kelas_Diampu', 'Role', 'Kode_Guru', 'PIN_Akses', 'TTD_URL'],
    ...db.teachers.map((t) => [
      t.id,
      t.nama,
      t.jabatan,
      t.email,
      t.kelasDiampu,
      t.role,
      t.kodeGuru || t.id,
      t.accessPin || generateSmartAccessPin(t.nama, t.kodeGuru || t.id),
      t.ttdUrl || '',
    ]),
  ];

  const studentRows: (string | number | boolean)[][] = [
    [
      'ID_Santri',
      'NISN_MDA',
      'Nama_Lengkap',
      'Kelas',
      'Program',
      'ID_Wali_Kelas',
      'Nama_Wali_Kelas',
      'Foto_URL',
      'Email_Santri_Ortu',
      'Slug_Portofolio',
      'Status_Aktif',
      'PIN_Akses',
    ],
    ...db.students.map((s) => [
      s.id,
      s.nisnMda,
      s.nama,
      s.kelas,
      s.program,
      s.waliKelasId,
      s.waliKelasNama,
      s.fotoUrl,
      s.emailSantriOrtu,
      s.portfolioSlug,
      s.statusAktif,
      s.accessPin || '',
    ]),
  ];

  const raporRows: (string | number | boolean)[][] = [
    [
      'ID_Rapor',
      'ID_Santri',
      'Tahun_Akademik',
      'Semester',
      'Tanggal_Rapor',
      'Pilar_Multimedia_Pct',
      'Pilar_Diniyah_Pct',
      'Pilar_Tahfidz_Pct',
      'Pilar_Kesantrian_Pct',
      'Pilar_Character_Pct',
      'Auto_Pilar',
      'KPI_Character_Building',
      'KPI_Multimedia_Project',
      'KPI_Client_Project',
      'KPI_MDA_Mengajar',
      'KPI_Income_Rp',
      'KPI_Produksi_Konten',
      'Sakit_Hari',
      'Izin_Hari',
      'Alpa_Hari',
      'Pesan_Wali_Singkat',
      'Catatan_Perkembangan',
      'Catatan_Kekuatan',
      'Saran_Semester_Depan',
      'Keputusan_Semester',
      'Keputusan_Lainnya',
      'Published',
      'Updated_At',
    ],
    ...db.reports.map((r) => [
      r.id,
      r.studentId,
      r.tahunAkademik,
      r.semester,
      r.tanggalRapor,
      r.pilar.penguasaanMultimedia,
      r.pilar.diniyahPembelajaran,
      r.pilar.tahfidzulQuran,
      r.pilar.kesantrianKeasramaan,
      r.pilar.characterBuilding,
      r.pilar.autoCalculate ? 'YA' : 'TIDAK',
      r.kpiMda.characterBuildingCount,
      r.kpiMda.multimediaProjectCount,
      r.kpiMda.clientProjectCount,
      r.kpiMda.mdaMengajarCount,
      r.kpiMda.incomeRp,
      r.kpiMda.produksiKontenCount,
      r.kehadiran.sakit,
      r.kehadiran.izin,
      r.kehadiran.alpa,
      r.catatanWali.pesanSingkat,
      r.catatanWali.perkembangan,
      r.catatanWali.kekuatan,
      r.catatanWali.saranSemesterDepan,
      r.keputusanSemester,
      r.keputusanLainnya || '',
      r.published ? 'YA' : 'TIDAK',
      r.updatedAt,
    ]),
  ];

  const sikapRows: (string | number | boolean)[][] = [
    ['ID_Rapor', 'Tipe_Item', 'Nama_Aspek_Atau_Kegiatan', 'Predikat', 'Keterangan_Atau_Deskripsi'],
  ];
  db.reports.forEach((r) => {
    r.sikap.forEach((s) => {
      sikapRows.push([r.id, 'SIKAP', s.aspek, s.predikat, s.deskripsi]);
    });
    r.characterPrograms.forEach((c) => {
      sikapRows.push([r.id, 'PROGRAM_CB', c.kegiatan, '-', c.keterangan]);
    });
  });

  const tahfidzRows: (string | number | boolean)[][] = [
    [
      'ID_Rapor',
      'Total_Hafalan',
      'Capaian_Semester_Ini',
      'Total_Juziyah',
      'Total_Setoran_Ziyadah',
      'Total_Murojaah',
      'Nilai_Kelancaran',
      'Nilai_Tajwid',
      'Nilai_Makhraj_Fashahah',
      'Nilai_Ketepatan_Ayat',
      'Nilai_Akhir_Tahfidz',
      'Predikat_Tahfidz',
      'Deskripsi_Capaian',
    ],
    ...db.reports.map((r) => [
      r.id,
      r.tahfidz.totalHafalan,
      r.tahfidz.capaianSemesterIni,
      r.tahfidz.totalJuziyah,
      r.tahfidz.totalSetoranZiyadah,
      r.tahfidz.totalMurojaah,
      r.tahfidz.kelancaran,
      r.tahfidz.tajwid,
      r.tahfidz.makhrajFashahah,
      r.tahfidz.ketepatanAyat,
      r.tahfidz.nilaiAkhir,
      r.tahfidz.predikat,
      r.tahfidz.deskripsi,
    ]),
  ];

  const diniyahRows: (string | number | boolean)[][] = [
    ['ID_Rapor', 'No', 'Mata_Pelajaran', 'Kitab_Materi', 'KKM', 'Nilai', 'Predikat', 'Deskripsi_Capaian'],
  ];
  db.reports.forEach((r) => {
    r.diniyah.forEach((d) => {
      diniyahRows.push([
        r.id,
        d.no,
        d.mataPelajaran,
        d.kitabMateri,
        d.kkm,
        d.nilai,
        d.predikat,
        d.deskripsi,
      ]);
    });
  });

  const digitalRows: (string | number | boolean)[][] = [
    [
      'ID_Rapor',
      'No',
      'Materi_Skill',
      'KKM',
      'Pengetahuan',
      'Keterampilan',
      'Nilai_Akhir',
      'Predikat',
    ],
  ];
  db.reports.forEach((r) => {
    r.skillDigital.forEach((s) => {
      digitalRows.push([
        r.id,
        s.no,
        s.materiSkill,
        s.kkm,
        s.pengetahuan,
        s.keterampilan,
        s.nilaiAkhir,
        s.predikat,
      ]);
    });
  });

  const portfolioRows: (string | number | boolean)[][] = [
    [
      'ID_Karya',
      'ID_Santri',
      'Tahun_Akademik',
      'Semester',
      'Judul_Proyek',
      'Jenis',
      'Keterangan_Singkat',
      'Student_Competence',
      'Technology_Tools',
      'Description',
      'Link_Eksternal',
      'Media_1_URL',
      'Media_1_Type',
      'Media_1_Caption',
      'Media_1_Preset',
      'Media_2_URL',
      'Media_2_Type',
      'Media_2_Caption',
      'Media_2_Preset',
      'Media_3_URL',
      'Media_3_Type',
      'Media_3_Caption',
      'Media_3_Preset',
      'Featured',
    ],
    ...db.portfolios.map((p) => [
      p.id,
      p.studentId,
      p.tahunAkademik,
      p.semester,
      p.judul,
      p.jenis,
      p.keteranganSingkat,
      p.competence,
      p.technology,
      p.description,
      p.externalLink,
      p.mediaItems[0]?.url || '',
      p.mediaItems[0]?.type || 'image',
      p.mediaItems[0]?.caption || '',
      p.mediaItems[0]?.presetArt || 'poster',
      p.mediaItems[1]?.url || '',
      p.mediaItems[1]?.type || 'image',
      p.mediaItems[1]?.caption || '',
      p.mediaItems[1]?.presetArt || 'uiux',
      p.mediaItems[2]?.url || '',
      p.mediaItems[2]?.type || 'image',
      p.mediaItems[2]?.caption || '',
      p.mediaItems[2]?.presetArt || 'photo',
      p.featured ? 'YA' : 'TIDAK',
    ]),
  ];

  const accessRows: (string | number | boolean)[][] = [
    ['ID_User', 'Email_Google', 'Nama', 'Role', 'Linked_Student_ID', 'Status_Aktif'],
    ...db.userAccess.map((u) => [
      u.id,
      u.email,
      u.nama,
      u.role,
      u.linkedStudentId,
      u.statusAktif ? 'YA' : 'TIDAK',
    ]),
  ];

  const tpl = db.templateConfig || DEFAULT_TEMPLATE_CONFIG;
  const templateRows: (string | number | boolean)[][] = [
    ['Kunci', 'Nilai'],
    ...(Object.keys(tpl) as (keyof BrandingTemplateConfig)[]).map((k) => [
      k,
      String(tpl[k] ?? ''),
    ]),
  ];

  return {
    Master_Akademik: clampRows(masterRows),
    Guru_Kelas: clampRows(teacherRows),
    Santri: clampRows(studentRows),
    Rapor_Semester: clampRows(raporRows),
    Sikap_Character: clampRows(sikapRows),
    Tahfidz: clampRows(tahfidzRows),
    Nilai_Diniyah: clampRows(diniyahRows),
    Nilai_Digital: clampRows(digitalRows),
    Portofolio: clampRows(portfolioRows),
    Hak_Akses: clampRows(accessRows),
    Template_Branding: clampRows(templateRows),
  };
}

export async function getSpreadsheetMetadata(accessToken: string, spreadsheetId: string) {
  return fetchGoogleJson(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)`,
    accessToken
  );
}

export async function ensureMdaTabs(
  accessToken: string,
  spreadsheetId: string,
  headerTemplateDb?: MdaDatabase
) {
  const meta = (await getSpreadsheetMetadata(accessToken, spreadsheetId)) as {
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
  };

  const existingTitles = new Set<string>(
    (meta.sheets || []).map((s) => s.properties?.title || '')
  );

  const missingTabs = MDA_SHEET_TABS.filter((tab) => !existingTitles.has(tab));
  if (missingTabs.length > 0) {
    await fetchGoogleJson(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        requests: missingTabs.map((title) => ({
          addSheet: {
            properties: { title, gridProperties: { frozenRowCount: 1 } },
          },
        })),
      }),
    });

    const emptyDb: MdaDatabase = headerTemplateDb || {
      periods: [],
      teachers: [],
      students: [],
      reports: [],
      portfolios: [],
      userAccess: [],
      templateConfig: DEFAULT_TEMPLATE_CONFIG,
    };
    const serialized = serializeDbToTabs(emptyDb);
    const data = missingTabs.map((tab) => ({
      range: `'${tab}'!A1`,
      values: serialized[tab],
    }));

    await fetchGoogleJson(`${SHEETS_API_BASE}/${spreadsheetId}/values:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data,
      }),
    });
  }

  return meta;
}

export async function readDatabaseFromSheet(
  accessToken: string,
  spreadsheetId: string
): Promise<MdaDatabase> {
  const meta = await ensureMdaTabs(accessToken, spreadsheetId);

  const rangesQuery = MDA_SHEET_TABS.map(
    (tab) => `ranges=${encodeURIComponent(`'${tab}'!A1:AZ2000`)}`
  ).join('&');

  const batchRes = (await fetchGoogleJson(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${rangesQuery}`,
    accessToken
  )) as { valueRanges?: { values?: string[][] }[] };

  const valueRanges = batchRes.valueRanges || [];
  const tabMap: Record<string, string[][]> = {};
  MDA_SHEET_TABS.forEach((tab, idx) => {
    tabMap[tab] = valueRanges[idx]?.values || [];
  });

  const parseRows = (tab: MdaTabName) => {
    const rows = tabMap[tab] || [];
    return rows.length > 1 ? rows.slice(1) : [];
  };

  const periods: AcademicPeriod[] = parseRows('Master_Akademik')
    .filter((r) => r[0])
    .map((r) => ({
      id: String(r[0]),
      tahunAkademik: String(r[1] || '2026/2027'),
      semester: (r[2] === 'Genap' ? 'Genap' : 'Gasal') as 'Gasal' | 'Genap',
      tanggalRapor: String(r[3] || ''),
      kkmDiniyah: Number(r[4] || 60),
      kkmTahfidz: Number(r[5] || 70),
      kkmDigital: Number(r[6] || 60),
      kepalaUnitMda: String(r[7] || ''),
      mudirPesantren: String(r[8] || ''),
      isActive: String(r[9] || '').toUpperCase() === 'YA',
      ttdKepalaUnitUrl: String(r[10] || ''),
      ttdMudirUrl: String(r[11] || ''),
    }));

  const teachers: TeacherClass[] = parseRows('Guru_Kelas')
    .filter((r) => r[0])
    .map((r) => {
      const nama = String(r[1] || '');
      const kodeGuru = String(r[6] || r[0] || '');
      return {
        id: String(r[0]),
        nama,
        jabatan: String(r[2] || ''),
        email: String(r[3] || ''),
        kelasDiampu: String(r[4] || ''),
        role: (r[5] === 'admin' ? 'admin' : 'guru') as 'admin' | 'guru',
        kodeGuru,
        accessPin: String(r[7] || generateSmartAccessPin(nama, kodeGuru)),
        ttdUrl: String(r[8] || ''),
      };
    });

  const students: Student[] = parseRows('Santri')
    .filter((r) => r[0])
    .map((r) => {
      const nisnMda = String(r[1] || '');
      const nama = String(r[2] || '');
      return {
        id: String(r[0]),
        nisnMda,
        nama,
        kelas: String(r[3] || ''),
        program: String(r[4] || ''),
        waliKelasId: String(r[5] || ''),
        waliKelasNama: String(r[6] || ''),
        fotoUrl: String(r[7] || ''),
        emailSantriOrtu: String(r[8] || ''),
        portfolioSlug: String(r[9] || r[0]),
        statusAktif: (r[10] === 'Alumni' || r[10] === 'Cuti' ? r[10] : 'Aktif') as Student['statusAktif'],
        accessPin: String(r[11] || generateSmartAccessPin(nama, nisnMda)),
      };
    });

  const sikapRows = parseRows('Sikap_Character');
  const tahfidzRows = parseRows('Tahfidz');
  const diniyahRows = parseRows('Nilai_Diniyah');
  const digitalRows = parseRows('Nilai_Digital');

  const reports: SemesterReport[] = parseRows('Rapor_Semester')
    .filter((r) => r[0])
    .map((r) => {
      const reportId = String(r[0]);
      const rSikap = sikapRows
        .filter((s) => String(s[0]) === reportId && s[1] === 'SIKAP')
        .map((s) => ({
          aspek: String(s[2] || ''),
          predikat: (['A', 'B', 'C', 'D'].includes(String(s[3])) ? s[3] : 'B') as Predikat,
          deskripsi: String(s[4] || ''),
        }));
      const rPrograms = sikapRows
        .filter((s) => String(s[0]) === reportId && s[1] === 'PROGRAM_CB')
        .map((s) => ({
          kegiatan: String(s[2] || ''),
          keterangan: String(s[4] || ''),
        }));
      const tRow = tahfidzRows.find((t) => String(t[0]) === reportId);
      const rDiniyah = diniyahRows
        .filter((d) => String(d[0]) === reportId)
        .map((d) => ({
          no: Number(d[1] || 1),
          mataPelajaran: String(d[2] || ''),
          kitabMateri: String(d[3] || ''),
          kkm: Number(d[4] || 60),
          nilai: Number(d[5] || 0),
          predikat: (['A', 'B', 'C', 'D'].includes(String(d[6])) ? d[6] : 'C') as Predikat,
          deskripsi: String(d[7] || ''),
        }));
      const rDigital = digitalRows
        .filter((d) => String(d[0]) === reportId)
        .map((d) => ({
          no: Number(d[1] || 1),
          materiSkill: String(d[2] || ''),
          kkm: Number(d[3] || 60),
          pengetahuan: Number(d[4] || 0),
          keterampilan: Number(d[5] || 0),
          nilaiAkhir: Number(d[6] || 0),
          predikat: (['A', 'B', 'C', 'D'].includes(String(d[7])) ? d[7] : 'C') as Predikat,
        }));

      return {
        id: reportId,
        studentId: String(r[1] || ''),
        tahunAkademik: String(r[2] || '2026/2027'),
        semester: (r[3] === 'Genap' ? 'Genap' : 'Gasal') as 'Gasal' | 'Genap',
        tanggalRapor: String(r[4] || ''),
        pilar: {
          penguasaanMultimedia: Number(r[5] || 0),
          diniyahPembelajaran: Number(r[6] || 0),
          tahfidzulQuran: Number(r[7] || 0),
          kesantrianKeasramaan: Number(r[8] || 0),
          characterBuilding: Number(r[9] || 0),
          autoCalculate: String(r[10] || '').toUpperCase() === 'YA',
        },
        kpiMda: {
          characterBuildingCount: Number(r[11] || 0),
          multimediaProjectCount: Number(r[12] || 0),
          clientProjectCount: Number(r[13] || 0),
          mdaMengajarCount: Number(r[14] || 0),
          incomeRp: Number(r[15] || 0),
          produksiKontenCount: Number(r[16] || 0),
        },
        kehadiran: {
          sakit: Number(r[17] || 0),
          izin: Number(r[18] || 0),
          alpa: Number(r[19] || 0),
        },
        catatanWali: {
          pesanSingkat: String(r[20] || ''),
          perkembangan: String(r[21] || ''),
          kekuatan: String(r[22] || ''),
          saranSemesterDepan: String(r[23] || ''),
        },
        keputusanSemester: (r[24] || 'Lanjut ke semester genap') as SemesterReport['keputusanSemester'],
        keputusanLainnya: String(r[25] || ''),
        published: String(r[26] || '').toUpperCase() === 'YA',
        updatedAt: String(r[27] || ''),
        sikap: rSikap,
        characterPrograms: rPrograms,
        tahfidz: tRow
          ? {
              totalHafalan: String(tRow[1] || ''),
              capaianSemesterIni: String(tRow[2] || ''),
              totalJuziyah: String(tRow[3] || ''),
              totalSetoranZiyadah: String(tRow[4] || ''),
              totalMurojaah: String(tRow[5] || ''),
              kelancaran: Number(tRow[6] || 0),
              tajwid: Number(tRow[7] || 0),
              makhrajFashahah: Number(tRow[8] || 0),
              ketepatanAyat: Number(tRow[9] || 0),
              nilaiAkhir: Number(tRow[10] || 0),
              predikat: (['A', 'B', 'C', 'D'].includes(String(tRow[11])) ? tRow[11] : 'C') as Predikat,
              deskripsi: String(tRow[12] || ''),
            }
          : {
              totalHafalan: '',
              capaianSemesterIni: '',
              totalJuziyah: '',
              totalSetoranZiyadah: '',
              totalMurojaah: '',
              kelancaran: 0,
              tajwid: 0,
              makhrajFashahah: 0,
              ketepatanAyat: 0,
              nilaiAkhir: 0,
              predikat: 'D',
              deskripsi: '',
            },
        diniyah: rDiniyah,
        skillDigital: rDigital,
      };
    });

  const portfolios: PortfolioProject[] = parseRows('Portofolio')
    .filter((r) => r[0])
    .map((r) => ({
      id: String(r[0]),
      studentId: String(r[1] || ''),
      tahunAkademik: String(r[2] || '2026/2027'),
      semester: (r[3] === 'Genap' ? 'Genap' : 'Gasal') as 'Gasal' | 'Genap',
      judul: String(r[4] || ''),
      jenis: String(r[5] || ''),
      keteranganSingkat: String(r[6] || ''),
      competence: String(r[7] || ''),
      technology: String(r[8] || ''),
      description: String(r[9] || ''),
      externalLink: String(r[10] || ''),
      mediaItems: [
        {
          url: String(r[11] || ''),
          type: (r[12] === 'video' ? 'video' : 'image') as 'image' | 'video',
          caption: String(r[13] || ''),
          presetArt: (r[14] as 'poster' | 'uiux' | 'photo' | 'video') || 'poster',
        },
        {
          url: String(r[15] || ''),
          type: (r[16] === 'video' ? 'video' : 'image') as 'image' | 'video',
          caption: String(r[17] || ''),
          presetArt: (r[18] as 'poster' | 'uiux' | 'photo' | 'video') || 'uiux',
        },
        {
          url: String(r[19] || ''),
          type: (r[20] === 'video' ? 'video' : 'image') as 'image' | 'video',
          caption: String(r[21] || ''),
          presetArt: (r[22] as 'poster' | 'uiux' | 'photo' | 'video') || 'photo',
        },
      ],
      featured: String(r[23] || '').toUpperCase() === 'YA',
    }));

  const userAccess: UserAccess[] = parseRows('Hak_Akses')
    .filter((r) => r[0])
    .map((r) => ({
      id: String(r[0]),
      email: String(r[1] || ''),
      nama: String(r[2] || ''),
      role: (['admin', 'guru', 'santri_ortu'].includes(String(r[3]))
        ? r[3]
        : 'santri_ortu') as UserAccess['role'],
      linkedStudentId: String(r[4] || ''),
      statusAktif: String(r[5] || '').toUpperCase() !== 'TIDAK',
    }));

  const tplRows = parseRows('Template_Branding');
  const templateConfig: BrandingTemplateConfig = { ...DEFAULT_TEMPLATE_CONFIG };
  tplRows.forEach((r) => {
    const key = String(r[0] || '') as keyof BrandingTemplateConfig;
    if (key in templateConfig && r[1] !== undefined) {
      (templateConfig as unknown as Record<string, string>)[key] = String(r[1]);
    }
  });

  return {
    periods,
    teachers,
    students,
    reports,
    portfolios,
    userAccess,
    templateConfig,
    spreadsheetId,
    spreadsheetUrl: meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    spreadsheetTitle: meta.properties?.title || 'Google Spreadsheet MDA',
    lastSyncedAt: new Date().toISOString(),
  };
}

async function writeSpecificTabs(
  accessToken: string,
  spreadsheetId: string,
  db: MdaDatabase,
  tabs: MdaTabName[]
) {
  const serialized = serializeDbToTabs(db);
  await fetchGoogleJson(`${SHEETS_API_BASE}/${spreadsheetId}/values:batchClear`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      ranges: tabs.map((tab) => `'${tab}'!A:AZ`),
    }),
  });
  await fetchGoogleJson(`${SHEETS_API_BASE}/${spreadsheetId}/values:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: tabs.map((tab) => ({
        range: `'${tab}'!A1`,
        values: serialized[tab],
      })),
    }),
  });
}

// Per-spreadsheet mutex queue to prevent concurrent overwrites
const writeQueues = new Map<string, Promise<unknown>>();

export function enqueueSheetOperation<T>(spreadsheetId: string, op: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(spreadsheetId) || Promise.resolve();
  const next = prev.catch(() => undefined).then(op);
  writeQueues.set(
    spreadsheetId,
    next.finally(() => {
      if (writeQueues.get(spreadsheetId) === next) {
        writeQueues.delete(spreadsheetId);
      }
    })
  );
  return next;
}

export async function upsertReportInSheet(
  accessToken: string,
  spreadsheetId: string,
  incomingReport: SemesterReport,
  expectedUpdatedAt?: string,
  forceOverwrite = false
): Promise<{ report: SemesterReport; db: MdaDatabase }> {
  return enqueueSheetOperation(spreadsheetId, async () => {
    const currentDb = await readDatabaseFromSheet(accessToken, spreadsheetId);
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

    await writeSpecificTabs(accessToken, spreadsheetId, nextDb, [
      'Rapor_Semester',
      'Sikap_Character',
      'Tahfidz',
      'Nilai_Diniyah',
      'Nilai_Digital',
    ]);

    return { report: stampedReport, db: nextDb };
  });
}

export async function upsertStudentInSheet(
  accessToken: string,
  spreadsheetId: string,
  incomingStudent: Student
): Promise<{ student: Student; db: MdaDatabase }> {
  return enqueueSheetOperation(spreadsheetId, async () => {
    const currentDb = await readDatabaseFromSheet(accessToken, spreadsheetId);
    const cleanedStudent: Student = {
      ...incomingStudent,
      fotoUrl: await resolveAssetForSheet(
        accessToken,
        incomingStudent.fotoUrl,
        `foto_${incomingStudent.id}`
      ),
    };

    const exists = currentDb.students.some((s) => s.id === cleanedStudent.id);
    const nextStudents = exists
      ? currentDb.students.map((s) => (s.id === cleanedStudent.id ? cleanedStudent : s))
      : [...currentDb.students, cleanedStudent];

    const nextDb: MdaDatabase = {
      ...currentDb,
      students: nextStudents,
      lastSyncedAt: new Date().toISOString(),
    };

    await writeSpecificTabs(accessToken, spreadsheetId, nextDb, ['Santri']);
    return { student: cleanedStudent, db: nextDb };
  });
}

export async function deleteStudentInSheet(
  accessToken: string,
  spreadsheetId: string,
  studentId: string
): Promise<MdaDatabase> {
  return enqueueSheetOperation(spreadsheetId, async () => {
    const currentDb = await readDatabaseFromSheet(accessToken, spreadsheetId);
    const nextDb: MdaDatabase = {
      ...currentDb,
      students: currentDb.students.filter((s) => s.id !== studentId),
      lastSyncedAt: new Date().toISOString(),
    };
    await writeSpecificTabs(accessToken, spreadsheetId, nextDb, ['Santri']);
    return nextDb;
  });
}

export async function upsertTeacherInSheet(
  accessToken: string,
  spreadsheetId: string,
  incomingTeacher: TeacherClass
): Promise<MdaDatabase> {
  return enqueueSheetOperation(spreadsheetId, async () => {
    const currentDb = await readDatabaseFromSheet(accessToken, spreadsheetId);
    const cleanedTeacher: TeacherClass = {
      ...incomingTeacher,
      ttdUrl: await resolveAssetForSheet(
        accessToken,
        incomingTeacher.ttdUrl,
        `ttd_guru_${incomingTeacher.id}`
      ),
    };
    const exists = currentDb.teachers.some((t) => t.id === cleanedTeacher.id);
    const nextTeachers = exists
      ? currentDb.teachers.map((t) => (t.id === cleanedTeacher.id ? cleanedTeacher : t))
      : [...currentDb.teachers, cleanedTeacher];

    const nextDb: MdaDatabase = {
      ...currentDb,
      teachers: nextTeachers,
      lastSyncedAt: new Date().toISOString(),
    };
    await writeSpecificTabs(accessToken, spreadsheetId, nextDb, ['Guru_Kelas']);
    return nextDb;
  });
}

export async function deleteTeacherInSheet(
  accessToken: string,
  spreadsheetId: string,
  teacherId: string
): Promise<MdaDatabase> {
  return enqueueSheetOperation(spreadsheetId, async () => {
    const currentDb = await readDatabaseFromSheet(accessToken, spreadsheetId);
    const nextDb: MdaDatabase = {
      ...currentDb,
      teachers: currentDb.teachers.filter((t) => t.id !== teacherId),
      lastSyncedAt: new Date().toISOString(),
    };
    await writeSpecificTabs(accessToken, spreadsheetId, nextDb, ['Guru_Kelas']);
    return nextDb;
  });
}

export async function upsertPeriodInSheet(
  accessToken: string,
  spreadsheetId: string,
  incomingPeriod: AcademicPeriod
): Promise<MdaDatabase> {
  return enqueueSheetOperation(spreadsheetId, async () => {
    const currentDb = await readDatabaseFromSheet(accessToken, spreadsheetId);
    const cleanedPeriod: AcademicPeriod = {
      ...incomingPeriod,
      ttdKepalaUnitUrl: await resolveAssetForSheet(
        accessToken,
        incomingPeriod.ttdKepalaUnitUrl,
        `ttd_kepala_${incomingPeriod.id}`
      ),
      ttdMudirUrl: await resolveAssetForSheet(
        accessToken,
        incomingPeriod.ttdMudirUrl,
        `ttd_mudir_${incomingPeriod.id}`
      ),
    };
    const exists = currentDb.periods.some((p) => p.id === cleanedPeriod.id);
    let nextPeriods = exists
      ? currentDb.periods.map((p) => (p.id === cleanedPeriod.id ? cleanedPeriod : p))
      : [...currentDb.periods, cleanedPeriod];
    if (cleanedPeriod.isActive) {
      nextPeriods = nextPeriods.map((p) => ({
        ...p,
        isActive: p.id === cleanedPeriod.id,
      }));
    }
    const nextDb: MdaDatabase = {
      ...currentDb,
      periods: nextPeriods,
      lastSyncedAt: new Date().toISOString(),
    };
    await writeSpecificTabs(accessToken, spreadsheetId, nextDb, ['Master_Akademik']);
    return nextDb;
  });
}

export async function upsertPortfolioInSheet(
  accessToken: string,
  spreadsheetId: string,
  incomingProject: PortfolioProject
): Promise<MdaDatabase> {
  return enqueueSheetOperation(spreadsheetId, async () => {
    const currentDb = await readDatabaseFromSheet(accessToken, spreadsheetId);
    const mediaItems = await Promise.all(
      incomingProject.mediaItems.map(async (m, idx) => ({
        ...m,
        url: await resolveAssetForSheet(
          accessToken,
          m.url,
          `karya_${incomingProject.id}_${idx + 1}`
        ),
      }))
    );
    const cleanedProject: PortfolioProject = { ...incomingProject, mediaItems };
    const exists = currentDb.portfolios.some((p) => p.id === cleanedProject.id);
    const nextPortfolios = exists
      ? currentDb.portfolios.map((p) => (p.id === cleanedProject.id ? cleanedProject : p))
      : [...currentDb.portfolios, cleanedProject];

    const nextDb: MdaDatabase = {
      ...currentDb,
      portfolios: nextPortfolios,
      lastSyncedAt: new Date().toISOString(),
    };
    await writeSpecificTabs(accessToken, spreadsheetId, nextDb, ['Portofolio']);
    return nextDb;
  });
}

export async function deletePortfolioInSheet(
  accessToken: string,
  spreadsheetId: string,
  portfolioId: string
): Promise<MdaDatabase> {
  return enqueueSheetOperation(spreadsheetId, async () => {
    const currentDb = await readDatabaseFromSheet(accessToken, spreadsheetId);
    const nextDb: MdaDatabase = {
      ...currentDb,
      portfolios: currentDb.portfolios.filter((p) => p.id !== portfolioId),
      lastSyncedAt: new Date().toISOString(),
    };
    await writeSpecificTabs(accessToken, spreadsheetId, nextDb, ['Portofolio']);
    return nextDb;
  });
}

export async function saveTemplateConfigInSheet(
  accessToken: string,
  spreadsheetId: string,
  config: BrandingTemplateConfig
): Promise<MdaDatabase> {
  return enqueueSheetOperation(spreadsheetId, async () => {
    const currentDb = await readDatabaseFromSheet(accessToken, spreadsheetId);
    const cleanedConfig: BrandingTemplateConfig = {
      ...config,
      customLogoUrl: await resolveAssetForSheet(accessToken, config.customLogoUrl, 'mda_custom_logo'),
      coverPhotoUrl: await resolveAssetForSheet(accessToken, config.coverPhotoUrl, 'mda_cover_photo'),
    };
    const nextDb: MdaDatabase = {
      ...currentDb,
      templateConfig: cleanedConfig,
      lastSyncedAt: new Date().toISOString(),
    };
    await writeSpecificTabs(accessToken, spreadsheetId, nextDb, ['Template_Branding']);
    return nextDb;
  });
}

export async function saveUserAccessInSheet(
  accessToken: string,
  spreadsheetId: string,
  userAccessList: UserAccess[]
): Promise<MdaDatabase> {
  return enqueueSheetOperation(spreadsheetId, async () => {
    const currentDb = await readDatabaseFromSheet(accessToken, spreadsheetId);
    const nextDb: MdaDatabase = {
      ...currentDb,
      userAccess: userAccessList,
      lastSyncedAt: new Date().toISOString(),
    };
    await writeSpecificTabs(accessToken, spreadsheetId, nextDb, ['Hak_Akses']);
    return nextDb;
  });
}

// Safe non-duplicating migration from localStorage snapshot to Google Sheets
export async function mergeLocalSnapshotIntoSheet(
  accessToken: string,
  spreadsheetId: string,
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
  return enqueueSheetOperation(spreadsheetId, async () => {
    const currentDb = await readDatabaseFromSheet(accessToken, spreadsheetId);

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

    const tabsToWrite: MdaTabName[] = [];
    if (addedPeriods.length > 0 || currentDb.periods.length === 0) tabsToWrite.push('Master_Akademik');
    if (addedTeachers.length > 0 || currentDb.teachers.length === 0) tabsToWrite.push('Guru_Kelas');
    if (addedStudents.length > 0 || currentDb.students.length === 0) tabsToWrite.push('Santri');
    if (addedReports.length > 0 || currentDb.reports.length === 0) {
      tabsToWrite.push(
        'Rapor_Semester',
        'Sikap_Character',
        'Tahfidz',
        'Nilai_Diniyah',
        'Nilai_Digital'
      );
    }
    if (addedPortfolios.length > 0 || currentDb.portfolios.length === 0) tabsToWrite.push('Portofolio');
    if (addedAccess.length > 0 || currentDb.userAccess.length === 0) tabsToWrite.push('Hak_Akses');

    if (tabsToWrite.length > 0) {
      await writeSpecificTabs(accessToken, spreadsheetId, mergedDb, tabsToWrite);
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
