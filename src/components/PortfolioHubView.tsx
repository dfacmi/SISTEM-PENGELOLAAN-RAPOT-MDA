import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Link2,
  Loader2,
  PenSquare,
  Plus,
  Search,
  Sparkles,
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
  slugifyName,
} from '../utils/grading';
import { compressImageToJpegUnderLimit } from '../utils/imageHelper';
import {
  buildPortfolioProjectsFromExtractedPages,
  ExtractedPdfPageCandidate,
  extractAndScorePdfPages,
} from '../utils/pdfPortfolioExtractor';
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
  const [copiedKey, setCopiedKey] = useState<'link1' | 'link2' | 'link3' | null>(null);
  const [editingLinks, setEditingLinks] = useState(false);
  const [link1Draft, setLink1Draft] = useState('');
  const [link2Draft, setLink2Draft] = useState('');
  const [link3Draft, setLink3Draft] = useState('');
  const [link3SubjectDraft, setLink3SubjectDraft] = useState('UI/UX Design & Graphic Design');

  // Client-side PDF Karya Extractor states
  const [showPdfExtractor, setShowPdfExtractor] = useState(false);
  const [pdfSubject, setPdfSubject] = useState('UI/UX Design & Graphic Design');
  const [pdfDriveLink, setPdfDriveLink] = useState('');
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [pdfProgressText, setPdfProgressText] = useState('');
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [extractedPages, setExtractedPages] = useState<ExtractedPdfPageCandidate[]>([]);
  const [pdfPageMeta, setPdfPageMeta] = useState<{
    fileName: string;
    totalPages: number;
    processedPages: number;
  } | null>(null);

  const [editingProject, setEditingProject] = useState<PortfolioProject | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [slotByteSizes, setSlotByteSizes] = useState<Record<number, number>>({});
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

  const links = getStudentPortfolioLinks(student, db.spreadsheetId);

  const handleCopy = async (key: 'link1' | 'link2' | 'link3', urlText: string) => {
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
    setLink1Draft(student.portfolioSlug || '');
    setLink2Draft(student.behanceUrl || '');
    setLink3Draft(student.portfolioPdfUrl || '');
    setLink3SubjectDraft(student.portfolioPdfSubject || 'UI/UX Design & Graphic Design');
    setEditingLinks(true);
  };

  const handleNewProject = (preset: 'default' | 'sidang' = 'default') => {
    setSlotByteSizes({});
    setEditingProject({
      id: `port-${Date.now()}`,
      studentId: student.id,
      tahunAkademik: latestReport?.tahunAkademik || '2026/2027',
      semester: latestReport?.semester || 'Gasal',
      judul: preset === 'sidang' ? 'Sidang Karya Akhir Semester' : '',
      jenis: preset === 'sidang' ? 'Sidang Karya' : 'Graphic Design / UI/UX',
      keteranganSingkat:
        preset === 'sidang' ? 'Presentasi & Sidang Karya Proyek Utama Santri' : '',
      competence:
        preset === 'sidang'
          ? 'Mampu merancang, mempresentasikan, dan mempertanggungjawabkan hasil karya di hadapan penguji.'
          : '',
      technology: 'Figma, Canva',
      description: '',
      externalLink: '',
      mediaItems: [
        {
          url: '',
          type: 'image',
          caption: preset === 'sidang' ? 'Dokumentasi / Slide Sidang Karya' : 'Karya Utama',
          presetArt: 'poster',
        },
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
      let res: { url: string; type: 'image' | 'video' } | null = null;
      if (file.type.startsWith('image/')) {
        // Compress strictly to max 640px, JPEG 0.68, < 22 KB for reliable Sheets/PDF speed
        const compressed = await compressImageToJpegUnderLimit(file, {
          maxWidth: 640,
          quality: 0.68,
          maxBytes: 22 * 1024,
          maxChars: 30000,
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
        if (!driveRes) {
          setSlotByteSizes((prev) => ({ ...prev, [slotIdx]: compressed.byteLength }));
        }
      } else {
        res = await onUploadMediaToDrive(file);
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

  const handlePdfUploadForExtraction = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfError(null);
    setPdfExtracting(true);
    setExtractedPages([]);
    setPdfProgressText('Membaca file PDF di browser...');
    try {
      const summary = await extractAndScorePdfPages(file, {
        defaultSubject: pdfSubject.trim() || 'UI/UX Design & Graphic Design',
        maxPages: 20,
        onProgress: (curr, total) => {
          setPdfProgressText(`Menganalisis halaman ${curr}/${total}...`);
        },
      });
      setExtractedPages(summary.pages);
      setPdfPageMeta({
        fileName: file.name,
        totalPages: summary.totalPagesInPdf,
        processedPages: summary.processedPages,
      });
    } catch (err: any) {
      setPdfError(
        err?.message ||
          'Gagal membaca PDF di browser. Pastikan file PDF valid dan tidak terkunci password.'
      );
    } finally {
      setPdfExtracting(false);
      setPdfProgressText('');
      e.target.value = '';
    }
  };

  const handleSaveExtractedPages = () => {
    const chosen = extractedPages.filter((p) => p.selected);
    if (chosen.length === 0) return;

    const cleanSubject = pdfSubject.trim() || 'UI/UX Design & Graphic Design';
    const newProjects = buildPortfolioProjectsFromExtractedPages({
      studentId: student.id,
      tahunAkademik: latestReport?.tahunAkademik || '2026/2027',
      semester: latestReport?.semester || 'Gasal',
      subject: cleanSubject,
      pdfExternalLink: pdfDriveLink.trim() || student.portfolioPdfUrl || '',
      selectedPages: chosen,
    });

    onSavePortfolios([...db.portfolios, ...newProjects]);
    setExtractedPages([]);
    setPdfPageMeta(null);
    setShowPdfExtractor(false);
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

        {/* MDA Branded Student Portfolio Hero Profile + QR Code */}
        <div className="bg-white border border-emerald-200 rounded-2xl overflow-hidden shadow-xs">
          <div
            className="px-6 py-3 text-white text-xs font-semibold flex flex-wrap items-center justify-between gap-2"
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
                      {projects.length} Karya Terpublikasi
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
                    <span>3 Link Portofolio Santri</span>
                  </div>
                  {canEdit && onUpdatePortfolioLinks && !editingLinks && (
                    <button
                      type="button"
                      onClick={openEditLinksForm}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[11px] font-medium text-emerald-200 transition-colors"
                    >
                      <PenSquare className="w-3 h-3" />
                      <span>Isi / Edit 3 Link</span>
                    </button>
                  )}
                </div>

                {editingLinks && onUpdatePortfolioLinks ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const raw1 = link1Draft.trim();
                      const nextSlug = /^https?:\/\//i.test(raw1)
                        ? normalizeExternalUrl(raw1)
                        : /^www\./i.test(raw1)
                          ? `https://${raw1}`
                          : slugifyName(raw1) || slugifyName(student.nama);
                      onUpdatePortfolioLinks(student.id, {
                        portfolioSlug: nextSlug,
                        behanceUrl: normalizeExternalUrl(link2Draft),
                        portfolioPdfUrl: normalizeExternalUrl(link3Draft),
                        portfolioPdfSubject: link3SubjectDraft.trim(),
                      });
                      setEditingLinks(false);
                    }}
                    className="space-y-2.5 pt-1"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="text-[10.5px] font-semibold text-emerald-200">
                          Link 1: Sidang Karya (Slug / URL)
                        </label>
                        <button
                          type="button"
                          onClick={() => setLink1Draft(slugifyName(student.nama))}
                          className="text-[10px] text-slate-300 hover:text-white underline"
                        >
                          Reset Slug
                        </button>
                      </div>
                      <input
                        type="text"
                        value={link1Draft}
                        onChange={(e) => setLink1Draft(e.target.value)}
                        placeholder="alwan-hanif atau https://..."
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-emerald-400/40 text-[11px] font-mono text-white placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10.5px] font-semibold text-sky-200 mb-1">
                        Link 2: Portofolio Behance
                      </label>
                      <input
                        type="text"
                        value={link2Draft}
                        onChange={(e) => setLink2Draft(e.target.value)}
                        placeholder="https://www.behance.net/username"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-sky-400/40 text-[11px] font-mono text-white placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10.5px] font-semibold text-amber-200 mb-1">
                        Link 3: PDF Kumpulan Karya 1 Semester
                      </label>
                      <input
                        type="text"
                        value={link3Draft}
                        onChange={(e) => setLink3Draft(e.target.value)}
                        placeholder="https://drive.google.com/file/d/..."
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-amber-400/40 text-[11px] font-mono text-white placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10.5px] font-semibold text-amber-100 mb-1">
                        Nama Pelajaran (untuk Link 3)
                      </label>
                      <input
                        type="text"
                        value={link3SubjectDraft}
                        onChange={(e) => setLink3SubjectDraft(e.target.value)}
                        placeholder="UI/UX Design & Graphic Design"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-amber-400/30 text-[11px] text-white placeholder:text-slate-400 focus:outline-none"
                      />
                      <div className="flex flex-wrap gap-1 mt-1">
                        {['UI/UX Design & Graphic Design', 'UI/UX Design', 'Graphic Design'].map(
                          (opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setLink3SubjectDraft(opt)}
                              className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[9.5px] text-amber-200"
                            >
                              {opt}
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded-md bg-[#1DF27A] text-slate-950 text-[11px] font-bold"
                      >
                        Simpan 3 Link
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
                    {/* Link 1 */}
                    <div className="rounded-lg bg-white/10 border border-white/10 p-2 space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-[#1DF27A]">
                          1. Sidang Karya
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleCopy('link1', links.sidangUrl)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-[10px] font-semibold"
                          >
                            {copiedKey === 'link1' ? (
                              <Check className="w-2.5 h-2.5 text-[#1DF27A]" />
                            ) : (
                              <Copy className="w-2.5 h-2.5" />
                            )}
                            <span>{copiedKey === 'link1' ? 'Disalin' : 'Salin'}</span>
                          </button>
                          <a
                            href={links.sidangUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#1DF27A] text-slate-950 text-[10px] font-bold"
                          >
                            <span>Buka</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>
                      <a
                        href={links.sidangUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-[10.5px] font-mono text-emerald-100 break-all hover:underline"
                      >
                        {links.sidangUrl}
                      </a>
                    </div>

                    {/* Link 2 */}
                    <div className="rounded-lg bg-white/10 border border-white/10 p-2 space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-sky-300">
                          2. Portofolio Behance
                        </span>
                        {links.behanceUrl && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => void handleCopy('link2', links.behanceUrl)}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-[10px] font-semibold"
                            >
                              {copiedKey === 'link2' ? (
                                <Check className="w-2.5 h-2.5 text-[#1DF27A]" />
                              ) : (
                                <Copy className="w-2.5 h-2.5" />
                              )}
                              <span>{copiedKey === 'link2' ? 'Disalin' : 'Salin'}</span>
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
                        <div className="text-[10.5px] text-slate-400 italic">Belum diisi</div>
                      )}
                    </div>

                    {/* Link 3 */}
                    <div className="rounded-lg bg-white/10 border border-white/10 p-2 space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5 flex-wrap">
                        <div className="flex flex-wrap items-center gap-1 min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">
                            3. PDF Karya 1 Semester
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
                              onClick={() => void handleCopy('link3', links.pdfUrl)}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-[10px] font-semibold"
                            >
                              {copiedKey === 'link3' ? (
                                <Check className="w-2.5 h-2.5 text-[#1DF27A]" />
                              ) : (
                                <Copy className="w-2.5 h-2.5" />
                              )}
                              <span>{copiedKey === 'link3' ? 'Disalin' : 'Salin'}</span>
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
                        <div className="text-[10.5px] text-slate-400 italic">Belum diisi</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {canEdit && (
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => handleNewProject('sidang')}
                    className="flex-1 min-h-[36px] inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-[#1DF27A] hover:bg-emerald-400 text-xs font-bold text-slate-950 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Karya / Sidang Baru</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPdfDriveLink(student.portfolioPdfUrl || '');
                      setPdfSubject(student.portfolioPdfSubject || 'UI/UX Design & Graphic Design');
                      setShowPdfExtractor((prev) => !prev);
                    }}
                    className="flex-1 min-h-[36px] inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold text-white transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-amber-300" />
                    <span>Ekstrak PDF</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dedicated Browser-Only PDF Kumpulan Karya Extractor */}
        {canEdit && showPdfExtractor && (
          <div className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xs min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="space-y-1 min-w-0">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>Upload &amp; Ekstrak Otomatis Karya Terbaik dari PDF</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  File PDF diproses 100% di browser Anda (tidak dikirim ke server/Sheets). Sistem menilai variasi warna, kepadatan visual, dan komposisi untuk otomatis memilih 2–4 karya terbaik (maks. 20 KB per thumbnail).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPdfExtractor(false)}
                className="self-end sm:self-start text-xs text-slate-500 hover:text-slate-800 px-2 py-1"
              >
                Tutup
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Nama Pelajaran Karya PDF
                </label>
                <input
                  type="text"
                  value={pdfSubject}
                  onChange={(e) => setPdfSubject(e.target.value)}
                  placeholder="UI/UX Design & Graphic Design"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {[
                    'UI/UX Design & Graphic Design',
                    'UI/UX Design',
                    'Graphic Design',
                    'Desain Multimedia',
                  ].map((subj) => (
                    <button
                      key={subj}
                      type="button"
                      onClick={() => setPdfSubject(subj)}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                        pdfSubject === subj
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-emerald-50'
                      }`}
                    >
                      {subj}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Link PDF Asli (Google Drive, opsional untuk tautan tiap karya)
                </label>
                <input
                  type="url"
                  value={pdfDriveLink}
                  onChange={(e) => setPdfDriveLink(e.target.value)}
                  placeholder="https://drive.google.com/file/d/..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
                <div className="pt-1">
                  <label className="w-full sm:w-auto min-h-[40px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#0E2228] hover:bg-slate-800 text-white text-xs font-bold cursor-pointer transition-colors">
                    {pdfExtracting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#1DF27A]" />
                        <span>{pdfProgressText || 'Menganalisis PDF...'}</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 text-[#1DF27A]" />
                        <span>Pilih File PDF Kumpulan Karya (.pdf)</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={pdfExtracting}
                      onChange={(e) => void handlePdfUploadForExtraction(e)}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>

            {pdfError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {pdfError}
              </div>
            )}

            {extractedPages.length > 0 && (
              <div className="space-y-4 pt-2 border-t border-slate-100">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="text-xs text-slate-700">
                    <strong>{pdfPageMeta?.fileName}</strong> · Teranalisis{' '}
                    {pdfPageMeta?.processedPages} dari {pdfPageMeta?.totalPages} halaman.{' '}
                    <span className="text-emerald-700 font-semibold">
                      ({extractedPages.filter((p) => p.selected).length} karya dipilih untuk disimpan)
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExtractedPages((prev) =>
                          prev.map((p) => ({ ...p, selected: p.recommended }))
                        )
                      }
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Pilih Rekomendasi Terbaik
                    </button>
                    <button
                      type="button"
                      disabled={extractedPages.filter((p) => p.selected).length === 0}
                      onClick={handleSaveExtractedPages}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white text-xs font-bold"
                    >
                      Simpan {extractedPages.filter((p) => p.selected).length} Karya Terpilih
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {extractedPages.map((page) => (
                    <div
                      key={page.pageNumber}
                      className={`rounded-xl border p-3 space-y-2.5 transition-colors ${
                        page.selected
                          ? 'border-emerald-500 bg-emerald-50/40'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="relative h-44 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center">
                        <img
                          src={page.thumbnailDataUrl}
                          alt={`Halaman ${page.pageNumber}`}
                          className="w-full h-full object-contain"
                        />
                        {page.recommended && (
                          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-[#0E2228]/90 text-[#1DF27A] text-[10px] font-bold shadow-xs">
                            Terpilih Otomatis (Terbaik)
                          </span>
                        )}
                        <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-white/90 border border-slate-200 text-[10px] font-mono font-bold text-slate-800">
                          Skor {page.score}
                        </span>
                      </div>

                      <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                        <span className="inline-flex items-center gap-2 font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            checked={page.selected}
                            onChange={(e) =>
                              setExtractedPages((prev) =>
                                prev.map((p) =>
                                  p.pageNumber === page.pageNumber
                                    ? { ...p, selected: e.target.checked }
                                    : p
                                )
                              )
                            }
                            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span>Hal. {page.pageNumber}</span>
                        </span>
                        <span className="text-[11px] font-mono text-slate-500">
                          {(page.byteLength / 1024).toFixed(1)} KB
                        </span>
                      </label>

                      <input
                        type="text"
                        value={page.title}
                        onChange={(e) =>
                          setExtractedPages((prev) =>
                            prev.map((p) =>
                              p.pageNumber === page.pageNumber
                                ? { ...p, title: e.target.value }
                                : p
                            )
                          )
                        }
                        placeholder={`Judul karya halaman ${page.pageNumber}`}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
            className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-6 space-y-4 min-w-0"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h2 className="font-display font-bold text-slate-900 text-base break-words">
                {db.portfolios.some((p) => p.id === editingProject.id)
                  ? 'Edit Karya Portofolio'
                  : 'Tambah Karya / Proyek Santri'}
              </h2>
              <button
                type="button"
                onClick={() => setEditingProject(null)}
                className="text-xs text-slate-500 hover:text-slate-800 shrink-0"
              >
                Tutup
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
              <span className="text-[11px] font-semibold text-slate-600 mr-1">
                Pilih Cepat Jenis Karya:
              </span>
              {[
                {
                  label: 'Sidang Karya (Utama Rapor Hal. 5)',
                  jenis: 'Sidang Karya',
                  highlight: true,
                },
                { label: 'UI/UX Design', jenis: 'UI/UX Design', highlight: false },
                { label: 'Graphic Design', jenis: 'Graphic Design', highlight: false },
                {
                  label: 'UI/UX Design & Graphic Design',
                  jenis: 'UI/UX Design & Graphic Design',
                  highlight: false,
                },
                {
                  label: 'Fotografi & Videografi',
                  jenis: 'Fotografi & Videografi',
                  highlight: false,
                },
              ].map((preset) => (
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
                  Judul Proyek / Karya
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
                  Judul Materi / Jenis Karya
                </label>
                <input
                  type="text"
                  required
                  value={editingProject.jenis}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, jenis: e.target.value })
                  }
                  placeholder="Sidang Karya / UI/UX / Graphic Design"
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

            {/* 3 Media Slots with <22KB JPEG Compression / Google Drive Upload */}
            <div className="pt-2 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-800 mb-3">
                Galeri Media Karya (3 Slot Foto/Video — Kompres Otomatis &lt; 22 KB untuk Rapor &amp; Sheets)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {editingProject.mediaItems.map((m, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700">
                        Slot Karya {idx + 1}
                      </span>
                      {slotByteSizes[idx] ? (
                        <span className="text-[10px] font-mono text-emerald-700 font-semibold">
                          {(slotByteSizes[idx] / 1024).toFixed(1)} KB
                        </span>
                      ) : null}
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
                          {uploadingSlot === idx ? 'Mengompres...' : 'Upload Karya'}
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
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleNewProject('sidang')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tambah Sidang Karya / Karya Baru</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPdfDriveLink(student.portfolioPdfUrl || '');
                    setPdfSubject(student.portfolioPdfSubject || 'UI/UX Design & Graphic Design');
                    setShowPdfExtractor(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0E2228] text-white text-xs font-semibold hover:bg-slate-800"
                >
                  <FileText className="w-4 h-4 text-[#1DF27A]" />
                  <span>Ekstrak Karya dari PDF</span>
                </button>
              </div>
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
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 min-w-0">
                  <div className="md:col-span-6 min-w-0">
                    {proj.mediaItems[0] &&
                      renderMediaFrame(
                        proj.mediaItems[0],
                        proj.judul,
                        proj.jenis,
                        'h-60 md:h-72'
                      )}
                  </div>
                  <div className="md:col-span-6 min-w-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-4">
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
                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 pt-2 min-w-0">
                  <div className="md:col-span-5 min-w-0 space-y-3">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs font-bold text-slate-900 mb-1">
                        Student Competence
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed break-words">
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
                      <p className="text-xs font-mono font-semibold text-emerald-800 break-words">
                        {proj.technology}
                      </p>
                    </div>
                  </div>

                  <div className="md:col-span-7 min-w-0 p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-xs font-bold text-slate-900 mb-1">
                      Description
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed break-words">
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
                <div className="text-xs text-slate-500 break-words">
                  {lightboxMedia.item.caption}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLightboxMedia(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="h-[280px] sm:h-[420px] shrink-0 bg-slate-900 flex items-center justify-center">
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
