/**
 * A small syntax highlighter for code blocks: comments, strings, numbers, keywords
 * and the rest. Not a parser — it colours what a reader scans for, for the languages
 * people paste into a whiteboard, without a highlighting library's weight.
 */
export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'punct';

export interface Token {
  kind: TokenKind;
  text: string;
}

export const LANGUAGES = [
  'auto',
  'javascript',
  'python',
  'sql',
  'css',
  'html',
  'json',
  'plain',
] as const;
export type Language = (typeof LANGUAGES)[number];

const KEYWORDS: Record<string, ReadonlySet<string>> = {
  javascript: new Set(
    'const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this null undefined true false interface type enum implements public private protected readonly static yield void delete'.split(
      ' ',
    ),
  ),
  python: new Set(
    'def return if elif else for while in not and or is import from as class try except finally raise with lambda yield pass break continue None True False async await global nonlocal assert del print self'.split(
      ' ',
    ),
  ),
  sql: new Set(
    'select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit offset as distinct union all null is in like between case when then else end primary key references index'.split(
      ' ',
    ),
  ),
  css: new Set('important media keyframes from to and not only screen'.split(' ')),
  html: new Set<string>(),
  json: new Set(['true', 'false', 'null']),
  plain: new Set<string>(),
};

/** A guess good enough to colour by, when nobody said which language it is. */
export function detectLanguage(code: string): Exclude<Language, 'auto'> {
  const sample = code.slice(0, 2000);
  if (/^\s*[[{]/.test(sample) && /"\s*:/.test(sample)) return 'json';
  if (/^\s*</.test(sample) && /<\/?[a-z][\s\S]*>/i.test(sample)) return 'html';
  if (/\b(select|insert|update|delete)\b[\s\S]*\b(from|into|set)\b/i.test(sample)) return 'sql';
  if (/\bdef \w+\(|^\s*import \w+$|:\s*$/m.test(sample) && !/[;{}]\s*$/m.test(sample)) {
    return 'python';
  }
  if (/[.#]?[\w-]+\s*\{[^}]*:[^}]*;/.test(sample) && !/\bfunction\b|=>/.test(sample)) return 'css';
  return 'javascript';
}

const commentStart = (language: string) =>
  language === 'python'
    ? /^#.*/
    : language === 'sql'
      ? /^--.*/
      : language === 'html'
        ? /^<!--[\s\S]*?(-->|$)/
        : /^\/\/.*/;

/** Tokens for one line. Multi-line strings and comments are coloured line by line. */
export function tokenizeLine(line: string, language: Exclude<Language, 'auto'>): Token[] {
  const tokens: Token[] = [];
  const keywords = KEYWORDS[language] ?? KEYWORDS.plain!;
  const push = (kind: TokenKind, text: string) => {
    const last = tokens.at(-1);
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ kind, text });
  };
  if (language === 'plain') return [{ kind: 'plain', text: line }];

  let rest = line;
  while (rest.length > 0) {
    let match: RegExpExecArray | null;
    if (
      (match = commentStart(language).exec(rest)) ||
      (language !== 'python' && (match = /^\/\*.*?(\*\/|$)/.exec(rest)))
    ) {
      push('comment', match[0]);
    } else if ((match = /^("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)/.exec(rest))) {
      push('string', match[0]);
    } else if ((match = /^(0x[\da-f]+|\d+(\.\d+)?(e[+-]?\d+)?)/i.exec(rest))) {
      push('number', match[0]);
    } else if ((match = /^[A-Za-z_$][\w$-]*/.exec(rest))) {
      const word = match[0];
      const isKeyword = keywords.has(language === 'sql' ? word.toLowerCase() : word);
      push(isKeyword ? 'keyword' : 'plain', word);
    } else if ((match = /^[{}()[\];,.:=+\-*/<>!&|?%^~@]+/.exec(rest))) {
      push('punct', match[0]);
    } else {
      match = /^\s+|^./.exec(rest)!;
      push('plain', match[0]);
    }
    rest = rest.slice(match[0].length);
  }
  return tokens;
}

/** Colours that read on the code block's dark background, in either theme. */
export const TOKEN_COLORS: Record<TokenKind, string> = {
  plain: '#e4e6f0',
  keyword: '#c792ea',
  string: '#c3e88d',
  comment: '#7f849c',
  number: '#f78c6c',
  punct: '#89ddff',
};
