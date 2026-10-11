/**
 * Syntax highlighting for the wiki's code, after Blinc's code widget: each language is a list of
 * rules, each a pattern and the kind of token it finds. On a line, every rule's matches are sorted
 * by where they start, the first wins where they overlap, and the gaps between are plain text.
 * Unlike a line-at-a-time highlighter, block comments and template strings carry across lines.
 */

export type TokenKind =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'type'
  | 'function'
  | 'property'
  | 'tag'
  | 'punctuation';

export type Language = 'ts' | 'css' | 'shell' | 'json' | 'text';

/** A piece of a line, with the kind of token it is; none for plain text. */
export interface Span {
  readonly text: string;
  readonly kind?: TokenKind;
}

interface Rule {
  readonly pattern: RegExp;
  readonly kind: TokenKind;
}

const rule = (pattern: RegExp, kind: TokenKind): Rule => ({
  pattern: new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g',
  ),
  kind,
});

const tsKeywords =
  /\b(?:import|export|from|as|default|const|let|var|function|return|if|else|for|of|in|while|do|switch|case|break|continue|new|class|extends|implements|interface|type|enum|namespace|declare|readonly|public|private|protected|static|async|await|yield|try|catch|finally|throw|typeof|keyof|instanceof|void|this|super|null|undefined|true|false)\b/;

const rules: Record<Language, readonly Rule[]> = {
  ts: [
    rule(/\/\/.*$/, 'comment'),
    rule(/\/\*.*?\*\//, 'comment'),
    rule(/'(?:[^'\\]|\\.)*'/, 'string'),
    rule(/"(?:[^"\\]|\\.)*"/, 'string'),
    rule(/`(?:[^`\\]|\\.)*`/, 'string'),
    rule(/<\/?[A-Za-z][\w.]*/, 'tag'),
    // A JSX attribute, before a keyword of the same name: class="…".
    rule(/\b[a-zA-Z_$][\w$-]*(?==)/, 'property'),
    rule(tsKeywords, 'keyword'),
    rule(/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?n?\b|\b0x[\da-f]+\b/i, 'number'),
    rule(/\b[A-Z][A-Za-z0-9_]*\b/, 'type'),
    rule(/\b[a-zA-Z_$][\w$]*(?=\s*\()/, 'function'),
    rule(/[{}()[\];,.<>]/, 'punctuation'),
  ],
  css: [
    rule(/\/\*.*?\*\//, 'comment'),
    rule(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/, 'string'),
    rule(/@[\w-]+/, 'keyword'),
    rule(/--[\w-]+/, 'property'),
    rule(/\b[a-z-]+(?=\s*:(?!:?[a-z-]+\s*[,{(]))/, 'property'),
    // A colour before a selector: #fff is a value, #main a selector.
    rule(/#[\da-fA-F]{3,8}\b(?![\w-])/, 'number'),
    rule(/[.#][\w-]+/, 'type'),
    rule(/::?[\w-]+/, 'keyword'),
    rule(/-?\b\d+(?:\.\d+)?(?:px|em|rem|%|ms|s|deg|vw|vh)?\b/, 'number'),
    rule(/\b[a-z-]+(?=\()/, 'function'),
    rule(/!important\b/, 'keyword'),
    rule(/[{}()[\];,:>+~]/, 'punctuation'),
  ],
  shell: [
    rule(/#.*$/, 'comment'),
    rule(/'[^']*'|"(?:[^"\\]|\\.)*"/, 'string'),
    rule(/^\s*[\w./-]+/, 'function'),
    rule(/\s--?[\w-]+/, 'property'),
  ],
  json: [
    rule(/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'property'),
    rule(/"(?:[^"\\]|\\.)*"/, 'string'),
    rule(/\b(?:true|false|null)\b/, 'keyword'),
    rule(/-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i, 'number'),
    rule(/[{}[\],:]/, 'punctuation'),
  ],
  text: [],
};

/** The language a file is written in, by its name. */
export function languageOf(file: string): Language {
  if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
    return 'ts';
  }
  if (file.endsWith('.css')) {
    return 'css';
  }
  if (file.endsWith('.json')) {
    return 'json';
  }
  if (/\.(?:sh|bash|zsh)$/.test(file)) {
    return 'shell';
  }
  return 'text';
}

/** One line, by the rules: matches sorted by start, the first winning where they overlap. */
function line(text: string, ruleset: readonly Rule[]): Span[] {
  const found: { start: number; end: number; kind: TokenKind }[] = [];
  for (const { pattern, kind } of ruleset) {
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) {
      if (m[0].length > 0) {
        found.push({ start: m.index, end: m.index + m[0].length, kind });
      }
    }
  }
  // A stable sort keeps the earlier rule first among matches that start together.
  found.sort((a, b) => a.start - b.start);
  const spans: Span[] = [];
  let at = 0;
  for (const m of found) {
    if (m.start < at) {
      continue;
    }
    if (m.start > at) {
      spans.push({ text: text.slice(at, m.start) });
    }
    spans.push({ text: text.slice(m.start, m.end), kind: m.kind });
    at = m.end;
  }
  if (at < text.length) {
    spans.push({ text: text.slice(at) });
  }
  return spans;
}

/** Where a token that runs past the end of a line ends, and what it is meanwhile. */
const carried: Partial<
  Record<Language, readonly { open: string; close: string; kind: TokenKind }[]>
> = {
  ts: [
    { open: '/*', close: '*/', kind: 'comment' },
    { open: '`', close: '`', kind: 'string' },
  ],
  css: [{ open: '/*', close: '*/', kind: 'comment' }],
};

/** `code` in `language`, line by line. */
export function highlight(code: string, language: Language): Span[][] {
  const ruleset = rules[language];
  const spans = carried[language] ?? [];
  const out: Span[][] = [];
  let open: { close: string; kind: TokenKind } | undefined;
  for (const text of code.split('\n')) {
    let rest = text;
    const lineSpans: Span[] = [];
    if (open) {
      const end = rest.indexOf(open.close);
      if (end < 0) {
        out.push(rest ? [{ text: rest, kind: open.kind }] : []);
        continue;
      }
      lineSpans.push({ text: rest.slice(0, end + open.close.length), kind: open.kind });
      rest = rest.slice(end + open.close.length);
      open = undefined;
    }
    let pieces = line(rest, ruleset);
    // A token opened outside a string or comment, and not closed on this line, carries on.
    let carry: (typeof spans)[number] | undefined;
    let cut = -1;
    let offset = 0;
    for (const piece of pieces) {
      if (piece.kind !== 'string' && piece.kind !== 'comment') {
        for (const c of spans) {
          const i = piece.text.indexOf(c.open);
          const at = offset + i;
          if (i >= 0 && rest.indexOf(c.close, at + c.open.length) < 0 && (cut < 0 || at < cut)) {
            cut = at;
            carry = c;
          }
        }
      }
      if (cut >= 0) {
        break;
      }
      offset += piece.text.length;
    }
    if (carry) {
      pieces = [...line(rest.slice(0, cut), ruleset), { text: rest.slice(cut), kind: carry.kind }];
    }
    lineSpans.push(...pieces);
    out.push(lineSpans);
    open = carry;
  }
  return out;
}
