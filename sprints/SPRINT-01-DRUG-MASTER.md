# Sprint 1 — Drug master + typeahead

**Status:** complete
**Started:** 2026-05-17
**Completed:** 2026-05-18
**Days budget:** 3-4
**Days actual:** 1 (single Cowork session, continuous from Sprint 0)
**Ship tag:** `sprint-1-shipped`

## Scope (from design doc §8)

Formulary import script (Drive sheet via Google Drive MCP), trigram indexes, `/api/drugs/search`, reusable typeahead component. Working drug typeahead with 2,174 items.

## Deliverables — what shipped

| Milestone | Commit(s) | Deliverable |
|---|---|---|
| M1.1 | `8d6daa2` + `729a91d` | Pharmacy Formulary 2026 CSV (V-authored, sheet `1jKAwnk…UESZM`) downloaded, snapshot committed to `reference/`, RFC-4180 parser (`src/lib/csv.ts`), row mapper (`src/lib/formulary.ts`), `/api/admin/import-formulary` POST endpoint, 2,174 / 2,174 rows imported into `drug_master`. |
| M1.2 | `daf1982` | `/api/drugs/search?q=…&limit=…` GET endpoint. Combined LIKE-prefix (brand 1.0, generic 0.95) + pg_trgm similarity ranking. Smoke-tested across 10 realistic typeahead queries; latency 230ms warm / 950ms cold. |
| M1.3 | `8ebef7a` | `<DrugTypeahead>` reusable component (debounced 200ms, keyboard nav ↑ ↓ Enter Esc, match highlighting, schedule chips, ⚠ high-risk badge, LASA line). `/dashboard/drugs` demo page with picks accumulator. Dashboard home gets a card linking to it. |

## Production URLs

- **Demo page (auth required):** https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app/dashboard/drugs
- **Search API:** https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app/api/drugs/search?q=para&limit=5
- **Import endpoint (counts probe):** https://opd-encounter-app-vinaybhardwaj-commits-projects.vercel.app/api/admin/import-formulary

## Schedule mapping (the formulary doesn't map 1:1 to the demo enum)

Demo schema `drug_schedule` enum is `('OTC','H','H1','X')`. Sheet has 7 distinct values, mapped as:

| Sheet value | → Stored | Reasoning |
|---|---|---|
| `OTC`, `H`, `H1`, `X` | as-is | Direct enum match |
| `Biological` (31 rows) | `H1` | Vaccines + antisera per CDSCO 2016 gazette need register entry |
| `G` | `H` | Hormones — prescription required |
| `—` / empty (5 rows) | `OTC` | FMCG items (Vicks, ENO, sunscreens, moisturizer) — behave as OTC at point of sale |

## Verification numbers

| | Sheet summary | DB after import | Match |
|---|---|---|---|
| Total items | 2,174 | 2,174 | ✓ |
| High-risk (ISMP) | 326 | 326 | ✓ |
| Schedule OTC | 531 + 5 FMCG = 536 | 536 | ✓ |
| Schedule H | 1,474 | 1,474 | ✓ |
| Schedule H1 | 122 + 31 Biological = 153 | 153 | ✓ |
| Schedule X | 11 | 11 | ✓ |

## Bugs found in sprint sweep

| # | Where | Fix |
|---|---|---|
| 1 | First import skipped 5 rows on `—` (em-dash) schedule | Map em-dash + empty + N/A → OTC for FMCG-style items (commit `729a91d`) |
| 2 | Drive download tool returned 513KB JSON → exceeds chat context | Spawned a subagent to decode base64 → CSV → write to disk without polluting main context |

## Carry-overs into Sprint 2

- **Tier-break for brand vs generic specificity:** `q=ome` ranks OMEGARED + OMEZ both at score=1.0; clinical relevance would prefer OMEZ (omeprazole) over a vitamin. Tweak ranking in Sprint 8 polish, not blocking now.
- **Vercel function region still `iad1`** — confirmed via search latency (~950ms cold from US-East to sin1 Neon). Carried forward from Sprint 0.

## Retrospective

What worked: the EHRC-pattern inline migration runner reused for the importer endpoint; idempotent UPSERT meant the em-dash fix was a one-command re-run; the typeahead's match-highlighting + keyboard nav came together fast because Tailwind + jsx is forgiving. The CSV parser inlined as ~60 lines beat pulling in `papaparse`.

What didn't: had to spawn a subagent to handle the 513KB Drive download response (saved to host filesystem outside the sandbox). Worth noting as a recurring pattern when MCP responses exceed chat context limits.

Sprint 2 (queue + encounter lifecycle) is the next phase.
