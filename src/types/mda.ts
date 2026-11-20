export type UserRole = 'admin' | 'guru' | 'santri_ortu';

export type Predikat = 'A' | 'B' | 'C' | 'D';

export type KeputusanSemester =
  | 'Lanjut ke semester genap'
  | 'Lanjut dengan bimbingan'
  | 'Naik tingkat program'
  | 'Lainnya';

export interface AcademicPeriod {
  id: string;
  tahunAkademik: string;
  semester: 'Gasal' | 'Genap';
  tanggalRapor: string;
  kkmDiniyah: number;
  kkmTahfidz: number;
  kkmDigital: number;
  kepalaUnitMda: string;
  mudirPesantren: string;
  ttdKepalaUnitUrl?: string;
  ttdMudirUrl?: string;
  isActive: boolean;
}

export interface TeacherClass {
  id: string;
  nama: string;
  jabatan: string;
  email: string;
  kelasDiampu: string;
  role: 'admin' | 'guru';
  kodeGuru?: string;
  accessPin?: string;
  ttdUrl?: string;
}

export interface Student {
  id: string;
  nisnMda: string;
  nama: string;
  kelas: string;
  program: string;
  waliKelasId: string;
  waliKelasNama: string;
  fotoUrl: string;
  emailSantriOrtu: string;
  portfolioSlug: string;
  accessPin: string;
  statusAktif: 'Aktif' | 'Alumni' | 'Cuti';
}

export type MdaAccentTheme = 'mda-emerald' | 'darul-forest' | 'ocean-cyan';

export interface BrandingTemplateConfig {
  namaLembaga: string;
  namaPesantren: string;
  judulRapor: string;
  subjudulCompetence: string;
  labelCoverPortfolio: string;
  pesanPenutupHalaman2: string;
  pesanPenutupHalaman6: string;
  whatsapp: string;
  instagram: string;
  email: string;
  alamat: string;
  kotaTanggal: string;
  coverPhotoUrl: string;
  customLogoUrl: string;
  accentTheme: MdaAccentTheme;
  // Narasi Halaman Masuk (Login)
  loginHeadline: string;
  loginDescription: string;
  loginAdminInfo: string;
  loginParentInfo: string;
  // Narasi Dashboard Ringkasan Akademik
  dashboardRadarTitle: string;
  dashboardPillarTitle: string;
  dashboardPillarSubtitle: string;
  dashboardPillarNote: string;
  dashboardTableTitle: string;
  dashboardTableSubtitle: string;
  // Narasi Portal Santri & Portofolio
  portalTrendTitle: string;
  portalTrendSubtitle: string;
  portalPortfolioSubtitle: string;
  portalQrTitle: string;
  portalQrDescription: string;
  // Narasi Rapor PDF
  coverTagline: string;
  qrBannerTitle: string;
  qrBannerDescription: string;
  // Pengaturan Mode Pekan Ujian (Kunci Sementara Rapor)
  lockRaporDuringExam?: boolean;
  lockRaporMessage?: string;
}

export type CbtExamStatus = 'draft' | 'active' | 'finished';
export type CbtOptionKey = 'A' | 'B' | 'C' | 'D' | 'E';
export type CbtTargetRaporCategory = 'none' | 'diniyah' | 'skillDigital' | 'tahfidz';
export type CbtDigitalScoreTarget = 'pengetahuan' | 'keterampilan' | 'nilaiAkhir';
export type CbtAttemptStatus = 'in_progress' | 'locked' | 'submitted';

export interface CbtTargetRaporMapping {
  category: CbtTargetRaporCategory;
  subjectName: string;
  digitalField?: CbtDigitalScoreTarget;
}

export interface CbtExam {
  id: string;
  title: string;
  mapelCode?: string;
  deskripsi?: string;
  status: CbtExamStatus;
  token: string;
  durationMinutes: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  maxViolations: number;
  targetRaporMapping: CbtTargetRaporMapping;
  autoSyncToRapor: boolean;
  showScoreAfterFinish: boolean;
  tahunAkademik?: string;
  semester?: 'Gasal' | 'Genap';
  updatedAt: string;
}

export interface CbtQuestion {
  id: string;
  examId: string;
  orderNumber: number;
  pertanyaan: string;
  opsiA: string;
  opsiB: string;
  opsiC: string;
  opsiD: string;
  opsiE?: string;
  kunciJawaban: CbtOptionKey;
  imageUrl?: string;
}

export type StudentCbtQuestion = Omit<CbtQuestion, 'kunciJawaban'>;

export interface CbtViolationLog {
  timestamp: string;
  type:
    | 'fullscreen_exit'
    | 'tab_switch'
    | 'window_blur'
    | 'split_screen'
    | 'shortcut_blocked';
  detail: string;
}

export interface CbtAttempt {
  id: string;
  examId: string;
  studentId: string;
  studentName: string;
  studentNisn: string;
  studentKelas: string;
  status: CbtAttemptStatus;
  startedAt: string;
  submittedAt?: string;
  lastSavedAt: string;
  questionOrder: string[];
  answers: Record<string, CbtOptionKey>;
  raguIds: string[];
  currentQuestionIndex: number;
  violationCount: number;
  violations: CbtViolationLog[];
  benarCount?: number;
  salahCount?: number;
  totalQuestions?: number;
  score?: number;
  syncedToRaporAt?: string;
}

export interface PillarSummary {
  penguasaanMultimedia: number;
  diniyahPembelajaran: number;
  tahfidzulQuran: number;
  kesantrianKeasramaan: number;
  characterBuilding: number;
  autoCalculate: boolean;
}

export interface MdaKpiSummary {
  characterBuildingCount: number;
  multimediaProjectCount: number;
  clientProjectCount: number;
  mdaMengajarCount: number;
  incomeRp: number;
  produksiKontenCount: number;
}

export interface AttitudeItem {
  aspek: string;
  predikat: Predikat;
  deskripsi: string;
}

export interface CharacterProgramItem {
  kegiatan: string;
  keterangan: string;
}

export interface TahfidzAssessment {
  totalHafalan: string;
  capaianSemesterIni: string;
  totalJuziyah: string;
  totalSetoranZiyadah: string;
  totalMurojaah: string;
  kelancaran: number;
  tajwid: number;
  makhrajFashahah: number;
  ketepatanAyat: number;
  nilaiAkhir: number;
  predikat: Predikat;
  deskripsi: string;
}

export interface GradeWeights {
  sk: number;
  tg: number;
  ul: number;
  uas: number;
}

export interface DiniyahSubject {
  no: number;
  mataPelajaran: string;
  kitabMateri: string;
  kkm: number;
  sk?: number;
  tg?: number;
  ul?: number;
  uas?: number;
  uasFromCbt?: boolean;
  nilai: number;
  predikat: Predikat;
  deskripsi: string;
}

export interface DigitalSkillSubject {
  no: number;
  materiSkill: string;
  kkm: number;
  sk?: number;
  tg?: number;
  ul?: number;
  uas?: number;
  uasFromCbt?: boolean;
  pengetahuan: number;
  keterampilan: number;
  nilaiAkhir: number;
  predikat: Predikat;
}

export interface AttendanceRecord {
  sakit: number;
  izin: number;
  alpa: number;
}

export interface TeacherNotes {
  pesanSingkat: string;
  perkembangan: string;
  kekuatan: string;
  saranSemesterDepan: string;
}

export interface SemesterReport {
  id: string;
  studentId: string;
  tahunAkademik: string;
  semester: 'Gasal' | 'Genap';
  tanggalRapor: string;
  pilar: PillarSummary;
  kpiMda: MdaKpiSummary;
  sikap: AttitudeItem[];
  characterPrograms: CharacterProgramItem[];
  tahfidz: TahfidzAssessment;
  diniyah: DiniyahSubject[];
  skillDigital: DigitalSkillSubject[];
  kehadiran: AttendanceRecord;
  catatanWali: TeacherNotes;
  keputusanSemester: KeputusanSemester;
  keputusanLainnya?: string;
  published: boolean;
  updatedAt: string;
}

export interface PortfolioMediaItem {
  url: string;
  type: 'image' | 'video';
  caption: string;
  presetArt?: 'poster' | 'uiux' | 'photo' | 'video';
}

export interface PortfolioProject {
  id: string;
  studentId: string;
  tahunAkademik: string;
  semester: 'Gasal' | 'Genap';
  judul: string;
  jenis: string;
  keteranganSingkat: string;
  competence: string;
  technology: string;
  description: string;
  externalLink: string;
  mediaItems: PortfolioMediaItem[];
  featured: boolean;
}

export interface UserAccess {
  id: string;
  email: string;
  nama: string;
  role: UserRole;
  linkedStudentId: string;
  accessPin?: string;
  statusAktif: boolean;
}

export interface MdaDatabase {
  periods: AcademicPeriod[];
  teachers: TeacherClass[];
  students: Student[];
  reports: SemesterReport[];
  portfolios: PortfolioProject[];
  userAccess: UserAccess[];
  cbtExams?: CbtExam[];
  cbtQuestions?: CbtQuestion[];
  cbtAttempts?: CbtAttempt[];
  templateConfig?: BrandingTemplateConfig;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  spreadsheetTitle?: string;
  lastSyncedAt?: string;
}

export interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  variant?: 'primary' | 'danger';
  onConfirm: () => Promise<void> | void;
}
