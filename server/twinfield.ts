import type { CategorySummary, AccrualEntry, PaymentMethodSummary, ReconciliationSession, TwinfieldGeneralSettings } from "@shared/schema";

// These categories defer revenue — the unearned portion (future months) parks in the cross
// account (1809) via a deferral memo and is released month-by-month via the accrual_schedule.
// BTW is always booked in full at point of sale, never deferred.
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

// Momence sometimes exports duplicated payment method names like "iDEAL, iDEAL" or "Card, Card".
// Normalize these to the base name before lookup.
function normalizePmName(name: string): string {
  const parts = name.split(", ");
  if (parts.length > 1 && parts.every(p => p.toLowerCase() === parts[0].toLowerCase())) {
    return parts[0];
  }
  return name;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Cost center (dim2) rules for this administration:
// - All P&L accounts in the 4xxx range require a cost center
// - Teacher Training uses KPL0001 (separate cost center)
// - Everything else in 4xxx uses KPL0000
// - Accounts outside 4xxx (balance sheet, etc.) leave dim2 empty
function costCenter(account: string, categoryName?: string): string {
  if (!account.startsWith("4")) return "";
  return categoryName === "Teacher Training" ? "KPL0001" : "KPL0000";
}

function debitLine(id: number, account: string, amount: number, desc: string, dim2 = ""): string {
  const dim2Tag = dim2 ? `<dim2>${escapeXml(dim2)}</dim2>` : `<dim2/>`;
  return `    <line id="${id}">
      <dim1>${escapeXml(account)}</dim1>
      ${dim2Tag}
      <dim3/>
      <debitcredit>debit</debitcredit>
      <value>${amount.toFixed(2)}</value>
      <basevalue>${amount.toFixed(2)}</basevalue>
      <rate>1</rate>
      <description>${escapeXml(desc)}</description>
    </line>`;
}

function creditLine(id: number, account: string, netto: number, btw: number, vatcode: string, desc: string, dim2 = ""): string {
  const dim2Tag = dim2 ? `<dim2>${escapeXml(dim2)}</dim2>` : `<dim2/>`;
  const vatLines = vatcode !== "VVR" && btw > 0
    ? `\n      <vatcode>${vatcode}</vatcode>\n      <vatvalue>${btw.toFixed(2)}</vatvalue>`
    : "";
  return `    <line id="${id}">
      <dim1>${escapeXml(account)}</dim1>
      ${dim2Tag}
      <dim3/>
      <debitcredit>credit</debitcredit>
      <value>${netto.toFixed(2)}</value>
      <basevalue>${netto.toFixed(2)}</basevalue>
      <rate>1</rate>
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
  return `  <transaction destiny="temporary">
    <header>
      <office>${escapeXml(header.office)}</office>
      <code>${escapeXml(header.code)}</code>
      <number>0</number>
      <period>${header.period}</period>
      <currency>EUR</currency>
      <date>${header.date}</date>
      <description>${escapeXml(header.description)}</description>
      <freetext1>${escapeXml(header.freetext1)}</freetext1>
      <freetext2>${escapeXml(header.freetext2)}</freetext2>
    </header>
    <lines>
${lines.join("\n")}
    </lines>
  </transaction>`;
}

export interface TwinfieldExportInput {
  session: ReconciliationSession;
  categories: Omit<CategorySummary, "items">[];
  paymentMethods: PaymentMethodSummary[];
  // Accrual entries from ALL sessions where bookingMonth = session.period (releases for this period).
  // The current session's own entries are filtered out when building the vrijval transaction —
  // those amounts are already on the revenue account (never deposited into 1809).
  accrualReleases: AccrualEntry[];
  // All accrual entries from the current session (every future booking month).
  // Used to generate pre-posted forward-dated release memos so 1809 self-balances.
  currentSessionAccruals: AccrualEntry[];
  generalSettings: TwinfieldGeneralSettings;
  paymentMethodSettings: { methodName: string; twinfieldAccount: string; isStripeMethod: boolean }[];
}

export function generateTwinfieldXml(input: TwinfieldExportInput): string {
  const { session, categories, paymentMethods, accrualReleases, currentSessionAccruals, generalSettings, paymentMethodSettings } = input;
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
  // Credit: ALL categories → their actual revenue accounts (netto + BTW via vatcode/vatvalue)
  //
  // BTW is always booked in the period of sale/payment receipt, regardless of
  // whether the revenue is deferred. No BTW codes appear on balance sheet accounts.
  //
  // Twinfield balance: debit gross = Σ(credit netto + credit vatvalue) ✓

  const revLines: string[] = [];
  let lineId = 1;

  // Debit lines: payment methods
  for (const pm of paymentMethods) {
    const gross = round2(pm.totalAmount ?? 0);
    if (gross === 0) continue;
    const pmName = normalizePmName(pm.paymentMethod);
    const pmCfg = pmLookup.get(pmName.toLowerCase());
    if (!pmCfg?.twinfieldAccount) continue;
    revLines.push(debitLine(lineId++, pmCfg.twinfieldAccount, gross, `${pmName} ${label}`));
  }

  // Credit lines: all categories go to their actual revenue accounts with BTW
  for (const cat of categories) {
    const gross = round2(cat.totalAmount ?? 0);
    if (gross === 0) continue;
    const rate = cat.btwRate ?? 0.09;
    // Extract netto and BTW from gross (Dutch B2C prices are BTW-inclusive)
    const netto = round2(gross / (1 + rate));
    const btw = round2(gross - netto);
    const code = btwCode(rate);
    const account = cat.twinfieldAccount || "8999";
    const dim2 = costCenter(account, cat.category);
    revLines.push(creditLine(lineId++, account, netto, btw, code, `${cat.category} ${label}`, dim2));
  }

  if (revLines.length >= 2) {
    transactions.push(buildTransaction({
      office, code: journalCode, period, date,
      description: `Momence omzet ${label}`,
      freetext1: `Reconciliatie ${session.period}`,
      freetext2: sessionRef,
    }, revLines));
  }

  // ── Transaction 2: Deferral memo ────────────────────────────────────────────
  // Parks the unearned netto of deferred categories into the cross account (1809).
  // The earned-this-period portion stays on the revenue account from Transaction 1.
  // BTW was already booked in full in Transaction 1 — only netto moves here.
  //
  // Debit:  revenue accounts (unearned netto per deferred category)
  // Credit: 1809 (total unearned netto — no BTW on balance sheet accounts)

  const defLines: string[] = [];
  let dId = 1;
  let totalUnearned = 0;

  for (const cat of categories) {
    if (!DEFERRED_CATEGORIES.has(cat.category)) continue;
    const gross = round2(cat.totalAmount ?? 0);
    if (gross === 0) continue;
    const rate = cat.btwRate ?? 0.09;
    const totalNetto = round2(gross / (1 + rate));

    // Earned this period = this session's accrual entry for the current booking month
    const earnedThisPeriod = round2(
      accrualReleases
        .filter(e => e.sessionId === session.id && e.category.toLowerCase() === cat.category.toLowerCase())
        .reduce((sum, e) => sum + (e.bookingAmount ?? 0), 0)
    );

    const unearned = round2(totalNetto - earnedThisPeriod);
    if (unearned <= 0) continue;

    const account = cat.twinfieldAccount || "8999";
    const dim2 = costCenter(account, cat.category);
    defLines.push(debitLine(dId++, account, unearned, `${cat.category} uitgesteld ${label}`, dim2));
    totalUnearned = round2(totalUnearned + unearned);
  }

  if (defLines.length > 0) {
    // Single credit to 1809 — no BTW on balance sheet accounts
    defLines.push(creditLine(dId++, accrualCrossAccount, totalUnearned, 0, "VVR", `Uitgestelde omzet ${label}`));
    transactions.push(buildTransaction({
      office, code: journalCode, period, date,
      description: `Uitgestelde omzet ${label}`,
      freetext1: `Reconciliatie ${session.period}`,
      freetext2: sessionRef,
    }, defLines));
  }

  // Shared account lookup — overrides stale stored accounts with current category settings.
  const catRevenueAccountLookup = new Map(
    categories.map(cat => [cat.category.toLowerCase(), cat.twinfieldAccount || ""])
  );
  function resolveAccount(category: string, storedAccount: string): string {
    return catRevenueAccountLookup.get(category.toLowerCase()) || storedAccount || "4098";
  }

  // ── Transactions 3…N: Future period release memos ────────────────────────────
  // One transaction per future bookingMonth from the current session's accrual schedule,
  // each tagged with its own <period> and last-day <date>.
  // Mirrors Twinfield's OMZETVERDELING pattern: all releases are pre-posted upfront
  // so 1809 self-balances across every period without manual intervention.
  //
  // Debit 1809 → Credit revenue accounts (netto only, no BTW)

  const futureEntries = currentSessionAccruals.filter(e => e.bookingMonth !== session.period);

  const byMonth = new Map<string, Map<string, { category: string; account: string; total: number }>>();
  for (const entry of futureEntries) {
    const amount = round2(entry.bookingAmount ?? 0);
    if (amount === 0) continue;
    const account = resolveAccount(entry.category, entry.twinfieldAccount ?? "");
    if (!byMonth.has(entry.bookingMonth)) byMonth.set(entry.bookingMonth, new Map());
    const monthMap = byMonth.get(entry.bookingMonth)!;
    const key = `${entry.category}::${account}`;
    const existing = monthMap.get(key);
    if (existing) {
      existing.total = round2(existing.total + amount);
    } else {
      monthMap.set(key, { category: entry.category, account, total: amount });
    }
  }

  for (const bookingMonth of Array.from(byMonth.keys()).sort()) {
    const entries = Array.from(byMonth.get(bookingMonth)!.values());
    const totalRelease = round2(entries.reduce((s, r) => s + r.total, 0));
    if (totalRelease === 0) continue;

    const futureLabel = monthLabel(bookingMonth);
    const futureLines: string[] = [];
    let fId = 1;

    futureLines.push(debitLine(fId++, accrualCrossAccount, totalRelease, `Vrijval uitgestelde omzet ${futureLabel}`));
    for (const rel of entries) {
      const dim2 = costCenter(rel.account, rel.category);
      futureLines.push(creditLine(fId++, rel.account, rel.total, 0, "VVR", `${rel.category} vrijval ${futureLabel}`, dim2));
    }

    transactions.push(buildTransaction({
      office, code: journalCode,
      period: twinfieldPeriod(bookingMonth),
      date: lastDayOfMonth(bookingMonth),
      description: `Vrijval uitgestelde omzet ${futureLabel}`,
      freetext1: `Reconciliatie ${session.period}`,
      freetext2: sessionRef,
    }, futureLines));
  }

  // ── Transaction N+1: Accrual releases from prior sessions ────────────────────
  // Releases entries from PREVIOUS sessions that fall due in this period.
  // (The current session's own earned-this-period amounts are already on the revenue
  // account from Transaction 1 — they were never deposited into 1809.)
  //
  // Debit 1809 → Credit revenue accounts (netto only, no BTW)

  const releasesFromOtherSessions = accrualReleases.filter(e => e.sessionId !== session.id);

  if (releasesFromOtherSessions.length > 0) {
    const byAccount = new Map<string, { category: string; account: string; total: number }>();
    for (const entry of releasesFromOtherSessions) {
      const amount = round2(entry.bookingAmount ?? 0);
      const account = resolveAccount(entry.category, entry.twinfieldAccount ?? "");
      const key = `${entry.category}::${account}`;
      const existing = byAccount.get(key);
      if (existing) {
        existing.total = round2(existing.total + amount);
      } else {
        byAccount.set(key, { category: entry.category, account, total: amount });
      }
    }

    const totalRelease = round2(Array.from(byAccount.values()).reduce((s, r) => s + r.total, 0));
    const relLines: string[] = [];
    let rId = 1;

    relLines.push(debitLine(rId++, accrualCrossAccount, totalRelease, `Vrijval uitgestelde omzet ${label}`));
    for (const rel of Array.from(byAccount.values())) {
      const dim2 = costCenter(rel.account, rel.category);
      relLines.push(creditLine(rId++, rel.account, round2(rel.total), 0, "VVR", `${rel.category} vrijval ${label}`, dim2));
    }

    transactions.push(buildTransaction({
      office, code: journalCode, period, date,
      description: `Accrual vrijval ${label}`,
      freetext1: `Reconciliatie ${session.period}`,
      freetext2: sessionRef,
    }, relLines));
  }

  // ── Transaction 4: Stripe fees ───────────────────────────────────────────────
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
        debitLine(1, stripeFeeAccount, stripeFees, `Stripe transactiekosten ${label}`, "KPL0000"),
        creditLine(2, stripeAccount, stripeFees, 0, "VVR", `Stripe transactiekosten ${label}`),
      ]));
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<transactions>\n${transactions.join("\n")}\n</transactions>`;
}
