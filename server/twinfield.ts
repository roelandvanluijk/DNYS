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

// Twinfield enforces a 40-character limit on all description fields.
function trunc(s: string, max = 40): string {
  return s.length <= max ? s : s.slice(0, max);
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
      <description>${escapeXml(trunc(desc))}</description>
    </line>`;
}

function vatSuffix(vatcode: string, btw: number): string {
  return vatcode !== "VVR" && btw > 0
    ? `\n      <vatcode>${vatcode}</vatcode>\n      <vatvalue>${btw.toFixed(2)}</vatvalue>`
    : "";
}

function creditLine(id: number, account: string, netto: number, btw: number, vatcode: string, desc: string, dim2 = ""): string {
  const dim2Tag = dim2 ? `<dim2>${escapeXml(dim2)}</dim2>` : `<dim2/>`;
  const vatLines = vatSuffix(vatcode, btw);
  return `    <line id="${id}">
      <dim1>${escapeXml(account)}</dim1>
      ${dim2Tag}
      <dim3/>
      <debitcredit>credit</debitcredit>
      <value>${netto.toFixed(2)}</value>
      <basevalue>${netto.toFixed(2)}</basevalue>
      <rate>1</rate>
      <description>${escapeXml(trunc(desc))}</description>${vatLines}
    </line>`;
}

export function debitLineWithVat(id: number, account: string, netto: number, btw: number, vatcode: string, desc: string, dim2 = ""): string {
  const dim2Tag = dim2 ? `<dim2>${escapeXml(dim2)}</dim2>` : `<dim2/>`;
  const vatLines = vatSuffix(vatcode, btw);
  return `    <line id="${id}">
      <dim1>${escapeXml(account)}</dim1>
      ${dim2Tag}
      <dim3/>
      <debitcredit>debit</debitcredit>
      <value>${netto.toFixed(2)}</value>
      <basevalue>${netto.toFixed(2)}</basevalue>
      <rate>1</rate>
      <description>${escapeXml(trunc(desc))}</description>${vatLines}
    </line>`;
}

export interface CorrectionMemoInput {
  period: string; // "YYYY-MM"
  grossTotal: number; // total gross (BTW-inclusive) sale value being reclassified for this month
  singleClassesAccount: string; // current Single Classes twinfield account (from category_settings)
  onlineAccount: string; // current Online/Livestream twinfield account (from category_settings)
  singleClassesRate: number; // current Single Classes BTW rate (from category_settings), e.g. 0.09
  onlineRate: number; // current Online/Livestream BTW rate (from category_settings), e.g. 0.21
}

// Generates a one-time correction memo per affected month: reverses gross revenue that was
// originally booked to Single Classes (9% BTW by default) and re-books it to Online/Livestream
// (21% BTW by default). Rates are always taken from the caller's live category_settings — never
// hardcoded here — so the booked correction can never silently drift out of sync with what was
// actually configured at the time.
// The customer paid the same gross amount either way — only the internal categorization was
// wrong — so debit and credit always represent the same gross euro figure by construction.
export function generateCorrectionMemoXml(
  inputs: CorrectionMemoInput[],
  generalSettings: TwinfieldGeneralSettings,
): string {
  const { office, journalCode } = generalSettings;
  const transactions: string[] = [];

  for (const input of inputs) {
    if (input.grossTotal < 0) {
      throw new Error(`Correction memo for ${input.period}: grossTotal must not be negative (got ${input.grossTotal})`);
    }

    const gross = round2(input.grossTotal);
    if (gross === 0) continue;

    // The tautological check further below (debit/credit reconstructing to `gross`) is true by
    // construction regardless of which rates were used — it does NOT catch identical or swapped
    // rates, which would silently book a zero-delta "correction". This check does.
    if (input.singleClassesRate === input.onlineRate) {
      throw new Error(
        `Correction memo for ${input.period}: singleClassesRate and onlineRate must differ (got ${input.singleClassesRate} for both) — a correction between identical rates books no actual BTW delta`
      );
    }

    const oldNetto = round2(gross / (1 + input.singleClassesRate));
    const oldBtw = round2(gross - oldNetto);
    const newNetto = round2(gross / (1 + input.onlineRate));
    const newBtw = round2(gross - newNetto);

    const debitTotal = round2(oldNetto + oldBtw);
    const creditTotal = round2(newNetto + newBtw);
    if (Math.abs(debitTotal - creditTotal) > 0.01 || Math.abs(debitTotal - gross) > 0.01) {
      throw new Error(
        `Correction memo for ${input.period} does not balance: debit=${debitTotal}, credit=${creditTotal}, gross=${gross}`
      );
    }

    const label = monthLabel(input.period);
    const lines = [
      debitLineWithVat(1, input.singleClassesAccount, oldNetto, oldBtw, btwCode(input.singleClassesRate), `Correctie €9 online -> ${label}`),
      creditLine(2, input.onlineAccount, newNetto, newBtw, btwCode(input.onlineRate), `Correctie €9 online -> ${label}`),
    ];

    transactions.push(buildTransaction({
      office,
      code: journalCode,
      period: twinfieldPeriod(input.period),
      date: lastDayOfMonth(input.period),
      description: `Correctie €9 losse lessen -> Online ${label}`,
      freetext1: "€9 online single-class BTW correctie",
      freetext2: input.period,
    }, lines));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<transactions>\n${transactions.join("\n")}\n</transactions>`;
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
      <description>${escapeXml(trunc(header.description))}</description>
      <freetext1>${escapeXml(header.freetext1)}</freetext1>
      <freetext2>${escapeXml(header.freetext2)}</freetext2>
    </header>
    <lines>
${lines.join("\n")}
    </lines>
  </transaction>`;
}

export interface TwinfieldImbalanceError extends Error {
  code: 'TWINFIELD_IMBALANCE';
  debitTotal: number;
  creditTotal: number;
  gap: number;
}

export interface TwinfieldExportInput {
  session: ReconciliationSession;
  categories: Omit<CategorySummary, "items">[];
  paymentMethods: PaymentMethodSummary[];
  // All accrual entries from the current session (every booking month ≠ current period).
  // Used to both derive the 1809 credit amount and generate pre-posted forward-dated release memos.
  // Credit 1809 = sum of these entries → 1809 closes within every XML export.
  currentSessionAccruals: AccrualEntry[];
  generalSettings: TwinfieldGeneralSettings;
  paymentMethodSettings: { methodName: string; twinfieldAccount: string; isStripeMethod: boolean }[];
  // When true: add a sluitpost on 2999 (vraagpostengrootboek) to close any debit/credit gap.
  // When false (default): throw TwinfieldImbalanceError if the revenue transaction doesn't balance.
  forceBalance?: boolean;
}

export function generateTwinfieldXml(input: TwinfieldExportInput): string {
  const { session, categories, paymentMethods, currentSessionAccruals, generalSettings, paymentMethodSettings, forceBalance } = input;
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
  let debitTotal = 0;
  let creditTotal = 0;

  // Debit lines: payment methods
  for (const pm of paymentMethods) {
    const gross = round2(pm.totalAmount ?? 0);
    if (gross === 0) continue;
    const pmName = normalizePmName(pm.paymentMethod);
    const pmCfg = pmLookup.get(pmName.toLowerCase());
    if (!pmCfg?.twinfieldAccount) continue;
    debitTotal = round2(debitTotal + gross);
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
    // Twinfield auto-posts vatvalue as a separate BTW line, so effective credit = netto + vatvalue = gross
    creditTotal = round2(creditTotal + gross);
    revLines.push(creditLine(lineId++, account, netto, btw, code, `${cat.category} ${label}`, dim2));
  }

  // Balance validation: debitTotal must equal creditTotal (Twinfield processes netto + auto-BTW on each credit line)
  const revGap = round2(creditTotal - debitTotal);
  if (Math.abs(revGap) > 0.01) {
    if (forceBalance) {
      // Add sluitpost on 2999 (vraagpostengrootboek) so the booking imports
      if (revGap > 0) {
        revLines.push(debitLine(lineId++, "2999", revGap, `Sluitpost omzet ${label}`));
      } else {
        revLines.push(creditLine(lineId++, "2999", Math.abs(revGap), 0, "VVR", `Sluitpost omzet ${label}`));
      }
    } else {
      const err = new Error(
        `Revenue transaction is not in balance: debit=${debitTotal.toFixed(2)}, credit=${creditTotal.toFixed(2)}, gap=${revGap.toFixed(2)}`
      ) as TwinfieldImbalanceError;
      err.code = 'TWINFIELD_IMBALANCE';
      err.debitTotal = debitTotal;
      err.creditTotal = creditTotal;
      err.gap = revGap;
      throw err;
    }
  }

  if (revLines.length >= 2) {
    transactions.push(buildTransaction({
      office, code: journalCode, period, date,
      description: `Momence omzet ${label}`,
      freetext1: `Reconciliatie ${session.period}`,
      freetext2: sessionRef,
    }, revLines));
  }

  // Shared account lookup — overrides stale stored accounts with current category settings.
  const catRevenueAccountLookup = new Map(
    categories.map(cat => [cat.category.toLowerCase(), cat.twinfieldAccount || ""])
  );
  function resolveAccount(category: string, storedAccount: string): string {
    return catRevenueAccountLookup.get(category.toLowerCase()) || storedAccount || "4098";
  }

  // All current-session entries for months other than the current period.
  // These become the pre-posted release memos (Transactions 3…N).
  // We also derive Transaction 2's 1809 credit from these so that
  // total credits to 1809 = total debits to 1809 within every XML export.
  const futureEntries = currentSessionAccruals.filter(e => e.bookingMonth !== session.period);

  // ── Transaction 2: Deferral memo ────────────────────────────────────────────
  // Parks the unearned netto of deferred categories into the cross account (1809).
  // BTW was already booked in full in Transaction 1 — only netto moves here.
  //
  // The credit to 1809 is derived directly from the sum of the pre-posted release
  // entries (futureEntries), so 1809 always nets to zero within this XML export.
  //
  // Debit:  revenue accounts per deferred category (sum of future release amounts)
  // Credit: 1809 (exact total of all future debit entries — cross account closes)

  const unearnedByCat = new Map<string, { account: string; total: number }>();
  for (const entry of futureEntries) {
    if (!DEFERRED_CATEGORIES.has(entry.category)) continue;
    const amount = round2(entry.bookingAmount ?? 0);
    if (amount === 0) continue;
    const account = resolveAccount(entry.category, entry.twinfieldAccount ?? "");
    const existing = unearnedByCat.get(entry.category);
    if (existing) {
      existing.total = round2(existing.total + amount);
    } else {
      unearnedByCat.set(entry.category, { account, total: amount });
    }
  }

  const defLines: string[] = [];
  let dId = 1;
  let totalUnearned = 0;

  for (const [catName, data] of Array.from(unearnedByCat.entries())) {
    defLines.push(debitLine(dId++, data.account, data.total, `${catName} uitgest. ${label}`, costCenter(data.account, catName)));
    totalUnearned = round2(totalUnearned + data.total);
  }

  if (defLines.length > 0) {
    defLines.push(creditLine(dId++, accrualCrossAccount, totalUnearned, 0, "VVR", `Uitgestelde omzet ${label}`));
    transactions.push(buildTransaction({
      office, code: journalCode, period, date,
      description: `Uitgestelde omzet ${label}`,
      freetext1: `Reconciliatie ${session.period}`,
      freetext2: sessionRef,
    }, defLines));
  }

  // ── Transactions 3…N: Future period release memos ────────────────────────────
  // One transaction per future bookingMonth from the current session's accrual schedule,
  // each tagged with its own <period> and last-day <date>.
  // Mirrors Twinfield's OMZETVERDELING pattern: all releases are pre-posted upfront
  // so 1809 self-balances across every period without manual intervention.
  //
  // Debit 1809 → Credit revenue accounts (netto only, no BTW)

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
