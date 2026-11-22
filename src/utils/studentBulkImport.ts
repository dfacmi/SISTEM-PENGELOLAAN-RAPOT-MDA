import * as XLSX from 'xlsx';
import type { Student, TeacherClass, UserAccess } from '../types/mda';
import {
  generateSmartAccessPin,
  normalizeClassName,
  slugifyName,
} from './grading';

export interface BulkStudentDraftRow {
  rowId: string;
  nisnMda: string;
  nama: string;
  kelas: string;
  marhalah: string;
  pin: string;
  statusAktif: 'Aktif' | 'Alumni' | 'Cuti';
  emailSantriOrtu?: string;
}

export const PRESET_9_MDA_PUTRI_ROWS: Array<{
  nisnMda: string;
  nama: string;
  kelas: string;
  statusAktif: 'Aktif';
  marhalah: string;
}> = [
  {
    nisnMda: 'MDA03.2627.820',
    nama: 'Anisa Nurul Azizah',
    kelas: 'MDA Putri',
    statusAktif: 'Aktif',
    marhalah: 'Marhalah Tahsin',
  },
  {
    nisnMda: 'MDA03.2627.821',
    nama: 'Mujahidah Haura Azka',
    kelas: 'MDA Putri',
    statusAktif: 'Aktif',
    marhalah: 'Marhalah Tahsin',
  },
  {
    nisnMda: 'MDA03.2627.822',
    nama: 'Nazla Putri Arifah',
    kelas: 'MDA Putri',
    statusAktif: 'Aktif',
    marhalah: 'Marhalah Tahsin',
  },
  {
    nisnMda: 'MDA03.2627.823',
    nama: 'Shifa Zakatia Az-Zahra',
    kelas: 'MDA Putri',
    statusAktif: 'Aktif',
    marhalah: 'Marhalah Tahsin',
  },
  {
    nisnMda: 'MDA03.2627.824',
    nama: 'Zaskia Ayu Susanto',
    kelas: 'MDA Putri',
    statusAktif: 'Aktif',
    marhalah: 'Marhalah Tahsin',
  },
  {
    nisnMda: 'MDA03.2627.825',
    nama: "Aime' Athifah Luthfiyah Mu'tashimah",
    kelas: 'MDA Putri',
    statusAktif: 'Aktif',
    marhalah: 'Marhalah Tahfizh',
  },
  {
    nisnMda: 'MDA03.2627.826',
    nama: 'Juliana Nur Rohmah',
    kelas: 'MDA Putri',
    statusAktif: 'Aktif',
    marhalah: 'Marhalah Tahfizh',
  },
  {
    nisnMda: 'MDA03.2627.827',
    nama: 'Marwa',
    kelas: 'MDA Putri',
    statusAktif: 'Aktif',
    marhalah: 'Marhalah Tahfizh',
  },
  {
    nisnMda: 'MDA03.2627.828',
    nama: 'Hunna Arsya Wildaana',
    kelas: 'MDA Putri',
    statusAktif: 'Aktif',
    marhalah: 'Marhalah Tahfizh',
  },
];

export function formatPreset9MdaPutriAsText(): string {
  return PRESET_9_MDA_PUTRI_ROWS.map(
    (r) =>
      `${r.nisnMda} | ${r.nama} | ${r.kelas} | ${r.marhalah} | ${generateSmartAccessPin(
        r.nama,
        r.nisnMda
      )}`
  ).join('\n');
}

function parseStatusValue(raw?: string): 'Aktif' | 'Alumni' | 'Cuti' {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'alumni') return 'Alumni';
  if (s === 'cuti') return 'Cuti';
  return 'Aktif';
}

function splitDelimitedLine(line: string): string[] {
  if (line.includes('|')) {
    return line.split('|').map((c) => c.trim());
  }
  if (line.includes('\t')) {
    return line.split('\t').map((c) => c.trim());
  }
  if (line.includes(';')) {
    return line.split(';').map((c) => c.trim());
  }
  // Simple CSV fallback respecting quoted segments
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isLikelyHeaderRow(cells: string[]): boolean {
  const joined = cells.map((c) => c.toLowerCase()).join(' ');
  const hasId = /\b(id|nis|nisn)\b/.test(joined);
  const hasNama = /\bnama\b/.test(joined);
  return hasId && hasNama;
}

export function parseBulkStudentsText(rawText: string): BulkStudentDraftRow[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) return [];

  const parsedLines = lines.map(splitDelimitedLine);
  const hasHeader = parsedLines.length > 0 && isLikelyHeaderRow(parsedLines[0]);
  const dataLines = hasHeader ? parsedLines.slice(1) : parsedLines;

  const rows: BulkStudentDraftRow[] = [];
  dataLines.forEach((cols, idx) => {
    const nisnMda = String(cols[0] || '').trim();
    const nama = String(cols[1] || '').trim();
    if (!nisnMda || !nama) return;

    const kelasRaw = String(cols[2] || '').trim();
    const kelas = normalizeClassName(kelasRaw) || 'MDA Putri';

    const col3 = String(cols[3] || '').trim();
    const col4 = String(cols[4] || '').trim();
    const col5 = String(cols[5] || '').trim();

    let marhalah = col3;
    let pin = col4;
    let statusAktif: 'Aktif' | 'Alumni' | 'Cuti' = 'Aktif';

    // Handle optional Status column if user puts Status in col 4 or col 6
    if (/^(aktif|alumni|cuti)$/i.test(col3) && !col4) {
      statusAktif = parseStatusValue(col3);
      marhalah = '';
    } else if (/^(aktif|alumni|cuti)$/i.test(col5)) {
      statusAktif = parseStatusValue(col5);
    } else if (/^(aktif|alumni|cuti)$/i.test(col4) && !col5) {
      statusAktif = parseStatusValue(col4);
      pin = '';
    }

    const resolvedPin =
      pin.replace(/\s+/g, '').toUpperCase() ||
      generateSmartAccessPin(nama, nisnMda);

    rows.push({
      rowId: `draft-${idx}-${nisnMda}`,
      nisnMda,
      nama,
      kelas,
      marhalah,
      pin: resolvedPin,
      statusAktif,
    });
  });

  return rows;
}

export async function parseBulkStudentsSpreadsheet(
  file: File
): Promise<BulkStudentDraftRow[]> {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  });

  const nonEmpty = matrix
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []))
    .filter((r) => r.some((c) => c.length > 0));

  if (nonEmpty.length === 0) return [];

  const headerRow = nonEmpty[0];
  const headerDetected = isLikelyHeaderRow(headerRow);

  let idxId = 0;
  let idxNama = 1;
  let idxKelas = 2;
  let idxMarhalah = 3;
  let idxPin = 4;
  let idxStatus = 5;
  let idxEmail = -1;

  if (headerDetected) {
    const lower = headerRow.map((h) => h.toLowerCase());
    const findCol = (patterns: RegExp[]) =>
      lower.findIndex((h) => patterns.some((p) => p.test(h)));

    const fId = findCol([/\bid\b/, /\bnis/, /\bnisn/]);
    const fNama = findCol([/\bnama/]);
    const fKelas = findCol([/\bkelas/]);
    const fMarhalah = findCol([/\bmarhalah/, /\bprogram/, /\bketerangan/]);
    const fPin = findCol([/\bpin/, /\bpassword/, /\bsandi/]);
    const fStatus = findCol([/\bstatus/]);
    const fEmail = findCol([/\bemail/]);

    if (fId !== -1) idxId = fId;
    if (fNama !== -1) idxNama = fNama;
    if (fKelas !== -1) idxKelas = fKelas;
    if (fMarhalah !== -1) idxMarhalah = fMarhalah;
    if (fPin !== -1) idxPin = fPin;
    if (fStatus !== -1) idxStatus = fStatus;
    if (fEmail !== -1) idxEmail = fEmail;
  }

  const dataRows = headerDetected ? nonEmpty.slice(1) : nonEmpty;
  const rows: BulkStudentDraftRow[] = [];

  dataRows.forEach((cols, i) => {
    const nisnMda = String(cols[idxId] || '').trim();
    const nama = String(cols[idxNama] || '').trim();
    if (!nisnMda || !nama) return;

    const kelas = normalizeClassName(String(cols[idxKelas] || '')) || 'MDA Putri';
    const marhalah = idxMarhalah >= 0 ? String(cols[idxMarhalah] || '').trim() : '';
    const rawPin = idxPin >= 0 ? String(cols[idxPin] || '').trim() : '';
    const pin =
      rawPin.replace(/\s+/g, '').toUpperCase() ||
      generateSmartAccessPin(nama, nisnMda);
    const statusAktif =
      idxStatus >= 0 ? parseStatusValue(String(cols[idxStatus] || '')) : 'Aktif';
    const emailSantriOrtu =
      idxEmail >= 0 ? String(cols[idxEmail] || '').trim() : '';

    rows.push({
      rowId: `xlsx-${i}-${nisnMda}`,
      nisnMda,
      nama,
      kelas,
      marhalah,
      pin,
      statusAktif,
      emailSantriOrtu: emailSantriOrtu || undefined,
    });
  });

  return rows;
}

export function downloadStudentImportTemplateXlsx() {
  const sheetData = [
    ['ID Santri', 'Nama Lengkap', 'Kelas', 'Marhalah / Program', 'PIN (Opsional)', 'Status'],
    ...PRESET_9_MDA_PUTRI_ROWS.map((r) => [
      r.nisnMda,
      r.nama,
      r.kelas,
      r.marhalah,
      generateSmartAccessPin(r.nama, r.nisnMda),
      r.statusAktif,
    ]),
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 18 },
    { wch: 36 },
    { wch: 14 },
    { wch: 22 },
    { wch: 16 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Template_Santri');
  XLSX.writeFile(wb, 'Template_Import_Santri_MDA.xlsx');
}

export function buildStudentsAndAccessFromDrafts(
  drafts: BulkStudentDraftRow[],
  existingStudents: Student[],
  defaultWali?: TeacherClass
): {
  students: Student[];
  userAccess: UserAccess[];
  existingMatchIds: Set<string>;
} {
  const existingByNisn = new Map<string, Student>();
  existingStudents.forEach((s) => {
    const key = s.nisnMda.trim().toLowerCase();
    if (key) existingByNisn.set(key, s);
  });

  const existingMatchIds = new Set<string>();
  const students: Student[] = [];
  const userAccess: UserAccess[] = [];
  const seenNisnInBatch = new Set<string>();

  drafts.forEach((row) => {
    const nisnMda = row.nisnMda.trim();
    const nama = row.nama.trim();
    if (!nisnMda || !nama) return;

    const nisnKey = nisnMda.toLowerCase();
    if (seenNisnInBatch.has(nisnKey)) return;
    seenNisnInBatch.add(nisnKey);

    const existing = existingByNisn.get(nisnKey);
    if (existing) {
      existingMatchIds.add(nisnKey);
    }

    const kelas = normalizeClassName(row.kelas) || 'MDA Putri';
    const studentId =
      existing?.id || `std-${nisnMda.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const pin =
      row.pin.trim().toUpperCase() || generateSmartAccessPin(nama, nisnMda);
    const program =
      row.marhalah.trim() ||
      `Muslim Digital Academy – ${kelas.replace(/^MDA\s+/i, '')}`;
    const email =
      row.emailSantriOrtu?.trim() ||
      existing?.emailSantriOrtu ||
      `${nisnMda.toLowerCase().replace(/[^a-z0-9.]+/g, '')}@santri.mda.sch.id`;

    students.push({
      id: studentId,
      nisnMda,
      nama,
      kelas,
      program,
      waliKelasId: existing?.waliKelasId || defaultWali?.id || '',
      waliKelasNama: existing?.waliKelasNama || defaultWali?.nama || '',
      fotoUrl: existing?.fotoUrl || '',
      emailSantriOrtu: email,
      portfolioSlug: existing?.portfolioSlug || slugifyName(nama) || studentId,
      accessPin: pin,
      statusAktif: row.statusAktif || 'Aktif',
    });

    userAccess.push({
      id: `usr-${studentId}`,
      email,
      nama,
      role: 'santri_ortu',
      linkedStudentId: studentId,
      accessPin: pin,
      statusAktif: (row.statusAktif || 'Aktif') === 'Aktif',
    });
  });

  return { students, userAccess, existingMatchIds };
}
