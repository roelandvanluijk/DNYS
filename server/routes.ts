import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { storage } from "./storage";
import { STRIPE_PAYMENT_METHODS, REVENUE_CATEGORIES, type MatchStatus, type CategoryConfig } from "@shared/schema";

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
}

function categorizeItem(itemName: string | undefined): CategoryResult {
  if (!itemName) {
    return { category: "Overig", btwRate: 0.09, twinfieldAccount: "8999" };
  }
  
  const itemLower = itemName.toLowerCase();
  
  const categoryOrder = [
    'Opleidingen',
    'Online/Livestream',
    'Gift Cards & Credits',
    'Workshops & Events',
    'Abonnementen',
    'Rittenkaarten',
    'Omzet Keuken',
    'Omzet Drank Laag',
    'Omzet Drank Hoog',
    'Single Classes',
  ];
  
  for (const categoryName of categoryOrder) {
    const config = REVENUE_CATEGORIES[categoryName];
    if (!config) continue;
    
    for (const keyword of config.keywords) {
      if (itemLower.includes(keyword.toLowerCase())) {
        if (categoryName === 'Rittenkaarten' && itemLower.includes('single')) {
          continue;
        }
        return {
          category: categoryName,
          btwRate: config.btwRate,
          twinfieldAccount: config.twinfieldAccount,
        };
      }
    }
  }
  
  return { category: "Overig", btwRate: 0.09, twinfieldAccount: "8999" };
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
        return res.status(400).json({ success: false, error: "Beide bestanden zijn vereist" });
      }

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
      let momenceTotalAll = 0;
      let nonStripeTotal = 0;

      for (const row of momenceResult.data) {
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
          
          const { category, btwRate, twinfieldAccount } = categorizeItem(item);
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
        } else {
          nonStripeTotal += saleValue;
        }
      }

      const stripeByEmail = new Map<string, { amount: number; fee: number }>();
      let stripeTotalAmount = 0;
      let stripeTotalFees = 0;

      for (const row of stripeResult.data) {
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
        const momenceTotal = momenceByEmail.get(email) || 0;
        const stripeData = stripeByEmail.get(email) || { amount: 0, fee: 0 };
        const stripeNet = stripeData.amount - stripeData.fee;
        const difference = momenceTotal - stripeData.amount;

        let matchStatus: MatchStatus;
        if (momenceTotal > 0 && stripeData.amount === 0) {
          matchStatus = "only_in_momence";
        } else if (momenceTotal === 0 && stripeData.amount > 0) {
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
          stripeAmount: stripeData.amount,
          stripeFee: stripeData.fee,
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

      res.json({ success: true, sessionId: session.id });
    } catch (error) {
      console.error("Reconciliation error:", error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Er is een fout opgetreden" 
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

  return httpServer;
}
