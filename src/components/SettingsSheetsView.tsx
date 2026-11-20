import React, { useState } from 'react';
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  KeyRound,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ServerHealthStatus } from '../services/backendApi';
import { MdaDatabase, UserAccess, UserRole } from '../types/mda';
import {
  exportDatabaseBackupJson,
  exportTabCsv,
  MDA_SHEET_TABS,
  MdaTabName,
} from '../services/sheetsDb';

interface SettingsSheetsViewProps {
  db: MdaDatabase;
  isSyncing: boolean;
  serverHealth?: ServerHealthStatus | null;
  localSnapshotStats?: {
    hasData: boolean;
    students: number;
    reports: number;
    portfolios: number;
  } | null;
  onConnectSpreadsheet: (urlOrId: string) => void;
  onConnectAppsScript?: (url: string) => void;
  onSaveAllAppsScript?: () => void;
  onPushToSheets: () => void;
  onPullFromSheets: () => void;
  onMigrateLocalToSheets?: () => void;
  onRestoreBackupJson: (jsonDb: MdaDatabase) => void;
  onSaveUserAccess: (users: UserAccess[]) => void;
}

export const SettingsSheetsView: React.FC<SettingsSheetsViewProps> = ({
  db,
  isSyncing,
  serverHealth,
  localSnapshotStats,
  onConnectSpreadsheet,
  onConnectAppsScript,
  onSaveAllAppsScript,
  onPushToSheets,
  onPullFromSheets,
  onMigrateLocalToSheets,
  onRestoreBackupJson,
  onSaveUserAccess,
}) => {
  const [sheetInput, setSheetInput] = useState(db.spreadsheetId || '');
  const [appsScriptInput, setAppsScriptInput] = useState(
    serverHealth?.appsScriptUrl ||
      'https://script.google.com/macros/s/AKfycbyRsDtSpBMgDCekHjJvjlfrLNnUCiDMPDDRaMpwwk89TKahIqOmydYjgmS11pgCeGk7/exec'
  );
  const [selectedCsvTab, setSelectedCsvTab] = useState<MdaTabName>('Rapor_Semester');
  const [newUser, setNewUser] = useState<{
    email: string;
    nama: string;
    role: UserRole;
    linkedStudentId: string;
    accessPin: string;
  }>({
    email: '',
    nama: '',
    role: 'santri_ortu',
    linkedStudentId: db.students[0]?.id || '',
    accessPin: '',
  });
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const canBackendOperateSheets = Boolean(
    serverHealth?.serviceAccountConfigured || serverHealth?.appsScriptConfigured
  );

  const handleAppsScriptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!appsScriptInput.trim() || !onConnectAppsScript) return;
    onConnectAppsScript(appsScriptInput.trim());
  };

  const handleConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetInput.trim()) return;
    onConnectSpreadsheet(sheetInput.trim());
  };

  const handleJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as MdaDatabase;
      if (!Array.isArray(parsed.students) || !Array.isArray(parsed.reports)) {
        throw new Error('Format file backup JSON MDA tidak valid.');
      }
      onRestoreBackupJson(parsed);
    } catch (err: any) {
      setRestoreError(err.message || 'Gagal membaca file backup JSON.');
    } finally {
      e.target.value = '';
    }
  };

  const handleAddAccess = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.email.trim() || !newUser.nama.trim()) return;
    const item: UserAccess = {
      id: `usr-${Date.now()}`,
      email: newUser.email.trim().toLowerCase(),
      nama: newUser.nama.trim(),
      role: newUser.role,
      linkedStudentId: newUser.role === 'santri_ortu' ? newUser.linkedStudentId : '',
      accessPin: newUser.accessPin.trim().toUpperCase(),
      statusAktif: true,
    };
    onSaveUserAccess([...db.userAccess, item]);
    setNewUser({
      email: '',
      nama: '',
      role: 'santri_ortu',
      linkedStudentId: db.students[0]?.id || '',
      accessPin: '',
    });
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Google Apps Script Web App Primary Backend Card */}
      <div className="bg-white border border-emerald-300 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xs min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
              <ExternalLink className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-display font-bold text-slate-900 text-base">
                Google Apps Script Web App API (Koneksi Utama Permanen)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Sumber data utama lintas laptop &amp; HP via endpoint Web App Google Apps Script (<code className="font-mono">GET</code> &amp; <code className="font-mono">POST saveAll</code>). API Secret tersimpan aman di backend server.
              </p>
            </div>
          </div>
          <span
            className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 self-start sm:self-auto ${
              serverHealth?.appsScriptConfigured
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-amber-50 text-amber-800 border border-amber-200'
            }`}
          >
            {serverHealth?.appsScriptConfigured
              ? 'Apps Script Terhubung'
              : 'Menunggu URL /exec Asli'}
          </span>
        </div>

        <form onSubmit={handleAppsScriptSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              URL Web App Google Apps Script (Default Aktif)
            </label>
            <div className="flex flex-col sm:flex-row gap-2 min-w-0">
              <input
                type="text"
                value={appsScriptInput}
                onChange={(e) => setAppsScriptInput(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="flex-1 min-w-0 w-full px-3.5 py-2.5 text-xs font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
              <button
                type="submit"
                disabled={isSyncing}
                className="w-full sm:w-auto min-h-[42px] sm:min-h-0 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold whitespace-normal sm:whitespace-nowrap disabled:opacity-50 shrink-0"
              >
                {isSyncing ? 'Menghubungkan...' : 'Simpan & Tes Koneksi (GET)'}
              </button>
            </div>
            {(appsScriptInput.trim() === 'https://script.google.com/macros/s/XXXX/exec' ||
              appsScriptInput.includes('/macros/s/XXXX/')) && (
              <p className="text-[11px] text-amber-800 mt-1.5 leading-relaxed">
                Template URL aktif: ganti bagian <code className="font-mono font-bold">XXXX</code> dengan ID Deployment Google Apps Script Anda yang asli (<code className="font-mono">AKfycb...</code>), lalu klik <strong>Simpan &amp; Tes Koneksi</strong>.
              </p>
            )}
          </div>
        </form>

        {serverHealth?.appsScriptConfigured && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isSyncing}
              onClick={onPullFromSheets}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-300 bg-[#E8FAF3] hover:bg-emerald-100 text-xs font-semibold text-emerald-900 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Ambil Data Terbaru (GET)</span>
            </button>
            {onSaveAllAppsScript && (
              <button
                type="button"
                disabled={isSyncing}
                onClick={onSaveAllAppsScript}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5 text-[#1DF27A]" />
                <span>Kirim Semua Data Sekarang (POST saveAll)</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Google Sheets Connection Panel */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <h2 className="font-display font-bold text-slate-900 text-base">
                Status Database Google Sheets
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Seluruh data santri, nilai, tahfidz, sikap, portofolio, TTD digital, dan hak akses disinkronkan permanen melalui Google Apps Script API.
              </p>
            </div>
          </div>

          <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0 self-start sm:self-auto">
            {canBackendOperateSheets ? 'Koneksi Backend Aktif' : 'Belum Terhubung'}
          </span>
        </div>

        {!canBackendOperateSheets && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <strong>Langkah pertama sebelum sinkronisasi:</strong> Tempelkan URL Web App <strong>Google Apps Script</strong> asli Anda pada kartu di atas dan klik <strong>Simpan &amp; Tes Koneksi (GET)</strong>.
          </div>
        )}

        {/* Active Spreadsheet Info & Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-w-0">
          <div className="lg:col-span-6 min-w-0 space-y-3">
            <div className="text-xs font-semibold text-slate-800">
              Struktur 11 Tab Google Sheets MDA
            </div>
            <p className="text-xs text-slate-500 leading-relaxed break-words">
              Tab yang dikelola otomatis oleh Apps Script:{' '}
              <span className="font-mono text-slate-700 break-words">
                Master_Akademik, Guru_Kelas, Santri, Rapor_Semester, Sikap_Character, Tahfidz, Nilai_Diniyah, Nilai_Digital, Portofolio, Hak_Akses, Template_Branding
              </span>
              .
            </p>
          </div>

          <div className="lg:col-span-6 min-w-0 space-y-3">
            <div className="text-xs font-semibold text-slate-800">
              Tautan ID / URL Spreadsheet (Opsional)
            </div>
            <form onSubmit={handleConnectSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 min-w-0">
              <input
                type="text"
                value={sheetInput}
                onChange={(e) => setSheetInput(e.target.value)}
                placeholder="Tempel URL atau ID Google Spreadsheet..."
                className="flex-1 min-w-0 w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
              />
              <button
                type="submit"
                disabled={!canBackendOperateSheets || isSyncing}
                className="w-full sm:w-auto min-h-[40px] sm:min-h-0 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                Hubungkan
              </button>
            </form>

            {db.spreadsheetId && (
              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">
                    {db.spreadsheetTitle || 'Spreadsheet MDA Terhubung'}
                  </div>
                  <div className="font-mono text-[11px] text-slate-600 truncate">
                    ID: {db.spreadsheetId}
                  </div>
                  {db.lastSyncedAt && (
                    <div className="text-[11px] text-emerald-700 mt-0.5">
                      Terakhir sinkron: {new Date(db.lastSyncedAt).toLocaleString('id-ID')}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {db.spreadsheetUrl && (
                    <a
                      href={db.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50"
                    >
                      <span>Buka Sheet</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={!canBackendOperateSheets || isSyncing}
                    onClick={onPullFromSheets}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Muat Ulang dari Sheets</span>
                  </button>
                  {serverHealth?.appsScriptConfigured && (
                    <button
                      type="button"
                      disabled={isSyncing}
                      onClick={onPushToSheets}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Upload className="w-3 h-3" />
                      <span>Sinkronkan Ulang</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Safe non-duplicating migration from localStorage */}
            {localSnapshotStats?.hasData && db.spreadsheetId && onMigrateLocalToSheets && (
              <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <div className="text-sky-950">
                  <strong>Ditemukan data lokal di browser ini:</strong> {localSnapshotStats.students} santri,{' '}
                  {localSnapshotStats.reports} rapor, {localSnapshotStats.portfolios} portofolio. Anda dapat menggabungkannya ke Google Sheets tanpa menimpa atau menduplikasi data yang sudah ada.
                </div>
                <button
                  type="button"
                  disabled={!canBackendOperateSheets || isSyncing}
                  onClick={onMigrateLocalToSheets}
                  className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  Migrasikan Data Lokal (Tanpa Duplikasi)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Backup & Restore */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Download className="w-5 h-5 text-sky-600" />
          <div>
            <h2 className="font-display font-bold text-slate-900 text-base">
              Backup & Pemulihan Data (JSON / CSV)
            </h2>
            <p className="text-xs text-slate-500">
              Unduh cadangan lengkap database MDA atau ekspor per tabel sheet ke CSV.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 pt-1">
          <button
            type="button"
            onClick={() => exportDatabaseBackupJson(db)}
            className="w-full sm:w-auto min-h-[40px] sm:min-h-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Unduh Backup Lengkap (.json)</span>
          </button>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto min-w-0">
            <select
              value={selectedCsvTab}
              onChange={(e) => setSelectedCsvTab(e.target.value as MdaTabName)}
              className="min-w-0 flex-1 sm:flex-none px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg bg-white"
            >
              {MDA_SHEET_TABS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => exportTabCsv(db, selectedCsvTab)}
              className="min-h-[38px] sm:min-h-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Ekspor CSV</span>
            </button>
          </div>

          <label className="w-full sm:w-auto min-h-[40px] sm:min-h-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 text-xs font-semibold cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Pulihkan dari File JSON</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleJsonUpload}
              className="hidden"
            />
          </label>
        </div>

        {restoreError && (
          <div className="text-xs text-rose-600 font-medium">{restoreError}</div>
        )}
      </div>

      {/* Role-Based Access Control (Hak_Akses) */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Shield className="w-5 h-5 text-emerald-700" />
          <div>
            <h2 className="font-display font-bold text-slate-900 text-base">
              Pengaturan Hak Akses Pengguna (Admin, Guru, Santri & Orang Tua)
            </h2>
            <p className="text-xs text-slate-500">
              Daftarkan akun login (Admin, Guru, atau Santri/Orang Tua) beserta PIN aksesnya ke tab <code className="font-mono">Hak_Akses</code> Google Sheets. Akun Santri/Orang Tua hanya dapat melihat rapor &amp; portofolio anandanya sendiri.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleAddAccess}
          className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200"
        >
          <div className="md:col-span-3">
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Email / ID Login
            </label>
            <input
              type="text"
              required
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              placeholder="nama@gmail.com atau ID"
              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Nama Pengguna
            </label>
            <input
              type="text"
              required
              value={newUser.nama}
              onChange={(e) => setNewUser({ ...newUser, nama: e.target.value })}
              placeholder="Nama Lengkap"
              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Peran (Role)
            </label>
            <select
              value={newUser.role}
              onChange={(e) =>
                setNewUser({ ...newUser, role: e.target.value as UserRole })
              }
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
            >
              <option value="admin">Admin</option>
              <option value="guru">Guru / Wali</option>
              <option value="santri_ortu">Santri / Ortu</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Tautkan ke Santri
            </label>
            <select
              disabled={newUser.role !== 'santri_ortu'}
              value={newUser.linkedStudentId}
              onChange={(e) =>
                setNewUser({ ...newUser, linkedStudentId: e.target.value })
              }
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg disabled:opacity-50"
            >
              {db.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nama}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              PIN Akses (Opsional)
            </label>
            <input
              type="text"
              value={newUser.accessPin}
              onChange={(e) => setNewUser({ ...newUser, accessPin: e.target.value })}
              placeholder="Otomatis / Custom PIN"
              className="w-full px-3 py-1.5 text-xs font-mono uppercase bg-white border border-slate-200 rounded-lg"
            />
          </div>
          <div className="md:col-span-1 flex items-end">
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1 py-1.5 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah</span>
            </button>
          </div>
        </form>

        <div className="w-full max-w-full overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full min-w-[700px] text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="py-2.5 px-4">Email / ID Login</th>
                <th className="py-2.5 px-4">Nama</th>
                <th className="py-2.5 px-4">Hak Akses</th>
                <th className="py-2.5 px-4">Santri Tertaut</th>
                <th className="py-2.5 px-4">PIN Akses</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {db.userAccess.map((u) => {
                const linkedStudent = db.students.find(
                  (s) => s.id === u.linkedStudentId
                );
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono text-slate-800">{u.email}</td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{u.nama}</td>
                    <td className="py-2.5 px-4">
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                        <KeyRound className="w-3 h-3" />
                        <span>
                          {u.role === 'admin'
                            ? 'Admin MDA'
                            : u.role === 'guru'
                            ? 'Guru / Wali Kelas'
                            : 'Santri / Orang Tua'}
                        </span>
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">
                      {linkedStudent ? linkedStudent.nama : 'Semua Santri'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700">
                      {u.accessPin || (linkedStudent?.accessPin || 'Sesuai PIN Santri')}
                    </td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() =>
                          onSaveUserAccess(
                            db.userAccess.map((item) =>
                              item.id === u.id
                                ? { ...item, statusAktif: !item.statusAktif }
                                : item
                            )
                          )
                        }
                        className={`font-semibold ${
                          u.statusAktif ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                      >
                        {u.statusAktif ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          onSaveUserAccess(
                            db.userAccess.filter((item) => item.id !== u.id)
                          )
                        }
                        className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                        title="Hapus akses"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
