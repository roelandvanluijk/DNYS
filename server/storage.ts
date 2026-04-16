import { randomUUID } from "crypto";
import type {
  ReconciliationSession,
  CustomerComparison,
  PaymentMethodSummary,
  CategorySummary,
  CategoryItemDetail,
  CategoryWithDetails,
  ReconciliationResult,
  ProductSettings,
  InsertProductSettings,
  PendingReconciliation,
  InsertPendingReconciliation,
  AccrualEntry,
  InsertAccrualEntry
} from "@shared/schema";
import { productSettings, pendingReconciliations, accrualSchedule, categorySettings as categorySettingsTable, paymentMethodSettings, generalSettings as generalSettingsTable, DEFAULT_GENERAL_SETTINGS, reconciliationSessions, customerComparison as customerComparisonTable, paymentMethodSummary as paymentMethodSummaryTable, categorySummary as categorySummaryTable, stripeCache } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, inArray } from "drizzle-orm";
import type { InsertCategorySettings, CategorySettingsDB, InsertPaymentMethodSettings, PaymentMethodSettingsDB, TwinfieldGeneralSettings } from "@shared/schema";

export interface CategorySettings {
  name: string;
  keywords: string[];
  btwRate: number;
  twinfieldAccount: string;
  group: "yoga" | "horeca";
}

export interface NewProductSuggestion {
  itemName: string;
  suggestedCategory: string;
  btwRate: number;
  twinfieldAccount: string;
  specialHandling: 'accrual' | 'spread_12' | null;
  transactionCount: number;
  totalAmount: number;
}

export interface IStorage {
  createSession(session: Omit<ReconciliationSession, "id" | "createdAt">): Promise<ReconciliationSession>;
  getSession(id: string): Promise<ReconciliationSession | undefined>;
  updateSession(id: string, updates: Partial<ReconciliationSession>): Promise<ReconciliationSession | undefined>;
  getAllSessions(): Promise<ReconciliationSession[]>;
  deleteSession(id: string): Promise<boolean>;
  addComparisons(sessionId: string, comparisons: Omit<CustomerComparison, "id">[]): Promise<void>;
  getComparisons(sessionId: string): Promise<CustomerComparison[]>;
  addPaymentMethods(sessionId: string, methods: Omit<PaymentMethodSummary, "id">[]): Promise<void>;
  getPaymentMethods(sessionId: string): Promise<PaymentMethodSummary[]>;
  addCategories(sessionId: string, categories: Omit<CategorySummary, "id">[]): Promise<void>;
  getCategories(sessionId: string): Promise<CategorySummary[]>;
  addCategoryItems(sessionId: string, categoryName: string, items: CategoryItemDetail[]): Promise<void>;
  getCategoryItems(sessionId: string, categoryName: string): Promise<CategoryItemDetail[]>;
  getFullResult(sessionId: string): Promise<ReconciliationResult | undefined>;
  getCategorySettings(): Promise<CategorySettings[] | null>;
  saveCategorySettings(settings: CategorySettings[]): Promise<void>;
  resetCategorySettings(): Promise<void>;

  getProductByName(itemName: string): Promise<ProductSettings | undefined>;
  getAllProducts(): Promise<ProductSettings[]>;
  saveProduct(product: InsertProductSettings): Promise<ProductSettings>;
  updateProduct(id: number, updates: Partial<InsertProductSettings>): Promise<ProductSettings | undefined>;
  deleteProduct(id: number): Promise<void>;
  clearAllProducts(): Promise<void>;

  savePendingReconciliation(data: InsertPendingReconciliation): Promise<PendingReconciliation>;
  getPendingReconciliation(id: string): Promise<PendingReconciliation | undefined>;
  getAllPendingReconciliations(): Promise<PendingReconciliation[]>;
  deletePendingReconciliation(id: string): Promise<void>;
  clearAllPendingReconciliations(): Promise<void>;

  addAccrualEntries(sessionId: string, entries: InsertAccrualEntry[]): Promise<void>;
  getAccrualEntries(sessionId: string): Promise<AccrualEntry[]>;

  getAllPaymentMethodSettings(): Promise<PaymentMethodSettingsDB[]>;
  savePaymentMethodSettings(methodName: string, twinfieldAccount: string, isStripeMethod: boolean): Promise<void>;

  getGeneralSettings(): Promise<TwinfieldGeneralSettings>;
  saveGeneralSettings(settings: TwinfieldGeneralSettings): Promise<void>;
  getAccrualEntriesByPeriod(bookingMonth: string): Promise<AccrualEntry[]>;

  getStripeCache(period: string): Promise<{ data: string; transactionCount: number; fetchedAt: Date | null } | undefined>;
  saveStripeCache(period: string, data: string, transactionCount: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private customCategorySettings: CategorySettings[] | null = null;

  async createSession(session: Omit<ReconciliationSession, "id" | "createdAt">): Promise<ReconciliationSession> {
    const id = randomUUID();
    const [created] = await db.insert(reconciliationSessions).values({ ...session, id }).returning();
    return created;
  }

  async getSession(id: string): Promise<ReconciliationSession | undefined> {
    const [session] = await db.select().from(reconciliationSessions).where(eq(reconciliationSessions.id, id));
    return session || undefined;
  }

  async updateSession(id: string, updates: Partial<ReconciliationSession>): Promise<ReconciliationSession | undefined> {
    const [updated] = await db.update(reconciliationSessions).set(updates).where(eq(reconciliationSessions.id, id)).returning();
    return updated || undefined;
  }

  async getAllSessions(): Promise<ReconciliationSession[]> {
    return await db.select().from(reconciliationSessions).orderBy(desc(reconciliationSessions.createdAt));
  }

  async deleteSession(id: string): Promise<boolean> {
    const [session] = await db.select().from(reconciliationSessions).where(eq(reconciliationSessions.id, id));
    if (!session) return false;
    await db.delete(customerComparisonTable).where(eq(customerComparisonTable.sessionId, id));
    await db.delete(paymentMethodSummaryTable).where(eq(paymentMethodSummaryTable.sessionId, id));
    await db.delete(categorySummaryTable).where(eq(categorySummaryTable.sessionId, id));
    await db.delete(accrualSchedule).where(eq(accrualSchedule.sessionId, id));
    await db.delete(reconciliationSessions).where(eq(reconciliationSessions.id, id));
    return true;
  }

  async addComparisons(sessionId: string, comps: Omit<CustomerComparison, "id">[]): Promise<void> {
    if (comps.length === 0) return;
    await db.insert(customerComparisonTable).values(comps);
  }

  async getComparisons(sessionId: string): Promise<CustomerComparison[]> {
    return await db.select().from(customerComparisonTable).where(eq(customerComparisonTable.sessionId, sessionId));
  }

  async addPaymentMethods(sessionId: string, methods: Omit<PaymentMethodSummary, "id">[]): Promise<void> {
    if (methods.length === 0) return;
    await db.insert(paymentMethodSummaryTable).values(methods);
  }

  async getPaymentMethods(sessionId: string): Promise<PaymentMethodSummary[]> {
    return await db.select().from(paymentMethodSummaryTable).where(eq(paymentMethodSummaryTable.sessionId, sessionId));
  }

  async addCategories(sessionId: string, cats: Omit<CategorySummary, "id">[]): Promise<void> {
    if (cats.length === 0) return;
    await db.insert(categorySummaryTable).values(cats);
  }

  async getCategories(sessionId: string): Promise<CategorySummary[]> {
    return await db.select().from(categorySummaryTable).where(eq(categorySummaryTable.sessionId, sessionId));
  }

  async addCategoryItems(sessionId: string, categoryName: string, items: CategoryItemDetail[]): Promise<void> {
    await db.update(categorySummaryTable)
      .set({ items: JSON.stringify(items) })
      .where(and(
        eq(categorySummaryTable.sessionId, sessionId),
        eq(categorySummaryTable.category, categoryName)
      ));
  }

  async getCategoryItems(sessionId: string, categoryName: string): Promise<CategoryItemDetail[]> {
    const [row] = await db.select({ items: categorySummaryTable.items })
      .from(categorySummaryTable)
      .where(and(
        eq(categorySummaryTable.sessionId, sessionId),
        eq(categorySummaryTable.category, categoryName)
      ));
    if (!row?.items) return [];
    try { return JSON.parse(row.items); } catch { return []; }
  }

  async getFullResult(sessionId: string): Promise<ReconciliationResult | undefined> {
    const session = await this.getSession(sessionId);
    if (!session) return undefined;
    const comparisons = await this.getComparisons(sessionId);
    const paymentMethods = await this.getPaymentMethods(sessionId);
    const baseCategories = await this.getCategories(sessionId);
    const categories: CategoryWithDetails[] = baseCategories.map(cat => ({
      ...cat,
      items: cat.items ? (() => { try { return JSON.parse(cat.items); } catch { return []; } })() : [],
    }));
    return { session, comparisons, paymentMethods, categories };
  }

  async getCategorySettings(): Promise<CategorySettings[] | null> {
    const dbSettings = await db.select().from(categorySettingsTable);
    if (dbSettings.length === 0) {
      return null;
    }
    return dbSettings.map(s => ({
      name: s.name,
      keywords: JSON.parse(s.keywords),
      btwRate: s.btwRate,
      twinfieldAccount: s.twinfieldAccount,
      group: (s.name.includes('Omzet') || s.name.includes('Drank') || s.name.includes('Keuken')) ? 'horeca' as const : 'yoga' as const,
    }));
  }

  async saveCategorySettings(settings: CategorySettings[]): Promise<void> {
    await db.delete(categorySettingsTable);
    for (const setting of settings) {
      await db.insert(categorySettingsTable).values({
        name: setting.name,
        twinfieldAccount: setting.twinfieldAccount,
        btwRate: setting.btwRate,
        keywords: JSON.stringify(setting.keywords),
      });
    }
    this.customCategorySettings = settings;
  }

  async resetCategorySettings(): Promise<void> {
    await db.delete(categorySettingsTable);
    this.customCategorySettings = null;
  }

  async getAllPaymentMethodSettings(): Promise<PaymentMethodSettingsDB[]> {
    return await db.select().from(paymentMethodSettings);
  }

  async savePaymentMethodSettings(methodName: string, twinfieldAccount: string, isStripeMethod: boolean): Promise<void> {
    const existing = await db.select().from(paymentMethodSettings).where(eq(paymentMethodSettings.methodName, methodName));
    if (existing.length > 0) {
      await db.update(paymentMethodSettings)
        .set({ twinfieldAccount, isStripeMethod, updatedAt: new Date() })
        .where(eq(paymentMethodSettings.methodName, methodName));
    } else {
      await db.insert(paymentMethodSettings).values({
        methodName,
        twinfieldAccount,
        isStripeMethod,
      });
    }
  }

  async getProductByName(itemName: string): Promise<ProductSettings | undefined> {
    const [product] = await db.select().from(productSettings).where(eq(productSettings.itemName, itemName));
    return product || undefined;
  }

  async getAllProducts(): Promise<ProductSettings[]> {
    return await db.select().from(productSettings);
  }

  async saveProduct(product: InsertProductSettings): Promise<ProductSettings> {
    const [saved] = await db.insert(productSettings).values(product).returning();
    return saved;
  }

  async updateProduct(id: number, updates: Partial<InsertProductSettings>): Promise<ProductSettings | undefined> {
    const [updated] = await db
      .update(productSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(productSettings.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteProduct(id: number): Promise<void> {
    await db.delete(productSettings).where(eq(productSettings.id, id));
  }

  async clearAllProducts(): Promise<void> {
    await db.delete(productSettings);
  }

  async savePendingReconciliation(data: InsertPendingReconciliation): Promise<PendingReconciliation> {
    const [pending] = await db.insert(pendingReconciliations).values(data).returning();
    return pending;
  }

  async getPendingReconciliation(id: string): Promise<PendingReconciliation | undefined> {
    const [pending] = await db.select().from(pendingReconciliations).where(eq(pendingReconciliations.id, id));
    return pending || undefined;
  }

  async getAllPendingReconciliations(): Promise<PendingReconciliation[]> {
    return await db.select().from(pendingReconciliations).orderBy(pendingReconciliations.createdAt);
  }

  async deletePendingReconciliation(id: string): Promise<void> {
    await db.delete(pendingReconciliations).where(eq(pendingReconciliations.id, id));
  }

  async clearAllPendingReconciliations(): Promise<void> {
    await db.delete(pendingReconciliations);
  }

  async addAccrualEntries(sessionId: string, entries: InsertAccrualEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await db.insert(accrualSchedule).values(entries);
  }

  async getAccrualEntries(sessionId: string): Promise<AccrualEntry[]> {
    return await db.select().from(accrualSchedule).where(eq(accrualSchedule.sessionId, sessionId));
  }

  async getAccrualEntriesByPeriod(bookingMonth: string): Promise<AccrualEntry[]> {
    // Only use entries from the most recent session per source period.
    // Multiple sessions for the same period (e.g. re-uploads) each write their own
    // accrual entries — without this filter the vrijval would be multiplied.
    const allSessions = await db
      .select({ id: reconciliationSessions.id, period: reconciliationSessions.period })
      .from(reconciliationSessions)
      .orderBy(desc(reconciliationSessions.createdAt));

    const latestByPeriod = new Map<string, string>();
    for (const s of allSessions) {
      if (!latestByPeriod.has(s.period)) latestByPeriod.set(s.period, s.id);
    }
    const latestIds = Array.from(latestByPeriod.values());
    if (latestIds.length === 0) return [];

    return await db
      .select()
      .from(accrualSchedule)
      .where(and(
        eq(accrualSchedule.bookingMonth, bookingMonth),
        inArray(accrualSchedule.sessionId, latestIds),
      ));
  }

  async getGeneralSettings(): Promise<TwinfieldGeneralSettings> {
    const rows = await db.select().from(generalSettingsTable);
    const map = new Map(rows.map(r => [r.key, r.value]));
    return {
      office: map.get("office") ?? DEFAULT_GENERAL_SETTINGS.office,
      journalCode: map.get("journalCode") ?? DEFAULT_GENERAL_SETTINGS.journalCode,
      accrualCrossAccount: map.get("accrualCrossAccount") ?? DEFAULT_GENERAL_SETTINGS.accrualCrossAccount,
      stripeFeeAccount: map.get("stripeFeeAccount") ?? DEFAULT_GENERAL_SETTINGS.stripeFeeAccount,
    };
  }

  async saveGeneralSettings(settings: TwinfieldGeneralSettings): Promise<void> {
    const entries = Object.entries(settings) as [string, string][];
    for (const [key, value] of entries) {
      const existing = await db.select().from(generalSettingsTable).where(eq(generalSettingsTable.key, key));
      if (existing.length > 0) {
        await db.update(generalSettingsTable)
          .set({ value, updatedAt: new Date() })
          .where(eq(generalSettingsTable.key, key));
      } else {
        await db.insert(generalSettingsTable).values({ key, value });
      }
    }
  }

  async getStripeCache(period: string): Promise<{ data: string; transactionCount: number; fetchedAt: Date | null } | undefined> {
    const [row] = await db.select().from(stripeCache).where(eq(stripeCache.period, period));
    if (!row) return undefined;
    return { data: row.data, transactionCount: row.transactionCount ?? 0, fetchedAt: row.fetchedAt };
  }

  async saveStripeCache(period: string, data: string, transactionCount: number): Promise<void> {
    await db.delete(stripeCache).where(eq(stripeCache.period, period));
    await db.insert(stripeCache).values({ period, data, transactionCount });
  }
}

export const storage = new DatabaseStorage();
