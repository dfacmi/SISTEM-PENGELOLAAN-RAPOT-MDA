import React from 'react';
import {
  buildIsoDateFromParts,
  countInclusiveDays,
  formatMagangPeriodRange,
  getYearPickerOptions,
  INDONESIAN_MONTHS_SHORT,
  parseIsoDateParts,
} from '../utils/internship';

interface MagangPeriodPickerProps {
  mulaiTanggal: string;
  selesaiTanggal: string;
  jamKerjaHarian: string;
  legacyWaktuMagang?: string;
  onChangeMulai: (iso: string) => void;
  onChangeSelesai: (iso: string) => void;
  onChangeJamKerja: (val: string) => void;
}

const DAY_OPTIONS = Array.from({ length: 31 }, (_, idx) => String(idx + 1).padStart(2, '0'));

export const MagangPeriodPicker: React.FC<MagangPeriodPickerProps> = ({
  mulaiTanggal,
  selesaiTanggal,
  jamKerjaHarian,
  legacyWaktuMagang,
  onChangeMulai,
  onChangeSelesai,
  onChangeJamKerja,
}) => {
  const yearOptions = getYearPickerOptions();
  const startParts = parseIsoDateParts(mulaiTanggal);
  const endParts = parseIsoDateParts(selesaiTanggal);
  const defaultYear = String(new Date().getFullYear());

  const handleDatePartChange = (
    current: { day: string; month: string; year: string },
    field: 'day' | 'month' | 'year',
    value: string,
    onChange: (iso: string) => void
  ) => {
    if (!value) {
      onChange('');
      return;
    }
    const next = {
      day: field === 'day' ? value : current.day || '01',
      month: field === 'month' ? value : current.month || '01',
      year: field === 'year' ? value : current.year || defaultYear,
    };
    onChange(buildIsoDateFromParts(next.day, next.month, next.year));
  };

  const totalDays = countInclusiveDays(mulaiTanggal, selesaiTanggal);
  const formattedSummary = formatMagangPeriodRange(
    mulaiTanggal,
    selesaiTanggal,
    jamKerjaHarian,
    legacyWaktuMagang
  );

  return (
    <div className="space-y-3">
      {/* Mulai Magang */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs sm:text-sm font-semibold text-slate-700">Mulai Magang</label>
          {mulaiTanggal && (
            <button
              type="button"
              onClick={() => onChangeMulai('')}
              className="text-xs font-semibold text-slate-500 hover:text-rose-600"
            >
              Reset
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <select
            aria-label="Tanggal Mulai Magang"
            value={startParts.day}
            onChange={(e) => handleDatePartChange(startParts, 'day', e.target.value, onChangeMulai)}
            className="w-full h-11 px-2.5 py-2 text-base sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          >
            <option value="">Tgl</option>
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {Number(d)}
              </option>
            ))}
          </select>

          <select
            aria-label="Bulan Mulai Magang"
            value={startParts.month}
            onChange={(e) =>
              handleDatePartChange(startParts, 'month', e.target.value, onChangeMulai)
            }
            className="w-full h-11 px-2.5 py-2 text-base sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          >
            <option value="">Bulan</option>
            {INDONESIAN_MONTHS_SHORT.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Tahun Mulai Magang"
            value={startParts.year}
            onChange={(e) =>
              handleDatePartChange(startParts, 'year', e.target.value, onChangeMulai)
            }
            className="w-full h-11 px-2.5 py-2 text-base sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          >
            <option value="">Tahun</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Selesai Magang */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs sm:text-sm font-semibold text-slate-700">Selesai Magang</label>
          {selesaiTanggal && (
            <button
              type="button"
              onClick={() => onChangeSelesai('')}
              className="text-xs font-semibold text-slate-500 hover:text-rose-600"
            >
              Reset
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <select
            aria-label="Tanggal Selesai Magang"
            value={endParts.day}
            onChange={(e) => handleDatePartChange(endParts, 'day', e.target.value, onChangeSelesai)}
            className="w-full h-11 px-2.5 py-2 text-base sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          >
            <option value="">Tgl</option>
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {Number(d)}
              </option>
            ))}
          </select>

          <select
            aria-label="Bulan Selesai Magang"
            value={endParts.month}
            onChange={(e) =>
              handleDatePartChange(endParts, 'month', e.target.value, onChangeSelesai)
            }
            className="w-full h-11 px-2.5 py-2 text-base sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          >
            <option value="">Bulan</option>
            {INDONESIAN_MONTHS_SHORT.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Tahun Selesai Magang"
            value={endParts.year}
            onChange={(e) => handleDatePartChange(endParts, 'year', e.target.value, onChangeSelesai)}
            className="w-full h-11 px-2.5 py-2 text-base sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          >
            <option value="">Tahun</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Jam Kerja Harian Opsional */}
      <div>
        <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">
          Jadwal / Jam Kerja Harian (Opsional)
        </label>
        <input
          type="text"
          value={jamKerjaHarian}
          onChange={(e) => onChangeJamKerja(e.target.value)}
          placeholder="Contoh: Senin–Sabtu, 08.00–17.00"
          className="w-full h-11 px-3.5 py-2 text-base sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
        />
      </div>

      {/* Ringkasan Periode */}
      {formattedSummary && (
        <div className="px-3.5 py-2.5 rounded-xl bg-[#E8FAF3] border border-emerald-200 text-xs text-emerald-950 font-semibold leading-snug">
          Periode: {formattedSummary}
          {mulaiTanggal && selesaiTanggal && totalDays === 0 && (
            <span className="block text-rose-700 mt-0.5">
              Tanggal selesai harus sama atau setelah tanggal mulai.
            </span>
          )}
        </div>
      )}
    </div>
  );
};
