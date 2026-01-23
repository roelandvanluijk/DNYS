import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { storage } from "./storage";
import { STRIPE_PAYMENT_METHODS, type MatchStatus } from "@shared/schema";

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
  "Created date (UTC)"?: string;
  Amount?: string;
  "Amount Refunded"?: string;
  Currency?: string;
  Fee?: string;
  Status?: string;
  "Customer Email"?: string;
  "Payment Source Type"?: string;
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  
  // Remove currency symbols and whitespace
  let cleaned = value.replace(/[€$\s]/g, "").trim();
  
  // Detect format by checking the last separator
  // European format: 1.234,56 or 1234,56 (comma as decimal)
  // US format: 1,234.56 or 1234.56 (period as decimal)
  
  const lastComma = cleaned.lastIndexOf(",");
  const lastPeriod = cleaned.lastIndexOf(".");
  
  if (lastComma > lastPeriod) {
    // European format: comma is the decimal separator
    // Remove periods (thousands separator) and convert comma to period
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastPeriod > lastComma) {
    // US format: period is the decimal separator
    // Remove commas (thousands separator)
    cleaned = cleaned.replace(/,/g, "");
  } else {
    // No decimal separator or only one type present
    // Remove any remaining commas
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
      const paymentMethodTotals = new Map<string, { count: number; total: number }>();
      let momenceTotalAll = 0;
      let nonStripeTotal = 0;

      for (const row of momenceResult.data) {
        const paymentMethod = row["Payment method"] || "";
        const saleValue = parseNumber(row["Sale value"]);
        const customerEmail = normalizeEmail(row["Customer email"]);

        const methodData = paymentMethodTotals.get(paymentMethod) || { count: 0, total: 0 };
        methodData.count++;
        methodData.total += saleValue;
        paymentMethodTotals.set(paymentMethod, methodData);
        momenceTotalAll += saleValue;

        const isStripeMethod = STRIPE_PAYMENT_METHODS.some(
          (m) => paymentMethod.toLowerCase().includes(m.toLowerCase())
        );

        if (isStripeMethod && customerEmail) {
          const current = momenceByEmail.get(customerEmail) || 0;
          momenceByEmail.set(customerEmail, current + saleValue);
        } else if (!isStripeMethod) {
          nonStripeTotal += saleValue;
        }
      }

      const stripeByEmail = new Map<string, { amount: number; fee: number }>();
      let stripeTotalAmount = 0;
      let stripeTotalFees = 0;

      for (const row of stripeResult.data) {
        if (row.Status?.toLowerCase() !== "paid") continue;

        const email = normalizeEmail(row["Customer Email"]);
        if (!email) continue;

        const amount = parseNumber(row.Amount);
        const feeInCents = parseNumber(row.Fee);
        const fee = feeInCents / 100;

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

        comparisons.push({
          sessionId: "",
          customerEmail: email,
          momenceTotal,
          stripeAmount: stripeData.amount,
          stripeFee: stripeData.fee,
          stripeNet,
          difference,
          matchStatus,
        });
      }

      comparisons.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

      const momenceStripeTotal = Array.from(momenceByEmail.values()).reduce((a, b) => a + b, 0);

      const session = await storage.createSession({
        period,
        momenceTotal: momenceStripeTotal,
        stripeTotal: stripeTotalAmount,
        stripeFees: stripeTotalFees,
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
      }));

      await storage.addPaymentMethods(session.id, paymentMethods);

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

      const { session, comparisons, paymentMethods } = result;

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "DNYS Reconciliatie Tool";
      workbook.created = new Date();

      const summarySheet = workbook.addWorksheet("Samenvatting");
      summarySheet.columns = [
        { header: "Omschrijving", key: "description", width: 30 },
        { header: "Bedrag", key: "amount", width: 20 },
      ];

      summarySheet.addRow({});
      summarySheet.getCell("A1").value = `Reconciliatie Rapport - ${session.period}`;
      summarySheet.getCell("A1").font = { bold: true, size: 16 };
      summarySheet.mergeCells("A1:B1");

      summarySheet.addRow({});
      summarySheet.getCell("A3").value = `Datum gegenereerd: ${new Date().toLocaleString("nl-NL")}`;

      summarySheet.addRow({});
      summarySheet.addRow({ description: "Omschrijving", amount: "Bedrag" });
      summarySheet.getRow(5).font = { bold: true };

      const formatEuro = (value: number | null | undefined) => {
        const num = value ?? 0;
        return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(num);
      };

      summarySheet.addRow({ description: "Momence Totaal (Stripe methoden)", amount: formatEuro(session.momenceTotal) });
      summarySheet.addRow({ description: "Stripe Totaal", amount: formatEuro(session.stripeTotal) });
      summarySheet.addRow({ description: "Stripe Kosten", amount: formatEuro(session.stripeFees) });
      summarySheet.addRow({ description: "Stripe Netto", amount: formatEuro((session.stripeTotal ?? 0) - (session.stripeFees ?? 0)) });
      summarySheet.addRow({ description: "Non-Stripe Betalingen", amount: formatEuro(session.nonStripeTotal) });
      summarySheet.addRow({});
      summarySheet.addRow({ description: "Klanten Gematcht", amount: session.matchedCount?.toString() ?? "0" });
      summarySheet.addRow({ description: "Klanten met Verschillen", amount: session.unmatchedCount?.toString() ?? "0" });

      const comparisonSheet = workbook.addWorksheet("Klant Vergelijking");
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
          status: comp.matchStatus === "match" ? "✓ Match" :
                  comp.matchStatus === "small_diff" ? "⚠ Klein verschil" :
                  comp.matchStatus === "large_diff" ? "❌ Groot verschil" :
                  comp.matchStatus === "only_in_momence" ? "⚠ Alleen Momence" :
                  "⚠ Alleen Stripe",
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
          status: comp.matchStatus === "small_diff" ? "⚠ Klein verschil" :
                  comp.matchStatus === "large_diff" ? "❌ Groot verschil" :
                  comp.matchStatus === "only_in_momence" ? "⚠ Alleen Momence" :
                  "⚠ Alleen Stripe",
        });
      }

      const methodsSheet = workbook.addWorksheet("Betaalmethoden");
      methodsSheet.columns = [
        { header: "Betaalmethode", key: "method", width: 25 },
        { header: "Aantal", key: "count", width: 12 },
        { header: "Totaal", key: "total", width: 18 },
        { header: "Percentage", key: "percentage", width: 12 },
      ];
      methodsSheet.getRow(1).font = { bold: true };

      for (const method of paymentMethods) {
        methodsSheet.addRow({
          method: method.paymentMethod,
          count: method.transactionCount,
          total: formatEuro(method.totalAmount),
          percentage: `${(method.percentage ?? 0).toFixed(1)}%`,
        });
      }

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=reconciliatie-${session.period}.xlsx`
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
