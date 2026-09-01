import { sanitizeLodyInternalInstructions } from './goal';

export const TITLE_SOURCE_MAX_CHARS = 4_000;
export const DRAFT_SESSION_TITLE_MAX_CHARS = 50;

const XML_OR_HTML_TAG = /<\/?[a-zA-Z_][\w:.-]*\b[^>]*>/g;
const PATH_ONLY_LINE = /^(?:[~.]{0,2}\/|[A-Za-z]:[\\/]|\\\\)[\w.@+\- /\\]+(?:\.[A-Za-z0-9]+)?$/;
const UUID_ONLY_LINE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELAY_PREFIX = /^(?:[〈《<\[]接力[〉》>\]])\s*/u;
const AGENT_INITIAL_PREFIX = /^(?:cu|ag|cc|cx|cl|km|gk|ds)\s*[:：]\s*/i;
const LEADING_TITLE_DECORATION = /^[#＃:：]+\s*/;
const GENERIC_PLACEHOLDER_TITLE =
  /^(?:no coding task(?: yet)?|user greeting|greeting|files mentioned(?: by(?: the)?(?: use(?:r)?)?)?|new (?:session|chat|tab|conversation)|untitled(?: session)?|hello(?: there)?|hi(?: there)?|hey)$/i;

/** Strip imported relay prefixes (`〈接力〉cu:`), agent initials, and leading `#` / `：`. */
export const stripSessionTitleDecorations = (raw: string): string => {
  let text = raw.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i += 1) {
    const next = text
      .replace(RELAY_PREFIX, '')
      .replace(AGENT_INITIAL_PREFIX, '')
      .replace(LEADING_TITLE_DECORATION, '')
      .trim();
    if (next === text) break;
    text = next;
  }
  return text;
};

export const isGenericPlaceholderTitle = (candidate: string): boolean =>
  GENERIC_PLACEHOLDER_TITLE.test(candidate.trim());

const isNoisyTitleLine = (line: string): boolean => {
  if (/^you are\b/i.test(line)) return true;
  if (/^the following are (?:system|internal|private)\b/i.test(line)) return true;
  if (/^do not (?:disclose|follow|answer)\b/i.test(line)) return true;
  if (/^@[\w./:@-]+$/.test(line)) return true;
  if (PATH_ONLY_LINE.test(line)) return true;
  if (UUID_ONLY_LINE.test(line)) return true;
  if (/^\{\s*['"]?(?:type|status|error)['"]?\s*:/i.test(line)) return true;
  return false;
};

export const isNoisySessionTitle = (candidate: string): boolean => {
  const trimmed = candidate.trim();
  if (!trimmed) return true;
  if (RELAY_PREFIX.test(trimmed) || /[〈《<\[]接力[〉》>\]]/.test(trimmed)) return true;
  if (isGenericPlaceholderTitle(trimmed)) return true;
  if (/<\/?[a-zA-Z_][\w:.-]*[\s/>]/.test(trimmed)) return true;
  if (/^\{\s*['"]/.test(trimmed)) return true;
  if (/^(?:you are|the following are (?:system|internal))\b/i.test(trimmed)) return true;
  if (/^(?:error|warning|failed|failure|http\s+[45]\d\d)\b/i.test(trimmed)) return true;
  if (PATH_ONLY_LINE.test(trimmed) || UUID_ONLY_LINE.test(trimmed)) return true;
  const lettersAndDigits = trimmed.replace(/[^\p{L}\p{N}]+/gu, '');
  if (lettersAndDigits.length < 2) return true;
  if (trimmed.length > 12 && lettersAndDigits.length / trimmed.length < 0.3) return true;
  return false;
};

/** User-facing task text for isolated title generation. Strips role/system noise. */
export const extractTitleSourceText = (raw: string, maxChars = TITLE_SOURCE_MAX_CHARS): string => {
  const withoutInternal = sanitizeLodyInternalInstructions(raw);
  const withoutTags = withoutInternal.replace(XML_OR_HTML_TAG, ' ');
  const lines = withoutTags
    .split(/\r?\n/)
    .map((line) => stripSessionTitleDecorations(line))
    .filter((line) => line.length > 0);
  const meaningful = lines.filter((line) => !isNoisyTitleLine(line));
  const source = meaningful.join('\n').trim();
  if (!source) return '';
  if (source.length <= maxChars) return source;
  return source.slice(0, maxChars).trimEnd();
};

/** Short sidebar/tab label reconstructed from a raw prompt. Never returns dump text. */
export const extractDraftSessionTitle = (
  raw: string,
  maxChars = DRAFT_SESSION_TITLE_MAX_CHARS
): string | null => {
  const source = extractTitleSourceText(raw, Math.max(maxChars * 4, 240));
  if (!source) return null;
  const firstLine = source
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim();
  if (!firstLine) return null;
  const phrase = stripSessionTitleDecorations(
    firstLine.split(/(?<=[.!?。！？])\s+/)[0] ?? firstLine
  );
  const title = phrase.slice(0, maxChars).trim();
  if (!title || isNoisySessionTitle(title) || isGenericPlaceholderTitle(title)) return null;
  return title;
};

/** Sidebar/tab display: strip stored decorations, hide placeholders, reconstruct dumps. */
export const displaySessionTitle = (title: string | undefined, fallback: string): string => {
  const stripped = stripSessionTitleDecorations(title ?? '');
  if (!stripped) return fallback;
  if (!isNoisySessionTitle(stripped) && !isGenericPlaceholderTitle(stripped)) return stripped;
  return extractDraftSessionTitle(stripped, 80) ?? fallback;
};
