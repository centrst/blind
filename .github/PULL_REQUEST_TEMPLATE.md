<!-- What this changes and why. Name the claim ids it touches. Link the issue. -->

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] Every fixture is synthetic: invented names, companies, amounts and numbers, `.example` domains
- [ ] No network calls in `src`, and no `node:` imports or Node-only globals in `src` outside `src/cli`
- [ ] No `Math.random`; randomness goes through the seeded `Rng`
- [ ] Errors and leak reports carry a kind and an index, never a value
- [ ] New tests that back a claim start with the claim id (`C4/P4: ...`)
- [ ] No floor in `corpus/floors.json`, `corpus/floors-ner.json` or `stryker.config.json` went down
- [ ] A new known miss is a case in `corpus/adversarial` with `"expect": "silent"` and a `"why"`, and `pnpm known-misses` was run
- [ ] For detection changes: `pnpm corpus` passes
