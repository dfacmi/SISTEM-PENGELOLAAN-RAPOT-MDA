import React from 'react';
import type { TahfidzAssessment } from '../types/mda';
import { calculateTahfidzJuzProgress } from '../utils/grading';

interface TahfidzJuzDonutChartProps {
  tahfidz?: (Partial<TahfidzAssessment> & { totalJuz?: number | string }) | string | null;
  compact?: boolean;
  accentColor?: string;
  trackColor?: string;
}

export const TahfidzJuzDonutChart: React.FC<TahfidzJuzDonutChartProps> = ({
  tahfidz,
  compact = false,
  accentColor = '#0284C7',
  trackColor = '#E2E8F0',
}) => {
  const progress = calculateTahfidzJuzProgress(tahfidz);
  const size = compact ? 64 : 68;
  const strokeWidth = compact ? 7 : 7.5;
  const center = size / 2;
  const radius = center - strokeWidth / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress.pct / 100);

  return (
    <div className={`inline-flex items-center ${compact ? 'gap-2.5' : 'gap-3'}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`Progres hafalan ${progress.juzFormatted} dari ${progress.targetJuz} Juz (${progress.pct}%)`}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={trackColor}
            strokeWidth={strokeWidth}
          />
          {progress.pct > 0 && (
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
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            className={`${
              compact ? 'text-[12px]' : 'text-xs sm:text-[13px]'
            } font-bold text-slate-900 tabular-nums leading-none`}
          >
            {progress.pct}%
          </span>
        </div>
      </div>

      <div className="min-w-0 leading-tight space-y-0.5">
        <div
          className={`${
            compact ? 'text-[11.5px]' : 'text-xs sm:text-sm'
          } font-bold text-slate-900 tabular-nums whitespace-nowrap`}
        >
          {progress.juzFormatted} / {progress.targetJuz} Juz
        </div>
        <div
          className={`${
            compact ? 'text-[9.5px]' : 'text-xs'
          } font-medium text-slate-500 whitespace-nowrap`}
        >
          Progres 30 Juz
        </div>
      </div>
    </div>
  );
};
