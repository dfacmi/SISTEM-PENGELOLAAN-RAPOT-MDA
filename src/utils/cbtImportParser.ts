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

function cleanUnicodeText(text: string): string {
  return (text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function collapseInlineSpaces(text: string): string {
  return cleanUnicodeText(text)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

const Q_START_RE = /^\s*(?:soal\s*(?:no\.?)?\s*)?(\d{1,3})\s*[.)\-:](?!\d)\s*(.*)$/i;
const OPT_RE = /^\s*(\*?)\s*([A-E])\s*[.)](?:\s+(.*)|$)/i;
const KEY_LINE_RE = /^\s*(?:kunci(?:\s*jawaban)?|jawaban(?:\s*benar)?|answer|key)\s*[:=\-]\s*([A-E])\b/i;
const IMG_LINE_RE = /^\s*(?:gambar|image|img|url\s*gambar)\s*[:=]\s*(https?:\/\/\S+)/i;

const KUNCI_SECTION_RE = /(?:^|\n|\t)\s*(?:[-_=*#\s]*)?KUNCI\s+JAWABAN\b(?=[\s\S]*?(?:\b\d{1,3}\s*[.:\-)]?\s*[A-Ea-e]\b|Pedoman\s+penilaian|$))/i;
const KUNCI_INLINE_RE = /\bKUNCI\s+JAWABAN\b(?=[\s\S]*\b\d{1,3}\s*[.:\-)]?\s*[A-Ea-e]\b)/i;

const LETTERHEAD_LINE_RE =
  /^(?:telp(?:hone|on)?|telepon|whatsapp|wa|hp|email|ig|instagram|alamat|jl\.|jalan|sukoharjo|jawa\s+tengah|muslim\s+digital\s+academy|pondok\s+pesantren|darul\s+fithrah|@[a-z0-9_.-]+|petunjuk\s+pengerjaan\b|pilih\s+satu\s+jawaban\s+yang\s+paling\s+tepat\b|bacalah\s+setiap\s+soal\b|tanda\s+silang\s*\(x\)|[-_=*]{4,})/i;

export function extractAnswerKeysFromSection(kunciRaw: string): Map<number, CbtOptionKey> {
  const byNumber = new Map<number, CbtOptionKey>();
  if (!kunciRaw || !kunciRaw.trim()) return byNumber;

  // Potong bagian Pedoman penilaian agar angka skor/jumlah soal tidak terbaca sebagai kunci
  const beforePedoman = cleanUnicodeText(kunciRaw)
    .replace(/\bpedoman\s+penilaian\b[\s\S]*/i, '')
    .replace(/\bkunci\s+jawaban\b/gi, ' ');

  const pairs = Array.from(
    beforePedoman.matchAll(/\b(\d{1,3})\s*[.:\-)]?\s*([A-Ea-e])\b/g)
  );
  for (const m of pairs) {
    const num = Number(m[1]);
    const key = m[2].toUpperCase() as CbtOptionKey;
    if (num >= 1 && num <= 500) {
      byNumber.set(num, key);
    }
  }
  return byNumber;
}

function splitQuestionBodyAndKunci(rawText: string): {
  body: string;
  kunciSection: string;
  keyMap: Map<number, CbtOptionKey>;
} {
  const cleaned = cleanUnicodeText(rawText);
  const lineMatch = cleaned.match(KUNCI_SECTION_RE);
  const inlineMatch = !lineMatch ? cleaned.match(KUNCI_INLINE_RE) : null;
  const match = lineMatch || inlineMatch;

  if (!match || match.index === undefined) {
    return { body: cleaned, kunciSection: '', keyMap: new Map() };
  }

  const splitIdx = match.index;
  const body = cleaned.slice(0, splitIdx).trim();
  const kunciSection = cleaned.slice(splitIdx).trim();
  const keyMap = extractAnswerKeysFromSection(kunciSection);
  return { body, kunciSection, keyMap };
}

function stripLeadingLetterheadAndInstructions(rawBody: string): string {
  const lines = cleanUnicodeText(rawBody).split('\n');
  let startIdx = 0;
  let inPetunjuk = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      startIdx = i + 1;
      continue;
    }

    // Jika sudah sampai nomor soal 1 (e.g. "1. ..." atau "Soal 1:"), berhenti membuang header
    if (Q_START_RE.test(trimmed)) {
      startIdx = i;
      break;
    }

    // Jika ada opsi A. berarti soal sudah mulai sebelumnya
    if (OPT_RE.test(trimmed)) {
      break;
    }

    if (/^petunjuk\s+pengerjaan\s*:?/i.test(trimmed)) {
      inPetunjuk = true;
      startIdx = i + 1;
      continue;
    }

    if (inPetunjuk) {
      if (
        /^(?:bacalah|pilih\s+satu|tepat\s+dengan|dengan\s+memberi|tanda\s+silang|pada\s+pilihan|a,\s*b,\s*c)/i.test(
          trimmed
        ) ||
        trimmed.length <= 160
      ) {
        startIdx = i + 1;
        // Akhiri mode petunjuk setelah baris menyebut pilihan A, B, C, D
        if (/pilihan\s+a\b|\batau\s+[de]\.?$/i.test(trimmed)) {
          inPetunjuk = false;
        }
        continue;
      }
      inPetunjuk = false;
    }

    if (
      LETTERHEAD_LINE_RE.test(trimmed) ||
      /^\+?\d[\d\s-]{7,}$/.test(trimmed) ||
      /^indonesia$/i.test(trimmed)
    ) {
      startIdx = i + 1;
      continue;
    }

    // Jika masih awal dokumen dan belum masuk nomor 1, cek apakah ada nomor soal 1 dalam 20 baris ke depan
    const hasQ1Ahead = lines
      .slice(i + 1, i + 20)
      .some((l) => /^\s*(?:soal\s*(?:no\.?)?\s*)?1\s*[.)\-:](?!\d)\s*\S/i.test(l.trim()));
    if (hasQ1Ahead && i < 18) {
      startIdx = i + 1;
      continue;
    }

    break;
  }

  return lines.slice(startIdx).join('\n').trim();
}

function cleanOptionBodyAndMarkers(rawBody: string): {
  text: string;
  isMarkedCorrect: boolean;
} {
  let body = (rawBody || '').trim();
  let isMarkedCorrect = false;
  if (/^\*\s+/.test(body)) {
    isMarkedCorrect = true;
    body = body.replace(/^\*\s+/, '').trim();
  }
  if (/\*\s*$/.test(body)) {
    isMarkedCorrect = true;
    body = body.replace(/\s*\*\s*$/, '').trim();
  }
  if (/^\(benar\)|\[benar\]/i.test(body) || /\((?:benar|kunci)\)$/i.test(body)) {
    isMarkedCorrect = true;
    body = body.replace(/\((?:benar|kunci)\)|\[(?:benar|kunci)\]/gi, '').trim();
  }
  return { text: body, isMarkedCorrect };
}

function splitInlineOptionsInLine(line: string, hasOptionAAlready: boolean): string[] {
  const startsWithA = /^\s*\*?\s*A\s*[.)]\s+/i.test(line);
  const hasMultipleOptionMarkers =
    /\s+B\s*[.)]\s+/i.test(line) && /\s+C\s*[.)]\s+/i.test(line);

  if (startsWithA || hasMultipleOptionMarkers || (hasOptionAAlready && /\s+[B-E]\s*[.)]\s+/i.test(line))) {
    return line
      .replace(/\s+(\*?\s*[B-E]\s*[.)]\s+)/g, '\n$1')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [line];
}

function parseRawBlocks(
  rawBody: string,
  examId: string,
  externalKeyMap: Map<number, CbtOptionKey>
): ParsedQuestionDraft[] {
  const cleanedBody = stripLeadingLetterheadAndInstructions(rawBody);
  if (!cleanedBody) return [];

  const lines = cleanedBody.split('\n');
  interface TempBlock {
    questionNumber: number | null;
    pertanyaanLines: string[];
    options: Partial<Record<CbtOptionKey, string>>;
    currentOpt: CbtOptionKey | null;
    kunci: CbtOptionKey | null;
    imageUrl?: string;
  }

  const blocks: TempBlock[] = [];
  let current: TempBlock | null = null;

  const pushCurrent = () => {
    if (!current) return;
    const text = current.pertanyaanLines.join('\n').trim();
    if (text || Object.keys(current.options).length > 0) {
      blocks.push(current);
    }
    current = null;
  };

  for (const rawLine of lines) {
    const baseLine = rawLine.trim();
    if (!baseLine) continue;

    const subLines = splitInlineOptionsInLine(
      baseLine,
      Boolean(current && current.options.A)
    );

    for (const line of subLines) {
      const kMatch = line.match(KEY_LINE_RE);
      if (kMatch && current) {
        current.kunci = kMatch[1].toUpperCase() as CbtOptionKey;
        current.currentOpt = null;
        continue;
      }

      const iMatch = line.match(IMG_LINE_RE);
      if (iMatch && current) {
        current.imageUrl = iMatch[1].trim();
        continue;
      }

      const optMatch = line.match(OPT_RE);
      if (optMatch && current) {
        const hasStarPrefix = optMatch[1] === '*';
        const letter = optMatch[2].toUpperCase() as CbtOptionKey;
        const { text: optBody, isMarkedCorrect } = cleanOptionBodyAndMarkers(
          optMatch[3] || ''
        );
        if (hasStarPrefix || isMarkedCorrect) {
          current.kunci = letter;
        }
        current.options[letter] = optBody;
        current.currentOpt = letter;
        continue;
      }

      const qMatch = line.match(Q_START_RE);
      if (
        qMatch &&
        (!current ||
          Object.keys(current.options).length >= 2 ||
          current.kunci !== null)
      ) {
        pushCurrent();
        current = {
          questionNumber: Number(qMatch[1]) || null,
          pertanyaanLines: qMatch[2].trim() ? [qMatch[2].trim()] : [],
          options: {},
          currentOpt: null,
          kunci: null,
        };
        continue;
      }

      if (!current) {
        current = {
          questionNumber: null,
          pertanyaanLines: [line],
          options: {},
          currentOpt: null,
          kunci: null,
        };
      } else if (current.currentOpt) {
        // Jika seluruh 4-5 opsi sudah ada dan muncul kalimat panjang tanpa awalan opsi, kemungkinan ini stem soal baru tanpa nomor
        current.options[current.currentOpt] =
          `${current.options[current.currentOpt] || ''} ${line}`.trim();
      } else {
        current.pertanyaanLines.push(line);
      }
    }
  }
  pushCurrent();

  return blocks.map((b, idx) => {
    const qNum = b.questionNumber ?? idx + 1;
    const mappedKey = b.kunci || externalKeyMap.get(qNum) || externalKeyMap.get(idx + 1) || null;
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
      kunciJawaban: mappedKey || 'A',
      ...(b.imageUrl ? { imageUrl: b.imageUrl } : {}),
      keyExplicit: Boolean(mappedKey),
      warnings: [],
    };
    draft.warnings = validateQuestionDraft(draft);
    return draft;
  });
}

export function parseQuestionsFromRawText(
  rawText: string,
  examId: string
): ParsedQuestionDraft[] {
  const { body, keyMap } = splitQuestionBodyAndKunci(rawText);
  if (!body) return [];
  return parseRawBlocks(body, examId, keyMap);
}

// ---------- DOCX HTML DOM PARSER (mammoth.convertToHtml + DOMParser) ----------

const OPTION_KEYS: CbtOptionKey[] = ['A', 'B', 'C', 'D', 'E'];

function extractElementPlainLines(node: Node, joinTableCellsWithSpace = true): string {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    return cleanUnicodeText(node.nodeValue || '');
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return '';
  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  if (tag === 'BR') return '\n';
  if (tag === 'IMG' || tag === 'HR' || tag === 'STYLE' || tag === 'SCRIPT') return '';

  if (tag === 'TABLE') {
    const rows = Array.from(el.querySelectorAll('tr'));
    if (rows.length === 0) {
      return collapseInlineSpaces(el.textContent || '');
    }
    return rows
      .map((tr) => {
        const cells = Array.from(tr.children).filter(
          (c) => c.tagName.toUpperCase() === 'TD' || c.tagName.toUpperCase() === 'TH'
        );
        const cellTexts = cells
          .map((cell) => collapseInlineSpaces(extractElementPlainLines(cell, true)))
          .filter(Boolean);
        return cellTexts.join(joinTableCellsWithSpace ? ' ' : '\t');
      })
      .filter(Boolean)
      .join('\n');
  }

  const isBlock =
    tag === 'P' ||
    tag === 'DIV' ||
    tag === 'LI' ||
    tag === 'BLOCKQUOTE' ||
    /^H[1-6]$/.test(tag);

  let out = '';
  el.childNodes.forEach((child) => {
    const chunk = extractElementPlainLines(child, joinTableCellsWithSpace);
    if (!chunk) return;
    if (
      out &&
      !out.endsWith('\n') &&
      !chunk.startsWith('\n') &&
      child.nodeType === 1 &&
      /^(P|DIV|LI|TABLE|H[1-6]|OL|UL|BLOCKQUOTE)$/i.test((child as Element).tagName)
    ) {
      out += '\n';
    }
    out += chunk;
  });

  if (isBlock && out && !out.endsWith('\n')) {
    out += '\n';
  }
  return out;
}

function isLikelyLetterheadElement(el: Element, plainText: string): boolean {
  const tag = el.tagName.toUpperCase();
  const normalized = collapseInlineSpaces(plainText).toLowerCase();

  if (tag === 'HR') return true;
  if (!normalized && el.querySelector('img')) return true;

  if (tag === 'TABLE') {
    if (
      /telp(?:hone|on)?|telepon|@muslimdigitalacademy|sukoharjo|jawa\s+tengah|muslim\s+digital\s+academy/.test(
        normalized
      )
    ) {
      return true;
    }
    // Tabel pendek berisi logo di paling atas
    if (el.querySelector('img') && normalized.length < 240 && !/\bA\s*[.)]\s+/.test(plainText)) {
      return true;
    }
  }

  if (
    /^petunjuk\s+pengerjaan\b/i.test(normalized) ||
    (/^bacalah\s+setiap\s+soal\b/i.test(normalized) && /tanda\s+silang\s*\(x\)/i.test(normalized))
  ) {
    return true;
  }

  return false;
}

function isLikelyKunciTable(plainText: string): boolean {
  const pairs = Array.from(
    cleanUnicodeText(plainText).matchAll(/\b(\d{1,3})\s*[.:\-)]?\s*([A-Ea-e])\b/g)
  );
  // Tabel kunci biasanya punya banyak pasangan nomor-huruf singkat dan bukan kalimat soal panjang
  return pairs.length >= 6 && plainText.length < pairs.length * 25;
}

function stripLeadingOptionPrefixFromOlItem(text: string): string {
  // Jika item <ol> secara manual diawali "A. ..." atau "a) ...", rapikan agar tidak dobel "A. A. ..."
  return text.replace(/^\s*([A-Ea-e])\s*[.)]\s+(?=\S)/, '').trim();
}

function stripLeadingQuestionPrefix(text: string): {
  explicitNum: number | null;
  cleanText: string;
} {
  const trimmed = text.trim();
  const m = trimmed.match(Q_START_RE);
  if (m) {
    return {
      explicitNum: Number(m[1]) || null,
      cleanText: m[2].trim(),
    };
  }
  return { explicitNum: null, cleanText: trimmed };
}

function extractLiStemWithoutOptionLists(
  li: Element,
  optionOlSet: Set<Element>
): string {
  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const t = cleanUnicodeText(node.nodeValue || '');
      if (t.trim()) parts.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const childEl = node as Element;
    if (optionOlSet.has(childEl)) return;

    const tag = childEl.tagName.toUpperCase();
    if (tag === 'BR') {
      parts.push('\n');
      return;
    }
    if (tag === 'IMG' || tag === 'STYLE' || tag === 'SCRIPT') return;

    if (tag === 'OL' || tag === 'UL') {
      // Nested list selain opsi (misalnya daftar pernyataan (1), (2), (3) sebelum opsi)
      const subLis = Array.from(childEl.children).filter(
        (c) => c.tagName.toUpperCase() === 'LI'
      );
      subLis.forEach((subLi, i) => {
        const subText = collapseInlineSpaces(extractElementPlainLines(subLi, true));
        if (!subText) return;
        const alreadyNumbered = /^\s*\(?\d+\)?[.)]?\s+/.test(subText);
        parts.push(alreadyNumbered ? `\n${subText}` : `\n(${i + 1}) ${subText}`);
      });
      parts.push('\n');
      return;
    }

    if (tag === 'P' || tag === 'DIV' || /^H[1-6]$/.test(tag) || tag === 'BLOCKQUOTE') {
      const inner = collapseInlineSpaces(extractElementPlainLines(childEl, true));
      if (inner) {
        parts.push(`\n${inner}\n`);
      }
      return;
    }

    childEl.childNodes.forEach(walk);
  };

  li.childNodes.forEach(walk);
  return collapseInlineSpaces(parts.join(''));
}

export function parseDocxHtmlQuestions(
  html: string,
  examId: string,
  customParser?: DOMParser
): ParsedQuestionDraft[] {
  const parser =
    customParser || (typeof DOMParser !== 'undefined' ? new DOMParser() : null);

  if (!parser) {
    // Fallback bersih jika DOMParser tidak tersedia di runtime non-browser
    const roughText = html
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(td|th)>/gi, ' ')
      .replace(/<[^>]+>/g, '');
    return parseQuestionsFromRawText(roughText, examId);
  }

  const doc = parser.parseFromString(html, 'text/html');
  let topChildren = Array.from(doc.body.children);
  // Jika seluruh dokumen dibungkus satu <div> tunggal, buka wrapper-nya
  while (topChildren.length === 1 && topChildren[0].tagName.toUpperCase() === 'DIV') {
    topChildren = Array.from(topChildren[0].children);
  }

  interface HtmlQuestionItem {
    questionNumber: number | null;
    stemLines: string[];
    options: Partial<Record<CbtOptionKey, string>>;
    currentOpt: CbtOptionKey | null;
    explicitKey: CbtOptionKey | null;
  }

  const items: HtmlQuestionItem[] = [];
  let current: HtmlQuestionItem | null = null;
  let startedQuestions = false;
  let foundKunci = false;
  let autoQuestionNum = 0;
  const kunciParts: string[] = [];

  const pushCurrent = () => {
    if (!current) return;
    const stem = current.stemLines.join('\n').trim();
    if (stem || Object.keys(current.options).length > 0) {
      items.push(current);
    }
    current = null;
  };

  const parseInlineLinesIntoQuestion = (lines: string[], forceNewNumber?: number | null) => {
    for (const rawLine of lines) {
      const subLines = splitInlineOptionsInLine(
        rawLine,
        Boolean(current && current.options.A)
      );
      for (const line of subLines) {
        const kMatch = line.match(KEY_LINE_RE);
        if (kMatch && current) {
          current.explicitKey = kMatch[1].toUpperCase() as CbtOptionKey;
          current.currentOpt = null;
          continue;
        }

        const optMatch = line.match(OPT_RE);
        if (optMatch && current) {
          const hasStarPrefix = optMatch[1] === '*';
          const letter = optMatch[2].toUpperCase() as CbtOptionKey;
          const { text: optBody, isMarkedCorrect } = cleanOptionBodyAndMarkers(
            optMatch[3] || ''
          );
          if (hasStarPrefix || isMarkedCorrect) {
            current.explicitKey = letter;
          }
          current.options[letter] = optBody;
          current.currentOpt = letter;
          continue;
        }

        const qMatch = line.match(Q_START_RE);
        if (
          qMatch &&
          (!current ||
            Object.keys(current.options).length >= 2 ||
            current.explicitKey !== null)
        ) {
          pushCurrent();
          const num = Number(qMatch[1]) || ++autoQuestionNum;
          autoQuestionNum = num;
          current = {
            questionNumber: num,
            stemLines: qMatch[2].trim() ? [qMatch[2].trim()] : [],
            options: {},
            currentOpt: null,
            explicitKey: null,
          };
          startedQuestions = true;
          continue;
        }

        if (!current) {
          const assignedNum = forceNewNumber ?? ++autoQuestionNum;
          autoQuestionNum = assignedNum;
          current = {
            questionNumber: assignedNum,
            stemLines: [line],
            options: {},
            currentOpt: null,
            explicitKey: null,
          };
          startedQuestions = true;
        } else if (Object.keys(current.options).length >= 2 && !current.currentOpt) {
          // Opsi sudah terpasang lewat <ol>, maka paragraf baru ini adalah stem soal berikutnya
          pushCurrent();
          const assignedNum = forceNewNumber ?? ++autoQuestionNum;
          autoQuestionNum = assignedNum;
          current = {
            questionNumber: assignedNum,
            stemLines: [line],
            options: {},
            currentOpt: null,
            explicitKey: null,
          };
          startedQuestions = true;
        } else if (current.currentOpt && Object.keys(current.options).length < 4) {
          current.options[current.currentOpt] =
            `${current.options[current.currentOpt] || ''} ${line}`.trim();
        } else if (current.currentOpt && Object.keys(current.options).length >= 4) {
          // Setelah opsi D/E selesai, teks non-opsi baru adalah soal baru (tanpa nomor eksplisit)
          pushCurrent();
          const assignedNum = forceNewNumber ?? ++autoQuestionNum;
          autoQuestionNum = assignedNum;
          current = {
            questionNumber: assignedNum,
            stemLines: [line],
            options: {},
            currentOpt: null,
            explicitKey: null,
          };
          startedQuestions = true;
        } else {
          current.stemLines.push(line);
        }
      }
    }
  };

  for (let childIdx = 0; childIdx < topChildren.length; childIdx++) {
    const el = topChildren[childIdx];
    const tag = el.tagName.toUpperCase();
    const plain = collapseInlineSpaces(extractElementPlainLines(el, true));

    if (foundKunci) {
      if (plain) kunciParts.push(plain);
      continue;
    }

    if (!plain && tag !== 'OL' && tag !== 'UL') continue;

    // Deteksi blok KUNCI JAWABAN atau Pedoman penilaian di akhir dokumen
    if (
      /\bKUNCI\s+JAWABAN\b/i.test(plain) ||
      (tag === 'TABLE' && startedQuestions && isLikelyKunciTable(plain))
    ) {
      foundKunci = true;
      pushCurrent();
      kunciParts.push(plain);
      continue;
    }

    if (/^\s*pedoman\s+penilaian\b/i.test(plain) && startedQuestions) {
      foundKunci = true;
      pushCurrent();
      kunciParts.push(plain);
      continue;
    }

    // Lewati Kop Surat, Logo, Alamat, dan Petunjuk pengerjaan di bagian atas sebelum soal
    if (!startedQuestions && isLikelyLetterheadElement(el, plain)) {
      continue;
    }

    if (tag === 'OL' || tag === 'UL') {
      const liNodes = Array.from(el.children).filter(
        (c) => c.tagName.toUpperCase() === 'LI'
      );
      if (liNodes.length === 0) continue;

      // Cek apakah ada <ol> bersarang di dalam <li> (Struktur 1: Nested <ol>)
      const hasNestedList = liNodes.some(
        (li) => li.querySelector('ol, ul') !== null
      );

      if (hasNestedList) {
        const startAttr = Number(el.getAttribute('start') || 0);
        if (startAttr >= 1) autoQuestionNum = startAttr - 1;

        for (const li of liNodes) {
          pushCurrent();
          const nestedOls = Array.from(li.querySelectorAll('ol, ul'));
          // Pilih nested <ol> terakhir yang berisi 2–5 item sebagai opsi jawaban A–E
          let optionOl: Element | null = null;
          for (let j = nestedOls.length - 1; j >= 0; j--) {
            const candidateLis = Array.from(nestedOls[j].children).filter(
              (c) => c.tagName.toUpperCase() === 'LI'
            );
            if (candidateLis.length >= 2 && candidateLis.length <= 5) {
              optionOl = nestedOls[j];
              break;
            }
          }

          const optionSet = new Set<Element>(optionOl ? [optionOl] : []);
          const rawStem = extractLiStemWithoutOptionLists(li, optionSet);
          const { explicitNum, cleanText } = stripLeadingQuestionPrefix(rawStem);
          const qNum = explicitNum ?? ++autoQuestionNum;
          autoQuestionNum = qNum;

          const qItem: HtmlQuestionItem = {
            questionNumber: qNum,
            stemLines: cleanText ? cleanText.split('\n').filter(Boolean) : [],
            options: {},
            currentOpt: null,
            explicitKey: null,
          };

          if (optionOl) {
            const optLis = Array.from(optionOl.children).filter(
              (c) => c.tagName.toUpperCase() === 'LI'
            );
            optLis.slice(0, 5).forEach((optLi, optIdx) => {
              const rawOpt = collapseInlineSpaces(
                extractElementPlainLines(optLi, true)
              );
              const strippedOpt = stripLeadingOptionPrefixFromOlItem(rawOpt);
              const { text: optText, isMarkedCorrect } =
                cleanOptionBodyAndMarkers(strippedOpt);
              const letter = OPTION_KEYS[optIdx];
              qItem.options[letter] = optText;
              if (isMarkedCorrect) qItem.explicitKey = letter;
            });
          } else {
            // <li> tanpa nested <ol>: cek apakah opsi ditulis manual A. B. C. D. di dalam <li>
            const stemLines = rawStem.split('\n').filter(Boolean);
            current = qItem;
            qItem.stemLines = [];
            parseInlineLinesIntoQuestion(stemLines, qNum);
            continue;
          }

          current = qItem;
          startedQuestions = true;
          pushCurrent();
        }
        continue;
      }

      // Struktur 2: Sibling / Sequential <ol> (tidak ada nested <ol> di dalam <li>)
      const looksLikeInlineCompleteQuestions = liNodes.every((li) => {
        const t = extractElementPlainLines(li, true);
        return /\bA\s*[.)]\s+[\s\S]+\bB\s*[.)]\s+/i.test(t);
      });

      const nextSibling = topChildren[childIdx + 1];
      const nextSiblingIsOptionOl =
        nextSibling &&
        (nextSibling.tagName.toUpperCase() === 'OL' ||
          nextSibling.tagName.toUpperCase() === 'UL') &&
        (() => {
          const nextLis = Array.from(nextSibling.children).filter(
            (c) => c.tagName.toUpperCase() === 'LI'
          );
          return nextLis.length >= 4 && nextLis.length <= 5;
        })();

      // Jika daftar berjumlah 2-3 item tetapi langsung diikuti <ol> berisi 4-5 opsi, ini adalah pernyataan (1)(2)(3) di dalam stem!
      if (
        current &&
        Object.keys(current.options).length === 0 &&
        liNodes.length >= 2 &&
        liNodes.length <= 3 &&
        nextSiblingIsOptionOl
      ) {
        liNodes.forEach((stmtLi, sIdx) => {
          const stmtText = collapseInlineSpaces(
            extractElementPlainLines(stmtLi, true)
          );
          if (!stmtText) return;
          const alreadyNum = /^\s*\(?\d+\)?[.)]?\s+/.test(stmtText);
          current!.stemLines.push(alreadyNum ? stmtText : `(${sIdx + 1}) ${stmtText}`);
        });
        continue;
      }

      const olType = (el.getAttribute('type') || '').trim().toLowerCase();
      const isLetteredOl = olType === 'a' || olType === 'i';
      const canAttachAsOptionsToCurrent =
        Boolean(current) &&
        current !== null &&
        Object.keys(current.options).length === 0 &&
        !looksLikeInlineCompleteQuestions &&
        liNodes.length >= 2 &&
        liNodes.length <= 5 &&
        (isLetteredOl || tag === 'OL');

      if (canAttachAsOptionsToCurrent && current) {
        liNodes.slice(0, 5).forEach((optLi, optIdx) => {
          const rawOpt = collapseInlineSpaces(extractElementPlainLines(optLi, true));
          const strippedOpt = stripLeadingOptionPrefixFromOlItem(rawOpt);
          const { text: optText, isMarkedCorrect } =
            cleanOptionBodyAndMarkers(strippedOpt);
          const letter = OPTION_KEYS[optIdx];
          current!.options[letter] = optText;
          if (isMarkedCorrect) current!.explicitKey = letter;
        });
        current.currentOpt = null;
        startedQuestions = true;
        continue;
      }

      // Jika bukan list opsi untuk soal saat ini, maka setiap <li> adalah butir soal baru
      const startAttr = Number(el.getAttribute('start') || 0);
      if (startAttr >= 1) autoQuestionNum = startAttr - 1;

      for (const li of liNodes) {
        pushCurrent();
        const liText = collapseInlineSpaces(extractElementPlainLines(li, true));
        if (!liText) continue;
        const lines = liText.split('\n').filter(Boolean);
        const hasInlineOpts = /\bA\s*[.)]\s+[\s\S]+\bB\s*[.)]\s+/i.test(liText);

        if (hasInlineOpts) {
          const { explicitNum } = stripLeadingQuestionPrefix(lines[0] || '');
          const qNum = explicitNum ?? ++autoQuestionNum;
          autoQuestionNum = qNum;
          current = {
            questionNumber: qNum,
            stemLines: [],
            options: {},
            currentOpt: null,
            explicitKey: null,
          };
          const first = stripLeadingQuestionPrefix(lines[0]);
          if (first.cleanText) current.stemLines.push(first.cleanText);
          parseInlineLinesIntoQuestion(lines.slice(1), qNum);
          startedQuestions = true;
        } else {
          const { explicitNum, cleanText } = stripLeadingQuestionPrefix(liText);
          const qNum = explicitNum ?? ++autoQuestionNum;
          autoQuestionNum = qNum;
          current = {
            questionNumber: qNum,
            stemLines: cleanText ? cleanText.split('\n').filter(Boolean) : [],
            options: {},
            currentOpt: null,
            explicitKey: null,
          };
          startedQuestions = true;
        }
      }
      continue;
    }

    // Node <p>, <h*>, <div>, <table> di dalam area soal
    const lines = plain.split('\n').filter(Boolean);
    if (lines.length === 0) continue;

    // Jika belum mulai soal dan baris pendek terlihat seperti kop/judul/bagian sebelum soal no 1
    if (!startedQuestions) {
      const hasListOrQ1Soon = topChildren
        .slice(childIdx + 1, childIdx + 8)
        .some((nextEl) => {
          const nextTag = nextEl.tagName.toUpperCase();
          if (nextTag === 'OL') return true;
          const nextPlain = collapseInlineSpaces(extractElementPlainLines(nextEl, true));
          return /^\s*(?:soal\s*(?:no\.?)?\s*)?1\s*[.)\-:](?!\d)\s*\S/i.test(nextPlain);
        });
      if (
        hasListOrQ1Soon &&
        (LETTERHEAD_LINE_RE.test(plain) ||
          /^(?:[AI1]\.\s*)?(?:pilihan\s+ganda|bismillah|mata\s+pelajaran|kelas|semester)/i.test(
            plain
          ))
      ) {
        continue;
      }
    }

    parseInlineLinesIntoQuestion(lines);
  }
  pushCurrent();

  // Safeguard ekstra: bila KUNCI JAWABAN sempat terbawa masuk ke opsi terakhir, bersihkan!
  const keyMap = extractAnswerKeysFromSection(kunciParts.join('\n'));
  if (items.length > 0) {
    const last = items[items.length - 1];
    (['E', 'D'] as CbtOptionKey[]).forEach((optKey) => {
      const val = last.options[optKey];
      if (val && /\bKUNCI\s+JAWABAN\b/i.test(val)) {
        const split = splitQuestionBodyAndKunci(val);
        last.options[optKey] = split.body.trim();
        split.keyMap.forEach((v, k) => {
          if (!keyMap.has(k)) keyMap.set(k, v);
        });
      }
    });
  }

  return items.map((item, idx) => {
    const qNum = item.questionNumber ?? idx + 1;
    const matchedKey =
      item.explicitKey || keyMap.get(qNum) || keyMap.get(idx + 1) || null;
    const draft: ParsedQuestionDraft = {
      id: makeQuestionId(examId, idx),
      examId,
      orderNumber: idx + 1,
      pertanyaan: item.stemLines.join('\n').trim(),
      opsiA: item.options.A || '',
      opsiB: item.options.B || '',
      opsiC: item.options.C || '',
      opsiD: item.options.D || '',
      ...(item.options.E ? { opsiE: item.options.E } : {}),
      kunciJawaban: matchedKey || 'A',
      keyExplicit: Boolean(matchedKey),
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
    const res = await mammoth.convertToHtml({ arrayBuffer: buffer });
    const htmlParsed = parseDocxHtmlQuestions(res.value || '', examId);
    if (htmlParsed.length > 0) return htmlParsed;
    const fallbackRaw = await mammoth.extractRawText({ arrayBuffer: buffer });
    return parseQuestionsFromRawText(fallbackRaw.value || '', examId);
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

  const withoutPedoman = cleanUnicodeText(trimmed)
    .replace(/\bpedoman\s+penilaian\b[\s\S]*/i, '')
    .replace(/\bkunci\s+jawaban\b/gi, ' ');

  const numberedMatches = Array.from(
    withoutPedoman.matchAll(/\b(\d{1,3})\s*[.):\-=]?\s*([A-Ea-e])\b/g)
  );
  const byNumber = new Map<number, CbtOptionKey>();

  if (numberedMatches.length >= 2) {
    for (const m of numberedMatches) {
      const num = Number(m[1]);
      const key = m[2].toUpperCase() as CbtOptionKey;
      if (num >= 1) byNumber.set(num, key);
    }
  } else {
    const letters = withoutPedoman.toUpperCase().replace(/[^A-E]/g, '').split('');
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
