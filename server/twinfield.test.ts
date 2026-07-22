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
    { period: "2026-01", grossTotal: 900, singleClassesAccount: "4071", onlineAccount: "2015", singleClassesRate: 0.09, onlineRate: 0.21 },
  ];

  it("produces one transaction dated with the original month, not today", () => {
    const xml = generateCorrectionMemoXml(oneMonth, generalSettings);
    expect(xml).toContain("<period>2026/01</period>");
    expect(xml).toContain("<date>20260131</date>");
  });

  it("uses the journal code from generalSettings", () => {
    const customJournalCode = { ...generalSettings, journalCode: "MOMENCE" };
    const xml = generateCorrectionMemoXml(oneMonth, customJournalCode);
    expect(xml).toContain("<code>MOMENCE</code>");
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

  it("self-balances: netto+vatvalue reconstructs the gross on both the debit and credit side, for a non-round amount", () => {
    const messyGross = 1234.56;
    const messy: CorrectionMemoInput[] = [
      { period: "2026-03", grossTotal: messyGross, singleClassesAccount: "4071", onlineAccount: "2015", singleClassesRate: 0.09, onlineRate: 0.21 },
    ];
    const xml = generateCorrectionMemoXml(messy, generalSettings);

    // Parse the debit line (Single Classes, dim1 4071) and credit line (Online, dim1 2015) out of the XML.
    const debitLineMatch = xml.match(/<dim1>4071<\/dim1>[\s\S]*?<value>([\d.]+)<\/value>[\s\S]*?<vatvalue>([\d.]+)<\/vatvalue>/);
    const creditLineMatch = xml.match(/<dim1>2015<\/dim1>[\s\S]*?<value>([\d.]+)<\/value>[\s\S]*?<vatvalue>([\d.]+)<\/vatvalue>/);

    expect(debitLineMatch).not.toBeNull();
    expect(creditLineMatch).not.toBeNull();

    const debitNetto = parseFloat(debitLineMatch![1]);
    const debitVat = parseFloat(debitLineMatch![2]);
    const creditNetto = parseFloat(creditLineMatch![1]);
    const creditVat = parseFloat(creditLineMatch![2]);

    expect(Math.abs(debitNetto + debitVat - messyGross)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(creditNetto + creditVat - messyGross)).toBeLessThanOrEqual(0.01);
  });

  it("stamps KPL0000 cost center (dim2) on the 4xxx P&L line, since Twinfield rejects 4xxx accounts without a relatie/kostenplaats", () => {
    const xml = generateCorrectionMemoXml(oneMonth, generalSettings);
    const debitLine = xml.match(/<line id="1">[\s\S]*?<\/line>/)![0];
    const creditLine = xml.match(/<line id="2">[\s\S]*?<\/line>/)![0];

    expect(debitLine).toContain("<dim1>4071</dim1>");
    expect(debitLine).toContain("<dim2>KPL0000</dim2>");
    // Online/Livestream account 2015 is outside the 4xxx range, so dim2 stays empty.
    expect(creditLine).toContain("<dim1>2015</dim1>");
    expect(creditLine).toContain("<dim2/>");
  });

  it("produces one transaction per month, for multiple months", () => {
    const twoMonths: CorrectionMemoInput[] = [
      { period: "2026-01", grossTotal: 900, singleClassesAccount: "4071", onlineAccount: "2015", singleClassesRate: 0.09, onlineRate: 0.21 },
      { period: "2026-02", grossTotal: 450, singleClassesAccount: "4071", onlineAccount: "2015", singleClassesRate: 0.09, onlineRate: 0.21 },
    ];
    const xml = generateCorrectionMemoXml(twoMonths, generalSettings);
    expect((xml.match(/<transaction /g) || []).length).toBe(2);
    expect(xml).toContain("<period>2026/02</period>");
  });

  it("skips a month with zero gross total", () => {
    const withZero: CorrectionMemoInput[] = [
      { period: "2026-01", grossTotal: 0, singleClassesAccount: "4071", onlineAccount: "2015", singleClassesRate: 0.09, onlineRate: 0.21 },
    ];
    const xml = generateCorrectionMemoXml(withZero, generalSettings);
    expect((xml.match(/<transaction /g) || []).length).toBe(0);
  });

  it("throws when singleClassesRate and onlineRate are equal, since that would book a zero-delta correction", () => {
    const sameRate: CorrectionMemoInput[] = [
      { period: "2026-01", grossTotal: 900, singleClassesAccount: "4071", onlineAccount: "2015", singleClassesRate: 0.09, onlineRate: 0.09 },
    ];
    expect(() => generateCorrectionMemoXml(sameRate, generalSettings)).toThrow(/must differ/);
  });

  it("throws when grossTotal is negative", () => {
    const negativeGross: CorrectionMemoInput[] = [
      { period: "2026-01", grossTotal: -900, singleClassesAccount: "4071", onlineAccount: "2015", singleClassesRate: 0.09, onlineRate: 0.21 },
    ];
    expect(() => generateCorrectionMemoXml(negativeGross, generalSettings)).toThrow(/must not be negative/);
  });
});
