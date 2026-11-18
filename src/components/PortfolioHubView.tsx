import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Link2,
  PenSquare,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { DEFAULT_TEMPLATE_CONFIG } from '../data/seedData';
import {
  BrandingTemplateConfig,
  MdaDatabase,
  PortfolioMediaItem,
  PortfolioProject,
} from '../types/mda';
import { getPortfolioUrl, slugifyName } from '../utils/grading';
import { compressImageToDataUrl } from '../utils/imageHelper';
import { getThemeStyles, mergeTemplateConfig } from '../utils/theme';
import { MdaLogo, PortfolioArtwork, StudentAvatar } from './MdaLogo';

interface PortfolioHubViewProps {
  db: MdaDatabase;
  studentId: string;
  canEdit: boolean;
  isPublicStandalone?: boolean;
  templateConfig?: BrandingTemplateConfig;
  onSelectStudent?: (id: string) => void;
  onSavePortfolios: (projects: PortfolioProject[]) => void;
  onUpdatePortfolioLink?: (studentId: string, portfolioSlug: string) => void;
  onUploadMediaToDrive: (file: File) => Promise<{ url: string; type: 'image' | 'video' } | null>;
  onExitPublicStandalone?: () => void;
}

export const PortfolioHubView: React.FC<PortfolioHubViewProps> = ({
  db,
  studentId,
  canEdit,
  isPublicStandalone = false,
  templateConfig,
  onSelectStudent,
  onSavePortfolios,
  onUpdatePortfolioLink,
  onUploadMediaToDrive,
  onExitPublicStandalone,
}) => {
  const [copied, setCopied] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const [customLinkDraft, setCustomLinkDraft] = useState('');
  const [editingProject, setEditingProject] = useState<PortfolioProject | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('Semua');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lightboxMedia, setLightboxMedia] = useState<{
    item: PortfolioMediaItem;
    projectTitle: string;
    jenis: string;
  } | null>(null);

  const tpl = mergeTemplateConfig(templateConfig || db.templateConfig, DEFAULT_TEMPLATE_CONFIG);
  const theme = getThemeStyles(tpl.accentTheme);

  const student = useMemo(
    () => db.students.find((s) => s.id === studentId) || db.students[0],
    [db.students, studentId]
  );

  const projects = useMemo(
    () => db.portfolios.filter((p) => p.studentId === student?.id),
    [db.portfolios, student]
  );

  const jenisOptions = useMemo(() => {
    const set = new Set<string>(['Semua']);
    projects.forEach((p) => {
      if (p.jenis.trim()) set.add(p.jenis.trim());
    });
    return Array.from(set);
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((p) => {
      const matchType = typeFilter === 'Semua' || p.jenis.trim() === typeFilter;
      const matchSearch =
        q === '' ||
        p.judul.toLowerCase().includes(q) ||
        p.jenis.toLowerCase().includes(q) ||
        p.technology.toLowerCase().includes(q);
      return matchType && matchSearch;
    });
  }, [projects, typeFilter, searchQuery]);

  const latestReport = useMemo(() => {
    const reps = db.reports.filter((r) => r.studentId === student?.id);
    return reps[reps.length - 1];
  }, [db.reports, student]);

  if (!student) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        Profil santri tidak ditemukan.
      </div>
    );
  }

  const portfolioUrl = getPortfolioUrl(student.portfolioSlug, db.spreadsheetId);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(portfolioUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleNewProject = () => {
    setEditingProject({
      id: `port-${Date.now()}`,
      studentId: student.id,
      tahunAkademik: latestReport?.tahunAkademik || '2026/2027',
      semester: latestReport?.semester || 'Gasal',
      judul: '',
      jenis: 'Graphic Design / UI/UX',
      keteranganSingkat: '',
      competence: '',
      technology: 'Figma, Canva',
      description: '',
      externalLink: '',
      mediaItems: [
        { url: '', type: 'image', caption: 'Karya Utama', presetArt: 'poster' },
        { url: '', type: 'image', caption: 'Tampilan Detail', presetArt: 'uiux' },
        { url: '', type: 'image', caption: 'Dokumentasi / Variasi', presetArt: 'photo' },
      ],
      featured: true,
    });
  };

  const handleMediaUpload = async (
    slotIdx: number,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !editingProject) return;
    setUploadingSlot(slotIdx);
    try {
      let res = await onUploadMediaToDrive(file);
      if (!res && file.type.startsWith('image/')) {
        const compressed = await compressImageToDataUrl(file, 900, 0.84);
        res = { url: compressed, type: 'image' };
      }
      if (res) {
        const nextMedia = [...editingProject.mediaItems];
        nextMedia[slotIdx] = {
          ...nextMedia[slotIdx],
          url: res.url,
          type: res.type,
        };
        setEditingProject({ ...editingProject, mediaItems: nextMedia });
      }
    } finally {
      setUploadingSlot(null);
      e.target.value = '';
    }
  };

  const handleSubmitProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject || !editingProject.judul.trim()) return;
    const exists = db.portfolios.some((p) => p.id === editingProject.id);
    const next = exists
      ? db.portfolios.map((p) => (p.id === editingProject.id ? editingProject : p))
      : [...db.portfolios, editingProject];
    onSavePortfolios(next);
    setEditingProject(null);
  };

  const renderMediaFrame = (
    item: PortfolioMediaItem,
    projectTitle: string,
    jenis: string,
    heightClass = 'h-48'
  ) => {
    const hasUrl = item.url && item.url.trim() !== '';
    return (
      <button
        type="button"
        onClick={() => setLightboxMedia({ item, projectTitle, jenis })}
        className={`group relative w-full ${heightClass} rounded-xl overflow-hidden border border-slate-200 bg-slate-50 text-left focus:outline-none focus:ring-2 focus:ring-emerald-500`}
      >
        {hasUrl ? (
          item.type === 'video' ? (
            <iframe
              src={item.url}
              title={item.caption || projectTitle}
              className="w-full h-full pointer-events-none"
            />
          ) : (
            <img
              src={item.url}
              alt={item.caption || projectTitle}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
            />
          )
        ) : (
          <PortfolioArtwork preset={item.presetArt} title={item.caption || projectTitle} />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-2.5 flex items-center justify-between gap-2">
          <div className="text-[11px] font-medium text-white truncate">
            {item.caption || projectTitle}
          </div>
          <span className="text-[10px] font-semibold text-[#1DF27A] shrink-0">
            Perbesar
          </span>
        </div>
      </button>
    );
  };

  return (
    <div
      className={isPublicStandalone ? 'min-h-screen py-6 sm:py-8 px-4 sm:px-8' : ''}
      style={isPublicStandalone ? { backgroundColor: theme.pageTint } : undefined}
    >
      <div className={isPublicStandalone ? 'max-w-5xl mx-auto space-y-6' : 'space-y-6'}>
        {isPublicStandalone && (
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-emerald-200">
            <MdaLogo size="md" customLogoUrl={tpl.customLogoUrl} />
            {onExitPublicStandalone && (
              <button
                type="button"
                onClick={onExitPublicStandalone}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0E2228] text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Masuk ke Portal MDA</span>
              </button>
            )}
          </div>
        )}

        {/* MDA Branded Student Portfolio Hero Profile + QR Code */}
        <div className="bg-white border border-emerald-200 rounded-2xl overflow-hidden shadow-xs">
          <div
            className="px-6 py-3 text-white text-xs font-semibold flex flex-wrap items-center justify-between gap-2"
            style={{ background: theme.bannerGradient }}
          >
            <span>STUDENT PORTFOLIO · {tpl.namaLembaga.toUpperCase()}</span>
            <span className="font-mono text-[#1DF27A]">{student.nisnMda}</span>
          </div>

          <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
              <StudentAvatar
                name={student.nama}
                fotoUrl={student.fotoUrl}
                className="w-20 h-24 text-xl shrink-0"
              />
              <div className="space-y-1">
                {!isPublicStandalone && onSelectStudent ? (
                  <select
                    value={student.id}
                    onChange={(e) => {
                      onSelectStudent(e.target.value);
                      setTypeFilter('Semua');
                    }}
                    className="font-display font-bold text-2xl text-slate-900 bg-transparent border-b border-dashed border-slate-300 focus:outline-none focus:border-emerald-600 pr-4 max-w-full"
                  >
                    {db.students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nama}
                      </option>
                    ))}
                  </select>
                ) : (
                  <h1 className="font-display font-bold text-2xl text-slate-900">
                    {student.nama}
                  </h1>
                )}
                <p className="text-xs sm:text-sm text-slate-600 font-medium">
                  {student.program} · {tpl.namaPesantren}
                </p>
                {latestReport && (
                  <div className="text-xs text-slate-500 pt-1 flex flex-wrap justify-center sm:justify-start items-center gap-2">
                    <span>Tahfidz: {latestReport.tahfidz.totalHafalan}</span>
                    <span aria-hidden="true">·</span>
                    <span>Multimedia: {latestReport.pilar.penguasaanMultimedia}%</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-emerald-700">
                      {projects.length} Karya Terpublikasi
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div
              className="flex flex-col justify-between gap-3 text-white rounded-xl p-4 sm:min-w-[290px] max-w-full lg:max-w-[360px] shrink-0"
              style={{ backgroundColor: theme.darkPill }}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1DF27A]">
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Link Portofolio Santri</span>
                  </div>
                  {canEdit && onUpdatePortfolioLink && !editingLink && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomLinkDraft(student.portfolioSlug || '');
                        setEditingLink(true);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[11px] font-medium text-emerald-200 transition-colors"
                    >
                      <PenSquare className="w-3 h-3" />
                      <span>Isi / Ubah Link</span>
                    </button>
                  )}
                </div>

                {editingLink && onUpdatePortfolioLink ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const raw = customLinkDraft.trim();
                      const nextVal = /^https?:\/\//i.test(raw)
                        ? raw
                        : /^www\./i.test(raw)
                          ? `https://${raw}`
                          : slugifyName(raw) || slugifyName(student.nama);
                      onUpdatePortfolioLink(student.id, nextVal);
                      setEditingLink(false);
                    }}
                    className="space-y-2 pt-1"
                  >
                    <input
                      type="text"
                      value={customLinkDraft}
                      onChange={(e) => setCustomLinkDraft(e.target.value)}
                      placeholder="https://drive.google.com/... atau slug"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-emerald-400/50 text-[11px] font-mono text-white placeholder:text-slate-400 focus:outline-none"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="submit"
                        className="px-2.5 py-1 rounded-md bg-[#1DF27A] text-slate-950 text-[11px] font-bold"
                      >
                        Simpan Link
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCustomLinkDraft(slugifyName(student.nama))
                        }
                        className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[11px] text-slate-200"
                      >
                        Reset Default
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingLink(false)}
                        className="px-2 py-1 rounded-md text-[11px] text-slate-300 hover:text-white"
                      >
                        Batal
                      </button>
                    </div>
                  </form>
                ) : (
                  <a
                    href={portfolioUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block bg-white/10 hover:bg-white/15 border border-white/15 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-emerald-100 break-all transition-colors"
                  >
                    {portfolioUrl}
                  </a>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold text-white transition-colors"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-[#1DF27A]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copied ? 'Link Disalin' : 'Salin Link'}</span>
                </button>
                <a
                  href={portfolioUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-emerald-200 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Buka Link</span>
                </a>
                {canEdit && (
                  <button
                    type="button"
                    onClick={handleNewProject}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1DF27A] hover:bg-emerald-400 text-xs font-bold text-slate-950 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Karya Baru</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Filter by Materi / Jenis Karya + Search Bar */}
        {projects.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {jenisOptions.map((jenis) => {
                const active = typeFilter === jenis;
                return (
                  <button
                    key={jenis}
                    type="button"
                    onClick={() => setTypeFilter(jenis)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-800'
                    }`}
                  >
                    {jenis}
                  </button>
                );
              })}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari judul materi atau karya..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl w-full md:w-56"
              />
            </div>
          </div>
        )}

        {/* Add / Edit Portfolio Form */}
        {canEdit && editingProject && (
          <form
            onSubmit={handleSubmitProject}
            className="bg-white border border-emerald-200 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-display font-bold text-slate-900 text-base">
                {db.portfolios.some((p) => p.id === editingProject.id)
                  ? 'Edit Karya Portofolio'
                  : 'Tambah Karya / Proyek Santri'}
              </h2>
              <button
                type="button"
                onClick={() => setEditingProject(null)}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Tutup
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Judul Proyek / Karya
                </label>
                <input
                  type="text"
                  required
                  value={editingProject.judul}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, judul: e.target.value })
                  }
                  placeholder="Contoh: UI/UX Design – Aplikasi Mutabaah Tahfidz"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Judul Materi / Jenis Karya
                </label>
                <input
                  type="text"
                  required
                  value={editingProject.jenis}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, jenis: e.target.value })
                  }
                  placeholder="Poster / UI/UX / Video / Web"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Technology / Tools
                </label>
                <input
                  type="text"
                  value={editingProject.technology}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, technology: e.target.value })
                  }
                  placeholder="Figma, Canva, Premiere Pro"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Keterangan Singkat (Tabel Lampiran PDF)
                </label>
                <input
                  type="text"
                  value={editingProject.keteranganSingkat}
                  onChange={(e) =>
                    setEditingProject({
                      ...editingProject,
                      keteranganSingkat: e.target.value,
                    })
                  }
                  placeholder="3 karya poster kampanye digital"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Link Eksternal Hasil Karya
                </label>
                <input
                  type="url"
                  value={editingProject.externalLink}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, externalLink: e.target.value })
                  }
                  placeholder="https://figma.com/... atau https://youtube.com/..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>

              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Student Competence (Kompetensi yang Dicapai)
                  </label>
                  <textarea
                    rows={3}
                    value={editingProject.competence}
                    onChange={(e) =>
                      setEditingProject({ ...editingProject, competence: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Description (Tujuan, Konsep &amp; Pembelajaran)
                  </label>
                  <textarea
                    rows={3}
                    value={editingProject.description}
                    onChange={(e) =>
                      setEditingProject({ ...editingProject, description: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            </div>

            {/* 3 Media Slots with Google Drive / Local Image Upload */}
            <div className="pt-2 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-800 mb-3">
                Galeri Media Karya (3 Slot Foto/Video — Upload Langsung / Google Drive / URL)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {editingProject.mediaItems.map((m, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2"
                  >
                    <div className="text-xs font-semibold text-slate-700">
                      Slot Karya {idx + 1}
                    </div>
                    <input
                      type="text"
                      value={m.caption}
                      onChange={(e) => {
                        const next = [...editingProject.mediaItems];
                        next[idx] = { ...next[idx], caption: e.target.value };
                        setEditingProject({ ...editingProject, mediaItems: next });
                      }}
                      placeholder="Judul / Caption gambar"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                    />
                    <input
                      type="text"
                      value={m.url}
                      onChange={(e) => {
                        const next = [...editingProject.mediaItems];
                        next[idx] = { ...next[idx], url: e.target.value };
                        setEditingProject({ ...editingProject, mediaItems: next });
                      }}
                      placeholder="URL foto/video (opsional)"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={m.presetArt || 'poster'}
                        onChange={(e) => {
                          const next = [...editingProject.mediaItems];
                          next[idx] = {
                            ...next[idx],
                            presetArt: e.target.value as PortfolioMediaItem['presetArt'],
                          };
                          setEditingProject({ ...editingProject, mediaItems: next });
                        }}
                        className="px-2 py-1 text-[11px] bg-white border border-slate-200 rounded-md"
                      >
                        <option value="poster">Tema Poster</option>
                        <option value="uiux">Tema UI/UX</option>
                        <option value="photo">Tema Foto</option>
                        <option value="video">Tema Video</option>
                      </select>

                      <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer">
                        <Upload className="w-3 h-3" />
                        <span>
                          {uploadingSlot === idx ? 'Mengunggah...' : 'Upload Karya'}
                        </span>
                        <input
                          type="file"
                          accept="image/*,video/*"
                          onChange={(e) => handleMediaUpload(idx, e)}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingProject(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
              >
                Simpan Karya Portofolio
              </button>
            </div>
          </form>
        )}

        {/* Portfolio Projects List */}
        {filteredProjects.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
            <div className="text-sm font-semibold text-slate-800">
              {projects.length === 0
                ? `Belum ada karya portofolio untuk ${student.nama}`
                : 'Tidak ada karya yang cocok dengan filter jenis/pencarian.'}
            </div>
            <p className="text-xs text-slate-500">
              Tambahkan proyek desain, UI/UX, fotografi, atau video santri agar muncul di halaman portofolio &amp; lampiran PDF.
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={handleNewProject}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Karya Pertama</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {filteredProjects.map((proj, index) => (
              <div
                key={proj.id}
                className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="text-[11px] font-display font-extrabold text-slate-950 px-3 py-0.5 rounded-full"
                        style={{ backgroundColor: theme.sectionSky }}
                      >
                        MATERI / JENIS: {proj.jenis.toUpperCase()}
                      </span>
                      <span className="text-xs font-mono text-slate-500">
                        Proyek {index + 1} · {proj.semester} {proj.tahunAkademik}
                      </span>
                    </div>
                    <h2 className="font-display font-bold text-xl text-slate-900">
                      {proj.judul}
                    </h2>
                    <p className="text-xs text-slate-500">{proj.keteranganSingkat}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {proj.mediaItems[0] && (
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxMedia({
                            item: proj.mediaItems[0],
                            projectTitle: proj.judul,
                            jenis: proj.jenis,
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Lihat Hasil Karya</span>
                      </button>
                    )}
                    {proj.externalLink && (
                      <a
                        href={proj.externalLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0E2228] text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
                      >
                        <span>Buka Link</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingProject(proj)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onSavePortfolios(
                              db.portfolios.filter((x) => x.id !== proj.id)
                            )
                          }
                          className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"
                          title="Hapus karya"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* 3-Slot Bento Media Showcase */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  <div className="md:col-span-6">
                    {proj.mediaItems[0] &&
                      renderMediaFrame(
                        proj.mediaItems[0],
                        proj.judul,
                        proj.jenis,
                        'h-60 md:h-72'
                      )}
                  </div>
                  <div className="md:col-span-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-4">
                    {proj.mediaItems[1] &&
                      renderMediaFrame(
                        proj.mediaItems[1],
                        proj.judul,
                        proj.jenis,
                        'h-36 md:h-[136px]'
                      )}
                    {proj.mediaItems[2] &&
                      renderMediaFrame(
                        proj.mediaItems[2],
                        proj.judul,
                        proj.jenis,
                        'h-36 md:h-[136px]'
                      )}
                  </div>
                </div>

                {/* Competence, Technology & Description */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 pt-2">
                  <div className="md:col-span-5 space-y-3">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs font-bold text-slate-900 mb-1">
                        Student Competence
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {proj.competence}
                      </p>
                    </div>
                    <div
                      className="p-4 rounded-xl border border-emerald-200"
                      style={{ backgroundColor: theme.pageTint }}
                    >
                      <div className="text-xs font-bold text-slate-900 mb-1">
                        Technology &amp; Tools
                      </div>
                      <p className="text-xs font-mono font-semibold text-emerald-800">
                        {proj.technology}
                      </p>
                    </div>
                  </div>

                  <div className="md:col-span-7 p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-xs font-bold text-slate-900 mb-1">
                      Description
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {proj.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen Lightbox */}
      {lightboxMedia && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLightboxMedia(null)}
        >
          <div
            className="relative w-full max-w-3xl bg-white rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <div>
                <div className="text-[11px] font-bold text-emerald-700 uppercase">
                  {lightboxMedia.jenis}
                </div>
                <div className="font-display font-bold text-sm text-slate-900">
                  {lightboxMedia.projectTitle}
                </div>
                <div className="text-xs text-slate-500">
                  {lightboxMedia.item.caption}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLightboxMedia(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="h-[420px] bg-slate-900 flex items-center justify-center">
              {lightboxMedia.item.url ? (
                lightboxMedia.item.type === 'video' ? (
                  <iframe
                    src={lightboxMedia.item.url}
                    title={lightboxMedia.item.caption}
                    className="w-full h-full"
                    allowFullScreen
                  />
                ) : (
                  <img
                    src={lightboxMedia.item.url}
                    alt={lightboxMedia.item.caption}
                    referrerPolicy="no-referrer"
                    className="max-w-full max-h-full object-contain"
                  />
                )
              ) : (
                <PortfolioArtwork
                  preset={lightboxMedia.item.presetArt}
                  title={lightboxMedia.item.caption || lightboxMedia.projectTitle}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
