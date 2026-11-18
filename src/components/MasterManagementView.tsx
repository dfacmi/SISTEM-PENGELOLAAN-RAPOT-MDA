import React, { useState } from 'react';
import {
  Calendar,
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Upload,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  AcademicPeriod,
  MdaDatabase,
  Student,
  TeacherClass,
} from '../types/mda';
import { generateSmartAccessPin, slugifyName } from '../utils/grading';
import { compressImageToDataUrl, processLogoImageToDataUrl } from '../utils/imageHelper';
import { getParentPortalAccessUrl } from '../utils/theme';
import { StudentAvatar } from './MdaLogo';

interface MasterManagementViewProps {
  db: MdaDatabase;
  canManageAll: boolean;
  onSaveStudents: (students: Student[]) => void;
  onSaveTeachers: (teachers: TeacherClass[]) => void;
  onSavePeriods: (periods: AcademicPeriod[]) => void;
  onUploadPhotoToDrive: (file: File) => Promise<string | null>;
}

export const MasterManagementView: React.FC<MasterManagementViewProps> = ({
  db,
  canManageAll,
  onSaveStudents,
  onSaveTeachers,
  onSavePeriods,
  onUploadPhotoToDrive,
}) => {
  const [activeTab, setActiveTab] = useState<'santri' | 'guru' | 'periode'>('santri');
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [editingTeacher, setEditingTeacher] = useState<TeacherClass | null>(null);
  const [editingPeriod, setEditingPeriod] = useState<AcademicPeriod | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingTtd, setUploadingTtd] = useState<'guru' | 'kepala' | 'mudir' | null>(null);
  const [shareModalStudent, setShareModalStudent] = useState<Student | null>(null);
  const [copiedType, setCopiedType] = useState<'url' | 'wa' | null>(null);

  const handleNewStudent = () => {
    const defaultTeacher = db.teachers[0];
    const nextNisn = `MDA02.2627.${Math.floor(800 + Math.random() * 190)}`;
    setEditingStudent({
      id: `std-${Date.now()}`,
      nisnMda: nextNisn,
      nama: '',
      kelas: 'MDA Senior',
      program: 'Muslim Digital Academy – Senior',
      waliKelasId: defaultTeacher?.id || '',
      waliKelasNama: defaultTeacher?.nama || '',
      fotoUrl: '',
      emailSantriOrtu: '',
      portfolioSlug: '',
      accessPin: generateSmartAccessPin('SANTRI', nextNisn),
      statusAktif: 'Aktif',
    });
  };

  const handleSaveStudentForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent || !editingStudent.nama.trim()) return;
    const wali = db.teachers.find((t) => t.id === editingStudent.waliKelasId);
    const rawPortfolio = editingStudent.portfolioSlug.trim();
    const normalizedPortfolio = /^https?:\/\//i.test(rawPortfolio)
      ? rawPortfolio
      : /^www\./i.test(rawPortfolio)
        ? `https://${rawPortfolio}`
        : slugifyName(rawPortfolio) || slugifyName(editingStudent.nama);

    const cleaned: Student = {
      ...editingStudent,
      waliKelasNama: wali ? wali.nama : editingStudent.waliKelasNama,
      portfolioSlug: normalizedPortfolio,
      accessPin:
        editingStudent.accessPin.trim().toUpperCase() ||
        generateSmartAccessPin(editingStudent.nama, editingStudent.nisnMda),
    };
    const exists = db.students.some((s) => s.id === cleaned.id);
    const next = exists
      ? db.students.map((s) => (s.id === cleaned.id ? cleaned : s))
      : [...db.students, cleaned];
    onSaveStudents(next);
    setEditingStudent(null);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingStudent) return;
    setUploadingPhoto(true);
    try {
      let url = await onUploadPhotoToDrive(file);
      if (!url) {
        url = await compressImageToDataUrl(file, 360, 0.84);
      }
      if (url) {
        setEditingStudent({ ...editingStudent, fotoUrl: url });
      }
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleSignatureUpload = async (
    target: 'guru' | 'kepala' | 'mudir',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingTtd(target);
    try {
      let url = await onUploadPhotoToDrive(file);
      if (!url) {
        url = await processLogoImageToDataUrl(file, 320);
      }
      if (url) {
        if (target === 'guru' && editingTeacher) {
          setEditingTeacher({ ...editingTeacher, ttdUrl: url });
        } else if (target === 'kepala' && editingPeriod) {
          setEditingPeriod({ ...editingPeriod, ttdKepalaUnitUrl: url });
        } else if (target === 'mudir' && editingPeriod) {
          setEditingPeriod({ ...editingPeriod, ttdMudirUrl: url });
        }
      }
    } finally {
      setUploadingTtd(null);
      e.target.value = '';
    }
  };

  const handleCopyText = async (text: string, type: 'url' | 'wa') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      // ignore clipboard errors in restricted frames
    }
  };

  const handleNewTeacher = () => {
    const num = String(db.teachers.length + 1).padStart(3, '0');
    const kodeGuru = `MDA-GRU-${num}`;
    setEditingTeacher({
      id: `guru-${Date.now()}`,
      nama: '',
      jabatan: 'Wali Kelas & Pengajar',
      email: '',
      kelasDiampu: 'MDA Senior',
      role: 'guru',
      kodeGuru,
      accessPin: generateSmartAccessPin('GURU', kodeGuru),
    });
  };

  const handleSaveTeacherForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeacher || !editingTeacher.nama.trim()) return;
    const kode =
      (editingTeacher.kodeGuru || '').trim() ||
      `MDA-${editingTeacher.role === 'admin' ? 'ADM' : 'GRU'}-001`;
    const cleanedTeacher: TeacherClass = {
      ...editingTeacher,
      kodeGuru: kode,
      accessPin:
        (editingTeacher.accessPin || '').trim().toUpperCase() ||
        generateSmartAccessPin(editingTeacher.nama, kode),
    };
    const exists = db.teachers.some((t) => t.id === cleanedTeacher.id);
    const next = exists
      ? db.teachers.map((t) => (t.id === cleanedTeacher.id ? cleanedTeacher : t))
      : [...db.teachers, cleanedTeacher];
    onSaveTeachers(next);
    setEditingTeacher(null);
  };

  const handleNewPeriod = () => {
    setEditingPeriod({
      id: `per-${Date.now()}`,
      tahunAkademik: '2026/2027',
      semester: 'Genap',
      tanggalRapor: '20 Juni 2027',
      kkmDiniyah: 60,
      kkmTahfidz: 70,
      kkmDigital: 60,
      kepalaUnitMda: 'Ustadz Azmuhu Syahid, S. Pd',
      mudirPesantren: 'Ustadz Yahya Setiyawan, S. Pd.I, M. Pd',
      isActive: false,
    });
  };

  const handleSavePeriodForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPeriod) return;
    let next = db.periods.some((p) => p.id === editingPeriod.id)
      ? db.periods.map((p) => (p.id === editingPeriod.id ? editingPeriod : p))
      : [...db.periods, editingPeriod];
    if (editingPeriod.isActive) {
      next = next.map((p) => ({ ...p, isActive: p.id === editingPeriod.id }));
    }
    onSavePeriods(next);
    setEditingPeriod(null);
  };

  return (
    <div className="space-y-6">
      {/* Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('santri')}
            className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'santri'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Santri ({db.students.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('guru')}
            className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'guru'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Guru ({db.teachers.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('periode')}
            className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'periode'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Semester ({db.periods.length})</span>
          </button>
        </div>

        {activeTab === 'santri' && canManageAll && (
          <button
            type="button"
            onClick={handleNewStudent}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Santri</span>
          </button>
        )}
        {activeTab === 'guru' && canManageAll && (
          <button
            type="button"
            onClick={handleNewTeacher}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Guru</span>
          </button>
        )}
        {activeTab === 'periode' && canManageAll && (
          <button
            type="button"
            onClick={handleNewPeriod}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Semester</span>
          </button>
        )}
      </div>

      {/* TAB: SANTRI */}
      {activeTab === 'santri' && (
        <div className="space-y-4">
          {editingStudent && (
            <form
              onSubmit={handleSaveStudentForm}
              className="bg-white border border-emerald-200 rounded-2xl p-5 space-y-5 shadow-xs"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-display font-bold text-slate-900 text-sm">
                    {db.students.some((s) => s.id === editingStudent.id)
                      ? 'Edit Profil & Foto Identitas Santri'
                      : 'Tambah Santri Baru'}
                  </h3>
                  {!canManageAll && (
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Hak akses Guru: hanya dapat memperbarui Foto &amp; Link Portofolio santri binaan.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  Tutup
                </button>
              </div>

              {/* Photo Identity Upload Preview */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl bg-[#E8FAF3] border border-emerald-200">
                <StudentAvatar
                  name={editingStudent.nama || 'Santri'}
                  fotoUrl={editingStudent.fotoUrl}
                  className="w-20 h-24 text-xl shrink-0"
                />
                <div className="flex-1 space-y-2">
                  <div className="text-xs font-bold text-slate-900">
                    Foto Profil Identitas Santri
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Foto tampil pada halaman identitas rapor digital, portal orang tua, dan halaman PDF resmi. Anda dapat mengunggah foto langsung dari galeri/komputer atau menempelkan URL foto.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white cursor-pointer whitespace-nowrap">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{uploadingPhoto ? 'Memproses Foto...' : 'Upload Foto Santri'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="hidden"
                      />
                    </label>
                    {editingStudent.fotoUrl && (
                      <button
                        type="button"
                        onClick={() => setEditingStudent({ ...editingStudent, fotoUrl: '' })}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Hapus Foto
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ID Santri MDA
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!canManageAll}
                    value={editingStudent.nisnMda}
                    onChange={(e) => {
                      const nextNisn = e.target.value;
                      const oldAutoPin = generateSmartAccessPin(
                        editingStudent.nama || 'SANTRI',
                        editingStudent.nisnMda
                      );
                      const shouldSyncPin =
                        !editingStudent.accessPin ||
                        editingStudent.accessPin === oldAutoPin;
                      setEditingStudent({
                        ...editingStudent,
                        nisnMda: nextNisn,
                        accessPin: shouldSyncPin
                          ? generateSmartAccessPin(
                              editingStudent.nama || 'SANTRI',
                              nextNisn
                            )
                          : editingStudent.accessPin,
                      });
                    }}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg disabled:bg-slate-100 disabled:text-slate-500"
                    placeholder="MDA02.2526.791"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nama Lengkap Santri
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!canManageAll}
                    value={editingStudent.nama}
                    onChange={(e) => {
                      const nextNama = e.target.value;
                      const oldAutoPin = generateSmartAccessPin(
                        editingStudent.nama || 'SANTRI',
                        editingStudent.nisnMda
                      );
                      const shouldSyncPin =
                        !editingStudent.accessPin ||
                        editingStudent.accessPin === oldAutoPin;
                      setEditingStudent({
                        ...editingStudent,
                        nama: nextNama,
                        accessPin: shouldSyncPin
                          ? generateSmartAccessPin(
                              nextNama || 'SANTRI',
                              editingStudent.nisnMda
                            )
                          : editingStudent.accessPin,
                      });
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg disabled:bg-slate-100 disabled:text-slate-500"
                    placeholder="Alwan Hanif"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Kelas
                  </label>
                  <select
                    disabled={!canManageAll}
                    value={editingStudent.kelas}
                    onChange={(e) =>
                      setEditingStudent({
                        ...editingStudent,
                        kelas: e.target.value,
                        program: `Muslim Digital Academy – ${e.target.value.replace('MDA ', '')}`,
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    <option value="MDA Junior">MDA Junior</option>
                    <option value="MDA Intermediate">MDA Intermediate</option>
                    <option value="MDA Senior">MDA Senior</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Wali Kelas
                  </label>
                  <select
                    disabled={!canManageAll}
                    value={editingStudent.waliKelasId}
                    onChange={(e) =>
                      setEditingStudent({ ...editingStudent, waliKelasId: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    {db.teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nama}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Google Santri / Orang Tua
                  </label>
                  <input
                    type="email"
                    disabled={!canManageAll}
                    value={editingStudent.emailSantriOrtu}
                    onChange={(e) =>
                      setEditingStudent({
                        ...editingStudent,
                        emailSantriOrtu: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg disabled:bg-slate-100 disabled:text-slate-500"
                    placeholder="wali.santri@gmail.com"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    PIN Akses Privat (Nama + 3 Angka Akhir / Editable)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      required
                      disabled={!canManageAll}
                      value={editingStudent.accessPin}
                      onChange={(e) =>
                        setEditingStudent({
                          ...editingStudent,
                          accessPin: e.target.value.toUpperCase(),
                        })
                      }
                      className="flex-1 px-3 py-2 text-xs font-mono font-bold border border-slate-200 rounded-lg uppercase disabled:bg-slate-100 disabled:text-slate-500"
                      placeholder="ALWAN791"
                    />
                    <button
                      type="button"
                      disabled={!canManageAll}
                      onClick={() =>
                        setEditingStudent({
                          ...editingStudent,
                          accessPin: generateSmartAccessPin(
                            editingStudent.nama || 'SANTRI',
                            editingStudent.nisnMda
                          ),
                        })
                      }
                      className="p-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Buat PIN Otomatis (Nama + 3 Angka Terakhir ID)"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Link / Slug Portofolio Santri (Bisa Isi URL Sendiri)
                  </label>
                  <input
                    type="text"
                    value={editingStudent.portfolioSlug}
                    onChange={(e) =>
                      setEditingStudent({
                        ...editingStudent,
                        portfolioSlug: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                    placeholder="https://drive.google.com/... atau alwan-hanif"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    URL Foto Alternatif (Opsional)
                  </label>
                  <input
                    type="text"
                    value={editingStudent.fotoUrl}
                    onChange={(e) =>
                      setEditingStudent({ ...editingStudent, fotoUrl: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                    placeholder="https://... atau hasil upload otomatis"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Status Santri
                  </label>
                  <select
                    disabled={!canManageAll}
                    value={editingStudent.statusAktif}
                    onChange={(e) =>
                      setEditingStudent({
                        ...editingStudent,
                        statusAktif: e.target.value as Student['statusAktif'],
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    <option value="Aktif">Aktif</option>
                    <option value="Alumni">Alumni</option>
                    <option value="Cuti">Cuti</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                >
                  Simpan Data Santri
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {db.students.map((student) => (
              <div
                key={student.id}
                className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col justify-between gap-4 hover:border-emerald-300 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <StudentAvatar
                    name={student.nama}
                    fotoUrl={student.fotoUrl}
                    className="w-14 h-16 text-sm shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="font-display font-bold text-slate-900 text-sm truncate">
                      {student.nama}
                    </div>
                    <div className="font-mono text-xs text-emerald-700 font-semibold">
                      {student.nisnMda}
                    </div>
                    <div className="text-xs text-slate-500">
                      {student.kelas} · {student.statusAktif}
                    </div>
                    <div className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-slate-700 pt-0.5">
                      <KeyRound className="w-3 h-3 text-emerald-600" />
                      <span>PIN: {student.accessPin || 'MDA123'}</span>
                    </div>
                  </div>
                </div>

                {/* Vertical metadata list */}
                <div className="text-xs text-slate-600 space-y-1.5 border-t border-slate-100 pt-3">
                  <div>
                    <div className="text-[11px] text-slate-400">Wali Kelas</div>
                    <div className="font-medium text-slate-800 truncate">
                      {student.waliKelasNama}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Email Google Ortu</div>
                    <div className="truncate">{student.emailSantriOrtu || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Link Portofolio</div>
                    <div className="truncate font-mono text-[11px] text-emerald-700">
                      ?portfolio={student.portfolioSlug}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShareModalStudent(student)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#E8FAF3] border border-emerald-200 text-emerald-800 hover:bg-emerald-100 text-xs font-semibold"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Akses Wali</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingStudent(student)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Edit / Foto
                    </button>
                    {canManageAll && (
                      <button
                        type="button"
                        onClick={() =>
                          onSaveStudents(db.students.filter((s) => s.id !== student.id))
                        }
                        className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"
                        title="Hapus Santri"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: GURU & KELAS */}
      {activeTab === 'guru' && (
        <div className="space-y-4">
          {editingTeacher && (
            <form
              onSubmit={handleSaveTeacherForm}
              className="bg-white border border-emerald-200 rounded-2xl p-5 space-y-4"
            >
              <h3 className="font-display font-bold text-slate-900 text-sm">
                Form Data Ustadz / Wali Kelas
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nama Lengkap &amp; Gelar
                  </label>
                  <input
                    type="text"
                    required
                    value={editingTeacher.nama}
                    onChange={(e) => {
                      const nextNama = e.target.value;
                      const oldAutoPin = generateSmartAccessPin(
                        editingTeacher.nama || 'GURU',
                        editingTeacher.kodeGuru || editingTeacher.id
                      );
                      const shouldSyncPin =
                        !editingTeacher.accessPin ||
                        editingTeacher.accessPin === oldAutoPin;
                      setEditingTeacher({
                        ...editingTeacher,
                        nama: nextNama,
                        accessPin: shouldSyncPin
                          ? generateSmartAccessPin(
                              nextNama || 'GURU',
                              editingTeacher.kodeGuru || editingTeacher.id
                            )
                          : editingTeacher.accessPin,
                      });
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Jabatan / Bidang
                  </label>
                  <input
                    type="text"
                    required
                    value={editingTeacher.jabatan}
                    onChange={(e) =>
                      setEditingTeacher({ ...editingTeacher, jabatan: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Google
                  </label>
                  <input
                    type="email"
                    required
                    value={editingTeacher.email}
                    onChange={(e) =>
                      setEditingTeacher({ ...editingTeacher, email: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ID / Kode Guru &amp; Admin
                  </label>
                  <input
                    type="text"
                    value={editingTeacher.kodeGuru || ''}
                    onChange={(e) => {
                      const nextKode = e.target.value;
                      const oldAutoPin = generateSmartAccessPin(
                        editingTeacher.nama || 'GURU',
                        editingTeacher.kodeGuru || editingTeacher.id
                      );
                      const shouldSyncPin =
                        !editingTeacher.accessPin ||
                        editingTeacher.accessPin === oldAutoPin;
                      setEditingTeacher({
                        ...editingTeacher,
                        kodeGuru: nextKode,
                        accessPin: shouldSyncPin
                          ? generateSmartAccessPin(
                              editingTeacher.nama || 'GURU',
                              nextKode || editingTeacher.id
                            )
                          : editingTeacher.accessPin,
                      });
                    }}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                    placeholder="MDA-GRU-001"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    PIN Akses (Nama + 3 Angka Akhir / Editable)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      required
                      value={editingTeacher.accessPin || ''}
                      onChange={(e) =>
                        setEditingTeacher({
                          ...editingTeacher,
                          accessPin: e.target.value.toUpperCase(),
                        })
                      }
                      className="flex-1 px-3 py-2 text-xs font-mono font-bold border border-slate-200 rounded-lg uppercase"
                      placeholder="TEGUH001"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEditingTeacher({
                          ...editingTeacher,
                          accessPin: generateSmartAccessPin(
                            editingTeacher.nama || 'GURU',
                            editingTeacher.kodeGuru || editingTeacher.id
                          ),
                        })
                      }
                      className="p-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                      title="Buat PIN Otomatis (Nama + 3 Angka Terakhir)"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Kelas Diampu
                  </label>
                  <input
                    type="text"
                    value={editingTeacher.kelasDiampu}
                    onChange={(e) =>
                      setEditingTeacher({ ...editingTeacher, kelasDiampu: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Role Sistem
                  </label>
                  <select
                    value={editingTeacher.role}
                    onChange={(e) =>
                      setEditingTeacher({
                        ...editingTeacher,
                        role: e.target.value as 'admin' | 'guru',
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="guru">Guru / Wali Kelas</option>
                    <option value="admin">Admin MDA</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tanda Tangan Digital Guru / Wali Kelas (PNG Transparan / URL)
                  </label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="w-28 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                      {editingTeacher.ttdUrl ? (
                        <img
                          src={editingTeacher.ttdUrl}
                          alt="Preview TTD Guru"
                          referrerPolicy="no-referrer"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-[10px] text-slate-400">Belum ada TTD</span>
                      )}
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <input
                        type="text"
                        value={editingTeacher.ttdUrl || ''}
                        onChange={(e) =>
                          setEditingTeacher({ ...editingTeacher, ttdUrl: e.target.value })
                        }
                        placeholder="https://... atau upload PNG tanda tangan"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer">
                          <Upload className="w-3 h-3" />
                          <span>{uploadingTtd === 'guru' ? 'Memproses...' : 'Upload TTD PNG'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleSignatureUpload('guru', e)}
                            className="hidden"
                          />
                        </label>
                        {editingTeacher.ttdUrl && (
                          <button
                            type="button"
                            onClick={() => setEditingTeacher({ ...editingTeacher, ttdUrl: '' })}
                            className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-[11px] text-slate-700 hover:bg-slate-50"
                          >
                            Hapus TTD
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingTeacher(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  Simpan Guru
                </button>
              </div>
            </form>
          )}

          {/* Mobile cards for Teachers */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {db.teachers.map((t) => (
              <div
                key={t.id}
                className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900 text-sm">{t.nama}</div>
                    <div className="text-slate-500">{t.jabatan}</div>
                  </div>
                  <span className="uppercase font-mono font-bold text-emerald-700">
                    {t.role}
                  </span>
                </div>
                <div className="text-slate-600">Kelas: {t.kelasDiampu}</div>
                <div className="font-mono text-slate-500 truncate">
                  {t.kodeGuru || t.id} · {t.email}
                </div>
                <div className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-slate-700">
                  <KeyRound className="w-3 h-3 text-emerald-600" />
                  <span>
                    PIN: {t.accessPin || generateSmartAccessPin(t.nama, t.kodeGuru || t.id)}
                  </span>
                </div>
                {canManageAll && (
                  <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setEditingTeacher(t)}
                      className="text-emerald-700 font-semibold"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onSaveTeachers(db.teachers.filter((x) => x.id !== t.id))
                      }
                      className="text-rose-600 font-semibold"
                    >
                      Hapus
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="hidden md:block bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#0E2228] text-white">
                  <th className="py-3 px-4">Nama Pengajar</th>
                  <th className="py-3 px-4">ID / Kode &amp; PIN</th>
                  <th className="py-3 px-4">Kelas Diampu</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Role</th>
                  {canManageAll && <th className="py-3 px-4 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {db.teachers.map((t) => (
                  <tr key={t.id} className="hover:bg-emerald-50/40">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{t.nama}</div>
                      <div className="text-[11px] text-slate-500">{t.jabatan}</div>
                    </td>
                    <td className="py-3 px-4 font-mono">
                      <div className="text-slate-700">{t.kodeGuru || t.id}</div>
                      <div className="text-[11px] font-bold text-emerald-700">
                        PIN: {t.accessPin || generateSmartAccessPin(t.nama, t.kodeGuru || t.id)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">{t.kelasDiampu}</td>
                    <td className="py-3 px-4 font-mono text-slate-600">{t.email}</td>
                    <td className="py-3 px-4 uppercase font-semibold text-emerald-700">
                      {t.role}
                    </td>
                    {canManageAll && (
                      <td className="py-3 px-4 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => setEditingTeacher(t)}
                          className="text-emerald-700 hover:underline font-medium"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onSaveTeachers(db.teachers.filter((x) => x.id !== t.id))
                          }
                          className="text-rose-600 hover:underline font-medium"
                        >
                          Hapus
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: PERIODE & KKM */}
      {activeTab === 'periode' && (
        <div className="space-y-4">
          {editingPeriod && (
            <form
              onSubmit={handleSavePeriodForm}
              className="bg-white border border-emerald-200 rounded-2xl p-5 space-y-4"
            >
              <h3 className="font-display font-bold text-slate-900 text-sm">
                Pengaturan Semester, KKM &amp; Pengesahan Rapor
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tahun Akademik
                  </label>
                  <input
                    type="text"
                    required
                    value={editingPeriod.tahunAkademik}
                    onChange={(e) =>
                      setEditingPeriod({ ...editingPeriod, tahunAkademik: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Semester
                  </label>
                  <select
                    value={editingPeriod.semester}
                    onChange={(e) =>
                      setEditingPeriod({
                        ...editingPeriod,
                        semester: e.target.value as 'Gasal' | 'Genap',
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="Gasal">Gasal</option>
                    <option value="Genap">Genap</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tanggal Pembagian Rapor
                  </label>
                  <input
                    type="text"
                    required
                    value={editingPeriod.tanggalRapor}
                    onChange={(e) =>
                      setEditingPeriod({ ...editingPeriod, tanggalRapor: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingPeriod.isActive}
                      onChange={(e) =>
                        setEditingPeriod({ ...editingPeriod, isActive: e.target.checked })
                      }
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span>Jadikan Semester Aktif</span>
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    KKM Diniyah
                  </label>
                  <input
                    type="number"
                    value={editingPeriod.kkmDiniyah}
                    onChange={(e) =>
                      setEditingPeriod({
                        ...editingPeriod,
                        kkmDiniyah: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    KKM Tahfidz
                  </label>
                  <input
                    type="number"
                    value={editingPeriod.kkmTahfidz}
                    onChange={(e) =>
                      setEditingPeriod({
                        ...editingPeriod,
                        kkmTahfidz: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    KKM Skill Digital
                  </label>
                  <input
                    type="number"
                    value={editingPeriod.kkmDigital}
                    onChange={(e) =>
                      setEditingPeriod({
                        ...editingPeriod,
                        kkmDigital: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Kepala Unit MDA
                  </label>
                  <input
                    type="text"
                    value={editingPeriod.kepalaUnitMda}
                    onChange={(e) =>
                      setEditingPeriod({ ...editingPeriod, kepalaUnitMda: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mudir / Kepala Pesantren
                  </label>
                  <input
                    type="text"
                    value={editingPeriod.mudirPesantren}
                    onChange={(e) =>
                      setEditingPeriod({ ...editingPeriod, mudirPesantren: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>

                {/* TTD Kepala Unit MDA */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    TTD Digital Kepala Unit MDA (Tampil di Ekspor PDF)
                  </label>
                  <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="w-24 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                      {editingPeriod.ttdKepalaUnitUrl ? (
                        <img
                          src={editingPeriod.ttdKepalaUnitUrl}
                          alt="TTD Kepala Unit"
                          referrerPolicy="no-referrer"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-[10px] text-slate-400">Kosong</span>
                      )}
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <input
                        type="text"
                        value={editingPeriod.ttdKepalaUnitUrl || ''}
                        onChange={(e) =>
                          setEditingPeriod({
                            ...editingPeriod,
                            ttdKepalaUnitUrl: e.target.value,
                          })
                        }
                        placeholder="URL / Upload PNG tanda tangan Kepala Unit"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer">
                          <Upload className="w-3 h-3" />
                          <span>{uploadingTtd === 'kepala' ? 'Memproses...' : 'Upload TTD'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleSignatureUpload('kepala', e)}
                            className="hidden"
                          />
                        </label>
                        {editingPeriod.ttdKepalaUnitUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditingPeriod({ ...editingPeriod, ttdKepalaUnitUrl: '' })
                            }
                            className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-[11px] text-slate-700"
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* TTD Mudir Pesantren */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    TTD Digital Mudir Pesantren (Tampil di Ekspor PDF)
                  </label>
                  <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="w-24 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                      {editingPeriod.ttdMudirUrl ? (
                        <img
                          src={editingPeriod.ttdMudirUrl}
                          alt="TTD Mudir"
                          referrerPolicy="no-referrer"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-[10px] text-slate-400">Kosong</span>
                      )}
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <input
                        type="text"
                        value={editingPeriod.ttdMudirUrl || ''}
                        onChange={(e) =>
                          setEditingPeriod({
                            ...editingPeriod,
                            ttdMudirUrl: e.target.value,
                          })
                        }
                        placeholder="URL / Upload PNG tanda tangan Mudir"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer">
                          <Upload className="w-3 h-3" />
                          <span>{uploadingTtd === 'mudir' ? 'Memproses...' : 'Upload TTD'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleSignatureUpload('mudir', e)}
                            className="hidden"
                          />
                        </label>
                        {editingPeriod.ttdMudirUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditingPeriod({ ...editingPeriod, ttdMudirUrl: '' })
                            }
                            className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-[11px] text-slate-700"
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingPeriod(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  Simpan Periode
                </button>
              </div>
            </form>
          )}

          {/* Mobile cards for Periods */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {db.periods.map((p) => (
              <div
                key={p.id}
                className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="font-mono font-bold text-slate-900">
                    {p.semester} · {p.tahunAkademik}
                  </div>
                  <span
                    className={`font-semibold ${
                      p.isActive ? 'text-emerald-700' : 'text-slate-400'
                    }`}
                  >
                    {p.isActive ? 'Aktif' : 'Arsip'}
                  </span>
                </div>
                <div className="text-slate-600">Tanggal Rapor: {p.tanggalRapor}</div>
                <div className="font-mono text-slate-700">
                  KKM (D/T/SD): {p.kkmDiniyah} / {p.kkmTahfidz} / {p.kkmDigital}
                </div>
                {canManageAll && (
                  <div className="flex justify-end pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setEditingPeriod(p)}
                      className="text-emerald-700 font-semibold"
                    >
                      Edit Periode
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="hidden md:block bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#0E2228] text-white">
                  <th className="py-3 px-4">Tahun Akademik</th>
                  <th className="py-3 px-4">Semester</th>
                  <th className="py-3 px-4">Tanggal Rapor</th>
                  <th className="py-3 px-4">KKM (D / T / SD)</th>
                  <th className="py-3 px-4">Kepala Unit &amp; Mudir</th>
                  <th className="py-3 px-4">Status</th>
                  {canManageAll && <th className="py-3 px-4 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {db.periods.map((p) => (
                  <tr key={p.id} className="hover:bg-emerald-50/40">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                      {p.tahunAkademik}
                    </td>
                    <td className="py-3 px-4 font-medium">{p.semester}</td>
                    <td className="py-3 px-4 text-slate-600">{p.tanggalRapor}</td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      {p.kkmDiniyah} / {p.kkmTahfidz} / {p.kkmDigital}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      <div>{p.kepalaUnitMda}</div>
                      <div className="text-[11px] text-slate-400">{p.mudirPesantren}</div>
                    </td>
                    <td className="py-3 px-4 font-semibold">
                      {p.isActive ? (
                        <span className="text-emerald-700">Aktif</span>
                      ) : (
                        <span className="text-slate-400">Arsip</span>
                      )}
                    </td>
                    {canManageAll && (
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setEditingPeriod(p)}
                          className="text-emerald-700 hover:underline font-medium"
                        >
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Share Private Parent Access Modal */}
      {shareModalStudent && (() => {
        const studentPin =
          shareModalStudent.accessPin ||
          generateSmartAccessPin(
            shareModalStudent.nama,
            shareModalStudent.nisnMda
          );
        const directUrl = getParentPortalAccessUrl(
          shareModalStudent.nisnMda,
          studentPin,
          db.spreadsheetId
        );
        const waText = [
          `Assalamu'alaikum Wr. Wb. Bapak/Ibu Wali Santri *${shareModalStudent.nama}*.`,
          `Berikut akses privat Portal Rapor Digital & Portofolio Muslim Digital Academy (MDA):`,
          ``,
          `• ID Santri / Nama Lengkap: ${shareModalStudent.nisnMda} / ${shareModalStudent.nama}`,
          `• PIN Akses: ${studentPin}`,
          `• Link Langsung: ${directUrl}`,
          ``,
          `Akses ini bersifat privat — wali hanya dapat melihat rapor & portofolio ananda ${shareModalStudent.nama}.`,
          `Jazakumullahu khairan.`,
        ].join('\n');

        return (
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setShareModalStudent(null)}
          >
            <div
              className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <div className="text-xs font-mono font-semibold text-emerald-700">
                    AKSES PRIVAT WALI SANTRI
                  </div>
                  <h3 className="font-display font-bold text-base text-slate-900">
                    {shareModalStudent.nama}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShareModalStudent(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-[#E8FAF3] border border-emerald-200 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">ID Santri / Nama Lengkap:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {shareModalStudent.nisnMda} / {shareModalStudent.nama}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">PIN Akses Privat:</span>
                  <span className="font-mono font-bold text-emerald-800">
                    {shareModalStudent.accessPin ||
                      generateSmartAccessPin(
                        shareModalStudent.nama,
                        shareModalStudent.nisnMda
                      )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Email Google Terdaftar:</span>
                  <span className="font-medium text-slate-800 truncate max-w-[190px]">
                    {shareModalStudent.emailSantriOrtu || 'Belum diisi'}
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-slate-600 leading-relaxed">
                Orang tua dapat masuk dengan <strong>ID Santri MDA atau Nama Lengkap Santri</strong> ditambah <strong>PIN Akses</strong> di atas (atau link langsung di bawah ini) dan hanya dapat melihat rapor milik <strong>{shareModalStudent.nama}</strong> sendiri.
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-700 break-all">
                {directUrl}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyText(directUrl, 'url')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800"
                >
                  {copiedType === 'url' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedType === 'url' ? 'Link Disalin' : 'Salin Link Langsung'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyText(waText, 'wa')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white"
                >
                  {copiedType === 'wa' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Share2 className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedType === 'wa' ? 'Pesan WA Disalin' : 'Salin Pesan WhatsApp'}</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
