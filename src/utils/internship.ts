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
