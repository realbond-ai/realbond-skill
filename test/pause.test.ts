import { parseEther, zeroHash, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { parseCommand } from "../src/commands/parse.ts";
import { assertNotPaused, PAUSE_BIND, PAUSE_LAUNCH, PAUSE_TRADE } from "../src/commands/pause.ts";
import { readStatus, statusInput } from "../src/commands/status.ts";
import { runWrite, type WriteContext } from "../src/commands/write.ts";
import { writeJsonFile } from "./helpers/files.ts";
import { fakeRpc, type Handler } from "./helpers/fakeRpc.ts";

const LAUNCHPAD: Address = "0x3333333333333333333333333333333333333333";
const REGISTRY: Address = "0x2222222222222222222222222222222222222222";
const WALLET: Address = "0xedBEDaF88ec96B8Aa4E6dF36de335b77C53cAAcd";
const TAX_TOKEN = "0x6666666666666666666666666666666666666666";
const ZERO = "0x0000000000000000000000000000000000000000";
const ALL_PAUSED = PAUSE_LAUNCH | PAUSE_TRADE | PAUSE_BIND;
const TICKET = writeJsonFile({ name: "Agent", symbol: "AGT", metaCid: "bafy123", taxed: true }, "ticket.json");

const TAXED_LAUNCH = {
  creator: WALLET, createdAt: 1n, graduatedAt: 2n, status: 1, taxed: true,
  token: TAX_TOKEN, pair: ZERO, name: "A", symbol: "A", metaCid: "c", netRaised: 0n, sold: 0n,
};

// The bits of the two contracts are disjoint, so one pausedFlags answer serves both addresses.
function context(handlers: Record<string, Handler>) {
  const rpc = fakeRpc({ nextId: 2n, launches: TAXED_LAUNCH, registry: REGISTRY, isEligible: true, ...handlers });
  const ctx: WriteContext = { targets: { launchpad: LAUNCHPAD, registry: REGISTRY }, wallet: WALLET, client: rpc.client };
  const baw = { exec: vi.fn(async () => "{}"), confirm: vi.fn(async () => true) };
  return { ctx, baw, calls: rpc.calls };
}

const PAUSED_WRITES = [
  ["create", ["create", TICKET], PAUSE_LAUNCH, "launch"],
  ["buy", ["buy", "1", "0.01", "--min-tokens", "0"], PAUSE_TRADE, "trade"],
  ["sell", ["sell", "1", "5", "--min-bnb", "0"], PAUSE_TRADE, "trade"],
  ["bind", ["bind", "binding.json"], PAUSE_BIND, "bind"],
] as const;

describe("writes refuse a paused feature before baw", () => {
  it.each(PAUSED_WRITES)("%sThrowsPlatformPaused", async (_kind, argv, flags, feature) => {
    const { ctx, baw, calls } = context({ pausedFlags: flags });
    await expect(runWrite(parseCommand([...argv]), ctx, baw)).rejects.toThrow(
      new RegExp(`^PLATFORM_PAUSED: ${feature} is paused by the platform owner$`),
    );
    expect(baw.exec).not.toHaveBeenCalled();
    expect(calls.map((call) => call.functionName)).toEqual(["pausedFlags"]);
  });

  it.each(PAUSED_WRITES)("%sDryRunAlsoReportsPlatformPaused", async (_kind, argv, flags, feature) => {
    const { ctx, baw } = context({ pausedFlags: flags });
    await expect(runWrite(parseCommand([...argv, "--dry-run"]), ctx, baw)).rejects.toThrow(`PLATFORM_PAUSED: ${feature}`);
    expect(baw.exec).not.toHaveBeenCalled();
  });

  it.each(PAUSED_WRITES)("%sReadsTheContractThatOwnsItsBit", async (kind, argv, flags) => {
    const { ctx, calls } = context({ pausedFlags: flags });
    await runWrite(parseCommand([...argv, "--dry-run"]), ctx).catch(() => undefined);
    expect(calls[0]?.to.toLowerCase()).toBe(kind === "bind" ? REGISTRY : LAUNCHPAD);
  });

  it("anotherFeaturesBitDoesNotBlock", async () => {
    const { ctx } = context({ pausedFlags: PAUSE_LAUNCH | PAUSE_BIND, quoteBuy: [100n, 0n, 0n] });
    const out = JSON.parse(await runWrite(parseCommand(["buy", "1", "0.01", "--dry-run"]), ctx));
    expect(out).toMatchObject({ to: LAUNCHPAD, value: parseEther("0.0101").toString() });
  });

  it("createNowNeedsAnRpcForThePauseRead", async () => {
    const { ctx, baw } = context({});
    await expect(runWrite(parseCommand(["create", TICKET, "--dry-run"]), { ...ctx, client: undefined }, baw)).rejects.toThrow(
      /create needs RPC_URL/,
    );
  });
});

describe("eligibility gates buying only", () => {
  it("createProceedsForAWalletWithoutAgentIdOrXBinding", async () => {
    const { ctx, calls } = context({ pausedFlags: 0, isEligible: false });
    const out = JSON.parse(await runWrite(parseCommand(["create", TICKET, "--dry-run"]), ctx));
    expect(out).toMatchObject({ to: LAUNCHPAD, value: "0" });
    expect(calls.map((call) => call.functionName)).toEqual(["pausedFlags"]);
  });

  it("buyStopsAWalletWithoutAgentIdOrXBindingBeforeBaw", async () => {
    const { ctx, baw } = context({ pausedFlags: 0, isEligible: false });
    await expect(runWrite(parseCommand(["buy", "1", "0.01", "--min-tokens", "0"]), ctx, baw)).rejects.toThrow(/^NOT_ELIGIBLE/);
    expect(baw.exec).not.toHaveBeenCalled();
  });

  it("sellIsOpenToAnyHolder", async () => {
    const { ctx, calls } = context({ pausedFlags: 0, isEligible: false });
    await runWrite(parseCommand(["sell", "1", "5", "--min-bnb", "0", "--dry-run"]), ctx);
    expect(calls.map((call) => call.functionName)).not.toContain("isEligible");
  });
});

describe("a failed pause read stops the write", () => {
  it.each(PAUSED_WRITES)("%sExitsOnARevertedRead", async (kind, argv) => {
    const { ctx, baw } = context({ pausedFlags: { revert: "BadPauseFlags" } });
    const contract = kind === "bind" ? "registry" : "launchpad";
    await expect(runWrite(parseCommand([...argv]), ctx, baw)).rejects.toThrow(`${contract}.pausedFlags() read reverted: BadPauseFlags`);
    expect(baw.exec).not.toHaveBeenCalled();
  });

  it("exitsWhenTheContractHasNoPausedFlags", async () => {
    const { ctx, baw } = context({ pausedFlags: () => { throw new Error("no such function"); } });
    await expect(runWrite(parseCommand(["sell", "1", "5", "--min-bnb", "0"]), ctx, baw)).rejects.toThrow(
      /launchpad\.pausedFlags\(\) read failed/,
    );
    expect(baw.exec).not.toHaveBeenCalled();
  });

  it("refusesAnUnreadFeatureInsteadOfTreatingItAsOpen", () => {
    expect(() => assertNotPaused("buy", { bind: false })).toThrow(/trade pause state was not read/);
  });
});

describe("tax commands ignore the pause state", () => {
  it.each([
    ["process-tax", { accruedTax: 5n }],
    ["claim-dividend", { withdrawableDividendOf: 5n }],
  ] as const)("%sBuildsWithEverythingPausedAndNeverReadsPausedFlags", async (kind, handlers) => {
    const { ctx, calls } = context({ pausedFlags: ALL_PAUSED, ...handlers });
    const out = JSON.parse(await runWrite(parseCommand([kind, "1", "--dry-run"]), ctx));
    expect(out.to.toLowerCase()).toBe(TAX_TOKEN);
    expect(calls.map((call) => call.functionName)).not.toContain("pausedFlags");
  });
});

const UNBOUND = { xId: zeroHash, isPublic: false, isBlueVerified: false, followerTier: 0, boundAt: 0n, screenName: "" };
const STATUS_READS: Record<string, unknown> = { balanceOf: 1n, handleOf: "agent.ai", isEligible: false, bindingOf: UNBOUND };

function statusReader(flagsByAddress: Record<string, number | Error>) {
  const readContract = vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
    if (functionName !== "pausedFlags") return STATUS_READS[functionName];
    const flags = flagsByAddress[address];
    if (flags instanceof Error) throw flags;
    return flags;
  });
  return { readContract } as unknown as Parameters<typeof readStatus>[0];
}

describe("status paused", () => {
  it("cliPassesBothRegistryAndLaunchpadToStatus", () => {
    expect(statusInput(WALLET, { registry: REGISTRY, launchpad: LAUNCHPAD, rpcUrl: "x" })).toEqual({
      address: WALLET, registry: REGISTRY, launchpad: LAUNCHPAD,
    });
  });

  it("reportsLaunchAndTradeFromTheLaunchpadAndBindFromTheRegistry", async () => {
    const reader = statusReader({ [LAUNCHPAD]: PAUSE_TRADE, [REGISTRY]: PAUSE_BIND });
    const status = await readStatus(reader, { address: WALLET, registry: REGISTRY, launchpad: LAUNCHPAD });
    expect(status.paused).toEqual({ launch: false, trade: true, bind: true });
  });

  it("reportsNotConfiguredForAMissingRegistry", async () => {
    const reader = statusReader({ [LAUNCHPAD]: 0 });
    const status = await readStatus(reader, { address: WALLET, launchpad: LAUNCHPAD });
    expect(status.paused).toEqual({ launch: false, trade: false, bind: "not configured" });
  });

  it("reportsNotConfiguredForAMissingLaunchpad", async () => {
    const reader = statusReader({ [LAUNCHPAD]: ALL_PAUSED, [REGISTRY]: ALL_PAUSED });
    const status = await readStatus(reader, { address: WALLET, registry: REGISTRY });
    expect(status.paused).toEqual({ launch: "not configured", trade: "not configured", bind: true });
  });

  it("reportsAFailedReadPerSideWithoutAbortingStatus", async () => {
    const reader = statusReader({ [LAUNCHPAD]: new Error("rpc down"), [REGISTRY]: 0 });
    const status = await readStatus(reader, { address: WALLET, registry: REGISTRY, launchpad: LAUNCHPAD });
    const error = { error: expect.stringMatching(/launchpad\.pausedFlags\(\) read failed: rpc down/) };
    expect(status.paused).toEqual({ launch: error, trade: error, bind: false });
  });
});
