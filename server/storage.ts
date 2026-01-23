import { randomUUID } from "crypto";
import type { 
  ReconciliationSession, 
  CustomerComparison, 
  PaymentMethodSummary,
  ReconciliationResult 
} from "@shared/schema";

export interface IStorage {
  createSession(session: Omit<ReconciliationSession, "id" | "createdAt">): Promise<ReconciliationSession>;
  getSession(id: string): Promise<ReconciliationSession | undefined>;
  getAllSessions(): Promise<ReconciliationSession[]>;
  addComparisons(sessionId: string, comparisons: Omit<CustomerComparison, "id">[]): Promise<void>;
  getComparisons(sessionId: string): Promise<CustomerComparison[]>;
  addPaymentMethods(sessionId: string, methods: Omit<PaymentMethodSummary, "id">[]): Promise<void>;
  getPaymentMethods(sessionId: string): Promise<PaymentMethodSummary[]>;
  getFullResult(sessionId: string): Promise<ReconciliationResult | undefined>;
}

export class MemStorage implements IStorage {
  private sessions: Map<string, ReconciliationSession>;
  private comparisons: Map<string, CustomerComparison[]>;
  private paymentMethods: Map<string, PaymentMethodSummary[]>;
  private comparisonIdCounter: number;
  private methodIdCounter: number;

  constructor() {
    this.sessions = new Map();
    this.comparisons = new Map();
    this.paymentMethods = new Map();
    this.comparisonIdCounter = 1;
    this.methodIdCounter = 1;
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

  async getFullResult(sessionId: string): Promise<ReconciliationResult | undefined> {
    const session = await this.getSession(sessionId);
    if (!session) return undefined;

    const comparisons = await this.getComparisons(sessionId);
    const paymentMethods = await this.getPaymentMethods(sessionId);

    return { session, comparisons, paymentMethods };
  }
}

export const storage = new MemStorage();
