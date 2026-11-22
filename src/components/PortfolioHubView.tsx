import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Image as ImageIcon,
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
import {
  getStudentPortfolioLinks,
  normalizeExternalUrl,
} from '../utils/grading';
import { compressImageSharpForSheet } from '../utils/imageHelper';
import { getThemeStyles, mergeTemplateConfig } from '../utils/theme';
import { MdaLogo, PortfolioArtwork, StudentAvatar } from './MdaLogo';

export interface PortfolioLinksPatch {
  portfolioSlug?: string;
  behanceUrl?: string;
  portfolioPdfUrl?: string;
  portfolioPdfSubject?: string;
}

interface PortfolioHubViewProps {
  db: MdaDatabase;
  studentId: string;
  canEdit: boolean;
  isPublicStandalone?: boolean;
  templateConfig?: BrandingTemplateConfig;
  onSelectStudent?: (id: string) => void;
  onSavePortfolios: (projects: PortfolioProject[]) => void;
  onUpdatePortfolioLinks?: (studentId: string, patch: PortfolioLinksPatch) => void;
  onUploadMediaToDrive: (file: File) => Promise<{ url: string; type: 'image' | 'video' } | null>;
  onExitPublicStandalone?: () => void;
}

const SUBJECT_PRESETS = [
  'UI/UX Design & Graphic Design',
  'UI/UX Design',
  'Graphic Design',
  'Desain Multimedia',
];

const KARYA_TYPE_PRESETS = [
  { label: 'Sidang Karya (Utama Hal. 5)', jenis: 'Sidang Karya', highlight: true },
  { label: 'UI/UX Design', jenis: 'UI/UX Design', highlight: false },
  { label: 'Graphic Design', jenis: 'Graphic Design', highlight: false },
  {
    label: 'UI/UX Design & Graphic Design',
    jenis: 'UI/UX Design & Graphic Design',
    highlight: false,
  },
  { label: 'Desain Multimedia', jenis: 'Desain Multimedia', highlight: false },
];

export const PortfolioHubView: React.FC<PortfolioHubViewProps> = ({
  db,
  studentId,
  canEdit,
  isPublicStandalone = false,
  templateConfig,
  onSelectStudent,
  onSavePortfolios,
  onUpdatePortfolioLinks,
  onUploadMediaToDrive,
  onExitPublicStandalone,
}) => {
  const [copiedKey, setCopiedKey] = useState<'behance' | 'pdf' | null>(null);
  const [editingLinks, setEditingLinks] = useState(false);
  const [behanceDraft, setBehanceDraft] = useState('');
  const [pdfUrlDraft, setPdfUrlDraft] = useState('');
  const [pdfSubjectDraft, setPdfSubjectDraft] = useState('UI/UX Design & Graphic Design');

  const [editingProject, setEditingProject] = useState<PortfolioProject | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [slotUploadMeta, setSlotUploadMeta] = useState<
    Record<number, { byteLength: number; width: number; height: number }>
  >({});
  const [uploadError, setUploadError] = useState<string | null>(null);
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
        p.keteranganSingkat.toLowerCase().includes(q);
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

  const links = getStudentPortfolioLinks(student, db.spreadsheetId);

  const handleCopy = async (key: 'behance' | 'pdf', urlText: string) => {
    if (!urlText) return;
    try {
      await navigator.clipboard.writeText(urlText);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // ignore
    }
  };

  const openEditLinksForm = () => {
    setBehanceDraft(links.behanceUrl || student.behanceUrl || '');
    setPdfUrlDraft(student.portfolioPdfUrl || '');
    setPdfSubjectDraft(student.portfolioPdfSubject || 'UI/UX Design & Graphic Design');
    setEditingLinks(true);
  };

  const handleNewProject = (preset: 'default' | 'sidang' = 'sidang') => {
    setSlotUploadMeta({});
    setUploadError(null);
    setEditingProject({
      id: `port-${Date.now()}`,
      studentId: student.id,
      tahunAkademik: latestReport?.tahunAkademik || '2026/2027',
      semester: latestReport?.semester || 'Gasal',
      judul: preset === 'sidang' ? 'Sidang Karya Akhir Semester' : '',
      jenis: preset === 'sidang' ? 'Sidang Karya' : 'UI/UX Design & Graphic Design',
      keteranganSingkat: '',
      competence: '',
      technology: '',
      description: '',
      externalLink: '',
      mediaItems: [
        {
          url: '',
          type: 'image',
          caption: 'Hasil Sidang Karya 1',
          presetArt: 'poster',
        },
        {
          url: '',
          type: 'image',
          caption: 'Hasil Sidang Karya 2 (Opsional)',
          presetArt: 'uiux',
        },
      ],
      featured: true,
    });
  };

  const openEditProject = (proj: PortfolioProject) => {
    setSlotUploadMeta({});
    setUploadError(null);
    const items = [...proj.mediaItems];
    while (items.length < 2) {
      items.push({
        url: '',
        type: 'image',
        caption: items.length === 0 ? 'Hasil Sidang Karya 1' : 'Hasil Sidang Karya 2 (Opsional)',
        presetArt: items.length === 0 ? 'poster' : 'uiux',
      });
    }
    setEditingProject({
      ...proj,
      mediaItems: items.slice(0, 2),
    });
  };

  const handleMediaUpload = async (
    slotIdx: number,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !editingProject) return;
    setUploadError(null);
    setUploadingSlot(slotIdx);
    try {
      let res: { url: string; type: 'image' | 'video' } | null = null;
      if (file.type.startsWith('image/')) {
        const compressed = await compressImageSharpForSheet(file, {
          maxWidth: 960,
          initialQuality: 0.85,
          maxChars: 42000,
        });
        const compressedFile = await fetch(compressed.dataUrl)
          .then((r) => r.blob())
          .then(
            (blob) =>
              new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
                type: 'image/jpeg',
              })
          )
          .catch(() => file);
        const driveRes = await onUploadMediaToDrive(compressedFile);
        res = driveRes || { url: compressed.dataUrl, type: 'image' };
        setSlotUploadMeta((prev) => ({
          ...prev,
          [slotIdx]: {
            byteLength: compressed.byteLength,
            width: compressed.width,
            height: compressed.height,
          },
        }));
      } else {
        setUploadError('Mohon unggah file gambar (JPG, PNG, atau WEBP) agar tampil tajam di PDF.');
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
    } catch (err: any) {
      setUploadError(err?.message || 'Gagal memproses gambar. Coba file lain.');
    } finally {
      setUploadingSlot(null);
      e.target.value = '';
    }
  };

  const handleClearMediaSlot = (slotIdx: number) => {
    if (!editingProject) return;
    const nextMedia = [...editingProject.mediaItems];
    nextMedia[slotIdx] = {
      ...nextMedia[slotIdx],
      url: '',
    };
    setEditingProject({ ...editingProject, mediaItems: nextMedia });
    setSlotUploadMeta((prev) => {
      const next = { ...prev };
      delete next[slotIdx];
      return next;
    });
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

  const renderSharpMediaFrame = (
    item: PortfolioMediaItem,
    projectTitle: string,
    jenis: string,
    heightClass = 'h-60 sm:h-72'
  ) => {
    const hasUrl = item.url && item.url.trim() !== '';
    return (
      <button
        type="button"
        onClick={() => setLightboxMedia({ item, projectTitle, jenis })}
        className={`group relative w-full ${heightClass} rounded-xl overflow-hidden border border-slate-200 bg-white text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 flex items-center justify-center p-2`}
      >
        {hasUrl ? (
          item.type === 'video' ? (
            <iframe
              src={item.url}
              title={item.caption || projectTitle}
              className="w-full h-full pointer-events-none rounded-lg"
            />
          ) : (
            <img
              src={item.url}
              alt={item.caption || projectTitle}
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain group-hover:scale-[1.01] transition-transform duration-200"
            />
          )
        ) : (
          <div className="w-full h-full rounded-lg overflow-hidden">
            <PortfolioArtwork preset={item.presetArt} title={item.caption || projectTitle} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/35 to-transparent p-2.5 flex items-center justify-between gap-2">
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
      className={
        isPublicStandalone
          ? 'min-h-screen py-5 sm:py-8 px-3 sm:px-8 max-w-full overflow-x-hidden'
          : 'min-w-0 max-w-full overflow-x-hidden'
      }
      style={isPublicStandalone ? { backgroundColor: theme.pageTint } : undefined}
    >
      <div className={isPublicStandalone ? 'max-w-5xl mx-auto space-y-6 min-w-0' : 'space-y-6 min-w-0'}>
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

        {/* MDA Branded Student Portfolio Hero Profile + 2 Link Cards */}
        <div className="bg-white border border-emerald-200 rounded-2xl overflow-hidden shadow-xs">
          <div
            className="px-4 sm:px-6 py-3 text-white text-xs font-semibold flex flex-wrap items-center justify-between gap-2"
            style={{ background: theme.bannerGradient }}
          >
            <span>STUDENT PORTFOLIO · {tpl.namaLembaga.toUpperCase()}</span>
            <span className="font-mono text-[#1DF27A]">{student.nisnMda}</span>
          </div>

          <div className="p-4 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5 sm:gap-6">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left min-w-0 flex-1">
              <StudentAvatar
                name={student.nama}
                fotoUrl={student.fotoUrl}
                className="w-20 h-24 text-xl shrink-0"
              />
              <div className="space-y-1 min-w-0 w-full">
                {!isPublicStandalone && onSelectStudent ? (
                  <select
                    value={student.id}
                    onChange={(e) => {
                      onSelectStudent(e.target.value);
                      setTypeFilter('Semua');
                    }}
                    className="font-display font-bold text-xl sm:text-2xl text-slate-900 bg-transparent border-b border-dashed border-slate-300 focus:outline-none focus:border-emerald-600 pr-4 w-full sm:w-auto max-w-full min-w-0 truncate"
                  >
                    {db.students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nama}
                      </option>
                    ))}
                  </select>
                ) : (
                  <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-900 break-words">
                    {student.nama}
                  </h1>
                )}
                <p className="text-xs sm:text-sm text-slate-600 font-medium break-words">
                  {student.program} · {tpl.namaPesantren}
                </p>
                {latestReport && (
                  <div className="text-xs text-slate-500 pt-1 flex flex-wrap justify-center sm:justify-start items-center gap-2">
                    <span>Tahfidz: {latestReport.tahfidz.totalHafalan}</span>
                    <span aria-hidden="true">·</span>
                    <span>Multimedia: {latestReport.pilar.penguasaanMultimedia}%</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-emerald-700">
                      {projects.length} Dokumentasi Karya
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div
              className="flex flex-col justify-between gap-3 text-white rounded-xl p-4 w-full lg:w-[400px] xl:w-[430px] min-w-0 max-w-full shrink-0"
              style={{ backgroundColor: theme.darkPill }}
            >
              <div className="space-y-2.5 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1DF27A]">
                    <Link2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Link Portofolio Santri</span>
                  </div>
                  {canEdit && onUpdatePortfolioLinks && !editingLinks && (
                    <button
                      type="button"
                      onClick={openEditLinksForm}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[11px] font-medium text-emerald-200 transition-colors"
                    >
                      <PenSquare className="w-3 h-3" />
                      <span>Isi / Edit Link</span>
                    </button>
                  )}
                </div>

                {editingLinks && onUpdatePortfolioLinks ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      onUpdatePortfolioLinks(student.id, {
                        behanceUrl: normalizeExternalUrl(behanceDraft),
                        portfolioPdfUrl: normalizeExternalUrl(pdfUrlDraft),
                        portfolioPdfSubject: pdfSubjectDraft.trim(),
                      });
                      setEditingLinks(false);
                    }}
                    className="space-y-2.5 pt-1"
                  >
                    <div>
                      <label className="block text-[10.5px] font-semibold text-sky-200 mb-1">
                        1. Link Portofolio (Behance) — Cover Hal. 1 &amp; Hal. 5
                      </label>
                      <input
                        type="text"
                        value={behanceDraft}
                        onChange={(e) => setBehanceDraft(e.target.value)}
                        placeholder="https://www.behance.net/username"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-sky-400/40 text-[11px] font-mono text-white placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10.5px] font-semibold text-amber-200 mb-1">
                        2. Link Kumpulan Karya 1 Semester (PDF Google Drive)
                      </label>
                      <input
                        type="text"
                        value={pdfUrlDraft}
                        onChange={(e) => setPdfUrlDraft(e.target.value)}
                        placeholder="https://drive.google.com/file/d/..."
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-amber-400/40 text-[11px] font-mono text-white placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10.5px] font-semibold text-amber-100 mb-1">
                        Nama Pelajaran (untuk PDF Kumpulan Karya)
                      </label>
                      <input
                        type="text"
                        value={pdfSubjectDraft}
                        onChange={(e) => setPdfSubjectDraft(e.target.value)}
                        placeholder="UI/UX Design & Graphic Design"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-amber-400/30 text-[11px] text-white placeholder:text-slate-400 focus:outline-none"
                      />
                      <div className="flex flex-wrap gap-1 mt-1">
                        {SUBJECT_PRESETS.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setPdfSubjectDraft(opt)}
                            className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[9.5px] text-amber-200"
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded-md bg-[#1DF27A] text-slate-950 text-[11px] font-bold"
                      >
                        Simpan Link Portofolio
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingLinks(false)}
                        className="px-2.5 py-1.5 rounded-md text-[11px] text-slate-300 hover:text-white"
                      >
                        Batal
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-2 min-w-0">
                    {/* Link 1: Behance */}
                    <div className="rounded-lg bg-white/10 border border-white/10 p-2.5 space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5 flex-wrap">
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-sky-300 block">
                            1. Link Portofolio (Behance)
                          </span>
                          <span className="text-[9.5px] text-slate-300">
                            Tampil di Cover Hal. 1 &amp; Hal. 5
                          </span>
                        </div>
                        {links.behanceUrl && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => void handleCopy('behance', links.behanceUrl)}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-[10px] font-semibold"
                            >
                              {copiedKey === 'behance' ? (
                                <Check className="w-2.5 h-2.5 text-[#1DF27A]" />
                              ) : (
                                <Copy className="w-2.5 h-2.5" />
                              )}
                              <span>{copiedKey === 'behance' ? 'Disalin' : 'Salin'}</span>
                            </button>
                            <a
                              href={links.behanceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-400 text-slate-950 text-[10px] font-bold"
                            >
                              <span>Buka</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                        )}
                      </div>
                      {links.behanceUrl ? (
                        <a
                          href={links.behanceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-[10.5px] font-mono text-sky-100 break-all hover:underline"
                        >
                          {links.behanceUrl}
                        </a>
                      ) : (
                        <div className="text-[10.5px] text-slate-400 italic">
                          Portofolio Behance belum diisi
                        </div>
                      )}
                    </div>

                    {/* Link 2: PDF Kumpulan Karya 1 Semester */}
                    <div className="rounded-lg bg-white/10 border border-white/10 p-2.5 space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5 flex-wrap">
                        <div className="flex flex-wrap items-center gap-1 min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">
                            2. Link Kumpulan Karya (PDF)
                          </span>
                          {links.pdfSubject && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-400/20 text-[9.5px] font-semibold text-amber-200">
                              {links.pdfSubject}
                            </span>
                          )}
                        </div>
                        {links.pdfUrl && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => void handleCopy('pdf', links.pdfUrl)}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-[10px] font-semibold"
                            >
                              {copiedKey === 'pdf' ? (
                                <Check className="w-2.5 h-2.5 text-[#1DF27A]" />
                              ) : (
                                <Copy className="w-2.5 h-2.5" />
                              )}
                              <span>{copiedKey === 'pdf' ? 'Disalin' : 'Salin'}</span>
                            </button>
                            <a
                              href={links.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-300 text-slate-950 text-[10px] font-bold"
                            >
                              <span>Buka</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                        )}
                      </div>
                      {links.pdfUrl ? (
                        <a
                          href={links.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-[10.5px] font-mono text-amber-100 break-all hover:underline"
                        >
                          {links.pdfUrl}
                        </a>
                      ) : (
                        <div className="text-[10.5px] text-slate-400 italic">
                          Link PDF Kumpulan Karya belum diisi
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {canEdit && (
                <div className="pt-1 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => handleNewProject('sidang')}
                    className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#1DF27A] hover:bg-emerald-400 text-xs font-bold text-slate-950 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Upload Hasil Sidang Karya</span>
                  </button>
                </div>
              )}
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
                placeholder="Cari judul karya atau pelajaran..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl w-full md:w-56"
              />
            </div>
          </div>
        )}

        {/* Simplified Add / Edit Sidang Karya Form */}
        {canEdit && editingProject && (
          <form
            onSubmit={handleSubmitProject}
            className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-6 space-y-4 min-w-0 shadow-xs"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-display font-bold text-slate-900 text-base break-words">
                  {db.portfolios.some((p) => p.id === editingProject.id)
                    ? 'Edit Hasil Sidang Karya'
                    : 'Upload Hasil Sidang Karya'}
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Tampil tajam dan minimalis di Halaman 5 Rapor &amp; PDF (1 atau 2 gambar resolusi tinggi).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingProject(null)}
                className="text-xs text-slate-500 hover:text-slate-800 shrink-0 px-2 py-1"
              >
                Tutup
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
              <span className="text-[11px] font-semibold text-slate-600 mr-1">
                Pilih Cepat Pelajaran / Jenis:
              </span>
              {KARYA_TYPE_PRESETS.map((preset) => (
                <button
                  key={preset.jenis}
                  type="button"
                  onClick={() =>
                    setEditingProject({
                      ...editingProject,
                      jenis: preset.jenis,
                      judul:
                        preset.jenis === 'Sidang Karya' && !editingProject.judul.trim()
                          ? 'Sidang Karya Akhir Semester'
                          : editingProject.judul,
                      featured: preset.jenis === 'Sidang Karya' ? true : editingProject.featured,
                    })
                  }
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                    editingProject.jenis.toLowerCase() === preset.jenis.toLowerCase()
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : preset.highlight
                        ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Judul Karya
                </label>
                <input
                  type="text"
                  required
                  value={editingProject.judul}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, judul: e.target.value })
                  }
                  placeholder="Contoh: Sidang Karya – Desain Aplikasi Mutabaah Tahfidz"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Pelajaran / Jenis
                </label>
                <input
                  type="text"
                  required
                  value={editingProject.jenis}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, jenis: e.target.value })
                  }
                  placeholder="Sidang Karya / UI/UX Design"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Keterangan Singkat <span className="text-slate-400 font-normal">(opsional, maks. 1 baris)</span>
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
                  placeholder="Contoh: Presentasi desain UI/UX aplikasi dakwah digital santri"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            {uploadError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {uploadError}
              </div>
            )}

            {/* 1-2 High-Clarity Image Upload Slots (960px, JPEG 0.85, <= 42,000 chars) */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="text-xs font-semibold text-slate-800">
                  Upload Gambar Hasil Sidang Karya (1–2 Gambar Resolusi Tajam)
                </div>
                <span className="text-[11px] text-slate-500">
                  Otomatis dioptimalkan hingga 960px (tajam di PDF &amp; aman di Google Sheets)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {editingProject.mediaItems.slice(0, 2).map((m, idx) => {
                  const meta = slotUploadMeta[idx];
                  const hasImage = Boolean(m.url && m.url.trim() !== '');
                  return (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800">
                          {idx === 0
                            ? 'Gambar Utama Sidang Karya'
                            : 'Gambar Pendukung (Opsional)'}
                        </span>
                        {meta ? (
                          <span className="text-[10.5px] font-mono text-emerald-700 font-semibold">
                            {meta.width}px · {(meta.byteLength / 1024).toFixed(1)} KB
                          </span>
                        ) : null}
                      </div>

                      <div className="relative h-44 rounded-lg border border-slate-200 bg-white flex items-center justify-center overflow-hidden p-2">
                        {hasImage ? (
                          <img
                            src={m.url}
                            alt={m.caption || editingProject.judul || `Gambar ${idx + 1}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="text-center text-slate-400 space-y-1">
                            <ImageIcon className="w-7 h-7 mx-auto opacity-60" />
                            <div className="text-[11px]">Belum ada gambar</div>
                          </div>
                        )}
                      </div>

                      <input
                        type="text"
                        value={m.caption}
                        onChange={(e) => {
                          const next = [...editingProject.mediaItems];
                          next[idx] = { ...next[idx], caption: e.target.value };
                          setEditingProject({ ...editingProject, mediaItems: next });
                        }}
                        placeholder="Keterangan gambar (opsional)"
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
                        placeholder="Atau tempel URL gambar (opsional)"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                      />

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer transition-colors">
                          <Upload className="w-3.5 h-3.5 text-[#1DF27A]" />
                          <span>
                            {uploadingSlot === idx ? 'Memproses Tajam...' : 'Upload Gambar'}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            disabled={uploadingSlot !== null}
                            onChange={(e) => handleMediaUpload(idx, e)}
                            className="hidden"
                          />
                        </label>

                        {hasImage && (
                          <button
                            type="button"
                            onClick={() => handleClearMediaSlot(idx)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 text-xs font-semibold"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Hapus Gambar</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingProject(null)}
                className="w-full sm:w-auto min-h-[42px] sm:min-h-0 px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium"
              >
                Batal
              </button>
              <button
                type="submit"
                className="w-full sm:w-auto min-h-[42px] sm:min-h-0 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
              >
                Simpan Hasil Sidang Karya
              </button>
            </div>
          </form>
        )}

        {/* Portfolio Projects List */}
        {filteredProjects.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-10 text-center space-y-3">
            <div className="text-sm font-semibold text-slate-800">
              {projects.length === 0
                ? `Belum ada dokumentasi Sidang Karya untuk ${student.nama}`
                : 'Tidak ada karya yang cocok dengan filter jenis/pencarian.'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Upload 1 atau 2 gambar hasil Sidang Karya santri dengan resolusi tajam agar tampil bersih dan elegan di Halaman 5 Rapor &amp; PDF.
            </p>
            {canEdit && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => handleNewProject('sidang')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                >
                  <Plus className="w-4 h-4" />
                  <span>Upload Hasil Sidang Karya</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {filteredProjects.map((proj, index) => {
              const activeMedia = proj.mediaItems
                .filter((m) => m.url && m.url.trim() !== '')
                .slice(0, 2);
              const displayMedia =
                activeMedia.length > 0 ? activeMedia : proj.mediaItems.slice(0, 1);

              return (
                <div
                  key={proj.id}
                  className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="text-[11px] font-display font-extrabold text-slate-950 px-3 py-0.5 rounded-full"
                          style={{ backgroundColor: theme.sectionSky }}
                        >
                          {proj.jenis.toUpperCase()}
                        </span>
                        <span className="text-xs font-mono text-slate-500">
                          Karya {index + 1} · {proj.semester} {proj.tahunAkademik}
                        </span>
                      </div>
                      <h2 className="font-display font-bold text-lg sm:text-xl text-slate-900 break-words">
                        {proj.judul}
                      </h2>
                      {proj.keteranganSingkat && (
                        <p className="text-xs text-slate-500 break-words">
                          {proj.keteranganSingkat}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {displayMedia[0] && (
                        <button
                          type="button"
                          onClick={() =>
                            setLightboxMedia({
                              item: displayMedia[0],
                              projectTitle: proj.judul,
                              jenis: proj.jenis,
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Lihat Penuh</span>
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
                            onClick={() => openEditProject(proj)}
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

                  {/* Clean 1-Image or 2-Image Side-by-Side Sharp Showcase */}
                  <div
                    className={
                      displayMedia.length >= 2
                        ? 'grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0'
                        : 'min-w-0'
                    }
                  >
                    {displayMedia.map((mediaItem, mIdx) => (
                      <div key={mIdx} className="min-w-0">
                        {renderSharpMediaFrame(
                          mediaItem,
                          proj.judul,
                          proj.jenis,
                          displayMedia.length >= 2 ? 'h-56 sm:h-64' : 'h-64 sm:h-80'
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fullscreen Lightbox */}
      {lightboxMedia && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => setLightboxMedia(null)}
        >
          <div
            className="relative w-full max-w-3xl max-h-[90dvh] overflow-y-auto my-auto bg-white rounded-2xl shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 px-4 sm:px-5 py-3.5 border-b border-slate-200">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-emerald-700 uppercase">
                  {lightboxMedia.jenis}
                </div>
                <div className="font-display font-bold text-sm text-slate-900 break-words">
                  {lightboxMedia.projectTitle}
                </div>
                {lightboxMedia.item.caption && (
                  <div className="text-xs text-slate-500 break-words">
                    {lightboxMedia.item.caption}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLightboxMedia(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="h-[280px] sm:h-[460px] shrink-0 bg-slate-900 flex items-center justify-center p-2">
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
                    alt={lightboxMedia.item.caption || lightboxMedia.projectTitle}
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
