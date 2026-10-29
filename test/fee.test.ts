import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { BUY_SLIPPAGE_BPS, grossForNet, minOutForQuote } from "../src/fee.ts";

describe("grossForNet", () => {
  it("adds the 1% fee on top of the net amount", () => {
    expect(grossForNet(parseEther("0.01"))).toBe(parseEther("0.0101"));
    expect(grossForNet(parseEther("0.1"))).toBe(parseEther("0.101"));
  });

  it("rounds up so the net amount is never short", () => {
    expect(grossForNet(1n)).toBe(2n);
    expect(grossForNet(99n)).toBe(100n);
    expect(grossForNet(100n)).toBe(101n);
  });

  it("returns zero for zero", () => {
    expect(grossForNet(0n)).toBe(0n);
  });

  it("rejects negative amounts", () => {
    expect(() => grossForNet(-1n)).toThrow(/negative/);
  });
});

describe("minOutForQuote", () => {
  it("is99PercentRoundedDownLikeTheWebsite", () => {
    expect(BUY_SLIPPAGE_BPS).toBe(100n);
    expect(minOutForQuote(1_000_000n)).toBe(990_000n);
    expect(minOutForQuote(199n)).toBe(197n);
    expect(minOutForQuote(0n)).toBe(0n);
    expect(() => minOutForQuote(-1n)).toThrow(/negative/);
  });
});
