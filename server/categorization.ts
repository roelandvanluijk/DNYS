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

export function categorizeItemByKeywords(
  itemName: string | undefined,
  customCategories: CustomCategoryConfig[] | null
): CategoryResult {
  if (!itemName) {
    return { category: "Overig", btwRate: 0.09, twinfieldAccount: "8999" };
  }

  const itemLower = itemName.toLowerCase();

  // Priority order for categories (Online/Livestream FIRST)
  const categoryOrder = [
    'Online/Livestream',
    'Opleidingen',
    'Teacher Training',
    'Jaarabonnementen',
    'Gift Cards',
    'Money Credits',
    'Workshops 9%',
    'Workshops 21%',
    'Abonnementen',
    'Rittenkaarten',
    'Omzet Keuken',
    'Omzet Drank Laag',
    'Omzet Drank Hoog',
    'Single Classes',
  ];

  // Check for gift card codes (alphanumeric 6-10 chars) - FIX 5: case-insensitive
  if (/^[A-Za-z0-9]{6,10}$/.test(itemName.trim())) {
    return { category: "Gift Cards", btwRate: 0.00, twinfieldAccount: "8900" };
  }

  // Check for yearly membership with year/jaar keyword
  if ((itemLower.includes('year') || itemLower.includes('jaar')) &&
      (itemLower.includes('membership') || itemLower.includes('abonnement'))) {
    return { category: "Jaarabonnementen", btwRate: 0.09, twinfieldAccount: "8101", specialHandling: 'spread_12' };
  }

  // Use custom categories if available, otherwise use defaults
  if (customCategories) {
    for (const categoryName of categoryOrder) {
      const config = customCategories.find(c => c.name === categoryName);
      if (!config) continue;

      for (const keyword of config.keywords) {
        if (itemLower.includes(keyword.toLowerCase())) {
          if (categoryName === 'Rittenkaarten' && itemLower.includes('single')) {
            continue;
          }
          if (categoryName === 'Abonnementen' && (itemLower.includes('year') || itemLower.includes('jaar'))) {
            continue;
          }
          const catConfig = REVENUE_CATEGORIES[categoryName];
          return {
            category: categoryName,
            btwRate: config.btwRate,
            twinfieldAccount: config.twinfieldAccount,
            specialHandling: catConfig?.specialHandling || null,
          };
        }
      }
    }
  } else {
    for (const categoryName of categoryOrder) {
      const config = REVENUE_CATEGORIES[categoryName];
      if (!config) continue;

      for (const keyword of config.keywords) {
        if (itemLower.includes(keyword.toLowerCase())) {
          if (categoryName === 'Rittenkaarten' && itemLower.includes('single')) {
            continue;
          }
          if (categoryName === 'Abonnementen' && (itemLower.includes('year') || itemLower.includes('jaar'))) {
            continue;
          }
          return {
            category: categoryName,
            btwRate: config.btwRate,
            twinfieldAccount: config.twinfieldAccount,
            specialHandling: config.specialHandling || null,
          };
        }
      }
    }
  }

  return { category: "Overig", btwRate: 0.09, twinfieldAccount: "8999" };
}

export function categorizeItemFromProduct(product: ProductSettings): CategoryResult {
  return {
    category: product.category,
    btwRate: product.btwRate,
    twinfieldAccount: product.twinfieldAccount || "8999",
    specialHandling: product.hasAccrual ? 'accrual' : product.hasSpread ? 'spread_12' : null,
  };
}

// Cached version that uses pre-loaded product map (for performance)
export function categorizeItemCached(
  itemName: string | undefined,
  customCategories: CustomCategoryConfig[] | null,
  productCache: Map<string, ProductSettings>
): CategoryResult {
  if (!itemName) {
    return { category: "Overig", btwRate: 0.09, twinfieldAccount: "8999" };
  }

  const storedProduct = productCache.get(itemName);
  if (storedProduct && storedProduct.isReviewed) {
    return categorizeItemFromProduct(storedProduct);
  }

  return categorizeItemByKeywords(itemName, customCategories);
}

export function applyOnlineSingleClassOverride(
  result: CategoryResult,
  saleValue: number,
  customCategories: CustomCategoryConfig[] | null,
): CategoryResult {
  if (result.category !== "Single Classes" || Math.round(saleValue * 100) !== 900) {
    return result;
  }

  // These two branches look similar (both build an Online/Livestream CategoryResult)
  // but they are NOT interchangeable — do not collapse them into a single
  // `customCategories?.find(...) ?? REVENUE_CATEGORIES[...]` fallback.
  //
  // `customCategories === null` means category_settings was never loaded at all
  // (e.g. an empty table), so falling back to the hardcoded schema default is safe.
  //
  // `customCategories` being a non-null array that's simply missing the
  // "Online/Livestream" entry means settings ARE loaded, and this is a data-integrity
  // gap (partial/corrupted config). Silently falling back there would book to a
  // stale/dead Twinfield account (e.g. 8200) instead of the live one — it must
  // throw instead so the gap gets fixed, not swept under the rug.
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

