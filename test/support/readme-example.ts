/**
 * The examples in README.md, produced by running blind on invented text with a
 * fixed seed. `pnpm readme:example` writes them into the README between the
 * `<!-- example:NAME -->` markers, and test/readme.test.ts fails when the README
 * and this output differ, so the examples always show what the code does.
 */
import { blind, unblind } from '../../src/index.js';

const SEED = 'readme';

const EMAIL = [
  'From: Sophia Ward <sophia@ward-bookkeeping.example>',
  'Hi Ben, here is the invoice from Moorcroft Joinery Ltd.',
  'Total: £1,240.80 (£1,034.00 + 20% VAT), due on 3 March 2026.',
  'IBAN GB82 WEST 1234 5698 7654 32, card 4111 1111 1111 1111 12/28.',
  'Policy number 48213907. Call me on +44 7700 900123. Thanks, Sophia',
].join('\n');

const KNOWN = [{ kind: 'person' as const, value: 'Ben Carver' }];

const fence = (body: string): string => `\`\`\`\n${body}\n\`\`\``;

export function readmeExamples(): Record<string, string> {
  const first = blind([EMAIL], { known: KNOWN, seed: SEED });
  const blindEmail = first.texts[0] as string;

  // The opening shows the sender and total lines only, stacked so it fits a narrow page.
  const pick = (t: string): string[] => t.split('\n').filter((_, i) => i === 0 || i === 2);
  const [r0, r2] = pick(EMAIL);
  const [b0, b2] = pick(blindEmail);
  const opening = [`real   ${r0}`, `       ${r2}`, `blind  ${b0}`, `       ${b2}`].join('\n');

  const question = 'Has Sophia paid the £1,034.00 yet?';
  const second = blind([question], { mapping: first.mapping });

  const fakeName = /^From: (\S+)/.exec(blindEmail)?.[1] as string;
  const fakeTotal = /Total: (£[\d.,]+)/.exec(blindEmail)?.[1] as string;
  const fakeDue = /due on (.+?)\./.exec(blindEmail)?.[1] as string;
  const answer = `Yes, ${fakeName} paid ${fakeTotal} on ${fakeDue}. A card fee of £25.00 is still unpaid.`;
  const back = unblind(answer, second.mapping);

  return {
    opening: fence(opening),
    full: fence(`real\n${EMAIL}\n\nblind\n${blindEmail}`),
    turn: fence(`next turn, real    ${question}\nnext turn, blind   ${second.texts[0] as string}`),
    answer: fence(
      [`model answer   ${answer}`, `unblinded      ${back.text}`, `invented       ${JSON.stringify(back.invented)}`].join('\n'),
    ),
  };
}

/** The sender and total lines of the same email in each `replaceWith` mode, for the comparison in the README. */
export function modesExample(): string {
  const lines = (t: string): string[] => t.split('\n').filter((_, i) => i === 0 || i === 2);
  const rows: Array<[string, string]> = [['real', EMAIL]];
  for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
    rows.push([replaceWith, blind([EMAIL], { known: KNOWN, seed: SEED, replaceWith }).texts[0] as string]);
  }
  return fence(rows.flatMap(([label, t]) => lines(t).map((l, i) => `${(i === 0 ? label : '').padEnd(13)}${l}`)).join('\n'));
}

// The Spanish example on docs/languages/spanish.md: the invoice that used to open the README.
const SPANISH_SEED = 'readme';

const SPANISH_EMAIL = [
  'From: Ana Ruiz <ana@gestoria-norte.example>',
  'Hola Pablo, te paso la factura de Gestoría Norte S.L.',
  'Total: 247,80 € (cuota 206,50 € + 20 %), vence el 3 de marzo de 2026.',
  'IBAN ES91 2100 0418 4502 0005 1332, tarjeta 4111 1111 1111 1111 12/28.',
  'DNI 12345678Z. Llámame al +34 761 234 508. Un saludo, Ana',
].join('\n');

const SPANISH_KNOWN = [{ kind: 'person' as const, value: 'Pablo Mena' }];

/** The Spanish before and after, real output for the same input and seed every time. */
export function spanishExample(): string {
  const out = blind([SPANISH_EMAIL], { known: SPANISH_KNOWN, seed: SPANISH_SEED }).texts[0] as string;
  return fence(`real\n${SPANISH_EMAIL}\n\nblind\n${out}`);
}

/** docs/languages/spanish.md with its marked example replaced by the current output. */
export function withSpanishExample(doc: string): string {
  return doc.replace(/(<!-- example:spanish -->\n)[\s\S]*?(\n<!-- \/example -->)/, (_, open: string, close: string) => `${open}${spanishExample()}${close}`);
}

/** README text with every marked block replaced by the current output. */
export function withExamples(readme: string): string {
  const ex = readmeExamples();
  return readme
    .replace(/(<!-- example:(\w+) -->\n)[\s\S]*?(\n<!-- \/example -->)/g, (all, open: string, name: string, close: string) =>
      name in ex ? `${open}${ex[name] as string}${close}` : all,
    )
    .replace(/(<!-- modes -->\n)[\s\S]*?(\n<!-- \/modes -->)/, (_, open: string, close: string) => `${open}${modesExample()}${close}`);
}
