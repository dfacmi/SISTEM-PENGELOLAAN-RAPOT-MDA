import React from 'react';
import type { TilawahProgressSummary } from '../utils/internship';

interface TilawahDonutChartProps {
  summary: TilawahProgressSummary;
  title?: string;
  subtitle?: string;
  compact?: boolean;
  accentColor?: string;
}

export const TilawahDonutChart: React.FC<TilawahDonutChartProps> = ({
  summary,
  title = 'Capaian Tilawah Al-Qur’an (30 Juz)',
  subtitle,
  compact = false,
  accentColor = '#059669',
}) => {
  const size = compact ? 92 : 118;
  const strokeWidth = compact ? 10 : 12;
  const center = size / 2;
  const radius = center - strokeWidth / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.max(0, Math.min(100, summary.pct));
  const dashOffset = circumference * (1 - clampedPct / 100);
  const juzDisplay = summary.totalJuz.toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

  return (
    <div
      className={`flex items-center ${
        compact ? 'gap-3 p-2.5 rounded-md border border-slate-300 bg-white' : 'gap-3.5 sm:gap-4 p-3.5 sm:p-4 rounded-2xl border border-emerald-200 bg-white'
      }`}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`Diagram Tilawah ${juzDisplay} dari 30 Juz (${clampedPct}%)`}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#E2E8F0"
            strokeWidth={strokeWidth}
          />
          {clampedPct > 0 && (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={accentColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${center} ${center})`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight pointer-events-none px-1">
          <span
            className={`${
              compact ? 'text-[13px]' : 'text-base sm:text-lg'
            } font-extrabold text-slate-900 tabular-nums`}
          >
            {juzDisplay}
          </span>
          <span className={`${compact ? 'text-[8.5px]' : 'text-xs'} font-bold text-emerald-700`}>
            / {summary.targetJuz} Juz
          </span>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div
            className={`${
              compact ? 'text-[10px]' : 'text-sm'
            } font-bold text-slate-900 leading-snug`}
          >
            {title}
          </div>
          <span
            className={`${
              compact ? 'text-[9px] px-1.5 py-0.5' : 'text-xs px-2.5 py-0.5'
            } rounded-md font-bold tabular-nums bg-emerald-50 border border-emerald-200 text-emerald-800 shrink-0`}
          >
            {clampedPct}%
          </span>
        </div>

        {subtitle && (
          <div className={`${compact ? 'text-[8.5px]' : 'text-xs'} text-slate-500`}>
            {subtitle}
          </div>
        )}

        <div
          className={`${
            compact ? 'text-[9px]' : 'text-xs sm:text-sm'
          } text-slate-700 font-semibold tabular-nums`}
        >
          Total:{' '}
          <span className="text-emerald-800 font-bold">
            {summary.totalHalaman.toLocaleString('id-ID')} Halaman
          </span>{' '}
          <span className="text-slate-400">
            / {summary.targetHalaman.toLocaleString('id-ID')} Halaman
          </span>
        </div>

        <div
          className={`${
            compact ? 'text-[8px]' : 'text-xs'
          } text-slate-500 tabular-nums leading-snug`}
        >
          Konversi: 1 Juz = {summary.halamanPerJuz} Halaman · {summary.logsWithTilawahCount} hari tercatat
        </div>
      </div>
    </div>
  );
};
