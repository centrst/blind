# Threat model

This page says who blind protects against, what it replaces, what it only obscures, and what it does not cover. Read it before you send blind text somewhere you would not send the original.

## The adversary

The adversary is whoever reads the blind text but not the mapping:

- the service that receives it, such as a model API or a proxy in front of one,
- anyone who logs it on the way, in that service, a gateway, a tracing tool or a support system,
- anyone who later reads those logs, through a breach, a subpoena, a data sale or an employee with access.

They see every blind text you send, can keep it for years, and can bring outside knowledge: public records, a leaked invoice, a guess about who your clients are. They do not see the mapping, the seed or your `$BLIND_HOME/runs` files. Those hold the real values and stay on your side. If the adversary gets the mapping, blind protects nothing.

## What is replaced

Names, companies, emails, URLs on private domains, phone numbers, IBANs, card numbers, typed ids (SSN, DNI, NIE, CIF, EU VAT), generic ids and IP addresses are replaced by fakes, placeholders or random values. The fake carries nothing of the real value beyond its kind and shape: a card fake keeps its network and passes Luhn, an IBAN keeps its country, a name keeps its look. Reading the fake does not tell you the real value.

That holds only for values the detectors find. See [What is not covered](#what-is-not-covered).

## What is only obscured: amounts and dates

With the default `replaceWith: 'fake'`, amounts and dates are not replaced. They are scaled and shifted, on purpose, so a model can still add, compare and count days, and its answers map back.

- **Amounts.** Every amount in a conversation is multiplied by one factor between 0.6 and 1.6, in steps of 0.001. A draw within 0.05 of 1 (0.951 to 1.049, 99 values) is thrown away and drawn again, so 902 factors remain: 0.600 to 0.950 and 1.050 to 1.600. Each is about equally likely, near 1 in 900 (0.600 and 1.600 at half that), and none stands out as a better first guess.
- **Dates.** Every date in a conversation moves by one shift, a whole number of weeks between 1 and 10, forward or back. That is 20 possible shifts.

The factor and the shift are the same for every value in the call and, when you pass the mapping along, for every later turn. That is what keeps sums, percentages, weekdays and intervals true (C4, C5). It is also why they are weak against an informed reader:

- **One known amount reveals all of them.** If the adversary knows any one real amount in the text, say a list price, a fee in a public schedule or the amount on an invoice they also hold, dividing its fake by the real value gives the factor, and every other amount follows.
- **Round numbers give the factor away without any known amount.** Real prices and salaries tend to be round. Trying each of the 902 factors and keeping the one that turns the most fakes back into round numbers often recovers the factor, and with it every real amount, from the blind text alone.
- **One known date reveals all of them.** With 20 possible shifts, one date the adversary can place (a public holiday mentioned in passing, a filing deadline, a date in another document) fixes the shift, and every other date follows. Even with no known date, 20 guesses cover every possibility.

Treat scaled amounts and shifted dates as protection against a casual reader, not against someone who wants the real values and knows anything about them.

A scaled amount can also land by chance on the exact string of a different real amount in the same text, for example 38.10 times 0.919 is 35.01 when 35.01 also appears. The mapping keeps the two apart and both come back right, but the blind text then shows a real amount.

### When to use placeholder or random instead

Whenever the relationships between amounts or dates do not need to survive, use `replaceWith: 'placeholder'` or `replaceWith: 'random'`. Both scale and shift nothing: `placeholder` writes `[REDACTED_AMOUNT_1]` and `[REDACTED_DATE_1]`, and `random` writes unrelated random amounts and dates. Neither has a factor or shift to recover, so knowing one real amount or date tells the adversary nothing about the others. What you give up is that the service can no longer compute with them, and an amount or date it works out has no real value to map back to. See [Fakes, placeholders or random values](../README.md#fakes-placeholders-or-random-values).

### Why one factor and no per-amount noise

blind uses one factor for every amount and adds no noise to individual amounts. Noise per amount would make a known amount reveal less about the others, but it would also break the relationships `fake` mode exists to keep: a base plus 20% VAT would no longer equal the total, `a + b = c` would stop adding up, and a total the model computes from noisy amounts would not divide back to a real one. The mapping could still restore each amount it wrote, but not the model's own arithmetic. blind chooses usable arithmetic over resistance to a known amount. What you give up is exactly that resistance: with `fake`, assume the amounts are recoverable by anyone who knows one of them. If that matters more than the arithmetic, use `placeholder` or `random`.

## What is not covered

- **Values the detectors do not find.** They go out as written. The leak check reports only values it found somewhere else in the text or was given in `known` and `deny`. The list of known misses is in [known-misses.md](../corpus/adversarial/known-misses.md), and the README's [Limits](../README.md#limits) has the rest. Pass your own names, addresses and client domains in `known` and `deny`.
- **Context that identifies people.** A job title, a rare situation, a small town, a writing style or the combination of facts in a message can identify someone without any name in it. blind replaces values, not the story around them.
- **Relationships between values.** They survive by design: who wrote to whom, how many people are in a thread, which amounts add up to which, how far apart two dates are, which weekday something fell on. An adversary who knows one of those facts from elsewhere can use it to match the blind text to the real case.
- **The answer path.** blind rewrites what you send. What the service does with it, and anything it remembers across chats, is outside blind. The README's Limits covers chat memory.

## Linkability across conversations

Each call to `blind` without a `seed` or a `mapping` draws a fresh random seed from Web Crypto. The seed decides the fakes, the factor and the shift, so two conversations about the same person get unrelated fakes, a different factor and a different shift, and the adversary cannot join them by fake name. Within one conversation, passing the mapping along keeps every fake, the factor and the shift, which is what keeps the conversation coherent and what makes its turns linkable to each other.

A fixed `seed` reused across conversations removes that: the same person tends to get the same fake everywhere, so conversations can be joined. Anyone who learns the seed can also run blind on candidate real names until one produces the fake they saw. Use a fixed seed for tests and examples only.

The seed feeds a seeded generator with 128 bits of state, keyed from a hash of the whole seed string, so a random seed cannot be found by trying every state. The generator is xoshiro128\*\*, which is fast and reproducible but not cryptographic. blind does not claim that the seed resists someone who analyses many fakes from one conversation to reconstruct the generator. Keep the seed as private as the mapping, since it is stored in it.

## Blind text is recognisable as blind text

The fakes come from short lists published in the source (`src/names.ts`), in English 80 female first names, 80 male first names, 122 surnames and 36 places, in Spanish 77, 75, 127 and 36, and company and domain names built from lists of 10 to 50 words. Anyone who reads the source can tell that a text was rewritten by blind, and fakes can repeat by chance across unrelated conversations. That reveals that you use blind, not what the real values were. Do not rely on the blind text passing as an original.
