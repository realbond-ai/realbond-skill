import { describe, expect, it } from "vitest";
import { statusLabel } from "../src/chain.ts";
import { readPosition } from "../src/commands/position.ts";
import { fakeRpc, type Handler } from "./helpers/fakeRpc.ts";

const LAUNCHPAD = "0x3333333333333333333333333333333333333333";
const WALLET = "0xedBEDaF88ec96B8Aa4E6dF36de335b77C53cAAcd";
const OTHER = "0x4444444444444444444444444444444444444444";
const TOKEN = "0x5555555555555555555555555555555555555555";
const PAIR = "0x7777777777777777777777777777777777777777";
const CAP = 20_000_000n * 10n ** 18n;
const BALANCE = 10_000_000n * 10n ** 18n;
const INPUT = { launchpad: LAUNCHPAD, wallet: WALLET, id: 1n } as const;

type LaunchShape = { status: number; taxed: boolean; creator: string };

function handlers(shape: LaunchShape, extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    nextId: 2n,
    launches: {
      creator: shape.creator, createdAt: 1n, graduatedAt: 0n, status: shape.status, taxed: shape.taxed,
      token: TOKEN, pair: PAIR, name: "A", symbol: "A", metaCid: "c", netRaised: 0n, sold: 0n,
    },
    balanceOf: BALANCE,
    capOf: CAP,
    quoteSell: [10n ** 17n, 10n ** 15n],
    ...extra,
  };
}

describe("position", () => {
  it("liveTaxedLaunchShowsBalanceRemainingCapSellQuoteAndClaimables", async () => {
    const { client, calls } = fakeRpc(handlers({ status: 0, taxed: true, creator: WALLET }, {
      withdrawableDividendOf: 3n, accruedTax: 4n,
    }));
    expect(await readPosition(client, INPUT)).toEqual({
      status: "Live",
      token: TOKEN,
      taxed: true,
      balance: BALANCE.toString(),
      walletCap: CAP.toString(),
      remainingCap: (CAP - BALANCE).toString(),
      quoteSellAll: { bnbOut: "100000000000000000", fee: "1000000000000000" },
      tax: { withdrawableDividend: "3", accruedTax: "4" },
    });
    expect(calls.find((call) => call.functionName === "quoteSell")?.args).toEqual([1n, BALANCE]);
    expect(calls.find((call) => call.functionName === "capOf")?.args).toEqual([WALLET]);
  });

  it("graduatedPlainLaunchHasNoCapNoCurveQuoteAndNoTaxFields", async () => {
    const { client, calls } = fakeRpc(handlers({ status: 1, taxed: false, creator: OTHER }));
    expect(await readPosition(client, INPUT)).toEqual({
      status: "Graduated",
      token: TOKEN,
      taxed: false,
      balance: BALANCE.toString(),
      walletCap: null,
      remainingCap: null,
      quoteSellAll: null,
      tax: null,
    });
    expect(calls.map((call) => call.functionName)).not.toContain("quoteSell");
  });

  it("graduatedTaxedLaunchShowsTheTokenDividendAndNoCreatorFee", async () => {
    const { client } = fakeRpc(handlers({ status: 1, taxed: true, creator: OTHER }, { withdrawableDividendOf: 0n, accruedTax: 9n }));
    const position = await readPosition(client, INPUT);
    expect(position.tax).toEqual({ withdrawableDividend: "0", accruedTax: "9" });
  });

  it("capReachedLeavesZeroRoom", async () => {
    const { client } = fakeRpc(handlers({ status: 0, taxed: false, creator: OTHER }, { balanceOf: CAP }));
    expect((await readPosition(client, INPUT)).remainingCap).toBe("0");
  });

  it("refusesAnUnknownLaunchId", async () => {
    const { client } = fakeRpc(handlers({ status: 0, taxed: false, creator: OTHER }, { nextId: 1n }));
    await expect(readPosition(client, INPUT)).rejects.toThrow(/launch 1 does not exist/);
  });

  it("labelsStatuses", () => {
    expect(statusLabel(0)).toBe("Live");
    expect(statusLabel(1)).toBe("Graduated");
    expect(statusLabel(9)).toBe("Unknown(9)");
  });
});
