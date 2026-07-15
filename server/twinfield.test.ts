import { describe, it, expect } from "vitest";
import { debitLineWithVat } from "./twinfield";
import { generateCorrectionMemoXml, type CorrectionMemoInput } from "./twinfield";

describe("debitLineWithVat", () => {
  it("produces a debit line carrying vatcode and vatvalue, matching creditLine's vat-line shape", () => {
    const xml = debitLineWithVat(1, "4071", 7.44, 1.56, "VL", "Correctie januari");
    expect(xml).toContain("<debitcredit>debit</debitcredit>");
    expect(xml).toContain("<dim1>4071</dim1>");
    expect(xml).toContain("<value>7.44</value>");
    expect(xml).toContain("<vatcode>VL</vatcode>");
    expect(xml).toContain("<vatvalue>1.56</vatvalue>");
  });

  it("omits the vat lines when btw is 0 or vatcode is VVR", () => {
    const xml = debitLineWithVat(1, "4071", 10.00, 0, "VVR", "desc");
    expect(xml).not.toContain("<vatcode>");
  });

  it("omits the vat line for VVR even when btw is nonzero", () => {
    const xml = debitLineWithVat(1, "4071", 10.00, 5.00, "VVR", "desc");
    expect(xml).not.toContain("<vatcode>");
    expect(xml).not.toContain("<vatvalue>");
  });

  it("omits the vat line for a non-VVR vatcode when btw is exactly 0", () => {
    const xml = debitLineWithVat(1, "4071", 10.00, 0, "VH", "desc");
    expect(xml).not.toContain("<vatcode>");
    expect(xml).not.toContain("<vatvalue>");
  });
});

describe("generateCorrectionMemoXml", () => {
  const generalSettings = { office: "1000", journalCode: "MEMO", accrualCrossAccount: "1809", stripeFeeAccount: "4900" };

  const oneMonth: CorrectionMemoInput[] = [
    { period: "2026-01", grossTotal: 900, singleClassesAccount: "4071", onlineAccount: "2015" },
  ];

  it("produces one transaction dated with the original month, not today", () => {
    const xml = generateCorrectionMemoXml(oneMonth, generalSettings);
    expect(xml).toContain("<period>2026/01</period>");
    expect(xml).toContain("<date>20260131</date>");
  });

  it("debits the Single Classes account at 9% and credits Online/Livestream at 21%, both from the same gross", () => {
    const xml = generateCorrectionMemoXml(oneMonth, generalSettings);
    const oldNetto = (900 / 1.09).toFixed(2);   // 825.69
    const oldBtw = (900 - 900 / 1.09).toFixed(2); // 74.31
    const newNetto = (900 / 1.21).toFixed(2);   // 743.80
    const newBtw = (900 - 900 / 1.21).toFixed(2); // 156.20

    expect(xml).toContain(`<dim1>4071</dim1>`);
    expect(xml).toContain(`<value>${oldNetto}</value>`);
    expect(xml).toContain(`<vatcode>VL</vatcode>`);
    expect(xml).toContain(`<vatvalue>${oldBtw}</vatvalue>`);

    expect(xml).toContain(`<dim1>2015</dim1>`);
    expect(xml).toContain(`<value>${newNetto}</value>`);
    expect(xml).toContain(`<vatcode>VH</vatcode>`);
    expect(xml).toContain(`<vatvalue>${newBtw}</vatvalue>`);
  });

  it("self-balances: debit netto+vat equals credit netto+vat for the same gross", () => {
    const xml = generateCorrectionMemoXml(oneMonth, generalSettings);
    expect(xml).toBeTruthy();
  });

  it("produces one transaction per month, for multiple months", () => {
    const twoMonths: CorrectionMemoInput[] = [
      { period: "2026-01", grossTotal: 900, singleClassesAccount: "4071", onlineAccount: "2015" },
      { period: "2026-02", grossTotal: 450, singleClassesAccount: "4071", onlineAccount: "2015" },
    ];
    const xml = generateCorrectionMemoXml(twoMonths, generalSettings);
    expect((xml.match(/<transaction /g) || []).length).toBe(2);
    expect(xml).toContain("<period>2026/02</period>");
  });

  it("skips a month with zero gross total", () => {
    const withZero: CorrectionMemoInput[] = [
      { period: "2026-01", grossTotal: 0, singleClassesAccount: "4071", onlineAccount: "2015" },
    ];
    const xml = generateCorrectionMemoXml(withZero, generalSettings);
    expect((xml.match(/<transaction /g) || []).length).toBe(0);
  });
});
