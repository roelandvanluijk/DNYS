import type { CategorySummary, AccrualEntry, PaymentMethodSummary, ReconciliationSession, TwinfieldGeneralSettings } from "@shared/schema";

// These categories defer revenue at point of sale — full amount parks in the cross account (1809)
// and is released month-by-month via the accrual_schedule
const DEFERRED_CATEGORIES = new Set(["Opleidingen", "Teacher Training", "Jaarabonnementen"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function btwCode(rate: number): string {
  if (rate >= 0.205) return "VH"; // 21%
  if (rate >= 0.085) return "VL"; // 9%
  return "VVR";                   // 0% vrijgesteld
}

function lastDayOfMonth(period: string): string {
  // period: "YYYY-MM" → "YYYYMMDD" (last day)
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}${String(month).padStart(2, "0")}${String(lastDay).padStart(2, "0")}`;
}

function twinfieldPeriod(period: string): string {
  // "2026-03" → "2026/03"
  return period.replace("-", "/");
}

function monthLabel(period: string): string {
  const names = ["januari", "februari", "maart", "april", "mei", "juni",
                 "juli", "augustus", "september", "oktober", "november", "december"];
  const [year, month] = period.split("-");
  return `${names[parseInt(month) - 1]} ${year}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function debitLine(id: number, account: string, amount: number, desc: string): string {
  return `    <line type="detail" id="${id}">
      <dim1>${escapeXml(account)}</dim1>
      <value>${amount.toFixed(2)}</value>
      <debitcredit>debit</debitcredit>
      <description>${escapeXml(desc)}</description>
    </line>`;
}

function creditLine(id: number, account: string, netto: number, btw: number, vatcode: string, desc: string): string {
  const vatLines = vatcode !== "VVR" && btw > 0
    ? `\n      <vatcode>${vatcode}</vatcode>\n      <vatvalue>${btw.toFixed(2)}</vatvalue>`
    : "";
  return `    <line type="detail" id="${id}">
      <dim1>${escapeXml(account)}</dim1>
      <value>${netto.toFixed(2)}</value>
      <debitcredit>credit</debitcredit>
      <description>${escapeXml(desc)}</description>${vatLines}
    </line>`;
}

interface TransactionHeader {
  office: string;
  code: string;
  period: string;
  date: string;
  description: string;
  freetext1: string;
  freetext2: string;
}

function buildTransaction(header: TransactionHeader, lines: string[]): string {
  return `  <transaction>
    <header>
      <office>${escapeXml(header.office)}</office>
      <code>${escapeXml(header.code)}</code>
      <period>${header.period}</period>
      <date>${header.date}</date>
      <description>${escapeXml(header.description)}</description>
      <freetext1>${escapeXml(header.freetext1)}</freetext1>
      <freetext2>${escapeXml(header.freetext2)}</freetext2>
    </header>
${lines.join("\n")}
  </transaction>`;
}

export interface TwinfieldExportInput {
  session: ReconciliationSession;
  categories: Omit<CategorySummary, "items">[];
  paymentMethods: PaymentMethodSummary[];
  // Accrual entries from ALL sessions where bookingMonth = session.period (releases for this period)
  accrualReleases: AccrualEntry[];
  generalSettings: TwinfieldGeneralSettings;
  paymentMethodSettings: { methodName: string; twinfieldAccount: string; isStripeMethod: boolean }[];
}

export function generateTwinfieldXml(input: TwinfieldExportInput): string {
  const { session, categories, paymentMethods, accrualReleases, generalSettings, paymentMethodSettings } = input;
  const { office, journalCode, accrualCrossAccount, stripeFeeAccount } = generalSettings;

  const period = twinfieldPeriod(session.period);
  const date = lastDayOfMonth(session.period);
  const label = monthLabel(session.period);
  const sessionRef = session.id;

  // Build lookup by payment method name (case-insensitive)
  const pmLookup = new Map(
    paymentMethodSettings.map(pm => [pm.methodName.toLowerCase(), pm])
  );

  const transactions: string[] = [];

  // ── Transaction 1: Revenue booking ──────────────────────────────────────────
  // Momence Sale value is gross (BTW-inclusive, Dutch B2C prices).
  // Debit:  payment method accounts (gross = what customers paid)
  // Credit: regular categories → revenue accounts (netto + BTW via vatcode/vatvalue)
  //         deferred categories → cross account 1809 (netto + BTW)
  //
  // Twinfield balance: debit gross = Σ(credit netto + credit vatvalue) ✓

  const revLines: string[] = [];
  let lineId = 1;

  // Debit lines: payment methods
  for (const pm of paymentMethods) {
    const gross = round2(pm.totalAmount ?? 0);
    if (gross === 0) continue;
    const pmCfg = pmLookup.get(pm.paymentMethod.toLowerCase());
    if (!pmCfg?.twinfieldAccount) continue;
    revLines.push(debitLine(lineId++, pmCfg.twinfieldAccount, gross, `${pm.paymentMethod} ${label}`));
  }

  // Credit lines: categories
  for (const cat of categories) {
    const gross = round2(cat.totalAmount ?? 0);
    if (gross === 0) continue;
    const rate = cat.btwRate ?? 0.09;
    // Extract netto and BTW from gross (Dutch B2C prices are BTW-inclusive)
    const netto = round2(gross / (1 + rate));
    const btw = round2(gross - netto);
    const code = btwCode(rate);
    const isDeferred = DEFERRED_CATEGORIES.has(cat.category);
    const account = isDeferred ? accrualCrossAccount : (cat.twinfieldAccount || "8999");
    const desc = isDeferred
      ? `${cat.category} uitgesteld ${label}`
      : `${cat.category} ${label}`;
    revLines.push(creditLine(lineId++, account, netto, btw, code, desc));
  }

  if (revLines.length >= 2) {
    transactions.push(buildTransaction({
      office, code: journalCode, period, date,
      description: `Momence omzet ${label}`,
      freetext1: `Reconciliatie ${session.period}`,
      freetext2: sessionRef,
    }, revLines));
  }

  // ── Transaction 2: Accrual releases ─────────────────────────────────────────
  // Debit 1809 (releases from cross account) → Credit revenue accounts (netto only, no BTW)
  // BTW was already booked in full at time of sale in transaction 1.

  if (accrualReleases.length > 0) {
    // Group releases by twinfield account
    const byAccount = new Map<string, { account: string; category: string; total: number }>();
    for (const entry of accrualReleases) {
      const account = entry.twinfieldAccount || "8999";
      const amount = round2(entry.bookingAmount ?? 0);
      const existing = byAccount.get(account);
      if (existing) {
        existing.total = round2(existing.total + amount);
      } else {
        byAccount.set(account, { account, category: entry.category, total: amount });
      }
    }

    const totalRelease = round2(Array.from(byAccount.values()).reduce((s, r) => s + r.total, 0));
    const relLines: string[] = [];
    let rId = 1;

    relLines.push(debitLine(rId++, accrualCrossAccount, totalRelease, `Vrijval uitgestelde omzet ${label}`));
    for (const rel of Array.from(byAccount.values())) {
      relLines.push(creditLine(rId++, rel.account, round2(rel.total), 0, "VVR", `${rel.category} vrijval ${label}`));
    }

    transactions.push(buildTransaction({
      office, code: journalCode, period, date,
      description: `Accrual vrijval ${label}`,
      freetext1: `Reconciliatie ${session.period}`,
      freetext2: sessionRef,
    }, relLines));
  }

  // ── Transaction 3: Stripe fees ───────────────────────────────────────────────
  // Debit fee expense account → Credit Stripe receivables account
  const stripeFees = round2(session.stripeFees ?? 0);
  if (stripeFees > 0 && stripeFeeAccount) {
    const stripeAccount = Array.from(pmLookup.values())
      .find(pm => pm.isStripeMethod && pm.twinfieldAccount)?.twinfieldAccount ?? "";
    if (stripeAccount) {
      transactions.push(buildTransaction({
        office, code: journalCode, period, date,
        description: `Stripe kosten ${label}`,
        freetext1: `Reconciliatie ${session.period}`,
        freetext2: sessionRef,
      }, [
        debitLine(1, stripeFeeAccount, stripeFees, `Stripe transactiekosten ${label}`),
        creditLine(2, stripeAccount, stripeFees, 0, "VVR", `Stripe transactiekosten ${label}`),
      ]));
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<transactions>\n${transactions.join("\n")}\n</transactions>`;
}
