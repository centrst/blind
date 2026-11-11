import { adaptCase, caseLike, caseVariants, habit, title, uniformToTitle } from './case.js';
import { foldLookalikes, skeleton, visibleOffsets } from './fold.js';
import { compact, detectIds, fakeId, parseIpv6, renderLike as renderLikeId, type IdScheme } from './ids.js';
import { addressLanguage, hostLanguage, nameLanguages, orgLanguage, placeLanguage, type Lang } from './language.js';
import { fakeFinder } from './match.js';
import * as N from './names.js';
import { PairLog } from './pairlog.js';
import { Rng } from './prng.js';
import { unspaced } from './script.js';
import type { Kind, Pair } from './types.js';
import { BlindError } from './errors.js';

/** Draws of an id fake whose letters spell a value the leak check would report, before the last one is kept anyway. */
const ID_ATTEMPTS = 32;

const TOKEN_RE = /\p{L}[\p{L}\p{M}'’]*/gu;
const AT_RE = new RegExp(N.AT_SRC, 'i');
const EMAIL_IN_URL = /([A-Za-z0-9._+-]+)(@|%40)((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/;
const URL_TOKEN = new RegExp(`${EMAIL_IN_URL.source}|[A-Za-z0-9]{6,}|\\p{L}+`, 'gu');

export const asciiLower = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The key a name word's fake, role and language are kept under: its folded
 * skeleton, the form the known matcher compares. A Cyrillic or Greek word, the
 * same word in capitals and its folded form share one key, so they share one
 * fake. For ASCII it is `asciiLower`.
 */
const nameKey = (s: string): string => skeleton(foldLookalikes(s)).text;

/** Raised when a value cannot get a fake of its own. It names the kind, never the value. */
const noFreeFake = (kind: Kind): never => {
  throw new BlindError('no-free-fake', `blind: no free fake left for a ${kind}`);
};

/**
 * Whether a word of a person span gets a fake: two letters or more, or one
 * letter of a script without word spaces (a known `华`). A lone Latin letter
 * is an initial (`J.`) and stays, unless a known full name has it as a part
 * (see `Surrogates.nameWord`).
 */
const nameWord = (tok: string): boolean => tok.length >= 2 || unspaced(tok);

/** An org or place fake back in the case it was made in: each word capitalised, particles lower. */
const canonicalName = (fake: string): string => fake.split(' ').map((w) => (N.PARTICLES.has(w.toLowerCase()) ? w.toLowerCase() : title(w))).join(' ');

const keys = (xs: readonly string[]): Set<string> => new Set(xs.map(asciiLower));
const FEMALE = keys([...N.GIVEN.en.female, ...N.GIVEN.es.female, ...N.FEMALE_FIRST]);
const MALE = keys([...N.GIVEN.en.male, ...N.GIVEN.es.male, ...N.MALE_FIRST]);

/**
 * True for a first name read as a woman's: one the lists give only to women,
 * or, for a name they do not know or give to both, one ending in "a".
 */
export function looksFemale(key: string): boolean {
  const f = FEMALE.has(key);
  if (f !== MALE.has(key)) return f;
  return key.endsWith('a');
}

/** The language a fake name, company or place was taken from, if it is one of the lists'. */
function fakeLanguage(fake: string): Lang | undefined {
  const k = asciiLower(fake);
  const has = (l: N.FakeLists): boolean => [...l.female, ...l.male, ...l.last, ...l.orgBases, ...l.places].some((x) => asciiLower(x) === k);
  return has(N.FAKES.es) ? 'es' : has(N.FAKES.en) ? 'en' : undefined;
}

export interface SurrogateOptions {
  /** Lowercase words seen in the input or known values. Fakes avoid them. */
  avoid: Set<string>;
  isAllowedHost(host: string): boolean;
  /** Where every fake is claimed and paired with the value as written. */
  log: PairLog;
  /** The input texts. A fake made of digits must not be written in them already, or unblind would rewrite that text too. */
  texts?: readonly string[];
  /** The language of a value that says nothing about its own, when the caller does not give the text's. English if unset. */
  lang?: Lang;
}

export class Surrogates {
  private used = new Set<string>();
  private tokenRole = new Map<string, 'first' | 'last'>();
  private tokenFake = new Map<string, string>();
  /** Name words a person span of this call wrote. */
  private written = new Set<string>();
  private tokenLang = new Map<string, Lang>();
  /** Particles a known name writes capitalised ("Al" of "Al Brenner"), lower-cased: written capitalised, they are name words. */
  private nameParticles = new Set<string>();
  /** Capital letters a known full name has as a part (`O` of `O Li`): they get a fake like any other name word. */
  private nameLetters = new Set<string>();
  private memo = new Map<string, string>();
  private pools = new Map<string, { list: string[]; at: number }>();
  /** One independent stream per kind of draw, so adding one kind of fake never shifts another. */
  private readonly rng: { pool: Rng; misc: Rng; digits: Rng; local: Rng; typed: Rng };
  private readonly log: PairLog;
  private lowerTexts: string[] | undefined;

  constructor(
    root: Rng,
    private readonly opts: SurrogateOptions,
  ) {
    this.rng = { pool: root.fork('pool'), misc: root.fork('misc'), digits: root.fork('digits'), local: root.fork('local'), typed: root.fork('typed') };
    this.log = opts.log;
  }

  // ------------------------------------------------------------------ helpers

  private free(c: string): boolean {
    const l = asciiLower(c);
    return !this.used.has(l) && !this.opts.avoid.has(l);
  }

  private take(c: string): string {
    this.used.add(asciiLower(c));
    return c;
  }

  /** True when unblind would find `fake` in an input text as it stands. */
  private inInput(fake: string): boolean {
    const f = fake.toLowerCase();
    this.lowerTexts ??= (this.opts.texts ?? []).map((t) => t.toLowerCase());
    if (!f || !this.lowerTexts.some((t) => t.includes(f))) return false;
    const find = fakeFinder([fake]);
    return (this.opts.texts ?? []).some((t) => find(t).length > 0);
  }

  /**
   * The fake for a name written `orig`. `render` puts a base fake in the
   * letter case of the text. A spelling that differs only in letter case from
   * the one holding that fake gets another case of the same fake. Any other
   * spelling ("María" beside "Maria") gets a base of its own from `fresh`.
   */
  private claimName(kind: Kind, orig: string, base: string, render: (base: string) => string, fresh: () => string): string {
    const had = this.log.fakeOf(kind, orig);
    if (had !== undefined) return had;
    const spell = `spell|${kind}|${orig.toLowerCase()}`;
    let b = this.memo.get(spell) ?? base;
    for (let round = 0; round < 20; round++) {
      // A base belongs to the first spelling that wrote it, in any of its letter cases.
      const first = this.log.firstOwnerOf(render(b));
      if (first !== undefined && first.toLowerCase() !== orig.toLowerCase()) {
        b = fresh();
        this.memo.set(spell, b);
        continue;
      }
      for (const f of caseVariants(render(b))) {
        const owner = this.log.ownerOf(f);
        if (owner === undefined || owner === orig) {
          this.log.claim(kind, orig, f);
          return f;
        }
        if (owner.toLowerCase() !== orig.toLowerCase()) break;
      }
      b = fresh();
      this.memo.set(spell, b);
    }
    return noFreeFake(kind);
  }

  /**
   * The fake for an address or link written `orig`: `fake`, or another letter
   * case of it when `orig` is another letter case of the value that holds it.
   * Unblind reads every letter case of a fake as its first pair, so a fake
   * another value holds is not shared in any case: `fresh` makes a new one.
   */
  private claimPlain(kind: Kind, orig: string, fake: string, fresh?: (round: number) => string): string {
    const had = this.log.fakeOf(kind, orig);
    if (had !== undefined) return had;
    let own = fake;
    for (let round = 0; fresh && round < 20; round++) {
      const first = this.log.firstOwnerOf(own);
      if (first === undefined || first.toLowerCase() === orig.toLowerCase()) break;
      own = fresh(round);
    }
    for (const f of caseVariants(own)) if (this.log.claim(kind, orig, f)) return f;
    return noFreeFake(kind);
  }

  /** The fake for a number written `orig`: the first of `make(0)`, `make(1)`, ... that is free and not in the input. */
  private claimDigits(kind: Kind, orig: string, make: (attempt: number) => string): string {
    const had = this.log.fakeOf(kind, orig);
    if (had !== undefined) return had;
    for (let n = 0; n < 1000; n++) {
      const f = make(n);
      if (!this.inInput(f) && this.log.claim(kind, orig, f)) return f;
    }
    return noFreeFake(kind);
  }

  private syllables(): string {
    const r = this.rng.misc;
    const cons = 'bcdfglmnprstvz';
    const vow = 'aeiou';
    let s = '';
    for (let i = 0; i < 3; i++) s += cons[r.int(cons.length)]! + vow[r.int(vow.length)]!;
    return title(s);
  }

  private around(lang: Lang | undefined): Lang {
    return lang ?? this.opts.lang ?? 'en';
  }

  private pickFrom(poolName: string, list: readonly string[]): string {
    let p = this.pools.get(poolName);
    if (!p) {
      p = { list: this.rng.pool.shuffled(list), at: 0 };
      this.pools.set(poolName, p);
    }
    while (p.at < p.list.length) {
      const c = p.list[p.at++] as string;
      if (this.free(c)) return this.take(c);
    }
    // The list ran out: join two of its entries, the way double-barrelled names
    // are ("Hayes-Brooks"), leaving out any the input writes.
    const parts = p.list.filter((c) => !this.opts.avoid.has(asciiLower(c)));
    for (const a of parts) {
      for (const b of parts) {
        const c = `${a}-${b}`;
        if (a !== b && this.free(c)) return this.take(c);
      }
    }
    for (let i = 0; i < 500; i++) {
      const c = this.syllables();
      if (this.free(c)) return this.take(c);
    }
    return this.take(`${this.syllables()}${this.used.size}`);
  }

  private digitsLike(shape: string, keepFirst: boolean, r: Rng = this.rng.digits): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let out = '';
      let firstDigit = true;
      for (const ch of shape) {
        if (/\d/.test(ch)) {
          const lead = firstDigit && ch !== '0';
          out += keepFirst && firstDigit ? ch : String(r.digit(lead ? 1 : 0));
          firstDigit = false;
        } else if (/[A-Z]/.test(ch)) out += String.fromCharCode(65 + r.int(26));
        else if (/[a-z]/.test(ch)) out += String.fromCharCode(97 + r.int(26));
        else out += ch;
      }
      if (out !== shape || attempt === 49) return out;
    }
    return shape;
  }

  /** `memo` under `key`, or under `key#n` for the n-th alternative, made once by `make`. */
  private memoized(key: string, n: number, make: () => string): string {
    const k = n ? `${key}#${n}` : key;
    let v = this.memo.get(k);
    if (v === undefined) {
      v = make();
      this.memo.set(k, v);
    }
    return v;
  }

  // ------------------------------------------------------------------- people

  /**
   * Notes each word of a name as a first name or a surname, and the language
   * of its fake: the word's own, else that of the rest of the name, else
   * `around`. The first time a word is seen decides both. With `surname`, a
   * name of one word is a surname (`Holloway` of `Mr Holloway`), unless it is
   * on the first-name lists (`Sra. Lucía`).
   */
  registerPerson(text: string, around?: Lang, surname = false): void {
    const toks = [...text.matchAll(TOKEN_RE)].map((m) => m[0]).filter((t) => this.nameWord(t) && !this.particle(t));
    const comma = text.indexOf(',');
    const langs = nameLanguages(toks);
    toks.forEach((t, i) => {
      const key = nameKey(t);
      if (!this.tokenLang.has(key)) this.tokenLang.set(key, langs[i] ?? this.around(around));
      if (this.tokenRole.has(key)) return;
      let role: 'first' | 'last' = i === 0 ? 'first' : 'last';
      if (comma >= 0) role = text.indexOf(t) > comma ? 'first' : 'last';
      if (surname && toks.length === 1 && !FIRST_NAMES.has(asciiLower(t))) role = 'last';
      this.tokenRole.set(key, role);
    });
  }

  private newPersonFake(key: string): string {
    const role = this.tokenRole.get(key) ?? 'last';
    const lang = this.tokenLang.get(key) ?? this.around(undefined);
    const lists = N.FAKES[lang];
    if (role === 'first') {
      const gender = looksFemale(key) ? 'female' : 'male';
      return this.pickFrom(`${gender}|${lang}`, lists[gender]);
    }
    return this.pickFrom(`last|${lang}`, lists.last);
  }

  /** The base fake of a name word, made with its pair the first time the word is seen. */
  private tokenBase(tok: string, origTok: string, primed = false): string {
    const key = nameKey(tok);
    let fake = this.tokenFake.get(key);
    if (!fake) {
      fake = this.newPersonFake(key);
      this.tokenFake.set(key, fake);
      this.log.reserve('person', uniformToTitle(origTok), fake, primed);
    }
    return fake;
  }

  /** Whether a name a text writes used the word `tok`. */
  wrote(tok: string): boolean {
    return this.written.has(nameKey(tok));
  }

  private personToken(tok: string, origTok: string = tok): string {
    this.written.add(nameKey(tok));
    const base = this.tokenBase(tok, origTok);
    return this.claimName('person', origTok, base, (b) => adaptCase(tok, b), () => this.newPersonFake(nameKey(tok)));
  }

  /** Whether `tok` of a person span gets a fake: see `nameWord`, and a capital letter a known full name has as a part. */
  private nameWord(tok: string): boolean {
    return nameWord(tok) || this.nameLetters.has(tok);
  }

  /** Whether `tok` is a particle a fake keeps: one on the list, unless a known name writes it capitalised and so does `tok`. */
  private particle(tok: string): boolean {
    const key = tok.toLowerCase();
    return N.PARTICLES.has(key) && !(/^\p{Lu}/u.test(tok) && this.nameParticles.has(key));
  }

  /** Gives a known name its fakes up front, so email locals and slugs can use them. */
  prime(text: string, around?: Lang): void {
    const words = [...text.matchAll(TOKEN_RE)].map((m) => m[0]);
    for (const w of words) if (/^\p{Lu}/u.test(w) && N.PARTICLES.has(w.toLowerCase())) this.nameParticles.add(w.toLowerCase());
    if (words.length > 1) for (const w of words) if (/^\p{Lu}$/u.test(w)) this.nameLetters.add(w);
    this.registerPerson(text, around);
    for (const w of words) {
      if (this.nameWord(w) && !this.particle(w)) this.tokenBase(w, w, true);
    }
  }

  /**
   * `text` is what detection saw (folded, invisibles stripped). `orig` is the
   * same span as written, so the pair log can restore it exactly. `around` is
   * the language of the text around it.
   */
  person(text: string, orig: string = text, around?: Lang): string {
    this.registerPerson(text, around);
    const from = orig === text ? null : visibleOffsets(orig);
    const asWritten = from && from.length === text.length ? from : null;
    // A name made only of particles ("Al", "De") was given in `known`: its words are replaced too.
    const words = text.match(TOKEN_RE) ?? [];
    const named = words.some((t) => this.nameWord(t) && !N.PARTICLES.has(t.toLowerCase()));
    // A one-letter word has no case habit of its own: in a name written in capitals ("O LI") its fake is written in capitals too.
    const shouted = habit(text) === 'upper';
    const out = text.replace(TOKEN_RE, (tok, offset: number) => {
      if (!this.nameWord(tok) || (named && this.particle(tok))) return tok;
      const origTok = asWritten ? orig.slice(asWritten[offset] as number, (asWritten[offset + tok.length - 1] as number) + 1) : tok;
      const fake = this.personToken(tok, origTok);
      return shouted && tok.length === 1 ? fake.toUpperCase() : fake;
    });
    // Look-alike letters or hidden characters outside the name words come back through a pair for the whole span.
    if (orig !== text) this.log.claim('person', orig, out);
    return out;
  }

  // ------------------------------------------------------------------ org/place

  /** An invented company of as many words as `core`: "Kestrel Partners" in English, "Asesores Lumera" in Spanish. */
  private newOrgFake(core: string, lang: Lang): string {
    const words = core.trim().split(/\s+/).length;
    const lists = N.FAKES[lang];
    const base = this.pickFrom(`orgBase|${lang}`, lists.orgBases);
    // A noun the text writes would leave a real word in the fake ("Talleres Norte" to "Talleres Lumera").
    const fresh = lists.orgNouns.filter((n) => !this.opts.avoid.has(asciiLower(n)));
    const nouns: string[] = [];
    for (let i = 1; i < words; i++) nouns.push(this.rng.misc.pick(fresh.length ? fresh : lists.orgNouns));
    return (lang === 'es' && nouns.length ? [nouns[0], base, ...nouns.slice(1)] : [base, ...nouns]).join(' ');
  }

  org(text: string, orig: string = text, around?: Lang): string {
    const m = N.ORG_SUFFIX.exec(text);
    const core = m ? text.slice(0, m.index) : text;
    const tail = m ? text.slice(m.index) : '';
    const lang = orgLanguage(text) ?? this.around(around);
    const key = `org|${asciiLower(core)}`;
    let fake = this.memo.get(key);
    if (!fake) {
      fake = this.newOrgFake(core, lang);
      this.memo.set(key, fake);
    }
    const out = this.claimName('org', orig, fake, (b) => caseLike(core, b) + tail, () => this.newOrgFake(core, lang));
    // The name without its suffix, for a reply that leaves the suffix out.
    if (m) this.log.reserve('org', core.trim(), out.slice(0, out.length - tail.length));
    return out;
  }

  place(text: string, orig: string = text, around?: Lang): string {
    const lang = placeLanguage(text) ?? this.around(around);
    const pick = (): string => this.pickFrom(`place|${lang}`, N.FAKES[lang].places);
    const key = `place|${asciiLower(text)}`;
    let fake = this.memo.get(key);
    if (!fake) {
      fake = pick();
      this.memo.set(key, fake);
    }
    return this.claimName('place', orig, fake, (b) => caseLike(text, b), pick);
  }

  // ------------------------------------------------------------ domain / email

  private splitHost(h: string): { prefix: string; reg: string } {
    const labels = h.split('.');
    if (labels.length <= 2) return { prefix: '', reg: h };
    const second = labels[labels.length - 2] as string;
    const last = labels[labels.length - 1] as string;
    const n = last.length === 2 && ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(second) ? 3 : 2;
    return { prefix: labels.slice(0, labels.length - n).join('.'), reg: labels.slice(labels.length - n).join('.') };
  }

  /** "kestrel-consulting.example" in English, "asesoria-norte.example" in Spanish. */
  private genDomain(lang: Lang): string {
    const r = this.rng.misc;
    const { domainNouns, domainNames } = N.FAKES[lang];
    for (let i = 0; i < 300; i++) {
      const noun = r.pick(domainNouns);
      const name = r.pick(domainNames);
      const d = `${lang === 'es' ? `${noun}-${name}` : `${name}-${noun}`}.example`;
      if (this.free(d)) return this.take(d);
    }
    return this.take(`${this.syllables().toLowerCase()}-${this.used.size}.example`);
  }

  /** The fake for one word of a local part or host label. With `again`, a word that is drawn is drawn anew from that stream. */
  private localWord(run: string, lang: Lang, again?: Rng): string {
    const key = `lw|${run}`;
    let f = again ? undefined : this.memo.get(key);
    if (!f) {
      const mapped = this.tokenFake.get(nameKey(run));
      if (mapped) f = asciiLower(mapped);
      else {
        const dec = this.decompose(run);
        if (dec) f = dec;
        else {
          const r = again ?? this.rng.local;
          const lists = N.FAKES[lang];
          const pool = [...lists.female, ...lists.male, ...lists.last];
          for (let i = 0; i < 200; i++) {
            const c = asciiLower(r.pick(pool));
            if (!this.opts.avoid.has(c) && c !== run) {
              f = c;
              break;
            }
          }
          f ??= asciiLower(this.syllables());
        }
      }
      this.memo.set(key, f);
    }
    return f;
  }

  /** "aruiz" or "anaruiz" built from names we already mapped. */
  private decompose(run: string): string | null {
    for (let i = 1; i < run.length; i++) {
      const right = this.tokenFake.get(run.slice(i));
      if (!right) continue;
      const left = run.slice(0, i);
      const leftFake = this.tokenFake.get(left);
      if (leftFake && left.length > 1) return asciiLower(leftFake) + asciiLower(right);
      if (left.length === 1) {
        const hit = [...this.tokenFake.entries()].find(([k]) => k.startsWith(left) && this.tokenRole.get(k) === 'first');
        return (hit ? asciiLower(hit[1])[0]! : left) + asciiLower(right);
      }
    }
    return null;
  }

  private localFake(local: string, lang: Lang, again?: Rng): string {
    return local.replace(/[A-Za-z]+|\d+/g, (run) => {
      if (/\d/.test(run)) {
        const key = `dg|${run}`;
        let f = again ? undefined : this.memo.get(key);
        if (!f) {
          f = this.digitsLike(run, false, again);
          this.memo.set(key, f);
        }
        return f;
      }
      const l = run.toLowerCase();
      if (N.ROLE_WORDS.has(l) || l.length <= 2) return run;
      return this.localWord(l, lang, again);
    });
  }

  /**
   * The fake host for `host`, in the language of its own words or else
   * `around`. Its pair lets a reply that names the fake host alone come back.
   */
  domain(host: string, around?: Lang): string {
    const h = host.toLowerCase().replace(/\.$/, '');
    if (this.opts.isAllowedHost(h)) return host;
    const { prefix, reg } = this.splitHost(h);
    const lang = hostLanguage(h) ?? this.around(around);
    const key = `domain|${reg}`;
    let fakeReg = this.memo.get(key);
    if (!fakeReg) {
      fakeReg = this.genDomain(lang);
      this.memo.set(key, fakeReg);
      this.log.reserve('domain', reg, fakeReg);
    }
    if (!prefix) return fakeReg;
    const fp = prefix
      .split('.')
      .map((l) => (N.COMMON_LABELS.has(l) || l.length <= 2 ? l : this.localWord(l, lang)))
      .join('.');
    const out = `${fp}.${fakeReg}`;
    this.log.reserve('domain', h, out);
    return out;
  }

  /** A host written on its own in the text. */
  domainSpan(host: string, orig: string = host, around?: Lang): string {
    return this.claimPlain('domain', orig, this.domain(host, around));
  }

  email(text: string, orig: string = text, around?: Lang): string {
    const key = `email|${text.toLowerCase()}`;
    const at = AT_RE.exec(text);
    const had = this.memo.get(key);
    if (!at) return had ? this.claimPlain('email', orig, had) : text;
    const local = text.slice(0, at.index);
    const host = text.slice(at.index + at[0].length);
    const lang = addressLanguage(text, this.opts.isAllowedHost(host.toLowerCase())) ?? this.around(around);
    const build = (again?: Rng, tail = ''): string => `${this.localFake(local, lang, again)}${tail}${at[0]}${this.domain(host, lang)}`;
    const fake = had ?? build();
    this.memo.set(key, fake);
    // Two addresses can draw one fake: draws repeat by chance, and a continued mapping starts them over.
    // The second draws again from a stream of its own, so it never walks the draws of the addresses before it.
    let again: Rng | undefined;
    let numbered = false;
    return this.claimPlain('email', orig, fake, (round) => {
      again ??= this.rng.local.fork(`again|${text.toLowerCase()}`);
      let next = numbered ? '' : build(again);
      // A local part with nothing drawn in it, names and role words alone, comes out the same: it is numbered.
      // So is one still taken after a dozen draws, at a host with more addresses than there are words, with a
      // number from a range that grows each round.
      if (numbered || round >= 12 || next.toLowerCase() === fake.toLowerCase()) {
        numbered = true;
        next = build(undefined, String(round < 12 ? round + 2 : 100 + again.int(10 ** (round - 10))));
      }
      this.memo.set(key, next);
      return next;
    });
  }

  // ----------------------------------------------------------------------- url

  url(raw: string, orig: string = raw, around?: Lang): string {
    const key = `url|${raw}`;
    let out = this.memo.get(key);
    if (!out) {
      const m = /^(https?:\/\/)?([^/?#:]+)(:\d+)?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(raw);
      if (!m) return raw;
      const [, scheme = '', host = '', port = '', path = '', query = '', frag = ''] = m;
      const lang = hostLanguage(host) ?? this.around(around);
      const fakeHost = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? this.typedId(host, 'ipv4') : this.domain(host, lang);
      out = `${scheme}${fakeHost}${port}${this.urlTokens(path, lang)}${this.urlTokens(query, lang)}${this.urlTokens(frag, lang)}`;
      this.memo.set(key, out);
    }
    return this.claimPlain('url', orig, out);
  }

  private urlTokens(s: string, lang: Lang): string {
    if (!s) return s;
    return s.replace(URL_TOKEN, (tok, local?: string, at?: string, dom?: string) => {
      if (local !== undefined && at !== undefined && dom !== undefined) {
        return `${this.localFake(local, lang)}${at}${this.domain(dom, lang)}`;
      }
      if (/\d/.test(tok) && /^[A-Za-z0-9]+$/.test(tok)) return this.digitsLike(tok, false);
      const mapped = this.tokenFake.get(nameKey(tok));
      return mapped ? adaptCase(tok, mapped) : tok;
    });
  }

  // ----------------------------------------------------- phone / iban / id

  /** The international prefix and the national number of a written phone number. */
  private static phoneParts(raw: string): { lead: number; cc: string; national: string } {
    const digits = raw.replace(/\D/g, '');
    let cc = '';
    if (/^\s*(\+|00)/.test(raw)) {
      const rest = raw.replace(/^\s*(\+|00)/, '').replace(/\D/g, '');
      for (let n = 3; n >= 1; n--) {
        if (N.COUNTRY_CODES.has(rest.slice(0, n))) {
          cc = rest.slice(0, n);
          break;
        }
      }
      if (!cc) cc = rest.slice(0, 2);
    }
    const lead = /^\s*00/.test(raw) ? 2 : 0;
    return { lead, cc, national: digits.slice(lead + cc.length) };
  }

  /**
   * A fake national number that keeps what kind of line it is, in a range no
   * subscriber holds where the country has one. A Spanish mobile (6, or 7 and
   * a digit other than 0) becomes 75 to 79, which the plan keeps in reserve for
   * mobiles and has not attributed. A UK mobile becomes 7700 900000 to 900999
   * and a North American number NXX-555-0100 to 0199, the ranges Ofcom and
   * NANPA keep for fiction. These have no such range and keep live digits: a
   * Spanish landline (81 to 88 or 91 to 98), a special-rate number (70x, 800,
   * 900, 902, which keeps its three digits), any other UK number (its two
   * leading digits, after the 0 when written nationally), and any other
   * country (a leading 0 and the digit after it, and with a country code its
   * first digit).
   */
  private phoneNational(cc: string, national: string): string {
    const r = this.rng.digits;
    const any = (): string => String(r.digit());
    const from = (digits: string): string => digits[r.int(digits.length)] as string;
    const rest = (out: string): string => {
      while (out.length < national.length) out += any();
      return out;
    };
    for (let attempt = 0; attempt < 50; attempt++) {
      let out: string;
      if ((cc === '34' || cc === '') && /^[6-9]\d{8}$/.test(national)) {
        const first = national[0] as string;
        if (first !== '6' && national[1] === '0') out = rest(national.slice(0, 3));
        else out = rest(first === '6' || first === '7' ? `7${from('56789')}` : first + from('12345678'));
      } else if (cc === '44' && /^[1-9]\d{8,9}$/.test(national)) {
        out = national[0] === '7' && national.length === 10 ? rest('7700900') : rest(national.slice(0, 2));
      } else if (cc === '' && /^0\d{9,10}$/.test(national)) {
        out = national[1] === '7' && national.length === 11 ? rest('07700900') : rest(national.slice(0, 3));
      } else if ((cc === '1' || cc === '') && /^[2-9]\d{2}[2-9]\d{6}$/.test(national)) {
        // An NXX area code, never N11 and never a 9 in the middle, then 555-01XX.
        let area: string;
        do area = from('23456789') + from('012345678') + any();
        while (area.slice(1) === '11');
        out = rest(`${area}55501`);
      } else {
        out = cc ? rest(national.slice(0, 1)) : this.digitsLike(national, false);
        if (!cc && /^0\d/.test(national)) out = national.slice(0, 2) + out.slice(2);
      }
      if (out !== national) return out;
    }
    return this.digitsLike(national, false);
  }

  phone(raw: string, orig: string = raw): string {
    const { lead, cc, national } = Surrogates.phoneParts(raw);
    return this.claimDigits('phone', orig, (n) => {
      const fakeNat = this.memoized(`nat|${national}`, n, () => this.phoneNational(cc, national));
      let seen = 0;
      let used = 0;
      let out = '';
      for (const ch of raw) {
        if (!/\d/.test(ch)) {
          out += ch;
          continue;
        }
        if (seen < lead + cc.length) {
          out += ch;
          seen++;
        } else {
          out += fakeNat[used++] ?? ch;
        }
      }
      return out;
    });
  }

  private ibanCheck(country: string, bban: string): string {
    const num = (bban + country + '00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    const mod = Number(BigInt(num) % 97n);
    return String(98 - mod).padStart(2, '0');
  }

  iban(raw: string, orig: string = raw): string {
    const compact = raw.replace(/\s/g, '').toUpperCase();
    return this.claimDigits('iban', orig, (n) => {
      const fake = this.memoized(`iban|${compact}`, n, () => {
        const country = compact.slice(0, 2);
        const bban = this.digitsLike(compact.slice(4), false);
        return country + this.ibanCheck(country, bban) + bban;
      });
      let i = 0;
      let out = '';
      for (const ch of raw) out += ch === ' ' ? ch : (fake[i++] ?? ch);
      return out;
    });
  }

  /**
   * A fake with the layout of `raw`. `reject` says a draw spells a value the
   * leak check would report (`RIO` beside a known `Río`); such a draw is taken
   * again, up to ID_ATTEMPTS times, and the last one stays.
   */
  id(raw: string, orig: string = raw, reject: (fake: string) => boolean = () => false): string {
    return this.claimDigits('id', orig, (n) => this.memoized(`id|${raw.toLowerCase()}`, n, () => {
      let fake = this.digitsLike(raw, false);
      for (let i = 1; i < ID_ATTEMPTS && reject(fake); i++) fake = this.digitsLike(raw, false);
      return fake;
    }));
  }

  /**
   * A fake that passes the same check as `raw` and keeps what kind of value it
   * is (card network, NIE letter, CIF type, VAT country). The same value in
   * another layout ("4111 1111 ..." and "4111-1111-...") gets the same fake.
   */
  typedId(raw: string, scheme: IdScheme, orig: string = raw): string {
    const ip = scheme === 'ipv4' || scheme === 'ipv6';
    const canon = scheme === 'ipv6' ? (parseIpv6(raw) ?? []).join(':') : scheme === 'ipv4' ? raw : compact(raw);
    const fakeOf = (n: number): string => {
      const fake = this.memoized(`tid|${scheme}|${canon}`, n, () => {
        let f = '';
        for (let i = 0; i < 1000; i++) {
          f = fakeId(ip ? raw : compact(raw), scheme, this.rng.typed);
          if (this.free(f)) break;
        }
        return this.take(f);
      });
      return ip ? fake : renderLikeId(raw, fake);
    };
    // An IPv6 address written in another layout is the same address in another letter case of its hex digits.
    if (scheme === 'ipv6') return this.claimPlain('id', orig, fakeOf(0));
    return this.claimDigits('id', orig, fakeOf);
  }

  // ------------------------------------------------------------- continuing

  /**
   * Load the pairs of an earlier call, so a value seen before gets the same
   * fake again and a new value never gets a fake that is already taken. The
   * first pair of a value holds its base fake. A later pair of the same value
   * with another fake is a spelling that got a base of its own.
   */
  restore(pairs: readonly Pair[]): void {
    const keep = (key: string, fake: string, kind: Kind, real: string): void => {
      const had = this.memo.get(key);
      if (had === undefined) this.memo.set(key, fake);
      else if (had.toLowerCase() !== fake.toLowerCase()) this.memo.set(`spell|${kind}|${real.toLowerCase()}`, fake);
    };
    for (const p of pairs) {
      const real = p.real;
      const fake = p.fake;
      switch (p.kind) {
        case 'person': {
          const key = nameKey(real);
          const base = uniformToTitle(fake);
          const had = this.tokenFake.get(key);
          // A new spelling of this word later gets a fake in the same language.
          const lang = fakeLanguage(base);
          if (lang && !this.tokenLang.has(key)) this.tokenLang.set(key, lang);
          if (had === undefined) this.tokenFake.set(key, base);
          else if (had.toLowerCase() !== base.toLowerCase()) this.memo.set(`spell|person|${real.toLowerCase()}`, base);
          this.take(fake);
          break;
        }
        case 'org':
          if (!N.ORG_SUFFIX.test(real)) keep(`org|${asciiLower(real)}`, canonicalName(fake), 'org', real);
          // A Spanish fake leads with its noun ("Asesores Lumera"), so every word is taken.
          for (const w of fake.split(/\s+/)) this.take(w);
          break;
        case 'place':
          keep(`place|${asciiLower(real)}`, canonicalName(fake), 'place', real);
          this.take(fake);
          break;
        case 'domain':
          if (!this.memo.has(`domain|${real.toLowerCase()}`)) this.memo.set(`domain|${real.toLowerCase()}`, fake.toLowerCase());
          this.take(fake);
          break;
        case 'email':
          if (!this.memo.has(`email|${real.toLowerCase()}`)) this.memo.set(`email|${real.toLowerCase()}`, fake);
          break;
        case 'url':
          if (!this.memo.has(`url|${real}`)) this.memo.set(`url|${real}`, fake);
          break;
        case 'phone': {
          const r = Surrogates.phoneParts(real);
          const f = Surrogates.phoneParts(fake);
          if (r.national.length === f.national.length && !this.memo.has(`nat|${r.national}`)) this.memo.set(`nat|${r.national}`, f.national);
          break;
        }
        case 'iban': {
          const key = `iban|${real.replace(/\s/g, '').toUpperCase()}`;
          if (!this.memo.has(key)) this.memo.set(key, fake.replace(/\s/g, '').toUpperCase());
          break;
        }
        case 'id': {
          const typed = detectIds(real);
          const t = typed.length === 1 && typed[0]!.start === 0 && typed[0]!.end === real.length ? typed[0]!.scheme : null;
          const key = t === 'ipv4' || t === 'ipv6'
            ? `tid|${t}|${t === 'ipv6' ? (parseIpv6(real) ?? []).join(':') : real}`
            : t ? `tid|${t}|${compact(real)}` : `id|${real.toLowerCase()}`;
          if (!this.memo.has(key)) this.memo.set(key, t && t !== 'ipv4' && t !== 'ipv6' ? compact(fake) : fake);
          this.take(fake);
          break;
        }
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------- for unblind

  /** Letters seen as first names, used to spot invented names in a reply. */
  static firstNameSet(): Set<string> {
    return FIRST_NAMES;
  }
}

const FIRST_NAMES = new Set([...N.FEMALE_FIRST, ...N.MALE_FIRST].map(asciiLower));
