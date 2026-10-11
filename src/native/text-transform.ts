/** Presentational Unicode casing, with source-to-display UTF-16 positions for editing. */
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

export function textTransform(value: string): TextTransform | undefined {
  switch (value.trim().toLowerCase()) {
    case 'none':
      return 'none';
    case 'uppercase':
      return 'uppercase';
    case 'lowercase':
      return 'lowercase';
    case 'capitalize':
      return 'capitalize';
    default:
      return undefined;
  }
}

const words = new Intl.Segmenter('und', { granularity: 'word' });
const titlecase: Readonly<Record<string, string>> = {
  ǆ: 'ǅ',
  ǉ: 'ǈ',
  ǌ: 'ǋ',
  ǳ: 'ǲ',
};

export interface TransformedText {
  readonly text: string;
  /** Each source UTF-16 position in display text; inside a surrogate pair snaps to its start. */
  readonly offsets: readonly number[];
}

export function transformText(source: string, mode: TextTransform): TransformedText {
  const starts = new Set<number>();
  if (mode === 'capitalize') {
    for (const word of words.segment(source)) {
      if (word.isWordLike) {
        starts.add(word.index);
      }
    }
  }
  const offsets = [0];
  let text = '';
  let index = 0;
  for (const character of source) {
    for (let i = 0; i < character.length; i++) {
      offsets[index + i] = text.length;
    }
    let shown = character;
    if (mode === 'uppercase') {
      shown = character.toUpperCase();
    } else if (mode === 'lowercase') {
      shown = character.toLowerCase();
    } else if (starts.has(index) && character === character.toLowerCase()) {
      const [first = '', ...rest] = character.toUpperCase();
      shown = titlecase[character] ?? first + rest.join('').toLowerCase();
    }
    text += shown;
    index += character.length;
    offsets[index] = text.length;
  }
  // Whole-string lowercasing preserves contextual forms such as Greek final sigma.
  return { text: mode === 'lowercase' ? source.toLowerCase() : text, offsets };
}
