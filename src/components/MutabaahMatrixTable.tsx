import React, { useEffect, useMemo, useState } from 'react';
import { Calendar } from 'lucide-react';
import type { InternDailyLog, InternTrackerItem } from '../types/mda';
import {
  buildMutabaahMatrixData,
  formatMonthYearIndonesia,
  getAvailableLogMonths,
  getCurrentYearMonthLocal,
  getDaysInYearMonth,
  type MatrixHalfRange,
} from '../utils/internship';

interface MutabaahMatrixTableProps {
  logs: InternDailyLog[];
  trackerItems: InternTrackerItem[];
  studentName?: string;
  title?: string;
  subtitle?: string;
  onSelectDate?: (isoDate: string) => void;
}

export const MutabaahMatrixTable: React.FC<MutabaahMatrixTableProps> = ({
  logs,
  trackerItems,
  studentName,
  title = 'Matriks Mutabaah Ibadah & Amal Per Tanggal',
  subtitle = 'Pantau kehadiran ibadah harian dalam tampilan tabel per tanggal (✓ Hijau = Terpenuhi, ✗ Merah = Tidak).',
  onSelectDate,
}) => {
  const availableMonths = useMemo(() => getAvailableLogMonths(logs), [logs]);

  const preferredInitialMonth = useMemo(() => {
    const sortedLogs = [...logs]
      .filter((l) => l.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(l.tanggal))
      .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
    if (sortedLogs.length > 0) return sortedLogs[0].tanggal.slice(0, 7);
    return availableMonths[0] || getCurrentYearMonthLocal();
  }, [logs, availableMonths]);

  const [selectedMonth, setSelectedMonth] = useState<string>(preferredInitialMonth);

  useEffect(() => {
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(preferredInitialMonth);
    }
  }, [availableMonths, preferredInitialMonth, selectedMonth]);

  const preferredRangeForMonth = useMemo<MatrixHalfRange>(() => {
    let hasFirst = false;
    let hasSecond = false;
    for (const l of logs) {
      if (!l.tanggal || !l.tanggal.startsWith(`${selectedMonth}-`)) continue;
      const day = Number(l.tanggal.slice(8, 10));
      if (day >= 1 && day <= 15) hasFirst = true;
      else if (day >= 16) hasSecond = true;
    }
    if (hasSecond && !hasFirst) return '16-end';
    if (!hasSecond && !hasFirst) {
      const today = new Date();
      const todayYm = getCurrentYearMonthLocal();
      if (selectedMonth === todayYm && today.getDate() >= 16) return '16-end';
    }
    return '1-15';
  }, [logs, selectedMonth]);

  const [rangeMode, setRangeMode] = useState<MatrixHalfRange>(preferredRangeForMonth);

  useEffect(() => {
    setRangeMode(preferredRangeForMonth);
  }, [preferredRangeForMonth]);

  const daysInMonth = useMemo(() => getDaysInYearMonth(selectedMonth), [selectedMonth]);

  const matrix = useMemo(
    () => buildMutabaahMatrixData(logs, trackerItems, selectedMonth, rangeMode),
    [logs, trackerItems, selectedMonth, rangeMode]
  );

  const totalLoggedDaysInMonth = useMemo(
    () => Object.keys(matrix.logByDay).length,
    [matrix.logByDay]
  );

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-700 shrink-0" />
            <h3 className="font-display font-bold text-sm sm:text-base text-slate-900">
              {title}
            </h3>
            {studentName && (
              <span className="text-xs font-semibold text-emerald-800">
                · {studentName}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            aria-label="Filter Bulan Matriks Mutabaah"
            className="min-h-[38px] px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
          >
            {availableMonths.map((ym) => (
              <option key={ym} value={ym}>
                {formatMonthYearIndonesia(ym)}
              </option>
            ))}
          </select>

          <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200/80">
            {[
              { id: '1-15' as const, label: 'Tgl 1–15' },
              { id: '16-end' as const, label: `Tgl 16–${daysInMonth}` },
              { id: 'all' as const, label: 'Semua' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setRangeMode(opt.id)}
                className={`min-h-[32px] px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${
                  rangeMode === opt.id
                    ? 'bg-[#0E2228] text-[#1DF27A] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend & Month Counter */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-3 text-slate-600">
          <span className="inline-flex items-center gap-1 font-semibold">
            <span className="w-5 h-5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold inline-flex items-center justify-center">
              ✓
            </span>
            <span>Terpenuhi / Berjamaah</span>
          </span>
          <span className="inline-flex items-center gap-1 font-semibold">
            <span className="w-5 h-5 rounded bg-rose-50 border border-rose-200 text-rose-600 font-bold inline-flex items-center justify-center">
              ✗
            </span>
            <span>Tidak Terpenuhi</span>
          </span>
          <span className="inline-flex items-center gap-1 text-slate-500">
            <span className="w-5 h-5 rounded bg-slate-50 border border-slate-200 text-slate-400 font-bold inline-flex items-center justify-center">
              -
            </span>
            <span>Belum Ada Log</span>
          </span>
        </div>
        <div className="font-semibold text-slate-600 tabular-nums">
          {matrix.monthLabel}:{' '}
          <span className="font-bold text-emerald-800">{totalLoggedDaysInMonth} hari</span>{' '}
          tercatat
          {onSelectDate && (
            <span className="text-slate-400 ml-1.5 hidden sm:inline">
              (Ketuk tanggal untuk buka/isi)
            </span>
          )}
        </div>
      </div>

      {/* Excel-style Matrix Table with Sticky No & Kegiatan */}
      <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
        <table
          className="w-full border-collapse text-xs"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          <thead>
            <tr className="bg-[#0E2228] text-white">
              <th
                rowSpan={2}
                className="sticky left-0 z-20 bg-[#0E2228] border border-slate-600 px-2 py-2 text-center font-bold w-10 min-w-[40px]"
              >
                No.
              </th>
              <th
                rowSpan={2}
                className="sticky left-[40px] z-20 bg-[#0E2228] border border-slate-600 px-3 py-2 text-left font-bold min-w-[195px] sm:min-w-[235px] shadow-[2px_0_4px_rgba(0,0,0,0.12)]"
              >
                Kegiatan Ibadah &amp; Amal
              </th>
              <th
                colSpan={matrix.dayNumbers.length}
                className="border border-slate-600 px-2 py-1.5 text-center font-bold tracking-wide text-[#1DF27A]"
              >
                Tanggal ({matrix.monthLabel})
              </th>
              <th
                rowSpan={2}
                className="border border-slate-600 px-2.5 py-2 text-center font-bold min-w-[66px]"
              >
                Total ✓
              </th>
            </tr>
            <tr className="bg-[#13313A] text-white">
              {matrix.dayNumbers.map((dayNum, dIdx) => {
                const iso = matrix.dayIsoDates[dIdx];
                const hasLog = Boolean(matrix.logByDay[dayNum]);
                return (
                  <th
                    key={dayNum}
                    className={`border border-slate-600 p-0 text-center font-bold tabular-nums min-w-[32px] ${
                      hasLog ? 'bg-[#17424D] text-[#1DF27A]' : 'text-slate-200'
                    }`}
                  >
                    {onSelectDate ? (
                      <button
                        type="button"
                        onClick={() => onSelectDate(iso)}
                        title={`Pilih tanggal ${iso}`}
                        className="w-full min-h-[30px] px-1 py-1 hover:bg-white/10 transition-colors font-bold tabular-nums"
                      >
                        {dayNum}
                      </button>
                    ) : (
                      <div className="px-1 py-1">{dayNum}</div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {matrix.rows.map((row, rIdx) => {
              const rowBg = rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/80';
              return (
                <tr key={row.item.id} className={rowBg}>
                  <td
                    className={`sticky left-0 z-10 ${rowBg} border border-slate-300 px-2 py-2 text-center font-bold text-slate-600 tabular-nums`}
                  >
                    {row.no}
                  </td>
                  <td
                    className={`sticky left-[40px] z-10 ${rowBg} border border-slate-300 px-3 py-2 font-semibold text-slate-900 whitespace-normal leading-snug shadow-[2px_0_4px_rgba(0,0,0,0.04)]`}
                  >
                    {row.item.label}
                  </td>
                  {row.cells.map((cell, cIdx) => {
                    const iso = matrix.dayIsoDates[cIdx];
                    const cellContent =
                      cell === 'yes' ? (
                        <span className="font-bold text-emerald-700 text-sm">✓</span>
                      ) : cell === 'no' ? (
                        <span className="font-bold text-rose-600 text-sm">✗</span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      );
                    return (
                      <td
                        key={`${row.item.id}-${iso}`}
                        className={`border border-slate-300 p-0 text-center tabular-nums ${
                          cell === 'yes'
                            ? 'bg-emerald-50/85'
                            : cell === 'no'
                              ? 'bg-rose-50/85'
                              : ''
                        }`}
                      >
                        {onSelectDate ? (
                          <button
                            type="button"
                            onClick={() => onSelectDate(iso)}
                            title={`${row.item.label} (${iso})`}
                            className="w-full min-h-[34px] flex items-center justify-center hover:bg-slate-200/40 transition-colors"
                          >
                            {cellContent}
                          </button>
                        ) : (
                          <div className="min-h-[34px] flex items-center justify-center">
                            {cellContent}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="border border-slate-300 px-2 py-1.5 text-center font-bold tabular-nums bg-slate-50 text-slate-900 whitespace-nowrap">
                    <span className="text-emerald-700">{row.yesCount}</span>
                    <span className="text-slate-400 font-normal">/{row.answeredCount}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
