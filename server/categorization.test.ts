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
