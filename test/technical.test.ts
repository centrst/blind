import { describe, expect, it } from 'vitest';
import { builtinDetectors, findSpans } from '../src/detect.js';
import { blind } from '../src/index.js';
import type { DetectContext } from '../src/types.js';

// Every name, number and reference is invented.
const ctx: DetectContext = { dateOrder: 'dmy', isAllowedHost: () => false };
const ids = (text: string): string[] =>
  (findSpans([text], ctx, builtinDetectors)[0] ?? []).filter((s) => s.kind === 'id').map((s) => text.slice(s.start, s.end));

const TECHNICAL = [
  'gpt-4o-2024-08-06',
  'claude-3-5-sonnet-20241022',
  'llama-3.1-70b-instruct',
  '3f9a2c7',
  '9b1e4c2d7a6f80513e2d4b9c7a1f0e3d5c8b2a64',
  '6f1c2b9e-4d3a-4e8f-9b7c-2a1d5e6f7c80',
  '6F1C2B9E-4D3A-4E8F-9B7C-2A1D5E6F7C80',
  '2.14.3',
  'v3.0.0-rc.1',
  '#1f6feb',
  '#ff0000',
  'src/v2024/parser1234.ts',
  './build/output-20241102.log',
  'release-2026-01-15',
  'backup-2024-11-02T0315',
  'SKU-4417-BLK',
  'SKU: 100234',
];

describe('technical text', () => {
  it('C57: model names, git SHAs, UUIDs, versions, hex colours, file paths, dated names and SKUs are not ids', () => {
    for (const t of TECHNICAL) {
      const text = `See ${t} for the details.`;
      expect(ids(text), t).toEqual([]);
      expect(blind([text], { seed: 's' }).texts[0], t).toBe(text);
    }
  });

  it('C57: a run of digits inside technical text is part of it, the same digits alone an id', () => {
    expect(ids('claude-3-5-sonnet-20241022 and 20241022')).toEqual(['20241022']);
    expect(ids('6f1c2b9e-4d3a-4e8f-9b7c-123456789012')).toEqual([]);
  });

  it('C57: private ids beside technical text are still replaced', () => {
    const cases: Array<[string, string, string]> = [
      ['order ref', 'Ref: ORD-2026-88412 is ready.', 'ORD-2026-88412'],
      ['lower-case order ref, its number no date', 'Your order ord-2026-88412 ships tomorrow.', 'ord-2026-88412'],
      ['lower-case ref with a short year and number', 'Case exp-2026-7670 is open.', 'exp-2026-7670'],
      ['digits after a hash', 'Order #123456 was refunded.', '123456'],
      ['bare order number', 'Your order 4815162342 ships tomorrow.', '4815162342'],
      ['product code without a SKU mark', 'One WX-2290-M is on back order.', 'WX-2290-M'],
      ['hex after a label', 'Account no. 3f9a2c7d is closed.', '3f9a2c7d'],
      ['letter then digits, hex shaped', 'Code b81866723 on the form.', 'b81866723'],
      ['digits then one letter, hex shaped', 'Code 12345690a on the form.', '12345690a'],
      ['invoice path', 'Saved as invoices/4815162342.pdf today.', '4815162342'],
      ['card', 'Card 4111 1111 1111 1111 expires soon.', '4111 1111 1111 1111'],
      ['SSN', 'SSN 552-83-7741 on file.', '552-83-7741'],
      ['IBAN GB', 'Pay GB82 WEST 1234 5698 7654 32 today.', 'GB82 WEST 1234 5698 7654 32'],
      ['IBAN ES', 'IBAN ES91 2100 0418 4502 0005 1332.', 'ES91 2100 0418 4502 0005 1332'],
      ['DNI', 'Mi DNI es 12345678Z.', '12345678Z'],
      ['DNI lower case', 'DNI 12345690a del socio.', '12345690a'],
      ['NIE', 'NIE X1234567L en vigor.', 'X1234567L'],
      ['CIF', 'CIF B81866723 de la empresa.', 'B81866723'],
      ['VAT', 'VAT ESB81866723 on the invoice.', 'ESB81866723'],
    ];
    for (const [what, text, value] of cases) {
      const out = blind([`${text} Build gpt-4o-2024-08-06, commit 3f9a2c7.`], { seed: 's' }).texts[0] as string;
      expect(out, what).not.toContain(value);
      expect(out, what).toContain('gpt-4o-2024-08-06, commit 3f9a2c7.');
    }
  });
});
