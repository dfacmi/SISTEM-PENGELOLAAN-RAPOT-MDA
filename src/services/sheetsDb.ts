import { DEFAULT_TEMPLATE_CONFIG } from '../data/seedData';
import {
  AcademicPeriod,
  BrandingTemplateConfig,
  MdaDatabase,
  PortfolioProject,
  SemesterReport,
  Student,
  TeacherClass,
  UserAccess,
} from '../types/mda';
import { generateSmartAccessPin } from '../utils/grading';
import { shrinkDataUrlForSheet } from '../utils/imageHelper';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
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

export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  return trimmed;
}

async function fetchJson(url: string, accessToken: string, options: RequestInit = {}) {
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
      const errJson = await res.json();
      errText = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      errText = await res.text();
    }
    throw new Error(`Google API Error (${res.status}): ${errText}`);
  }
  return res.json();
}

export async function getSpreadsheetMetadata(accessToken: string, spreadsheetId: string) {
  return fetchJson(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)`,
    accessToken
  );
}

// Enforce Google Sheets' strict 50,000-character-per-cell limit
function clampCell(value: string | number | boolean): string | number | boolean {
  if (typeof value !== 'string') return value;
  if (value.length <= MAX_SHEETS_CELL_CHARS) return value;
  if (value.startsWith('data:')) {
    // Never write a truncated/broken base64 blob into a cell
    return '';
  }
  return value.slice(0, MAX_SHEETS_CELL_CHARS);
}

function clampRows(rows: (string | number | boolean)[][]): (string | number | boolean)[][] {
  return rows.map((row) => row.map(clampCell));
}

function dataUrlToFile(dataUrl: string, baseName: string): File | null {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1];
    const b64 = match[2];
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const ext = mime.split('/')[1]?.split('+')[0] || 'png';
    return new File([bytes], `${baseName}.${ext}`, { type: mime });
  } catch {
    return null;
  }
}

async function resolveAssetForSheet(
  accessToken: string,
  url: string,
  label: string
): Promise<string> {
  if (!url || !url.startsWith('data:')) return url;
  // Offload base64 images/assets (>20k chars) to Google Drive so Google Sheets holds clean short URLs
  if (url.length > 20000) {
    const file = dataUrlToFile(url, label);
    if (file) {
      try {
        const uploaded = await uploadFileToDrive(accessToken, file);
        if (uploaded?.url) return uploaded.url;
      } catch (err) {
        console.warn(`Upload Drive otomatis untuk ${label} dilewati:`, err);
      }
    }
    const shrunk = await shrinkDataUrlForSheet(url, 42000);
    return shrunk;
  }
  return url;
}

export async function prepareDbForSheets(
  accessToken: string,
  db: MdaDatabase
): Promise<MdaDatabase> {
  const students = await Promise.all(
    db.students.map(async (s) => ({
      ...s,
      fotoUrl: await resolveAssetForSheet(
        accessToken,
        s.fotoUrl,
        `foto_${s.id}`
      ),
    }))
  );

  const portfolios = await Promise.all(
    db.portfolios.map(async (p) => {
      const mediaItems = await Promise.all(
        p.mediaItems.map(async (m, idx) => ({
          ...m,
          url: await resolveAssetForSheet(
            accessToken,
            m.url,
            `karya_${p.id}_${idx + 1}`
          ),
        }))
      );
      return { ...p, mediaItems };
    })
  );

  let templateConfig = db.templateConfig;
  if (templateConfig) {
    templateConfig = {
      ...templateConfig,
      customLogoUrl: await resolveAssetForSheet(
        accessToken,
        templateConfig.customLogoUrl,
        'mda_custom_logo'
      ),
      coverPhotoUrl: await resolveAssetForSheet(
        accessToken,
        templateConfig.coverPhotoUrl,
        'mda_cover_photo'
      ),
    };
  }

  const teachers = await Promise.all(
    db.teachers.map(async (t) => ({
      ...t,
      ttdUrl: await resolveAssetForSheet(accessToken, t.ttdUrl || '', `ttd_guru_${t.id}`),
    }))
  );

  const periods = await Promise.all(
    db.periods.map(async (p) => ({
      ...p,
      ttdKepalaUnitUrl: await resolveAssetForSheet(
        accessToken,
        p.ttdKepalaUnitUrl || '',
        `ttd_kepala_${p.id}`
      ),
      ttdMudirUrl: await resolveAssetForSheet(
        accessToken,
        p.ttdMudirUrl || '',
        `ttd_mudir_${p.id}`
      ),
    }))
  );

  return {
    ...db,
    periods,
    teachers,
    students,
    portfolios,
    templateConfig,
  };
}

// Serialize database collections to 2D sheet arrays
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
      'Ringkasan_Portofolio',
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
      r.ringkasanPortofolio || '',
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

export async function createMdaSpreadsheet(
  accessToken: string,
  initialDb: MdaDatabase,
  title = 'Database Rapor & Portofolio MDA - Darul Fithrah'
): Promise<{
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  syncedDb: MdaDatabase;
}> {
  const preparedDb = await prepareDbForSheets(accessToken, initialDb);

  const created = await fetchJson(SHEETS_API_BASE, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: MDA_SHEET_TABS.map((tabName) => ({
        properties: {
          title: tabName,
          gridProperties: { frozenRowCount: 1 },
        },
      })),
    }),
  });

  const spreadsheetId = created.spreadsheetId as string;
  const spreadsheetUrl = created.spreadsheetUrl as string;

  const syncedDb = await syncDatabaseToSheet(accessToken, spreadsheetId, preparedDb);

  // Format header rows on each sheet cleanly (dark slate #162328 with white bold text)
  try {
    const sheetsMeta = created.sheets || [];
    const requests = sheetsMeta.map((s: any) => ({
      repeatCell: {
        range: {
          sheetId: s.properties.sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.086, green: 0.137, blue: 0.157 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    }));
    if (requests.length > 0) {
      await fetchJson(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, accessToken, {
        method: 'POST',
        body: JSON.stringify({ requests }),
      });
    }
  } catch (err) {
    console.warn('Header formatting skipped:', err);
  }

  return { spreadsheetId, spreadsheetUrl, title, syncedDb };
}

export async function ensureMdaTabs(
  accessToken: string,
  spreadsheetId: string,
  seedDb: MdaDatabase
) {
  const meta = await getSpreadsheetMetadata(accessToken, spreadsheetId);
  const existingTitles = new Set<string>(
    (meta.sheets || []).map((s: any) => s.properties?.title as string)
  );

  const missingTabs = MDA_SHEET_TABS.filter((tab) => !existingTitles.has(tab));
  if (missingTabs.length > 0) {
    await fetchJson(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        requests: missingTabs.map((title) => ({
          addSheet: {
            properties: { title, gridProperties: { frozenRowCount: 1 } },
          },
        })),
      }),
    });

    // Write headers for newly created tabs
    const serialized = serializeDbToTabs(seedDb);
    const data = missingTabs.map((tab) => ({
      range: `'${tab}'!A1`,
      values: serialized[tab],
    }));

    await fetchJson(`${SHEETS_API_BASE}/${spreadsheetId}/values:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data,
      }),
    });
  }

  return meta;
}

export async function syncDatabaseToSheet(
  accessToken: string,
  spreadsheetId: string,
  db: MdaDatabase
): Promise<MdaDatabase> {
  const preparedDb = await prepareDbForSheets(accessToken, db);
  const serialized = serializeDbToTabs(preparedDb);

  // Clear all MDA tabs first
  await fetchJson(`${SHEETS_API_BASE}/${spreadsheetId}/values:batchClear`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      ranges: MDA_SHEET_TABS.map((tab) => `'${tab}'!A:AZ`),
    }),
  });

  // Write all tabs atomically
  await fetchJson(`${SHEETS_API_BASE}/${spreadsheetId}/values:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: MDA_SHEET_TABS.map((tab) => ({
        range: `'${tab}'!A1`,
        values: serialized[tab],
      })),
    }),
  });

  return preparedDb;
}

export async function loadDatabaseFromSheet(
  accessToken: string,
  spreadsheetId: string,
  fallbackDb: MdaDatabase
): Promise<MdaDatabase> {
  const meta = await ensureMdaTabs(accessToken, spreadsheetId, fallbackDb);

  const rangesQuery = MDA_SHEET_TABS.map(
    (tab) => `ranges=${encodeURIComponent(`'${tab}'!A1:AZ2000`)}`
  ).join('&');

  const batchRes = await fetchJson(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${rangesQuery}`,
    accessToken
  );

  const valueRanges: any[] = batchRes.valueRanges || [];
  const tabMap: Record<string, string[][]> = {};
  MDA_SHEET_TABS.forEach((tab, idx) => {
    tabMap[tab] = (valueRanges[idx]?.values as string[][]) || [];
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
      tanggalRapor: String(r[3] || '19 Desember 2026'),
      kkmDiniyah: Number(r[4] || 60),
      kkmTahfidz: Number(r[5] || 70),
      kkmDigital: Number(r[6] || 70),
      kepalaUnitMda: String(r[7] || 'Ustadz Azmuhu Syahid, S. Pd'),
      mudirPesantren: String(r[8] || 'Ustadz Yahya Setiyawan, S. Pd.I, M. Pd'),
      isActive: String(r[9]).toUpperCase() === 'YA',
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
        kelas: String(r[3] || 'MDA Senior'),
        program: String(r[4] || 'Muslim Digital Academy – Senior'),
        waliKelasId: String(r[5] || ''),
        waliKelasNama: String(r[6] || ''),
        fotoUrl: String(r[7] || ''),
        emailSantriOrtu: String(r[8] || ''),
        portfolioSlug: String(r[9] || r[0]),
        statusAktif: (r[10] === 'Alumni' || r[10] === 'Cuti' ? r[10] : 'Aktif') as
          | 'Aktif'
          | 'Alumni'
          | 'Cuti',
        accessPin: String(r[11] || generateSmartAccessPin(nama, nisnMda)),
      };
    });

  // Index sub-tables by ID_Rapor
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
          predikat: (['A', 'B', 'C', 'D'].includes(String(s[3])) ? s[3] : 'B') as
            | 'A'
            | 'B'
            | 'C'
            | 'D',
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
          predikat: (['A', 'B', 'C', 'D'].includes(String(d[6])) ? d[6] : 'C') as
            | 'A'
            | 'B'
            | 'C'
            | 'D',
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
          predikat: (['A', 'B', 'C', 'D'].includes(String(d[7])) ? d[7] : 'C') as
            | 'A'
            | 'B'
            | 'C'
            | 'D',
        }));

      return {
        id: reportId,
        studentId: String(r[1] || ''),
        tahunAkademik: String(r[2] || '2026/2027'),
        semester: (r[3] === 'Genap' ? 'Genap' : 'Gasal') as 'Gasal' | 'Genap',
        tanggalRapor: String(r[4] || '19 Desember 2026'),
        pilar: {
          penguasaanMultimedia: Number(r[5] || 0),
          diniyahPembelajaran: Number(r[6] || 0),
          tahfidzulQuran: Number(r[7] || 0),
          kesantrianKeasramaan: Number(r[8] || 0),
          characterBuilding: Number(r[9] || 0),
          autoCalculate: String(r[10]).toUpperCase() === 'YA',
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
        keputusanSemester: (r[24] || 'Lanjut ke semester genap') as any,
        keputusanLainnya: String(r[25] || ''),
        published: String(r[26]).toUpperCase() === 'YA',
        updatedAt: String(r[27] || new Date().toISOString()),
        ringkasanPortofolio: String(r[28] || ''),
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
              predikat: (['A', 'B', 'C', 'D'].includes(String(tRow[11]))
                ? tRow[11]
                : 'B') as 'A' | 'B' | 'C' | 'D',
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
          presetArt: (r[14] as any) || 'poster',
        },
        {
          url: String(r[15] || ''),
          type: (r[16] === 'video' ? 'video' : 'image') as 'image' | 'video',
          caption: String(r[17] || ''),
          presetArt: (r[18] as any) || 'uiux',
        },
        {
          url: String(r[19] || ''),
          type: (r[20] === 'video' ? 'video' : 'image') as 'image' | 'video',
          caption: String(r[21] || ''),
          presetArt: (r[22] as any) || 'photo',
        },
      ],
      featured: String(r[23]).toUpperCase() === 'YA',
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
      statusAktif: String(r[5]).toUpperCase() !== 'TIDAK',
    }));

  const tplRows = parseRows('Template_Branding');
  const templateConfig: BrandingTemplateConfig = {
    ...(fallbackDb.templateConfig || DEFAULT_TEMPLATE_CONFIG),
  };
  tplRows.forEach((r) => {
    const key = String(r[0] || '') as keyof BrandingTemplateConfig;
    if (key in templateConfig && r[1] !== undefined) {
      (templateConfig as any)[key] = String(r[1]);
    }
  });

  return {
    periods: periods.length > 0 ? periods : fallbackDb.periods,
    teachers: teachers.length > 0 ? teachers : fallbackDb.teachers,
    students: students.length > 0 ? students : fallbackDb.students,
    reports: reports.length > 0 ? reports : fallbackDb.reports,
    portfolios: portfolios.length > 0 ? portfolios : fallbackDb.portfolios,
    userAccess: userAccess.length > 0 ? userAccess : fallbackDb.userAccess,
    templateConfig,
    spreadsheetId,
    spreadsheetUrl: meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    spreadsheetTitle: meta.properties?.title || 'Google Spreadsheet MDA',
    lastSyncedAt: new Date().toISOString(),
  };
}

export async function uploadFileToDrive(
  accessToken: string,
  file: File
): Promise<{ fileId: string; url: string; mimeType: string }> {
  const metadata = {
    name: `MDA_${Date.now()}_${file.name}`,
    mimeType: file.type || 'application/octet-stream',
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const uploadRes = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    }
  );

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Gagal mengunggah ke Google Drive: ${text}`);
  }

  const fileData = await uploadRes.json();
  const fileId = fileData.id as string;

  // Set public read-only link sharing so portfolio QR links can view the asset
  await fetch(`${DRIVE_API_BASE}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: 'reader',
      type: 'anyone',
    }),
  });

  const isVideo = (file.type || '').startsWith('video/');
  const url = isVideo
    ? `https://drive.google.com/file/d/${fileId}/preview`
    : `https://lh3.googleusercontent.com/d/${fileId}`;

  return { fileId, url, mimeType: file.type };
}

export function exportDatabaseBackupJson(db: MdaDatabase) {
  const payload = JSON.stringify(db, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MDA_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportTabCsv(db: MdaDatabase, tabName: MdaTabName) {
  const tabs = serializeDbToTabs(db);
  const rows = tabs[tabName];
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const str = String(cell ?? '').replace(/"/g, '""');
          return `"${str}"`;
        })
        .join(',')
    )
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MDA_${tabName}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
