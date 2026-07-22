// script/split-momence-export.ts
// One-off helper: takes a combined Momence "all payments" export (columns:
// Item, "Sale value", "Payment date", "Service date", "Payment status", ...)
// and splits it into one CSV per month, filtered to Payment status = Succeeded.
//
// Usage: tsx script/split-momence-export.ts ./momence-latest-payments-report-combined.csv [outputDir] [fromPeriod] [toPeriod]
// Example: tsx script/split-momence-export.ts ./combined.csv ./momence-split 2026-01 2026-05
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import Papa from "papaparse";

interface MomenceExportRow {
  Item?: string;
  "Sale value"?: string;
  "Payment date"?: string;
  "Service date"?: string;
  "Payment status"?: string;
  [key: string]: string | undefined;
}

function main() {
  const [inputPath, outputDirArg, fromArg, toArg] = process.argv.slice(2);
  if (!inputPath) {
    console.error("Usage: tsx script/split-momence-export.ts <combined.csv> [outputDir] [fromPeriod] [toPeriod]");
    console.error("Example: tsx script/split-momence-export.ts ./combined.csv ./momence-split 2026-01 2026-05");
    process.exit(1);
  }

  const outputDir = outputDirArg || "./momence-split";
  const fromPeriod = fromArg || "2026-01";
  const toPeriod = toArg || "2026-05";

  const content = readFileSync(inputPath, "utf-8");
  const parsed = Papa.parse<MomenceExportRow>(content, { header: true, skipEmptyLines: true });

  if (parsed.errors.length > 0) {
    console.warn(`CSV parser reported ${parsed.errors.length} row error(s) — some rows may have been skipped or misread.`);
  }

  const byPeriod = new Map<string, MomenceExportRow[]>();
  let skippedNotSucceeded = 0;
  let skippedOutOfRange = 0;
  let skippedNoDate = 0;

  for (const row of parsed.data) {
    if (row["Payment status"] !== "Succeeded") {
      skippedNotSucceeded++;
      continue;
    }

    const paymentDate = row["Payment date"] || "";
    const period = paymentDate.slice(0, 7); // "2026-07-15, 10:37 PM" -> "2026-07"
    if (!/^\d{4}-\d{2}$/.test(period)) {
      skippedNoDate++;
      continue;
    }

    if (period < fromPeriod || period > toPeriod) {
      skippedOutOfRange++;
      continue;
    }

    row["Date"] = paymentDate;
    const bucket = byPeriod.get(period) ?? [];
    bucket.push(row);
    byPeriod.set(period, bucket);
  }

  mkdirSync(outputDir, { recursive: true });

  const writtenPeriods: string[] = [];
  for (const [period, rows] of [...byPeriod.entries()].sort()) {
    const csv = Papa.unparse(rows);
    const outPath = `${outputDir}/${period}.csv`;
    writeFileSync(outPath, csv);
    console.log(`${period}: ${rows.length} succeeded rows -> ${outPath}`);
    writtenPeriods.push(period);
  }

  console.log(`\nSkipped: ${skippedNotSucceeded} not-succeeded, ${skippedOutOfRange} outside ${fromPeriod}..${toPeriod}, ${skippedNoDate} missing/unparseable payment date.`);

  if (writtenPeriods.length === 0) {
    console.log("No periods written — nothing in range or all rows filtered out.");
    return;
  }

  const argsList = writtenPeriods.map(p => `${p}=${outputDir}/${p}.csv`).join(" ");
  console.log(`\nNext step, run:`);
  console.log(`npx tsx script/analyze-online-single-classes.ts ${argsList}`);
  console.log(`npx tsx script/generate-correction-memo.ts ${argsList}`);
}

main();
