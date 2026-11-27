import React, { useEffect, useState } from 'react';
import { FileText, LayoutTemplate, Palette, RotateCcw, Save, Upload } from 'lucide-react';
import { DEFAULT_TEMPLATE_CONFIG } from '../data/seedData';
import { BrandingTemplateConfig, MdaAccentTheme } from '../types/mda';
import {
  compressImageToDataUrl,
  processLogoImageToDataUrl,
} from '../utils/imageHelper';
import { MdaLogo } from './MdaLogo';

interface TemplateSettingsViewProps {
  config: BrandingTemplateConfig;
  isGoogleConnected: boolean;
  initialTab?: 'tampilan' | 'narasi' | 'rapor';
  onSaveConfig: (next: BrandingTemplateConfig) => void;
  onUploadAssetToDrive: (file: File) => Promise<string | null>;
}

const THEME_OPTIONS: {
  id: MdaAccentTheme;
  name: string;
  desc: string;
  gradient: string;
}[] = [
  {
    id: 'mda-emerald',
    name: 'MDA Emerald – Cyan (Default)',
    desc: 'Identitas resmi PDF MDA: hijau emerald, mint lembut, toska, dan dark slate.',
    gradient: 'linear-gradient(135deg, #00D084 0%, #0D7A6F 55%, #0B4F6C 100%)',
  },
  {
    id: 'darul-forest',
    name: 'Darul Fithrah Forest – Slate',
    desc: 'Hijau zamrud pesantren yang tenang dipadu aksen slate profesional.',
    gradient: 'linear-gradient(135deg, #059669 0%, #065F46 60%, #0F172A 100%)',
  },
  {
    id: 'ocean-cyan',
    name: 'Digital Sky – Teal',
    desc: 'Nuansa teknologi modern toska-biru cerah khas akademi digital.',
    gradient: 'linear-gradient(135deg, #00B0FF 0%, #00A896 55%, #0F172A 100%)',
  },
];

export const TemplateSettingsView: React.FC<TemplateSettingsViewProps> = ({
  config,
  isGoogleConnected,
  initialTab = 'narasi',
  onSaveConfig,
  onUploadAssetToDrive,
}) => {
  const [activeTab, setActiveTab] = useState<'tampilan' | 'narasi' | 'rapor'>(initialTab);
  const [draft, setDraft] = useState<BrandingTemplateConfig>({
    ...DEFAULT_TEMPLATE_CONFIG,
    ...config,
  });
  const [uploadingField, setUploadingField] = useState<'cover' | 'logo' | null>(null);

  useEffect(() => {
    setDraft({
      ...DEFAULT_TEMPLATE_CONFIG,
      ...config,
    });
  }, [config]);

  const handleImagePick = async (
    field: 'cover' | 'logo',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingField(field);
    try {
      let url: string | null = null;
      if (isGoogleConnected) {
        url = await onUploadAssetToDrive(file);
      }
      if (!url) {
        url =
          field === 'logo'
            ? await processLogoImageToDataUrl(file, 420)
            : await compressImageToDataUrl(file, 900, 0.85);
      }
      if (field === 'cover') {
        setDraft((p) => ({ ...p, coverPhotoUrl: url || '' }));
      } else {
        setDraft((p) => ({ ...p, customLogoUrl: url || '' }));
      }
    } finally {
      setUploadingField(null);
      e.target.value = '';
    }
  };

  const selectedTheme =
    THEME_OPTIONS.find((t) => t.id === draft.accentTheme) || THEME_OPTIONS[0];

  const updateField = (key: keyof BrandingTemplateConfig, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Header & Save Actions */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
            <Palette className="w-5 h-5 text-emerald-700" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-bold text-slate-900 text-base sm:text-lg break-words">
              Pengaturan Tampilan, Narasi Dashboard &amp; Template Rapor
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5 break-words leading-relaxed">
              Rapikan susunan kalimat di halaman masuk, dashboard admin, portal wali, serta ubah tema &amp; identitas rapor PDF.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setDraft({ ...DEFAULT_TEMPLATE_CONFIG })}
            className="flex-1 sm:flex-initial min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-sm font-semibold"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reset Default</span>
          </button>
          <button
            type="button"
            onClick={() => onSaveConfig(draft)}
            className="flex-1 sm:flex-initial min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-semibold"
          >
            <Save className="w-4 h-4" />
            <span>Simpan Perubahan</span>
          </button>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="w-full max-w-full flex items-center gap-1.5 p-1.5 bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('narasi')}
          className={`shrink-0 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
            activeTab === 'narasi'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Narasi &amp; Kalimat Dashboard</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('rapor')}
          className={`shrink-0 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
            activeTab === 'rapor'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <LayoutTemplate className="w-4 h-4" />
          <span>Identitas Lembaga &amp; Teks Rapor PDF</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('tampilan')}
          className={`shrink-0 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
            activeTab === 'tampilan'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <Palette className="w-4 h-4" />
          <span>Tema Warna, Logo &amp; Foto Cover</span>
        </button>
      </div>

      {/* TAB 1: NARASI & KALIMAT DASHBOARD */}
      {activeTab === 'narasi' && (
        <div className="space-y-6">
          {/* Group A: Dashboard Ringkasan Akademik */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="font-display font-bold text-slate-900 text-sm">
                1. Narasi Dashboard Utama (Ringkasan Akademik)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Kalimat judul dan keterangan yang muncul pada halaman Ringkasan Akademik Admin &amp; Guru.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Judul Banner Atas Dashboard (Competence Header)
                </label>
                <input
                  type="text"
                  value={draft.subjudulCompetence}
                  onChange={(e) => updateField('subjudulCompetence', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Judul Kartu Grafik Radar 5 Pilar
                </label>
                <input
                  type="text"
                  value={draft.dashboardRadarTitle}
                  onChange={(e) => updateField('dashboardRadarTitle', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Judul Kartu Kalkulasi 5 Pilar Utama
                </label>
                <input
                  type="text"
                  value={draft.dashboardPillarTitle}
                  onChange={(e) => updateField('dashboardPillarTitle', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Subjudul Kartu Kalkulasi 5 Pilar Utama
                </label>
                <input
                  type="text"
                  value={draft.dashboardPillarSubtitle}
                  onChange={(e) => updateField('dashboardPillarSubtitle', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Catatan Kaki Kartu 5 Pilar (Dasar Penilaian)
                </label>
                <input
                  type="text"
                  value={draft.dashboardPillarNote}
                  onChange={(e) => updateField('dashboardPillarNote', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Judul Tabel Daftar Rapor Santri
                </label>
                <input
                  type="text"
                  value={draft.dashboardTableTitle}
                  onChange={(e) => updateField('dashboardTableTitle', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Kalimat Keterangan Tabel Daftar Rapor Santri
                </label>
                <input
                  type="text"
                  value={draft.dashboardTableSubtitle}
                  onChange={(e) => updateField('dashboardTableSubtitle', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
            </div>
          </div>

          {/* Group B: Portal Santri & Orang Tua */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="font-display font-bold text-slate-900 text-sm">
                2. Narasi Portal Santri &amp; Orang Tua
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Kalimat yang dibaca oleh wali santri dan santri saat membuka rapor digital serta galeri karya.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Judul Grafik Perkembangan Kompetensi
                </label>
                <input
                  type="text"
                  value={draft.portalTrendTitle}
                  onChange={(e) => updateField('portalTrendTitle', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Subjudul Grafik Perkembangan Kompetensi
                </label>
                <input
                  type="text"
                  value={draft.portalTrendSubtitle}
                  onChange={(e) => updateField('portalTrendSubtitle', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Subjudul Galeri Hasil Karya &amp; Portofolio Anak
                </label>
                <input
                  type="text"
                  value={draft.portalPortfolioSubtitle}
                  onChange={(e) => updateField('portalPortfolioSubtitle', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Judul Kartu Link Portofolio Online
                </label>
                <input
                  type="text"
                  value={draft.portalQrTitle}
                  onChange={(e) => updateField('portalQrTitle', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Deskripsi Kartu Link Portofolio Online
                </label>
                <textarea
                  rows={2}
                  value={draft.portalQrDescription}
                  onChange={(e) => updateField('portalQrDescription', e.target.value)}
                  className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
            </div>
          </div>

          {/* Group C: Halaman Login (Sampul Awal Web) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="font-display font-bold text-slate-900 text-sm">
                3. Narasi Halaman Masuk (Login Portal MDA)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Kalimat sambutan pada panel sebelah kiri saat guru atau wali membuka aplikasi pertama kali.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Judul Utama Halaman Masuk
                </label>
                <input
                  type="text"
                  value={draft.loginHeadline}
                  onChange={(e) => updateField('loginHeadline', e.target.value)}
                  className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Paragraf Deskripsi Utama Halaman Masuk
                </label>
                <textarea
                  rows={3}
                  value={draft.loginDescription}
                  onChange={(e) => updateField('loginDescription', e.target.value)}
                  className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Keterangan Kolom Admin &amp; Guru
                </label>
                <textarea
                  rows={2}
                  value={draft.loginAdminInfo}
                  onChange={(e) => updateField('loginAdminInfo', e.target.value)}
                  className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Keterangan Kolom Orang Tua &amp; Santri
                </label>
                <textarea
                  rows={2}
                  value={draft.loginParentInfo}
                  onChange={(e) => updateField('loginParentInfo', e.target.value)}
                  className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: IDENTITAS LEMBAGA & TEKS RAPOR PDF */}
      {activeTab === 'rapor' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="font-display font-bold text-slate-900 text-sm">
              Identitas Lembaga, Kontak &amp; Kalimat Rapor PDF (5 Halaman)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Mengubah teks pada sampul rapor PDF, header halaman 2–5, motto penutup, dan informasi kontak resmi.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Nama Program / Lembaga
              </label>
              <input
                type="text"
                value={draft.namaLembaga}
                onChange={(e) => updateField('namaLembaga', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Nama Pondok Pesantren
              </label>
              <input
                type="text"
                value={draft.namaPesantren}
                onChange={(e) => updateField('namaPesantren', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Judul Utama Rapor
              </label>
              <input
                type="text"
                value={draft.judulRapor}
                onChange={(e) => updateField('judulRapor', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Header Lampiran Portofolio &amp; Sidang Karya (Halaman 5)
              </label>
              <input
                type="text"
                value={draft.labelCoverPortfolio}
                onChange={(e) => updateField('labelCoverPortfolio', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Narasi Ringkas Sampul PDF (Halaman 1)
              </label>
              <textarea
                rows={2}
                value={draft.coverTagline}
                onChange={(e) => updateField('coverTagline', e.target.value)}
                className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Motto Footer Halaman 2
              </label>
              <input
                type="text"
                value={draft.pesanPenutupHalaman2}
                onChange={(e) => updateField('pesanPenutupHalaman2', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Doa Penutup Footer Halaman 1 &amp; 5
              </label>
              <input
                type="text"
                value={draft.pesanPenutupHalaman6}
                onChange={(e) => updateField('pesanPenutupHalaman6', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Judul Blok Link Portofolio (Halaman 5)
              </label>
              <input
                type="text"
                value={draft.qrBannerTitle}
                onChange={(e) => updateField('qrBannerTitle', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Kota Pengesahan Tanda Tangan
              </label>
              <input
                type="text"
                value={draft.kotaTanggal}
                onChange={(e) => updateField('kotaTanggal', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Kalimat Penjelasan Blok Link Portofolio (Halaman 5)
              </label>
              <textarea
                rows={2}
                value={draft.qrBannerDescription}
                onChange={(e) => updateField('qrBannerDescription', e.target.value)}
                className="w-full px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Nomor WhatsApp Resmi
              </label>
              <input
                type="text"
                value={draft.whatsapp}
                onChange={(e) => updateField('whatsapp', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm font-mono border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Instagram Resmi
              </label>
              <input
                type="text"
                value={draft.instagram}
                onChange={(e) => updateField('instagram', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm font-mono border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Email Resmi
              </label>
              <input
                type="email"
                value={draft.email}
                onChange={(e) => updateField('email', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm font-mono border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                Alamat Lengkap Lembaga
              </label>
              <input
                type="text"
                value={draft.alamat}
                onChange={(e) => updateField('alamat', e.target.value)}
                className="w-full h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: TEMA WARNA, LOGO & FOTO COVER */}
      {activeTab === 'tampilan' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-w-0">
          <div className="lg:col-span-5 min-w-0 space-y-3">
            <div className="text-xs font-semibold text-slate-700">
              Pratinjau Langsung Sampul &amp; Identitas MDA
            </div>
            <div
              className="rounded-2xl p-6 text-white shadow-md relative overflow-hidden min-h-[280px] flex flex-col justify-between"
              style={{ background: selectedTheme.gradient }}
            >
              {draft.coverPhotoUrl && (
                <img
                  src={draft.coverPhotoUrl}
                  alt="Cover Preview"
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 w-full h-full object-cover opacity-25 mix-blend-luminosity"
                />
              )}
              <div className="relative z-10 flex items-start justify-between gap-3">
                <div className="inline-flex items-center justify-center bg-white rounded-xl px-3.5 py-2 shadow-sm">
                  <MdaLogo size="sm" customLogoUrl={draft.customLogoUrl} />
                </div>
                <div className="bg-[#1DF27A] text-slate-950 font-display font-bold text-xs px-3 py-1 rounded-full">
                  SEMESTER GASAL
                </div>
              </div>

              <div className="relative z-10 my-5 space-y-1.5">
                <div className="font-display font-extrabold text-xl leading-tight">
                  {draft.judulRapor}
                </div>
                <div className="text-xs sm:text-sm text-emerald-100 font-medium">
                  {draft.namaLembaga} · {draft.namaPesantren}
                </div>
                <div className="text-xs text-white/85 italic pt-1">
                  {draft.subjudulCompetence}
                </div>
              </div>

              <div className="relative z-10 bg-white/95 text-slate-900 rounded-xl px-3.5 py-2.5 text-xs font-medium flex flex-col gap-0.5">
                <div className="font-bold text-emerald-800">
                  {draft.whatsapp} · {draft.instagram}
                </div>
                <div className="text-slate-600 truncate">{draft.alamat}</div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 min-w-0 bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5">
            <div>
              <h3 className="font-display font-bold text-slate-900 text-base mb-3">
                Tema Warna Aksen Dashboard &amp; Rapor
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {THEME_OPTIONS.map((t) => {
                  const active = draft.accentTheme === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, accentTheme: t.id })}
                      className={`text-left p-3.5 rounded-xl border transition-all ${
                        active
                          ? 'border-emerald-600 bg-emerald-50/70 ring-2 ring-emerald-500/20'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div
                        className="h-8 w-full rounded-lg mb-2.5"
                        style={{ background: t.gradient }}
                      />
                      <div className="text-sm font-bold text-slate-900">{t.name}</div>
                      <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                        {t.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  Foto Latar Cover PDF (Halaman 1)
                </label>
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="text"
                    value={draft.coverPhotoUrl}
                    onChange={(e) => updateField('coverPhotoUrl', e.target.value)}
                    placeholder="URL foto kegiatan santri..."
                    className="flex-1 min-w-0 h-11 px-3.5 py-2 text-base sm:text-sm border border-slate-200 rounded-xl"
                  />
                  <label className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm font-semibold text-slate-700 cursor-pointer shrink-0">
                    <Upload className="w-4 h-4" />
                    <span>{uploadingField === 'cover' ? '...' : 'Unggah'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImagePick('cover', e)}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-1 mb-1.5">
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700">
                    Logo Lembaga Kustom (Opsional)
                  </label>
                  {draft.customLogoUrl && (
                    <button
                      type="button"
                      onClick={() => updateField('customLogoUrl', '')}
                      className="text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      Reset ke Logo Asli MDA
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="text"
                    value={draft.customLogoUrl}
                    onChange={(e) => updateField('customLogoUrl', e.target.value)}
                    placeholder="Kosongkan untuk logo asli MDA permanen"
                    className="flex-1 min-w-0 h-11 px-3.5 py-2 text-base sm:text-sm border border-slate-200 rounded-xl"
                  />
                  <label className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm font-semibold text-slate-700 cursor-pointer shrink-0">
                    <Upload className="w-4 h-4" />
                    <span>{uploadingField === 'logo' ? '...' : 'Unggah'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImagePick('logo', e)}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  Logo resmi MDA sudah tertanam permanen. Kosongkan kolom ini agar logo asli tampil konsisten di semua tautan &amp; perangkat.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
