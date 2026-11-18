import {
  DiniyahSubject,
  DigitalSkillSubject,
  PillarSummary,
  Predikat,
  SemesterReport,
  TahfidzAssessment,
} from '../types/mda';

export function hitungPredikat(nilai: number): Predikat {
  if (nilai >= 90) return 'A';
  if (nilai >= 80) return 'B';
  if (nilai >= 70) return 'C';
  return 'D';
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

export function recalculateReport(report: SemesterReport): SemesterReport {
  const t: TahfidzAssessment = { ...report.tahfidz };
  t.nilaiAkhir = hitungNilaiAkhirTahfidz(
    t.kelancaran,
    t.tajwid,
    t.makhrajFashahah,
    t.ketepatanAyat
  );
  t.predikat = hitungPredikat(t.nilaiAkhir);

  const diniyah = report.diniyah.map((d) => ({
    ...d,
    predikat: hitungPredikat(d.nilai),
  }));

  const skillDigital = report.skillDigital.map((s) => {
    const nilaiAkhir = hitungNilaiAkhirSkill(s.pengetahuan, s.keterampilan);
    return {
      ...s,
      nilaiAkhir,
      predikat: hitungPredikat(nilaiAkhir),
    };
  });

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
