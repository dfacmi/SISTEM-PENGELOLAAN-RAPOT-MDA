import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type { CbtOptionKey, CbtQuestion, StudentCbtQuestion } from '../types/mda';

const ARABIC_UNICODE_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

export function hasArabicText(text: string | undefined | null): boolean {
  if (!text) return false;
  return ARABIC_UNICODE_RE.test(text);
}

export interface DisplayedCbtOption {
  displayLetter: CbtOptionKey;
  canonicalKey: CbtOptionKey;
  text: string;
}

function deterministicHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function getDisplayOptionsForQuestion(
  question: Pick<CbtQuestion | StudentCbtQuestion, 'id' | 'opsiA' | 'opsiB' | 'opsiC' | 'opsiD' | 'opsiE'>,
  attemptSeed: string,
  shuffleOptions: boolean
): DisplayedCbtOption[] {
  const base: Array<{ canonicalKey: CbtOptionKey; text: string }> = [
    { canonicalKey: 'A', text: question.opsiA || '' },
    { canonicalKey: 'B', text: question.opsiB || '' },
    { canonicalKey: 'C', text: question.opsiC || '' },
    { canonicalKey: 'D', text: question.opsiD || '' },
  ];
  if (question.opsiE && question.opsiE.trim() !== '') {
    base.push({ canonicalKey: 'E', text: question.opsiE });
  }

  let ordered = [...base];
  if (shuffleOptions) {
    let state = deterministicHash(`${attemptSeed}::${question.id}`) || 1;
    for (let i = ordered.length - 1; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }

  const letters: CbtOptionKey[] = ['A', 'B', 'C', 'D', 'E'];
  return ordered.map((item, idx) => ({
    displayLetter: letters[idx],
    canonicalKey: item.canonicalKey,
    text: item.text,
  }));
}

export interface ParsedQuestionDraft extends CbtQuestion {
  warnings: string[];
  keyExplicit: boolean;
}

function normalizeAnswerKey(raw: string | undefined | null): CbtOptionKey | null {
  const cleaned = (raw || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-E]/g, '');
  if (cleaned === 'A' || cleaned === 'B' || cleaned === 'C' || cleaned === 'D' || cleaned === 'E') {
    return cleaned;
  }
  return null;
}

export function validateQuestionDraft(q: ParsedQuestionDraft): string[] {
  const warnings: string[] = [];
  if (!q.pertanyaan.trim()) warnings.push('Teks pertanyaan kosong');
  if (!q.opsiA.trim()) warnings.push('Opsi A kosong');
  if (!q.opsiB.trim()) warnings.push('Opsi B kosong');
  if (!q.opsiC.trim()) warnings.push('Opsi C kosong');
  if (!q.opsiD.trim()) warnings.push('Opsi D kosong');
  if (!q.keyExplicit) warnings.push('Kunci jawaban belum terdeteksi (default A)');
  return warnings;
}

function makeQuestionId(examId: string, idx: number): string {
  return `q-${examId}-${Date.now().toString(36)}-${idx + 1}`;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsvTextToMatrix(csvText: string): string[][] {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const sample = lines.slice(0, 5).join('\n');
  const candidates = [';', '\t', ','];
  let bestDelim = ',';
  let bestCount = -1;
  for (const delim of candidates) {
    const count = sample.split(delim).length;
    if (count > bestCount) {
      bestCount = count;
      bestDelim = delim;
    }
  }
  return lines.map((l) => splitCsvLine(l, bestDelim));
}

export async function parseSpreadsheetQuestions(
  file: File,
  examId: string
): Promise<ParsedQuestionDraft[]> {
  const lowerName = file.name.toLowerCase();
  let matrix: any[][] = [];

  if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv')) {
    const text = await file.text();
    matrix = parseCsvTextToMatrix(text);
  } else {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) return [];
    const ws = wb.Sheets[firstSheet];
    matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
  }

  if (matrix.length === 0) return [];

  // Detect header row cleanly
  const firstRow = matrix[0].map((c) => String(c || '').trim().toLowerCase());
  const hasHeader = firstRow.some(
    (h) =>
      h.includes('pertanyaan') ||
      h.includes('soal') ||
      h.includes('question') ||
      h.includes('opsi a') ||
      h.includes('kunci')
  );

  const findCol = (keywords: string[], fallbackIndex: number): number => {
    if (!hasHeader) return fallbackIndex;
    const exact = firstRow.findIndex((h) => keywords.some((k) => h === k));
    if (exact >= 0) return exact;
    const partial = firstRow.findIndex((h) => keywords.some((k) => h.includes(k)));
    return partial >= 0 ? partial : fallbackIndex;
  };

  const colQuestion = findCol(['pertanyaan', 'soal', 'question'], 0);
  const colA = findCol(['opsi a', 'pilihan a', 'jawaban a', 'a'], 1);
  const colB = findCol(['opsi b', 'pilihan b', 'jawaban b', 'b'], 2);
  const colC = findCol(['opsi c', 'pilihan c', 'jawaban c', 'c'], 3);
  const colD = findCol(['opsi d', 'pilihan d', 'jawaban d', 'd'], 4);
  const colE = findCol(['opsi e', 'pilihan e', 'jawaban e', 'e'], 5);
  const colKey = findCol(['kunci jawaban', 'kunci', 'jawaban benar', 'answer', 'key'], 6);
  const colImg = findCol(['url gambar', 'gambar', 'image', 'img'], 7);

  const startIdx = hasHeader ? 1 : 0;
  const out: ParsedQuestionDraft[] = [];

  for (let i = startIdx; i < matrix.length; i++) {
    const row = matrix[i] || [];
    const pertanyaan = String(row[colQuestion] ?? '').trim();
    const opsiA = String(row[colA] ?? '').trim();
    const opsiB = String(row[colB] ?? '').trim();
    const opsiC = String(row[colC] ?? '').trim();
    const opsiD = String(row[colD] ?? '').trim();
    const rawE = colE < row.length ? String(row[colE] ?? '').trim() : '';
    const opsiE =
      rawE && !/^[A-E]$/i.test(rawE) ? rawE : '';
    const rawKey =
      colKey < row.length
        ? String(row[colKey] ?? '').trim()
        : colE < row.length && /^[A-E]$/i.test(rawE)
          ? rawE
          : '';
    const parsedKey = normalizeAnswerKey(rawKey);
    const imageUrl = colImg < row.length ? String(row[colImg] ?? '').trim() : '';

    if (!pertanyaan && !opsiA && !opsiB && !opsiC && !opsiD) continue;

    const draft: ParsedQuestionDraft = {
      id: makeQuestionId(examId, out.length),
      examId,
      orderNumber: out.length + 1,
      pertanyaan,
      opsiA,
      opsiB,
      opsiC,
      opsiD,
      ...(opsiE ? { opsiE } : {}),
      kunciJawaban: parsedKey || 'A',
      ...(imageUrl ? { imageUrl } : {}),
      keyExplicit: Boolean(parsedKey),
      warnings: [],
    };
    draft.warnings = validateQuestionDraft(draft);
    out.push(draft);
  }

  return out;
}

export function parseQuestionsFromRawText(
  rawText: string,
  examId: string
): ParsedQuestionDraft[] {
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Split inline options like "A. foo B. bar" onto new lines when safe
    .replace(/\s+([B-E][.)]\s+)/g, '\n$1')
    .trim();

  if (!normalized) return [];

  const lines = normalized.split('\n');
  interface TempBlock {
    pertanyaanLines: string[];
    options: Partial<Record<CbtOptionKey, string>>;
    currentOpt: CbtOptionKey | null;
    kunci: CbtOptionKey | null;
    imageUrl?: string;
  }

  const blocks: TempBlock[] = [];
  let current: TempBlock | null = null;

  const qStartRe = /^\s*(?:soal\s*(?:no\.?)?\s*)?(\d{1,3})\s*[.)\-:]\s*(.*)$/i;
  const optRe = /^\s*(\*?)\s*([A-E])\s*[.)]\s*(.*)$/i;
  const keyRe = /^\s*(?:kunci(?:\s*jawaban)?|jawaban(?:\s*benar)?|answer|key)\s*[:=\-]\s*([A-E])\b/i;
  const imgRe = /^\s*(?:gambar|image|img|url\s*gambar)\s*[:=]\s*(https?:\/\/\S+)/i;

  const pushCurrent = () => {
    if (!current) return;
    const text = current.pertanyaanLines.join('\n').trim();
    if (text || Object.keys(current.options).length > 0) {
      blocks.push(current);
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const kMatch = line.match(keyRe);
    if (kMatch && current) {
      current.kunci = kMatch[1].toUpperCase() as CbtOptionKey;
      current.currentOpt = null;
      continue;
    }

    const iMatch = line.match(imgRe);
    if (iMatch && current) {
      current.imageUrl = iMatch[1].trim();
      continue;
    }

    const optMatch = line.match(optRe);
    if (optMatch && current) {
      const hasStarPrefix = optMatch[1] === '*';
      const letter = optMatch[2].toUpperCase() as CbtOptionKey;
      let optBody = optMatch[3].trim();
      let hasStarSuffix = false;
      if (/\*\s*$/.test(optBody)) {
        hasStarSuffix = true;
        optBody = optBody.replace(/\s*\*\s*$/, '').trim();
      }
      if (/^\(benar\)|\[benar\]/i.test(optBody) || /\((?:benar|kunci)\)$/i.test(optBody)) {
        hasStarSuffix = true;
        optBody = optBody.replace(/\((?:benar|kunci)\)|\[(?:benar|kunci)\]/gi, '').trim();
      }
      if (hasStarPrefix || hasStarSuffix) {
        current.kunci = letter;
      }
      current.options[letter] = optBody;
      current.currentOpt = letter;
      continue;
    }

    const qMatch = line.match(qStartRe);
    // Treat numbered line as a new question if no current block OR current block already has at least 2 options (or a question without options yet if previous had options)
    if (
      qMatch &&
      (!current ||
        Object.keys(current.options).length >= 2 ||
        current.kunci !== null)
    ) {
      pushCurrent();
      current = {
        pertanyaanLines: [qMatch[2].trim()],
        options: {},
        currentOpt: null,
        kunci: null,
      };
      continue;
    }

    if (!current) {
      current = {
        pertanyaanLines: [line],
        options: {},
        currentOpt: null,
        kunci: null,
      };
    } else if (current.currentOpt) {
      current.options[current.currentOpt] = `${current.options[current.currentOpt] || ''} ${line}`.trim();
    } else {
      current.pertanyaanLines.push(line);
    }
  }
  pushCurrent();

  return blocks.map((b, idx) => {
    const draft: ParsedQuestionDraft = {
      id: makeQuestionId(examId, idx),
      examId,
      orderNumber: idx + 1,
      pertanyaan: b.pertanyaanLines.join('\n').trim(),
      opsiA: b.options.A || '',
      opsiB: b.options.B || '',
      opsiC: b.options.C || '',
      opsiD: b.options.D || '',
      ...(b.options.E ? { opsiE: b.options.E } : {}),
      kunciJawaban: b.kunci || 'A',
      ...(b.imageUrl ? { imageUrl: b.imageUrl } : {}),
      keyExplicit: Boolean(b.kunci),
      warnings: [],
    };
    draft.warnings = validateQuestionDraft(draft);
    return draft;
  });
}

export async function parseWordOrTextFileQuestions(
  file: File,
  examId: string
): Promise<ParsedQuestionDraft[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.docx')) {
    const buffer = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer: buffer });
    return parseQuestionsFromRawText(res.value || '', examId);
  }
  const text = await file.text();
  return parseQuestionsFromRawText(text, examId);
}

export function applyBulkAnswerKey(
  questions: ParsedQuestionDraft[],
  rawKeys: string
): ParsedQuestionDraft[] {
  const trimmed = (rawKeys || '').trim();
  if (!trimmed || questions.length === 0) return questions;

  const numberedMatches = Array.from(
    trimmed.matchAll(/(\d{1,3})\s*[.):\-=]?\s*([A-Ea-e])\b/g)
  );
  const byNumber = new Map<number, CbtOptionKey>();

  if (numberedMatches.length >= 2) {
    for (const m of numberedMatches) {
      const num = Number(m[1]);
      const key = m[2].toUpperCase() as CbtOptionKey;
      if (num >= 1) byNumber.set(num, key);
    }
  } else {
    const letters = trimmed.toUpperCase().replace(/[^A-E]/g, '').split('');
    letters.forEach((ch, idx) => {
      byNumber.set(idx + 1, ch as CbtOptionKey);
    });
  }

  return questions.map((q, idx) => {
    const matched = byNumber.get(idx + 1);
    if (!matched) return q;
    const updated: ParsedQuestionDraft = {
      ...q,
      kunciJawaban: matched,
      keyExplicit: true,
      warnings: [],
    };
    updated.warnings = validateQuestionDraft(updated);
    return updated;
  });
}

export function downloadQuestionTemplateXlsx(examTitle = 'Soal_CBT_MDA') {
  const rows = [
    [
      'Pertanyaan',
      'Opsi A',
      'Opsi B',
      'Opsi C',
      'Opsi D',
      'Opsi E (opsional)',
      'Kunci Jawaban (A/B/C/D/E)',
      'URL Gambar (opsional)',
    ],
    [
      'Apa rukun iman yang pertama dalam ajaran Islam?',
      'Beriman kepada Allah SWT',
      'Beriman kepada Malaikat',
      'Beriman kepada Kitab-kitab Allah',
      'Beriman kepada Hari Akhir',
      '',
      'A',
      '',
    ],
    [
      'مَا مَعْنَى كَلِمَةِ "الإِحْسَانُ" فِي الحَدِيثِ الشَّرِيفِ؟',
      'أَنْ تَعْبُدَ اللَّهَ كَأَنَّكَ تَرَاهُ',
      'إِقَامُ الصَّلَاةِ وَإِيتَاءُ الزَّكَاةِ',
      'صَوْمُ رَمَضَانَ كَامِلًا',
      'حَجُّ البَيْتِ لِمَنِ اسْتَطَاعَ',
      '',
      'A',
      '',
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template_Soal');
  const safeName = examTitle.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
  XLSX.writeFile(wb, `Template_${safeName}.xlsx`);
}
