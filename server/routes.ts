import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { storage, type NewProductSuggestion } from "./storage";
import { STRIPE_PAYMENT_METHODS, REVENUE_CATEGORIES, type MatchStatus, type CategoryConfig, type ProductSettings } from "@shared/schema";

// Emails to exclude from customer comparisons (studio's own email)
const EXCLUDED_EMAILS = ["info@denieuweyogaschool.nl"];

const upload = multer({ storage: multer.memoryStorage() });

interface MomenceRow {
  Category?: string;
  Item?: string;
  Date?: string;
  "Sale value"?: string;
  Tax?: string;
  Refunded?: string;
  "Payment method"?: string;
  "Payment status"?: string;
  "Sale reference"?: string;
  "Sold by"?: string;
  "Paying Customer email"?: string;
  "Paying Customer name"?: string;
  "Customer email"?: string;
  "Customer name"?: string;
  Location?: string;
  Note?: string;
}

interface StripeRow {
  id?: string;
  created?: string;
  "Created date (UTC)"?: string;
  gross?: string;
  Amount?: string;
  fee?: string;
  Fee?: string;
  net?: string;
  customer_email?: string;
  "Customer Email"?: string;
  reporting_category?: string;
  Status?: string;
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  
  let cleaned = value.replace(/[€$\s]/g, "").trim();
  
  const lastComma = cleaned.lastIndexOf(",");
  const lastPeriod = cleaned.lastIndexOf(".");
  
  if (lastComma > lastPeriod) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastPeriod > lastComma) {
    cleaned = cleaned.replace(/,/g, "");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function normalizeEmail(email: string | undefined): string {
  return (email || "").toLowerCase().trim();
}

function getMatchStatus(difference: number): MatchStatus {
  const absDiff = Math.abs(difference);
  if (absDiff < 1) return "match";
  if (absDiff < 5) return "small_diff";
  return "large_diff";
}

interface CategoryResult {
  category: string;
  btwRate: number;
  twinfieldAccount: string;
  specialHandling?: 'accrual' | 'spread_12' | null;
}

interface CustomCategoryConfig {
  name: string;
  keywords: string[];
  btwRate: number;
  twinfieldAccount: string;
  group: "yoga" | "horeca";
}

function categorizeItemByKeywords(
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
    'Jaarabonnementen',
    'Gift Cards',
    'Money Credits',
    'Workshops & Events',
    'Abonnementen',
    'Rittenkaarten',
    'Omzet Keuken',
    'Omzet Drank Laag',
    'Omzet Drank Hoog',
    'Single Classes',
  ];
  
  // Check for gift card codes (alphanumeric 6-10 chars)
  if (/^[A-Z0-9]{6,10}$/.test(itemName)) {
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

function categorizeItemFromProduct(product: ProductSettings): CategoryResult {
  return {
    category: product.category,
    btwRate: product.btwRate,
    twinfieldAccount: product.twinfieldAccount || "8999",
    specialHandling: product.hasAccrual ? 'accrual' : product.hasSpread ? 'spread_12' : null,
  };
}

async function categorizeItem(
  itemName: string | undefined,
  customCategories: CustomCategoryConfig[] | null
): Promise<CategoryResult> {
  if (!itemName) {
    return { category: "Overig", btwRate: 0.09, twinfieldAccount: "8999" };
  }
  
  const storedProduct = await storage.getProductByName(itemName);
  if (storedProduct && storedProduct.isReviewed) {
    return categorizeItemFromProduct(storedProduct);
  }
  
  return categorizeItemByKeywords(itemName, customCategories);
}

async function checkForNewProducts(
  momenceData: MomenceRow[],
  customCategories: CustomCategoryConfig[] | null
): Promise<NewProductSuggestion[]> {
  const itemStats = new Map<string, { count: number; total: number }>();
  
  for (const row of momenceData) {
    const item = row.Item || "";
    if (!item) continue;
    
    const saleValue = parseNumber(row["Sale value"]);
    const current = itemStats.get(item) || { count: 0, total: 0 };
    current.count++;
    current.total += saleValue;
    itemStats.set(item, current);
  }
  
  const newProducts: NewProductSuggestion[] = [];
  
  for (const [itemName, stats] of Array.from(itemStats.entries())) {
    const storedProduct = await storage.getProductByName(itemName);
    
    if (!storedProduct) {
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
    }
  }
  
  return newProducts;
}

// Shared reconciliation processing function used by both /api/reconcile and /api/reconcile/continue
async function processReconciliation(
  momenceData: MomenceRow[],
  stripeData: StripeRow[],
  period: string,
  customCategories: CustomCategoryConfig[] | null
): Promise<{ sessionId: string }> {
  
  const momenceByEmail = new Map<string, number>();
  const momenceItemsByEmail = new Map<string, Set<string>>();
  const momenceDatesByEmail = new Map<string, Set<string>>();
  const momenceCountByEmail = new Map<string, number>();
  const paymentMethodTotals = new Map<string, { count: number; total: number; isStripe: boolean }>();
  const categoryTotals = new Map<string, { 
    count: number; 
    total: number; 
    totalTax: number;
    btwRate: number; 
    twinfieldAccount: string;
  }>();
  const categoryItems = new Map<string, Map<string, { amount: number; count: number; dates: Set<string> }>>();
  let momenceTotalAll = 0;
  let nonStripeTotal = 0;

  for (const row of momenceData) {
    const paymentMethod = row["Payment method"] || "";
    const saleValue = parseNumber(row["Sale value"]);
    const tax = parseNumber(row.Tax);
    const customerEmail = normalizeEmail(row["Customer email"]);
    const item = row.Item || "";
    const transactionDate = row["Date"] || "";

    const isStripeMethod = STRIPE_PAYMENT_METHODS.some(
      (m) => paymentMethod.toLowerCase().includes(m.toLowerCase())
    );

    const methodData = paymentMethodTotals.get(paymentMethod) || { count: 0, total: 0, isStripe: isStripeMethod };
    methodData.count++;
    methodData.total += saleValue;
    paymentMethodTotals.set(paymentMethod, methodData);
    momenceTotalAll += saleValue;

    // FIX 3: Categorize ALL transactions, not just Stripe payments
    const { category, btwRate, twinfieldAccount } = await categorizeItem(item, customCategories);
    const catData = categoryTotals.get(category) || { 
      count: 0, 
      total: 0, 
      totalTax: 0,
      btwRate, 
      twinfieldAccount 
    };
    catData.count++;
    catData.total += saleValue;
    catData.totalTax += tax;
    categoryTotals.set(category, catData);
    
    // Track item details per category (for ALL payment methods)
    const itemName = item || "Onbekend";
    if (!categoryItems.has(category)) {
      categoryItems.set(category, new Map());
    }
    const itemsMap = categoryItems.get(category)!;
    const itemData = itemsMap.get(itemName) || { amount: 0, count: 0, dates: new Set<string>() };
    itemData.amount += saleValue;
    itemData.count++;
    if (transactionDate) itemData.dates.add(transactionDate);
    itemsMap.set(itemName, itemData);

    // Stripe-specific: only aggregate by email for Stripe reconciliation matching
    if (isStripeMethod) {
      if (customerEmail) {
        const current = momenceByEmail.get(customerEmail) || 0;
        momenceByEmail.set(customerEmail, current + saleValue);
        
        const items = momenceItemsByEmail.get(customerEmail) || new Set<string>();
        if (item) items.add(item);
        momenceItemsByEmail.set(customerEmail, items);
        
        const dates = momenceDatesByEmail.get(customerEmail) || new Set<string>();
        if (transactionDate) dates.add(transactionDate);
        momenceDatesByEmail.set(customerEmail, dates);
        
        const count = momenceCountByEmail.get(customerEmail) || 0;
        momenceCountByEmail.set(customerEmail, count + 1);
      }
    } else {
      nonStripeTotal += saleValue;
    }
  }

  const stripeByEmail = new Map<string, { amount: number; fee: number }>();
  let stripeTotalAmount = 0;
  let stripeTotalFees = 0;

  for (const row of stripeData) {
    const reportingCategory = row.reporting_category?.toLowerCase() || "";
    const status = row.Status?.toLowerCase() || "";
    
    const isCharge = reportingCategory === "charge" || status === "paid";
    if (!isCharge) continue;

    const email = normalizeEmail(row.customer_email || row["Customer Email"]);
    if (!email) continue;

    const amount = parseNumber(row.gross || row.Amount);
    const fee = parseNumber(row.fee || row.Fee);

    stripeTotalAmount += amount;
    stripeTotalFees += fee;

    const current = stripeByEmail.get(email) || { amount: 0, fee: 0 };
    current.amount += amount;
    current.fee += fee;
    stripeByEmail.set(email, current);
  }

  const allEmails = Array.from(new Set([
    ...Array.from(momenceByEmail.keys()), 
    ...Array.from(stripeByEmail.keys())
  ]));
  const comparisons: Array<{
    sessionId: string;
    customerEmail: string;
    momenceTotal: number;
    stripeAmount: number;
    stripeFee: number;
    stripeNet: number;
    difference: number;
    matchStatus: MatchStatus;
    items: string;
    transactionDate: string;
    transactionCount: number;
  }> = [];

  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const email of allEmails) {
    // Skip excluded emails (studio's own email addresses)
    if (EXCLUDED_EMAILS.includes(email.toLowerCase())) {
      continue;
    }
    
    const momenceTotal = momenceByEmail.get(email) || 0;
    const stripeEmailData = stripeByEmail.get(email) || { amount: 0, fee: 0 };
    const stripeNet = stripeEmailData.amount - stripeEmailData.fee;
    const difference = momenceTotal - stripeEmailData.amount;

    let matchStatus: MatchStatus;
    if (momenceTotal > 0 && stripeEmailData.amount === 0) {
      matchStatus = "only_in_momence";
    } else if (momenceTotal === 0 && stripeEmailData.amount > 0) {
      matchStatus = "only_in_stripe";
    } else {
      matchStatus = getMatchStatus(difference);
    }

    if (matchStatus === "match") {
      matchedCount++;
    } else {
      unmatchedCount++;
    }

    const customerItems = momenceItemsByEmail.get(email);
    const customerDates = momenceDatesByEmail.get(email);
    const customerCount = momenceCountByEmail.get(email) || 0;

    comparisons.push({
      sessionId: "",
      customerEmail: email,
      momenceTotal,
      stripeAmount: stripeEmailData.amount,
      stripeFee: stripeEmailData.fee,
      stripeNet,
      difference,
      matchStatus,
      items: customerItems ? Array.from(customerItems).join(", ") : "",
      transactionDate: customerDates ? Array.from(customerDates).join(", ") : "",
      transactionCount: customerCount,
    });
  }

  comparisons.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  const momenceStripeTotal = Array.from(momenceByEmail.values()).reduce((a, b) => a + b, 0);
  const stripeNetTotal = stripeTotalAmount - stripeTotalFees;

  const session = await storage.createSession({
    period,
    momenceTotal: momenceStripeTotal,
    stripeTotal: stripeTotalAmount,
    stripeFees: stripeTotalFees,
    stripeNet: stripeNetTotal,
    nonStripeTotal,
    matchedCount,
    unmatchedCount,
    status: "completed",
  });

  const comparisonsWithSession = comparisons.map((c) => ({
    ...c,
    sessionId: session.id,
  }));
  await storage.addComparisons(session.id, comparisonsWithSession);

  const sortedMethods = Array.from(paymentMethodTotals.entries())
    .sort((a, b) => b[1].total - a[1].total);

  const paymentMethods = sortedMethods.map(([method, data]) => ({
    sessionId: session.id,
    paymentMethod: method || "Onbekend",
    transactionCount: data.count,
    totalAmount: data.total,
    percentage: momenceTotalAll > 0 ? (data.total / momenceTotalAll) * 100 : 0,
    goesThruStripe: data.isStripe ? 1 : 0,
  }));

  await storage.addPaymentMethods(session.id, paymentMethods);

  const categoryTotal = Array.from(categoryTotals.values()).reduce((a, b) => a + b.total, 0);
  const sortedCategories = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1].total - a[1].total);

  const categories = sortedCategories.map(([category, data]) => ({
    sessionId: session.id,
    category,
    transactionCount: data.count,
    totalAmount: data.total,
    totalTax: data.totalTax,
    btwRate: data.btwRate,
    twinfieldAccount: data.twinfieldAccount,
    percentage: categoryTotal > 0 ? (data.total / categoryTotal) * 100 : 0,
  }));

  await storage.addCategories(session.id, categories);

  // Save category item details
  const categoryItemsArray = Array.from(categoryItems.entries());
  for (let i = 0; i < categoryItemsArray.length; i++) {
    const [categoryName, catItemsMap] = categoryItemsArray[i];
    const itemsArray = Array.from(catItemsMap.entries());
    const items = itemsArray
      .map((entry) => ({
        item: entry[0],
        amount: entry[1].amount,
        count: entry[1].count,
        date: Array.from(entry[1].dates).sort().join(', '),
      }))
      .sort((a, b) => b.amount - a.amount);
    await storage.addCategoryItems(session.id, categoryName, items);
  }

  return { sessionId: session.id };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.post("/api/reconcile", upload.fields([
    { name: "momence", maxCount: 1 },
    { name: "stripe", maxCount: 1 }
  ]), async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const momenceFile = files.momence?.[0];
      const stripeFile = files.stripe?.[0];
      const period = req.body.period || "";

      if (!momenceFile || !stripeFile) {
        console.error("Upload error: Missing files", { 
          hasMomence: !!momenceFile, 
          hasStripe: !!stripeFile 
        });
        return res.status(400).json({ 
          success: false, 
          error: "Beide bestanden zijn vereist",
          details: `Momence bestand: ${momenceFile ? 'ontvangen' : 'ontbreekt'}, Stripe bestand: ${stripeFile ? 'ontvangen' : 'ontbreekt'}`
        });
      }

      console.log("Processing files:", {
        momenceFileName: momenceFile.originalname,
        momenceSize: momenceFile.size,
        stripeFileName: stripeFile.originalname,
        stripeSize: stripeFile.size,
        period: period
      });

      const momenceContent = momenceFile.buffer.toString("utf-8");
      const stripeContent = stripeFile.buffer.toString("utf-8");

      const momenceResult = Papa.parse<MomenceRow>(momenceContent, {
        header: true,
        skipEmptyLines: true,
      });

      const stripeResult = Papa.parse<StripeRow>(stripeContent, {
        header: true,
        skipEmptyLines: true,
      });

      // Log parsing results
      console.log("CSV parsing results:", {
        momenceRows: momenceResult.data.length,
        momenceErrors: momenceResult.errors.length,
        stripeRows: stripeResult.data.length,
        stripeErrors: stripeResult.errors.length,
      });

      // Check for parsing errors
      if (momenceResult.errors.length > 0) {
        console.error("Momence CSV parsing errors:", momenceResult.errors.slice(0, 5));
      }
      if (stripeResult.errors.length > 0) {
        console.error("Stripe CSV parsing errors:", stripeResult.errors.slice(0, 5));
      }

      // Validate we have data
      if (momenceResult.data.length === 0) {
        console.error("Momence file is empty or invalid");
        return res.status(400).json({
          success: false,
          error: "Momence bestand is leeg of ongeldig",
          details: "Het bestand bevat geen data. Controleer of je het juiste bestand hebt geüpload."
        });
      }

      if (stripeResult.data.length === 0) {
        console.error("Stripe file is empty or invalid");
        return res.status(400).json({
          success: false,
          error: "Stripe bestand is leeg of ongeldig",
          details: "Het bestand bevat geen data. Controleer of je het juiste bestand hebt geüpload."
        });
      }

      // Check for required columns
      const momenceHeaders = Object.keys(momenceResult.data[0] || {});
      const stripeHeaders = Object.keys(stripeResult.data[0] || {});
      console.log("Detected headers:", { momenceHeaders, stripeHeaders });

      // Fetch custom category settings (if any)
      const customCategories = await storage.getCategorySettings();
      
      // Check for new products that need user review
      const skipReview = req.body.skipReview === 'true' || req.body.skipReview === true;
      if (!skipReview) {
        const newProducts = await checkForNewProducts(momenceResult.data, customCategories);
        if (newProducts.length > 0) {
          const tempSessionId = `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          // Store in database instead of memory so it persists
          await storage.savePendingReconciliation({
            id: tempSessionId,
            period,
            momenceData: JSON.stringify(momenceResult.data),
            stripeData: JSON.stringify(stripeResult.data),
            newProductCount: newProducts.length,
            status: "pending",
          });
          
          console.log("Saved pending reconciliation to database:", tempSessionId);
          
          return res.json({
            success: true,
            needsReview: true,
            tempSessionId,
            newProducts,
            newProductCount: newProducts.length,
          });
        }
      }

      // Use the shared processing function
      const result = await processReconciliation(momenceResult.data, stripeResult.data, period, customCategories);
      res.json({ success: true, sessionId: result.sessionId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Onbekende fout";
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      console.error("=== RECONCILIATION ERROR ===");
      console.error("Error message:", errorMessage);
      console.error("Error stack:", errorStack);
      console.error("Error object:", JSON.stringify(error, Object.getOwnPropertyNames(error || {}), 2));
      console.error("=== END ERROR ===");
      
      // Provide user-friendly error messages based on error type
      let userMessage = "Er is een fout opgetreden bij het verwerken van de bestanden.";
      let details = errorMessage;
      
      if (errorMessage.includes("database") || errorMessage.includes("connection") || errorMessage.includes("EAI_AGAIN")) {
        userMessage = "Database verbindingsfout";
        details = "De database is tijdelijk niet bereikbaar. Probeer het over een paar seconden opnieuw.";
      } else if (errorMessage.includes("parse") || errorMessage.includes("CSV")) {
        userMessage = "CSV verwerkingsfout";
        details = "Er is een probleem met het lezen van de CSV bestanden. Controleer of de bestanden het juiste formaat hebben.";
      } else if (errorMessage.includes("column") || errorMessage.includes("header")) {
        userMessage = "Onverwachte bestandsindeling";
        details = "De kolommen in het bestand komen niet overeen met het verwachte formaat.";
      }
      
      res.status(500).json({ 
        success: false, 
        error: userMessage,
        details: details,
        technicalError: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      });
    }
  });

  app.get("/api/sessions", async (req, res) => {
    try {
      const sessions = await storage.getAllSessions();
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: "Kon sessies niet laden" });
    }
  });

  app.get("/api/sessions/:sessionId", async (req, res) => {
    try {
      const result = await storage.getFullResult(req.params.sessionId);
      if (!result) {
        return res.status(404).json({ error: "Sessie niet gevonden" });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Kon sessie niet laden" });
    }
  });

  app.get("/api/sessions/:sessionId/download", async (req, res) => {
    try {
      const result = await storage.getFullResult(req.params.sessionId);
      if (!result) {
        return res.status(404).json({ error: "Sessie niet gevonden" });
      }

      const { session, comparisons, paymentMethods, categories } = result;

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "DNYS Reconciliatie Tool";
      workbook.created = new Date();

      const formatEuro = (value: number | null | undefined) => {
        const num = value ?? 0;
        return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(num);
      };

      const headerStyle: Partial<ExcelJS.Style> = {
        font: { bold: true, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B7355' } },
        alignment: { horizontal: 'left' },
      };

      const categoriesSheet = workbook.addWorksheet("Omzet Categorieën");
      
      categoriesSheet.getCell("A1").value = "De Nieuwe Yogaschool - Omzet Overzicht";
      categoriesSheet.getCell("A1").font = { bold: true, size: 16, color: { argb: 'FF8B7355' } };
      categoriesSheet.mergeCells("A1:G1");
      
      categoriesSheet.getCell("A2").value = `Periode: ${session.period}`;
      categoriesSheet.getCell("A3").value = `Gegenereerd: ${new Date().toLocaleString("nl-NL")}`;
      
      categoriesSheet.addRow([]);
      
      const yogaCategories = categories.filter(c => {
        const config = REVENUE_CATEGORIES[c.category];
        return config?.group === 'yoga' || !config;
      });
      const horecaCategories = categories.filter(c => {
        const config = REVENUE_CATEGORIES[c.category];
        return config?.group === 'horeca';
      });

      categoriesSheet.getCell("A5").value = "YOGA & STUDIO SERVICES";
      categoriesSheet.getCell("A5").font = { bold: true, size: 12 };
      
      const catHeaders = ["Categorie", "Aantal", "Bedrag", "% van Totaal", "BTW%", "BTW Bedrag", "Twinfield"];
      categoriesSheet.addRow(catHeaders);
      const headerRow = categoriesSheet.getRow(6);
      headerRow.eachCell((cell) => {
        cell.style = headerStyle;
      });

      categoriesSheet.columns = [
        { key: 'cat', width: 25 },
        { key: 'count', width: 12 },
        { key: 'amount', width: 18 },
        { key: 'pct', width: 14 },
        { key: 'btw', width: 10 },
        { key: 'btwAmt', width: 15 },
        { key: 'twin', width: 12 },
      ];

      let yogaTotal = 0;
      let yogaTaxTotal = 0;
      for (const cat of yogaCategories) {
        const btwAmount = (cat.totalAmount ?? 0) * (cat.btwRate ?? 0.09);
        yogaTotal += cat.totalAmount ?? 0;
        yogaTaxTotal += btwAmount;
        categoriesSheet.addRow([
          cat.category,
          cat.transactionCount,
          formatEuro(cat.totalAmount),
          `${(cat.percentage ?? 0).toFixed(1)}%`,
          `${((cat.btwRate ?? 0.09) * 100).toFixed(0)}%`,
          formatEuro(btwAmount),
          cat.twinfieldAccount || '8999',
        ]);
      }

      const yogaSubtotalRow = categoriesSheet.addRow([
        "Subtotaal Yoga",
        "",
        formatEuro(yogaTotal),
        "",
        "",
        formatEuro(yogaTaxTotal),
        "",
      ]);
      yogaSubtotalRow.font = { bold: true };
      yogaSubtotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F1E8' } };

      categoriesSheet.addRow([]);
      
      const horecaHeaderRow = categoriesSheet.addRow(["HORECA / CAFÉ"]);
      horecaHeaderRow.getCell(1).font = { bold: true, size: 12 };

      categoriesSheet.addRow(catHeaders);
      const horecaHdrRow = categoriesSheet.lastRow;
      horecaHdrRow?.eachCell((cell) => {
        cell.style = headerStyle;
      });

      let horecaTotal = 0;
      let horecaTaxTotal = 0;
      for (const cat of horecaCategories) {
        const btwAmount = (cat.totalAmount ?? 0) * (cat.btwRate ?? 0.09);
        horecaTotal += cat.totalAmount ?? 0;
        horecaTaxTotal += btwAmount;
        categoriesSheet.addRow([
          cat.category,
          cat.transactionCount,
          formatEuro(cat.totalAmount),
          `${(cat.percentage ?? 0).toFixed(1)}%`,
          `${((cat.btwRate ?? 0.09) * 100).toFixed(0)}%`,
          formatEuro(btwAmount),
          cat.twinfieldAccount || '8999',
        ]);
      }

      const horecaSubtotalRow = categoriesSheet.addRow([
        "Subtotaal Horeca",
        "",
        formatEuro(horecaTotal),
        "",
        "",
        formatEuro(horecaTaxTotal),
        "",
      ]);
      horecaSubtotalRow.font = { bold: true };
      horecaSubtotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F1E8' } };

      categoriesSheet.addRow([]);
      
      const grandTotalRow = categoriesSheet.addRow([
        "TOTAAL OMZET",
        "",
        formatEuro(yogaTotal + horecaTotal),
        "100%",
        "",
        formatEuro(yogaTaxTotal + horecaTaxTotal),
        "",
      ]);
      grandTotalRow.font = { bold: true, size: 12 };
      grandTotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B7355' } };
      grandTotalRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      });

      categoriesSheet.addRow([]);
      categoriesSheet.addRow([]);
      const btwSummaryHeader = categoriesSheet.addRow(["BTW SAMENVATTING"]);
      btwSummaryHeader.getCell(1).font = { bold: true, size: 12 };

      const btw9Total = categories
        .filter(c => (c.btwRate ?? 0.09) === 0.09)
        .reduce((sum, c) => sum + (c.totalAmount ?? 0) * 0.09, 0);
      const btw21Total = categories
        .filter(c => (c.btwRate ?? 0) === 0.21)
        .reduce((sum, c) => sum + (c.totalAmount ?? 0) * 0.21, 0);
      const btw0Total = categories
        .filter(c => (c.btwRate ?? 0) === 0)
        .reduce((sum, c) => sum + (c.totalAmount ?? 0) * 0, 0);

      categoriesSheet.addRow(["9% BTW:", formatEuro(btw9Total)]);
      categoriesSheet.addRow(["21% BTW:", formatEuro(btw21Total)]);
      categoriesSheet.addRow(["0% BTW:", formatEuro(btw0Total)]);
      const btwTotalRow = categoriesSheet.addRow(["Totaal BTW:", formatEuro(btw9Total + btw21Total)]);
      btwTotalRow.font = { bold: true };

      const stripeSheet = workbook.addWorksheet("Stripe Controle");
      stripeSheet.columns = [
        { header: "Omschrijving", key: "description", width: 30 },
        { header: "Bedrag", key: "amount", width: 20 },
        { header: "Status", key: "status", width: 15 },
      ];
      stripeSheet.getRow(1).font = { bold: true };

      stripeSheet.addRow({ description: "Momence Totaal (Stripe methoden)", amount: formatEuro(session.momenceTotal) });
      stripeSheet.addRow({ description: "Stripe Gross", amount: formatEuro(session.stripeTotal) });
      
      const diff = (session.momenceTotal ?? 0) - (session.stripeTotal ?? 0);
      const diffStatus = Math.abs(diff) < 10 ? "Match" : "Verschil";
      stripeSheet.addRow({ description: "Verschil", amount: formatEuro(diff), status: diffStatus });
      stripeSheet.addRow({});
      stripeSheet.addRow({ description: "Stripe Fees", amount: formatEuro(session.stripeFees) });
      stripeSheet.addRow({ description: "Stripe Net (ontvangen)", amount: formatEuro(session.stripeNet) });
      stripeSheet.addRow({});
      stripeSheet.addRow({ description: "Klanten Gematcht", amount: String(session.matchedCount ?? 0) });
      stripeSheet.addRow({ description: "Klanten met Verschillen", amount: String(session.unmatchedCount ?? 0) });

      const methodsSheet = workbook.addWorksheet("Betaalmethoden");
      methodsSheet.columns = [
        { header: "Betaalmethode", key: "method", width: 25 },
        { header: "Aantal", key: "count", width: 12 },
        { header: "Totaal", key: "total", width: 18 },
        { header: "Percentage", key: "percentage", width: 12 },
        { header: "Via Stripe", key: "stripe", width: 12 },
      ];
      methodsSheet.getRow(1).font = { bold: true };

      for (const method of paymentMethods) {
        methodsSheet.addRow({
          method: method.paymentMethod,
          count: method.transactionCount,
          total: formatEuro(method.totalAmount),
          percentage: `${(method.percentage ?? 0).toFixed(1)}%`,
          stripe: method.goesThruStripe ? "Ja" : "Nee",
        });
      }

      const differencesSheet = workbook.addWorksheet("Verschillen");
      differencesSheet.columns = [
        { header: "Klant Email", key: "email", width: 40 },
        { header: "Momence", key: "momence", width: 15 },
        { header: "Stripe", key: "stripe", width: 15 },
        { header: "Verschil", key: "difference", width: 15 },
        { header: "Status", key: "status", width: 20 },
      ];
      differencesSheet.getRow(1).font = { bold: true };

      const differences = comparisons.filter((c) => c.matchStatus !== "match");
      for (const comp of differences) {
        differencesSheet.addRow({
          email: comp.customerEmail,
          momence: formatEuro(comp.momenceTotal),
          stripe: formatEuro(comp.stripeAmount),
          difference: formatEuro(comp.difference),
          status: comp.matchStatus === "small_diff" ? "Klein verschil" :
                  comp.matchStatus === "large_diff" ? "Groot verschil" :
                  comp.matchStatus === "only_in_momence" ? "Alleen Momence" :
                  "Alleen Stripe",
        });
      }

      const comparisonSheet = workbook.addWorksheet("Alle Klanten");
      comparisonSheet.columns = [
        { header: "Klant Email", key: "email", width: 40 },
        { header: "Momence", key: "momence", width: 15 },
        { header: "Stripe", key: "stripe", width: 15 },
        { header: "Verschil", key: "difference", width: 15 },
        { header: "Status", key: "status", width: 20 },
      ];
      comparisonSheet.getRow(1).font = { bold: true };

      for (const comp of comparisons) {
        comparisonSheet.addRow({
          email: comp.customerEmail,
          momence: formatEuro(comp.momenceTotal),
          stripe: formatEuro(comp.stripeAmount),
          difference: formatEuro(comp.difference),
          status: comp.matchStatus === "match" ? "Match" :
                  comp.matchStatus === "small_diff" ? "Klein verschil" :
                  comp.matchStatus === "large_diff" ? "Groot verschil" :
                  comp.matchStatus === "only_in_momence" ? "Alleen Momence" :
                  "Alleen Stripe",
        });
      }

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=DNYS-reconciliatie-${session.period}.xlsx`
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error("Download error:", error);
      res.status(500).json({ error: "Kon bestand niet genereren" });
    }
  });

  // Settings endpoints for category configuration (using storage)
  app.get("/api/settings/categories", async (req, res) => {
    try {
      const customCategories = await storage.getCategorySettings();
      if (customCategories) {
        res.json(customCategories);
      } else {
        const defaultCategories = Object.entries(REVENUE_CATEGORIES).map(([name, config]) => ({
          name,
          keywords: config.keywords,
          btwRate: config.btwRate,
          twinfieldAccount: config.twinfieldAccount,
          group: config.group,
        }));
        res.json(defaultCategories);
      }
    } catch (error) {
      console.error("Get categories error:", error);
      res.status(500).json({ error: "Kon categorieën niet ophalen" });
    }
  });

  app.post("/api/settings/categories", async (req, res) => {
    try {
      const settings = req.body;
      if (!Array.isArray(settings)) {
        return res.status(400).json({ error: "Ongeldige categorieën" });
      }
      await storage.saveCategorySettings(settings);
      res.json({ success: true });
    } catch (error) {
      console.error("Save categories error:", error);
      res.status(500).json({ error: "Kon categorieën niet opslaan" });
    }
  });

  app.post("/api/settings/categories/reset", async (req, res) => {
    try {
      await storage.resetCategorySettings();
      res.json({ success: true });
    } catch (error) {
      console.error("Reset categories error:", error);
      res.status(500).json({ error: "Kon categorieën niet resetten" });
    }
  });

  app.get("/api/products", async (req, res) => {
    try {
      const products = await storage.getAllProducts();
      res.json(products);
    } catch (error) {
      console.error("Get products error:", error);
      res.status(500).json({ error: "Kon producten niet ophalen" });
    }
  });

  app.post("/api/products", async (req, res) => {
    try {
      const productData = req.body;
      if (!productData.itemName || !productData.category) {
        return res.status(400).json({ error: "itemName en category zijn verplicht" });
      }
      
      const existingProduct = await storage.getProductByName(productData.itemName);
      if (existingProduct) {
        const updated = await storage.updateProduct(existingProduct.id, {
          ...productData,
          isReviewed: true,
          needsReview: false,
          lastSeenDate: new Date().toISOString().split('T')[0],
        });
        return res.json(updated);
      }
      
      const product = await storage.saveProduct({
        ...productData,
        isReviewed: true,
        needsReview: false,
        firstSeenDate: new Date().toISOString().split('T')[0],
        lastSeenDate: new Date().toISOString().split('T')[0],
        transactionCount: productData.transactionCount || 0,
      });
      res.json(product);
    } catch (error) {
      console.error("Save product error:", error);
      res.status(500).json({ error: "Kon product niet opslaan" });
    }
  });

  app.post("/api/products/batch", async (req, res) => {
    try {
      console.log("=== BATCH SAVE PRODUCTS ===");
      const products = req.body;
      console.log("Received products count:", Array.isArray(products) ? products.length : "not an array");
      
      if (!Array.isArray(products)) {
        return res.status(400).json({ error: "Verwacht array van producten" });
      }
      
      const saved = [];
      for (const productData of products) {
        if (!productData.itemName || !productData.category) continue;
        
        const existingProduct = await storage.getProductByName(productData.itemName);
        if (existingProduct) {
          const updated = await storage.updateProduct(existingProduct.id, {
            category: productData.category,
            btwRate: productData.btwRate,
            twinfieldAccount: productData.twinfieldAccount,
            hasAccrual: productData.hasAccrual || false,
            accrualMonths: productData.accrualMonths,
            accrualStartOffset: productData.accrualStartOffset || 0,
            accrualStartDate: productData.accrualStartDate || null,
            accrualEndDate: productData.accrualEndDate || null,
            hasSpread: productData.hasSpread || false,
            spreadMonths: productData.spreadMonths || 12,
            spreadStartDate: productData.spreadStartDate || null,
            spreadEndDate: productData.spreadEndDate || null,
            isReviewed: true,
            needsReview: false,
            lastSeenDate: new Date().toISOString().split('T')[0],
            transactionCount: (existingProduct.transactionCount || 0) + (productData.transactionCount || 0),
          });
          if (updated) saved.push(updated);
        } else {
          const product = await storage.saveProduct({
            itemName: productData.itemName,
            category: productData.category,
            btwRate: productData.btwRate || 0.09,
            twinfieldAccount: productData.twinfieldAccount || "8999",
            hasAccrual: productData.hasAccrual || false,
            accrualMonths: productData.accrualMonths,
            accrualStartOffset: productData.accrualStartOffset || 0,
            accrualStartDate: productData.accrualStartDate || null,
            accrualEndDate: productData.accrualEndDate || null,
            hasSpread: productData.hasSpread || false,
            spreadMonths: productData.spreadMonths || 12,
            spreadStartDate: productData.spreadStartDate || null,
            spreadEndDate: productData.spreadEndDate || null,
            isReviewed: true,
            needsReview: false,
            firstSeenDate: new Date().toISOString().split('T')[0],
            lastSeenDate: new Date().toISOString().split('T')[0],
            transactionCount: productData.transactionCount || 0,
          });
          saved.push(product);
        }
      }
      
      console.log("Batch save completed, saved count:", saved.length);
      res.json({ success: true, count: saved.length, products: saved });
    } catch (error) {
      console.error("=== BATCH SAVE ERROR ===");
      console.error("Error:", error);
      console.error("=== END ERROR ===");
      res.status(500).json({ error: "Kon producten niet opslaan" });
    }
  });

  app.put("/api/products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Ongeldig product ID" });
      }
      
      const updates = req.body;
      const updated = await storage.updateProduct(id, updates);
      if (!updated) {
        return res.status(404).json({ error: "Product niet gevonden" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Update product error:", error);
      res.status(500).json({ error: "Kon product niet bijwerken" });
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Ongeldig product ID" });
      }
      await storage.deleteProduct(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete product error:", error);
      res.status(500).json({ error: "Kon product niet verwijderen" });
    }
  });

  app.post("/api/reconcile/continue/:tempSessionId", async (req, res) => {
    try {
      console.log("=== CONTINUE RECONCILIATION ===");
      const { tempSessionId } = req.params;
      console.log("TempSessionId:", tempSessionId);
      
      // Fetch from database instead of memory
      const pendingSession = await storage.getPendingReconciliation(tempSessionId);
      
      if (!pendingSession) {
        console.error("Pending session not found in database:", tempSessionId);
        return res.status(404).json({ 
          success: false,
          error: "Tijdelijke sessie niet gevonden of verlopen. Upload de bestanden opnieuw." 
        });
      }
      
      const momenceData: MomenceRow[] = JSON.parse(pendingSession.momenceData);
      const stripeData: StripeRow[] = JSON.parse(pendingSession.stripeData);
      const period = pendingSession.period;
      
      console.log("Pending session found in database, momence rows:", momenceData.length, "stripe rows:", stripeData.length);
      
      // Delete the pending session now that we're processing it
      await storage.deletePendingReconciliation(tempSessionId);
      
      // Fetch custom category settings
      const customCategories = await storage.getCategorySettings();

      // Use the shared processing function
      const result = await processReconciliation(momenceData, stripeData, period, customCategories);
      
      console.log("Continue reconciliation completed, sessionId:", result.sessionId);
      res.json({ success: true, sessionId: result.sessionId });
    } catch (error) {
      console.error("=== CONTINUE RECONCILIATION ERROR ===");
      console.error("Error:", error);
      console.error("=== END ERROR ===");
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : "Kon reconciliatie niet voortzetten" 
      });
    }
  });

  // Clear all products (for testing/reset)
  app.delete("/api/products/all", async (req, res) => {
    try {
      console.log("=== CLEARING ALL PRODUCTS ===");
      await storage.clearAllProducts();
      console.log("All products cleared successfully");
      res.json({ success: true, message: "Alle producten zijn verwijderd" });
    } catch (error) {
      console.error("Clear all products error:", error);
      res.status(500).json({ error: "Kon producten niet verwijderen" });
    }
  });

  // Get all pending reconciliations
  app.get("/api/pending-reconciliations", async (req, res) => {
    try {
      const pending = await storage.getAllPendingReconciliations();
      res.json(pending.map(p => ({
        id: p.id,
        period: p.period,
        newProductCount: p.newProductCount,
        createdAt: p.createdAt,
        status: p.status,
      })));
    } catch (error) {
      console.error("Get pending reconciliations error:", error);
      res.status(500).json({ error: "Kon openstaande reconciliaties niet laden" });
    }
  });

  // Delete a pending reconciliation
  app.delete("/api/pending-reconciliations/:id", async (req, res) => {
    try {
      await storage.deletePendingReconciliation(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete pending reconciliation error:", error);
      res.status(500).json({ error: "Kon reconciliatie niet verwijderen" });
    }
  });

  // Clear all pending reconciliations
  app.delete("/api/pending-reconciliations/all", async (req, res) => {
    try {
      await storage.clearAllPendingReconciliations();
      res.json({ success: true, message: "Alle openstaande reconciliaties zijn verwijderd" });
    } catch (error) {
      console.error("Clear pending reconciliations error:", error);
      res.status(500).json({ error: "Kon reconciliaties niet verwijderen" });
    }
  });

  // Save products only (without continuing reconciliation)
  app.post("/api/products/save-only", async (req, res) => {
    try {
      console.log("=== SAVE PRODUCTS ONLY ===");
      const products = req.body.products;
      const tempSessionId = req.body.tempSessionId;
      
      if (!Array.isArray(products)) {
        return res.status(400).json({ error: "Verwacht array van producten" });
      }
      
      const saved = [];
      for (const productData of products) {
        if (!productData.itemName || !productData.category) continue;
        
        const existingProduct = await storage.getProductByName(productData.itemName);
        if (existingProduct) {
          const updated = await storage.updateProduct(existingProduct.id, {
            category: productData.category,
            btwRate: productData.btwRate,
            twinfieldAccount: productData.twinfieldAccount,
            hasAccrual: productData.hasAccrual || false,
            accrualMonths: productData.accrualMonths,
            accrualStartOffset: productData.accrualStartOffset || 0,
            accrualStartDate: productData.accrualStartDate || null,
            accrualEndDate: productData.accrualEndDate || null,
            hasSpread: productData.hasSpread || false,
            spreadMonths: productData.spreadMonths || 12,
            spreadStartDate: productData.spreadStartDate || null,
            spreadEndDate: productData.spreadEndDate || null,
            isReviewed: true,
            needsReview: false,
            lastSeenDate: new Date().toISOString().split('T')[0],
            transactionCount: (existingProduct.transactionCount || 0) + (productData.transactionCount || 0),
          });
          if (updated) saved.push(updated);
        } else {
          const product = await storage.saveProduct({
            itemName: productData.itemName,
            category: productData.category,
            btwRate: productData.btwRate || 0.09,
            twinfieldAccount: productData.twinfieldAccount || "8999",
            hasAccrual: productData.hasAccrual || false,
            accrualMonths: productData.accrualMonths,
            accrualStartOffset: productData.accrualStartOffset || 0,
            accrualStartDate: productData.accrualStartDate || null,
            accrualEndDate: productData.accrualEndDate || null,
            hasSpread: productData.hasSpread || false,
            spreadMonths: productData.spreadMonths || 12,
            spreadStartDate: productData.spreadStartDate || null,
            spreadEndDate: productData.spreadEndDate || null,
            isReviewed: true,
            needsReview: false,
            firstSeenDate: new Date().toISOString().split('T')[0],
            lastSeenDate: new Date().toISOString().split('T')[0],
            transactionCount: productData.transactionCount || 0,
          });
          saved.push(product);
        }
      }
      
      console.log("Products saved:", saved.length, "tempSessionId kept:", tempSessionId);
      res.json({ 
        success: true, 
        count: saved.length, 
        message: `${saved.length} producten opgeslagen. Je kunt de reconciliatie later voortzetten.`,
        tempSessionId 
      });
    } catch (error) {
      console.error("Save products only error:", error);
      res.status(500).json({ error: "Kon producten niet opslaan" });
    }
  });

  return httpServer;
}
