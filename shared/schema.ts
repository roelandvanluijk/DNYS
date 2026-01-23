import { pgTable, text, varchar, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const reconciliationSessions = pgTable("reconciliation_sessions", {
  id: varchar("id").primaryKey(),
  period: text("period").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  momenceTotal: real("momence_total").default(0),
  stripeTotal: real("stripe_total").default(0),
  stripeFees: real("stripe_fees").default(0),
  nonStripeTotal: real("non_stripe_total").default(0),
  matchedCount: integer("matched_count").default(0),
  unmatchedCount: integer("unmatched_count").default(0),
  status: text("status").default("completed"),
});

export const momenceTransactions = pgTable("momence_transactions", {
  id: integer("id").primaryKey(),
  sessionId: varchar("session_id").notNull(),
  saleReference: text("sale_reference"),
  category: text("category"),
  item: text("item"),
  date: text("date"),
  saleValue: real("sale_value").default(0),
  tax: real("tax").default(0),
  paymentMethod: text("payment_method"),
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
});

export const stripeTransactions = pgTable("stripe_transactions", {
  id: integer("id").primaryKey(),
  sessionId: varchar("session_id").notNull(),
  chargeId: text("charge_id"),
  amount: real("amount").default(0),
  fee: real("fee").default(0),
  createdDate: text("created_date"),
  customerEmail: text("customer_email"),
  status: text("status"),
});

export const customerComparison = pgTable("customer_comparison", {
  id: integer("id").primaryKey(),
  sessionId: varchar("session_id").notNull(),
  customerEmail: text("customer_email").notNull(),
  momenceTotal: real("momence_total").default(0),
  stripeAmount: real("stripe_amount").default(0),
  stripeFee: real("stripe_fee").default(0),
  stripeNet: real("stripe_net").default(0),
  difference: real("difference").default(0),
  matchStatus: text("match_status"),
});

export const paymentMethodSummary = pgTable("payment_method_summary", {
  id: integer("id").primaryKey(),
  sessionId: varchar("session_id").notNull(),
  paymentMethod: text("payment_method").notNull(),
  transactionCount: integer("transaction_count").default(0),
  totalAmount: real("total_amount").default(0),
  percentage: real("percentage").default(0),
});

export const categorySummary = pgTable("category_summary", {
  id: integer("id").primaryKey(),
  sessionId: varchar("session_id").notNull(),
  category: text("category").notNull(),
  transactionCount: integer("transaction_count").default(0),
  totalAmount: real("total_amount").default(0),
  percentage: real("percentage").default(0),
});

export const insertSessionSchema = createInsertSchema(reconciliationSessions).omit({
  createdAt: true,
});

export type InsertSession = z.infer<typeof insertSessionSchema>;
export type ReconciliationSession = typeof reconciliationSessions.$inferSelect;

export type MomenceTransaction = typeof momenceTransactions.$inferSelect;
export type StripeTransaction = typeof stripeTransactions.$inferSelect;
export type CustomerComparison = typeof customerComparison.$inferSelect;
export type PaymentMethodSummary = typeof paymentMethodSummary.$inferSelect;
export type CategorySummary = typeof categorySummary.$inferSelect;

export interface ReconciliationResult {
  session: ReconciliationSession;
  comparisons: CustomerComparison[];
  paymentMethods: PaymentMethodSummary[];
  categories: CategorySummary[];
}

export interface UploadResponse {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export const STRIPE_PAYMENT_METHODS = ["Card", "iDEAL", "SEPA Direct Debit", "Card reader"];
export const NON_STRIPE_PAYMENT_METHODS = ["Class Pass", "urban-sports-club", "Gift card"];

export type MatchStatus = "match" | "small_diff" | "large_diff" | "only_in_momence" | "only_in_stripe";

export const REVENUE_CATEGORY_RULES: Record<string, string[]> = {
  'Abonnementen': [
    'membership', 'unlimited', 'abonnement', 'lidmaatschap',
    'monthly membership', 'yearly membership', 'year membership'
  ],
  'Rittenkaarten': [
    'class card', 'lessenkaart', 'rittenkaart', 'pack'
  ],
  'Single Classes': [
    'single class', 'losse les', '€15', '€16', '€17', '€18',
    'drop in', 'drop-in'
  ],
  'Workshops & Events': [
    'workshop', 'ceremony', 'event', 'retreat', 'circle',
    'tantra', 'cacao', 'truffle', 'breathwork', 'sound'
  ],
  'Trainings & Opleidingen': [
    'training', 'opleiding', 'teacher', 'coach', 'facilitator',
    'certification', '200 uur', 'schoolverlichting'
  ],
  'Online': [
    'livestream', 'online', 'virtual'
  ],
  'Horeca - Koffie': [
    'coffee', 'cappuccino', 'latte', 'espresso', 'macchiato',
    'flat white', 'cortado', 'americano'
  ],
  'Horeca - Thee & Dranken': [
    'tea', 'chai', 'matcha', 'smoothie', 'juice', 'kombucha',
    'lemonade', 'water'
  ],
  'Horeca - Food': [
    'brownie', 'banana bread', 'bananenbrood', 'bliss ball',
    'snack', 'soep', 'soup', 'quiche', 'salad'
  ],
  'Gift Cards': [
    'gift card', 'cadeaukaart', 'voucher'
  ],
  'Money Credits': [
    'money credit', 'credit', 'tegoed'
  ]
};

export const users = pgTable("users", {
  id: varchar("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
