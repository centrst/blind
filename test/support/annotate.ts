/** The corpus annotation format: `{{kind:value}}` inline, `%known kind|value` lines on top. */
import type { KnownValue } from '../../src/types.js';

export interface AnnSpan {
  kind: string;
  value: string;
  /** Offsets in the stripped text. */
  start: number;
  end: number;
}

export interface Annotated {
  text: string;
  spans: AnnSpan[];
  /** The owner's own values from the `%known` header lines. */
  known: KnownValue[];
  /** How numeric dates like 03/04/2026 are read. From a `%order` header line, default dmy. */
  dateOrder: 'dmy' | 'mdy';
}

const ANN = /\{\{([a-z]+):([^{}]*?)\}\}/g;

export function parseAnnotated(src: string): Annotated {
  const known: KnownValue[] = [];
  let dateOrder: 'dmy' | 'mdy' = 'dmy';
  const lines = src.split('\n');
  let i = 0;
  while (i < lines.length && /^%(known|order) /.test(lines[i] as string)) {
    const line = lines[i] as string;
    if (line.startsWith('%order ')) dateOrder = line.slice(7).trim() === 'mdy' ? 'mdy' : 'dmy';
    else {
      const [kind, ...rest] = line.slice(7).split('|');
      known.push({ kind: kind as KnownValue['kind'], value: rest.join('|') });
    }
    i++;
  }
  const body = lines.slice(i).join('\n');
  let text = '';
  let at = 0;
  const spans: AnnSpan[] = [];
  for (const m of body.matchAll(ANN)) {
    text += body.slice(at, m.index);
    const start = text.length;
    text += m[2] as string;
    spans.push({ kind: m[1] as string, value: m[2] as string, start, end: text.length });
    at = m.index! + m[0].length;
  }
  text += body.slice(at);
  return { text, spans, known, dateOrder };
}

export const ann = (kind: string, value: string): string => `{{${kind}:${value}}}`;
