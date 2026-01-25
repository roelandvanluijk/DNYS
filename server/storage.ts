import { randomUUID } from "crypto";
import type { 
  ReconciliationSession, 
  CustomerComparison, 
  PaymentMethodSummary,
  CategorySummary,
  CategoryItemDetail,
  CategoryWithDetails,
  ReconciliationResult 
} from "@shared/schema";

export interface CategorySettings {
  name: string;
  keywords: string[];
  btwRate: number;
  twinfieldAccount: string;
  group: "yoga" | "horeca";
}

export interface IStorage {
  createSession(session: Omit<ReconciliationSession, "id" | "createdAt">): Promise<ReconciliationSession>;
  getSession(id: string): Promise<ReconciliationSession | undefined>;
  getAllSessions(): Promise<ReconciliationSession[]>;
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
}

export class MemStorage implements IStorage {
  private sessions: Map<string, ReconciliationSession>;
  private comparisons: Map<string, CustomerComparison[]>;
  private paymentMethods: Map<string, PaymentMethodSummary[]>;
  private categories: Map<string, CategorySummary[]>;
  private categoryItems: Map<string, Map<string, CategoryItemDetail[]>>;
  private customCategorySettings: CategorySettings[] | null;
  private comparisonIdCounter: number;
  private methodIdCounter: number;
  private categoryIdCounter: number;

  constructor() {
    this.sessions = new Map();
    this.comparisons = new Map();
    this.paymentMethods = new Map();
    this.categories = new Map();
    this.categoryItems = new Map();
    this.customCategorySettings = null;
    this.comparisonIdCounter = 1;
    this.methodIdCounter = 1;
    this.categoryIdCounter = 1;
  }

  async createSession(session: Omit<ReconciliationSession, "id" | "createdAt">): Promise<ReconciliationSession> {
    const id = randomUUID();
    const newSession: ReconciliationSession = {
      ...session,
      id,
      createdAt: new Date(),
    };
    this.sessions.set(id, newSession);
    return newSession;
  }

  async getSession(id: string): Promise<ReconciliationSession | undefined> {
    return this.sessions.get(id);
  }

  async getAllSessions(): Promise<ReconciliationSession[]> {
    return Array.from(this.sessions.values()).sort((a, b) => {
      const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
      const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
      return dateB.getTime() - dateA.getTime();
    });
  }

  async addComparisons(sessionId: string, comps: Omit<CustomerComparison, "id">[]): Promise<void> {
    const withIds = comps.map((c) => ({
      ...c,
      id: this.comparisonIdCounter++,
    }));
    this.comparisons.set(sessionId, withIds);
  }

  async getComparisons(sessionId: string): Promise<CustomerComparison[]> {
    return this.comparisons.get(sessionId) || [];
  }

  async addPaymentMethods(sessionId: string, methods: Omit<PaymentMethodSummary, "id">[]): Promise<void> {
    const withIds = methods.map((m) => ({
      ...m,
      id: this.methodIdCounter++,
    }));
    this.paymentMethods.set(sessionId, withIds);
  }

  async getPaymentMethods(sessionId: string): Promise<PaymentMethodSummary[]> {
    return this.paymentMethods.get(sessionId) || [];
  }

  async addCategories(sessionId: string, cats: Omit<CategorySummary, "id">[]): Promise<void> {
    const withIds = cats.map((c) => ({
      ...c,
      id: this.categoryIdCounter++,
    }));
    this.categories.set(sessionId, withIds);
  }

  async getCategories(sessionId: string): Promise<CategorySummary[]> {
    return this.categories.get(sessionId) || [];
  }

  async addCategoryItems(sessionId: string, categoryName: string, items: CategoryItemDetail[]): Promise<void> {
    if (!this.categoryItems.has(sessionId)) {
      this.categoryItems.set(sessionId, new Map());
    }
    const sessionItems = this.categoryItems.get(sessionId)!;
    sessionItems.set(categoryName, items);
  }

  async getCategoryItems(sessionId: string, categoryName: string): Promise<CategoryItemDetail[]> {
    const sessionItems = this.categoryItems.get(sessionId);
    if (!sessionItems) return [];
    return sessionItems.get(categoryName) || [];
  }

  async getFullResult(sessionId: string): Promise<ReconciliationResult | undefined> {
    const session = await this.getSession(sessionId);
    if (!session) return undefined;

    const comparisons = await this.getComparisons(sessionId);
    const paymentMethods = await this.getPaymentMethods(sessionId);
    const baseCategories = await this.getCategories(sessionId);
    
    // Attach item details to each category
    const categories: CategoryWithDetails[] = await Promise.all(
      baseCategories.map(async (cat) => ({
        ...cat,
        items: await this.getCategoryItems(sessionId, cat.category),
      }))
    );

    return { session, comparisons, paymentMethods, categories };
  }

  async getCategorySettings(): Promise<CategorySettings[] | null> {
    return this.customCategorySettings;
  }

  async saveCategorySettings(settings: CategorySettings[]): Promise<void> {
    this.customCategorySettings = settings;
  }

  async resetCategorySettings(): Promise<void> {
    this.customCategorySettings = null;
  }
}

export const storage = new MemStorage();
