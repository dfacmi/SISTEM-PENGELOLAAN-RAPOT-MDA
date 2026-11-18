import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Printer, Save } from 'lucide-react';
import {
  DEFAULT_CHARACTER_PROGRAMS,
  DEFAULT_DIGITAL_SKILLS,
  DEFAULT_DINIYAH_MAPEL,
  DEFAULT_SIKAP_ASPEK,
} from '../data/seedData';
import {
  KeputusanSemester,
  MdaDatabase,
  Predikat,
  SemesterReport,
} from '../types/mda';
import {
  formatRupiah,
  getKategoriPredikat,
  hitungRataRataDigital,
  hitungRataRataDiniyah,
  recalculateReport,
} from '../utils/grading';
import { StudentAvatar } from './MdaLogo';

interface GradeEditorViewProps {
  db: MdaDatabase;
  selectedStudentId: string;
  selectedYear: string;
  selectedSemester: 'Gasal' | 'Genap';
  onSelectStudent: (id: string) => void;
  onSaveReport: (report: SemesterReport) => void;
  onOpenPrint: (studentId: string) => void;
}

type EditorTab = 'ringkasan' | 'sikap' | 'tahfidz' | 'akademik' | 'catatan';

export const GradeEditorView: React.FC<GradeEditorViewProps> = ({
  db,
  selectedStudentId,
  selectedYear,
  selectedSemester,
  onSelectStudent,
  onSaveReport,
  onOpenPrint,
}) => {
  const [tab, setTab] = useState<EditorTab>('ringkasan');

  const student = useMemo(
    () => db.students.find((s) => s.id === selectedStudentId) || db.students[0],
    [db.students, selectedStudentId]
  );

  const periodConfig = useMemo(
    () =>
      db.periods.find(
        (p) => p.tahunAkademik === selectedYear && p.semester === selectedSemester
      ) || db.periods[0],
    [db.periods, selectedYear, selectedSemester]
  );

  const existingReport = useMemo(
    () =>
      db.reports.find(
        (r) =>
          r.studentId === student?.id &&
          r.tahunAkademik === selectedYear &&
          r.semester === selectedSemester
      ),
    [db.reports, student, selectedYear, selectedSemester]
  );

  const buildBlankReport = (): SemesterReport => ({
    id: `rep-${student?.id || 'new'}-${selectedYear}-${selectedSemester}`.replace(/\//g, '-'),
    studentId: student?.id || '',
    tahunAkademik: selectedYear,
    semester: selectedSemester,
    tanggalRapor: periodConfig?.tanggalRapor || '19 Desember 2026',
    pilar: {
      penguasaanMultimedia: 75,
      diniyahPembelajaran: 75,
      tahfidzulQuran: 75,
      kesantrianKeasramaan: 75,
      characterBuilding: 75,
      autoCalculate: true,
    },
    kpiMda: {
      characterBuildingCount: 0,
      multimediaProjectCount: 0,
      clientProjectCount: 0,
      mdaMengajarCount: 0,
      incomeRp: 0,
      produksiKontenCount: 0,
    },
    sikap: DEFAULT_SIKAP_ASPEK.map((aspek) => ({
      aspek,
      predikat: 'B',
      deskripsi: '',
    })),
    characterPrograms: DEFAULT_CHARACTER_PROGRAMS.map((kegiatan) => ({
      kegiatan,
      keterangan: '',
    })),
    tahfidz: {
      totalHafalan: '',
      capaianSemesterIni: '',
      totalJuziyah: '',
      totalSetoranZiyadah: '',
      totalMurojaah: '',
      kelancaran: 80,
      tajwid: 80,
      makhrajFashahah: 80,
      ketepatanAyat: 80,
      nilaiAkhir: 80,
      predikat: 'B',
      deskripsi: '',
    },
    diniyah: DEFAULT_DINIYAH_MAPEL.map((m) => ({
      ...m,
      kkm: periodConfig?.kkmDiniyah || 60,
      nilai: 75,
      predikat: 'C',
      deskripsi: '',
    })),
    skillDigital: DEFAULT_DIGITAL_SKILLS.map((s) => ({
      ...s,
      kkm: periodConfig?.kkmDigital || 60,
      pengetahuan: 75,
      keterampilan: 75,
      nilaiAkhir: 75,
      predikat: 'C',
    })),
    kehadiran: { sakit: 0, izin: 0, alpa: 0 },
    catatanWali: {
      pesanSingkat: '',
      perkembangan: '',
      kekuatan: '',
      saranSemesterDepan: '',
    },
    keputusanSemester: 'Lanjut ke semester genap',
    published: false,
    updatedAt: new Date().toISOString(),
  });

  const [draft, setDraft] = useState<SemesterReport>(() =>
    existingReport ? recalculateReport(existingReport) : buildBlankReport()
  );

  useEffect(() => {
    setDraft(existingReport ? recalculateReport(existingReport) : buildBlankReport());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, selectedYear, selectedSemester, existingReport?.id]);

  const updateDraft = (updater: (prev: SemesterReport) => SemesterReport) => {
    setDraft((prev) => recalculateReport(updater(prev)));
  };

  const diniyahAvg = hitungRataRataDiniyah(draft.diniyah);
  const digitalAvg = hitungRataRataDigital(draft.skillDigital);

  if (!student) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        Tambahkan minimal satu santri terlebih dahulu di menu Data Santri.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Santri Selector & Save Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <StudentAvatar
            name={student.nama}
            fotoUrl={student.fotoUrl}
            className="w-12 h-12 text-sm shrink-0"
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={student.id}
                onChange={(e) => onSelectStudent(e.target.value)}
                className="font-display font-bold text-slate-900 text-base bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              >
                {db.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nama} ({s.kelas})
                  </option>
                ))}
              </select>
              <span className="font-mono text-xs text-emerald-700 font-semibold">
                {student.nisnMda}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Semester {selectedSemester} {selectedYear} · Wali Kelas: {student.waliKelasNama}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => updateDraft((prev) => ({ ...prev, pilar: { ...prev.pilar, autoCalculate: true } }))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold whitespace-nowrap"
          >
            <Calculator className="w-3.5 h-3.5 text-emerald-600" />
            <span>Hitung Pilar Otomatis</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenPrint(student.id)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-900 text-white hover:bg-slate-800 text-xs font-semibold whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Pratinjau PDF</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onSaveReport({
                ...draft,
                updatedAt: new Date().toISOString(),
              })
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Simpan Nilai Rapor</span>
          </button>
        </div>
      </div>

      {/* Editor Section Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
        {[
          { id: 'ringkasan' as const, label: '5 Pilar & KPI MDA' },
          { id: 'sikap' as const, label: 'A. Sikap & Character Building' },
          { id: 'tahfidz' as const, label: 'B. Tahfidz Al-Qur’an' },
          { id: 'akademik' as const, label: 'C. Diniyah & D. Skill Digital' },
          { id: 'catatan' as const, label: 'E. Kehadiran & F. Catatan Wali' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              tab === item.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* TAB 1: 5 PILAR & KPI MDA */}
      {tab === 'ringkasan' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-slate-900 text-sm">
                  Ringkasan Capaian 5 Pilar (%)
                </h3>
                <p className="text-xs text-slate-500">
                  Otomatis dari kalkulasi direktarium atau sesuaikan manual
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.pilar.autoCalculate}
                  onChange={(e) =>
                    updateDraft((p) => ({
                      ...p,
                      pilar: { ...p.pilar, autoCalculate: e.target.checked },
                    }))
                  }
                  className="rounded border-slate-300 text-emerald-600"
                />
                <span>Kalkulasi Otomatis</span>
              </label>
            </div>

            <div className="space-y-3">
              {[
                { key: 'penguasaanMultimedia' as const, label: 'Penguasaan Multimedia' },
                { key: 'diniyahPembelajaran' as const, label: 'Diniyah dan Pembelajaran' },
                { key: 'tahfidzulQuran' as const, label: "Tahfidzul Qur'an" },
                { key: 'kesantrianKeasramaan' as const, label: 'Kesantrian dan Keasramaan' },
                { key: 'characterBuilding' as const, label: 'Character Building' },
              ].map((item) => (
                <div key={item.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span>{item.label}</span>
                    <span className="font-mono text-slate-900 tabular-nums">
                      {draft.pilar[item.key]}%
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      disabled={draft.pilar.autoCalculate}
                      value={draft.pilar[item.key]}
                      onChange={(e) =>
                        updateDraft((p) => ({
                          ...p,
                          pilar: { ...p.pilar, [item.key]: Number(e.target.value) },
                        }))
                      }
                      className="flex-1 accent-emerald-600"
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={draft.pilar.autoCalculate}
                      value={draft.pilar[item.key]}
                      onChange={(e) =>
                        updateDraft((p) => ({
                          ...p,
                          pilar: { ...p.pilar, [item.key]: Number(e.target.value) },
                        }))
                      }
                      className="w-16 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md text-right disabled:bg-slate-50"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="font-display font-bold text-slate-900 text-sm">
                Ringkasan MDA Semester Ini (6 Kartu KPI)
              </h3>
              <p className="text-xs text-slate-500">
                Data aktivitas proyek, pengajaran, konten, dan pemasukan proyek santri
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Character Building (Jumlah Kegiatan)
                </label>
                <input
                  type="number"
                  min={0}
                  value={draft.kpiMda.characterBuildingCount}
                  onChange={(e) =>
                    updateDraft((p) => ({
                      ...p,
                      kpiMda: {
                        ...p.kpiMda,
                        characterBuildingCount: Number(e.target.value),
                      },
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Multimedia Project
                </label>
                <input
                  type="number"
                  min={0}
                  value={draft.kpiMda.multimediaProjectCount}
                  onChange={(e) =>
                    updateDraft((p) => ({
                      ...p,
                      kpiMda: {
                        ...p.kpiMda,
                        multimediaProjectCount: Number(e.target.value),
                      },
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Client Project
                </label>
                <input
                  type="number"
                  min={0}
                  value={draft.kpiMda.clientProjectCount}
                  onChange={(e) =>
                    updateDraft((p) => ({
                      ...p,
                      kpiMda: {
                        ...p.kpiMda,
                        clientProjectCount: Number(e.target.value),
                      },
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  MDA Mengajar (Kali)
                </label>
                <input
                  type="number"
                  min={0}
                  value={draft.kpiMda.mdaMengajarCount}
                  onChange={(e) =>
                    updateDraft((p) => ({
                      ...p,
                      kpiMda: {
                        ...p.kpiMda,
                        mdaMengajarCount: Number(e.target.value),
                      },
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Income Proyek (Rp)
                </label>
                <input
                  type="number"
                  min={0}
                  step={10000}
                  value={draft.kpiMda.incomeRp}
                  onChange={(e) =>
                    updateDraft((p) => ({
                      ...p,
                      kpiMda: { ...p.kpiMda, incomeRp: Number(e.target.value) },
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
                <div className="text-[11px] text-emerald-700 mt-1 font-mono">
                  {formatRupiah(draft.kpiMda.incomeRp)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Produksi Konten
                </label>
                <input
                  type="number"
                  min={0}
                  value={draft.kpiMda.produksiKontenCount}
                  onChange={(e) =>
                    updateDraft((p) => ({
                      ...p,
                      kpiMda: {
                        ...p.kpiMda,
                        produksiKontenCount: Number(e.target.value),
                      },
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SIKAP & CHARACTER BUILDING */}
      {tab === 'sikap' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display font-bold text-slate-900 text-sm">
                A. Sikap dan Karakter
              </h3>
              <span className="text-xs text-slate-500">
                A = Sangat Baik · B = Baik · C = Cukup · D = Perlu Bimbingan
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2.5 px-4 w-1/3">Aspek Penilaian</th>
                    <th className="py-2.5 px-3 w-32">Predikat</th>
                    <th className="py-2.5 px-4">Deskripsi Singkat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draft.sikap.map((item, idx) => (
                    <tr key={item.aspek}>
                      <td className="py-2.5 px-4 font-medium text-slate-800">
                        {item.aspek}
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          value={item.predikat}
                          onChange={(e) => {
                            const next = [...draft.sikap];
                            next[idx] = {
                              ...next[idx],
                              predikat: e.target.value as Predikat,
                            };
                            updateDraft((p) => ({ ...p, sikap: next }));
                          }}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white font-mono font-bold"
                        >
                          <option value="A">A (Sangat Baik)</option>
                          <option value="B">B (Baik)</option>
                          <option value="C">C (Cukup)</option>
                          <option value="D">D (Perlu Bimbingan)</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="text"
                          value={item.deskripsi}
                          onChange={(e) => {
                            const next = [...draft.sikap];
                            next[idx] = { ...next[idx], deskripsi: e.target.value };
                            updateDraft((p) => ({ ...p, sikap: next }));
                          }}
                          placeholder="Tulis catatan singkat sikap santri..."
                          className="w-full px-3 py-1.5 border border-slate-200 rounded-lg"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="font-display font-bold text-slate-900 text-sm mb-3">
              Character Building Program
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {draft.characterPrograms.map((prog, idx) => (
                <div key={prog.kegiatan}>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {prog.kegiatan}
                  </label>
                  <input
                    type="text"
                    value={prog.keterangan}
                    onChange={(e) => {
                      const next = [...draft.characterPrograms];
                      next[idx] = { ...next[idx], keterangan: e.target.value };
                      updateDraft((p) => ({ ...p, characterPrograms: next }));
                    }}
                    placeholder="Isi peran, lokasi, atau hasil kegiatan..."
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: TAHFIDZ AL-QUR'AN */}
      {tab === 'tahfidz' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="font-display font-bold text-slate-900 text-sm">
              Capaian Hafalan Al-Qur’an
            </h3>
            <div className="space-y-3">
              {[
                { key: 'totalHafalan' as const, label: 'Total Hafalan', ph: '5 Juz (30-26)' },
                {
                  key: 'capaianSemesterIni' as const,
                  label: 'Capaian Hafalan Semester Ini',
                  ph: '1 Juz 17 halaman',
                },
                { key: 'totalJuziyah' as const, label: 'Total Juziyah', ph: '2 Juz' },
                {
                  key: 'totalSetoranZiyadah' as const,
                  label: 'Total Setoran Ziyadah',
                  ph: '37 halaman',
                },
                { key: 'totalMurojaah' as const, label: 'Total Murojaah', ph: '5 Juz' },
              ].map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {field.label}
                  </label>
                  <input
                    type="text"
                    value={draft.tahfidz[field.key]}
                    onChange={(e) =>
                      updateDraft((p) => ({
                        ...p,
                        tahfidz: { ...p.tahfidz, [field.key]: e.target.value },
                      }))
                    }
                    placeholder={field.ph}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-slate-900 text-sm">
                Aspek Penilaian Tahfidz (Otomatis)
              </h3>
              <div className="font-mono text-xs font-bold text-emerald-700 tabular-nums">
                Nilai Akhir: {draft.tahfidz.nilaiAkhir} ({draft.tahfidz.predikat} ·{' '}
                {getKategoriPredikat(draft.tahfidz.predikat)})
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { key: 'kelancaran' as const, label: 'Kelancaran Hafalan' },
                { key: 'tajwid' as const, label: 'Tajwid' },
                { key: 'makhrajFashahah' as const, label: 'Makhraj dan Fashahah' },
                { key: 'ketepatanAyat' as const, label: 'Ketepatan Ayat' },
              ].map((item) => (
                <div key={item.key}>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {item.label}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.tahfidz[item.key]}
                    onChange={(e) =>
                      updateDraft((p) => ({
                        ...p,
                        tahfidz: {
                          ...p.tahfidz,
                          [item.key]: Number(e.target.value),
                        },
                      }))
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                </div>
              ))}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Deskripsi Capaian Tahfidz
              </label>
              <textarea
                rows={4}
                value={draft.tahfidz.deskripsi}
                onChange={(e) =>
                  updateDraft((p) => ({
                    ...p,
                    tahfidz: { ...p.tahfidz, deskripsi: e.target.value },
                  }))
                }
                placeholder="Contoh: Ananda telah mencapai target hafalan dengan lancar..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: DINIYAH & SKILL DIGITAL */}
      {tab === 'akademik' && (
        <div className="space-y-6">
          {/* C. DINIYAH */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display font-bold text-slate-900 text-sm">
                C. Mata Pelajaran Diniyah
              </h3>
              <div className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                Rata-rata Diniyah: {diniyahAvg}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2.5 px-3 w-10">No</th>
                    <th className="py-2.5 px-3">Mata Pelajaran</th>
                    <th className="py-2.5 px-3">Kitab / Materi</th>
                    <th className="py-2.5 px-3 w-20 text-right">KKM</th>
                    <th className="py-2.5 px-3 w-24 text-right">Nilai</th>
                    <th className="py-2.5 px-3 w-28">Status KKM</th>
                    <th className="py-2.5 px-3">Deskripsi Capaian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draft.diniyah.map((d, idx) => {
                    const tuntas = d.nilai >= d.kkm;
                    return (
                      <tr key={d.no}>
                        <td className="py-2.5 px-3 font-mono text-slate-500">{d.no}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          {d.mataPelajaran}
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={d.kitabMateri}
                            onChange={(e) => {
                              const next = [...draft.diniyah];
                              next[idx] = { ...next[idx], kitabMateri: e.target.value };
                              updateDraft((p) => ({ ...p, diniyah: next }));
                            }}
                            className="w-full px-2 py-1 border border-slate-200 rounded-md"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {d.kkm}
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={d.nilai}
                            onChange={(e) => {
                              const next = [...draft.diniyah];
                              next[idx] = { ...next[idx], nilai: Number(e.target.value) };
                              updateDraft((p) => ({ ...p, diniyah: next }));
                            }}
                            className="w-full px-2 py-1 border border-slate-200 rounded-md font-mono text-right"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-semibold">
                          <span
                            className={tuntas ? 'text-emerald-700' : 'text-rose-600'}
                          >
                            {d.predikat} · {tuntas ? 'Tuntas' : 'Belum'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={d.deskripsi}
                            onChange={(e) => {
                              const next = [...draft.diniyah];
                              next[idx] = { ...next[idx], deskripsi: e.target.value };
                              updateDraft((p) => ({ ...p, diniyah: next }));
                            }}
                            placeholder="Deskripsi capaian..."
                            className="w-full px-2 py-1 border border-slate-200 rounded-md"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* D. SKILL DIGITAL */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display font-bold text-slate-900 text-sm">
                D. Skill Digital (Otomatis Nilai Akhir & Predikat)
              </h3>
              <div className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                Rata-rata Skill Digital: {digitalAvg}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2.5 px-3 w-10">No</th>
                    <th className="py-2.5 px-3">Materi Skill</th>
                    <th className="py-2.5 px-3 w-20 text-right">KKM</th>
                    <th className="py-2.5 px-3 w-28 text-right">Pengetahuan</th>
                    <th className="py-2.5 px-3 w-28 text-right">Keterampilan</th>
                    <th className="py-2.5 px-3 w-24 text-right">Nilai Akhir</th>
                    <th className="py-2.5 px-3 w-28">Predikat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draft.skillDigital.map((s, idx) => {
                    const tuntas = s.nilaiAkhir >= s.kkm;
                    return (
                      <tr key={s.no}>
                        <td className="py-2.5 px-3 font-mono text-slate-500">{s.no}</td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={s.materiSkill}
                            onChange={(e) => {
                              const next = [...draft.skillDigital];
                              next[idx] = { ...next[idx], materiSkill: e.target.value };
                              updateDraft((p) => ({ ...p, skillDigital: next }));
                            }}
                            className="w-full px-2 py-1 border border-slate-200 rounded-md font-medium"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {s.kkm}
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={s.pengetahuan}
                            onChange={(e) => {
                              const next = [...draft.skillDigital];
                              next[idx] = {
                                ...next[idx],
                                pengetahuan: Number(e.target.value),
                              };
                              updateDraft((p) => ({ ...p, skillDigital: next }));
                            }}
                            className="w-full px-2 py-1 border border-slate-200 rounded-md font-mono text-right"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={s.keterampilan}
                            onChange={(e) => {
                              const next = [...draft.skillDigital];
                              next[idx] = {
                                ...next[idx],
                                keterampilan: Number(e.target.value),
                              };
                              updateDraft((p) => ({ ...p, skillDigital: next }));
                            }}
                            className="w-full px-2 py-1 border border-slate-200 rounded-md font-mono text-right"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                          {s.nilaiAkhir}
                        </td>
                        <td className="py-2.5 px-3 font-semibold">
                          <span
                            className={
                              s.nilaiAkhir === 0
                                ? 'text-slate-400'
                                : tuntas
                                ? 'text-emerald-700'
                                : 'text-rose-600'
                            }
                          >
                            {s.nilaiAkhir === 0 ? '—' : `${s.predikat} (${tuntas ? 'Tuntas' : 'Belum'})`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: KEHADIRAN, CATATAN & KEPUTUSAN */}
      {tab === 'catatan' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="font-display font-bold text-slate-900 text-sm">
              E. Kehadiran Santri (Hari)
            </h3>
            <div className="space-y-3">
              {[
                { key: 'sakit' as const, label: 'Sakit' },
                { key: 'izin' as const, label: 'Izin' },
                { key: 'alpa' as const, label: 'Alpa (tanpa keterangan)' },
              ].map((item) => (
                <div key={item.key}>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {item.label}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.kehadiran[item.key]}
                    onChange={(e) =>
                      updateDraft((p) => ({
                        ...p,
                        kehadiran: {
                          ...p.kehadiran,
                          [item.key]: Number(e.target.value),
                        },
                      }))
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-3">
              <h4 className="font-display font-bold text-slate-900 text-sm">
                Keputusan Semester
              </h4>
              <select
                value={draft.keputusanSemester}
                onChange={(e) =>
                  updateDraft((p) => ({
                    ...p,
                    keputusanSemester: e.target.value as KeputusanSemester,
                  }))
                }
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="Lanjut ke semester genap">Lanjut ke semester genap</option>
                <option value="Lanjut dengan bimbingan">Lanjut dengan bimbingan</option>
                <option value="Naik tingkat program">Naik tingkat program</option>
                <option value="Lainnya">Lainnya</option>
              </select>

              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(e) =>
                    updateDraft((p) => ({ ...p, published: e.target.checked }))
                  }
                  className="rounded border-slate-300 text-emerald-600"
                />
                <span>Terbitkan ke Portal Santri & Orang Tua</span>
              </label>
            </div>
          </div>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="font-display font-bold text-slate-900 text-sm">
              F. Catatan & Pesan Wali Kelas
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pesan Singkat Wali Kelas (Halaman 2 Rapor)
                </label>
                <textarea
                  rows={2}
                  value={draft.catatanWali.pesanSingkat}
                  onChange={(e) =>
                    updateDraft((p) => ({
                      ...p,
                      catatanWali: { ...p.catatanWali, pesanSingkat: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Perkembangan Menyeluruh (Diniyah, Tahfidz, Skill Digital)
                </label>
                <textarea
                  rows={2}
                  value={draft.catatanWali.perkembangan}
                  onChange={(e) =>
                    updateDraft((p) => ({
                      ...p,
                      catatanWali: { ...p.catatanWali, perkembangan: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Kekuatan Santri
                </label>
                <textarea
                  rows={2}
                  value={draft.catatanWali.kekuatan}
                  onChange={(e) =>
                    updateDraft((p) => ({
                      ...p,
                      catatanWali: { ...p.catatanWali, kekuatan: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Saran Semester Depan & Peran Orang Tua / Wali
                </label>
                <textarea
                  rows={2}
                  value={draft.catatanWali.saranSemesterDepan}
                  onChange={(e) =>
                    updateDraft((p) => ({
                      ...p,
                      catatanWali: {
                        ...p.catatanWali,
                        saranSemesterDepan: e.target.value,
                      },
                    }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
