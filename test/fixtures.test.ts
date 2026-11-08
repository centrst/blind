import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/prng.js';
import { lintCodeText, lintCorpusText, ROOT } from './support/corpus.js';
import { emailCase, shapeCase, srcFrom } from './support/gen.js';
import { idCase } from './support/ids-gen.js';
import { check, mobileCase, quotes, spellingCase } from './support/properties.js';
import { makeEmail, makeIban, makePerson, makePhone, pick, reservedPhone, unownableMailbox } from './support/values.js';

const SELF = 'test/fixtures.test.ts';

/**
 * Literals that fail the corpus lint on purpose. Each one names its file, the
 * flagged text, and why it stays. The values repeat here, so this file may
 * hold any of them or a part of one. A phone outside the reserved ranges may
 * stand here only as one of the lint's own negative examples in
 * `test/corpus.test.ts` (checked below); a test that needs a live prefix builds
 * the rest of the number at run time.
 */
const NEGATIVE_EXAMPLES = 'test/corpus.test.ts';
const PHONE_HIT = /^phone outside the reserved ranges /;
const ALLOWED: Array<{ file: string; value: string; reason: string }> = [
  { file: 'test/corpus.test.ts', value: 'rejected-mail.invalid', reason: 'proves the lint refuses a private host outside .example' },
  { file: 'test/corpus.test.ts', value: 'www.rejected-link.invalid', reason: 'proves the lint refuses a private link host outside .example' },
  { file: 'test/corpus.test.ts', value: 'anabelenquintanarebollodelasierraruiz@gmail.com', reason: 'proves the lint refuses a Gmail mailbox of plain letters; at 37 letters it is over the 30 Gmail allows, so no one holds it' },
  { file: 'test/corpus.test.ts', value: 'anabelenquintanarebollodelasierra..ruiz@gmail.com', reason: 'proves a doubled dot does not make a Gmail mailbox unownable; Gmail ignores dots, and the 37 letters left are over its 30' },
  { file: 'test/corpus.test.ts', value: '+34 612 345 678', reason: 'proves the lint refuses a Spanish mobile in a live range; a 75 to 79 number passes, so only a live one shows the refusal' },
  { file: 'test/corpus.test.ts', value: '(415) 555-0234', reason: 'proves the lint refuses a 555 number outside 555-01xx; a 555-01xx number passes, so the line must sit just outside it' },
  { file: 'test/corpus.test.ts', value: '+44 7911 123456', reason: 'proves the lint refuses a UK mobile outside 07700 900xxx; a 07700 900xxx number passes, so only a live one shows the refusal' },
  { file: 'test/safety.test.ts', value: 'my-domain.examples', reason: 'proves *@domain deny entries do not match a longer suffix; .examples is no TLD' },
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : tsFiles(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}

interface Scan {
  files: number;
  /** Each lint finding not on the list, as file, line and message. */
  bad: string[];
  /** Each list entry a finding outside this file matched, with whether that finding was a phone. */
  used: Map<number, { phone: boolean }>;
}

/** Lints every string literal under test/, ner/test/ and scripts/ against the list. Run once, shared by the tests below. */
let scanned: Scan | undefined;
function scan(): Scan {
  if (scanned) return scanned;
  const files = ['test', 'ner/test', 'scripts'].flatMap((d) => tsFiles(join(ROOT, d)));
  const used = new Map<number, { phone: boolean }>();
  const bad: string[] = [];
  for (const path of files) {
    const file = relative(ROOT, path).split('\\').join('/');
    for (const hit of lintCodeText(readFileSync(path, 'utf8'), path)) {
      const i = ALLOWED.findIndex((a) => (file === SELF ? a.value.includes(hit.value) : a.file === file && a.value === hit.value));
      if (i < 0) bad.push(`${file}:${hit.line}: ${hit.message}`);
      else if (file !== SELF) used.set(i, { phone: (used.get(i)?.phone ?? false) || PHONE_HIT.test(hit.message) });
    }
  }
  scanned = { files: files.length, bad, used };
  return scanned;
}

describe('fixtures in code', () => {
  it('C46: every string literal under test/, ner/test/ and scripts/ passes the corpus lint, except the listed negative examples', () => {
    const { files, bad, used } = scan();
    expect(files).toBeGreaterThan(20);
    expect(bad).toEqual([]);
    // An entry nothing needs any more goes.
    expect(ALLOWED.filter((_, i) => !used.has(i)).map((a) => `${a.file}: ${a.reason}`)).toEqual([]);
  });

  it('C46: the list admits a phone outside the reserved ranges only as a negative example of the lint itself', () => {
    // A test that needs a live prefix writes the prefix and draws the rest at run time, so no complete live number
    // is in the tree. Only a test proving the lint refuses a live number needs one written out, and those live in
    // NEGATIVE_EXAMPLES. Checked both on the value alone and on what the scan matched it to.
    const { used } = scan();
    const phones = ALLOWED.flatMap((a, i) =>
      used.get(i)?.phone || lintCorpusText(a.value).some((m) => PHONE_HIT.test(m)) ? [a] : [],
    );
    expect(phones.length).toBeGreaterThan(0);
    expect(
      phones.filter((a) => a.file !== NEGATIVE_EXAMPLES || !a.reason.startsWith('proves the lint refuses')).map((a) => `${a.file}: ${a.reason}`),
    ).toEqual([]);
    const negatives = readFileSync(join(ROOT, NEGATIVE_EXAMPLES), 'utf8');
    for (const a of phones) expect(negatives.includes(a.value), a.reason).toBe(true);
  });

  it('C46: the code lint reads literals, not the code around them', () => {
    expect(lintCodeText("const a = 'Call +34 612 345 678';").map((h) => [h.line, h.message])).toEqual([[1, 'phone outside the reserved ranges at offset 5']]);
    // A live 6xx mobile as a bare number in code is not read. Only its 6 is written; the rest is drawn at run time.
    const rng = new Rng('C46 bare number');
    const bare = `6${Array.from({ length: 8 }, () => rng.int(10)).join('')}`;
    expect(lintCodeText(`f(${bare}, '\\n' + 'anabelenquintanarebollodelasierraruiz@gmail.com');`)).toHaveLength(1);
    expect(lintCodeText(`f('${bare}');`)).toHaveLength(1);
    // Split so this file's own literal stays short of a phone.
    expect(lintCodeText('const t = `ring +44 7700 9' + '00${n} or +49 171 ' + '${n} or x_y@gmail.com`;')).toEqual([]);
    expect(lintCodeText("const t = 'Call +34 791 345 678, (415) 555-0123 or ana@gestoria.example';")).toEqual([]);
  });
});

/** A failure report with nothing in it but numbers: every property below quotes its input in its error or returns false. */
const SHAPE = String.raw`(?:string of \d+|array of \d+|object of \d+ keys|number|boolean|null)`;
const REPORT = new RegExp(
  String.raw`^property failed after \d+ runs and \d+ shrinks\. Replay with SEED=-?\d+ NUM_RUNS=50 FC_PATH=[\d:]+\n` +
    String.raw`cause: (?:Error with a message of \d+ characters, withheld because it may quote a generated value|Error: Property failed by returning false|the property returned false)\n` +
    String.raw`counterexample: ${SHAPE}(?:, ${SHAPE})* \(values not shown\)$`,
);
const WORDING =
  /property failed after | runs and | shrinks\. Replay with SEED=| NUM_RUNS=| FC_PATH=|\ncause: |Error with a message of | characters, withheld because it may quote a generated value|Error: Property failed by returning false|the property returned false|\ncounterexample: |string of |array of |object of | keys|number|boolean|null|, | \(values not shown\)/g;

describe('generated values', () => {
  const sample = <T>(arb: fc.Arbitrary<T>): T[] => fc.sample(arb, { numRuns: 1000, seed: 46 });
  const fromSrc = <T>(f: (s: ReturnType<typeof srcFrom>) => T): fc.Arbitrary<T> => fc.gen().map((g) => f(srcFrom(g)));

  it('C46: the generators behind the properties make phones in the reserved ranges and mailboxes no one can own, over 1,000 values each', () => {
    const live = (xs: string[]): number => xs.filter((x) => !reservedPhone(x)).length;
    expect(live(sample(mobileCase).map((m) => m.phone))).toBe(0);
    expect(live(sample(fromSrc(makePhone)))).toBe(0);
    for (const host of ['gmail.com', 'googlemail.com', 'outlook.com', 'icloud.com', 'larkmoor-works.example']) {
      const mail = sample(fromSrc((s) => makeEmail(s, makePerson(s, pick(s, ['en', 'es'] as const)), host)));
      expect(mail.filter((m) => !unownableMailbox(m.slice(0, m.lastIndexOf('@')), host)).length, host).toBe(0);
    }
    // The texts the properties feed blind, linted like the corpus: every phone, mailbox and host in them.
    const texts = [...sample(emailCase).map((c) => c.text), ...sample(spellingCase).map((c) => c.text), ...sample(shapeCase).map((c) => c.value)];
    expect(texts.filter((t) => lintCorpusText(t).length > 0).length).toBe(0);
  });

  it('C46: a failing property reports the seed, the path and the kind and length of each input, never the input', () => {
    // Cards, ids, IBANs and whole emails have no reserved range to draw from, so these failures must not print them.
    const seen: string[] = [];
    const failing = [
      fc.property(idCase, (c) => {
        seen.push(c.value);
        throw new Error(`bad id ${c.value}`);
      }),
      fc.property(fromSrc(makeIban), (iban) => {
        seen.push(iban);
        throw new Error(`bad IBAN ${iban.replace(/\s/g, '')}`);
      }),
      fc.property(emailCase, fc.nat(), (c, n) => {
        seen.push(c.text);
        throw new Error(c.text.slice(n % Math.max(1, c.text.length - 20), (n % Math.max(1, c.text.length - 20)) + 20));
      }),
      fc.property(mobileCase, (m) => {
        seen.push(m.phone);
        return false;
      }),
      fc.property(fc.string({ unit: 'binary', minLength: 8, maxLength: 60 }), (t) => {
        seen.push(t);
        throw new Error(t);
      }),
    ];
    for (const p of failing) {
      seen.length = 0;
      let message = '';
      try {
        check(p as fc.IPropertyWithHooks<unknown[]>, { numRuns: 50 });
      } catch (e) {
        message = (e as Error).message;
      }
      // Booleans only, so a failure here never prints the message. The reporter's own words are masked before
      // looking for a slice, since a generated email can hold " number " or " characters" too.
      expect(seen.length).toBeGreaterThan(0);
      expect(quotes(message.replace(WORDING, '\u0000'), seen)).toBe(false);
      expect(REPORT.test(message)).toBe(true);
    }
  });

  it('C46: every property runs through check, so none reports its input another way', () => {
    const direct = new RegExp(String.raw`\bfc\.(?:assert|check)\(`);
    const files = ['test', 'scripts'].flatMap((d) => tsFiles(join(ROOT, d))).map((p) => relative(ROOT, p).split('\\').join('/'));
    const callers = files.filter((f) => direct.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(callers).toEqual(['test/support/properties.ts']);
  });
});

