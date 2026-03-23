# Codex Result

Status: active-template
Audience: Codex and PM
Purpose: overwrite the latest-result section after each execution. Keep the field order stable.

## Required format

1. execution time
2. task id
3. status
4. changed files
5. migration or contract summary
6. verification result
7. commit SHA or `no git action`
8. frontend impact
9. pending issues
10. next handoff target

## Latest result

- execution time
  - 2026-03-24
- task id
  - `COD-2026-03-24-004`
- status
  - fixed
- changed files
  - `backend/package.json`
  - `backend/scripts/seed.ps1`
  - `docs/README.md`
  - `docs/uat/lovable-codex-sync.md`
  - `docs/codex/RESULT.md`
- migration or contract summary
  - recovered the nationwide `region_reference` library in the current verification environment
  - fixed the seed regression path so `db:seed:baseline`, `db:seed:demo`, `db:seed:test`, and `db:seed:all` all rebuild nationwide `region_reference` first through `db:seed:reference`
  - kept `testdata:cleanup` scoped to business/test rows only; it still does not delete `region_reference`
  - documented the safe reset/reseed order for shared or local verification environments
- verification result
  - initial `npm run region-reference:verify` showed the bad live state:
    - province `1`
    - city `1`
    - county `1`
    - town `1`
    - village `3`
  - `npm run db:seed:reference` restored nationwide reference data
  - direct DB verification after recovery showed:
    - total `665276`
    - province `31`
    - city `342`
    - county `2978`
    - town `41352`
    - village `620573`
  - sequential validation passed:
    - `npm run db:migrate:reset`
    - `npm run db:seed:baseline`
    - `npm run region-reference:verify`
    - `npm run testdata:cleanup`
    - `npm run region-reference:verify`
  - post-cleanup verification still showed the same nationwide counts, proving `region_reference` survives cleanup
  - note: one failed intermediate attempt was caused by my own parallel execution of reset/seed/verify; final acceptance is based only on the sequential rerun
- commit SHA or `no git action`
  - pending local commit
- frontend impact
  - frontend region-library dropdown verification can proceed again against real nationwide root data
  - `COD-2026-03-24-003` can resume after PM dispatches it again
- pending issues
  - none
- next handoff target
  - PM may reactivate `COD-2026-03-24-003` for frontend Git pull and local `LVB-4013` acceptance
