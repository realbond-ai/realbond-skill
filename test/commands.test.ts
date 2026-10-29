import { readFileSync } from "node:fs";
import { decodeFunctionData, parseEther, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import launchpadAbi from "../src/abi/launchpad.json" with { type: "json" };
import { parseCommand, USAGE_TEXT } from "../src/commands/parse.ts";
import { buildTx, BUY_GAS_LIMIT, dryRunJson, type WriteContext } from "../src/commands/write.ts";
import { fakeRpc, type Handler } from "./helpers/fakeRpc.ts";

const LAUNCHPAD = "0x3333333333333333333333333333333333333333";
const WALLET: `0x${string}` = "0xedBEDaF88ec96B8Aa4E6dF36de335b77C53cAAcd";
const CREATOR: `0x${string}` = "0x4444444444444444444444444444444444444444";
const PLAIN_TOKEN = "0x5555555555555555555555555555555555555555";
const TAX_TOKEN = "0x6666666666666666666666666666666666666666";
const ZERO = "0x0000000000000000000000000000000000000000";
const REGISTRY = "0x2222222222222222222222222222222222222222";
const QUOTED_TOKENS = 12_000_000n * 10n ** 18n;

function launch(taxed: boolean, status = 0) {
  return {
    creator: CREATOR, createdAt: 1n, graduatedAt: 0n, status, taxed,
    token: taxed ? TAX_TOKEN : PLAIN_TOKEN, pair: ZERO, name: "A", symbol: "A", metaCid: "c", netRaised: 0n, sold: 0n,
  };
}

// launch 0 is plain, launch 1 is taxed; nextId = 2.
const BASE_HANDLERS: Record<string, Handler> = {
  registry: REGISTRY,
  isEligible: true,
  nextId: 2n,
  launches: ([id]: readonly unknown[]) => launch(id === 1n),
};

function context(handlers: Record<string, Handler> = {}, wallet = WALLET) {
  const rpc = fakeRpc({ ...BASE_HANDLERS, ...handlers });
  const notes: string[] = [];
  const ctx: WriteContext = { targets: { launchpad: LAUNCHPAD }, wallet, client: rpc.client, notify: (l) => notes.push(l) };
  return { ctx, notes, calls: rpc.calls };
}

const args = (data: `0x${string}`) => decodeFunctionData({ abi: launchpadAbi, data }).args;

describe("buy", () => {
  it("quotesWithTheGrossValueAndSetsMinTokensTo99PercentWithTheBuyGasCap", async () => {
    const { ctx, calls } = context({ quoteBuy: [QUOTED_TOKENS, 0n, 0n] });
    const tx = await buildTx(parseCommand(["buy", "1", "0.01"]), ctx);
    expect(tx.to).toBe(LAUNCHPAD);
    expect(tx.value).toBe(parseEther("0.0101"));
    expect(tx.gasLimit).toBe(7_000_000n);
    expect(BUY_GAS_LIMIT).toBe(7_000_000n);
    expect(args(tx.data)).toEqual([1n, (QUOTED_TOKENS * 99n) / 100n]);
    expect(calls.map((call) => call.functionName)).toEqual(["registry", "isEligible", "quoteBuy"]);
    expect(calls[1]).toMatchObject({ to: REGISTRY, args: [WALLET] });
    expect(calls[2]?.args).toEqual([1n, WALLET, parseEther("0.0101")]);
  });

  it("stopsAWalletWithoutAgentIdOrXBindingBeforeQuoting", async () => {
    const { ctx, calls } = context({ isEligible: false });
    await expect(buildTx(parseCommand(["buy", "1", "0.01", "--min-tokens", "0"]), ctx)).rejects.toThrow(
      /^NOT_ELIGIBLE: .* buying requires an Agent ID and an X binding/,
    );
    expect(calls.map((call) => call.functionName)).not.toContain("quoteBuy");
  });

  it("reportsAFailedEligibilityRead", async () => {
    const { ctx } = context({ isEligible: () => { throw new Error("rpc down"); } });
    await expect(buildTx(parseCommand(["buy", "1", "0.01"]), ctx)).rejects.toThrow(/registry\.isEligible for AGENT_WALLET failed/);
  });

  it("warnsWhenPartOfTheValueWillBeRefunded", async () => {
    const { ctx, notes } = context({ quoteBuy: [QUOTED_TOKENS, 0n, parseEther("0.5")] });
    await buildTx(parseCommand(["buy", "1", "1"]), ctx);
    expect(notes.join("\n")).toMatch(/0\.5 BNB .* will be refunded/);
  });

  it("explicitMinTokensStillQuotesFirstAndOnlyOverridesTheBound", async () => {
    const { ctx, calls, notes } = context({ quoteBuy: [QUOTED_TOKENS, 0n, parseEther("0.2")] });
    const tx = await buildTx(parseCommand(["buy", "2", "0.05", "--min-tokens", "123"]), ctx);
    expect(calls.map((call) => call.functionName)).toEqual(["registry", "isEligible", "quoteBuy"]);
    expect(calls[2]?.args).toEqual([2n, WALLET, parseEther("0.0505")]);
    expect(args(tx.data)).toEqual([2n, 123n]);
    expect(tx.gasLimit).toBe(BUY_GAS_LIMIT);
    expect(notes.join("\n")).toMatch(/0\.2 BNB .* will be refunded/);
    expect(notes.join("\n")).not.toMatch(/Slippage/);
  });

  it("explicitMinTokensAboveTheQuoteWarnsOfSlippageButStillBuilds", async () => {
    const { ctx, notes } = context({ quoteBuy: [100n, 0n, 0n] });
    const tx = await buildTx(parseCommand(["buy", "2", "0.05", "--min-tokens", "101"]), ctx);
    expect(args(tx.data)).toEqual([2n, 101n]);
    expect(notes.join("\n")).toMatch(/--min-tokens 101 is above the current quote 100; the buy will revert with Slippage/);
  });

  it.each(["WrongStatus", "WalletCapReached"])("explicitMinTokensPathDecodesTheQuoteRevert%s", async (errorName) => {
    const { ctx } = context({ quoteBuy: { revert: errorName } });
    await expect(buildTx(parseCommand(["buy", "9", "0.01", "--min-tokens", "5"]), ctx)).rejects.toThrow(
      new RegExp(`quoteBuy for launch 9 reverted: ${errorName}`),
    );
  });

  it.each(["WrongStatus", "WalletCapReached", "BuyTooSmall"])("surfacesTheQuoteRevert%s", async (errorName) => {
    const { ctx } = context({ quoteBuy: { revert: errorName } });
    await expect(buildTx(parseCommand(["buy", "9", "0.01"]), ctx)).rejects.toThrow(
      new RegExp(`quoteBuy for launch 9 reverted: ${errorName}`),
    );
  });

  it.each([[["buy", "1", "0.01"]], [["buy", "1", "0.01", "--min-tokens", "0"]]])("needsAnRpcToQuote %j", async (argv) => {
    await expect(buildTx(parseCommand(argv), { targets: { launchpad: LAUNCHPAD }, wallet: WALLET })).rejects.toThrow(
      /buy needs RPC_URL/,
    );
  });
});

describe("sell", () => {
  it("sellsADecimalTokenAmountWithTheQuotedMinBnbAndNoValue", async () => {
    const { ctx } = context({ quoteSell: [parseEther("0.1"), parseEther("0.001")] });
    const tx = await buildTx(parseCommand(["sell", "0", "1000.5"]), ctx);
    expect(tx.value).toBe(0n);
    expect(tx.gasLimit).toBeUndefined();
    expect(args(tx.data)).toEqual([0n, parseEther("1000.5"), (parseEther("0.099") * 99n) / 100n]);
  });

  it("sellAllReadsTheWalletBalanceOfTheLaunchToken", async () => {
    const balance = 20_000_000n * 10n ** 18n;
    const { ctx, calls } = context({ balanceOf: balance });
    const tx = await buildTx(parseCommand(["sell", "0", "all", "--min-bnb", "9"]), ctx);
    expect(args(tx.data)).toEqual([0n, balance, 9n]);
    const balanceCall = calls.find((call) => call.functionName === "balanceOf");
    expect(balanceCall?.to.toLowerCase()).toBe(PLAIN_TOKEN);
    expect(balanceCall?.args).toEqual([WALLET]);
  });

  it("sellAllRefusesAnEmptyBalance", async () => {
    const { ctx } = context({ balanceOf: 0n });
    await expect(buildTx(parseCommand(["sell", "0", "all", "--min-bnb", "1"]), ctx)).rejects.toThrow(/holds no tokens/);
  });

  it("sellAllRefusesAnUnknownLaunch", async () => {
    const { ctx } = context();
    await expect(buildTx(parseCommand(["sell", "7", "all"]), ctx)).rejects.toThrow(/launch 7 does not exist \(nextId is 2\)/);
  });
});

describe("tax token commands", () => {
  it.each([
    ["process-tax", "processTax", { accruedTax: 5n }],
    ["claim-dividend", "claimDividend", { withdrawableDividendOf: 5n }],
  ] as const)("%sTargetsTheTaxTokenItself", async (kind, fn, handlers) => {
    const { ctx } = context(handlers);
    const tx = await buildTx(parseCommand([kind, "1"]), ctx);
    expect(tx.to.toLowerCase()).toBe(TAX_TOKEN);
    expect(tx.data).toBe(toFunctionSelector(`${fn}()`));
    expect(tx.value).toBe(0n);
  });

  it.each(["process-tax", "claim-dividend"])("%sRefusesAPlainLaunchLocally", async (kind) => {
    const { ctx } = context();
    await expect(buildTx(parseCommand([kind, "0"]), ctx)).rejects.toThrow(/launch 0 is a plain token/);
  });

  it.each([
    ["process-tax", { accruedTax: 0n }, /no accrued tax/],
    ["claim-dividend", { withdrawableDividendOf: 0n }, /no dividend to claim/],
  ] as const)("%sRefusesWhenThereIsNothingToDo", async (kind, handlers, message) => {
    const { ctx } = context(handlers);
    await expect(buildTx(parseCommand([kind, "1"]), ctx)).rejects.toThrow(message);
  });

  it("claimDividendReportsTheAmountInTokens", async () => {
    const { ctx, notes } = context({ withdrawableDividendOf: 1_500n * 10n ** 18n });
    await buildTx(parseCommand(["claim-dividend", "1"]), ctx);
    expect(notes).toEqual([expect.stringMatching(/claiming 1500 tokens of launch 1 .*paid in the token itself/)]);
  });

  it("creatorFeeCommandIsRemoved", () => {
    expect(() => parseCommand(["claim-creator-fee", "1"])).toThrow(/the creator receives 0% of the tax/);
  });
});

describe("dryRunJson", () => {
  it("printsToDataDecimalValueAndGasLimit", async () => {
    const tx = await buildTx(parseCommand(["buy", "1", "0.01", "--min-tokens", "0"]), context({ quoteBuy: [1n, 0n, 0n] }).ctx);
    expect(JSON.parse(dryRunJson(tx))).toEqual({ to: LAUNCHPAD, data: tx.data, value: "10100000000000000", gasLimit: "7000000" });
  });

  it("printsANullGasLimitWhenTheBackendEstimates", () => {
    expect(JSON.parse(dryRunJson({ to: LAUNCHPAD, data: "0x", value: 0n })).gasLimit).toBeNull();
  });
});

describe("parseCommand", () => {
  it("acceptsTheExactCommandsTheWebsitePrints", () => {
    expect(parseCommand(["buy", "3", "0.1", "--min-tokens", "990"])).toEqual({
      kind: "buy", id: 3n, netWei: parseEther("0.1"), minTokens: 990n, dryRun: false,
    });
    expect(parseCommand(["sell", "3", "all", "--min-bnb", "5"])).toEqual({ kind: "sell", id: 3n, tokens: "all", minBnb: 5n, dryRun: false });
    expect(parseCommand(["bind", "binding.json"])).toEqual({ kind: "bind", file: "binding.json", dryRun: false });
    expect(parseCommand(["claim-dividend", "4"])).toEqual({ kind: "claim-dividend", id: 4n, dryRun: false });
  });

  it("parsesDryRunInAnyPosition", () => {
    expect(parseCommand(["--dry-run", "process-tax", "1"]).dryRun).toBe(true);
    expect(parseCommand(["position", "7"])).toEqual({ kind: "position", id: 7n, dryRun: false });
  });

  it("registerPointsToBind", () => {
    expect(() => parseCommand(["register", "a.json"])).toThrow(/removed in v2, use bind <binding\.json>/);
  });

  it("usageNamesTheBindingFile", () => {
    expect(USAGE_TEXT).toContain("bind <binding.json>");
    expect(() => parseCommand(["bind"])).toThrow("usage: bind <binding.json>");
  });

  it.each(["claim", "refund", "graduate", "update-salt", "update-salt-and-graduate"])("%sIsRemovedInV2", (kind) => {
    expect(() => parseCommand([kind, "1"])).toThrow(/removed in v2/);
  });

  it.each([
    [["buy", "1"], /usage/i],
    [["buy", "x", "0.01"], /launch id/i],
    [["buy", "1", "abc"], /BNB amount/i],
    [["buy", "1", "0"], /BNB amount/i],
    [["buy", "1", "0.01", "--min-tokens", "1.5"], /--min-tokens/],
    [["sell", "1", "-3"], /token amount|unknown option|ambiguous/i],
    [["sell", "1", "0"], /token amount/i],
    [["buy", "1", "0.01", "--min-bnb", "5"], /--min-bnb is only valid for sell/],
    [["sell", "1", "all", "--min-tokens", "5"], /--min-tokens is only valid for buy/],
    [["process-tax"], /usage: process-tax <id>/],
    [["position", "x"], /launch id/i],
    [["status", "not-an-address"], /address/i],
    [["launch"], /unknown command/i],
    [[], /unknown command/i],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCommand(argv as string[])).toThrow(message);
  });

  it("statusAndPositionAreNotWriteCommands", async () => {
    await expect(buildTx(parseCommand(["position", "7"]), { targets: {} })).rejects.toThrow(/read-only/);
  });
});

describe("fixtures/skill_buy_tx.json", () => {
  it("isExactlyWhatBuildTxProducesForTheGraduationForkTest", async () => {
    const fixturePath = new URL("../../fixtures/skill_buy_tx.json", import.meta.url);
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { to: `0x${string}` };
    const { ctx } = context({ quoteBuy: [QUOTED_TOKENS, 0n, 0n] });
    const tx = await buildTx(parseCommand(["buy", "0", "5", "--min-tokens", "0"]), { ...ctx, targets: { launchpad: fixture.to } });
    expect(JSON.parse(dryRunJson(tx))).toEqual(fixture);
  });
});
