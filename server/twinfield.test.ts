import { describe, it, expect } from "vitest";
import { debitLineWithVat } from "./twinfield";

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
});
