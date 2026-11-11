import { describe, expect, it } from 'vitest';
import { builtinDetectors, findSpans } from '../src/detect.js';
import { blind, unblind } from '../src/index.js';
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
      ['DNI behind a SKU mark', 'Pack SKU-12345678Z for the client.', '12345678Z'],
      ['card behind a SKU mark', 'Pack SKU-4111111111111111 for the client.', '4111111111111111'],
      ['NIE in a lower-case name', 'Saved as alta-x1234567l.pdf today.', 'x1234567l'],
      ['SSN behind a SKU mark', 'Pack SKU-552-83-7741 for the client.', '552-83-7741'],
      ['DNI deeper in a SKU', 'Pack SKU-AB-12345678Z for the client.', '12345678Z'],
      ['SSN in a lower-case name', 'Saved as release-552-83-7741 today.', '552-83-7741'],
      ['card in a lower-case name', 'Saved as build-4111-1111-1111-1111 today.', '4111-1111-1111-1111'],
    ];
    for (const [what, text, value] of cases) {
      const out = blind([`${text} Build gpt-4o-2024-08-06, commit 3f9a2c7.`], { seed: 's' }).texts[0] as string;
      expect(out, what).not.toContain(value);
      expect(out, what).toContain('gpt-4o-2024-08-06, commit 3f9a2c7.');
    }
  });

  it('C57: an explicit id label replaces the whole technical token beyond the 24-character label window', () => {
    const values = [
      '6f1c2b9e-4d3a-4e8f-9b7c-123456789012',
      '9b1e4c2d'.repeat(8),
      'summariser-release-2026-01-15',
    ];
    for (const value of values) {
      const text = `Account no. ${value} is closed.`;
      expect(ids(text), value).toEqual([value]);
      const result = blind([text], { seed: 'labelled-technical' });
      expect(result.mapping.pairs.some((p) => p.kind === 'id' && p.real === value), value).toBe(true);
      expect(result.texts[0], value).not.toContain(value.slice(24));
      expect(result.texts[0], value).toMatch(/ is closed\.$/u);
      expect(result.leaks.ok, value).toBe(true);
      expect(unblind(result.texts[0]!, result.mapping).text, value).toBe(text);
      expect(ids(`See ${value} for details.`), value).toEqual([]);
    }
  });

  it('C57: a typed id inside a SKU keeps the fake it gets alone, which passes its check', () => {
    const out = blind(['Pack SKU-12345678Z, and DNI 12345678Z.'], { seed: 's' }).texts[0] as string;
    const [inSku, alone] = [/SKU-(\d{8}[A-Z])/.exec(out)?.[1], /DNI (\d{8}[A-Z])/.exec(out)?.[1]];
    expect(inSku).toBeDefined();
    expect(inSku).toBe(alone);
    expect(inSku).not.toBe('12345678Z');
    expect(inSku![8]).toBe('TRWAGMYFPDXBNJZSQVHLCKE'[Number(inSku!.slice(0, 8)) % 23]);
  });

  it('C41/C57: a long token marked as a SKU and full of typed ids stays linear and leaves none behind', () => {
    const text = `SKU-${'12345678Z-'.repeat(50_000)}12345678Z`;
    const start = performance.now();
    const out = blind([text], { seed: 's' }).texts[0] as string;
    expect(performance.now() - start).toBeLessThan(3000);
    expect(out).not.toContain('12345678Z');
  });

  it('C41/C57: thousands of technical tokens and digit runs between them stay linear', () => {
    const text = 'release-2026-01-15 3f9a2c7 4815162342 '.repeat(30_000);
    const start = performance.now();
    const found = ids(text);
    expect(performance.now() - start).toBeLessThan(3000);
    expect(found).toHaveLength(30_000);
  });
});
