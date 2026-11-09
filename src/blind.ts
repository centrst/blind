import { AmountPlan, amountKey, detectPercents, freeAmountFake, parseNumber, type AmountOcc } from './amounts.js';
import { dateKey, freeDateFake, shiftOcc, type DateOcc } from './dates.js';
import { builtinDetectors, callerDetector, checkKnown, findSpans, knownDetector, knownPart, lowerCasePart, oneLetterPart, personTokens, stopWordValue } from './detect.js';
import { foldLookalikes, skeleton, stripInvisible } from './fold.js';
import type { IdMeta } from './ids.js';
import { TextLanguage, type Lang } from './language.js';
import { checkLeaks, denyDomains, shortTextLeaks, type Original } from './leaks.js';
import { AT_SRC, DEFAULT_ALLOW_DOMAINS, ORG_SUFFIX, PARTICLES } from './names.js';
import { Rng } from './prng.js';
import { gluedPrefixBefore, unspaced } from './script.js';
import { checkMapping, collisions } from './mapping.js';
import { placeholderLiterals, Placeholders, RandomFakes, REPLACE_MODES } from './replace.js';
import { PairLog } from './pairlog.js';
import { placeholderIdentities } from './identities.js';
import { asciiLower, Surrogates } from './surrogates.js';
import type { BlindOptions, BlindResult, Collision, DetectContext, Kind, KnownKind, KnownValue, Mapping, Pair, ReplaceWith, Span } from './types.js';
import { BlindError, checkLimit, guard, InputTooLargeError, MAX_TEXT_LENGTH } from './errors.js';

/** An address up to and including its at sign, so what is left is the host. */
const THROUGH_AT = new RegExp(String.raw`^.*?${AT_SRC}`, 'i');
const GEN_ORDER: Kind[] = ['person', 'org', 'place', 'domain', 'email', 'url', 'phone', 'iban', 'id'];

const WORD_CH = /[\p{L}\p{N}\p{M}]/u;
const GLUED = /\p{scx=Hangul}/u;

/**
 * Whether one of `skeletons` (text skeletons) writes `word` as a word of its own:
 * no letter or digit right before or after it. A word of a script without word
 * spaces, or of Korean, which glues particles on, counts anywhere, and a Hebrew
 * or Arabic word counts after a glued prefix (`לדוד`).
 */
function writesWord(skeletons: readonly string[], word: string): boolean {
  const w = skeleton(foldLookalikes(word)).text;
  if (!w) return false;
  const anywhere = unspaced(w[0]) || GLUED.test(w);
  return skeletons.some((t) => {
    for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) {
      const starts = !WORD_CH.test(t[i - 1] ?? '') || gluedPrefixBefore(t, i, w);
      if (anywhere || (starts && !WORD_CH.test(t[i + w.length] ?? ''))) return true;
    }
    return false;
  });
}

/** Kinds an earlier turn's values are looked for under, as if the caller had listed them in `known`. */
const CARRIED: Partial<Record<Kind, KnownKind>> = { person: 'person', org: 'org', place: 'place', domain: 'domain', id: 'id' };

/** Draws of the factor and shift before a plan whose fakes collide with real values is kept anyway. */
const PLAN_ATTEMPTS = 32;
/** Planned amount and date fakes the draws may cost in all: a text with up to 64 gets every draw. */
const PLAN_BUDGET = 2048;
/**
 * A name found again bare comes back one span per word ("Ana", "Ruiz"). Fakes
 * map word by word, but a placeholder stands for the whole value, so in
 * `placeholder` mode words of one name next to each other become one span and
 * "Ana Ruiz" gets the same placeholder wherever it is written. Particles such
 * as "de la" join, a conjunction does not: "Bo Wen and Ana Ruiz" is two names.
 */
const CONJUNCTIONS = new Set(['and', 'y', 'e']);
function joinNames(spans: Span[], text: string): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    const gap = last ? text.slice(last.end, s.start) : '';
    const joinable = last?.kind === 'person' && s.kind === 'person' && /^[ \t]+(?:\p{L}+[ \t]+)*$/u.test(gap) &&
      gap.trim().split(/[ \t]+/).every((w) => w === '' || (PARTICLES.has(w.toLowerCase()) && !CONJUNCTIONS.has(w.toLowerCase())));
    if (last && joinable) out[out.length - 1] = { ...last, end: s.end };
    else out.push(s);
  }
  return out;
}

/** The mode of this call: the mapping's when continuing, else the option's, else `fake`. */
function replaceMode(opts: BlindOptions): ReplaceWith {
  const asked = opts.replaceWith;
  if (asked !== undefined && !REPLACE_MODES.includes(asked)) throw new BlindError('invalid-option', `blind: replaceWith must be one of ${REPLACE_MODES.join(', ')}`);
  if (!opts.mapping) return asked ?? 'fake';
  const kept = opts.mapping.replaceWith ?? 'fake';
  if (asked !== undefined && asked !== kept) {
    throw new BlindError('invalid-option', `blind: replaceWith is '${asked}' but the mapping was made with replaceWith '${kept}'. Leave replaceWith out to continue the mapping`);
  }
  return kept;
}

/**
 * Time grows about linearly with the text, but a very large one still costs
 * seconds of CPU and its memory. The limit bounds the work of one call, so an
 * oversized input fails fast with an error instead of stalling. Past the limit
 * blind refuses it before doing any work.
 */
function checkSize(texts: string[], limit: number): void {
  checkLimit('blind', limit);
  texts.forEach((t, i) => {
    if (t.length > limit) throw new InputTooLargeError(i, t.length, limit);
  });
}

/**
 * Writes the blind copy of `texts`. An error names what went wrong (a field, a
 * kind, a stage), never a value or any of the text.
 */
export function blind(texts: string[], opts: BlindOptions = {}): BlindResult {
  return guard('blind', 'writing the blind copy', () => {
    checkSize(texts, opts.maxTextLength ?? MAX_TEXT_LENGTH);
    return blindTexts(texts, opts);
  });
}

function blindTexts(texts: string[], opts: BlindOptions): BlindResult {
  const prev = opts.mapping;
  if (prev !== undefined) checkMapping(prev);
  const mode = replaceMode(opts);
  const seed = prev?.seed ?? opts.seed ?? globalThis.crypto.randomUUID();
  const root = new Rng(seed);
  const dateOrder = prev?.dateOrder ?? opts.dateOrder ?? 'dmy';
  const deny = opts.deny ?? [];

  const denied = denyDomains(deny);
  const allow = [...DEFAULT_ALLOW_DOMAINS, ...(opts.allowDomains ?? [])]
    .map((d) => d.toLowerCase())
    .filter((d) => !denied.has(d));
  const isAllowedHost = (host: string): boolean => {
    const h = host.toLowerCase();
    return allow.some((d) => h === d || h.endsWith(`.${d}`));
  };
  // Values from earlier turns are found again wherever they appear, even bare.
  // The caller's entries come first, so `checkKnown` throws with the same index here as it would in `knownDetector`.
  const unenforced = checkKnown(opts.known ?? []);
  const known: KnownValue[] = [...(opts.known ?? [])];
  for (const p of prev?.pairs ?? []) {
    const kind = CARRIED[p.kind];
    if (kind && !(kind === 'domain' && isAllowedHost(p.real))) known.push({ kind, value: p.real });
  }
  const ctx: DetectContext = { dateOrder, isAllowedHost, known };

  const detectors = [...builtinDetectors, knownDetector(known), ...(opts.detectors ?? []).map(callerDetector)];
  // Detection reads a same-length fold of each text, so look-alike letters and
  // full-width forms are seen as the plain characters they imitate.
  const folded = texts.map(foldLookalikes);
  const found = guard('blind', 'detecting values', () => findSpans(folded, ctx, detectors));
  const spansByText = mode === 'placeholder' ? found.map((spans, ti) => joinNames(spans, folded[ti] as string)) : found;

  // Words fakes must avoid, so a fake never collides with real text.
  const avoid = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/\p{L}+/gu)) avoid.add(asciiLower(m[0]));
  for (const k of known) {
    avoid.add(asciiLower(k.value));
    for (const tok of personTokens(k.value)) avoid.add(asciiLower(tok));
  }

  // Every fake is claimed in the log with the value as written, so no fake stands for two values.
  const log = new PairLog(mode === 'placeholder' ? [] : (prev?.pairs ?? []));
  // A fake follows the language of its value, or else of the text around it.
  const lang = new TextLanguage(folded, spansByText);
  const sur = new Surrogates(root, { avoid, isAllowedHost, log, texts, lang: lang.call });
  // Placeholders already written in this call's texts or an earlier turn's keep their numbers to themselves.
  const literals = mode === 'placeholder' ? [...new Set([...(prev?.literals ?? []), ...placeholderLiterals([...texts, ...folded])])] : [];
  const placeholders = new Placeholders(mode === 'placeholder' ? (prev?.pairs ?? []) : [], literals);
  const random = new RandomFakes(root.fork('random'), mode === 'random' ? (prev?.pairs ?? []) : [], dateOrder, log);
  if (mode !== 'placeholder') {
    if (prev) sur.restore(prev.pairs);
    // Known people get their fakes up front, so slugs and email locals can use them,
    // in the language around the first name of theirs the text writes.
    const firstSeen = (value: string): Lang => {
      // Compared folded and on the skeleton, as the matcher found them: `Ивaн` in a folded text is `Иван`.
      const word = (t: string): string => skeleton(foldLookalikes(t)).text;
      const words = new Set(personTokens(value).map(word));
      for (const [ti, spans] of spansByText.entries()) {
        for (const s of spans) {
          if (s.kind === 'person' && personTokens((folded[ti] as string).slice(s.start, s.end)).some((t) => words.has(word(t)))) return lang.at(ti, s.start);
        }
      }
      return lang.call;
    };
    for (const k of known) if (k.kind === 'person') sur.prime(k.value, firstSeen(k.value));
  }

  // Generate in a fixed kind order so related fakes (names, then emails) line up.
  const fake = new Map<Span, string>();
  const entries: Array<{ ti: number; span: Span }> = [];
  spansByText.forEach((spans, ti) => spans.forEach((span) => entries.push({ ti, span })));
  const orderOf = (k: Kind): number => GEN_ORDER.indexOf(k);
  const originals: Original[] = [];
  const addOriginal = (kind: Kind, value: string, known?: true): void => {
    originals.push(known ? { kind, value, known } : { kind, value });
  };
  const knownOriginals: Original[] = [];
  for (const k of known) {
    // Each known value is checked as given. A person of several words is checked by
    // its words, which every surviving copy of the full name contains, so one leak is one hit.
    // A stop word or particle among them counts as written or in capitals, and only when the name writes it capitalised, and so does a one-letter part.
    // A two-letter part counts in lower case too, where the text's language does not write it as a word.
    const toks = k.kind === 'person' ? personTokens(k.value).filter((tok) => knownPart(tok) || !stopWordValue(tok)) : [];
    if (k.kind === 'person' && toks.length > 0 && personTokens(k.value).length > 1) {
      for (const tok of toks) {
        // A one-letter part ("J." of "J. Orvane") is checked as its letter, as written or in capitals.
        const one = oneLetterPart(tok);
        knownOriginals.push({ kind: 'person', value: one ? tok.replace(/[^\p{L}]/gu, '') : tok, ...(one || stopWordValue(tok) ? { known: true } : {}), ...(lowerCasePart(tok) ? { lowerCase: true } : {}) });
      }
    } else {
      knownOriginals.push({ kind: k.kind, value: k.value.trim(), known: true });
      if (k.kind === 'org') knownOriginals.push({ kind: 'org', value: k.value.replace(ORG_SUFFIX, '').trim() });
    }
  }

  // An id fake's letters can spell a value the leak check reports: `RIO` in
  // `RIO-9750-8169` beside a known `Joaquín del Río`, matched in capitals and
  // without its accent. Such a draw is taken again. The oracle is the leak
  // check's own rules over the known values and the names, hosts and numbers
  // found so far: ids come last in GEN_ORDER, so every name of the text is in
  // `originals` by then. Amounts and dates are not checked; the final leak
  // check skips them inside a span blind wrote.
  let idLeaks: ((fake: string) => boolean) | undefined;
  const spellsValue = (fake: string): boolean => {
    idLeaks ??= shortTextLeaks({ originals: [...originals, ...knownOriginals], deny, amountKeys: new Set(), dateKeys: new Set(), dateOrder });
    return idLeaks(foldLookalikes(fake));
  };

  // Detection and the leak check see the folded text. The pair log holds the
  // span as written (look-alike letters, full-width forms, hidden characters),
  // or unblind would put the folded spelling back.

  entries
    .filter((e) => orderOf(e.span.kind) >= 0)
    .sort((a, b) => orderOf(a.span.kind) - orderOf(b.span.kind) || a.ti - b.ti || a.span.start - b.span.start)
    .forEach(({ ti, span }) => {
      const orig = (texts[ti] as string).slice(span.start, span.end);
      const real = stripInvisible((folded[ti] as string).slice(span.start, span.end));
      // A placeholder stands for the value as written, so the pair log needs nothing else.
      const make = (fakeOf: () => string): string => (mode === 'placeholder' ? placeholders.get(span.kind, orig) : fakeOf());
      const around = lang.at(ti, span.start);
      let out: string;
      switch (span.kind) {
        case 'person':
          out = make(() => sur.person(real, orig, around));
          for (const tok of personTokens(real)) if (!PARTICLES.has(tok.toLowerCase())) addOriginal('person', tok);
          break;
        case 'org':
          out = make(() => sur.org(real, orig, around));
          addOriginal('org', real);
          addOriginal('org', real.replace(ORG_SUFFIX, '').trim());
          break;
        case 'place':
          out = make(() => sur.place(real, orig, around));
          addOriginal('place', real);
          break;
        case 'domain':
          // A public platform stays exactly as written.
          out = isAllowedHost(real) ? orig : make(() => sur.domainSpan(real, orig, around));
          if (!isAllowedHost(real)) addOriginal('domain', real);
          break;
        case 'email': {
          out = make(() => sur.email(real, orig, around));
          // A role address on a public platform (no-reply@...) stays as it is on purpose.
          if (out.toLowerCase() !== real.toLowerCase()) addOriginal('email', real);
          const host = real.replace(THROUGH_AT, '');
          if (!isAllowedHost(host)) addOriginal('domain', host);
          break;
        }
        case 'url': {
          out = make(() => sur.url(real, orig, around));
          const host = /^(?:https?:\/\/)?([^/?#:]+)/i.exec(real)?.[1];
          if (host && !isAllowedHost(host)) addOriginal('domain', host);
          break;
        }
        case 'phone':
          out = make(() => (mode === 'random' ? random.phone(real, orig) : sur.phone(real, orig)));
          addOriginal('phone', real);
          break;
        case 'iban':
          out = make(() => (mode === 'random' ? random.iban(real, orig) : sur.iban(real, orig)));
          addOriginal('iban', real);
          break;
        default: {
          const scheme = (span.meta as IdMeta | undefined)?.scheme;
          // In random mode an IP address still becomes a documentation address, never someone's host.
          const ip = scheme === 'ipv4' || scheme === 'ipv6';
          out = make(() => (mode === 'random' && !ip ? random.id(real, orig) : scheme ? sur.typedId(real, scheme, orig) : sur.id(real, orig, spellsValue)));
          addOriginal('id', real);
        }
      }
      fake.set(span, out);
    });

  // The known values follow the ones found in the texts, in the order the pairs have.
  originals.push(...knownOriginals);

  const amountSpans = spansByText.map((spans) => spans.filter((s) => s.kind === 'amount'));
  const amountOccs = amountSpans.map((spans) => spans.map((s) => s.meta as AmountOcc));
  const amountKeys = new Set(amountOccs.flat().map(amountKey));
  const dateKeys = new Set(spansByText.flat().flatMap((s) => (s.kind === 'date' ? [dateKey(s.meta as DateOcc)] : [])));
  let refYear = prev?.refYear ?? (opts.now ?? new Date()).getUTCFullYear();
  outer: for (const spans of prev ? [] : spansByText) {
    for (const s of spans) {
      if (s.kind === 'date' && (s.meta as DateOcc).y !== null) {
        refYear = (s.meta as DateOcc).y as number;
        break outer;
      }
    }
  }
  const pinned = new Map<string, number>();
  for (const p of prev?.pairs ?? []) {
    if (p.kind !== 'amount') continue;
    // A spelling with full-width digits holds the same value as its plain one.
    const r = parseNumber(foldLookalikes(p.real));
    const f = parseNumber(foldLookalikes(p.fake));
    if (r && f && r.decimals === f.decimals) pinned.set(amountKey(r), f.minor);
  }
  const percents = texts.map(detectPercents);
  const thouHint = new Map<string, ',' | '.'>();
  for (const occs of amountOccs) for (const o of occs) if (o.thou) thouHint.set(String(o.dec), o.thou);

  // Each spelling of a date keeps one fake, and no two spellings share one: a
  // spelling seen in an earlier turn keeps its fake, and when the plain
  // rendering of a moved date is taken, another rendering of it is used.
  const dateFakes = (move: (o: DateOcc) => DateOcc): Map<Span, string> => {
    const dateFakeOf = new Map<string, string>();
    const dateRealOf = new Map<string, string>();
    for (const p of prev?.pairs ?? []) {
      if (p.kind !== 'date') continue;
      if (!dateFakeOf.has(p.real)) dateFakeOf.set(p.real, p.fake);
      if (!dateRealOf.has(p.fake)) dateRealOf.set(p.fake, p.real);
    }
    const out = new Map<Span, string>();
    spansByText.forEach((spans, ti) => {
      for (const s of spans) {
        if (s.kind !== 'date') continue;
        const written = (texts[ti] as string).slice(s.start, s.end);
        let f = dateFakeOf.get(written);
        if (f === undefined) {
          f = freeDateFake(move(s.meta as DateOcc), dateOrder, (x) => dateRealOf.has(x));
          dateFakeOf.set(written, f);
          if (!dateRealOf.has(f)) dateRealOf.set(f, written);
        }
        out.set(s, f);
      }
    });
    return out;
  };

  // Each spelling of an amount keeps one fake, and no two spellings share one,
  // the way dates do: the fake is written with the spelling's separators and
  // full-width digits, and when that rendering is taken the same value is
  // written another way. `valueOf` gives the fake value of an amount.
  const amountFakes = (valueOf: (o: AmountOcc) => number, hinted: boolean, out: Map<Span, string>): void => {
    const fakeOf = new Map<string, string>();
    const realOf = new Map<string, string>();
    for (const p of prev?.pairs ?? []) {
      if (p.kind !== 'amount') continue;
      if (!fakeOf.has(p.real)) fakeOf.set(p.real, p.fake);
      if (!realOf.has(p.fake)) realOf.set(p.fake, p.real);
    }
    amountSpans.forEach((spans, ti) => {
      for (const s of spans) {
        const o = s.meta as AmountOcc;
        const written = (texts[ti] as string).slice(s.start, s.end);
        let f = fakeOf.get(written);
        if (f === undefined) {
          const hint = hinted && !o.thou && o.minor < 10 ** (o.decimals + 3) ? thouHint.get(String(o.dec)) ?? null : null;
          f = freeAmountFake(valueOf(o), o, written, hint, (x) => realOf.has(x));
          fakeOf.set(written, f);
          if (!realOf.has(f)) realOf.set(f, written);
        }
        out.set(s, f);
      }
    });
  };

  // One factor and one shift for the whole conversation. Amounts: one factor,
  // relations recomputed from scaled operands. Dates: one shift, same format
  // and language. `planned` holds each amount's and date's fake under them.
  // `broken` counts the relations beyond an amount's first that the plan does not keep.
  const planFakes = (f: number, shift: number): { fakes: Map<Span, string>; broken: number } => {
    const plan = new AmountPlan(amountOccs, percents, f, pinned);
    const out = dateFakes((o) => shiftOcc(o, shift, refYear));
    amountFakes((o) => plan.fakeMinor(amountKey(o)), true, out);
    return { fakes: out, broken: plan.broken() };
  };
  // A plan is drawn again when one of its fakes equals or contains a real
  // value of any kind: a fake of 35.01 where the text also has 35.01, or
  // "1 de agosto de 2025" where it also has "1 de agosto". The oracle is the
  // leak check's own rules, applied to each fake alone with nothing marked as
  // written by blind, so its amount and date rules apply to them. Real amounts
  // and dates are added as whole-word originals (the rule it has for a person's
  // token), so a fake that contains one is caught as well as one that equals it.
  // `shortTextLeaks` prepares the originals once and looks each piece of a fake
  // up among them, so a check costs the length of the fakes, not fakes times originals.
  const planReals: Original[] = spansByText.flatMap((spans, ti) =>
    spans.flatMap((s) => (s.kind === 'amount' || s.kind === 'date' ? [{ kind: 'person' as const, value: (folded[ti] as string).slice(s.start, s.end) }] : [])),
  );
  const leaksIn = shortTextLeaks({ originals: [...originals, ...planReals], deny, amountKeys, dateKeys, dateOrder });
  // A fake is checked as its plain-digit fold, so a full-width fake of a real amount is caught too.
  const collides = (fakes: Map<Span, string>): boolean => [...fakes.values()].some((f) => leaksIn(foldLookalikes(f)));
  let factor = 1;
  let dayShift = 0;
  let planned = new Map<Span, string>();
  let collided = false;
  if (mode === 'fake' && prev) {
    // A conversation keeps the factor and shift of its first call.
    factor = prev.factor;
    dayShift = prev.dayShift;
    planned = planFakes(factor, dayShift).fakes;
  } else if (mode === 'fake') {
    const fr = root.fork('factor');
    const sr = root.fork('shift');
    const signs = root.fork('shift-sign');
    // A long text full of dates and amounts collides under every draw (any
    // shift lands on another real date), so the draws are bounded by the work
    // they cost: PLAN_BUDGET planned fakes in all, at least two draws. When
    // every draw collides the last plan stays and its colliding pairs are
    // listed in `collisions`. The final leak check skips amounts and dates
    // blind wrote, so it does not report that case.
    const size = spansByText.reduce((n, spans) => n + spans.filter((s) => s.kind === 'amount' || s.kind === 'date').length, 0);
    const attempts = Math.max(2, Math.min(PLAN_ATTEMPTS, Math.floor(PLAN_BUDGET / Math.max(1, size))));
    // A draw is also taken again when an amount in two relations (10,43 as
    // 10,03 plus 4 % and as 4 % of 260,63) keeps only its first: one factor
    // rounds both to the same cent, another does not. When no draw keeps
    // both, the first draw without a collision stays.
    let kept: { factor: number; dayShift: number; planned: Map<Span, string> } | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      // A factor within 0.05 of 1 is drawn again from the same stream, so the
      // ones kept stay about equally likely. 64 draws all in the band have
      // odds near 1e-64; only then does 1.1 stand in.
      factor = 1.1;
      for (let i = 0; i < 64; i++) {
        const f = Math.round((0.6 + fr.next()) * 1000) / 1000;
        if (Math.abs(f - 1) >= 0.05) {
          factor = f;
          break;
        }
      }
      dayShift = sr.range(1, 10) * (signs.int(2) === 0 ? -1 : 1) * 7;
      const drawn = planFakes(factor, dayShift);
      planned = drawn.fakes;
      collided = collides(planned);
      if (!collided && drawn.broken === 0) {
        kept = null;
        break;
      }
      if (!collided) kept ??= { factor, dayShift, planned };
    }
    if (kept) {
      ({ factor, dayShift, planned } = kept);
      collided = false;
    }
  }
  // Placeholders and random values scale and shift nothing: factor 1, shift 0.

  // Each amount gets one pair per spelling, real as written, so it comes back as written.
  const amountPairs: Pair[] = [];
  // Random amounts are drawn once per value, then written once per spelling under the same rule as the plan's.
  const randomAmounts = new Map<Span, string>();
  if (mode === 'random') amountFakes((o) => parseNumber(random.amount(o))!.minor, false, randomAmounts);
  amountSpans.forEach((spans, ti) => {
    for (const s of spans) {
      const written = (texts[ti] as string).slice(s.start, s.end);
      if (mode === 'placeholder') {
        // Placeholders and random amounts scale nothing, so no relation survives.
        fake.set(s, placeholders.get('amount', written));
        continue;
      }
      const out = (mode === 'random' ? randomAmounts : planned).get(s) as string;
      fake.set(s, out);
      amountPairs.push({ kind: 'amount', real: written, fake: out });
    }
  });

  const datePairs: Pair[] = [];
  // Random dates are drawn once per spelling, in text order, under the same rule as the plan's.
  const randomDates = mode === 'random' ? dateFakes((o) => random.date(o, refYear)) : null;
  spansByText.forEach((spans, ti) => {
    for (const s of spans) {
      if (s.kind !== 'date') continue;
      const written = (texts[ti] as string).slice(s.start, s.end);
      if (mode === 'placeholder') {
        fake.set(s, placeholders.get('date', written));
        continue;
      }
      const out = (randomDates ?? planned).get(s) as string;
      fake.set(s, out);
      datePairs.push({ kind: 'date', real: written, fake: out });
    }
  });

  // Assemble.
  const replaced: Array<Array<[number, number]>> = [];
  const counts: Partial<Record<Kind, number>> = {};
  const outTexts = texts.map((t, ti) => {
    let out = '';
    let at = 0;
    const ranges: Array<[number, number]> = [];
    for (const s of spansByText[ti] as Span[]) {
      const f = fake.get(s);
      if (f === undefined) continue;
      counts[s.kind] = (counts[s.kind] ?? 0) + 1;
      out += t.slice(at, s.start);
      ranges.push([out.length, out.length + f.length]);
      out += f;
      at = s.end;
    }
    out += t.slice(at);
    replaced.push(ranges);
    return out;
  });

  // A known name's words got fakes up front. Only a word some text of this call writes keeps
  // its pair, so the mapping never holds a known value the texts did not contain.
  if (mode !== 'placeholder' && known.some((k) => k.kind === 'person')) {
    const skeletons = folded.map((t) => skeleton(t).text);
    log.keepPrimed((p) => sur.wrote(p.real) || writesWord(skeletons, p.real));
  }

  const pairs: Pair[] = [];
  const seenPair = new Set<string>();
  const made = mode === 'placeholder' ? placeholders.pairs : [...log.pairs, ...amountPairs, ...datePairs];
  for (const p of [...(prev?.pairs ?? []), ...made]) {
    const k = `${p.kind}|${p.real}|${p.fake}`;
    if (seenPair.has(k)) continue;
    seenPair.add(k);
    pairs.push(p);
  }

  const mapping: Mapping = { version: 1, seed, replaceWith: mode, factor, dayShift, dateOrder, refYear, pairs, ...(literals.length ? { literals } : {}) };
  const leaks = checkLeaks({
    outputs: outTexts, replaced, originals, deny, amountKeys, dateKeys, dateOrder, unenforced,
  });
  // A kept plan that still collides is reported pair by pair, by kind and index.
  const planCollisions: Collision[] = [];
  if (collided) {
    const own = new Set<Pair>([...amountPairs, ...datePairs]);
    pairs.forEach((p, index) => {
      if (own.has(p) && leaksIn(foldLookalikes(p.fake))) planCollisions.push({ kind: p.kind, index });
    });
  }
  const shared = collisions(mapping);
  const listed = new Set(shared.map((c) => c.index));
  const reported = [...shared, ...planCollisions.filter((c) => !listed.has(c.index))].sort((a, b) => a.index - b.index);
  const identities = mode === 'placeholder' ? placeholderIdentities(texts, spansByText, opts.known ?? [], mapping) : [];
  return { texts: outTexts, identities, mapping, leaks, replaced: counts, collisions: reported };
}
