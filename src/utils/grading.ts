import {
  DiniyahSubject,
  DigitalSkillSubject,
  GradeWeights,
  PillarSummary,
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
  const behanceUrl = normalizeExternalUrl(student.behanceUrl);
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
