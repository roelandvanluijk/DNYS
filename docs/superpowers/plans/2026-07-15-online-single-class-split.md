# Online/Single-Class €9 BTW Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ongoing categorization logic so €9 online/livestream classes stop being booked as regular 9%-BTW "Single Classes," and produce a historical analysis + one-time Twinfield correction memo for the already-processed Jan–May 2026 months.

**Architecture:** Extract the existing (untested, duplicated-if-left-in-place) categorization logic out of `server/routes.ts` into a standalone `server/categorization.ts` module so both the live app and a new one-off analysis script use the exact same rules — this is what prevents the analysis from silently drifting from what production actually books. Add a price-based override on top of that shared logic. Extend `server/twinfield.ts` with a debit-side VAT-line helper and a new correction-memo XML generator. Two new scripts under `script/` consume freshly re-exported Momence files to report the historical impact and generate importable Twinfield XML.

**Tech Stack:** Node/TypeScript (ESM), Express, Drizzle ORM, Postgres, PapaParse, Vitest (new — this project has no test framework yet).

**Spec:** `docs/superpowers/specs/2026-07-15-online-single-class-split-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `server/categorization.ts` | **Create** | The DB-free categorization logic extracted from `routes.ts` (keyword matching, reviewed-product override, cached lookup — NOT the dead-code async `categorizeItem`, which stays in `routes.ts`), plus the new `applyOnlineSingleClassOverride` and `resolveNewProductCategory` helpers. |
| `server/routes.ts` | **Modify** | Remove extracted functions; import from `./categorization`; wire the override into `processReconciliation`'s per-row loop and into `checkForNewProducts`. |
| `server/categorization.test.ts` | **Create** | Vitest coverage for the extracted logic (regression safety net) and the new override/helper. |
| `server/twinfield.ts` | **Modify** | Add `debitLineWithVat` helper and `generateCorrectionMemoXml` export. |
| `server/twinfield.test.ts` | **Create** | Vitest coverage for the new helper and memo generator. |
| `script/analyze-online-single-classes.ts` | **Create** | Reads re-exported Momence files for Jan–May, loads live `category_settings`/`product_settings`, reports the €9 split per month (console + CSV). |
| `script/generate-correction-memo.ts` | **Create** | Reuses the analysis, calls `generateCorrectionMemoXml`, writes one XML file per affected month. |
| `package.json` / `vitest.config.ts` | **Modify/Create** | Add Vitest as the test runner (none exists yet). |

---

## Task 1: Add Vitest test tooling

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `server/smoke.test.ts` (deleted at the end of Task 1 — just proves the runner works)

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Add a `test` script to package.json**

In the `"scripts"` block, add:
```json
"test": "vitest run"
```

- [ ] **Step 3: Create a minimal vitest config**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Write a throwaway smoke test**

```ts
// server/smoke.test.ts
import { describe, it, expect } from "vitest";

describe("vitest setup", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: 1 passed

- [ ] **Step 6: Delete the smoke test and commit tooling only**

Run: `rm server/smoke.test.ts`

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest test runner"
```

---

## Task 2: Extract categorization logic into `server/categorization.ts`

This is a pure extraction — no behavior change. Characterization tests go in first so the move is provably safe.

**Files:**
- Create: `server/categorization.ts`
- Create: `server/categorization.test.ts`
- Modify: `server/routes.ts:149-334` (remove extracted code, add import)

- [ ] **Step 1: Write characterization tests for current behavior**

These tests pin down what `categorizeItemByKeywords` does *today*, before any extraction or new logic — they must pass against the current routes.ts implementation and must keep passing after the move.

```ts
// server/categorization.test.ts
import { describe, it, expect } from "vitest";
import { categorizeItemByKeywords } from "./categorization";

const customCategories = null; // exercise the REVENUE_CATEGORIES default path

describe("categorizeItemByKeywords (characterization)", () => {
  it("matches a plain single-class item to Single Classes", () => {
    const result = categorizeItemByKeywords("Vinyasa flow4All.", customCategories);
    expect(result.category).toBe("Single Classes");
    expect(result.twinfieldAccount).toBe("8120");
    expect(result.btwRate).toBe(0.09);
  });

  it("matches an online/livestream item to Online/Livestream", () => {
    const result = categorizeItemByKeywords("Livestream Yin Yoga", customCategories);
    expect(result.category).toBe("Online/Livestream");
  });

  it("excludes 'single' items from Rittenkaarten even if 'class' keyword matches, falling through to Single Classes", () => {
    const result = categorizeItemByKeywords("Single class card intro", customCategories);
    expect(result.category).toBe("Single Classes");
  });

  it("falls back to Overig for unrecognized items", () => {
    // Contains hyphens and is 24 chars — does NOT match the 6-10 char alphanumeric
    // gift-card regex, and no keyword matches, so this hits the final Overig fallback.
    const result = categorizeItemByKeywords("xyz-totally-unknown-123", customCategories);
    expect(result.category).toBe("Overig");
  });

  it("returns Overig for an empty item name", () => {
    const result = categorizeItemByKeywords(undefined, customCategories);
    expect(result.category).toBe("Overig");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail (module doesn't exist yet)**

Run: `npm test -- categorization`
Expected: FAIL with "Cannot find module './categorization'"

- [ ] **Step 3: Create `server/categorization.ts` and move the code**

**Deliberately leave `async function categorizeItem` (routes.ts:263-277) behind in `routes.ts`, unmodified.** It's dead code — no call sites reference it anywhere in the codebase (confirmed: the only match for `categorizeItem(` in routes.ts is its own definition) — and it's the one function in this group that calls `storage.getProductByName`, which transitively imports `server/db.ts`. `server/db.ts` throws synchronously at import time if `DATABASE_URL` is unset, and opens a real `pg.Pool` when it is. If `categorization.ts` pulls that in, `npm test` breaks the moment the module is imported, in an environment that has never run a test suite before and has no test-env DB story. Only extract the DB-free functions.

Cut these from `server/routes.ts` and paste into the new file, unchanged (they are NOT one contiguous block — `categorizeItem` at 263-277 sits between them and must stay put; move each named function individually, not by line range):
- `interface CategoryResult` (149-154)
- `interface CustomCategoryConfig` (156-162)
- `function categorizeItemByKeywords` (164-252)
- `function categorizeItemFromProduct` (254-261)
- `function categorizeItemCached` (280-295)
- `async function checkForNewProducts` — **leave this one in `routes.ts` for now** (Task 5 modifies it in place; moving it here too would conflate two tasks).

Verify exact current line numbers with `grep -n "^function\|^interface\|^async function" server/routes.ts` before cutting, since earlier edits in this session may have shifted them.

```ts
// server/categorization.ts
import { REVENUE_CATEGORIES, type ProductSettings } from "@shared/schema";

export interface CategoryResult {
  category: string;
  btwRate: number;
  twinfieldAccount: string;
  specialHandling?: 'accrual' | 'spread_12' | null;
}

export interface CustomCategoryConfig {
  name: string;
  keywords: string[];
  btwRate: number;
  twinfieldAccount: string;
  group: "yoga" | "horeca";
}

// ... paste categorizeItemByKeywords, categorizeItemFromProduct, categorizeItemCached
// verbatim here, unchanged. Do NOT paste categorizeItem — it stays in routes.ts. ...
```

In `server/routes.ts`, replace the removed block with:
```ts
import {
  categorizeItemByKeywords,
  categorizeItemFromProduct,
  categorizeItemCached,
  type CategoryResult,
  type CustomCategoryConfig,
} from "./categorization";
```
The remaining `categorizeItem` function in `routes.ts` calls `categorizeItemFromProduct` and `categorizeItemByKeywords` — both now imported from `./categorization`, so no change needed to its body.

Remove `type CategoryConfig` from the existing `@shared/schema` import in routes.ts if it becomes unused (check with the type-checker in Step 5).

- [ ] **Step 4: Run the tests to confirm they now pass**

Run: `npm test -- categorization`
Expected: 5 passed

- [ ] **Step 5: Type-check and confirm nothing else broke**

Run: `npm run check`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add server/categorization.ts server/categorization.test.ts server/routes.ts
git commit -m "refactor: extract categorization logic into server/categorization.ts"
```

---

## Task 3: Add `applyOnlineSingleClassOverride`

**Files:**
- Modify: `server/categorization.ts`
- Modify: `server/categorization.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// append to server/categorization.test.ts
import { applyOnlineSingleClassOverride } from "./categorization";

describe("applyOnlineSingleClassOverride", () => {
  const singleClassResult = { category: "Single Classes", btwRate: 0.09, twinfieldAccount: "8120", specialHandling: null };
  const otherCategoryResult = { category: "Omzet Keuken", btwRate: 0.09, twinfieldAccount: "8001", specialHandling: null };

  const customCategories = [
    { name: "Online/Livestream", keywords: ["livestream", "online", "virtual"], btwRate: 0.21, twinfieldAccount: "2015", group: "yoga" as const },
    { name: "Single Classes", keywords: ["yoga"], btwRate: 0.09, twinfieldAccount: "4071", group: "yoga" as const },
  ];

  it("reclassifies an exact €9.00 Single Classes sale to Online/Livestream, using live category_settings account/rate", () => {
    const result = applyOnlineSingleClassOverride(singleClassResult, 9.00, customCategories);
    expect(result.category).toBe("Online/Livestream");
    expect(result.twinfieldAccount).toBe("2015"); // NOT the hardcoded schema default of 8200
    expect(result.btwRate).toBe(0.21);
  });

  it("leaves a non-€9 Single Classes sale unchanged", () => {
    expect(applyOnlineSingleClassOverride(singleClassResult, 9.01, customCategories).category).toBe("Single Classes");
    expect(applyOnlineSingleClassOverride(singleClassResult, 8.99, customCategories).category).toBe("Single Classes");
    expect(applyOnlineSingleClassOverride(singleClassResult, 17.00, customCategories).category).toBe("Single Classes");
  });

  it("never touches a category other than Single Classes, even at exactly €9.00", () => {
    const result = applyOnlineSingleClassOverride(otherCategoryResult, 9.00, customCategories);
    expect(result.category).toBe("Omzet Keuken");
  });

  it("falls back to the hardcoded REVENUE_CATEGORIES default when customCategories is null", () => {
    const result = applyOnlineSingleClassOverride(singleClassResult, 9.00, null);
    expect(result.category).toBe("Online/Livestream");
    expect(result.twinfieldAccount).toBe("8200"); // the shared/schema.ts default
  });

  it("throws if customCategories is loaded but Online/Livestream is missing from it", () => {
    const partialCategories = customCategories.filter(c => c.name !== "Online/Livestream");
    expect(() => applyOnlineSingleClassOverride(singleClassResult, 9.00, partialCategories)).toThrow(/Online\/Livestream/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- categorization`
Expected: FAIL — `applyOnlineSingleClassOverride` is not exported

- [ ] **Step 3: Implement**

Append to `server/categorization.ts`:

```ts
export function applyOnlineSingleClassOverride(
  result: CategoryResult,
  saleValue: number,
  customCategories: CustomCategoryConfig[] | null,
): CategoryResult {
  if (result.category !== "Single Classes" || Math.round(saleValue * 100) !== 900) {
    return result;
  }

  if (customCategories === null) {
    const fallback = REVENUE_CATEGORIES["Online/Livestream"];
    return {
      category: "Online/Livestream",
      btwRate: fallback.btwRate,
      twinfieldAccount: fallback.twinfieldAccount,
      specialHandling: fallback.specialHandling ?? null,
    };
  }

  const online = customCategories.find(c => c.name === "Online/Livestream");
  if (!online) {
    throw new Error("Online/Livestream category not configured in category_settings");
  }
  return {
    category: "Online/Livestream",
    btwRate: online.btwRate,
    twinfieldAccount: online.twinfieldAccount,
    specialHandling: REVENUE_CATEGORIES["Online/Livestream"].specialHandling ?? null,
  };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- categorization`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add server/categorization.ts server/categorization.test.ts
git commit -m "feat: add price-based override to reclassify €9 single classes as Online/Livestream"
```

---

## Task 4: Wire the override into `processReconciliation`

**Files:**
- Modify: `server/routes.ts` (the per-row loop inside `processReconciliation`, currently around line 391)

- [ ] **Step 1: Locate the call site**

Run: `grep -n "categorizeItemCached(item, customCategories, productCache)" server/routes.ts`
Confirm it's the line inside `processReconciliation`'s `for (const row of momenceData)` loop (not `checkForNewProducts`, which is handled in Task 5).

- [ ] **Step 2: Update the import and the call**

Add `applyOnlineSingleClassOverride` to the import from `./categorization` (from Task 2's import block).

Change:
```ts
const { category, btwRate, twinfieldAccount } = categorizeItemCached(item, customCategories, productCache);
```
to:
```ts
const rawCategorization = categorizeItemCached(item, customCategories, productCache);
const { category, btwRate, twinfieldAccount } = applyOnlineSingleClassOverride(rawCategorization, saleValue, customCategories);
```
(`saleValue` is already parsed a few lines above in the same loop iteration — confirm the variable name matches exactly at the call site before editing.)

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: no errors

- [ ] **Step 4: Manual verification against real data**

This is DB/file-I/O-dependent behavior that isn't practical to unit test in isolation — verify it against the staging environment once real re-exported Momence files are available (see Task 8's manual verification step, which exercises this same code path end-to-end). Do not skip Task 8's verification because this task's automated tests passed — those only cover the pure function in isolation, not this call site.

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat: apply €9 online-class override during reconciliation processing"
```

---

## Task 5: Apply the same rule in `checkForNewProducts`

`checkForNewProducts` (routes.ts, calls `categorizeItemByKeywords` directly) aggregates by item name — `count` and `total` per name, not per row — so the €9 check here is against the **average** price for that item name, not an exact per-row match.

**Files:**
- Modify: `server/categorization.ts` (new helper)
- Modify: `server/categorization.test.ts`
- Modify: `server/routes.ts:297-334` (`checkForNewProducts`)

- [ ] **Step 1: Write the failing test**

```ts
// append to server/categorization.test.ts
import { resolveNewProductCategory } from "./categorization";

describe("resolveNewProductCategory", () => {
  const base = { category: "Single Classes", btwRate: 0.09, twinfieldAccount: "4071", specialHandling: null };
  const customCategories = [
    { name: "Online/Livestream", keywords: ["livestream"], btwRate: 0.21, twinfieldAccount: "2015", group: "yoga" as const },
  ];

  it("suggests Online/Livestream when a new item's average price is exactly €9.00", () => {
    const result = resolveNewProductCategory(base, 45, 5, customCategories); // 45 / 5 = 9.00
    expect(result.category).toBe("Online/Livestream");
  });

  it("keeps Single Classes when the average isn't exactly €9.00", () => {
    const result = resolveNewProductCategory(base, 46, 5, customCategories); // 9.20
    expect(result.category).toBe("Single Classes");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- categorization`
Expected: FAIL — `resolveNewProductCategory` not exported

- [ ] **Step 3: Implement**

Append to `server/categorization.ts`:

```ts
export function resolveNewProductCategory(
  result: CategoryResult,
  totalAmount: number,
  transactionCount: number,
  customCategories: CustomCategoryConfig[] | null,
): CategoryResult {
  if (transactionCount === 0) return result;
  const average = totalAmount / transactionCount;
  return applyOnlineSingleClassOverride(result, average, customCategories);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- categorization`
Expected: all passed

- [ ] **Step 5: Wire it into `checkForNewProducts`**

In `server/routes.ts`, inside `checkForNewProducts` (around line 320), change:
```ts
const categorization = categorizeItemByKeywords(itemName, customCategories);
newProducts.push({
  itemName,
  suggestedCategory: categorization.category,
  btwRate: categorization.btwRate,
  twinfieldAccount: categorization.twinfieldAccount,
  specialHandling: categorization.specialHandling || null,
  transactionCount: stats.count,
  totalAmount: stats.total,
});
```
to:
```ts
const rawCategorization = categorizeItemByKeywords(itemName, customCategories);
const categorization = resolveNewProductCategory(rawCategorization, stats.total, stats.count, customCategories);
newProducts.push({
  itemName,
  suggestedCategory: categorization.category,
  btwRate: categorization.btwRate,
  twinfieldAccount: categorization.twinfieldAccount,
  specialHandling: categorization.specialHandling || null,
  transactionCount: stats.count,
  totalAmount: stats.total,
});
```
Add `resolveNewProductCategory` to the `./categorization` import list.

- [ ] **Step 6: Type-check**

Run: `npm run check`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add server/categorization.ts server/categorization.test.ts server/routes.ts
git commit -m "feat: suggest Online/Livestream for new products averaging exactly €9"
```

---

## Task 6: Add `debitLineWithVat` to `server/twinfield.ts`

**Files:**
- Modify: `server/twinfield.ts`
- Create: `server/twinfield.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/twinfield.test.ts
import { describe, it, expect } from "vitest";
import { debitLineWithVat } from "./twinfield";

describe("debitLineWithVat", () => {
  it("produces a debit line carrying vatcode and vatvalue, matching creditLine's vat-line shape", () => {
    const xml = debitLineWithVat(1, "4071", 7.44, 1.56, "VL", "Correctie januari");
    expect(xml).toContain("<debitcredit>debit</debitcredit>");
    expect(xml).toContain("<dim1>4071</dim1>");
    expect(xml).toContain("<value>7.44</value>");
    expect(xml).toContain("<vatcode>VL</vatcode>");
    expect(xml).toContain("<vatvalue>1.56</vatvalue>");
  });

  it("omits the vat lines when btw is 0 or vatcode is VVR", () => {
    const xml = debitLineWithVat(1, "4071", 10.00, 0, "VVR", "desc");
    expect(xml).not.toContain("<vatcode>");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- twinfield`
Expected: FAIL — `debitLineWithVat` not exported

- [ ] **Step 3: Implement, mirroring `creditLine`'s vat-line construction**

Add to `server/twinfield.ts`, directly below the existing `creditLine` function:

```ts
function debitLineWithVat(id: number, account: string, netto: number, btw: number, vatcode: string, desc: string, dim2 = ""): string {
  const dim2Tag = dim2 ? `<dim2>${escapeXml(dim2)}</dim2>` : `<dim2/>`;
  const vatLines = vatcode !== "VVR" && btw > 0
    ? `\n      <vatcode>${vatcode}</vatcode>\n      <vatvalue>${btw.toFixed(2)}</vatvalue>`
    : "";
  return `    <line id="${id}">
      <dim1>${escapeXml(account)}</dim1>
      ${dim2Tag}
      <dim3/>
      <debitcredit>debit</debitcredit>
      <value>${netto.toFixed(2)}</value>
      <basevalue>${netto.toFixed(2)}</basevalue>
      <rate>1</rate>
      <description>${escapeXml(trunc(desc))}</description>${vatLines}
    </line>`;
}
```

Export it: add `debitLineWithVat` to the file's exports (this file currently exports `generateTwinfieldXml` and the `TwinfieldImbalanceError`/`TwinfieldExportInput` types — add `export` to the function signature or add a named export statement, matching whichever style keeps `generateTwinfieldXml`'s existing internal helpers un-exported while making this one testable; simplest is `export function debitLineWithVat(...)`).

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- twinfield`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add server/twinfield.ts server/twinfield.test.ts
git commit -m "feat: add debitLineWithVat helper for BTW-carrying debit lines"
```

---

## Task 7: Add `generateCorrectionMemoXml`

**Files:**
- Modify: `server/twinfield.ts`
- Modify: `server/twinfield.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// append to server/twinfield.test.ts
import { generateCorrectionMemoXml, type CorrectionMemoInput } from "./twinfield";

describe("generateCorrectionMemoXml", () => {
  const generalSettings = { office: "1000", journalCode: "MEMO", accrualCrossAccount: "1809", stripeFeeAccount: "4900" };

  const oneMonth: CorrectionMemoInput[] = [
    { period: "2026-01", grossTotal: 900, singleClassesAccount: "4071", onlineAccount: "2015" },
  ];

  it("produces one transaction dated with the original month, not today", () => {
    const xml = generateCorrectionMemoXml(oneMonth, generalSettings);
    expect(xml).toContain("<period>2026/01</period>");
    expect(xml).toContain("<date>20260131</date>");
  });

  it("debits the Single Classes account at 9% and credits Online/Livestream at 21%, both from the same gross", () => {
    const xml = generateCorrectionMemoXml(oneMonth, generalSettings);
    const oldNetto = (900 / 1.09).toFixed(2);   // 825.69
    const oldBtw = (900 - 900 / 1.09).toFixed(2); // 74.31
    const newNetto = (900 / 1.21).toFixed(2);   // 743.80
    const newBtw = (900 - 900 / 1.21).toFixed(2); // 156.20

    expect(xml).toContain(`<dim1>4071</dim1>`);
    expect(xml).toContain(`<value>${oldNetto}</value>`);
    expect(xml).toContain(`<vatcode>VL</vatcode>`);
    expect(xml).toContain(`<vatvalue>${oldBtw}</vatvalue>`);

    expect(xml).toContain(`<dim1>2015</dim1>`);
    expect(xml).toContain(`<value>${newNetto}</value>`);
    expect(xml).toContain(`<vatcode>VH</vatcode>`);
    expect(xml).toContain(`<vatvalue>${newBtw}</vatvalue>`);
  });

  it("self-balances: debit netto+vat equals credit netto+vat for the same gross", () => {
    const xml = generateCorrectionMemoXml(oneMonth, generalSettings);
    // both sides must reconstruct to the same 900.00 gross — this is asserted inside the
    // implementation itself (throws if not balanced); reaching this line without throwing
    // is the test.
    expect(xml).toBeTruthy();
  });

  it("produces one transaction per month, for multiple months", () => {
    const twoMonths: CorrectionMemoInput[] = [
      { period: "2026-01", grossTotal: 900, singleClassesAccount: "4071", onlineAccount: "2015" },
      { period: "2026-02", grossTotal: 450, singleClassesAccount: "4071", onlineAccount: "2015" },
    ];
    const xml = generateCorrectionMemoXml(twoMonths, generalSettings);
    expect((xml.match(/<transaction /g) || []).length).toBe(2);
    expect(xml).toContain("<period>2026/02</period>");
  });

  it("skips a month with zero gross total", () => {
    const withZero: CorrectionMemoInput[] = [
      { period: "2026-01", grossTotal: 0, singleClassesAccount: "4071", onlineAccount: "2015" },
    ];
    const xml = generateCorrectionMemoXml(withZero, generalSettings);
    expect((xml.match(/<transaction /g) || []).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- twinfield`
Expected: FAIL — `generateCorrectionMemoXml` not exported

- [ ] **Step 3: Implement**

Add to `server/twinfield.ts`:

```ts
export interface CorrectionMemoInput {
  period: string; // "YYYY-MM"
  grossTotal: number; // total gross (BTW-inclusive) sale value being reclassified for this month
  singleClassesAccount: string; // current Single Classes twinfield account (from category_settings)
  onlineAccount: string; // current Online/Livestream twinfield account (from category_settings)
}

const SINGLE_CLASS_BTW_RATE = 0.09;
const ONLINE_BTW_RATE = 0.21;

export function generateCorrectionMemoXml(
  inputs: CorrectionMemoInput[],
  generalSettings: TwinfieldGeneralSettings,
): string {
  const { office, journalCode } = generalSettings;
  const transactions: string[] = [];

  for (const input of inputs) {
    const gross = round2(input.grossTotal);
    if (gross === 0) continue;

    const oldNetto = round2(gross / (1 + SINGLE_CLASS_BTW_RATE));
    const oldBtw = round2(gross - oldNetto);
    const newNetto = round2(gross / (1 + ONLINE_BTW_RATE));
    const newBtw = round2(gross - newNetto);

    const debitTotal = round2(oldNetto + oldBtw);
    const creditTotal = round2(newNetto + newBtw);
    if (Math.abs(debitTotal - creditTotal) > 0.01 || Math.abs(debitTotal - gross) > 0.01) {
      throw new Error(
        `Correction memo for ${input.period} does not balance: debit=${debitTotal}, credit=${creditTotal}, gross=${gross}`
      );
    }

    const label = monthLabel(input.period);
    const lines = [
      debitLineWithVat(1, input.singleClassesAccount, oldNetto, oldBtw, "VL", `Correctie €9 online -> ${label}`),
      creditLine(2, input.onlineAccount, newNetto, newBtw, "VH", `Correctie €9 online -> ${label}`),
    ];

    transactions.push(buildTransaction({
      office,
      code: journalCode,
      period: twinfieldPeriod(input.period),
      date: lastDayOfMonth(input.period),
      description: `Correctie €9 losse lessen -> Online ${label}`,
      freetext1: "€9 online single-class BTW correctie",
      freetext2: input.period,
    }, lines));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<transactions>\n${transactions.join("\n")}\n</transactions>`;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- twinfield`
Expected: all passed

- [ ] **Step 5: Full test suite + type-check**

Run: `npm test && npm run check`
Expected: all passed, no type errors

- [ ] **Step 6: Commit**

```bash
git add server/twinfield.ts server/twinfield.test.ts
git commit -m "feat: add generateCorrectionMemoXml for historical BTW correction memos"
```

---

## Task 8: `script/analyze-online-single-classes.ts`

Not unit-tested (file I/O + live DB reads) — verified manually against real re-exported Momence files once available. This task can be picked up in parallel with Tasks 1-7 finishing, since it only needs those exports to exist, not to be merged yet.

**Files:**
- Create: `script/analyze-online-single-classes.ts`

- [ ] **Step 1: Confirm the Momence export files have arrived**

Ask the user for the 5 file paths (Jan–May 2026) before writing the CLI-arg handling, so the arg format matches how they'll actually invoke it.

- [ ] **Step 2: Write the script**

```ts
// script/analyze-online-single-classes.ts
import { readFileSync, writeFileSync } from "fs";
import Papa from "papaparse";
import { storage } from "../server/storage";
import { pool } from "../server/db";
import {
  categorizeItemCached,
  applyOnlineSingleClassOverride,
  type CustomCategoryConfig,
} from "../server/categorization";
import type { ProductSettings } from "@shared/schema";

interface MomenceRow {
  Item?: string;
  "Sale value"?: string;
  Date?: string;
}

function parseNumber(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Usage: tsx script/analyze-online-single-classes.ts 2026-01=./jan.csv 2026-02=./feb.csv ...
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: tsx script/analyze-online-single-classes.ts 2026-01=./jan.csv 2026-02=./feb.csv ...");
    process.exit(1);
  }

  const customCategories: CustomCategoryConfig[] | null = await storage.getCategorySettings();
  const allProducts: ProductSettings[] = await storage.getAllProducts();
  const productCache = new Map(allProducts.map(p => [p.itemName, p]));

  const singleClasses = customCategories?.find(c => c.name === "Single Classes");
  const singleClassesAccount = singleClasses?.twinfieldAccount ?? "8120";
  const singleClassesBtw = singleClasses?.btwRate ?? 0.09;
  const online = customCategories?.find(c => c.name === "Online/Livestream");
  const onlineAccount = online?.twinfieldAccount ?? "8200";
  const onlineBtw = online?.btwRate ?? 0.21;

  const rows: string[] = [
    "period,reclassified_count,gross_total,old_netto,old_btw,new_netto,new_btw,btw_delta",
  ];

  for (const arg of args) {
    const [period, filePath] = arg.split("=");
    const content = readFileSync(filePath, "utf-8");
    const parsed = Papa.parse<MomenceRow>(content, { header: true, skipEmptyLines: true });

    let reclassifiedCount = 0;
    let grossTotal = 0;

    for (const row of parsed.data) {
      const item = row.Item || "";
      const saleValue = parseNumber(row["Sale value"]);
      const raw = categorizeItemCached(item, customCategories, productCache);
      const final = applyOnlineSingleClassOverride(raw, saleValue, customCategories);
      if (raw.category === "Single Classes" && final.category === "Online/Livestream") {
        reclassifiedCount++;
        grossTotal += saleValue;
      }
    }

    grossTotal = round2(grossTotal);
    const oldNetto = round2(grossTotal / (1 + singleClassesBtw));
    const oldBtw = round2(grossTotal - oldNetto);
    const newNetto = round2(grossTotal / (1 + onlineBtw));
    const newBtw = round2(grossTotal - newNetto);
    const btwDelta = round2(newBtw - oldBtw);

    console.log(`\n=== ${period} ===`);
    console.log(`Reclassified: ${reclassifiedCount} transactions, €${grossTotal} gross`);
    console.log(`  Old (Single Classes @ ${singleClassesBtw * 100}%, account ${singleClassesAccount}): netto €${oldNetto}, BTW €${oldBtw}`);
    console.log(`  New (Online/Livestream @ ${onlineBtw * 100}%, account ${onlineAccount}): netto €${newNetto}, BTW €${newBtw}`);
    console.log(`  BTW delta: €${btwDelta}`);

    rows.push(`${period},${reclassifiedCount},${grossTotal},${oldNetto},${oldBtw},${newNetto},${newBtw},${btwDelta}`);
  }

  writeFileSync("./online-single-class-analysis.csv", rows.join("\n"));
  console.log("\nWritten to ./online-single-class-analysis.csv");

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run against the real re-exported files**

Run (with `DATABASE_URL` pointed at the **staging** environment — never production — via `railway run --environment staging -- tsx script/analyze-online-single-classes.ts ...`):
```bash
railway run --environment staging -- tsx script/analyze-online-single-classes.ts \
  2026-01=./jan.csv 2026-02=./feb.csv 2026-03=./mar.csv 2026-04=./apr.csv 2026-05=./may.csv
```
Expected: a per-month report printed, plus `online-single-class-analysis.csv` written. Manually spot-check 2-3 of the reported €9 transactions against the raw CSV to confirm sanity (right item names, right price).

- [ ] **Step 4: Commit**

```bash
git add script/analyze-online-single-classes.ts
git commit -m "feat: add historical analysis script for €9 online-class split"
```

Do NOT commit the CSV output or the Momence export files themselves — they contain real customer transaction data. Confirm `.gitignore` covers `*.csv` at the repo root, or add an explicit ignore entry if not.

---

## Task 9: `script/generate-correction-memo.ts`

**Files:**
- Create: `script/generate-correction-memo.ts`

- [ ] **Step 1: Write the script**

Reuses the same per-row loop as Task 8 to compute `grossTotal` per period, then calls `generateCorrectionMemoXml`.

```ts
// script/generate-correction-memo.ts
import { readFileSync, writeFileSync } from "fs";
import Papa from "papaparse";
import { storage } from "../server/storage";
import { pool } from "../server/db";
import { categorizeItemCached, applyOnlineSingleClassOverride, type CustomCategoryConfig } from "../server/categorization";
import { generateCorrectionMemoXml, type CorrectionMemoInput } from "../server/twinfield";
import type { ProductSettings } from "@shared/schema";

interface MomenceRow {
  Item?: string;
  "Sale value"?: string;
}

function parseNumber(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// Usage: tsx script/generate-correction-memo.ts 2026-01=./jan.csv 2026-02=./feb.csv ...
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: tsx script/generate-correction-memo.ts 2026-01=./jan.csv ...");
    process.exit(1);
  }

  const customCategories: CustomCategoryConfig[] | null = await storage.getCategorySettings();
  const allProducts: ProductSettings[] = await storage.getAllProducts();
  const productCache = new Map(allProducts.map(p => [p.itemName, p]));
  const generalSettings = await storage.getGeneralSettings();

  const singleClasses = customCategories?.find(c => c.name === "Single Classes");
  const online = customCategories?.find(c => c.name === "Online/Livestream");
  if (!singleClasses || !online) {
    throw new Error("Single Classes or Online/Livestream not found in category_settings");
  }

  const inputs: CorrectionMemoInput[] = [];
  let q1BtwDelta = 0;

  for (const arg of args) {
    const [period, filePath] = arg.split("=");
    const content = readFileSync(filePath, "utf-8");
    const parsed = Papa.parse<MomenceRow>(content, { header: true, skipEmptyLines: true });

    let grossTotal = 0;
    for (const row of parsed.data) {
      const item = row.Item || "";
      const saleValue = parseNumber(row["Sale value"]);
      const raw = categorizeItemCached(item, customCategories, productCache);
      const final = applyOnlineSingleClassOverride(raw, saleValue, customCategories);
      if (raw.category === "Single Classes" && final.category === "Online/Livestream") {
        grossTotal += saleValue;
      }
    }

    inputs.push({
      period,
      grossTotal: Math.round(grossTotal * 100) / 100,
      singleClassesAccount: singleClasses.twinfieldAccount,
      onlineAccount: online.twinfieldAccount,
    });

    if (period <= "2026-03") {
      const oldNetto = grossTotal / (1 + singleClasses.btwRate);
      const newNetto = grossTotal / (1 + online.btwRate);
      q1BtwDelta += (grossTotal - newNetto) - (grossTotal - oldNetto);
    }
  }

  const xml = generateCorrectionMemoXml(inputs, generalSettings);
  writeFileSync("./correction-memo.xml", xml);
  console.log("Written to ./correction-memo.xml");
  console.log(`Q1 (Jan-Mar) cumulative BTW delta: €${Math.round(q1BtwDelta * 100) / 100}`);
  console.log("Belastingdienst suppletie threshold is €1.000 — check this delta against it before deciding whether a formal suppletieaangifte is required.");

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run against the real re-exported files**

```bash
railway run --environment staging -- tsx script/generate-correction-memo.ts \
  2026-01=./jan.csv 2026-02=./feb.csv 2026-03=./mar.csv 2026-04=./apr.csv 2026-05=./may.csv
```
Expected: `correction-memo.xml` written with 5 transactions, one per month, and the Q1 BTW delta printed.

- [ ] **Step 3: Sanity-check the XML manually**

Open `correction-memo.xml` and confirm: 5 `<transaction>` blocks, each with the correct `<period>`/`<date>` for its month (not today's date), debit line on the Single Classes account with `vatcode` `VL`, credit line on the Online/Livestream account with `vatcode` `VH`.

- [ ] **Step 4: Commit**

```bash
git add script/generate-correction-memo.ts
git commit -m "feat: add Twinfield correction memo generator for €9 online-class BTW fix"
```

Do NOT commit `correction-memo.xml` — same reasoning as Task 8 (real transaction-derived amounts).

---

## Task 10: End-to-end verification on staging

**Files:** none (verification only)

- [ ] **Step 1: Push the branch and confirm staging redeploys clean**

```bash
git push -u origin fix-online-single-class-split
```
Then check: `railway logs --service DNYS --environment staging` — confirm the deploy succeeds and the app boots without the earlier `ECONNREFUSED`/password-auth crash.

- [ ] **Step 2: Run the full automated test suite one more time**

Run: `npm test && npm run check`
Expected: all passed, no type errors

- [ ] **Step 3: Manually exercise the categorization fix in the running staging app**

Upload a small test file containing at least one €9-priced item keyword-matching "Single Classes" through staging's normal reconciliation upload flow (`https://dnys-staging.up.railway.app`). Confirm in the resulting category breakdown that it's booked under Online/Livestream, not Single Classes.

- [ ] **Step 4: Confirm the two scripts' output matches what's expected**

Re-run Task 8 and Task 9's scripts once more against staging's DB and the final re-exported files, confirm the numbers are stable (same output as the last run in those tasks).

- [ ] **Step 5: Report back**

Summarize for the user: total €9 transactions reclassified per month, total revenue moved, Q1 BTW delta vs. the €1.000 suppletie threshold, and the path to `correction-memo.xml` — ready for them to review before deciding on next steps (merge, Twinfield import, suppletie filing).
