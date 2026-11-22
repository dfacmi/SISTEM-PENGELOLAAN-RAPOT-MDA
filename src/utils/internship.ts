import { DEFAULT_INTERN_TRACKER_ITEMS } from '../data/seedData';
import type {
  BrandingTemplateConfig,
  InternDailyLog,
  InternHourlyBlocks,
  InternTrackerGroup,
  InternTrackerItem,
  InternTrackerMode,
} from '../types/mda';

export interface HourlyBlockDefinition {
  key: keyof InternHourlyBlocks;
  timeRange: string;
  shortLabel: string;
  hint: string;
}

export const INTERN_HOURLY_BLOCK_DEFS: HourlyBlockDefinition[] = [
  {
    key: 'block_05_08',
    timeRange: '05.00 – 08.00',
    shortLabel: 'Pagi & Persiapan',
    hint: 'Aktivitas pagi, ibadah, sarapan, & persiapan berangkat magang',
  },
  {
    key: 'block_08_12',
    timeRange: '08.00 – 12.00',
    shortLabel: 'Sesi Magang Pagi',
    hint: 'Aktivitas kerja / praktik magang sesi pagi hingga menjelang dzuhur',
  },
  {
    key: 'block_13_17',
    timeRange: '13.00 – 17.00',
    shortLabel: 'Sesi Magang Siang–Sore',
    hint: 'Aktivitas kerja / proyek magang sesi siang hingga sore hari',
  },
  {
    key: 'block_18_21',
    timeRange: '18.00 – 21.00',
    shortLabel: 'Malam & Murojaah',
    hint: 'Aktivitas malam, evaluasi harian, ibadah maghrib/isya & murojaah',
  },
  {
    key: 'block_22_03',
    timeRange: '22.00 – 03.00',
    shortLabel: 'Istirahat & Qiyam',
    hint: 'Istirahat malam, qiyamul lail, atau aktivitas malam–dini hari',
  },
];

export const EMPTY_HOURLY_BLOCKS: InternHourlyBlocks = {
  block_05_08: '',
  block_08_12: '',
  block_13_17: '',
  block_18_21: '',
  block_22_03: '',
};

export function resolveInternTrackerItems(
  templateConfig?: BrandingTemplateConfig | null
): InternTrackerItem[] {
  const configured = templateConfig?.internTrackerItems;
  if (Array.isArray(configured)) {
    return configured.filter((item) => item && item.id && item.label && item.active !== false);
  }
  return DEFAULT_INTERN_TRACKER_ITEMS;
}

export function getTrackerButtonLabels(mode: InternTrackerMode): {
  yesLabel: string;
  noLabel: string;
  yesShort: string;
  noShort: string;
} {
  if (mode === 'jamaah') {
    return {
      yesLabel: 'Berjamaah',
      noLabel: 'Tidak Jamaah',
      yesShort: 'Berjamaah',
      noShort: 'Tdk Jamaah',
    };
  }
  return {
    yesLabel: 'Terlaksana',
    noLabel: 'Tidak',
    yesShort: 'Terlaksana',
    noShort: 'Tidak',
  };
}

export function getTrackerGroupLabel(group: InternTrackerGroup): string {
  switch (group) {
    case 'sholat':
      return 'Sholat 5 Waktu';
    case 'tilawah':
      return 'Tilawah Al-Qur’an';
    case 'kebersihan':
      return 'Amal Kebersihan';
    default:
      return 'Amal & Ibadah Tambahan';
  }
}

export function getTodayIsoDateLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatTanggalIndonesia(isoDate: string): string {
  if (!isoDate) return '-';
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return isoDate;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  try {
    return dt.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

export function formatTanggalShort(isoDate: string): string {
  if (!isoDate) return '-';
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return isoDate;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  try {
    return dt.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

export interface TrackerItemStat {
  item: InternTrackerItem;
  yesCount: number;
  noCount: number;
  totalAnswered: number;
  yesPct: number;
}

export function computeInternTrackerStats(
  logs: InternDailyLog[],
  items: InternTrackerItem[]
): {
  totalDays: number;
  itemStats: TrackerItemStat[];
  sholatYesTotal: number;
  sholatAnsweredTotal: number;
  sholatPct: number;
  otherYesTotal: number;
  otherAnsweredTotal: number;
  otherPct: number;
} {
  let sholatYesTotal = 0;
  let sholatAnsweredTotal = 0;
  let otherYesTotal = 0;
  let otherAnsweredTotal = 0;

  const itemStats: TrackerItemStat[] = items.map((item) => {
    let yesCount = 0;
    let noCount = 0;
    for (const log of logs) {
      const val = log.trackerResults?.[item.id];
      if (val === 'yes') yesCount += 1;
      else if (val === 'no') noCount += 1;
    }
    const totalAnswered = yesCount + noCount;
    const yesPct = totalAnswered > 0 ? Math.round((yesCount / totalAnswered) * 100) : 0;

    if (item.group === 'sholat') {
      sholatYesTotal += yesCount;
      sholatAnsweredTotal += totalAnswered;
    } else {
      otherYesTotal += yesCount;
      otherAnsweredTotal += totalAnswered;
    }

    return {
      item,
      yesCount,
      noCount,
      totalAnswered,
      yesPct,
    };
  });

  return {
    totalDays: logs.length,
    itemStats,
    sholatYesTotal,
    sholatAnsweredTotal,
    sholatPct:
      sholatAnsweredTotal > 0 ? Math.round((sholatYesTotal / sholatAnsweredTotal) * 100) : 0,
    otherYesTotal,
    otherAnsweredTotal,
    otherPct:
      otherAnsweredTotal > 0 ? Math.round((otherYesTotal / otherAnsweredTotal) * 100) : 0,
  };
}

export const INDONESIAN_MONTHS_SHORT: { value: string; label: string }[] = [
  { value: '01', label: 'Jan' },
  { value: '02', label: 'Feb' },
  { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' },
  { value: '05', label: 'Mei' },
  { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' },
  { value: '08', label: 'Agu' },
  { value: '09', label: 'Sep' },
  { value: '10', label: 'Okt' },
  { value: '11', label: 'Nov' },
  { value: '12', label: 'Des' },
];

export function getYearPickerOptions(centerYear = new Date().getFullYear()): string[] {
  const start = Math.min(2024, centerYear - 2);
  const end = Math.max(2030, centerYear + 4);
  const years: string[] = [];
  for (let y = start; y <= end; y++) {
    years.push(String(y));
  }
  return years;
}

export function parseIsoDateParts(iso?: string): { day: string; month: string; year: string } {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) {
    return { day: '', month: '', year: '' };
  }
  const [year, month, day] = iso.trim().split('-');
  return { day, month, year };
}

export function buildIsoDateFromParts(day: string, month: string, year: string): string {
  if (!day || !month || !year) return '';
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  const maxDayInMonth = new Date(y, m, 0).getDate();
  const safeDay = Math.min(d, maxDayInMonth);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

export function countInclusiveDays(startIso?: string, endIso?: string): number {
  if (!startIso || !endIso) return 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso)) return 0;
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  if (endMs < startMs) return 0;
  return Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
}

export function formatMagangPeriodRange(
  mulaiTanggal?: string,
  selesaiTanggal?: string,
  jamKerjaHarian?: string,
  fallbackWaktu?: string
): string {
  const hasStart = Boolean(mulaiTanggal && /^\d{4}-\d{2}-\d{2}$/.test(mulaiTanggal));
  const hasEnd = Boolean(selesaiTanggal && /^\d{4}-\d{2}-\d{2}$/.test(selesaiTanggal));
  const jamClean = (jamKerjaHarian || '').trim();

  if (hasStart || hasEnd) {
    const startLabel = hasStart ? formatTanggalShort(mulaiTanggal!) : '...';
    const endLabel = hasEnd ? formatTanggalShort(selesaiTanggal!) : '...';
    const days = hasStart && hasEnd ? countInclusiveDays(mulaiTanggal, selesaiTanggal) : 0;
    const base =
      hasStart && hasEnd
        ? `${startLabel} – ${endLabel}${days > 0 ? ` (${days} Hari)` : ''}`
        : hasStart
          ? `Mulai ${startLabel}`
          : `Selesai ${endLabel}`;
    return jamClean ? `${base} · ${jamClean}` : base;
  }
  return (fallbackWaktu || '').trim();
}

export function resolveInternLembarPerJuz(
  templateConfig?: BrandingTemplateConfig | null
): number {
  const raw = Number(templateConfig?.internLembarPerJuz);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 100) {
    return Math.round(raw);
  }
  return 10;
}

export interface TilawahProgressSummary {
  totalLembar: number;
  lembarPerJuz: number;
  totalJuz: number;
  targetJuz: number;
  targetLembar: number;
  pct: number;
  logsWithTilawahCount: number;
}

export function computeTilawahProgress(
  logs: InternDailyLog[],
  lembarPerJuz = 10
): TilawahProgressSummary {
  const safePerJuz =
    Number.isFinite(lembarPerJuz) && lembarPerJuz >= 1 && lembarPerJuz <= 100
      ? Math.round(lembarPerJuz)
      : 10;
  const targetJuz = 30;
  const targetLembar = targetJuz * safePerJuz;

  let totalLembar = 0;
  let logsWithTilawahCount = 0;

  for (const log of logs) {
    const raw = Number(log.tilawahLembar || 0);
    if (Number.isFinite(raw) && raw > 0) {
      totalLembar += raw;
      logsWithTilawahCount += 1;
    }
  }

  const roundedLembar = Math.round(totalLembar * 10) / 10;
  const totalJuz = Math.round((roundedLembar / safePerJuz) * 10) / 10;
  const pct =
    targetLembar > 0
      ? Math.min(100, Math.round((roundedLembar / targetLembar) * 100))
      : 0;

  return {
    totalLembar: roundedLembar,
    lembarPerJuz: safePerJuz,
    totalJuz,
    targetJuz,
    targetLembar,
    pct,
    logsWithTilawahCount,
  };
}

export function getCurrentYearMonthLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function getAvailableLogMonths(logs: InternDailyLog[]): string[] {
  const set = new Set<string>();
  for (const l of logs) {
    if (l.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(l.tanggal)) {
      set.add(l.tanggal.slice(0, 7));
    }
  }
  const currentYm = getCurrentYearMonthLocal();
  set.add(currentYm);
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

export function formatMonthYearIndonesia(yearMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return yearMonth;
  const [y, m] = yearMonth.split('-').map(Number);
  const dt = new Date(y, m - 1, 1);
  try {
    return dt.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  } catch {
    return yearMonth;
  }
}

export function getDaysInYearMonth(yearMonth: string): number {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return 30;
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export type MatrixHalfRange = '1-15' | '16-end' | 'all';

export interface MutabaahMatrixRow {
  no: number;
  item: InternTrackerItem;
  cells: Array<'yes' | 'no' | null>;
  yesCount: number;
  noCount: number;
  answeredCount: number;
}

export interface MutabaahMatrixResult {
  yearMonth: string;
  monthLabel: string;
  dayNumbers: number[];
  dayIsoDates: string[];
  logByDay: Record<number, InternDailyLog | undefined>;
  rows: MutabaahMatrixRow[];
  hasFirstHalfLogs: boolean;
  hasSecondHalfLogs: boolean;
}

export function buildMutabaahMatrixData(
  logs: InternDailyLog[],
  items: InternTrackerItem[],
  yearMonth: string,
  range: MatrixHalfRange = 'all'
): MutabaahMatrixResult {
  const safeYm = /^\d{4}-\d{2}$/.test(yearMonth) ? yearMonth : getCurrentYearMonthLocal();
  const totalDaysInMonth = getDaysInYearMonth(safeYm);
  const logByDay: Record<number, InternDailyLog | undefined> = {};
  let hasFirstHalfLogs = false;
  let hasSecondHalfLogs = false;

  for (const log of logs) {
    if (!log.tanggal || !log.tanggal.startsWith(`${safeYm}-`)) continue;
    const day = Number(log.tanggal.slice(8, 10));
    if (Number.isFinite(day) && day >= 1 && day <= totalDaysInMonth) {
      logByDay[day] = log;
      if (day <= 15) hasFirstHalfLogs = true;
      else hasSecondHalfLogs = true;
    }
  }

  let startDay = 1;
  let endDay = totalDaysInMonth;
  if (range === '1-15') {
    startDay = 1;
    endDay = Math.min(15, totalDaysInMonth);
  } else if (range === '16-end') {
    startDay = 16;
    endDay = totalDaysInMonth;
  }

  const dayNumbers: number[] = [];
  const dayIsoDates: string[] = [];
  for (let d = startDay; d <= endDay; d++) {
    dayNumbers.push(d);
    dayIsoDates.push(`${safeYm}-${String(d).padStart(2, '0')}`);
  }

  const rows: MutabaahMatrixRow[] = items.map((item, idx) => {
    let yesCount = 0;
    let noCount = 0;
    const cells = dayNumbers.map((day) => {
      const log = logByDay[day];
      const val = log?.trackerResults?.[item.id];
      if (val === 'yes') {
        yesCount += 1;
        return 'yes' as const;
      }
      if (val === 'no') {
        noCount += 1;
        return 'no' as const;
      }
      return null;
    });
    return {
      no: idx + 1,
      item,
      cells,
      yesCount,
      noCount,
      answeredCount: yesCount + noCount,
    };
  });

  return {
    yearMonth: safeYm,
    monthLabel: formatMonthYearIndonesia(safeYm),
    dayNumbers,
    dayIsoDates,
    logByDay,
    rows,
    hasFirstHalfLogs,
    hasSecondHalfLogs,
  };
}
