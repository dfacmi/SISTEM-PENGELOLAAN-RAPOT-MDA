import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Printer,
  Save,
  SlidersHorizontal,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  DEFAULT_CHARACTER_PROGRAMS,
  DEFAULT_DIGITAL_SKILLS,
  DEFAULT_DINIYAH_MAPEL,
  DEFAULT_SIKAP_ASPEK,
} from '../data/seedData';
import {
  DiniyahSubject,
  DigitalSkillSubject,
  GradeWeights,
  KeputusanSemester,
  MdaDatabase,
  Predikat,
  SemesterReport,
  Student,
} from '../types/mda';
import {
  ACTIVE_DIGITAL_SKILL_NAMES,
  DEFAULT_GRADE_WEIGHTS,
  extractUniqueClasses,
  formatRupiah,
  generateParentPortfolioNarrative,
  getKategoriPredikat,
  getKkmPredicateBounds,
  hasSubjectComponents,
  hitungNrFromComponents,
  hitungPredikatByKkm,
  hitungRataRataDigital,
  hitungRataRataDiniyah,
  isRemovedDigitalSubject,
  matchesClassFilter,
  parseScoreInput,
  recalculateReport,
} from '../utils/grading';
import { StudentAvatar } from './MdaLogo';
import { TahfidzJuzDonutChart } from './TahfidzJuzDonutChart';

interface GradeEditorViewProps {
  db: MdaDatabase;
  selectedStudentId: string;
  selectedYear: string;
  selectedSemester: 'Gasal' | 'Genap';
  isBusy?: boolean;
  onSelectStudent: (id: string) => void;
  onSaveReport: (report: SemesterReport) => void;
  onSaveBatchReports: (reports: SemesterReport[], summaryLabel?: string) => void;
  onOpenPrint: (studentId: string) => void;
}

type EditorMode = 'mapel' | 'santri';
type EditorTab = 'ringkasan' | 'sikap' | 'tahfidz' | 'akademik' | 'catatan';

interface SubjectOption {
  key: string;
  category: 'diniyah' | 'digital';
  name: string;
  kkm: number;
  kitabMateri?: string;
}

interface ComponentDraftEntry {
  sk?: number;
  tg?: number;
  ul?: number;
  uas?: number;
  uasFromCbt?: boolean;
}

export function buildBaselineReportForStudent(
  student: Student,
  tahunAkademik: string,
  semester: 'Gasal' | 'Genap',
  db: MdaDatabase
): SemesterReport {
  const periodConfig =
    db.periods.find(
      (p) => p.tahunAkademik === tahunAkademik && p.semester === semester
    ) ||
    db.periods.find((p) => p.isActive) ||
    db.periods[0];

  const kkmDiniyah = periodConfig?.kkmDiniyah || 60;
  const kkmDigital = periodConfig?.kkmDigital || 70;

  return {
    id: `rep-${student.id}-${tahunAkademik}-${semester}`.replace(/\//g, '-'),
    studentId: student.id,
    tahunAkademik,
    semester,
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
      kkm: kkmDiniyah,
      nilai: 0,
      predikat: 'D',
      deskripsi: '',
    })),
    skillDigital: DEFAULT_DIGITAL_SKILLS.map((s) => ({
      ...s,
      kkm: kkmDigital,
      pengetahuan: 0,
      keterampilan: 0,
      nilaiAkhir: 0,
      predikat: 'D',
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
  };
}

function formatScoreValue(val?: number): string {
  return typeof val === 'number' && Number.isFinite(val) ? String(val) : '';
}

export const GradeEditorView: React.FC<GradeEditorViewProps> = ({
  db,
  selectedStudentId,
  selectedYear,
  selectedSemester,
  isBusy = false,
  onSelectStudent,
  onSaveReport,
  onSaveBatchReports,
  onOpenPrint,
}) => {
  const [editorMode, setEditorMode] = useState<EditorMode>('mapel');
  const [tab, setTab] = useState<EditorTab>('ringkasan');

  // Dynamic classes extracted from students + teachers
  const dynamicClasses = useMemo(
    () => extractUniqueClasses(db.students, db.teachers),
    [db.students, db.teachers]
  );

  // =========================================================
  // MODE 1: BULK "NILAI MATA PELAJARAN" PER KELAS
  // =========================================================
  const [bulkClassFilter, setBulkClassFilter] = useState<string>(() => {
    const classes = extractUniqueClasses(db.students, db.teachers);
    const firstNonEmpty = classes.find((c) => c.count > 0) || classes[0];
    return firstNonEmpty ? firstNonEmpty.name : 'ALL';
  });
  const [bulkYear, setBulkYear] = useState<string>(selectedYear);
  const [bulkSemester, setBulkSemester] = useState<'Gasal' | 'Genap'>(selectedSemester);
  const [showWeightEditor, setShowWeightEditor] = useState(false);
  const [weights, setWeights] = useState<GradeWeights>(DEFAULT_GRADE_WEIGHTS);
  const [bulkEdits, setBulkEdits] = useState<Record<string, ComponentDraftEntry>>({});

  useEffect(() => {
    setBulkYear(selectedYear);
    setBulkSemester(selectedSemester);
  }, [selectedYear, selectedSemester]);

  useEffect(() => {
    if (
      bulkClassFilter !== 'ALL' &&
      !dynamicClasses.some((c) => c.name.toLowerCase() === bulkClassFilter.toLowerCase())
    ) {
      setBulkClassFilter(dynamicClasses[0]?.name || 'ALL');
    }
  }, [dynamicClasses, bulkClassFilter]);

  const bulkPeriodConfig = useMemo(
    () =>
      db.periods.find(
        (p) => p.tahunAkademik === bulkYear && p.semester === bulkSemester
      ) ||
      db.periods.find((p) => p.isActive) ||
      db.periods[0],
    [db.periods, bulkYear, bulkSemester]
  );

  const bulkKkmDiniyah = bulkPeriodConfig?.kkmDiniyah || 60;
  const bulkKkmTahfidz = bulkPeriodConfig?.kkmTahfidz || 70;
  const bulkKkmDigital = bulkPeriodConfig?.kkmDigital || 70;

  // Dynamic combined list of Diniyah & Skill Digital subjects
  const subjectOptions = useMemo<SubjectOption[]>(() => {
    const diniyahMap = new Map<string, SubjectOption>();
    DEFAULT_DINIYAH_MAPEL.forEach((m) => {
      const k = m.mataPelajaran.trim().toLowerCase();
      diniyahMap.set(k, {
        key: `diniyah::${m.mataPelajaran.trim()}`,
        category: 'diniyah',
        name: m.mataPelajaran.trim(),
        kkm: bulkKkmDiniyah,
        kitabMateri: m.kitabMateri,
      });
    });
    db.reports.forEach((r) => {
      r.diniyah.forEach((d) => {
        const name = d.mataPelajaran.trim();
        if (!name) return;
        const k = name.toLowerCase();
        if (!diniyahMap.has(k)) {
          diniyahMap.set(k, {
            key: `diniyah::${name}`,
            category: 'diniyah',
            name,
            kkm: d.kkm || bulkKkmDiniyah,
            kitabMateri: d.kitabMateri,
          });
        }
      });
    });

    const digitalMap = new Map<string, SubjectOption>();
    DEFAULT_DIGITAL_SKILLS.forEach((s) => {
      const k = s.materiSkill.trim().toLowerCase();
      digitalMap.set(k, {
        key: `digital::${s.materiSkill.trim()}`,
        category: 'digital',
        name: s.materiSkill.trim(),
        kkm: bulkKkmDigital,
      });
    });
    db.reports.forEach((r) => {
      r.skillDigital.forEach((s) => {
        const name = s.materiSkill.trim();
        if (!name || name === '...............' || isRemovedDigitalSubject(name)) return;
        const k = name.toLowerCase();
        if (!digitalMap.has(k)) {
          digitalMap.set(k, {
            key: `digital::${name}`,
            category: 'digital',
            name,
            kkm: s.kkm || bulkKkmDigital,
          });
        }
      });
    });

    return [...Array.from(diniyahMap.values()), ...Array.from(digitalMap.values())];
  }, [db.reports, bulkKkmDiniyah, bulkKkmDigital]);

  const [selectedSubjectKey, setSelectedSubjectKey] = useState<string>(
    () => `diniyah::${DEFAULT_DINIYAH_MAPEL[0].mataPelajaran}`
  );

  const selectedSubject = useMemo(
    () =>
      subjectOptions.find((s) => s.key === selectedSubjectKey) ||
      subjectOptions[0],
    [subjectOptions, selectedSubjectKey]
  );

  // Clear buffered edits whenever class, subject, or semester changes
  useEffect(() => {
    setBulkEdits({});
  }, [bulkClassFilter, selectedSubjectKey, bulkYear, bulkSemester]);

  const bulkStudents = useMemo(
    () => db.students.filter((s) => matchesClassFilter(s.kelas, bulkClassFilter)),
    [db.students, bulkClassFilter]
  );

  const periodOptions = useMemo(() => {
    const map = new Map<string, { year: string; semester: 'Gasal' | 'Genap' }>();
    db.periods.forEach((p) => {
      map.set(`${p.tahunAkademik}::${p.semester}`, {
        year: p.tahunAkademik,
        semester: p.semester,
      });
    });
    map.set(`${selectedYear}::Gasal`, { year: selectedYear, semester: 'Gasal' });
    map.set(`${selectedYear}::Genap`, { year: selectedYear, semester: 'Genap' });
    return Array.from(map.values());
  }, [db.periods, selectedYear]);

  const getSavedSubjectItem = (
    student: Student
  ): {
    report: SemesterReport | undefined;
    diniyahItem?: DiniyahSubject;
    digitalItem?: DigitalSkillSubject;
  } => {
    const report = db.reports.find(
      (r) =>
        r.studentId === student.id &&
        r.tahunAkademik === bulkYear &&
        r.semester === bulkSemester
    );
    if (!report || !selectedSubject) return { report };
    const norm = selectedSubject.name.toLowerCase();
    if (selectedSubject.category === 'diniyah') {
      return {
        report,
        diniyahItem: report.diniyah.find(
          (d) => d.mataPelajaran.trim().toLowerCase() === norm
        ),
      };
    }
    return {
      report,
      digitalItem: report.skillDigital.find(
        (s) => s.materiSkill.trim().toLowerCase() === norm
      ),
    };
  };

  const getEffectiveEntry = (student: Student): {
    entry: ComponentDraftEntry;
    legacyFallbackNr: number;
    hasComponents: boolean;
    nr: number;
    predikat: Predikat;
    isDirty: boolean;
  } => {
    const { diniyahItem, digitalItem } = getSavedSubjectItem(student);
    const savedSource = selectedSubject?.category === 'diniyah' ? diniyahItem : digitalItem;
    const baseEntry: ComponentDraftEntry = {
      sk: savedSource?.sk,
      tg: savedSource?.tg,
      ul: savedSource?.ul,
      uas: savedSource?.uas,
      uasFromCbt: savedSource?.uasFromCbt,
    };

    const edited = bulkEdits[student.id];
    const entry: ComponentDraftEntry = edited ? { ...baseEntry, ...edited } : baseEntry;
    const legacyFallbackNr =
      selectedSubject?.category === 'diniyah'
        ? Number(diniyahItem?.nilai || 0)
        : Number(digitalItem?.nilaiAkhir || 0);

    const hasComp = hasSubjectComponents(entry);
    const computedNr = hasComp ? hitungNrFromComponents(entry, weights) : null;
    const nr = computedNr !== null ? computedNr : legacyFallbackNr;
    const subjectKkm =
      selectedSubject?.category === 'diniyah'
        ? diniyahItem?.kkm || bulkKkmDiniyah
        : digitalItem?.kkm || bulkKkmDigital;

    return {
      entry,
      legacyFallbackNr,
      hasComponents: hasComp,
      nr,
      predikat: hitungPredikatByKkm(nr, subjectKkm),
      isDirty: Boolean(edited),
    };
  };

  const handleBulkFieldChange = (
    student: Student,
    field: 'sk' | 'tg' | 'ul' | 'uas',
    rawValue: string
  ) => {
    const parsed = parseScoreInput(rawValue);
    setBulkEdits((prev) => {
      const currentSaved = getSavedSubjectItem(student);
      const savedSource =
        selectedSubject?.category === 'diniyah'
          ? currentSaved.diniyahItem
          : currentSaved.digitalItem;
      const existingEdit = prev[student.id] || {
        sk: savedSource?.sk,
        tg: savedSource?.tg,
        ul: savedSource?.ul,
        uas: savedSource?.uas,
        uasFromCbt: savedSource?.uasFromCbt,
      };
      return {
        ...prev,
        [student.id]: {
          ...existingEdit,
          [field]: parsed,
          ...(field === 'uas' ? { uasFromCbt: false } : {}),
        },
      };
    });
  };

  const dirtyStudentCount = Object.keys(bulkEdits).length;
  const totalWeightPct =
    Number(weights.sk || 0) +
    Number(weights.tg || 0) +
    Number(weights.ul || 0) +
    Number(weights.uas || 0);

  const handleSaveBulkMapel = () => {
    if (!selectedSubject) return;
    const editedIds = Object.keys(bulkEdits);
    if (editedIds.length === 0) return;

    const kkmOverrides = {
      kkmDiniyah: bulkKkmDiniyah,
      kkmTahfidz: bulkKkmTahfidz,
      kkmDigital: bulkKkmDigital,
    };

    const reportsToSave: SemesterReport[] = [];

    for (const stu of bulkStudents) {
      const edit = bulkEdits[stu.id];
      if (!edit) continue;

      const existing = db.reports.find(
        (r) =>
          r.studentId === stu.id &&
          r.tahunAkademik === bulkYear &&
          r.semester === bulkSemester
      );
      const baseReport = existing
        ? {
            ...existing,
            diniyah: existing.diniyah.map((d) => ({ ...d })),
            skillDigital: existing.skillDigital.map((s) => ({ ...s })),
            tahfidz: { ...existing.tahfidz },
            pilar: { ...existing.pilar },
          }
        : buildBaselineReportForStudent(stu, bulkYear, bulkSemester, db);

      const normName = selectedSubject.name.toLowerCase();
      if (selectedSubject.category === 'diniyah') {
        const idx = baseReport.diniyah.findIndex(
          (d) => d.mataPelajaran.trim().toLowerCase() === normName
        );
        if (idx >= 0) {
          baseReport.diniyah[idx] = {
            ...baseReport.diniyah[idx],
            sk: edit.sk,
            tg: edit.tg,
            ul: edit.ul,
            uas: edit.uas,
            uasFromCbt: edit.uasFromCbt,
          };
        } else {
          baseReport.diniyah.push({
            no: baseReport.diniyah.length + 1,
            mataPelajaran: selectedSubject.name,
            kitabMateri: selectedSubject.kitabMateri || '-',
            kkm: bulkKkmDiniyah,
            sk: edit.sk,
            tg: edit.tg,
            ul: edit.ul,
            uas: edit.uas,
            uasFromCbt: edit.uasFromCbt,
            nilai: 0,
            predikat: 'D',
            deskripsi: '',
          });
        }
      } else {
        const idx = baseReport.skillDigital.findIndex(
          (s) => s.materiSkill.trim().toLowerCase() === normName
        );
        if (idx >= 0) {
          baseReport.skillDigital[idx] = {
            ...baseReport.skillDigital[idx],
            kkm: baseReport.skillDigital[idx].kkm || bulkKkmDigital,
            sk: edit.sk,
            tg: edit.tg,
            ul: edit.ul,
            uas: edit.uas,
            uasFromCbt: edit.uasFromCbt,
          };
        } else {
          baseReport.skillDigital.push({
            no: baseReport.skillDigital.length + 1,
            materiSkill: selectedSubject.name,
            kkm: bulkKkmDigital,
            sk: edit.sk,
            tg: edit.tg,
            ul: edit.ul,
            uas: edit.uas,
            uasFromCbt: edit.uasFromCbt,
            pengetahuan: 0,
            keterampilan: 0,
            nilaiAkhir: 0,
            predikat: 'D',
          });
        }
      }

      const recalculated = recalculateReport(
        {
          ...baseReport,
          updatedAt: new Date().toISOString(),
        },
        weights,
        kkmOverrides
      );
      reportsToSave.push(recalculated);
    }

    if (reportsToSave.length > 0) {
      onSaveBatchReports(
        reportsToSave,
        `${selectedSubject.name} (${bulkClassFilter === 'ALL' ? 'Semua Kelas' : bulkClassFilter} · ${bulkSemester} ${bulkYear})`
      );
      setBulkEdits({});
    }
  };

  // =========================================================
  // MODE 2: INDIVIDUAL STUDENT RAPOR EDITOR
  // =========================================================
  const [santriModeClassFilter, setSantriModeClassFilter] = useState<string>('ALL');

  const filteredStudentsForIndividual = useMemo(
    () => db.students.filter((s) => matchesClassFilter(s.kelas, santriModeClassFilter)),
    [db.students, santriModeClassFilter]
  );

  const student = useMemo(
    () =>
      filteredStudentsForIndividual.find((s) => s.id === selectedStudentId) ||
      db.students.find((s) => s.id === selectedStudentId) ||
      filteredStudentsForIndividual[0] ||
      db.students[0],
    [filteredStudentsForIndividual, db.students, selectedStudentId]
  );

  const periodConfig = useMemo(
    () =>
      db.periods.find(
        (p) => p.tahunAkademik === selectedYear && p.semester === selectedSemester
      ) ||
      db.periods.find((p) => p.isActive) ||
      db.periods[0],
    [db.periods, selectedYear, selectedSemester]
  );

  const periodKkmOverrides = useMemo(
    () => ({
      kkmDiniyah: periodConfig?.kkmDiniyah || 60,
      kkmTahfidz: periodConfig?.kkmTahfidz || 70,
      kkmDigital: periodConfig?.kkmDigital || 70,
    }),
    [periodConfig]
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

  const prepareReportDraft = (base: SemesterReport): SemesterReport => {
    const kkmDigital = periodKkmOverrides.kkmDigital || 70;
    const existingSkills = (base.skillDigital || []).map((s) => ({ ...s }));
    const existingKeys = new Set(
      existingSkills.map((s) => s.materiSkill.trim().toLowerCase())
    );
    for (const name of ACTIVE_DIGITAL_SKILL_NAMES) {
      if (!existingKeys.has(name.toLowerCase())) {
        existingSkills.push({
          no: existingSkills.length + 1,
          materiSkill: name,
          kkm: kkmDigital,
          pengetahuan: 0,
          keterampilan: 0,
          nilaiAkhir: 0,
          predikat: 'D',
        });
      }
    }
    return recalculateReport(
      {
        ...base,
        skillDigital: existingSkills,
      },
      weights,
      periodKkmOverrides
    );
  };

  const [draft, setDraft] = useState<SemesterReport>(() =>
    existingReport
      ? prepareReportDraft(existingReport)
      : student
        ? buildBaselineReportForStudent(student, selectedYear, selectedSemester, db)
        : ({} as SemesterReport)
  );

  useEffect(() => {
    if (!student) return;
    setDraft(
      existingReport
        ? prepareReportDraft(existingReport)
        : buildBaselineReportForStudent(student, selectedYear, selectedSemester, db)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, selectedYear, selectedSemester, existingReport?.id, existingReport?.updatedAt]);

  const updateDraft = (updater: (prev: SemesterReport) => SemesterReport) => {
    setDraft((prev) => recalculateReport(updater(prev), weights, periodKkmOverrides));
  };

  const diniyahAvg = draft?.diniyah ? hitungRataRataDiniyah(draft.diniyah) : 0;
  const digitalAvg = draft?.skillDigital ? hitungRataRataDigital(draft.skillDigital) : 0;

  if (!student) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        Tambahkan minimal satu santri terlebih dahulu di menu Data Santri.
      </div>
    );
  }

  const activeSubjectKkm = selectedSubject?.kkm || (selectedSubject?.category === 'diniyah' ? bulkKkmDiniyah : bulkKkmDigital);
  const activeSubjectBounds = getKkmPredicateBounds(activeSubjectKkm);

  return (
    <div className="space-y-4 sm:space-y-5 min-w-0 max-w-full">
      {/* Top Mode Switcher */}
      <div className="bg-white border border-emerald-200/80 rounded-2xl p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xs">
        <div className="grid grid-cols-2 sm:flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setEditorMode('mapel')}
            className={`min-h-[42px] inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors ${
              editorMode === 'mapel'
                ? 'bg-[#0E2228] text-[#1DF27A] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardList className="w-4 h-4 shrink-0" />
            <span className="truncate">Nilai Mata Pelajaran</span>
          </button>
          <button
            type="button"
            onClick={() => setEditorMode('santri')}
            className={`min-h-[42px] inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors ${
              editorMode === 'santri'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span className="truncate">Rapor Per Santri</span>
          </button>
        </div>

        <div className="text-xs text-slate-600 px-2 hidden sm:block">
          {editorMode === 'mapel'
            ? 'Input nilai massal SK, TG, UL, UAS per kelas & mapel — otomatis hitung NR dan sinkron ke Rapor & PDF.'
            : 'Edit lengkap 5 Pilar, Sikap, Tahfidz, Diniyah, Skill Digital, Kehadiran & Catatan Wali.'}
        </div>
      </div>

      {/* ================================================================= */}
      {/* MODE 1: BULK NILAI MATA PELAJARAN (SK | TG | UL | UAS | NR)      */}
      {/* ================================================================= */}
      {editorMode === 'mapel' && (
        <div className="space-y-4 min-w-0 max-w-full">
          {/* Filter Header + Top-Right Simpan */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 uppercase tracking-wider">
                  <BookOpen className="w-4 h-4 shrink-0" />
                  <span>Input Nilai Mata Pelajaran Per Kelas</span>
                </div>
                <h2 className="font-display font-bold text-slate-900 text-lg sm:text-xl mt-0.5 break-words">
                  {selectedSubject?.name || 'Mata Pelajaran'} ·{' '}
                  {bulkClassFilter === 'ALL' ? 'Semua Kelas' : bulkClassFilter}
                </h2>
              </div>

              <button
                type="button"
                disabled={dirtyStudentCount === 0 || isBusy}
                onClick={handleSaveBulkMapel}
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-xs disabled:opacity-45 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <Save className="w-4 h-4 shrink-0" />
                <span>
                  {dirtyStudentCount > 0
                    ? `Simpan (${dirtyStudentCount} Santri)`
                    : 'Simpan'}
                </span>
              </button>
            </div>

            {/* 3 Filter Dropdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Kelas
                </label>
                <select
                  value={bulkClassFilter}
                  onChange={(e) => setBulkClassFilter(e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm font-semibold border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                >
                  <option value="ALL">Semua Kelas ({db.students.length} Santri)</option>
                  {dynamicClasses.map((cls) => (
                    <option key={cls.key} value={cls.name}>
                      {cls.name} ({cls.count} Santri)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Mata Pelajaran
                </label>
                <select
                  value={selectedSubject?.key || ''}
                  onChange={(e) => setSelectedSubjectKey(e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm font-semibold border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                >
                  <optgroup label={`Mapel Diniyah (UL = Ujian Lisan · KKM ${bulkKkmDiniyah})`}>
                    {subjectOptions
                      .filter((s) => s.category === 'diniyah')
                      .map((s) => (
                        <option key={s.key} value={s.key}>
                          Diniyah: {s.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label={`Skill Digital / IT (UL = Keterampilan · KKM ${bulkKkmDigital})`}>
                    {subjectOptions
                      .filter((s) => s.category === 'digital')
                      .map((s) => (
                        <option key={s.key} value={s.key}>
                          Skill Digital: {s.name}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Semester / Periode
                </label>
                <select
                  value={`${bulkYear}::${bulkSemester}`}
                  onChange={(e) => {
                    const [yr, sem] = e.target.value.split('::');
                    setBulkYear(yr);
                    setBulkSemester(sem === 'Genap' ? 'Genap' : 'Gasal');
                  }}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm font-semibold border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                >
                  {periodOptions.map((p) => (
                    <option key={`${p.year}::${p.semester}`} value={`${p.year}::${p.semester}`}>
                      Semester {p.semester} · {p.year}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Dynamic UL Component Badge + Optional Weight Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`px-3 py-1.5 rounded-lg font-bold border ${
                    selectedSubject?.category === 'diniyah'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-sky-50 border-sky-200 text-sky-900'
                  }`}
                >
                  {selectedSubject?.category === 'diniyah'
                    ? 'UL: Ujian Lisan'
                    : 'UL: Keterampilan (Mapel IT)'}
                </span>
                <span className="px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 font-mono font-semibold text-slate-700 tabular-nums">
                  KKM {activeSubjectKkm} · A ≥ {activeSubjectBounds.minA} | B ≥{' '}
                  {activeSubjectBounds.minB} | C ≥ {activeSubjectBounds.minC}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setShowWeightEditor((v) => !v)}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
              >
                <SlidersHorizontal className="w-4 h-4 text-emerald-600" />
                <span>
                  Bobot: {weights.sk}/{weights.tg}/{weights.ul}/{weights.uas}%
                </span>
              </button>
            </div>

            {showWeightEditor && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">
                    Pengaturan % Bobot Komponen (Total saat ini: {totalWeightPct}%)
                  </span>
                  <button
                    type="button"
                    onClick={() => setWeights(DEFAULT_GRADE_WEIGHTS)}
                    className="text-emerald-700 font-semibold hover:underline"
                  >
                    Reset 25/25/25/25
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2.5">
                  {(
                    [
                      { key: 'sk', label: 'SK (%)' },
                      { key: 'tg', label: 'TG (%)' },
                      { key: 'ul', label: 'UL (%)' },
                      { key: 'uas', label: 'UAS (%)' },
                    ] as const
                  ).map((item) => (
                    <div key={item.key}>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        {item.label}
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={100}
                        value={weights[item.key]}
                        onChange={(e) =>
                          setWeights((prev) => ({
                            ...prev,
                            [item.key]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                          }))
                        }
                        className="w-full h-10 px-2.5 py-1.5 text-base sm:text-sm font-mono border border-slate-200 rounded-lg bg-white text-center"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bulk Grade Table (Desktop Table + Mobile Zero-Overflow Stack) */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#0E2228] text-white text-xs">
                    <th className="py-3.5 px-3 w-12 text-center">No</th>
                    <th className="py-3.5 px-3">Nama Santri</th>
                    <th className="py-3.5 px-2 w-24 text-center">SK</th>
                    <th className="py-3.5 px-2 w-24 text-center">TG</th>
                    <th className="py-3.5 px-2 w-32 text-center">
                      UL{' '}
                      <span className="block text-xs font-normal text-emerald-300">
                        {selectedSubject?.category === 'diniyah'
                          ? '(Ujian Lisan)'
                          : '(Keterampilan)'}
                      </span>
                    </th>
                    <th className="py-3.5 px-2 w-32 text-center">
                      UAS
                      <span className="block text-xs font-normal text-slate-300">
                        (CBT / Ujian)
                      </span>
                    </th>
                    <th className="py-3.5 px-3 w-32 text-center">NR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bulkStudents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-sm text-slate-500">
                        Belum ada santri di kelas {bulkClassFilter}.
                      </td>
                    </tr>
                  ) : (
                    bulkStudents.map((stu, idx) => {
                      const info = getEffectiveEntry(stu);
                      const isTuntas = info.nr >= activeSubjectKkm;
                      return (
                        <tr
                          key={stu.id}
                          className={`transition-colors ${
                            info.isDirty ? 'bg-amber-50/40' : 'hover:bg-emerald-50/30'
                          }`}
                        >
                          <td className="py-3 px-3 text-center font-mono text-xs text-slate-500 tabular-nums">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-900 text-sm">{stu.nama}</div>
                            <div className="text-xs font-mono text-slate-500 mt-0.5">
                              {stu.nisnMda} · {stu.kelas}
                            </div>
                          </td>
                          {(['sk', 'tg', 'ul', 'uas'] as const).map((field) => (
                            <td key={field} className="py-2.5 px-2">
                              <div className="relative">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  max={100}
                                  step="0.1"
                                  placeholder="—"
                                  value={formatScoreValue(info.entry[field])}
                                  onChange={(e) =>
                                    handleBulkFieldChange(stu, field, e.target.value)
                                  }
                                  className={`w-full h-10 px-2.5 py-1.5 text-sm font-mono text-center border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${
                                    field === 'uas' && info.entry.uasFromCbt
                                      ? 'border-sky-300 bg-sky-50/70 font-bold text-sky-950'
                                      : 'border-slate-200 bg-white'
                                  }`}
                                />
                                {field === 'uas' && info.entry.uasFromCbt && (
                                  <span
                                    title="Nilai otomatis dari Ujian CBT"
                                    className="block text-xs text-center font-bold text-sky-700 mt-0.5"
                                  >
                                    Dari CBT
                                  </span>
                                )}
                              </div>
                            </td>
                          ))}
                          <td className="py-3 px-3 text-center">
                            <div className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 font-mono text-sm font-bold tabular-nums">
                              <span className="text-slate-900">
                                {info.hasComponents || info.nr > 0 ? info.nr : '—'}
                              </span>
                              {(info.hasComponents || info.nr > 0) && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-xs ${
                                    isTuntas
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-700'
                                  }`}
                                >
                                  {info.predikat}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Fit-Screen List (360px - 430px without right-edge clipping) */}
            <div className="md:hidden divide-y divide-slate-100">
              {bulkStudents.length === 0 ? (
                <div className="py-8 px-4 text-center text-sm text-slate-500">
                  Belum ada santri di kelas {bulkClassFilter}.
                </div>
              ) : (
                bulkStudents.map((stu, idx) => {
                  const info = getEffectiveEntry(stu);
                  const isTuntas = info.nr >= activeSubjectKkm;
                  return (
                    <div
                      key={stu.id}
                      className={`p-3.5 space-y-2.5 ${
                        info.isDirty ? 'bg-amber-50/40' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-slate-900 leading-snug line-clamp-2 break-words">
                            {idx + 1}. {stu.nama}
                          </div>
                          <div className="text-xs font-mono text-slate-500 truncate mt-0.5">
                            {stu.kelas} · {stu.nisnMda}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-xs font-semibold text-slate-500 uppercase">
                            NR
                          </div>
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 font-mono text-sm font-bold tabular-nums">
                            <span className="text-slate-900">
                              {info.hasComponents || info.nr > 0 ? info.nr : '—'}
                            </span>
                            {(info.hasComponents || info.nr > 0) && (
                              <span
                                className={`px-1.5 rounded text-xs ${
                                  isTuntas
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-700'
                                }`}
                              >
                                {info.predikat}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        {(
                          [
                            { key: 'sk', label: 'SK' },
                            { key: 'tg', label: 'TG' },
                            { key: 'ul', label: 'UL' },
                            { key: 'uas', label: 'UAS' },
                          ] as const
                        ).map((col) => (
                          <div key={col.key} className="min-w-0">
                            <label className="flex items-center justify-between text-xs font-bold text-slate-600 mb-1 px-0.5">
                              <span>{col.label}</span>
                              {col.key === 'uas' && info.entry.uasFromCbt && (
                                <span className="text-xs font-bold text-sky-700">
                                  CBT
                                </span>
                              )}
                            </label>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={100}
                              step="0.1"
                              placeholder="—"
                              value={formatScoreValue(info.entry[col.key])}
                              onChange={(e) =>
                                handleBulkFieldChange(stu, col.key, e.target.value)
                              }
                              className={`w-full h-11 px-1.5 py-1.5 text-base sm:text-sm font-mono text-center border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${
                                col.key === 'uas' && info.entry.uasFromCbt
                                  ? 'border-sky-300 bg-sky-50/70 font-bold text-sky-950'
                                  : 'border-slate-200 bg-slate-50 focus:bg-white'
                              }`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Legend + Bottom-Right Simpan */}
            <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-600 space-y-1 min-w-0">
                <div className="font-bold text-slate-800">Keterangan Singkatan Kolom:</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 leading-relaxed">
                  <span>
                    <strong>SK</strong>: Sikap
                  </span>
                  <span>
                    <strong>TG</strong>: Tugas
                  </span>
                  <span>
                    <strong>UL</strong>:{' '}
                    {selectedSubject?.category === 'diniyah'
                      ? 'Ujian Lisan (Diniyah)'
                      : 'Keterampilan (Mapel IT / Skill Digital)'}
                  </span>
                  <span>
                    <strong>UAS</strong>: Ujian Akhir Semester (Otomatis dari CBT bila ujian disinkronkan)
                  </span>
                  <span>
                    <strong>NR</strong>: Nilai Rapor (Otomatis terhubung ke Rapor &amp; PDF)
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={dirtyStudentCount === 0 || isBusy}
                onClick={handleSaveBulkMapel}
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-xs disabled:opacity-45 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  {dirtyStudentCount > 0
                    ? `Simpan (${dirtyStudentCount} Santri)`
                    : 'Simpan'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODE 2: INDIVIDUAL STUDENT RAPOR EDITOR                           */}
      {/* ================================================================= */}
      {editorMode === 'santri' && (
        <div className="space-y-5 min-w-0 max-w-full">
          {/* Top Santri Selector & Save Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 min-w-0">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <StudentAvatar
                name={student.nama}
                fotoUrl={student.fotoUrl}
                className="w-12 h-12 text-sm shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <select
                    value={santriModeClassFilter}
                    onChange={(e) => {
                      const nextClass = e.target.value;
                      setSantriModeClassFilter(nextClass);
                      const firstMatch = db.students.find((s) =>
                        matchesClassFilter(s.kelas, nextClass)
                      );
                      if (firstMatch) onSelectStudent(firstMatch.id);
                    }}
                    aria-label="Filter Kelas Santri"
                    className="w-full sm:w-auto max-w-full min-w-0 h-11 text-base sm:text-sm font-semibold text-slate-800 bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2"
                  >
                    <option value="ALL">Semua Kelas ({db.students.length})</option>
                    {dynamicClasses.map((cls) => (
                      <option key={cls.key} value={cls.name}>
                        {cls.name} ({cls.count})
                      </option>
                    ))}
                  </select>

                  <select
                    value={student.id}
                    onChange={(e) => onSelectStudent(e.target.value)}
                    className="w-full sm:w-auto max-w-full min-w-0 truncate h-11 font-display font-bold text-slate-900 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  >
                    {filteredStudentsForIndividual.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nama} ({s.kelas})
                      </option>
                    ))}
                  </select>
                  <span className="font-mono text-xs text-emerald-700 font-semibold">
                    {student.nisnMda}
                  </span>
                </div>
                <div className="text-xs sm:text-sm text-slate-500 mt-1.5 break-words">
                  Semester {selectedSemester} {selectedYear} · Wali Kelas: {student.waliKelasNama}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full lg:w-auto shrink-0">
              <button
                type="button"
                onClick={() =>
                  updateDraft((prev) => ({
                    ...prev,
                    pilar: { ...prev.pilar, autoCalculate: true },
                  }))
                }
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs sm:text-sm font-semibold whitespace-nowrap"
              >
                <Calculator className="w-4 h-4 text-emerald-600" />
                <span>Hitung Pilar Otomatis</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenPrint(student.id)}
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-900 text-white hover:bg-slate-800 text-xs sm:text-sm font-semibold whitespace-nowrap"
              >
                <Printer className="w-4 h-4" />
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
                className="min-[420px]:col-span-2 sm:col-span-1 w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-semibold whitespace-nowrap"
              >
                <Save className="w-4 h-4" />
                <span>Simpan Nilai Rapor</span>
              </button>
            </div>
          </div>

          {/* Editor Section Tabs */}
          <div className="w-full max-w-full flex items-center gap-1.5 p-1.5 bg-slate-100 rounded-xl overflow-x-auto">
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
                className={`min-h-[42px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
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
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-w-0">
              <div className="lg:col-span-6 min-w-0 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display font-bold text-slate-900 text-base">
                      Ringkasan Capaian 5 Pilar (%)
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-500">
                      Otomatis dari kalkulasi direktarium atau sesuaikan manual
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-700 cursor-pointer">
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
                    <div key={item.key} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs sm:text-sm font-semibold text-slate-700">
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
                          className="w-20 h-10 px-2.5 py-1.5 text-base sm:text-sm font-mono border border-slate-200 rounded-lg text-right disabled:bg-slate-50"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-6 min-w-0 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                <div>
                  <h3 className="font-display font-bold text-slate-900 text-base">
                    Statistik Project &amp; Capaian MDA (Halaman 2 Rapor)
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500">
                    Rekap kegiatan character building, client project, dan income santri
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { key: 'characterBuildingCount' as const, label: 'Character Building (x)' },
                    { key: 'multimediaProjectCount' as const, label: 'Multimedia Project' },
                    { key: 'clientProjectCount' as const, label: 'Client Project' },
                    { key: 'mdaMengajarCount' as const, label: 'MDA Mengajar (x)' },
                    { key: 'produksiKontenCount' as const, label: 'Produksi Konten' },
                  ].map((field) => (
                    <div key={field.key}>
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                        {field.label}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={draft.kpiMda[field.key]}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            kpiMda: {
                              ...p.kpiMda,
                              [field.key]: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-full h-11 px-3.5 py-2 text-base sm:text-sm font-mono border border-slate-200 rounded-xl"
                      />
                    </div>
                  ))}

                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                      Income Project (Rp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={50000}
                      value={draft.kpiMda.incomeRp}
                      onChange={(e) =>
                        updateDraft((p) => ({
                          ...p,
                          kpiMda: {
                            ...p.kpiMda,
                            incomeRp: Number(e.target.value),
                          },
                        }))
                      }
                      className="w-full h-11 px-3.5 py-2 text-base sm:text-sm font-mono border border-slate-200 rounded-xl"
                    />
                    <div className="text-xs text-emerald-700 mt-1.5 font-mono">
                      {formatRupiah(draft.kpiMda.incomeRp)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SIKAP & CHARACTER BUILDING */}
          {tab === 'sikap' && (
            <div className="space-y-6 min-w-0">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-200">
                  <h3 className="font-display font-bold text-slate-900 text-base">
                    A. Penilaian Sikap dan Character
                  </h3>
                </div>
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-900 text-white text-xs">
                        <th className="py-3 px-4 w-12">No</th>
                        <th className="py-3 px-4">Aspek Penilaian</th>
                        <th className="py-3 px-4 w-36">Predikat</th>
                        <th className="py-3 px-4">Deskripsi Sikap</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {draft.sikap.map((item, idx) => (
                        <tr key={item.aspek}>
                          <td className="py-3 px-4 font-mono text-xs text-slate-500">{idx + 1}</td>
                          <td className="py-3 px-4 font-medium text-slate-900">
                            {item.aspek}
                          </td>
                          <td className="py-2.5 px-4">
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
                              className="w-full h-10 px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono text-sm font-bold bg-white"
                            >
                              <option value="A">A (Sangat Baik)</option>
                              <option value="B">B (Baik)</option>
                              <option value="C">C (Cukup)</option>
                              <option value="D">D (Bimbingan)</option>
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
                              placeholder="Tulis deskripsi sikap santri..."
                              className="w-full h-10 px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-200">
                  <h3 className="font-display font-bold text-slate-900 text-base">
                    Program Character Building MDA
                  </h3>
                </div>
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[540px] text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-900 text-white text-xs">
                        <th className="py-3 px-4 w-12">No</th>
                        <th className="py-3 px-4 w-64">Kegiatan</th>
                        <th className="py-3 px-4">Keterangan Pelaksanaan / Capaian</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {draft.characterPrograms.map((prog, idx) => (
                        <tr key={prog.kegiatan}>
                          <td className="py-3 px-4 font-mono text-xs text-slate-500">{idx + 1}</td>
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {prog.kegiatan}
                          </td>
                          <td className="py-2.5 px-4">
                            <input
                              type="text"
                              value={prog.keterangan}
                              onChange={(e) => {
                                const next = [...draft.characterPrograms];
                                next[idx] = { ...next[idx], keterangan: e.target.value };
                                updateDraft((p) => ({ ...p, characterPrograms: next }));
                              }}
                              placeholder="Contoh: Mengikuti dan aktif dalam kegiatan..."
                              className="w-full h-10 px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TAHFIDZ */}
          {tab === 'tahfidz' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-w-0">
              <div className="lg:col-span-6 min-w-0 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                <h3 className="font-display font-bold text-slate-900 text-base">
                  B. Capaian Hafalan Al-Qur’an
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    {
                      key: 'totalHafalan' as const,
                      label: 'Total Hafalan',
                      ph: '5 Juz (Juz 30, 29, 1, 2, 3)',
                    },
                    {
                      key: 'capaianSemesterIni' as const,
                      label: 'Capaian Semester Ini',
                      ph: '1 Juz',
                    },
                    {
                      key: 'totalJuziyah' as const,
                      label: 'Total Juziyah',
                      ph: '3 kali (Juz 30, 29, 1)',
                    },
                    {
                      key: 'totalSetoranZiyadah' as const,
                      label: 'Total Setoran Ziyadah',
                      ph: '26 halaman',
                    },
                    {
                      key: 'totalMurojaah' as const,
                      label: 'Total Murojaah',
                      ph: '4 Juz',
                    },
                  ].map((field) => (
                    <div
                      key={field.key}
                      className={field.key === 'totalHafalan' ? 'sm:col-span-2' : ''}
                    >
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
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
                        className="w-full h-11 px-3.5 py-2 text-base sm:text-sm border border-slate-200 rounded-xl"
                      />
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-slate-100 flex flex-col min-[420px]:flex-row min-[420px]:items-center justify-between gap-3">
                  <div className="text-xs text-slate-600 leading-relaxed">
                    <span className="font-semibold text-slate-800 block">
                      Pratinjau Progres 30 Juz di Rapor &amp; PDF
                    </span>
                    Dihitung otomatis dari isian Total Hafalan (misal &ldquo;5 Juz&rdquo; atau &ldquo;5 Juz 10 halaman&rdquo;).
                  </div>
                  <div className="shrink-0">
                    <TahfidzJuzDonutChart tahfidz={draft.tahfidz} />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-6 min-w-0 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h3 className="font-display font-bold text-slate-900 text-base">
                    Aspek Penilaian Tahfidz (KKM {periodKkmOverrides.kkmTahfidz})
                  </h3>
                  <div className="font-mono text-xs sm:text-sm font-bold text-emerald-700 tabular-nums">
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
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
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
                        className="w-full h-11 px-3.5 py-2 text-base sm:text-sm font-mono border border-slate-200 rounded-xl"
                      />
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
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
                    className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl leading-relaxed"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: DINIYAH & SKILL DIGITAL */}
          {tab === 'akademik' && (
            <div className="space-y-6 min-w-0">
              {/* C. DINIYAH */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display font-bold text-slate-900 text-base">
                      C. Mata Pelajaran Diniyah (KKM {periodKkmOverrides.kkmDiniyah})
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Untuk input komponen SK/TG/UL/UAS per kelas, gunakan tab &ldquo;Nilai Mata Pelajaran&rdquo; di atas.
                    </p>
                  </div>
                  <div className="font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums">
                    Rata-rata Diniyah: {diniyahAvg} (
                    {hitungPredikatByKkm(diniyahAvg, periodKkmOverrides.kkmDiniyah)})
                  </div>
                </div>
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-900 text-white text-xs">
                        <th className="py-3 px-3 w-10">No</th>
                        <th className="py-3 px-3">Mata Pelajaran</th>
                        <th className="py-3 px-3">Kitab / Materi</th>
                        <th className="py-3 px-3 w-20 text-right">KKM</th>
                        <th className="py-3 px-3 w-24 text-right">Nilai</th>
                        <th className="py-3 px-3 w-32">Status KKM</th>
                        <th className="py-3 px-3">Deskripsi Capaian</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {draft.diniyah.map((d, idx) => {
                        const tuntas = d.nilai >= d.kkm;
                        return (
                          <tr key={d.no}>
                            <td className="py-3 px-3 font-mono text-xs text-slate-500">{d.no}</td>
                            <td className="py-3 px-3 font-semibold text-slate-900">
                              <div>{d.mataPelajaran}</div>
                              {hasSubjectComponents(d) && (
                                <div className="text-xs font-mono text-slate-500 mt-0.5">
                                  SK:{d.sk ?? '—'} TG:{d.tg ?? '—'} UL:{d.ul ?? '—'} UAS:
                                  {d.uas ?? '—'}
                                </div>
                              )}
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
                                className="w-full h-10 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg"
                              />
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
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
                                  next[idx] = {
                                    ...next[idx],
                                    nilai: Number(e.target.value),
                                    sk: undefined,
                                    tg: undefined,
                                    ul: undefined,
                                    uas: undefined,
                                    uasFromCbt: false,
                                  };
                                  updateDraft((p) => ({ ...p, diniyah: next }));
                                }}
                                className="w-full h-10 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono text-right"
                              />
                            </td>
                            <td className="py-3 px-3 font-semibold text-xs sm:text-sm">
                              <span className={tuntas ? 'text-emerald-700' : 'text-rose-600'}>
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
                                className="w-full h-10 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg"
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
                <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display font-bold text-slate-900 text-base">
                      D. Skill Digital (KKM {periodKkmOverrides.kkmDigital})
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Jika diisi via Nilai Mata Pelajaran: Pengetahuan = rata-rata (SK, TG, UAS), Keterampilan = UL, dan Nilai Akhir = NR.
                    </p>
                  </div>
                  <div className="font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums">
                    Rata-rata Skill Digital: {digitalAvg} (
                    {hitungPredikatByKkm(digitalAvg, periodKkmOverrides.kkmDigital)})
                  </div>
                </div>
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-900 text-white text-xs">
                        <th className="py-3 px-3 w-10">No</th>
                        <th className="py-3 px-3">Materi Skill</th>
                        <th className="py-3 px-3 w-20 text-right">KKM</th>
                        <th className="py-3 px-3 w-28 text-right">Pengetahuan</th>
                        <th className="py-3 px-3 w-28 text-right">Keterampilan</th>
                        <th className="py-3 px-3 w-24 text-right">Nilai Akhir</th>
                        <th className="py-3 px-3 w-32">Predikat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(() => {
                        const canonicalOrder = new Map<string, number>(
                          ACTIVE_DIGITAL_SKILL_NAMES.map((name, orderIdx) => [
                            name.toLowerCase(),
                            orderIdx,
                          ])
                        );
                        return draft.skillDigital
                          .map((s, rawIdx) => ({ s, rawIdx }))
                          .filter(({ s }) => !isRemovedDigitalSubject(s.materiSkill))
                          .sort((a, b) => {
                            const ordA =
                              canonicalOrder.get(a.s.materiSkill.trim().toLowerCase()) ?? 999;
                            const ordB =
                              canonicalOrder.get(b.s.materiSkill.trim().toLowerCase()) ?? 999;
                            if (ordA !== ordB) return ordA - ordB;
                            return a.rawIdx - b.rawIdx;
                          })
                          .map(({ s, rawIdx }, displayIdx) => {
                            const displayNo = displayIdx + 1;
                            const tuntas = s.nilaiAkhir >= s.kkm;
                            return (
                              <tr key={`${rawIdx}-${s.materiSkill}`}>
                                <td className="py-3 px-3 font-mono text-xs text-slate-500">
                                  {displayNo}
                                </td>
                                <td className="py-2.5 px-3">
                                  <input
                                    type="text"
                                    value={s.materiSkill}
                                    onChange={(e) => {
                                      const next = [...draft.skillDigital];
                                      next[rawIdx] = {
                                        ...next[rawIdx],
                                        no: displayNo,
                                        materiSkill: e.target.value,
                                      };
                                      updateDraft((p) => ({ ...p, skillDigital: next }));
                                    }}
                                    className="w-full h-10 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-medium"
                                  />
                                  {hasSubjectComponents(s) && (
                                    <div className="text-xs font-mono text-slate-500 mt-1">
                                      SK:{s.sk ?? '—'} TG:{s.tg ?? '—'} UL:{s.ul ?? '—'} UAS:
                                      {s.uas ?? '—'}
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-3 text-right font-mono tabular-nums">
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
                                      next[rawIdx] = {
                                        ...next[rawIdx],
                                        no: displayNo,
                                        pengetahuan: Number(e.target.value),
                                        sk: undefined,
                                        tg: undefined,
                                        ul: undefined,
                                        uas: undefined,
                                        uasFromCbt: false,
                                      };
                                      updateDraft((p) => ({ ...p, skillDigital: next }));
                                    }}
                                    className="w-full h-10 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono text-right"
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
                                      next[rawIdx] = {
                                        ...next[rawIdx],
                                        no: displayNo,
                                        keterampilan: Number(e.target.value),
                                        sk: undefined,
                                        tg: undefined,
                                        ul: undefined,
                                        uas: undefined,
                                        uasFromCbt: false,
                                      };
                                      updateDraft((p) => ({ ...p, skillDigital: next }));
                                    }}
                                    className="w-full h-10 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono text-right"
                                  />
                                </td>
                                <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                                  {s.nilaiAkhir}
                                </td>
                                <td className="py-3 px-3 font-semibold text-xs sm:text-sm">
                                  <span
                                    className={
                                      s.nilaiAkhir === 0
                                        ? 'text-slate-400'
                                        : tuntas
                                        ? 'text-emerald-700'
                                        : 'text-rose-600'
                                    }
                                  >
                                    {s.nilaiAkhir === 0
                                      ? '—'
                                      : `${s.predikat} (${tuntas ? 'Tuntas' : 'Belum'})`}
                                  </span>
                                </td>
                              </tr>
                            );
                          });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: KEHADIRAN, CATATAN & KEPUTUSAN */}
          {tab === 'catatan' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-w-0">
              <div className="lg:col-span-4 min-w-0 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                <h3 className="font-display font-bold text-slate-900 text-base">
                  E. Kehadiran Santri (Hari)
                </h3>
                <div className="space-y-3">
                  {[
                    { key: 'sakit' as const, label: 'Sakit' },
                    { key: 'izin' as const, label: 'Izin' },
                    { key: 'alpa' as const, label: 'Alpa (tanpa keterangan)' },
                  ].map((item) => (
                    <div key={item.key}>
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
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
                        className="w-full h-11 px-3.5 py-2 text-base sm:text-sm font-mono border border-slate-200 rounded-xl"
                      />
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-3">
                  <h4 className="font-display font-bold text-slate-900 text-base">
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
                    className="w-full h-11 px-3.5 py-2 text-base sm:text-sm border border-slate-200 rounded-xl bg-white"
                  >
                    <option value="Lanjut ke semester genap">Lanjut ke semester genap</option>
                    <option value="Lanjut dengan bimbingan">Lanjut dengan bimbingan</option>
                    <option value="Naik tingkat program">Naik tingkat program</option>
                    <option value="Lainnya">Lainnya</option>
                  </select>

                  <label className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-700 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={draft.published}
                      onChange={(e) =>
                        updateDraft((p) => ({ ...p, published: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span>Terbitkan ke Portal Santri &amp; Orang Tua</span>
                  </label>
                </div>
              </div>

              <div className="lg:col-span-8 min-w-0 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                <h3 className="font-display font-bold text-slate-900 text-base">
                  F. Catatan &amp; Pesan Wali Kelas
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
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
                      className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl leading-relaxed"
                    />
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
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
                      className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl leading-relaxed"
                    />
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
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
                      className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl leading-relaxed"
                    />
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                      Saran Semester Depan &amp; Peran Orang Tua / Wali
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
                      className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl leading-relaxed"
                    />
                  </div>

                  <div className="pt-3 border-t border-slate-100">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label className="block text-xs sm:text-sm font-semibold text-emerald-900">
                        Ringkasan Perkembangan Karya &amp; Kompetensi (Tampil di Rapor Hal. 5 &amp; Portal Wali)
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const studentProjects = db.portfolios.filter(
                            (p) => p.studentId === draft.studentId
                          );
                          const regenerated = generateParentPortfolioNarrative({
                            report: draft,
                            projects: studentProjects,
                          });
                          updateDraft((p) => ({
                            ...p,
                            ringkasanPortofolio: regenerated,
                          }));
                        }}
                        className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-xs font-semibold text-emerald-800 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Buat Ulang Otomatis</span>
                      </button>
                    </div>
                    <textarea
                      rows={4}
                      value={
                        draft.ringkasanPortofolio && draft.ringkasanPortofolio.trim() !== ''
                          ? draft.ringkasanPortofolio
                          : generateParentPortfolioNarrative({
                              report: draft,
                              projects: db.portfolios.filter(
                                (p) => p.studentId === draft.studentId
                              ),
                            })
                      }
                      onChange={(e) =>
                        updateDraft((p) => ({
                          ...p,
                          ringkasanPortofolio: e.target.value,
                        }))
                      }
                      className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-emerald-200 bg-emerald-50/30 rounded-xl leading-relaxed"
                    />
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      Otomatis dirangkum dalam bahasa yang mudah dipahami wali santri. Editan manual Anda tidak akan tertimpa kecuali Anda menekan &ldquo;Buat Ulang Otomatis&rdquo;.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
