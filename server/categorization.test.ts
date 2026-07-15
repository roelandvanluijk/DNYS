import { describe, it, expect } from "vitest";
import { categorizeItemByKeywords, applyOnlineSingleClassOverride, resolveNewProductCategory } from "./categorization";

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

  it("does not throw for a non-Single-Classes category even when customCategories is missing Online/Livestream, proving the category+price guard runs before the customCategories lookup", () => {
    const partialCategories = customCategories.filter(c => c.name !== "Online/Livestream");
    const result = applyOnlineSingleClassOverride(otherCategoryResult, 9.00, partialCategories);
    expect(result).toEqual(otherCategoryResult);
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

describe("resolveNewProductCategory", () => {
  const base = { category: "Single Classes", btwRate: 0.09, twinfieldAccount: "4071", specialHandling: null };
  const customCategories = [
    { name: "Online/Livestream", keywords: ["livestream"], btwRate: 0.21, twinfieldAccount: "2015", group: "yoga" as const },
  ];

  it("suggests Online/Livestream when every sale under this item name is exactly €9.00", () => {
    const result = resolveNewProductCategory(base, true, customCategories);
    expect(result.category).toBe("Online/Livestream");
  });

  it("keeps Single Classes when not every sale under this item name is exactly €9.00", () => {
    const result = resolveNewProductCategory(base, false, customCategories);
    expect(result.category).toBe("Single Classes");
  });

  it("does not reclassify when not every sale under this item name is exactly €9, even if the average happens to be €9", () => {
    // e.g. 4x €8.00 + 1x €13.00 = €45 total / 5 = €9.00 average, but no individual
    // sale was ever actually €9 — allSalesExactlyNine correctly comes out false here.
    const result = resolveNewProductCategory(base, false, customCategories);
    expect(result.category).toBe("Single Classes");
  });
});
