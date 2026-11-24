# Surviving Mutants — Triage Log

Stryker mutation testing runs against `backend/src/services/` and `backend/src/middleware/`
on every PR that touches those directories (see `.github/workflows/mutation-testing.yml`).

The CI gate requires a mutation score ≥ 70%. Surviving mutants above that threshold must be
either killed by a new test or documented here as acceptable with a rationale.

---

## How to triage a surviving mutant

1. Download the HTML report from the GitHub Actions run artefacts.
2. Find the mutant in the report (file, line, mutation type).
3. Write a test that kills it and re-run Stryker locally:
   ```bash
   npx stryker run stryker.auth.config.mjs
   ```
4. If the mutant represents behaviour that is intentionally not tested (see categories below),
   add an entry to this file and open a follow-up issue to track it.

---

## Acceptable surviving mutants

> Add entries here when a mutant is accepted. Format:
> `| File | Line | Mutation | Rationale | Issue |`

| File | Line | Mutation | Rationale | Issue |
|------|------|----------|-----------|-------|
| _(none yet — triage all surviving mutants from the first CI run)_ | | | | |

---

## Categories of acceptable surviving mutants

- **Defensive guards**: null/undefined checks that cannot trigger in the current code path
  but are present for future-proofing. Mark with rationale "defensive guard".
- **Logging-only paths**: mutations that only affect log messages or metrics labels with
  no observable effect on callers. Mark with rationale "log/metrics only".
- **External API contracts**: error codes returned directly from a third-party SDK where
  the exact string is not asserted by tests (acceptable until contract tests are added).
  Mark with rationale "third-party contract, track in issue #NNN".

---

## Mutation score history

| Date | Score | Threshold | Branch | Notes |
|------|-------|-----------|--------|-------|
| _(first run to be recorded after #650 is merged)_ | — | 70% | main | Baseline |
