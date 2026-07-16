// script/generate-correction-memo.ts
import { readFileSync, writeFileSync } from "fs";
import Papa from "papaparse";
import { storage } from "../server/storage";
import { pool } from "../server/db";
import { categorizeItemCached, applyOnlineSingleClassOverride, type CustomCategoryConfig } from "../server/categorization";
import { generateCorrectionMemoXml, type CorrectionMemoInput } from "../server/twinfield";
import type { ProductSettings } from "@shared/schema";

interface MomenceRow {
  Item?: string;
  "Sale value"?: string;
}

function parseNumber(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// Usage: tsx script/generate-correction-memo.ts 2026-01=./jan.csv 2026-02=./feb.csv ...
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: tsx script/generate-correction-memo.ts 2026-01=./jan.csv ...");
    process.exit(1);
  }

  const inputs: CorrectionMemoInput[] = [];
  const succeeded: string[] = [];
  const failed: string[] = [];
  let q1BtwDelta = 0;

  try {
    const customCategories: CustomCategoryConfig[] | null = await storage.getCategorySettings();
    const allProducts: ProductSettings[] = await storage.getAllProducts();
    const productCache = new Map(allProducts.map(p => [p.itemName, p]));
    const generalSettings = await storage.getGeneralSettings();

    const singleClasses = customCategories?.find(c => c.name === "Single Classes");
    const online = customCategories?.find(c => c.name === "Online/Livestream");
    if (!singleClasses || !online) {
      throw new Error("Single Classes or Online/Livestream not found in category_settings");
    }

    for (const arg of args) {
      const [period, filePath] = arg.split("=");
      if (!period || !filePath) {
        console.error(`Skipping malformed argument "${arg}" — expected format period=./file.csv (e.g. 2026-01=./jan.csv)`);
        failed.push(arg);
        continue;
      }

      try {
        const content = readFileSync(filePath, "utf-8");
        const parsed = Papa.parse<MomenceRow>(content, { header: true, skipEmptyLines: true });

        let grossTotal = 0;
        for (const row of parsed.data) {
          const item = row.Item || "";
          const saleValue = parseNumber(row["Sale value"]);
          const raw = categorizeItemCached(item, customCategories, productCache);
          const final = applyOnlineSingleClassOverride(raw, saleValue, customCategories);
          if (raw.category === "Single Classes" && final.category === "Online/Livestream") {
            grossTotal += saleValue;
          }
        }

        grossTotal = Math.round(grossTotal * 100) / 100;

        inputs.push({
          period,
          grossTotal,
          singleClassesAccount: singleClasses.twinfieldAccount,
          onlineAccount: online.twinfieldAccount,
          singleClassesRate: singleClasses.btwRate,
          onlineRate: online.btwRate,
        });

        if (period <= "2026-03") {
          const oldNetto = grossTotal / (1 + singleClasses.btwRate);
          const newNetto = grossTotal / (1 + online.btwRate);
          q1BtwDelta += (grossTotal - newNetto) - (grossTotal - oldNetto);
        }

        succeeded.push(period);
      } catch (e) {
        console.error(`Failed to process ${period} (${filePath}): ${(e as Error).message}`);
        failed.push(period);
      }
    }

    if (inputs.length > 0) {
      const xml = generateCorrectionMemoXml(inputs, generalSettings);
      writeFileSync("./correction-memo.xml", xml);
      console.log("Written to ./correction-memo.xml");
    } else {
      console.log("No periods processed successfully — correction-memo.xml not written.");
    }

    const q1Periods = ["2026-01", "2026-02", "2026-03"];
    const failedQ1 = q1Periods.filter(p => failed.includes(p));
    if (failedQ1.length > 0) {
      console.warn(
        `WARNING: Q1 period(s) ${failedQ1.join(", ")} failed to process — the Q1 BTW delta below is INCOMPLETE and must not be used for the suppletie decision until all Q1 periods succeed.`
      );
    }
    console.log(`Q1 (Jan-Mar) cumulative BTW delta: €${Math.round(q1BtwDelta * 100) / 100}`);
    console.log("Belastingdienst suppletie threshold is €1.000 — check this delta against it before deciding whether a formal suppletieaangifte is required.");
    console.log(`\nSucceeded (${succeeded.length}): ${succeeded.join(", ") || "none"}`);
    console.log(`Failed (${failed.length}, re-run these): ${failed.join(", ") || "none"}`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
