import {
  DiniyahSubject,
  DigitalSkillSubject,
  GradeWeights,
  PillarSummary,
  PortfolioMediaItem,
  PortfolioProject,
  Predikat,
  SemesterReport,
  Student,
  TahfidzAssessment,
  TeacherClass,
} from '../types/mda';

export const DEFAULT_GRADE_WEIGHTS: GradeWeights = {
  sk: 25,
  tg: 25,
  ul: 25,
  uas: 25,
};

export interface KkmPredicateBounds {
  kkm: number;
  minC: number;
  minB: number;
  minA: number;
}

export function getKkmPredicateBounds(kkm = 70): KkmPredicateBounds {
  const safeKkm = Math.max(1, Math.min(97, Math.round(Number(kkm) || 70)));
  const interval = (100 - safeKkm) / 3;
  const minB = Math.round(safeKkm + interval);
  const minA = Math.round(safeKkm + 2 * interval);
  return {
    kkm: safeKkm,
    minC: safeKkm,
    minB,
    minA,
  };
}

export function hitungPredikatByKkm(nilai: number, kkm = 70): Predikat {
  const val = Number(nilai || 0);
  const { minC, minB, minA } = getKkmPredicateBounds(kkm);
  if (val >= minA) return 'A';
  if (val >= minB) return 'B';
  if (val >= minC) return 'C';
  return 'D';
}

export function hitungPredikat(nilai: number, kkm = 70): Predikat {
  return hitungPredikatByKkm(nilai, kkm);
}

export function isValidScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

export function parseScoreInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const num = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(num)) return undefined;
  return clampScore(num);
}

export interface ComponentScoreInput {
  sk?: number;
  tg?: number;
  ul?: number;
  uas?: number;
}

export function hasSubjectComponents(subject: ComponentScoreInput): boolean {
  return (
    isValidScore(subject.sk) ||
    isValidScore(subject.tg) ||
    isValidScore(subject.ul) ||
    isValidScore(subject.uas)
  );
}

export function hitungNrFromComponents(
  subject: ComponentScoreInput,
  weights: GradeWeights = DEFAULT_GRADE_WEIGHTS
): number | null {
  const entries: Array<{ value: number; weight: number }> = [];
  if (isValidScore(subject.sk)) {
    entries.push({ value: clampScore(subject.sk), weight: Math.max(0, Number(weights.sk) || 0) });
  }
  if (isValidScore(subject.tg)) {
    entries.push({ value: clampScore(subject.tg), weight: Math.max(0, Number(weights.tg) || 0) });
  }
  if (isValidScore(subject.ul)) {
    entries.push({ value: clampScore(subject.ul), weight: Math.max(0, Number(weights.ul) || 0) });
  }
  if (isValidScore(subject.uas)) {
    entries.push({ value: clampScore(subject.uas), weight: Math.max(0, Number(weights.uas) || 0) });
  }

  if (entries.length === 0) return null;

  const totalWeight = entries.reduce((acc, item) => acc + item.weight, 0);
  if (totalWeight <= 0) {
    const avg = entries.reduce((acc, item) => acc + item.value, 0) / entries.length;
    return Math.round(avg * 100) / 100;
  }

  const weightedSum = entries.reduce((acc, item) => acc + item.value * item.weight, 0);
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

export function hitungPengetahuanFromComponents(
  subject: ComponentScoreInput,
  weights: GradeWeights = DEFAULT_GRADE_WEIGHTS
): number | null {
  const entries: Array<{ value: number; weight: number }> = [];
  if (isValidScore(subject.sk)) {
    entries.push({ value: clampScore(subject.sk), weight: Math.max(0, Number(weights.sk) || 0) });
  }
  if (isValidScore(subject.tg)) {
    entries.push({ value: clampScore(subject.tg), weight: Math.max(0, Number(weights.tg) || 0) });
  }
  if (isValidScore(subject.uas)) {
    entries.push({ value: clampScore(subject.uas), weight: Math.max(0, Number(weights.uas) || 0) });
  }

  if (entries.length === 0) return null;

  const totalWeight = entries.reduce((acc, item) => acc + item.weight, 0);
  if (totalWeight <= 0) {
    const avg = entries.reduce((acc, item) => acc + item.value, 0) / entries.length;
    return Math.round(avg * 100) / 100;
  }

  const weightedSum = entries.reduce((acc, item) => acc + item.value * item.weight, 0);
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

export function syncDiniyahSubjectWithComponents(
  d: DiniyahSubject,
  weights: GradeWeights = DEFAULT_GRADE_WEIGHTS,
  fallbackKkm = 60
): DiniyahSubject {
  const kkm = Number(d.kkm || fallbackKkm || 60);
  if (hasSubjectComponents(d)) {
    const nr = hitungNrFromComponents(d, weights);
    const nilai = nr !== null ? nr : Number(d.nilai || 0);
    return {
      ...d,
      kkm,
      nilai,
      predikat: hitungPredikatByKkm(nilai, kkm),
    };
  }
  const nilai = Number(d.nilai || 0);
  return {
    ...d,
    kkm,
    nilai,
    predikat: hitungPredikatByKkm(nilai, kkm),
  };
}

export function syncDigitalSkillWithComponents(
  s: DigitalSkillSubject,
  weights: GradeWeights = DEFAULT_GRADE_WEIGHTS,
  fallbackKkm = 70
): DigitalSkillSubject {
  const kkm = Number(s.kkm || fallbackKkm || 70);
  if (hasSubjectComponents(s)) {
    const pengetahuan =
      hitungPengetahuanFromComponents(s, weights) ?? Number(s.pengetahuan || 0);
    const keterampilan = isValidScore(s.ul)
      ? clampScore(s.ul)
      : Number(s.keterampilan || 0);
    const nr =
      hitungNrFromComponents(s, weights) ??
      hitungNilaiAkhirSkill(pengetahuan, keterampilan);
    return {
      ...s,
      kkm,
      pengetahuan,
      keterampilan,
      nilaiAkhir: nr,
      predikat: hitungPredikatByKkm(nr, kkm),
    };
  }
  const nilaiAkhir = hitungNilaiAkhirSkill(s.pengetahuan, s.keterampilan);
  return {
    ...s,
    kkm,
    nilaiAkhir,
    predikat: hitungPredikatByKkm(nilaiAkhir, kkm),
  };
}

export function normalizeClassName(raw?: string): string {
  const cleaned = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((word) => {
      if (/^mda$/i.test(word)) return 'MDA';
      if (/^(it|cbt|xii|xi|ix|viii|vii|vi|iv|iii|ii)$/i.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

export interface ClassFilterOption {
  name: string;
  key: string;
  count: number;
}

export const DEFAULT_CLASS_PRESETS = [
  'MDA Junior',
  'MDA Senior',
  'MDA Putri',
] as const;

const CLASS_ORDER_PRIORITY = ['mda junior', 'mda senior', 'mda putri'];

export function extractUniqueClasses(
  students: Student[],
  teachers: TeacherClass[] = []
): ClassFilterOption[] {
  const map = new Map<string, { name: string; count: number }>();

  // Always seed the 3 built-in MDA class options so they appear even at (0 Santri)
  DEFAULT_CLASS_PRESETS.forEach((preset) => {
    map.set(preset.toLowerCase(), { name: preset, count: 0 });
  });

  students.forEach((s) => {
    const normalized = normalizeClassName(s.kelas);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, { name: normalized, count: 1 });
    }
  });

  teachers.forEach((t) => {
    const normalized = normalizeClassName(t.kelasDiampu);
    if (
      !normalized ||
      /^semua\s*kelas$/i.test(normalized) ||
      /^mda\s*junior\s*&\s*senior$/i.test(normalized)
    ) {
      return;
    }
    const key = normalized.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { name: normalized, count: 0 });
    }
  });

  return Array.from(map.entries())
    .map(([key, val]) => ({ key, name: val.name, count: val.count }))
    .sort((a, b) => {
      const idxA = CLASS_ORDER_PRIORITY.indexOf(a.key);
      const idxB = CLASS_ORDER_PRIORITY.indexOf(b.key);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.name.localeCompare(b.name, 'id');
    });
}

export function matchesClassFilter(
  studentKelas: string,
  selectedClassFilter: string
): boolean {
  if (!selectedClassFilter || selectedClassFilter === 'ALL') return true;
  return (
    normalizeClassName(studentKelas).toLowerCase() ===
    normalizeClassName(selectedClassFilter).toLowerCase()
  );
}

export function getKategoriPredikat(predikat: Predikat): string {
  switch (predikat) {
    case 'A':
      return 'Sangat Baik';
    case 'B':
      return 'Baik';
    case 'C':
      return 'Cukup';
    case 'D':
      return 'Perlu Bimbingan';
  }
}

export function predikatToScore(predikat: Predikat): number {
  switch (predikat) {
    case 'A':
      return 94;
    case 'B':
      return 84;
    case 'C':
      return 74;
    case 'D':
      return 62;
  }
}

export function hitungNilaiAkhirSkill(pengetahuan: number, keterampilan: number): number {
  const avg = (Number(pengetahuan || 0) + Number(keterampilan || 0)) / 2;
  return Math.round(avg * 100) / 100;
}

export function hitungNilaiAkhirTahfidz(
  kelancaran: number,
  tajwid: number,
  makhrajFashahah: number,
  ketepatanAyat: number
): number {
  const sum =
    Number(kelancaran || 0) +
    Number(tajwid || 0) +
    Number(makhrajFashahah || 0) +
    Number(ketepatanAyat || 0);
  return Math.round((sum / 4) * 100) / 100;
}

export function hitungRataRataDiniyah(items: DiniyahSubject[]): number {
  const active = items.filter((d) => d.mataPelajaran.trim() !== '' && d.nilai > 0);
  if (active.length === 0) return 0;
  const total = active.reduce((acc, cur) => acc + Number(cur.nilai || 0), 0);
  return Math.round((total / active.length) * 100) / 100;
}

export function hitungRataRataDigital(items: DigitalSkillSubject[]): number {
  const active = items.filter(
    (d) =>
      d.materiSkill.trim() !== '' &&
      d.materiSkill.trim() !== '...............' &&
      (d.pengetahuan > 0 || d.keterampilan > 0 || d.nilaiAkhir > 0)
  );
  if (active.length === 0) return 0;
  const total = active.reduce((acc, cur) => acc + Number(cur.nilaiAkhir || 0), 0);
  return Math.round((total / active.length) * 100) / 100;
}

export function hitungPilarOtomatis(report: SemesterReport): PillarSummary {
  const avgDigital = hitungRataRataDigital(report.skillDigital);
  const avgDiniyah = hitungRataRataDiniyah(report.diniyah);
  const nilaiTahfidz = report.tahfidz.nilaiAkhir;

  const sikapScores = report.sikap.map((s) => predikatToScore(s.predikat));
  const avgSikap =
    sikapScores.length > 0
      ? sikapScores.reduce((a, b) => a + b, 0) / sikapScores.length
      : 75;

  const totalAbsen =
    Number(report.kehadiran.sakit || 0) +
    Number(report.kehadiran.izin || 0) +
    Number(report.kehadiran.alpa || 0) * 3;
  const kesantrianScore = Math.max(50, Math.min(100, Math.round(avgSikap - totalAbsen * 2)));

  const programActiveCount = report.characterPrograms.filter(
    (p) =>
      p.keterangan.trim() !== '' &&
      !p.keterangan.toLowerCase().includes('belum') &&
      !p.keterangan.startsWith('[')
  ).length;
  const characterScore = Math.min(
    100,
    Math.round(avgSikap * 0.7 + (programActiveCount / 8) * 30)
  );

  return {
    penguasaanMultimedia: Math.round(avgDigital || report.pilar.penguasaanMultimedia),
    diniyahPembelajaran: Math.round(avgDiniyah || report.pilar.diniyahPembelajaran),
    tahfidzulQuran: Math.round(nilaiTahfidz || report.pilar.tahfidzulQuran),
    kesantrianKeasramaan: Math.round(kesantrianScore),
    characterBuilding: Math.round(characterScore),
    autoCalculate: report.pilar.autoCalculate,
  };
}

export function recalculateReport(
  report: SemesterReport,
  weights: GradeWeights = DEFAULT_GRADE_WEIGHTS,
  kkmOverrides?: { kkmDiniyah?: number; kkmTahfidz?: number; kkmDigital?: number }
): SemesterReport {
  const t: TahfidzAssessment = { ...report.tahfidz };
  t.nilaiAkhir = hitungNilaiAkhirTahfidz(
    t.kelancaran,
    t.tajwid,
    t.makhrajFashahah,
    t.ketepatanAyat
  );
  t.predikat = hitungPredikatByKkm(t.nilaiAkhir, kkmOverrides?.kkmTahfidz || 70);

  const diniyah = report.diniyah.map((d) =>
    syncDiniyahSubjectWithComponents(d, weights, kkmOverrides?.kkmDiniyah || 60)
  );

  const skillDigital = report.skillDigital.map((s) =>
    syncDigitalSkillWithComponents(s, weights, kkmOverrides?.kkmDigital || 70)
  );

  const updated: SemesterReport = {
    ...report,
    tahfidz: t,
    diniyah,
    skillDigital,
  };

  if (report.pilar.autoCalculate) {
    updated.pilar = hitungPilarOtomatis(updated);
  }

  return updated;
}

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function getPortfolioUrl(slug: string, spreadsheetId?: string): string {
  const trimmed = (slug || '').trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  if (typeof window === 'undefined') return `/?portfolio=${trimmed}`;
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('portfolio', trimmed);
  if (spreadsheetId) {
    url.searchParams.set('sheet', spreadsheetId);
  }
  return url.toString();
}

export function normalizeExternalUrl(raw?: string | null): string {
  const clean = (raw || '').replace(/[\r\n\t]+/g, '').trim();
  if (!clean || clean === '#' || /^(javascript|data|vbscript):/i.test(clean)) {
    return '';
  }
  if (/^https?:\/\//i.test(clean)) {
    return clean;
  }
  if (clean.startsWith('//')) {
    return `https:${clean}`;
  }
  if (clean.startsWith('/') && typeof window !== 'undefined') {
    return new URL(clean, window.location.origin).toString();
  }
  return `https://${clean}`;
}

export interface ResolvedPortfolioLinks {
  sidangUrl: string;
  behanceUrl: string;
  pdfUrl: string;
  pdfSubject: string;
}

export function getStudentPortfolioLinks(
  student: {
    portfolioSlug: string;
    behanceUrl?: string;
    portfolioPdfUrl?: string;
    portfolioPdfSubject?: string;
  },
  spreadsheetId?: string
): ResolvedPortfolioLinks {
  const sidangUrl = normalizeExternalUrl(
    getPortfolioUrl(student.portfolioSlug, spreadsheetId)
  );
  const explicitBehance = normalizeExternalUrl(student.behanceUrl);
  const rawSlug = (student.portfolioSlug || '').trim();
  const legacyExternalSlug =
    /^https?:\/\//i.test(rawSlug) && !/[?&]portfolio=/i.test(rawSlug)
      ? normalizeExternalUrl(rawSlug)
      : '';
  const behanceUrl = explicitBehance || legacyExternalSlug;
  const pdfUrl = normalizeExternalUrl(student.portfolioPdfUrl);
  const pdfSubject = (student.portfolioPdfSubject || '').trim();
  return {
    sidangUrl,
    behanceUrl,
    pdfUrl,
    pdfSubject,
  };
}

export function generateSmartAccessPin(
  nama: string,
  nomorIdentitas: string,
  fallbackDigits = '001'
): string {
  const cleanedTokens = nama
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

export function resolveTanggalRapor(
  tanggalRapor?: string,
  semester?: 'Gasal' | 'Genap' | string,
  tahunAkademik?: string
): string {
  const raw = (tanggalRapor || '').trim();
  const isStaleJune2027 = /^(20|27)\s+Juni\s+2027$/i.test(raw);
  if (!raw) {
    return semester === 'Genap' ? '20 Juni 2026' : '19 Desember 2026';
  }
  if (/^27\s+Juni\s+2027$/i.test(raw)) {
    return '19 Desember 2026';
  }
  if (
    isStaleJune2027 &&
    (!semester || semester === 'Gasal') &&
    (!tahunAkademik || tahunAkademik === '2026/2027')
  ) {
    return '19 Desember 2026';
  }
  return raw;
}

function joinIndonesianList(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} dan ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, serta ${parts[parts.length - 1]}`;
}

function mapSkillToParentCompetence(materiSkill: string): string {
  const s = materiSkill.trim();
  if (!s || s === '...............') return '';
  if (/graphic\s*design|desain\s*grafis|poster/i.test(s)) {
    return 'merancang poster dakwah dan desain grafis secara mandiri';
  }
  if (/ui\s*\/?\s*ux|antarmuka|interface/i.test(s)) {
    return 'menyusun tampilan aplikasi mobile dan website yang rapi (UI/UX)';
  }
  if (/prototype|prototipe|figma/i.test(s)) {
    return 'membuat simulasi alur aplikasi interaktif sebelum diproduksi';
  }
  if (/canva|affinity|ilustrasi/i.test(s)) {
    return 'mengolah materi visual dakwah dengan aplikasi desain kreatif';
  }
  if (/photo|fotografi/i.test(s)) {
    return 'mengambil dan mengedit foto dokumentasi maupun publikasi';
  }
  if (/video|videografi|motion|editing/i.test(s)) {
    return 'memproduksi dan mengedit konten video dakwah yang menarik';
  }
  if (/web|coding|html|react|frontend/i.test(s)) {
    return 'membangun halaman web sederhana secara terstruktur';
  }
  return `menguasai dasar praktik ${s}`;
}

export function generateParentPortfolioNarrative(params: {
  report?: SemesterReport | null;
  projects?: Array<{ judul?: string; jenis?: string; mediaItems?: Array<{ url?: string }> }>;
}): string {
  const { report, projects = [] } = params;
  const kpi = report?.kpiMda;

  const konten = Number(kpi?.produksiKontenCount || 0);
  const multimedia = Number(kpi?.multimediaProjectCount || 0);
  const mengajar = Number(kpi?.mdaMengajarCount || 0);
  const cb = Number(kpi?.characterBuildingCount || 0);
  const client = Number(kpi?.clientProjectCount || 0);
  const income = Number(kpi?.incomeRp || 0);

  const mainActivities: string[] = [];
  if (konten > 0) {
    mainActivities.push(`menghasilkan ${konten} karya/konten dakwah digital`);
  }
  if (multimedia > 0) {
    mainActivities.push(`menyelesaikan ${multimedia} proyek multimedia`);
  }
  if (mengajar > 0) {
    mainActivities.push(`dipercaya ${mengajar} kali mengajar dan berbagi ilmu kepada sesama santri`);
  }
  if (cb > 0) {
    mainActivities.push(`mengikuti ${cb} kegiatan pembinaan karakter (Character Building)`);
  }

  let paragraph1 =
    mainActivities.length > 0
      ? `Selama 1 semester ini, ananda telah ${joinIndonesianList(mainActivities)}.`
      : `Selama 1 semester ini, ananda aktif mengikuti proses pembelajaran praktik dan pembinaan karya digital di kelas.`;

  if (client > 0 && income > 0) {
    paragraph1 += ` Selain itu, ananda juga telah menangani ${client} proyek nyata dari mitra/klien dan menghasilkan apresiasi karya sebesar ${formatRupiah(income)}.`;
  } else if (client > 0) {
    paragraph1 += ` Selain itu, ananda juga telah dipercaya menangani ${client} proyek nyata dari mitra/klien.`;
  } else if (income > 0) {
    paragraph1 += ` Selain itu, karya kreatif ananda telah menghasilkan apresiasi karya sebesar ${formatRupiah(income)}.`;
  }

  const skillItems = (report?.skillDigital || []).filter(
    (s) =>
      s.materiSkill.trim() !== '' &&
      s.materiSkill.trim() !== '...............' &&
      Number(s.nilaiAkhir || 0) >= 70
  );

  const competencePhrases: string[] = [];
  const seen = new Set<string>();
  for (const item of skillItems) {
    const phrase = mapSkillToParentCompetence(item.materiSkill);
    if (phrase && !seen.has(phrase)) {
      seen.add(phrase);
      competencePhrases.push(phrase);
    }
  }

  const hasSidangKarya = projects.some(
    (p) =>
      (p.jenis || '').toLowerCase().includes('sidang') ||
      (p.judul || '').toLowerCase().includes('sidang') ||
      (p.mediaItems || []).some((m) => Boolean(m.url && m.url.trim() !== ''))
  );
  if (hasSidangKarya) {
    const sidangPhrase = 'mempresentasikan hasil karya di hadapan penguji pada Sidang Karya';
    if (!seen.has(sidangPhrase)) {
      competencePhrases.push(sidangPhrase);
    }
  }

  let paragraph2 = '';
  if (competencePhrases.length > 0) {
    const joined = joinIndonesianList(competencePhrases);
    const capitalized = joined.charAt(0).toUpperCase() + joined.slice(1);
    paragraph2 = `Kompetensi yang dikuasai: ${capitalized}.`;
  } else {
    paragraph2 =
      'Kompetensi yang dikuasai: Memahami dasar-dasar desain digital, pembuatan konten dakwah, dan kerja sama tim dalam proyek kelas.';
  }

  return `${paragraph1}\n\n${paragraph2}`;
}

export interface GroupedPortfolioProject extends PortfolioProject {
  sourceIds: string[];
}

function parseSlotChildInfo(project: PortfolioProject): { parentId: string; slotIndex: number } | null {
  const idMatch = project.id.match(/^(.+)__slot([23])$/);
  if (idMatch) {
    return { parentId: idMatch[1], slotIndex: Number(idMatch[2]) - 1 };
  }
  const descMatch = (project.description || '').match(/^__parent:(.+)$/);
  const techMatch = (project.technology || '').match(/^__slot:([23])$/);
  if (descMatch) {
    return {
      parentId: descMatch[1],
      slotIndex: techMatch ? Number(techMatch[1]) - 1 : 1,
    };
  }
  return null;
}

/**
 * Reconstructs grouped PortfolioProject entries when a 3-slot project was split
 * across separate Google Sheets / Apps Script rows to stay below the 50,000-char cell limit.
 */
export function groupPortfolioProjects(
  projects: PortfolioProject[]
): GroupedPortfolioProject[] {
  const orderedParents: GroupedPortfolioProject[] = [];
  const parentMap = new Map<string, GroupedPortfolioProject>();
  const childRecords: Array<{ project: PortfolioProject; parentId: string; slotIndex: number }> = [];

  for (const p of projects) {
    const childInfo = parseSlotChildInfo(p);
    if (childInfo) {
      childRecords.push({ project: p, ...childInfo });
      continue;
    }
    const baseItems: PortfolioMediaItem[] = (p.mediaItems || []).map((m) => ({ ...m }));
    const grouped: GroupedPortfolioProject = {
      ...p,
      mediaItems: baseItems,
      sourceIds: [p.id],
    };
    orderedParents.push(grouped);
    parentMap.set(p.id, grouped);
  }

  for (const { project: child, parentId, slotIndex } of childRecords) {
    const parent = parentMap.get(parentId);
    const childActiveMedia = (child.mediaItems || []).filter(
      (m) => Boolean(m.url && m.url.trim() !== '')
    );
    const primaryChildItem = childActiveMedia[0] || child.mediaItems?.[0];

    if (!parent) {
      orderedParents.push({
        ...child,
        description: (child.description || '').startsWith('__parent:') ? '' : child.description,
        technology: (child.technology || '').startsWith('__slot:') ? '' : child.technology,
        mediaItems: primaryChildItem ? [{ ...primaryChildItem }] : [],
        sourceIds: [child.id],
      });
      continue;
    }

    if (!parent.sourceIds.includes(child.id)) {
      parent.sourceIds.push(child.id);
    }

    if (primaryChildItem && primaryChildItem.url.trim() !== '') {
      const targetIdx = Math.max(1, Math.min(2, slotIndex));
      while (parent.mediaItems.length <= targetIdx) {
        parent.mediaItems.push({
          url: '',
          type: 'image',
          caption: '',
          presetArt: parent.mediaItems.length === 1 ? 'uiux' : 'video',
        });
      }
      if (!parent.mediaItems[targetIdx].url || parent.mediaItems[targetIdx].url.trim() === '') {
        parent.mediaItems[targetIdx] = { ...primaryChildItem };
      } else {
        parent.mediaItems.push({ ...primaryChildItem });
      }
    }
  }

  return orderedParents;
}

/**
 * Splits a PortfolioProject containing multiple compressed DataURL photos into separate
 * records (max 1 uploaded image per record) so every JSON row stays comfortably < 42,000 chars
 * in Google Sheets & Google Apps Script.
 */
export function splitPortfolioProjectForStorage(
  project: PortfolioProject
): PortfolioProject[] {
  const baseId = project.id.replace(/__slot[23]$/, '');
  const cleanDescription = (project.description || '').startsWith('__parent:')
    ? ''
    : project.description || '';
  const cleanTechnology = (project.technology || '').startsWith('__slot:')
    ? ''
    : project.technology || '';

  const normalizedSlots: PortfolioMediaItem[] = (project.mediaItems || [])
    .slice(0, 3)
    .map((m, idx) => ({
      url: (m.url || '').trim(),
      type: m.type || 'image',
      caption: (m.caption || '').trim(),
      presetArt: m.presetArt || (idx === 0 ? 'poster' : idx === 1 ? 'uiux' : 'video'),
    }));

  const cleanBase: PortfolioProject = {
    ...project,
    id: baseId,
    description: cleanDescription,
    technology: cleanTechnology,
    mediaItems: normalizedSlots,
  };

  const dataUrlSlotsCount = normalizedSlots.filter((m) => m.url.startsWith('data:')).length;
  const serializedLen = JSON.stringify(cleanBase).length;

  if (dataUrlSlotsCount <= 1 && serializedLen <= 40000) {
    return [cleanBase];
  }

  const slotEntries = normalizedSlots
    .map((item, idx) => ({ item, slotNumber: idx + 1 }))
    .filter(({ item }) => item.url !== '');

  if (slotEntries.length === 0) {
    return [
      {
        ...cleanBase,
        mediaItems: normalizedSlots.slice(0, 1),
      },
    ];
  }

  return slotEntries.map(({ item, slotNumber }, arrayIdx) => {
    if (arrayIdx === 0) {
      return {
        ...cleanBase,
        id: baseId,
        mediaItems: [item],
      };
    }
    const targetSlot = Math.max(2, Math.min(3, slotNumber === 1 ? arrayIdx + 1 : slotNumber));
    return {
      ...cleanBase,
      id: `${baseId}__slot${targetSlot}`,
      description: `__parent:${baseId}`,
      technology: `__slot:${targetSlot}`,
      featured: false,
      mediaItems: [item],
    };
  });
}


