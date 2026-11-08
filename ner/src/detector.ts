import { BlindError, builtinDetectors, foldLookalikes, knownDetector, type DetectContext, type Detector, type Kind, type Span } from '@centrst/blind';
import type { RawEntity } from './gliner.js';

/** What the detector needs from a model. `GlinerModel` fits it, and tests pass a stub. */
export interface NerBackend {
  predict(text: string, labels: string[], opts?: { threshold?: number }): Promise<RawEntity[]>;
}

export type NerKind = Extract<Kind, 'person' | 'org' | 'place'>;

export interface NerDetectorOptions {
  /** Label sent to the model for each kind, and the kinds to report. Default person, organization, location. */
  labels?: Partial<Record<NerKind, string>>;
  /** Minimum score for a span. Default 0.3. */
  threshold?: number;
  /** Priority against other detectors. Default 50, below every pattern detector and below `known`. */
  priority?: number;
  /**
   * Also mark later bare mentions of a person the model or a header line already named,
   * so "Pilar Gómez" in a header covers "Pilar" in the greeting. Default true.
   */
  propagate?: boolean;
}

export const DEFAULT_LABELS: Record<NerKind, string> = { person: 'person', org: 'organization', place: 'location' };

/** Kinds the pattern detectors own. A NER span never overlaps one of these. */
const STRUCTURED = new Set<Kind>(['email', 'url', 'iban', 'phone', 'id', 'amount', 'date']);

const INVISIBLE = /[\u200b-\u200f\u2060\ufeff\u202a-\u202e]/;
const ORG_SUFFIX_ONLY = /^(?:S\.?L\.?U?\.?|S\.?A\.?|S\.?L\.?P\.?|Inc\.?|LLC|Ltd\.?|GmbH|Corp\.?|B\.?V\.?)$/i;
const PUNCT = String.raw`\s,.;:!?()\[\]<>"'\x60´«»“”‘’…*_\-\u2013\u2014/\\|`;
const LEAD = new RegExp(`^[${PUNCT}]+`, 'u');
const TRAIL = new RegExp(`[${PUNCT}]+$`, 'u');
const NAME_STOP = new Set([
  'de', 'del', 'la', 'las', 'los', 'van', 'von', 'da', 'di', 'y', 'e', 'el', 'the', 'and',
  'hola', 'hello', 'dear', 'estimado', 'estimada', 'gracias', 'thanks', 'saludos', 'regards', 'cheers', 'from', 'subject', 'date',
]);
const NAME_TOKEN = /^\p{Lu}[\p{L}'’\-]{2,}$/u;
const LEADING_TITLE = /^(?:estimad[oa]s?|dear|hola|hello|hi|hey|querid[oa]|sr|sra|srta|mr|mrs|ms|miss|dr|dra|don|doña|dña)\.?\s+/iu;

/** Same text with invisible characters removed, and the map from each kept index back to the original. */
function stripForModel(text: string): { clean: string; from: number[] } {
  let clean = '';
  const from: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (INVISIBLE.test(ch)) continue;
    clean += ch;
    from.push(i);
  }
  return { clean, from };
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;

/**
 * `[start, end)` without the letters it shares a word with a known span on
 * either side: where a known span ends at `start`, or starts at `end`, with a
 * letter on both sides of the contact, the run of letters next to it goes.
 */
function unglued(text: string, start: number, end: number, known: Span[]): [number, number] {
  const glued = (at: number): boolean => WORD_CHAR.test(text[at - 1] ?? '') && WORD_CHAR.test(text[at] ?? '');
  let s = start;
  let e = end;
  if (glued(s) && known.some((k) => k.end === s)) while (s < e && WORD_CHAR.test(text[s] as string)) s++;
  if (glued(e) && known.some((k) => k.start === e)) while (e > s && WORD_CHAR.test(text[e - 1] as string)) e--;
  return [s, e];
}

/** Subtracts ranges from [start, end) and returns what is left. */
function subtract(start: number, end: number, cuts: Array<[number, number]>): Array<[number, number]> {
  let pieces: Array<[number, number]> = [[start, end]];
  for (const [cs, ce] of cuts) {
    const next: Array<[number, number]> = [];
    for (const [s, e] of pieces) {
      if (ce <= s || cs >= e) next.push([s, e]);
      else {
        if (cs > s) next.push([s, cs]);
        if (ce < e) next.push([ce, e]);
      }
    }
    pieces = next;
  }
  return pieces;
}

/**
 * Later bare mentions of names already found. A token counts when it is
 * capitalised, not a particle or greeting, and the text never writes it in
 * lower case (which would make it an ordinary word).
 */
function bareMentions(text: string, named: Span[], taken: Array<[number, number]>, structured: Array<[number, number]>, priority: number): Span[] {
  const tokens = new Set<string>();
  for (const sp of named) {
    for (const raw of text.slice(sp.start, sp.end).split(/\s+/u)) {
      const tok = raw.replace(LEAD, '').replace(TRAIL, '');
      if (NAME_TOKEN.test(tok) && !NAME_STOP.has(tok.toLowerCase())) tokens.add(tok);
    }
  }
  const lowered = text.toLowerCase();
  if (lowered.length !== text.length) return []; // a few letters change length when lowered, and the offsets below would drift
  const usable = [...tokens].filter((t) => {
    const lower = t.toLowerCase();
    for (let from = 0; ; ) {
      const i = lowered.indexOf(lower, from);
      if (i < 0) return true;
      from = i + 1;
      const around = /[\p{L}\p{N}_]/u;
      if (around.test(lowered[i - 1] ?? ' ') || around.test(lowered[i + lower.length] ?? ' ')) continue;
      if (structured.some(([a, b]) => i >= a && i < b)) continue; // an address or URL may hold the name in lower case
      if (text.slice(i, i + lower.length) === lower) return false; // written in lower case somewhere
    }
  });
  if (usable.length === 0) return [];
  const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:${usable.sort((a, b) => b.length - a.length).map(esc).join('|')})(?![\p{L}\p{N}_])`, 'gu');
  const out: Span[] = [];
  for (const m of text.matchAll(re)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (taken.some(([ts, te]) => start < te && ts < end)) continue;
    out.push({ start, end, kind: 'person', priority });
  }
  return out;
}

export interface NerDetector {
  /**
   * Runs the model over `texts` and returns a synchronous `Detector` for `blind`.
   * `blind` finds spans synchronously, and a model call is async, so the model
   * runs here, once per text, and the detector replays the result.
   */
  prepare(texts: string[]): Promise<Detector>;
}

export function createNerDetector(backend: NerBackend, opts: NerDetectorOptions = {}): NerDetector {
  const labels = { ...DEFAULT_LABELS, ...opts.labels };
  const kinds = (Object.keys(DEFAULT_LABELS) as NerKind[]).filter((k) => labels[k]);
  const kindOf = new Map(kinds.map((k) => [labels[k], k] as const));
  const priority = opts.priority ?? 50;
  const threshold = opts.threshold ?? 0.3;
  const propagate = opts.propagate ?? true;

  return {
    async prepare(texts) {
      // `blind` shows detectors the same-length fold of each text, so the cache is keyed by that.
      const cache = new Map<string, Array<{ start: number; end: number; kind: NerKind }>>();
      for (const raw of texts) {
        const folded = foldLookalikes(raw);
        if (cache.has(folded)) continue;
        const { clean, from } = stripForModel(folded);
        const found = await backend.predict(clean, kinds.map((k) => labels[k]), { threshold });
        const spans: Array<{ start: number; end: number; kind: NerKind }> = [];
        for (const e of found) {
          const kind = kindOf.get(e.label);
          if (!kind || e.end <= e.start) continue;
          const start = from[e.start];
          const last = from[e.end - 1];
          if (start === undefined || last === undefined) continue;
          spans.push({ start, end: last + 1, kind });
        }
        cache.set(folded, spans);
      }
      return {
        name: 'ner',
        detect(text: string, ctx: DetectContext): Span[] {
          const hits = cache.get(text);
          // Silence here would let every name through. The message carries no text.
          if (!hits) throw new BlindError('detector-not-prepared', 'ner: this text was not prepared. Call prepare(texts) with every text first');
          if (hits.length === 0) return [];
          // Pattern spans win on overlap for structured kinds, and a known value wins over
          // everything, so cut both out of each NER span rather than lose the whole span.
          const pattern = builtinDetectors.flatMap((d) => d.detect(text, ctx));
          const known = ctx.known?.length ? knownDetector(ctx.known).detect(text, ctx) : [];
          const cuts: Array<[number, number]> = [...pattern.filter((s) => STRUCTURED.has(s.kind)), ...known].map((s) => [s.start, s.end]);
          const out: Span[] = [];
          for (const h of hits) {
            for (const [c0, c1] of subtract(h.start, h.end, cuts)) {
              // The rest of a word glued onto a known value (`우리팀김민수님도` around a known `김민수`)
              // stays with the text around the known value, never a span of its own: two fakes
              // written flush against each other would not map back.
              const [s0, e0] = unglued(text, c0, c1, known);
              if (e0 <= s0) continue;
              const body = text.slice(s0, e0);
              let s = s0 + (LEAD.exec(body)?.[0].length ?? 0);
              const e = s0 + body.replace(TRAIL, '').length;
              if (h.kind === 'person') {
                const t = LEADING_TITLE.exec(text.slice(s, e));
                if (t) s += t[0].length;
              }
              if (s0 > h.start) {
                // What is left after a cut: drop leading particles ("de Gestoría Norte") and a bare legal suffix.
                for (;;) {
                  const m = /^(\S+)\s+/u.exec(text.slice(s, e));
                  if (!m || !NAME_STOP.has((m[1] as string).toLowerCase())) break;
                  s += m[0].length;
                }
                if (ORG_SUFFIX_ONLY.test(text.slice(s, e))) continue;
              }
              if (e - s < 2 || !/\p{L}/u.test(text.slice(s, e))) continue;
              out.push({ start: s, end: e, kind: h.kind, priority });
            }
          }
          if (propagate) {
            const named = [...out, ...pattern].filter((s) => s.kind === 'person');
            out.push(...bareMentions(text, named, [...cuts, ...out.map((s): [number, number] => [s.start, s.end])], cuts, priority - 1));
          }
          return out;
        },
      };
    },
  };
}
