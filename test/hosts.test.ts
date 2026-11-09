import { describe, expect, it } from 'vitest';
import { assertNoLeaks, blind, checkMapping, unblind } from '../src/index.js';
import { builtinDetectors, findSpans } from '../src/detect.js';

describe('bare private hosts', () => {
  for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
    it.each([
      'portal.lindera.example',
      'billing.lindera.example/pay',
      'lindera.example',
      'https://portal.lindera.example/login',
      'Portal.Lindera.example:8443/pay?ref=ZX984276#receipt',
      'billing.lindera.example/pay?mail=mara@lindera.example',
    ])(`C1: ${replaceWith} replaces and restores %s beside an email`, (host) => {
      const text = `Write to mara@lindera.example or use (${host}).`;
      const r = blind([text], { replaceWith, seed: 'bare-hosts' });
      expect(r.texts[0]).not.toContain('lindera.example');
      expect(r.texts[0]).toMatch(/\)\.$/);
      expect(r.mapping.pairs).toContainEqual(expect.objectContaining({ kind: 'url', real: host }));
      expect(() => assertNoLeaks(r)).not.toThrow();
      expect(() => checkMapping(r.mapping)).not.toThrow();
      expect(unblind(r.texts[0]!, r.mapping).text).toBe(text);
      if (replaceWith === 'placeholder') expect(r.texts[0]).toBe('Write to [REDACTED_EMAIL_1] or use ([REDACTED_URL_1]).');
    });
  }

  it('C1: finds hosts before their email and across texts, including escaped email separators', () => {
    for (const at of ['@', '%40', '&#64;', '&#x40;']) {
      const texts = ['billing.lindera.example/pay', `Write to mara${at}lindera.example`];
      const r = blind(texts, { replaceWith: 'placeholder' });
      expect(r.texts).toEqual(['[REDACTED_URL_1]', 'Write to [REDACTED_EMAIL_1]']);
      expect(r.leaks.ok).toBe(true);
      expect(r.texts.map((t) => unblind(t, r.mapping).text)).toEqual(texts);
    }
  });

  it('matches whole hosts and subdomains, never prefixes, longer suffixes or embedded words', () => {
    const hosts = [
      'lindera.example', 'portal.lindera.example/pay',
      'otherlindera.example', 'other-lindera.example', 'lindera.example.extra',
      'lindera.example-extra', 'lindera.example2', '_lindera.example', 'élindera.example',
      'lindera.exampleé', 'unrelated.example',
    ];
    const texts = ['mara@lindera.example', hosts.join(' ')];
    const spans = findSpans(texts, { dateOrder: 'dmy', isAllowedHost: () => false }, builtinDetectors);
    expect(spans[1]!.map((s) => texts[1]!.slice(s.start, s.end))).toEqual(hosts.slice(0, 2));
  });

  it('keeps allowed domains and their bare paths unchanged', () => {
    const text = 'mara@lindera.example portal.lindera.example/pay lindera.example';
    const r = blind([text], { replaceWith: 'placeholder', allowDomains: ['lindera.example'] });
    expect(r.texts).toEqual(['[REDACTED_EMAIL_1] portal.lindera.example/pay lindera.example']);
    expect(r.leaks.ok).toBe(true);
  });

  it('C1: learns private hosts from explicit URLs without broadening to parents or siblings', () => {
    const texts = ['portal.lindera.example/pay', 'https://portal.lindera.example/login'];
    const r = blind(texts, { replaceWith: 'placeholder' });
    expect(r.texts).toEqual(['[REDACTED_URL_1]', '[REDACTED_URL_2]']);
    expect(r.leaks.ok).toBe(true);
    expect(r.texts.map((t) => unblind(t, r.mapping).text)).toEqual(texts);
    const untouched = ['lindera.example billing.lindera.example', texts[1]!];
    const other = blind(untouched, { replaceWith: 'placeholder' });
    expect(other.texts[0]).toBe(untouched[0]);
    expect(other.leaks.ok).toBe(true);
  });

  it('C1: replaces a hostname again without consuming adjacent punctuation', () => {
    const text = 'mara@lindera.example <portal.lindera.example>, portal.lindera.example!';
    const r = blind([text], { replaceWith: 'placeholder' });
    expect(r.texts).toEqual(['[REDACTED_EMAIL_1] <[REDACTED_URL_1]>, [REDACTED_URL_1]!']);
    expect(r.leaks.ok).toBe(true);
    expect(unblind(r.texts[0]!, r.mapping).text).toBe(text);
  });
});
