import { personTokens, stopWordValue } from './detect.js';
import { foldLookalikes, skeleton } from './fold.js';
import type { KnownValue, Mapping, PersonIdentity, Span } from './types.js';

const nameKey = (value: string): string => personTokens(skeleton(foldLookalikes(value)).text).join(' ');

/** A value has one owner or is unresolved. A conflict cannot be undone by another occurrence. */
function addOwner(owners: Map<string, string | null>, value: string, owner: string | null): void {
  owners.set(value, owners.has(value) && owners.get(value) !== owner ? null : owner);
}

/**
 * A legend for this call's placeholders. Detection and restoration do not
 * depend on it. Full names establish candidates before any short name is
 * assigned, so a mention's position cannot decide who it belongs to.
 */
export function placeholderIdentities(
  texts: readonly string[],
  spansByText: readonly Span[][],
  known: readonly KnownValue[],
  mapping: Mapping,
): PersonIdentity[] {
  const fullNames = new Set<string>();
  const candidates = [
    ...known.filter((k) => k.kind === 'person').map((k) => k.value),
    ...mapping.pairs.filter((p) => p.kind === 'person').map((p) => p.real),
  ];
  for (const value of candidates) {
    const key = nameKey(value);
    if (personTokens(key).length > 1) fullNames.add(key);
  }

  // Every part can make a short name ambiguous, even a surname. Only the
  // first part can establish a link. Initials and stop words never do.
  const owners = new Map<string, string | null>();
  const firstNames = new Set<string>();
  for (const full of fullNames) {
    const parts = personTokens(full);
    for (const part of parts) addOwner(owners, part, full);
    const first = parts[0]!;
    if ((first.match(/\p{L}/gu)?.length ?? 0) >= 2 && !first.includes('.') && !stopWordValue(first)) firstNames.add(first);
  }
  // A caller who lists a single name may mean another person with that name.
  for (const k of known) {
    const key = nameKey(k.value);
    if (k.kind === 'person' && personTokens(key).length === 1) addOwner(owners, key, key);
  }
  const ownerOfName = (value: string): string | undefined => {
    const key = nameKey(value);
    if (fullNames.has(key)) return key;
    return firstNames.has(key) ? owners.get(key) ?? undefined : undefined;
  };

  const pairs = new Map(mapping.pairs.map((p) => [`${p.kind}|${p.real}`, p]));
  const literals = new Set(mapping.literals ?? []);
  const groups = new Map<string, PersonIdentity>();
  const seenNames = new Set<string>();
  const emailOwners = new Map<string, string | null>();
  const emails = new Map<string, string>();
  spansByText.forEach((spans, ti) => {
    const text = texts[ti]!;
    for (const [i, span] of spans.entries()) {
      const real = text.slice(span.start, span.end);
      const pair = pairs.get(`${span.kind}|${real}`);
      if (!pair || literals.has(pair.fake.toUpperCase())) continue;
      if (span.kind === 'person') {
        const owner = ownerOfName(real);
        if (owner === undefined || seenNames.has(pair.fake)) continue;
        seenNames.add(pair.fake);
        const group = groups.get(owner) ?? { names: [], emails: [] };
        group.names.push(pair.fake);
        groups.set(owner, group);
      }
      if (span.kind !== 'email') continue;
      emails.set(real, pair.fake);
      const before = spans[i - 1];
      if (before?.kind !== 'person' && before?.kind !== 'org') continue;
      // Only a display-name mailbox supplies evidence, never a matching
      // local part or a nearby name in prose. Allow quoted display names.
      const gap = text.slice(before.end, span.start);
      if (!/^"?[ \t]*<[ \t]*$/.test(gap) || !/^[ \t]*>/.test(text.slice(span.end))) continue;
      const name = nameKey(text.slice(before.start, before.end));
      // A short or unresolved display name blocks an address link too.
      addOwner(emailOwners, real, before.kind === 'person' && fullNames.has(name) ? name : null);
    }
  });
  for (const [address, token] of emails) {
    const owner = emailOwners.get(address);
    const group = owner == null ? undefined : groups.get(owner);
    if (group) group.emails.push(token);
  }
  return [...groups.values()].filter((group) => group.names.length + group.emails.length > 1);
}
