# Online/Single-Class €9 Split — Design

## Background

De Nieuwe Yogaschool sells single yoga/pilates classes. A subset of these are actually
online/livestream classes priced at exactly €9.00 gross, but the tool's categorization has
never distinguished by price — only by item-name keywords. As a result, €9 online classes
have been booked as regular "Single Classes" (9% BTW) instead of "Online/Livestream" (21% BTW)
for Jan–May 2026, which have already been processed and (for Q1) filed with the Belastingdienst.

This branch (`fix-online-single-class-split`) does three things:

1. Fixes the ongoing categorization logic so this stops happening on future imports.
2. Produces a historical analysis of the revenue/BTW impact for Jan–May 2026.
3. Generates one-time Twinfield correction memos to reclassify the affected revenue for the
   already-closed months.

## Business rule

Within any transaction whose `Item` keyword-matches (or is manually reviewed into) the
"Single Classes" category, an exact `Sale value` of €9.00 (gross, BTW-inclusive) means the
transaction is actually an online/livestream class and must be booked as "Online/Livestream"
instead — different revenue account **and** different BTW rate (21% instead of 9%). Any other
price point stays under "Single Classes". Match is exact €9.00, no tolerance range.

## 1. Ongoing code fix

`server/routes.ts` categorizes items purely by keyword (`categorizeItemByKeywords`) or by a
manually reviewed `product_settings` row (`categorizeItemFromProduct`) — neither is price-aware.
Add a single override applied after category resolution in both `categorizeItem` and
`categorizeItemCached`:

```ts
function applyOnlineSingleClassOverride(result: CategoryResult, saleValue: number): CategoryResult {
  if (result.category === "Single Classes" && Math.round(saleValue * 100) === 900) {
    const online = REVENUE_CATEGORIES["Online/Livestream"];
    return {
      category: "Online/Livestream",
      btwRate: online.btwRate,
      twinfieldAccount: online.twinfieldAccount,
      specialHandling: online.specialHandling ?? null,
    };
  }
  return result;
}
```

Applied in `processReconciliation`'s per-row loop, using the already-parsed `saleValue` for that
row. This means the €9 rule applies regardless of whether the item was keyword-matched or is a
manually reviewed product — a €9 sale always lands in Online/Livestream; anything else stays
Single Classes.

Note: at runtime, actual revenue accounts/BTW rates come from the `category_settings` table
(current settings), not the literal defaults in `shared/schema.ts` — e.g. today "Single Classes"
is account `4071` and "Online/Livestream" is `2015`, not `8120`/`8200`. The override must resolve
against current `category_settings`, matching the project's existing pattern of always using
live settings rather than stale/hardcoded values.

## 2. Historical analysis (Jan–May 2026)

**Data source:** the DB's per-transaction data (`momence_transactions`) is dead code — never
written by any code path — and the leftover `pending_reconciliations` blobs for these months are
unreliable (multiple divergent candidate uploads per month, and `category_settings` /
`product_settings` have changed since these months were originally processed, so replaying
today's rules against old raw data doesn't reproduce what was actually booked). Instead, all five
months are being freshly re-exported from Momence (source of truth) for this analysis.

**Script:** `script/analyze-online-single-classes.ts`
- Input: 5 Momence export files (Jan–May), same format as the normal upload (Papa Parse, see
  `MomenceRow` in `server/routes.ts`).
- Loads `category_settings` and reviewed `product_settings` live from the DB (read-only) to
  replicate the app's real categorization exactly, including the new price override.
- Per month, reports: count and gross total of transactions reclassified from Single Classes to
  Online/Livestream, the old booking (netto/BTW at the current Single Classes rate) vs. the
  corrected booking (netto/BTW at the current Online/Livestream rate), and the BTW delta.
- Output: console table + CSV.

## 3. Correction memo (Twinfield XML)

**Script:** `script/generate-correction-memo.ts`, reusing the analysis script's per-month
figures. Adds a new exported function in `server/twinfield.ts` (additive only — does not modify
the existing monthly export logic) producing one Twinfield transaction per affected month, dated
with that month's actual period/last-day (not today):

- Debit Single Classes account, value = old netto, vatcode `VL` (9%), vatvalue = old BTW
  (reverses the originally booked 9% revenue + BTW)
- Credit Online/Livestream account, value = new netto, vatcode `VH` (21%), vatvalue = new BTW
  (books the corrected 21% revenue + BTW)

Self-balancing (both sides net to the same €9 gross per transaction) — no clearing/sluitpost
account needed. This mirrors Twinfield's standard vatcode-attached-to-a-line mechanism already
used elsewhere in `server/twinfield.ts` (confirmed against actual Dutch BTW correction practice
via the accountant agent).

Writes one importable XML file per month to disk. You review and import into Twinfield manually,
same as the existing monthly export flow — nothing is posted automatically.

**Fiscal handling (per accountant guidance):**
- **Q1 (Jan–Mar), already filed:** book the correction with the original Jan/Feb/Mar dates (for
  a clean P&L/audit trail matching actual class dates). Twinfield will not retroactively amend
  the filed BTW-aangifte — the resulting BTW delta must be corrected separately via a
  suppletieaangifte, unless the cumulative Q1 correction stays under the Belastingdienst's
  €1.000 threshold, in which case it can be folded into the next regular return instead. The
  script prints the total Q1 BTW delta so this can be checked against the threshold.
- **Q2 (Apr–May), not yet filed:** book with the original Apr/May dates; the normal Q2 return
  will simply reflect the corrected split, no suppletie needed.

## Infrastructure

A `staging` Railway environment (duplicated from `production`, own Postgres seeded from a
production data dump) was created to deploy and test this branch before merging. Two issues were
found and fixed during setup, both isolated to staging:
- `DATABASE_URL` had a stale password left over from environment duplication — corrected to
  match staging's actual (re-generated) Postgres credentials.
- Railway's environment duplication only copies service config, not data — production's DB was
  dumped (`pg_dump`, read-only) and restored into staging separately.

## Out of scope

- No changes to production data or the live categorization behavior until this branch is
  reviewed and merged.
- No automatic Twinfield import or suppletie filing — both remain manual steps using this
  branch's output.
