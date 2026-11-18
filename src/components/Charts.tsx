import React from 'react';
import { PillarSummary } from '../types/mda';

interface RadarProps {
  current: PillarSummary;
  previous?: PillarSummary;
  currentLabel?: string;
  previousLabel?: string;
}

const PILLAR_LABELS = [
  { key: 'penguasaanMultimedia' as const, short: 'Multimedia', full: 'Penguasaan Multimedia' },
  { key: 'diniyahPembelajaran' as const, short: 'Diniyah', full: 'Diniyah & Pembelajaran' },
  { key: 'tahfidzulQuran' as const, short: "Tahfidzul Qur'an", full: "Tahfidzul Qur'an" },
  { key: 'kesantrianKeasramaan' as const, short: 'Kesantrian', full: 'Kesantrian & Keasramaan' },
  { key: 'characterBuilding' as const, short: 'Character', full: 'Character Building' },
];

export const RadarFivePillarsChart: React.FC<RadarProps> = ({
  current,
  previous,
  currentLabel = 'Semester Aktif',
  previousLabel = 'Semester Sebelumnya',
}) => {
  const cx = 160;
  const cy = 148;
  const maxR = 96;
  const levels = [25, 50, 75, 100];

  const getPoint = (index: number, pct: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / 5;
    const r = (Math.max(0, Math.min(100, pct)) / 100) * maxR;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  const toPolygonPoints = (p: PillarSummary) =>
    PILLAR_LABELS.map((item, idx) => {
      const pt = getPoint(idx, p[item.key]);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    }).join(' ');

  return (
    <div className="w-full flex flex-col items-center">
      <svg viewBox="0 0 320 300" className="w-full max-w-[320px] h-auto">
        {levels.map((lvl) => {
          const pts = PILLAR_LABELS.map((_, idx) => {
            const pt = getPoint(idx, lvl);
            return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
          }).join(' ');
          return (
            <polygon
              key={lvl}
              points={pts}
              fill="none"
              stroke="#DCEEE7"
              strokeWidth="1"
            />
          );
        })}

        {PILLAR_LABELS.map((item, idx) => {
          const outer = getPoint(idx, 100);
          const labelPt = getPoint(idx, 122);
          return (
            <g key={item.key}>
              <line
                x1={cx}
                y1={cy}
                x2={outer.x}
                y2={outer.y}
                stroke="#E2E8F0"
                strokeWidth="1"
              />
              <text
                x={labelPt.x}
                y={labelPt.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-slate-700 text-[10.5px] font-semibold"
              >
                {item.short}
              </text>
              <text
                x={labelPt.x}
                y={labelPt.y + 13}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-emerald-700 text-[10px] font-mono font-bold"
              >
                {current[item.key]}%
              </text>
            </g>
          );
        })}

        {previous && (
          <polygon
            points={toPolygonPoints(previous)}
            fill="rgba(14, 165, 233, 0.14)"
            stroke="#0EA5E9"
            strokeWidth="1.75"
            strokeDasharray="4 3"
          />
        )}

        <polygon
          points={toPolygonPoints(current)}
          fill="rgba(0, 184, 124, 0.22)"
          stroke="#009E6C"
          strokeWidth="2.5"
        />

        {PILLAR_LABELS.map((item, idx) => {
          const pt = getPoint(idx, current[item.key]);
          return (
            <circle
              key={item.key}
              cx={pt.x}
              cy={pt.y}
              r="4"
              fill="#0F172A"
              stroke="#FFFFFF"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-600 mt-1">
        <div className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-emerald-500/40 border-2 border-emerald-600" />
          <span>{currentLabel}</span>
        </div>
        {previous && (
          <div className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-sky-500/20 border border-dashed border-sky-500" />
            <span>{previousLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export interface TrendSeriesPoint {
  label: string;
  multimedia: number;
  diniyah: number;
  tahfidz: number;
  character: number;
  rataRata: number;
}

export const SemesterProgressChart: React.FC<{ data: TrendSeriesPoint[] }> = ({ data }) => {
  if (data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-slate-500">
        Belum ada data historis semester untuk ditampilkan.
      </div>
    );
  }

  const width = 560;
  const height = 220;
  const padL = 38;
  const padR = 24;
  const padT = 20;
  const padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const getX = (idx: number) =>
    data.length === 1 ? padL + innerW / 2 : padL + (idx / (data.length - 1)) * innerW;
  const getY = (val: number) => {
    const clamped = Math.max(40, Math.min(100, val));
    return padT + ((100 - clamped) / 60) * innerH;
  };

  const makePath = (vals: number[]) =>
    vals
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(v).toFixed(1)}`)
      .join(' ');

  const gridTicks = [40, 60, 75, 90, 100];

  const lines = [
    { key: 'multimedia' as const, label: 'Multimedia', color: '#00A876' },
    { key: 'tahfidz' as const, label: 'Tahfidz', color: '#0284C7' },
    { key: 'diniyah' as const, label: 'Diniyah', color: '#0F172A' },
    { key: 'character' as const, label: 'Character', color: '#D97706' },
  ];

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {gridTicks.map((tick) => {
          const y = getY(tick);
          return (
            <g key={tick}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke={tick === 60 ? '#FCA5A5' : '#E2E8F0'}
                strokeDasharray={tick === 60 ? '4 4' : undefined}
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-500 text-[10px] font-mono"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {lines.map((line) => {
          const vals = data.map((d) => d[line.key]);
          return (
            <g key={line.key}>
              {data.length > 1 && (
                <path
                  d={makePath(vals)}
                  fill="none"
                  stroke={line.color}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {vals.map((val, idx) => (
                <g key={idx}>
                  <circle
                    cx={getX(idx)}
                    cy={getY(val)}
                    r="4.5"
                    fill={line.color}
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                  />
                  <text
                    x={getX(idx)}
                    y={getY(val) - 9}
                    textAnchor="middle"
                    className="fill-slate-700 text-[9.5px] font-mono font-semibold"
                  >
                    {val}
                  </text>
                </g>
              ))}
            </g>
          );
        })}

        {data.map((d, idx) => (
          <text
            key={d.label}
            x={getX(idx)}
            y={height - 10}
            textAnchor="middle"
            className="fill-slate-600 text-[10.5px] font-medium"
          >
            {d.label}
          </text>
        ))}
      </svg>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 mt-2">
        {lines.map((line) => (
          <div key={line.key} className="inline-flex items-center gap-1.5">
            <span
              className="w-3 h-1.5 rounded-full"
              style={{ backgroundColor: line.color }}
            />
            <span>{line.label}</span>
          </div>
        ))}
        <div className="inline-flex items-center gap-1.5 text-rose-600">
          <span className="w-3 border-t border-dashed border-rose-400" />
          <span>KKM (60)</span>
        </div>
      </div>
    </div>
  );
};
