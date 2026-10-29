import { decodeFunctionData, toFunctionSelector, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import registryAbi from "../src/abi/registry.json" with { type: "json" };
import { parseCommand } from "../src/commands/parse.ts";
import { BIND_GAS_LIMIT, buildTx, runWrite, type WriteContext } from "../src/commands/write.ts";
import { FIXTURE_SIGNER, PUBLIC_FILE, PUBLIC_JSON, signedFile, writeBindingFile } from "./helpers/claimFixture.ts";
import { writeJsonFile } from "./helpers/files.ts";
import { fakeRpc, type Handler } from "./helpers/fakeRpc.ts";

const REGISTRY = PUBLIC_FILE.registry;
const WALLET = PUBLIC_FILE.claim.agent;
const OTHER: Address = "0x1111111111111111111111111111111111111111";
const DEADLINE_MS = Number(PUBLIC_FILE.claim.deadline) * 1000;
const TEN_MINUTES_MS = 600_000;
const OTHER_PRIVATE_KEY = "0x0000000000000000000000000000000000000000000000000000000000000B0B";
const BIND_SELECTOR = toFunctionSelector("bind((address,bytes32,bool,string,uint8,bool,uint64),bytes)");
const PUBLIC_PATH = writeJsonFile(PUBLIC_JSON);
const PREVIEW = JSON.stringify({ success: true, data: { requestId: "req-1" } });
const EXECUTED = JSON.stringify({ success: true, data: { txHash: "0xabc", status: "SUCCESS" } });

function context(handlers: Record<string, Handler> = {}, overrides: Partial<WriteContext> = {}) {
  const rpc = fakeRpc({ pausedFlags: 0, signer: FIXTURE_SIGNER, bind: [], ...handlers });
  const notes: string[] = [];
  const ctx: WriteContext = {
    targets: { registry: REGISTRY },
    wallet: WALLET,
    client: rpc.client,
    now: () => DEADLINE_MS - TEN_MINUTES_MS,
    notify: (line) => notes.push(line),
    ...overrides,
  };
  return { ctx, notes, calls: rpc.calls };
}

const bindArgv = (file: string) => parseCommand(["bind", file]);

function bawFakes() {
  const exec = vi.fn(async (args: string[]) => (args[1] === "preview" ? PREVIEW : EXECUTED));
  const confirm = vi.fn(async () => true);
  return { exec, confirm };
}

async function expectRejectedBeforeBaw(file: string, ctx: WriteContext, pattern: RegExp) {
  const baw = bawFakes();
  await expect(runWrite(bindArgv(file), ctx, baw)).rejects.toThrow(pattern);
  expect(baw.exec).not.toHaveBeenCalled();
  expect(baw.confirm).not.toHaveBeenCalled();
}

const bindCalls = (calls: { functionName: string }[]) => calls.filter((call) => call.functionName === "bind");
// runWrite reads the registry pause bit first; local checks must stop before any other chain read.
const afterPauseRead = (calls: { functionName: string }[]) => calls.filter((call) => call.functionName !== "pausedFlags");

describe("bind success path", () => {
  it("checksTheSignerSimulatesFromTheWalletThenBuildsTheRegistryTxWithTheBindGasCap", async () => {
    const { ctx, calls } = context();
    const tx = await buildTx(bindArgv(PUBLIC_PATH), ctx);
    expect(tx).toMatchObject({ to: REGISTRY, value: 0n, gasLimit: 400_000n });
    expect(BIND_GAS_LIMIT).toBe(400_000n);
    expect(tx.data.slice(0, 10)).toBe(BIND_SELECTOR);
    const { functionName, args } = decodeFunctionData({ abi: registryAbi, data: tx.data });
    expect(functionName).toBe("bind");
    expect(args?.[1]).toBe(PUBLIC_FILE.signature);
    expect(calls.map((call) => call.functionName)).toEqual(["signer", "bind"]);
    expect(calls[1]?.from?.toLowerCase()).toBe(WALLET.toLowerCase());
  });

  it("printsVisibilityTierXVerifiedAndThatItCannotBeChanged", async () => {
    const { ctx, notes } = context();
    await buildTx(bindArgv(PUBLIC_PATH), ctx);
    const text = notes.join("\n");
    expect(text).toMatch(/public \(@Realbond_Test\)/);
    expect(text).toMatch(/follower tier 3 \(>= 10000 followers/);
    expect(text).toMatch(/X verified: yes/);
    expect(text).toMatch(/cannot be changed/);
  });

  it("neverPrintsAHandleForAHiddenClaim", async () => {
    const hidden = await signedFile({ claim: { isPublic: false, screenName: "", isBlueVerified: false } });
    const { ctx, notes } = context();
    await buildTx(bindArgv(writeBindingFile(hidden)), ctx);
    const text = notes.join("\n");
    expect(text).toMatch(/hidden/);
    expect(text).toMatch(/X verified: no/);
    expect(text).not.toMatch(/Realbond_Test|@/);
  });

  it("sendsTheBindThroughBawWithGasLimit400000", async () => {
    const { ctx } = context();
    const baw = bawFakes();
    await runWrite(bindArgv(PUBLIC_PATH), ctx, baw);
    const previewArgs = baw.exec.mock.calls[0]?.[0] ?? [];
    expect(previewArgs).toEqual(expect.arrayContaining(["--to", REGISTRY, "--from", WALLET]));
    expect(previewArgs.slice(-3)).toEqual(["--gasLimit", "400000", "--json"]);
    expect(baw.exec).toHaveBeenCalledTimes(2);
  });
});

describe("bind deadline", () => {
  it("rejects119SecondsLeft", async () => {
    const { ctx, calls } = context({}, { now: () => DEADLINE_MS - 119_000 });
    await expectRejectedBeforeBaw(PUBLIC_PATH, ctx, /expires in 119s \(needs at least 120s\)/);
    expect(afterPauseRead(calls)).toHaveLength(0);
  });

  it("accepts120SecondsLeftComparingWholeSeconds", async () => {
    const { ctx } = context({}, { now: () => DEADLINE_MS - 120_000 + 999 });
    await expect(buildTx(bindArgv(PUBLIC_PATH), ctx)).resolves.toMatchObject({ to: REGISTRY });
  });

  it("reportsZeroSecondsForAnExpiredClaim", async () => {
    const { ctx } = context({}, { now: () => DEADLINE_MS + TEN_MINUTES_MS });
    await expectRejectedBeforeBaw(PUBLIC_PATH, ctx, /expires in 0s/);
  });
});

describe("bind local checks exit before baw", () => {
  it("rejectsAClaimForAnotherWallet", async () => {
    const { ctx, calls } = context({}, { wallet: OTHER });
    await expectRejectedBeforeBaw(PUBLIC_PATH, ctx, /claim\.agent .* does not match AGENT_WALLET/);
    expect(afterPauseRead(calls)).toHaveLength(0);
  });

  it("rejectsAClaimForAnotherChain", async () => {
    const file = writeBindingFile(await signedFile({ chainId: 97 }));
    const { ctx, calls } = context();
    await expectRejectedBeforeBaw(file, ctx, /chainId 97, expected 56/);
    expect(afterPauseRead(calls)).toHaveLength(0);
  });

  it("rejectsAClaimForAnotherRegistry", async () => {
    const { ctx, calls } = context({}, { targets: { registry: OTHER } });
    await expectRejectedBeforeBaw(PUBLIC_PATH, ctx, /registry .* does not match LAUNCHPAD_REGISTRY/);
    expect(afterPauseRead(calls)).toHaveLength(0);
  });

  it("rejectsWhenTheChainSignerDiffers", async () => {
    const { ctx, calls } = context({ signer: OTHER });
    await expectRejectedBeforeBaw(PUBLIC_PATH, ctx, /signed by 0x.* registry\.signer\(\) is 0x1111/);
    expect(bindCalls(calls)).toHaveLength(0);
  });

  it("rejectsAClaimSignedByAnotherKey", async () => {
    const file = writeBindingFile(await signedFile({ privateKey: OTHER_PRIVATE_KEY }));
    const { ctx, calls } = context();
    await expectRejectedBeforeBaw(file, ctx, /registry\.signer\(\)/);
    expect(bindCalls(calls)).toHaveLength(0);
  });

  it.each(["AlreadyBound", "XAlreadyBound", "BadSignature"])("throwsTheDecodedRevert%s", async (errorName) => {
    const { ctx } = context({ bind: { revert: errorName } });
    await expectRejectedBeforeBaw(PUBLIC_PATH, ctx, new RegExp(`bind simulation reverted: ${errorName}$`));
  });

  it("rejectsAMalformedFileWithTheFieldName", async () => {
    const broken = { ...PUBLIC_JSON, claim: { ...PUBLIC_JSON.claim, isPublic: false } };
    const { ctx, calls } = context();
    await expectRejectedBeforeBaw(writeJsonFile(broken), ctx, /binding .*: binding file has an invalid claim\.screenName/);
    expect(afterPauseRead(calls)).toHaveLength(0);
  });

  it("needsAnRpcToCheckTheSigner", async () => {
    const { ctx } = context({}, { client: undefined });
    await expectRejectedBeforeBaw(PUBLIC_PATH, ctx, /bind needs RPC_URL/);
  });
});
