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

async function readFileAsArrayBufferSafe(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    try {
      const buf = await file.arrayBuffer();
      if (buf && buf.byteLength > 0) return buf;
    } catch {
      // Fallback ke FileReader untuk Android WebView / content:// URI
    }
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('Browser tidak mendukung pembacaan file lokal.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Gagal membaca isi file dari penyimpanan perangkat.'));
      }
    };
    reader.onerror = () => {
      reject(
        new Error(
          'File tidak dapat diakses dari HP. Jika file masih di Google Drive/WhatsApp cloud, simpan dulu ke folder Download HP lalu pilih ulang.'
        )
      );
    };
    reader.readAsArrayBuffer(file);
  });
}

function bytesContainsAscii(bytes: Uint8Array, needle: string): boolean {
  if (!needle || bytes.length < needle.length) return false;
  const codes = Array.from(needle, (ch) => ch.charCodeAt(0));
  const limit = bytes.length - codes.length;
  for (let i = 0; i <= limit; i++) {
    let matched = true;
    for (let j = 0; j < codes.length; j++) {
      if (bytes[i + j] !== codes[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function detectFileKindFromBytes(
  file: File,
  buffer: ArrayBuffer
): 'docx' | 'xlsx' | 'xls' | 'doc' | 'pdf' | 'rtf' | 'csv' | 'text' {
  const bytes = new Uint8Array(buffer);
  const lower = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();

  // %PDF-
  if (
    (bytes.length >= 4 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46) ||
    lower.endsWith('.pdf') ||
    mime === 'application/pdf'
  ) {
    return 'pdf';
  }

  // PK\x03\x04 (ZIP-based Office: .docx or .xlsx/.xlsm)
  const isZip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;
  if (isZip) {
    if (bytesContainsAscii(bytes, 'word/')) return 'docx';
    if (bytesContainsAscii(bytes, 'xl/')) return 'xlsx';
    if (lower.endsWith('.docx') || mime.includes('wordprocessingml')) return 'docx';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || mime.includes('spreadsheetml')) {
      return 'xlsx';
    }
    return 'docx';
  }

  // OLE2 legacy binary (.xls or .doc)
  const isOle =
    bytes.length >= 4 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0;
  if (isOle) {
    if (lower.endsWith('.xls') || mime.includes('ms-excel')) return 'xls';
    if (lower.endsWith('.doc') || mime.includes('msword')) return 'doc';
    return 'xls';
  }

  // Cek RTF header ({\rtf)
  const headText = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(0, Math.min(bytes.length, 512))
  );
  if (lower.endsWith('.rtf') || /^\s*\{\\rtf/i.test(headText)) {
    return 'rtf';
  }

  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || mime === 'text/csv') {
    return 'csv';
  }

  if (
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xlsm') ||
    mime.includes('spreadsheetml')
  ) {
    return 'xlsx';
  }
  if (lower.endsWith('.xls') || mime.includes('ms-excel')) {
    return 'xls';
  }
  if (lower.endsWith('.docx') || mime.includes('wordprocessingml')) {
    return 'docx';
  }

  return 'text';
}

function parseSpreadsheetMatrix(matrix: any[][], examId: string): ParsedQuestionDraft[] {
  if (matrix.length === 0) return [];

  // Detect header row across first 15 rows (handles Excel files with leading title/instruction rows)
  const normalizeCell = (v: unknown) =>
    String(v ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  let headerRowIdx = -1;
  const scanLimit = Math.min(matrix.length, 15);
  for (let r = 0; r < scanLimit; r++) {
    const rowCells = (matrix[r] || []).map(normalizeCell);
    const hasQuestionCol = rowCells.some(
      (h) =>
        h === 'pertanyaan' ||
        h === 'soal' ||
        h === 'question' ||
        h.includes('pertanyaan') ||
        h.includes('butir soal') ||
        h.includes('uraian soal') ||
        h.includes('question')
    );
    const hasOptionOrKeyCol = rowCells.some(
      (h) =>
        h.includes('opsi a') ||
        h.includes('pilihan a') ||
        h.includes('jawaban a') ||
        h === 'a' ||
        h.includes('kunci') ||
        h === 'answer' ||
        h === 'key'
    );
    if (hasQuestionCol && hasOptionOrKeyCol) {
      headerRowIdx = r;
      break;
    }
  }

  const hasHeader = headerRowIdx >= 0;
  const headerRow = hasHeader ? (matrix[headerRowIdx] || []).map(normalizeCell) : [];

  const findCol = (keywords: string[], fallbackIndex: number): number => {
    if (!hasHeader) return fallbackIndex;
    const exact = headerRow.findIndex((h) => keywords.some((k) => h === k));
    if (exact >= 0) return exact;
    const partial = headerRow.findIndex((h) => keywords.some((k) => h.includes(k)));
    return partial >= 0 ? partial : fallbackIndex;
  };

  const colNo = hasHeader
    ? headerRow.findIndex((h) => h === 'no' || h === 'no.' || h === 'nomor')
    : -1;
  const qOffset = colNo === 0 ? 1 : 0;
  const colQuestion = findCol(['pertanyaan', 'butir soal', 'uraian soal', 'soal', 'question'], 0 + qOffset);
  const colA = findCol(['opsi a', 'pilihan a', 'jawaban a', 'a'], colQuestion + 1);
  const colB = findCol(['opsi b', 'pilihan b', 'jawaban b', 'b'], colA + 1);
  const colC = findCol(['opsi c', 'pilihan c', 'jawaban c', 'c'], colB + 1);
  const colD = findCol(['opsi d', 'pilihan d', 'jawaban d', 'd'], colC + 1);
  const colE = findCol(['opsi e', 'pilihan e', 'jawaban e', 'e'], colD + 1);
  const colKey = findCol(['kunci jawaban', 'kunci', 'jawaban benar', 'answer', 'key'], colD + 2);
  const colImg = findCol(['url gambar', 'gambar', 'image', 'img'], colD + 3);

  const startIdx = hasHeader ? headerRowIdx + 1 : 0;
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
    // If no header row existed, skip leading document title/banner rows without any options
    if (!hasHeader && out.length === 0 && !opsiA && !opsiB && !opsiC && !opsiD) continue;

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

export async function parseSpreadsheetQuestions(
  file: File,
  examId: string
): Promise<ParsedQuestionDraft[]> {
  const buffer = await readFileAsArrayBufferSafe(file);
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('File kosong atau belum selesai diunduh di perangkat.');
  }
  const kind = detectFileKindFromBytes(file, buffer);
  if (kind === 'docx') {
    return parseDocxBufferQuestions(buffer, examId);
  }
  if (kind === 'pdf') {
    throw new Error(
      'File PDF belum didukung untuk upload langsung. Salin teks soal dari PDF lalu tempelkan ke kotak "Copy-Paste Soal", atau konversi ke .docx/.xlsx.'
    );
  }
  if (kind === 'doc') {
    throw new Error(
      'Format Word lama (.doc) tidak dapat dibaca langsung. Simpan ulang sebagai .docx atau copy-paste soal ke kotak Paste.'
    );
  }

  let matrix: any[][] = [];
  if (kind === 'csv' || kind === 'text') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buffer));
    matrix = parseCsvTextToMatrix(text);
    const parsedCsv = parseSpreadsheetMatrix(matrix, examId);
    if (parsedCsv.length > 0) return parsedCsv;
    return parseQuestionsFromRawText(text, examId);
  }

  const wb = XLSX.read(buffer, { type: 'array' });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const ws = wb.Sheets[firstSheet];
  matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
  return parseSpreadsheetMatrix(matrix, examId);
}

function cleanUnicodeText(text: string): string {
  return (text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
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

const Q_START_RE =
  /^\s*(?:(?:soal\s*(?:no\.?)?|no\.?)\s*(\d{1,3})(?:\s*[.)\-:]|\s+)|(\d{1,3})\s*[.)\-:](?!\d))\s*(.*)$/i;
const OPT_RE =
  /^\s*(\*?)\s*(?:([A-E])\s*[.)](?!\w\.)(?:\s+(.*)|(?=[A-Z0-9\u0600-\u06FF"'(])(.*)|$)|([a-e])\s*[.)](?!\w\.)(?:\s+(.*)|(?=[A-Za-z0-9\u0600-\u06FF"'(])(.*)|$))/;
const KEY_LINE_RE =
  /^\s*[\[(]?\s*(?:kunci(?:\s*jawaban)?|jawaban(?:\s*benar)?|answer|key)\s*(?:[:=\-]\s*[\[(]?([A-E])[\])]?(?:\s*[.)]|\s*[\])]|\s*$)|\s+[\[(]?([A-E])[\])]?\s*[\])]?\s*$)/i;
const IMG_LINE_RE = /^\s*(?:gambar|image|img|url\s*gambar)\s*[:=]\s*(https?:\/\/\S+)/i;

function matchQuestionStart(line: string): { num: number; rest: string } | null {
  const m = (line || '').match(Q_START_RE);
  if (!m) return null;
  const num = Number(m[1] || m[2]);
  if (!Number.isFinite(num) || num <= 0) return null;
  return { num, rest: (m[3] || '').trim() };
}

function matchOptionLine(line: string): {
  hasStarPrefix: boolean;
  letter: CbtOptionKey;
  rawBody: string;
} | null {
  const m = (line || '').match(OPT_RE);
  if (!m) return null;
  const letter = (m[2] || m[5] || '').toUpperCase() as CbtOptionKey;
  if (!letter) return null;
  const rawBody = m[3] ?? m[4] ?? m[6] ?? m[7] ?? '';
  return {
    hasStarPrefix: m[1] === '*',
    letter,
    rawBody,
  };
}

const LETTERHEAD_LINE_RE =
  /^(?:telp(?:hone|on)?|telepon|whatsapp|wa|hp|email|ig|instagram|alamat|jl\.|jalan|sukoharjo|jawa\s+tengah|muslim\s+digital\s+academy|pondok\s+pesantren|darul\s+fithrah|@[a-z0-9_.-]+|petunjuk\s+pengerjaan\b|pilih\s+satu\s+jawaban\s+yang\s+paling\s+tepat\b|bacalah\s+setiap\s+soal\b|tanda\s+silang\s*\(x\)|[-_=*]{4,})/i;

function extractSingleKeyFromLine(line: string): CbtOptionKey | null {
  const cleaned = cleanUnicodeText(line).trim();
  if (!cleaned) return null;
  const m = cleaned.match(KEY_LINE_RE);
  if (!m) return null;
  const numberedPairs = cleaned.match(/\b\d{1,3}\s*[.:\-)]?\s*[A-Ea-e]\b/g) || [];
  if (numberedPairs.length >= 2) return null;
  const letter = (m[1] || m[2] || '').toUpperCase();
  if (letter === 'A' || letter === 'B' || letter === 'C' || letter === 'D' || letter === 'E') {
    return letter;
  }
  return null;
}

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

function hasUpcomingQuestionOptionBlock(lines: string[]): boolean {
  let hasA = false;
  let hasB = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (/(?:^|\s)\*?\s*A\s*[.)]\s+\S/i.test(t)) hasA = true;
    if (/(?:^|\s)\*?\s*B\s*[.)]\s+\S/i.test(t)) hasB = true;
    if (hasA && hasB) return true;
  }
  return false;
}

function splitQuestionBodyAndKunci(rawText: string): {
  body: string;
  kunciSection: string;
  keyMap: Map<number, CbtOptionKey>;
} {
  const cleaned = cleanUnicodeText(rawText);
  const lines = cleaned.split('\n');

  let splitLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    // Jangan pernah memotong pada baris kunci per-soal seperti "Kunci Jawaban: B"
    if (extractSingleKeyFromLine(trimmed)) continue;

    const isKunciHeader =
      /(?:^|\s)(?:[-_=*#\s]*)?KUNCI\s+JAWABAN\b/i.test(trimmed) ||
      (/^\s*pedoman\s+penilaian\b/i.test(trimmed) && i > 0);
    if (!isKunciHeader) continue;

    const remainingLines = lines.slice(i + 1);
    if (hasUpcomingQuestionOptionBlock(remainingLines)) {
      continue;
    }

    const tailText = lines.slice(i).join('\n');
    const tailPairs = Array.from(
      tailText
        .replace(/\bpedoman\s+penilaian\b[\s\S]*/i, '')
        .matchAll(/\b(\d{1,3})\s*[.:\-)]?\s*([A-Ea-e])\b/g)
    );
    if (tailPairs.length >= 1 || /^\s*(?:[-_=*#\s]*)?(?:KUNCI\s+JAWABAN|PEDOMAN\s+PENILAIAN)\b/i.test(trimmed)) {
      splitLineIdx = i;
      break;
    }
  }

  if (splitLineIdx < 0) {
    return { body: cleaned, kunciSection: '', keyMap: new Map() };
  }

  const body = lines.slice(0, splitLineIdx).join('\n').trim();
  const kunciSection = lines.slice(splitLineIdx).join('\n').trim();
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

    // Jika sudah sampai nomor soal 1 (e.g. "1. ...", "No. 1 ...", "Soal 1:"), berhenti membuang header
    if (matchQuestionStart(trimmed)) {
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
      .some((l) => {
        const m = matchQuestionStart(l.trim());
        return Boolean(m && m.num === 1 && m.rest.length > 0);
      });
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
  let working = line;
  if (
    /\s+[\[(]?\s*(?:kunci(?:\s*jawaban)?|jawaban(?:\s*benar)?|answer|key)\s*[:=\-]\s*[\[(]?[A-E][\])]?\s*[\])]?\s*$/i.test(
      working
    ) &&
    !/^\s*[\[(]?\s*(?:kunci(?:\s*jawaban)?|jawaban(?:\s*benar)?|answer|key)\s*[:=\-]/i.test(working)
  ) {
    working = working.replace(
      /\s+([\[(]?\s*(?:kunci(?:\s*jawaban)?|jawaban(?:\s*benar)?|answer|key)\s*[:=\-]\s*[\[(]?[A-E][\])]?\s*[\])]?\s*)$/i,
      '\n$1'
    );
  }

  const chunks = working.split('\n').map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];

  for (const chunk of chunks) {
    const startsWithA = /^\s*\*?\s*A\s*[.)](?!\w\.)\s*/i.test(chunk);
    const hasMultipleOptionMarkers =
      /(?:\t+|\s+)\*?\s*B\s*[.)](?!\w\.)\s*/i.test(chunk) &&
      /(?:\t+|\s+)\*?\s*C\s*[.)](?!\w\.)\s*/i.test(chunk);

    if (hasMultipleOptionMarkers) {
      out.push(
        ...chunk
          .replace(/(?:\t+|\s+)(\*?\s*[A-Ea-e]\s*[.)](?!\w\.)\s*)/g, '\n$1')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      );
    } else if (
      startsWithA ||
      (hasOptionAAlready && /(?:\t+|\s+)\*?\s*[B-E]\s*[.)](?!\w\.)\s*/i.test(chunk))
    ) {
      out.push(
        ...chunk
          .replace(/(?:\t+|\s+)(\*?\s*[B-Eb-e]\s*[.)](?!\w\.)\s*)/g, '\n$1')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      );
    } else {
      out.push(chunk);
    }
  }
  return out;
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
      const singleKey = extractSingleKeyFromLine(line);
      if (singleKey) {
        if (current) {
          current.kunci = singleKey;
          current.currentOpt = null;
        } else if (blocks.length > 0) {
          blocks[blocks.length - 1].kunci = singleKey;
        }
        continue;
      }

      const iMatch = line.match(IMG_LINE_RE);
      if (iMatch && current) {
        current.imageUrl = iMatch[1].trim();
        continue;
      }

      const optMatch = matchOptionLine(line);
      if (optMatch && current) {
        const { hasStarPrefix, letter, rawBody: rawOpt } = optMatch;
        const { text: optBody, isMarkedCorrect } = cleanOptionBodyAndMarkers(rawOpt);
        if (hasStarPrefix || isMarkedCorrect) {
          current.kunci = letter;
        }
        current.options[letter] = optBody;
        current.currentOpt = letter;
        continue;
      }

      const qMatch = matchQuestionStart(line);
      const isSequentialNextQuestion = Boolean(
        qMatch &&
          current &&
          current.questionNumber !== null &&
          qMatch.num === current.questionNumber + 1 &&
          current.pertanyaanLines.length > 0 &&
          !/(?:berikut(?:\s+ini)?|pernyataan|langkah)\s*:?\s*$/i.test(
            current.pertanyaanLines[current.pertanyaanLines.length - 1] || ''
          )
      );
      if (
        qMatch &&
        (!current ||
          Object.keys(current.options).length >= 2 ||
          current.kunci !== null ||
          isSequentialNextQuestion)
      ) {
        pushCurrent();
        current = {
          questionNumber: qMatch.num || null,
          pertanyaanLines: qMatch.rest ? [qMatch.rest] : [],
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
  const lines = trimmed.split('\n');
  const firstMatch = matchQuestionStart(lines[0] || '');
  if (firstMatch) {
    const restLines = [firstMatch.rest, ...lines.slice(1)].filter(Boolean);
    return {
      explicitNum: firstMatch.num,
      cleanText: restLines.join('\n').trim(),
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

function isElementFullyStyledCorrect(el: Element): boolean {
  if (el.querySelector('mark, u')) {
    const markedText = Array.from(el.querySelectorAll('mark, u'))
      .map((n) => (n.textContent || '').trim())
      .join(' ')
      .trim();
    if (markedText.length >= 1) return true;
  }
  const strongNodes = Array.from(el.querySelectorAll('strong, b'));
  if (strongNodes.length === 0) return false;
  const fullText = collapseInlineSpaces(el.textContent || '').replace(/\s+/g, '');
  const boldText = strongNodes
    .map((n) => collapseInlineSpaces(n.textContent || ''))
    .join('')
    .replace(/\s+/g, '');
  return fullText.length >= 2 && boldText.length >= Math.max(2, fullText.length - 3);
}

function tryExtractQuestionTableLines(tableEl: Element): {
  mode: 'structured' | 'lines';
  structured?: Array<{
    questionNumber: number | null;
    stem: string;
    options: Partial<Record<CbtOptionKey, string>>;
    explicitKey: CbtOptionKey | null;
  }>;
  lines?: string[];
} {
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  if (rows.length === 0) return { mode: 'lines', lines: [] };

  const matrix = rows
    .map((tr) =>
      Array.from(tr.children)
        .filter((c) => c.tagName.toUpperCase() === 'TD' || c.tagName.toUpperCase() === 'TH')
        .map((cell) => collapseInlineSpaces(extractElementPlainLines(cell, true)))
    )
    .filter((cells) => cells.some((c) => c.length > 0));

  if (matrix.length === 0) return { mode: 'lines', lines: [] };

  // Cek apakah tabel memakai kolom terstruktur: Pertanyaan | Opsi A | Opsi B | Opsi C | Opsi D | Kunci
  const firstRowLower = matrix[0].map((c) => c.toLowerCase().trim());
  const hasStructuredHeader =
    firstRowLower.some((h) => h.includes('pertanyaan') || h === 'soal' || h.includes('question')) &&
    firstRowLower.some((h) => h.includes('opsi a') || h === 'a' || h.includes('pilihan a')) &&
    firstRowLower.some((h) => h.includes('opsi b') || h === 'b' || h.includes('pilihan b'));

  if (hasStructuredHeader) {
    const findIdx = (keys: string[], fallback: number) => {
      const exact = firstRowLower.findIndex((h) => keys.some((k) => h === k));
      if (exact >= 0) return exact;
      const part = firstRowLower.findIndex((h) => keys.some((k) => h.includes(k)));
      return part >= 0 ? part : fallback;
    };
    const colNo = firstRowLower.findIndex((h) => h === 'no' || h === 'no.' || h === 'nomor');
    const colQ = findIdx(['pertanyaan', 'soal', 'question'], colNo === 0 ? 1 : 0);
    const colA = findIdx(['opsi a', 'pilihan a', 'jawaban a', 'a'], colQ + 1);
    const colB = findIdx(['opsi b', 'pilihan b', 'jawaban b', 'b'], colA + 1);
    const colC = findIdx(['opsi c', 'pilihan c', 'jawaban c', 'c'], colB + 1);
    const colD = findIdx(['opsi d', 'pilihan d', 'jawaban d', 'd'], colC + 1);
    const colE = firstRowLower.findIndex((h) =>
      ['opsi e', 'pilihan e', 'jawaban e', 'e'].some((k) => h === k || h.includes(k))
    );
    const colKey = firstRowLower.findIndex((h) =>
      ['kunci jawaban', 'kunci', 'jawaban benar', 'answer', 'key'].some((k) => h.includes(k))
    );

    const structured: Array<{
      questionNumber: number | null;
      stem: string;
      options: Partial<Record<CbtOptionKey, string>>;
      explicitKey: CbtOptionKey | null;
    }> = [];

    for (let r = 1; r < matrix.length; r++) {
      const row = matrix[r];
      const stem = (row[colQ] || '').trim();
      if (!stem) continue;
      const numRaw = colNo >= 0 ? Number((row[colNo] || '').replace(/\D/g, '')) : 0;
      const options: Partial<Record<CbtOptionKey, string>> = {
        A: (row[colA] || '').trim(),
        B: (row[colB] || '').trim(),
        C: (row[colC] || '').trim(),
        D: (row[colD] || '').trim(),
      };
      if (colE >= 0 && (row[colE] || '').trim()) {
        options.E = row[colE].trim();
      }
      const keyRaw = colKey >= 0 ? normalizeAnswerKey(row[colKey]) : null;
      structured.push({
        questionNumber: numRaw >= 1 ? numRaw : null,
        stem,
        options,
        explicitKey: keyRaw,
      });
    }
    if (structured.length > 0) {
      return { mode: 'structured', structured };
    }
  }

  // Tabel 2 kolom "1 | Soal + Opsi": normalisasi angka polos di kolom pertama menjadi "1."
  const lines: string[] = [];
  for (const row of matrix) {
    const nonEmpty = row.filter(Boolean);
    if (nonEmpty.length === 0) continue;
    if (nonEmpty.length >= 2 && /^\d{1,3}\.?$/.test(nonEmpty[0])) {
      const qNum = nonEmpty[0].replace(/\.$/, '');
      const rest = nonEmpty.slice(1).join(' ').trim();
      const restLines = rest.split('\n').filter(Boolean);
      if (restLines.length > 0) {
        lines.push(`${qNum}. ${restLines[0]}`);
        lines.push(...restLines.slice(1));
      } else {
        lines.push(`${qNum}.`);
      }
    } else {
      lines.push(...nonEmpty.join(' ').split('\n').filter(Boolean));
    }
  }
  return { mode: 'lines', lines };
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
  // Jika seluruh dokumen dibungkus satu container tunggal (DIV/SECTION/ARTICLE/MAIN), buka wrapper-nya
  while (
    topChildren.length === 1 &&
    /^(DIV|SECTION|ARTICLE|MAIN)$/i.test(topChildren[0].tagName)
  ) {
    topChildren = Array.from(topChildren[0].children);
  }

  interface HtmlQuestionItem {
    questionNumber: number | null;
    stemLines: string[];
    options: Partial<Record<CbtOptionKey, string>>;
    currentOpt: CbtOptionKey | null;
    explicitKey: CbtOptionKey | null;
    styledKeyCandidates: CbtOptionKey[];
  }

  const items: HtmlQuestionItem[] = [];
  let current: HtmlQuestionItem | null = null;
  let startedQuestions = false;
  let foundKunci = false;
  let autoQuestionNum = 0;
  const kunciParts: string[] = [];

  const pushCurrent = () => {
    if (!current) return;
    if (
      !current.explicitKey &&
      current.styledKeyCandidates.length === 1 &&
      Object.keys(current.options).length >= 4
    ) {
      current.explicitKey = current.styledKeyCandidates[0];
    }
    const stem = current.stemLines.join('\n').trim();
    if (stem || Object.keys(current.options).length > 0) {
      items.push(current);
    }
    current = null;
  };

  const applySingleKeyToActiveOrLast = (key: CbtOptionKey) => {
    if (current) {
      current.explicitKey = key;
      current.currentOpt = null;
    } else if (items.length > 0) {
      items[items.length - 1].explicitKey = key;
    }
  };

  const parseInlineLinesIntoQuestion = (
    lines: string[],
    forceNewNumber?: number | null,
    styledCandidateKey?: CbtOptionKey | null
  ) => {
    for (const rawLine of lines) {
      const subLines = splitInlineOptionsInLine(
        rawLine,
        Boolean(current && current.options.A)
      );
      for (const line of subLines) {
        const singleKey = extractSingleKeyFromLine(line);
        if (singleKey) {
          applySingleKeyToActiveOrLast(singleKey);
          continue;
        }

        const optMatch = matchOptionLine(line);
        if (optMatch && current) {
          const { hasStarPrefix, letter, rawBody: rawOpt } = optMatch;
          const { text: optBody, isMarkedCorrect } = cleanOptionBodyAndMarkers(rawOpt);
          if (hasStarPrefix || isMarkedCorrect) {
            current.explicitKey = letter;
          }
          if (
            styledCandidateKey &&
            subLines.length === 1 &&
            !current.styledKeyCandidates.includes(letter)
          ) {
            current.styledKeyCandidates.push(letter);
          }
          current.options[letter] = optBody;
          current.currentOpt = letter;
          continue;
        }

        const qMatch = matchQuestionStart(line);
        const isSequentialNextQuestion = Boolean(
          qMatch &&
            current &&
            current.questionNumber !== null &&
            qMatch.num === current.questionNumber + 1 &&
            current.stemLines.length > 0 &&
            !/(?:berikut(?:\s+ini)?|pernyataan|langkah)\s*:?\s*$/i.test(
              current.stemLines[current.stemLines.length - 1] || ''
            )
        );
        if (
          qMatch &&
          (!current ||
            Object.keys(current.options).length >= 2 ||
            current.explicitKey !== null ||
            isSequentialNextQuestion)
        ) {
          pushCurrent();
          const num = qMatch.num || ++autoQuestionNum;
          autoQuestionNum = num;
          current = {
            questionNumber: num,
            stemLines: qMatch.rest ? [qMatch.rest] : [],
            options: {},
            currentOpt: null,
            explicitKey: null,
            styledKeyCandidates: [],
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
            styledKeyCandidates: [],
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
            styledKeyCandidates: [],
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
            styledKeyCandidates: [],
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
      if (tag === 'OL') {
        const startAttr = Number(el.getAttribute('start') || 1);
        const liNodes = Array.from(el.children).filter(
          (c) => c.tagName.toUpperCase() === 'LI'
        );
        liNodes.forEach((li, idx) => {
          const t = collapseInlineSpaces(extractElementPlainLines(li, true));
          if (!t) return;
          if (/^\d{1,3}\s*[.:\-)]?\s*[A-E]\b/i.test(t)) {
            kunciParts.push(t);
          } else {
            kunciParts.push(`${startAttr + idx}. ${t}`);
          }
        });
      } else if (plain) {
        kunciParts.push(plain);
      }
      continue;
    }

    if (!plain && tag !== 'OL' && tag !== 'UL') continue;

    // Deteksi blok KUNCI JAWABAN atau Pedoman penilaian di akhir dokumen
    // PENTING: baris per-soal seperti "Kunci Jawaban: B" TIDAK boleh memicu foundKunci!
    const singleKeyOnBlock = extractSingleKeyFromLine(plain);
    const hasKunciHeader = /\bKUNCI\s+JAWABAN\b/i.test(plain);
    const hasPedomanHeader = /^\s*pedoman\s+penilaian\b/i.test(plain) && startedQuestions;
    const isKunciTable = tag === 'TABLE' && startedQuestions && isLikelyKunciTable(plain);

    if (isKunciTable) {
      foundKunci = true;
      pushCurrent();
      kunciParts.push(plain);
      continue;
    }

    if ((hasKunciHeader || hasPedomanHeader) && !singleKeyOnBlock) {
      const remainingSiblings = topChildren.slice(childIdx + 1);
      const remainingCombined = remainingSiblings
        .map((nextEl) => collapseInlineSpaces(extractElementPlainLines(nextEl, true)))
        .filter(Boolean)
        .join('\n');

      const hasUpcomingQuestionOptions =
        /(?:^|\n|\s)\*?\s*A\s*[.)]\s*\S+[\s\S]*(?:^|\n|\s)\*?\s*B\s*[.)]\s*\S+/i.test(
          remainingCombined
        ) ||
        remainingSiblings.some((nextEl) => {
          const nextTag = nextEl.tagName.toUpperCase();
          if (nextTag === 'OL' && nextEl.querySelector('ol, ul')) {
            return true;
          }
          if (nextTag === 'OL') {
            const lis = Array.from(nextEl.children).filter(
              (c) => c.tagName.toUpperCase() === 'LI'
            );
            const avgLen =
              lis.reduce((sum, li) => sum + (li.textContent || '').trim().length, 0) /
              Math.max(1, lis.length);
            return avgLen > 18;
          }
          return false;
        });

      if (!hasUpcomingQuestionOptions) {
        foundKunci = true;
        pushCurrent();
        kunciParts.push(plain);
        continue;
      }
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
          const liFullText = collapseInlineSpaces(extractElementPlainLines(li, true));
          const hasManualTextOptions =
            /(?:^|\n|\s)\*?\s*A\s*[.)]\s*\S+[\s\S]*(?:^|\n|\s)\*?\s*B\s*[.)]\s*\S+/i.test(
              liFullText
            );
          const nestedOls = Array.from(li.querySelectorAll('ol, ul'));
          // Pilih nested <ol> terakhir yang berisi 2–5 item sebagai opsi jawaban A–E,
          // KECUALI jika <li> sudah punya opsi manual A. B. C. D. di paragrafnya (maka nested list adalah pernyataan!)
          let optionOl: Element | null = null;
          if (!hasManualTextOptions) {
            for (let j = nestedOls.length - 1; j >= 0; j--) {
              const candidateLis = Array.from(nestedOls[j].children).filter(
                (c) => c.tagName.toUpperCase() === 'LI'
              );
              if (candidateLis.length >= 2 && candidateLis.length <= 5) {
                optionOl = nestedOls[j];
                break;
              }
            }
          }

          const optionSet = new Set<Element>(optionOl ? [optionOl] : []);
          const rawStem = extractLiStemWithoutOptionLists(li, optionSet);
          const { explicitNum, cleanText } = stripLeadingQuestionPrefix(rawStem);
          const qNum = explicitNum ?? ++autoQuestionNum;
          autoQuestionNum = qNum;

          const qItem: HtmlQuestionItem = {
            questionNumber: qNum,
            stemLines: [],
            options: {},
            currentOpt: null,
            explicitKey: null,
            styledKeyCandidates: [],
          };

          for (const stemLine of cleanText.split('\n').filter(Boolean)) {
            const inlineKey = extractSingleKeyFromLine(stemLine);
            if (inlineKey) {
              qItem.explicitKey = inlineKey;
            } else {
              qItem.stemLines.push(stemLine);
            }
          }

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
              if (isElementFullyStyledCorrect(optLi)) {
                qItem.styledKeyCandidates.push(letter);
              }
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
      const looksLikeInlineCompleteQuestions = liNodes.some((li) => {
        const t = extractElementPlainLines(li, true);
        return /(?:^|[\s\n])\*?\s*A\s*[.)]\s*[\s\S]+(?:^|[\s\n])\*?\s*B\s*[.)]/i.test(t);
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
      const ulItemsLookLikeOptions =
        tag === 'UL' &&
        liNodes.every((li) =>
          /^\s*\*?\s*[A-Ea-e]\s*[.)]\s+/.test(extractElementPlainLines(li, true))
        );
      const hasExplicitQuestionNumbers =
        !isLetteredOl &&
        liNodes.some((li) =>
          Boolean(matchQuestionStart(collapseInlineSpaces(extractElementPlainLines(li, true))))
        );
      const canAttachAsOptionsToCurrent =
        Boolean(current) &&
        current !== null &&
        Object.keys(current.options).length === 0 &&
        !looksLikeInlineCompleteQuestions &&
        !hasExplicitQuestionNumbers &&
        liNodes.length >= 2 &&
        liNodes.length <= 5 &&
        (isLetteredOl || tag === 'OL' || ulItemsLookLikeOptions);

      if (canAttachAsOptionsToCurrent && current) {
        liNodes.slice(0, 5).forEach((optLi, optIdx) => {
          const rawOpt = collapseInlineSpaces(extractElementPlainLines(optLi, true));
          const strippedOpt = stripLeadingOptionPrefixFromOlItem(rawOpt);
          const { text: optText, isMarkedCorrect } =
            cleanOptionBodyAndMarkers(strippedOpt);
          const letter = OPTION_KEYS[optIdx];
          current!.options[letter] = optText;
          if (isMarkedCorrect) current!.explicitKey = letter;
          if (isElementFullyStyledCorrect(optLi)) {
            current!.styledKeyCandidates.push(letter);
          }
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
        const hasInlineOpts =
          /(?:^|[\s\n])\*?\s*A\s*[.)]\s*[\s\S]+(?:^|[\s\n])\*?\s*B\s*[.)]/i.test(liText);

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
            styledKeyCandidates: [],
          };
          const first = stripLeadingQuestionPrefix(lines[0]);
          const firstSegments = first.cleanText
            ? splitInlineOptionsInLine(first.cleanText, false)
            : [];
          parseInlineLinesIntoQuestion([...firstSegments, ...lines.slice(1)], qNum);
          startedQuestions = true;
        } else {
          const { explicitNum, cleanText } = stripLeadingQuestionPrefix(liText);
          const qNum = explicitNum ?? ++autoQuestionNum;
          autoQuestionNum = qNum;
          current = {
            questionNumber: qNum,
            stemLines: [],
            options: {},
            currentOpt: null,
            explicitKey: null,
            styledKeyCandidates: [],
          };
          for (const sLine of cleanText.split('\n').filter(Boolean)) {
            const inlineKey = extractSingleKeyFromLine(sLine);
            if (inlineKey) {
              current.explicitKey = inlineKey;
            } else {
              current.stemLines.push(sLine);
            }
          }
          startedQuestions = true;
        }
      }
      continue;
    }

    // Tabel soal di dalam Word (.docx)
    if (tag === 'TABLE') {
      const parsedTable = tryExtractQuestionTableLines(el);
      if (parsedTable.mode === 'structured' && parsedTable.structured) {
        pushCurrent();
        for (const rowQ of parsedTable.structured) {
          const qNum = rowQ.questionNumber ?? ++autoQuestionNum;
          autoQuestionNum = qNum;
          items.push({
            questionNumber: qNum,
            stemLines: rowQ.stem.split('\n').filter(Boolean),
            options: rowQ.options,
            currentOpt: null,
            explicitKey: rowQ.explicitKey,
            styledKeyCandidates: [],
          });
        }
        startedQuestions = true;
        continue;
      }
      if (parsedTable.lines && parsedTable.lines.length > 0) {
        parseInlineLinesIntoQuestion(parsedTable.lines);
        continue;
      }
    }

    // Node <p>, <h*>, <div> di dalam area soal
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
          const m = matchQuestionStart(nextPlain);
          return Boolean(m && m.num === 1 && m.rest.length > 0);
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

    const styledHint =
      lines.length === 1 && OPT_RE.test(lines[0]) && isElementFullyStyledCorrect(el)
        ? ('A' as CbtOptionKey)
        : null;
    parseInlineLinesIntoQuestion(lines, undefined, styledHint);
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

function stripBasicRtf(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/gi, '\n')
    .replace(/\\line\b/gi, '\n')
    .replace(/\\tab\b/gi, ' ')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\{\\\*\\[^}]*\}/g, '')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .trim();
}

async function parseDocxBufferQuestions(
  buffer: ArrayBuffer,
  examId: string
): Promise<ParsedQuestionDraft[]> {
  let htmlParsed: ParsedQuestionDraft[] = [];
  try {
    const res = await mammoth.convertToHtml(
      { arrayBuffer: buffer },
      { styleMap: ['u => u', 'highlight => mark'] }
    );
    htmlParsed = parseDocxHtmlQuestions(res.value || '', examId);
  } catch {
    htmlParsed = [];
  }
  let rawParsed: ParsedQuestionDraft[] = [];
  try {
    const fallbackRaw = await mammoth.extractRawText({ arrayBuffer: buffer });
    rawParsed = parseQuestionsFromRawText(fallbackRaw.value || '', examId);
  } catch {
    rawParsed = [];
  }
  if (htmlParsed.length === 0) return rawParsed;
  if (rawParsed.length > htmlParsed.length) {
    const scoreParsed = (list: ParsedQuestionDraft[]) =>
      list.reduce((acc, q) => {
        const filledOpts = [q.opsiA, q.opsiB, q.opsiC, q.opsiD].filter(
          (o) => o.trim() !== ''
        ).length;
        return acc + (filledOpts >= 4 ? 10 : filledOpts >= 2 ? 5 : 1) + (q.keyExplicit ? 1 : 0);
      }, 0);
    if (scoreParsed(rawParsed) > scoreParsed(htmlParsed)) {
      return rawParsed;
    }
  }
  return htmlParsed;
}

export async function parseWordOrTextFileQuestions(
  file: File,
  examId: string
): Promise<ParsedQuestionDraft[]> {
  const buffer = await readFileAsArrayBufferSafe(file);
  if (!buffer || buffer.byteLength === 0) {
    throw new Error(
      'File kosong atau belum terunduh ke penyimpanan HP. Pastikan file tersedia offline lalu coba pilih ulang.'
    );
  }

  const kind = detectFileKindFromBytes(file, buffer);
  if (kind === 'pdf') {
    throw new Error(
      'File PDF belum didukung untuk upload langsung. Salin teks soal dari PDF lalu tempelkan ke kotak "Copy-Paste Soal", atau konversi ke .docx terlebih dahulu.'
    );
  }
  if (kind === 'xlsx') {
    const wb = XLSX.read(buffer, { type: 'array' });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) return [];
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1, defval: '' }) as any[][];
    return parseSpreadsheetMatrix(matrix, examId);
  }
  if (kind === 'xls') {
    try {
      const wb = XLSX.read(buffer, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      if (firstSheet) {
        const matrix = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1, defval: '' }) as any[][];
        const parsedXls = parseSpreadsheetMatrix(matrix, examId);
        if (parsedXls.length > 0) return parsedXls;
      }
    } catch {
      // Lanjut ke pesan .doc jika bukan file Excel valid
    }
    throw new Error(
      'Format Word lama (.doc) tidak dapat dibaca langsung. Buka file di Word/WPS lalu simpan ulang sebagai "Word Document (.docx)" atau copy-paste ke kotak Copy-Paste Soal.'
    );
  }
  if (kind === 'doc') {
    throw new Error(
      'Format Word lama (.doc) tidak dapat dibaca langsung. Buka file di Word/WPS lalu simpan ulang sebagai "Word Document (.docx)" atau copy-paste ke kotak Copy-Paste Soal.'
    );
  }
  if (kind === 'docx') {
    return parseDocxBufferQuestions(buffer, examId);
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buffer));
  if (kind === 'rtf') {
    return parseQuestionsFromRawText(stripBasicRtf(text), examId);
  }
  if (kind === 'csv') {
    const parsedCsv = parseSpreadsheetMatrix(parseCsvTextToMatrix(text), examId);
    if (parsedCsv.length > 0) return parsedCsv;
  }
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
