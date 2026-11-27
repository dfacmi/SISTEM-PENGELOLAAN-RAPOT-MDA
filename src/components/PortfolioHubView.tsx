import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Image as ImageIcon,
  Link2,
  Loader2,
  PenSquare,
  Plus,
  Save,
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
  GroupedPortfolioProject,
  generateParentPortfolioNarrative,
  getGoogleDriveDownloadUrl,
  getStudentPortfolioLinks,
  groupPortfolioProjects,
  normalizeExternalUrl,
  splitPortfolioProjectForStorage,
} from '../utils/grading';
import {
  compressSidangImageWebp,
  normalizeDisplayImageUrl,
  shrinkImageDataUrlWebp,
} from '../utils/imageHelper';
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
  selectedYear?: string;
  selectedSemester?: 'Gasal' | 'Genap';
  canEdit: boolean;
  isPublicStandalone?: boolean;
  templateConfig?: BrandingTemplateConfig;
  onSelectStudent?: (id: string) => void;
  onSavePortfolios: (projects: PortfolioProject[]) => void;
  onSavePortfolioSummary?: (
    studentId: string,
    tahunAkademik: string,
    semester: 'Gasal' | 'Genap',
    summaryText: string
  ) => void;
  onUpdatePortfolioLinks?: (studentId: string, patch: PortfolioLinksPatch) => void;
  onUploadMediaToDrive?: (file: File) => Promise<{ url: string; type: 'image' | 'video' } | null>;
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
  selectedYear,
  selectedSemester,
  canEdit,
  isPublicStandalone = false,
  templateConfig,
  onSelectStudent,
  onSavePortfolios,
  onSavePortfolioSummary,
  onUpdatePortfolioLinks,
  onExitPublicStandalone,
}) => {
  const [copiedKey, setCopiedKey] = useState<'behance' | 'pdf' | null>(null);
  const [editingLinks, setEditingLinks] = useState(false);
  const [behanceDraft, setBehanceDraft] = useState('');
  const [pdfUrlDraft, setPdfUrlDraft] = useState('');
  const [pdfSubjectDraft, setPdfSubjectDraft] = useState('UI/UX Design & Graphic Design');

  const [editingProject, setEditingProject] = useState<PortfolioProject | null>(null);
  const [editingSourceIds, setEditingSourceIds] = useState<string[]>([]);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [slotUploadMeta, setSlotUploadMeta] = useState<
    Record<number, { byteLength: number; charLength: number; width: number; height: number; mimeType: string }>
  >({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [summaryDraft, setSummaryDraft] = useState<string>('');
  const [summaryDirty, setSummaryDirty] = useState<boolean>(false);
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

  const groupedProjects = useMemo(
    () => groupPortfolioProjects(projects),
    [projects]
  );

  const activePeriod = useMemo(
    () => db.periods.find((p) => p.isActive) || db.periods[0],
    [db.periods]
  );

  const targetYear = selectedYear || activePeriod?.tahunAkademik || '2026/2027';
  const targetSemester = selectedSemester || activePeriod?.semester || 'Gasal';

  const latestReport = useMemo(() => {
    const exact = db.reports.find(
      (r) =>
        r.studentId === student?.id &&
        r.tahunAkademik === targetYear &&
        r.semester === targetSemester
    );
    if (exact) return exact;
    const reps = db.reports.filter((r) => r.studentId === student?.id);
    return reps[reps.length - 1];
  }, [db.reports, student, targetYear, targetSemester]);

  const autoGeneratedNarrative = useMemo(
    () =>
      generateParentPortfolioNarrative({
        report: latestReport,
        projects: groupedProjects,
      }),
    [latestReport, groupedProjects]
  );

  const savedNarrative = (latestReport?.ringkasanPortofolio || '').trim();

  useEffect(() => {
    setSummaryDraft(savedNarrative || autoGeneratedNarrative);
    setSummaryDirty(false);
  }, [student?.id, latestReport?.id, savedNarrative, autoGeneratedNarrative]);

  const jenisOptions = useMemo(() => {
    const set = new Set<string>(['Semua']);
    groupedProjects.forEach((p) => {
      if (p.jenis.trim()) set.add(p.jenis.trim());
    });
    return Array.from(set);
  }, [groupedProjects]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return groupedProjects.filter((p) => {
      const matchType = typeFilter === 'Semua' || p.jenis.trim() === typeFilter;
      const matchSearch =
        q === '' ||
        p.judul.toLowerCase().includes(q) ||
        p.jenis.toLowerCase().includes(q) ||
        p.keteranganSingkat.toLowerCase().includes(q);
      return matchType && matchSearch;
    });
  }, [groupedProjects, typeFilter, searchQuery]);

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
    setEditingSourceIds([]);
    setEditingProject({
      id: `port-${Date.now()}`,
      studentId: student.id,
      tahunAkademik: latestReport?.tahunAkademik || targetYear,
      semester: latestReport?.semester || targetSemester,
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
          caption: 'Foto Karya 1',
          presetArt: 'poster',
        },
        {
          url: '',
          type: 'image',
          caption: 'Foto Karya 2',
          presetArt: 'uiux',
        },
        {
          url: '',
          type: 'image',
          caption: 'Foto Karya 3',
          presetArt: 'video',
        },
      ],
      featured: true,
    });
  };

  const openEditProject = (proj: GroupedPortfolioProject) => {
    setSlotUploadMeta({});
    setUploadError(null);
    setEditingSourceIds(proj.sourceIds || [proj.id]);
    const items = (proj.mediaItems || []).map((m) => ({ ...m }));
    while (items.length < 3) {
      const idx = items.length;
      items.push({
        url: '',
        type: 'image',
        caption: `Foto Karya ${idx + 1}`,
        presetArt: idx === 0 ? 'poster' : idx === 1 ? 'uiux' : 'video',
      });
    }
    setEditingProject({
      ...proj,
      id: proj.id.replace(/__slot[23]$/, ''),
      mediaItems: items.slice(0, 3),
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
      // Terima file gambar ukuran berapapun (termasuk 3-25 MB) dan optimalkan 100% di browser
      const isImageFile =
        file.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name);
      if (!isImageFile) {
        setUploadError('Mohon pilih file gambar (JPG, PNG, WEBP) agar tampil tajam di PDF.');
        return;
      }

      // Resolusi tajam maxWidth 720px, <= 30.000 karakter WebP per slot (otomatis di-split baris saat simpan agar aman dari limit 50k Sheets)
      const compressed = await compressSidangImageWebp(file, {
        maxChars: 30000,
        maxWidth: 720,
      });

      const nextMedia = [...editingProject.mediaItems];
      while (nextMedia.length < 3) {
        const idx = nextMedia.length;
        nextMedia.push({
          url: '',
          type: 'image',
          caption: `Foto Karya ${idx + 1}`,
          presetArt: idx === 0 ? 'poster' : idx === 1 ? 'uiux' : 'video',
        });
      }
      nextMedia[slotIdx] = {
        ...nextMedia[slotIdx],
        url: compressed.dataUrl,
        type: 'image',
      };

      setSlotUploadMeta((prev) => ({
        ...prev,
        [slotIdx]: {
          byteLength: compressed.byteLength,
          charLength: compressed.dataUrl.length,
          width: compressed.width,
          height: compressed.height,
          mimeType: compressed.mimeType,
        },
      }));
      setEditingProject({ ...editingProject, mediaItems: nextMedia.slice(0, 3) });
    } catch (err: any) {
      setUploadError(
        err?.message ||
          'Gagal mengoptimalkan gambar. Pastikan file berupa gambar JPG/PNG/WEBP yang valid.'
      );
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

  const handleSubmitProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject || !editingProject.judul.trim()) return;

    // Normalize Google Drive URL & pastikan setiap slot DataURL <= 30.000 karakter (maxWidth 720px)
    const normalizedMedia = editingProject.mediaItems.slice(0, 3).map((m) => ({
      ...m,
      url: normalizeDisplayImageUrl(m.url),
    }));

    for (let i = 0; i < normalizedMedia.length; i++) {
      if (normalizedMedia[i].url.startsWith('data:image/') && normalizedMedia[i].url.length > 30000) {
        normalizedMedia[i] = {
          ...normalizedMedia[i],
          url: await shrinkImageDataUrlWebp(normalizedMedia[i].url, 30000, 720),
        };
      }
    }

    const cleanProject: PortfolioProject = {
      ...editingProject,
      id: editingProject.id.replace(/__slot[23]$/, ''),
      mediaItems: normalizedMedia,
    };

    // Pecah aman per foto jika ada >= 2 foto WebP agar tiap baris Google Sheets selalu < 42.000 karakter
    const recordsToSave = splitPortfolioProjectForStorage(cleanProject);
    const idsToReplace = new Set(
      editingSourceIds.length > 0 ? editingSourceIds : [cleanProject.id]
    );

    const firstReplaceIdx = db.portfolios.findIndex((p) => idsToReplace.has(p.id));
    const filteredExisting = db.portfolios.filter((p) => !idsToReplace.has(p.id));
    const next =
      firstReplaceIdx >= 0
        ? [
            ...filteredExisting.slice(0, firstReplaceIdx),
            ...recordsToSave,
            ...filteredExisting.slice(firstReplaceIdx),
          ]
        : [...filteredExisting, ...recordsToSave];

    onSavePortfolios(next);
    setEditingProject(null);
    setEditingSourceIds([]);
  };

  const renderSharpMediaFrame = (
    item: PortfolioMediaItem,
    projectTitle: string,
    jenis: string,
    heightClass = 'h-60 sm:h-72'
  ) => {
    const resolvedUrl = normalizeDisplayImageUrl(item.url);
    const hasUrl = resolvedUrl !== '';
    return (
      <button
        type="button"
        onClick={() =>
          setLightboxMedia({
            item: { ...item, url: resolvedUrl },
            projectTitle,
            jenis,
          })
        }
        className={`group relative w-full ${heightClass} rounded-xl overflow-hidden border border-slate-200 bg-white text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 flex items-center justify-center p-2`}
      >
        {hasUrl ? (
          item.type === 'video' ? (
            <iframe
              src={resolvedUrl}
              title={item.caption || projectTitle}
              className="w-full h-full pointer-events-none rounded-lg"
            />
          ) : (
            <img
              src={resolvedUrl}
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
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/35 to-transparent p-3 flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-white truncate">
            {item.caption || projectTitle}
          </div>
          <span className="text-xs font-semibold text-[#1DF27A] shrink-0">
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
                className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0E2228] text-white text-sm font-semibold hover:bg-slate-800 whitespace-nowrap"
              >
                <ArrowLeft className="w-4 h-4" />
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
                    <span>Tahfidz: {latestReport.tahfidz.totalHafalan || '-'}</span>
                    <span aria-hidden="true">·</span>
                    <span>Multimedia: {latestReport.pilar.penguasaanMultimedia}%</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-emerald-700">
                      {groupedProjects.length} Dokumentasi Karya
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div
              className="flex flex-col justify-between gap-3.5 text-white rounded-xl p-4 sm:p-5 w-full lg:w-[420px] xl:w-[450px] min-w-0 max-w-full shrink-0"
              style={{ backgroundColor: theme.darkPill }}
            >
              <div className="space-y-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1DF27A]">
                    <Link2 className="w-4 h-4 shrink-0" />
                    <span>Link Portofolio Santri</span>
                  </div>
                  {canEdit && onUpdatePortfolioLinks && !editingLinks && (
                    <button
                      type="button"
                      onClick={openEditLinksForm}
                      className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-emerald-200 transition-colors"
                    >
                      <PenSquare className="w-3.5 h-3.5" />
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
                    className="space-y-3 pt-1"
                  >
                    <div>
                      <label className="block text-xs font-semibold text-sky-200 mb-1">
                        1. Link Portofolio (Behance) — Cover Hal. 1 &amp; Hal. 5
                      </label>
                      <input
                        type="text"
                        value={behanceDraft}
                        onChange={(e) => setBehanceDraft(e.target.value)}
                        placeholder="https://www.behance.net/username"
                        className="w-full min-h-[42px] px-3 py-2 rounded-lg bg-slate-950/70 border border-sky-400/40 text-base sm:text-xs font-mono text-white placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-amber-200 mb-1">
                        2. Link Kumpulan Karya 1 Semester (PDF Google Drive)
                      </label>
                      <input
                        type="text"
                        value={pdfUrlDraft}
                        onChange={(e) => setPdfUrlDraft(e.target.value)}
                        placeholder="https://drive.google.com/file/d/..."
                        className="w-full min-h-[42px] px-3 py-2 rounded-lg bg-slate-950/70 border border-amber-400/40 text-base sm:text-xs font-mono text-white placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-amber-100 mb-1">
                        Nama Pelajaran (untuk PDF Kumpulan Karya)
                      </label>
                      <input
                        type="text"
                        value={pdfSubjectDraft}
                        onChange={(e) => setPdfSubjectDraft(e.target.value)}
                        placeholder="UI/UX Design & Graphic Design"
                        className="w-full min-h-[42px] px-3 py-2 rounded-lg bg-slate-950/70 border border-amber-400/30 text-base sm:text-xs text-white placeholder:text-slate-400 focus:outline-none"
                      />
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {SUBJECT_PRESETS.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setPdfSubjectDraft(opt)}
                            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-amber-200"
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="submit"
                        className="min-h-[42px] px-3.5 py-2 rounded-lg bg-[#1DF27A] text-slate-950 text-xs sm:text-sm font-bold"
                      >
                        Simpan Link Portofolio
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingLinks(false)}
                        className="min-h-[42px] px-3 py-2 rounded-lg text-xs sm:text-sm text-slate-300 hover:text-white"
                      >
                        Batal
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-2.5 min-w-0">
                    {/* Link 1: Behance / Google Drive */}
                    {(() => {
                      const behanceDownloadUrl = getGoogleDriveDownloadUrl(
                        links.behanceUrl
                      );
                      return (
                        <div className="rounded-xl bg-white/10 border border-white/10 p-3 space-y-1.5 min-w-0">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="min-w-0">
                              <span className="text-xs font-bold uppercase tracking-wide text-sky-300 block">
                                1. Link Portofolio (Behance)
                              </span>
                              <span className="text-xs text-slate-300">
                                Tampil di Cover Hal. 1 &amp; Hal. 5
                              </span>
                            </div>
                            {links.behanceUrl && (
                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => void handleCopy('behance', links.behanceUrl)}
                                  className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold"
                                >
                                  {copiedKey === 'behance' ? (
                                    <Check className="w-3.5 h-3.5 text-[#1DF27A]" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                  <span>{copiedKey === 'behance' ? 'Disalin' : 'Salin'}</span>
                                </button>
                                <a
                                  href={links.behanceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 text-xs font-bold transition-colors"
                                >
                                  <span>Buka</span>
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                                {behanceDownloadUrl && (
                                  <a
                                    href={behanceDownloadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-sky-50 text-slate-950 text-xs font-bold transition-colors"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Unduh</span>
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                          {links.behanceUrl ? (
                            <a
                              href={links.behanceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-xs font-mono text-sky-100 break-all hover:underline"
                            >
                              {links.behanceUrl}
                            </a>
                          ) : (
                            <div className="text-xs text-slate-400 italic">
                              Portofolio Behance belum diisi
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Link 2: PDF Kumpulan Karya 1 Semester */}
                    {(() => {
                      const pdfDownloadUrl = getGoogleDriveDownloadUrl(links.pdfUrl);
                      return (
                        <div className="rounded-xl bg-white/10 border border-white/10 p-3 space-y-1.5 min-w-0">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                              <span className="text-xs font-bold uppercase tracking-wide text-amber-300">
                                2. Link Kumpulan Karya (PDF)
                              </span>
                              {links.pdfSubject && (
                                <span className="px-2 py-0.5 rounded bg-amber-400/20 text-xs font-semibold text-amber-200">
                                  {links.pdfSubject}
                                </span>
                              )}
                            </div>
                            {links.pdfUrl && (
                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => void handleCopy('pdf', links.pdfUrl)}
                                  className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold"
                                >
                                  {copiedKey === 'pdf' ? (
                                    <Check className="w-3.5 h-3.5 text-[#1DF27A]" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                  <span>{copiedKey === 'pdf' ? 'Disalin' : 'Salin'}</span>
                                </button>
                                <a
                                  href={links.pdfUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-300 hover:bg-amber-200 text-slate-950 text-xs font-bold transition-colors"
                                >
                                  <span>Buka</span>
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                                {pdfDownloadUrl && (
                                  <a
                                    href={pdfDownloadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-amber-50 text-slate-950 text-xs font-bold transition-colors"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Unduh</span>
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                          {links.pdfUrl ? (
                            <a
                              href={links.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-xs font-mono text-amber-100 break-all hover:underline"
                            >
                              {links.pdfUrl}
                            </a>
                          ) : (
                            <div className="text-xs text-slate-400 italic">
                              Link PDF Kumpulan Karya belum diisi
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {canEdit && (
                <div className="pt-1 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => handleNewProject('sidang')}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#1DF27A] hover:bg-emerald-400 text-sm font-bold text-slate-950 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Upload Hasil Sidang Karya</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Narasi Otomatis Bahasa Orang Tua (Dapat Diedit Admin/Guru) */}
        <div className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-5 space-y-3 shadow-xs min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-800">
                <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Ringkasan Perkembangan Karya &amp; Kompetensi (Tampil di Rapor Hal. 5 &amp; Portal Wali)
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Periode {targetSemester} {targetYear} · Dirangkum otomatis dengan bahasa hangat untuk wali santri
                {savedNarrative ? ' (sudah disesuaikan manual).' : ' (otomatis dari capaian santri).'}
              </p>
            </div>

            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSummaryDraft(autoGeneratedNarrative);
                    setSummaryDirty(autoGeneratedNarrative !== savedNarrative);
                  }}
                  className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-xs sm:text-sm font-semibold text-emerald-800 transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Buat Ulang Otomatis</span>
                </button>
                {onSavePortfolioSummary && (
                  <button
                    type="button"
                    onClick={() => {
                      onSavePortfolioSummary(
                        student.id,
                        targetYear,
                        targetSemester,
                        summaryDraft.trim()
                      );
                      setSummaryDirty(false);
                    }}
                    className={`min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-colors ${
                      summaryDirty
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                        : 'bg-[#0E2228] hover:bg-slate-800 text-white'
                    }`}
                  >
                    <Save className="w-4 h-4" />
                    <span>Simpan Ringkasan</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {canEdit ? (
            <textarea
              rows={4}
              value={summaryDraft}
              onChange={(e) => {
                setSummaryDraft(e.target.value);
                setSummaryDirty(true);
              }}
              placeholder="Ringkasan capaian karya & kompetensi santri untuk orang tua..."
              className="w-full px-3.5 py-3 text-base sm:text-sm leading-relaxed text-slate-800 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
            />
          ) : (
            <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100 text-sm leading-relaxed text-slate-700 whitespace-pre-line">
              {savedNarrative || autoGeneratedNarrative}
            </div>
          )}
        </div>

        {/* Filter by Materi / Jenis Karya + Search Bar */}
        {groupedProjects.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {jenisOptions.map((jenis) => {
                const active = typeFilter === jenis;
                return (
                  <button
                    key={jenis}
                    type="button"
                    onClick={() => setTypeFilter(jenis)}
                    className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
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
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari judul karya atau pelajaran..."
                className="min-h-[44px] h-11 pl-10 pr-3.5 py-2 text-base sm:text-sm border border-slate-200 rounded-xl w-full md:w-64"
              />
            </div>
          </div>
        )}

        {/* Simplified Add / Edit Sidang Karya Form */}
        {canEdit && editingProject && (
          <form
            onSubmit={(e) => void handleSubmitProject(e)}
            className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-6 space-y-4 min-w-0 shadow-xs"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-display font-bold text-slate-900 text-lg break-words">
                  {editingSourceIds.length > 0
                    ? 'Edit Hasil Sidang Karya'
                    : 'Upload Hasil Sidang Karya'}
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Mendukung upload foto/PNG ukuran besar (3–25 MB) untuk 3 slot berjajar — otomatis dikompresi WebP tajam &amp; aman di Google Sheets.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingProject(null);
                  setEditingSourceIds([]);
                }}
                className="min-h-[40px] text-sm font-semibold text-slate-500 hover:text-slate-800 shrink-0 px-3 py-1.5 rounded-lg hover:bg-slate-100"
              >
                Tutup
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <span className="text-xs font-semibold text-slate-600 mr-1">
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
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
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
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
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
                  className="w-full min-h-[44px] h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
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
                  className="w-full min-h-[44px] h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
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
                  className="w-full min-h-[44px] h-11 px-3.5 py-2.5 text-base sm:text-sm border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            {uploadError && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800">
                {uploadError}
              </div>
            )}

            {/* 3 High-Clarity WebP Image Upload Slots (720px, <=30k chars/slot, safe Sheets row split) */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="text-sm font-semibold text-slate-800">
                  Upload 3 Slot Foto Hasil Sidang Karya (Tampil 3 Kolom Berjajar di Hal. 5 Rapor &amp; PDF)
                </div>
                <span className="text-xs text-slate-500">
                  Kompresi tajam WebP (maks 720px, ≤ 30 rb kar/slot · Anti-Limit 50 rb Sheets)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[0, 1, 2].map((idx) => {
                  const m = editingProject.mediaItems[idx] || {
                    url: '',
                    type: 'image' as const,
                    caption: `Foto Karya ${idx + 1}`,
                    presetArt: idx === 0 ? ('poster' as const) : idx === 1 ? ('uiux' as const) : ('video' as const),
                  };
                  const meta = slotUploadMeta[idx];
                  const previewUrl = normalizeDisplayImageUrl(m.url);
                  const hasImage = Boolean(previewUrl);
                  return (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5 min-w-0 flex flex-col justify-between"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-800">
                            {idx === 0
                              ? 'Foto Karya 1 / Utama'
                              : idx === 1
                                ? 'Foto Karya 2'
                                : 'Foto Karya 3'}
                          </span>
                          {meta ? (
                            <span className="text-xs font-mono text-emerald-700 font-semibold">
                              {meta.width}px · {(meta.byteLength / 1024).toFixed(1)} KB
                            </span>
                          ) : m.url.startsWith('data:') ? (
                            <span className="text-xs font-mono text-slate-500">
                              {(m.url.length / 1000).toFixed(1)}k kar
                            </span>
                          ) : null}
                        </div>

                        <div className="relative h-44 rounded-lg border border-slate-200 bg-white flex items-center justify-center overflow-hidden p-2">
                          {uploadingSlot === idx ? (
                            <div className="text-center text-emerald-700 space-y-2">
                              <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                              <div className="text-xs font-semibold">Mengoptimalkan gambar...</div>
                            </div>
                          ) : hasImage ? (
                            <img
                              src={previewUrl}
                              alt={m.caption || editingProject.judul || `Foto Karya ${idx + 1}`}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="text-center text-slate-400 space-y-1">
                              <ImageIcon className="w-7 h-7 mx-auto opacity-60" />
                              <div className="text-xs">Belum ada foto</div>
                            </div>
                          )}
                        </div>

                        <input
                          type="text"
                          value={m.caption}
                          onChange={(e) => {
                            const next = [...editingProject.mediaItems];
                            while (next.length < 3) {
                              const k = next.length;
                              next.push({
                                url: '',
                                type: 'image',
                                caption: `Foto Karya ${k + 1}`,
                                presetArt: k === 0 ? 'poster' : k === 1 ? 'uiux' : 'video',
                              });
                            }
                            next[idx] = { ...next[idx], caption: e.target.value };
                            setEditingProject({ ...editingProject, mediaItems: next });
                          }}
                          placeholder={`Caption singkat Foto Karya ${idx + 1}`}
                          className="w-full min-h-[42px] px-3 py-2 text-base sm:text-xs bg-white border border-slate-200 rounded-lg"
                        />

                        <div>
                          <input
                            type="text"
                            value={m.url}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const converted = /drive\.google\.com/i.test(raw)
                                ? normalizeDisplayImageUrl(raw)
                                : raw;
                              const next = [...editingProject.mediaItems];
                              while (next.length < 3) {
                                const k = next.length;
                                next.push({
                                  url: '',
                                  type: 'image',
                                  caption: `Foto Karya ${k + 1}`,
                                  presetArt: k === 0 ? 'poster' : k === 1 ? 'uiux' : 'video',
                                });
                              }
                              next[idx] = { ...next[idx], url: converted };
                              setEditingProject({ ...editingProject, mediaItems: next });
                            }}
                            placeholder="Atau tempel URL / Google Drive"
                            className="w-full min-h-[42px] px-3 py-2 text-base sm:text-xs bg-white border border-slate-200 rounded-lg"
                          />
                          {m.url && /googleusercontent\.com/i.test(m.url) && (
                            <p className="text-xs text-emerald-700 mt-1">
                              Link Google Drive otomatis dikonversi untuk PDF.
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                        <label className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0E2228] hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold cursor-pointer transition-colors">
                          {uploadingSlot === idx ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin text-[#1DF27A]" />
                              <span>Mengoptimalkan...</span>
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 text-[#1DF27A]" />
                              <span>Upload Foto</span>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            disabled={uploadingSlot !== null}
                            onChange={(e) => void handleMediaUpload(idx, e)}
                            className="hidden"
                          />
                        </label>

                        {hasImage && (
                          <button
                            type="button"
                            onClick={() => handleClearMediaSlot(idx)}
                            className="min-h-[42px] inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 text-xs sm:text-sm font-semibold"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Hapus</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setEditingProject(null);
                  setEditingSourceIds([]);
                }}
                className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-medium"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={uploadingSlot !== null}
                className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold hover:bg-emerald-700"
              >
                Simpan Hasil Sidang Karya
              </button>
            </div>
          </form>
        )}

        {/* Portfolio Projects List */}
        {filteredProjects.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-10 text-center space-y-3">
            <div className="text-base font-semibold text-slate-800">
              {groupedProjects.length === 0
                ? `Belum ada dokumentasi Sidang Karya untuk ${student.nama}`
                : 'Tidak ada karya yang cocok dengan filter jenis/pencarian.'}
            </div>
            <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
              Upload hingga 3 foto hasil Sidang Karya santri (bebas ukuran, otomatis dioptimalkan ke WebP tajam) agar tampil 3 kolom berjajar di Halaman 5 Rapor &amp; PDF.
            </p>
            {canEdit && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => handleNewProject('sidang')}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
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
                .slice(0, 3);
              const displayMedia =
                activeMedia.length > 0 ? activeMedia : proj.mediaItems.slice(0, 1);

              return (
                <div
                  key={proj.id}
                  className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-4">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="text-xs font-display font-extrabold text-slate-950 px-3 py-0.5 rounded-full"
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
                        <p className="text-sm text-slate-500 break-words">
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
                              item: {
                                ...displayMedia[0],
                                url: normalizeDisplayImageUrl(displayMedia[0].url),
                              },
                              projectTitle: proj.judul,
                              jenis: proj.jenis,
                            })
                          }
                          className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-semibold hover:bg-emerald-700 whitespace-nowrap"
                        >
                          <Eye className="w-4 h-4" />
                          <span>Lihat Penuh</span>
                        </button>
                      )}
                      {proj.externalLink && (
                        <a
                          href={proj.externalLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0E2228] text-white text-xs sm:text-sm font-semibold hover:bg-slate-800 whitespace-nowrap"
                        >
                          <span>Buka Link</span>
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditProject(proj)}
                            className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const idsToDelete = new Set(proj.sourceIds || [proj.id]);
                              onSavePortfolios(
                                db.portfolios.filter((x) => !idsToDelete.has(x.id))
                              );
                            }}
                            className="min-h-[40px] min-w-[40px] p-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center"
                            title="Hapus karya"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Clean 1-3 Image Side-by-Side Sharp Showcase */}
                  <div
                    className={
                      displayMedia.length >= 3
                        ? 'grid grid-cols-1 sm:grid-cols-3 gap-3.5 min-w-0'
                        : displayMedia.length === 2
                          ? 'grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0'
                          : 'min-w-0'
                    }
                  >
                    {displayMedia.map((mediaItem, mIdx) => (
                      <div key={mIdx} className="min-w-0">
                        {renderSharpMediaFrame(
                          mediaItem,
                          proj.judul,
                          proj.jenis,
                          displayMedia.length >= 3
                            ? 'h-56 sm:h-64'
                            : displayMedia.length === 2
                              ? 'h-56 sm:h-64'
                              : 'h-64 sm:h-80'
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
                <div className="text-xs font-bold text-emerald-700 uppercase">
                  {lightboxMedia.jenis}
                </div>
                <div className="font-display font-bold text-base text-slate-900 break-words">
                  {lightboxMedia.projectTitle}
                </div>
                {lightboxMedia.item.caption && (
                  <div className="text-sm text-slate-500 break-words">
                    {lightboxMedia.item.caption}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLightboxMedia(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
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
