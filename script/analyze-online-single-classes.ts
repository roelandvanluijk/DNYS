// script/analyze-online-single-classes.ts
import { readFileSync, writeFileSync } from "fs";
import Papa from "papaparse";
import { storage } from "../server/storage";
import { pool } from "../server/db";
import {
  categorizeItemCached,
  applyOnlineSingleClassOverride,
  type CustomCategoryConfig,
} from "../server/categorization";
import type { ProductSettings } from "@shared/schema";

interface MomenceRow {
  Item?: string;
  "Sale value"?: string;
  Date?: string;
}

function parseNumber(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Usage: tsx script/analyze-online-single-classes.ts 2026-01=./jan.csv 2026-02=./feb.csv ...
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: tsx script/analyze-online-single-classes.ts 2026-01=./jan.csv 2026-02=./feb.csv ...");
    process.exit(1);
  }

  const customCategories: CustomCategoryConfig[] | null = await storage.getCategorySettings();
  const allProducts: ProductSettings[] = await storage.getAllProducts();
  const productCache = new Map(allProducts.map(p => [p.itemName, p]));

  const singleClasses = customCategories?.find(c => c.name === "Single Classes");
  const singleClassesAccount = singleClasses?.twinfieldAccount ?? "8120";
  const singleClassesBtw = singleClasses?.btwRate ?? 0.09;
  const online = customCategories?.find(c => c.name === "Online/Livestream");
  const onlineAccount = online?.twinfieldAccount ?? "8200";
  const onlineBtw = online?.btwRate ?? 0.21;

  const rows: string[] = [
    "period,reclassified_count,gross_total,old_netto,old_btw,new_netto,new_btw,btw_delta",
  ];

  for (const arg of args) {
    const [period, filePath] = arg.split("=");
    const content = readFileSync(filePath, "utf-8");
    const parsed = Papa.parse<MomenceRow>(content, { header: true, skipEmptyLines: true });

    let reclassifiedCount = 0;
    let grossTotal = 0;

    for (const row of parsed.data) {
      const item = row.Item || "";
      const saleValue = parseNumber(row["Sale value"]);
      const raw = categorizeItemCached(item, customCategories, productCache);
      const final = applyOnlineSingleClassOverride(raw, saleValue, customCategories);
      if (raw.category === "Single Classes" && final.category === "Online/Livestream") {
        reclassifiedCount++;
        grossTotal += saleValue;
      }
    }

    grossTotal = round2(grossTotal);
    const oldNetto = round2(grossTotal / (1 + singleClassesBtw));
    const oldBtw = round2(grossTotal - oldNetto);
    const newNetto = round2(grossTotal / (1 + onlineBtw));
    const newBtw = round2(grossTotal - newNetto);
    const btwDelta = round2(newBtw - oldBtw);

    console.log(`\n=== ${period} ===`);
    console.log(`Reclassified: ${reclassifiedCount} transactions, €${grossTotal} gross`);
    console.log(`  Old (Single Classes @ ${singleClassesBtw * 100}%, account ${singleClassesAccount}): netto €${oldNetto}, BTW €${oldBtw}`);
    console.log(`  New (Online/Livestream @ ${onlineBtw * 100}%, account ${onlineAccount}): netto €${newNetto}, BTW €${newBtw}`);
    console.log(`  BTW delta: €${btwDelta}`);

    rows.push(`${period},${reclassifiedCount},${grossTotal},${oldNetto},${oldBtw},${newNetto},${newBtw},${btwDelta}`);
  }

  writeFileSync("./online-single-class-analysis.csv", rows.join("\n"));
  console.log("\nWritten to ./online-single-class-analysis.csv");

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
