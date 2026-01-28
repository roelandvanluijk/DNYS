import { pgTable, text, varchar, real, integer, timestamp, boolean, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const productSettings = pgTable("product_settings", {
  id: serial("id").primaryKey(),
  itemName: text("item_name").notNull().unique(),
  category: text("category").notNull(),
  btwRate: real("btw_rate").notNull().default(0.09),
  twinfieldAccount: text("twinfield_account"),
  
  hasAccrual: boolean("has_accrual").default(false),
  accrualMonths: integer("accrual_months"),
  accrualStartOffset: integer("accrual_start_offset").default(0),
  
  hasSpread: boolean("has_spread").default(false),
  spreadMonths: integer("spread_months").default(12),
  
  firstSeenDate: text("first_seen_date"),
  lastSeenDate: text("last_seen_date"),
  transactionCount: integer("transaction_count").default(0),
  
  isReviewed: boolean("is_reviewed").default(false),
  needsReview: boolean("needs_review").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertProductSettingsSchema = createInsertSchema(productSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProductSettings = z.infer<typeof insertProductSettingsSchema>;
export type ProductSettings = typeof productSettings.$inferSelect;

export const reconciliationSessions = pgTable("reconciliation_sessions", {
  id: varchar("id").primaryKey(),
  period: text("period").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  momenceTotal: real("momence_total").default(0),
  stripeTotal: real("stripe_total").default(0),
  stripeFees: real("stripe_fees").default(0),
  stripeNet: real("stripe_net").default(0),
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
  revenueCategory: text("revenue_category"),
  btwRate: real("btw_rate").default(0),
  twinfieldAccount: text("twinfield_account"),
});

export const stripeTransactions = pgTable("stripe_transactions", {
  id: integer("id").primaryKey(),
  sessionId: varchar("session_id").notNull(),
  chargeId: text("charge_id"),
  amount: real("amount").default(0),
  fee: real("fee").default(0),
  net: real("net").default(0),
  createdDate: text("created_date"),
  customerEmail: text("customer_email"),
  reportingCategory: text("reporting_category"),
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
  items: text("items"),
  transactionDate: text("transaction_date"),
  transactionCount: integer("transaction_count").default(0),
});

export const paymentMethodSummary = pgTable("payment_method_summary", {
  id: integer("id").primaryKey(),
  sessionId: varchar("session_id").notNull(),
  paymentMethod: text("payment_method").notNull(),
  transactionCount: integer("transaction_count").default(0),
  totalAmount: real("total_amount").default(0),
  percentage: real("percentage").default(0),
  goesThruStripe: integer("goes_thru_stripe").default(0),
});

export const categorySummary = pgTable("category_summary", {
  id: integer("id").primaryKey(),
  sessionId: varchar("session_id").notNull(),
  category: text("category").notNull(),
  transactionCount: integer("transaction_count").default(0),
  totalAmount: real("total_amount").default(0),
  totalTax: real("total_tax").default(0),
  btwRate: real("btw_rate").default(0),
  twinfieldAccount: text("twinfield_account"),
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

export interface CategoryItemDetail {
  item: string;
  amount: number;
  count: number;
  date?: string;
}

export interface CategoryWithDetails extends CategorySummary {
  items?: CategoryItemDetail[];
}

export interface ReconciliationResult {
  session: ReconciliationSession;
  comparisons: CustomerComparison[];
  paymentMethods: PaymentMethodSummary[];
  categories: CategoryWithDetails[];
}

export interface UploadResponse {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export const STRIPE_PAYMENT_METHODS = ["Card", "iDEAL", "SEPA Direct Debit", "Card reader"];
export const NON_STRIPE_PAYMENT_METHODS = ["Class Pass", "urban-sports-club", "Gift card"];

export type MatchStatus = "match" | "small_diff" | "large_diff" | "only_in_momence" | "only_in_stripe";

export interface CategoryConfig {
  keywords: string[];
  btwRate: number;
  twinfieldAccount: string;
  group: "yoga" | "horeca";
}

export interface CategoryConfigWithSpecial extends CategoryConfig {
  specialHandling?: 'accrual' | 'spread_12' | null;
  priority: number;
}

export const REVENUE_CATEGORIES: Record<string, CategoryConfigWithSpecial> = {
  'Online/Livestream': {
    keywords: ['livestream', 'online', 'virtual'],
    btwRate: 0.09,
    twinfieldAccount: '8200',
    group: 'yoga',
    priority: 1,
  },
  'Opleidingen': {
    keywords: [
      'opleiding', 'teacher training', '200 uur', 'ademcoach',
      'yogatherapie', 'meditatie tot zelfrealisatie', 'schoolverlichting',
      'facilitator', 'certification', '300 uur', 'yin yoga training',
      'pilates teacher training'
    ],
    btwRate: 0.21,
    twinfieldAccount: '8300',
    group: 'yoga',
    specialHandling: 'accrual',
    priority: 2,
  },
  'Jaarabonnementen': {
    keywords: ['year membership', 'yearly membership', 'jaar abonnement', 'jaarlidmaatschap'],
    btwRate: 0.09,
    twinfieldAccount: '8101',
    group: 'yoga',
    specialHandling: 'spread_12',
    priority: 3,
  },
  'Gift Cards': {
    keywords: ['gift card', 'cadeaukaart', 'voucher'],
    btwRate: 0.00,
    twinfieldAccount: '8900',
    group: 'yoga',
    priority: 4,
  },
  'Money Credits': {
    keywords: ['money credit', 'tegoed', 'credit'],
    btwRate: 0.00,
    twinfieldAccount: '8901',
    group: 'yoga',
    priority: 5,
  },
  'Workshops & Events': {
    keywords: [
      'workshop', 'ceremony', 'cacao', 'tantra', 'truffle',
      'retreat', 'circle', 'event', 'face yoga', 'new year',
      'sound bath', 'gong', 'kirtan', 'sound healing'
    ],
    btwRate: 0.09,
    twinfieldAccount: '8150',
    group: 'yoga',
    priority: 6,
  },
  'Abonnementen': {
    keywords: [
      'membership', 'unlimited', 'abonnement', 'lidmaatschap', 'doorlopend',
      'monthly', 'maandelijks'
    ],
    btwRate: 0.09,
    twinfieldAccount: '8100',
    group: 'yoga',
    priority: 7,
  },
  'Rittenkaarten': {
    keywords: [
      'class card', 'rittenkaart', 'lessenkaart', 'intro', 'kaart',
      'pack', '5 class', '10 class', '20 class', 'ritten'
    ],
    btwRate: 0.09,
    twinfieldAccount: '8110',
    group: 'yoga',
    priority: 8,
  },
  'Omzet Keuken': {
    keywords: [
      'bananenbrood', 'banana bread', 'quiche', 'soep', 'soup',
      'bliss ball', 'brownie', 'snickers', 'combideal', 'meal',
      'snack', 'food', 'eten'
    ],
    btwRate: 0.09,
    twinfieldAccount: '8001',
    group: 'horeca',
    priority: 9,
  },
  'Omzet Drank Laag': {
    keywords: [
      'coffee', 'cappuccino', 'latte', 'espresso', 'flat white',
      'cortado', 'macchiato', 'americano', 'chai', 'matcha',
      'tea', 'thee', 'smoothie', 'kombucha', 'lemonaid', 'charitea',
      'kokoswater', 'water', 'ijsthee', 'juice', 'cacaoccino',
      'cacao shot', 'cashew melk', 'koffie', 'drank'
    ],
    btwRate: 0.09,
    twinfieldAccount: '8002',
    group: 'horeca',
    priority: 10,
  },
  'Omzet Drank Hoog': {
    keywords: ['beer', 'wine', 'alcohol', 'bier', 'wijn'],
    btwRate: 0.21,
    twinfieldAccount: '8003',
    group: 'horeca',
    priority: 11,
  },
  'Single Classes': {
    keywords: [
      'single class', 'yoga', 'pilates', 'flow', 'yin', 'vinyasa',
      'ashtanga', 'hatha', 'restorative', 'breathwork', 'meditation',
      'sound', 'losse les', 'drop in', 'drop-in', '€15', '€16', '€17', '€18',
      'class', 'les'
    ],
    btwRate: 0.09,
    twinfieldAccount: '8120',
    group: 'yoga',
    priority: 12,
  },
  'Overig': {
    keywords: [],
    btwRate: 0.09,
    twinfieldAccount: '8999',
    group: 'yoga',
    priority: 99,
  },
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
