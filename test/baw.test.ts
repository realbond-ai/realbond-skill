import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { confirmWith, PIPED_CONFIRM_WARNING, runContractCall, type ContractCall } from "../src/baw.ts";

async function confirmAnswer(answer: string, isTTY: boolean) {
  const input = Object.assign(new PassThrough(), { isTTY });
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk: Buffer) => {
    written += chunk.toString();
  });
  const result = confirmWith({ requestId: "req" }, { input, output });
  input.end(`${answer}\n`);
  return { isConfirmed: await result, written };
}

describe("confirmWith", () => {
  it("warnsOnStderrWhenTheAnswerComesFromAPipe", async () => {
    const { isConfirmed, written } = await confirmAnswer("y", false);
    expect(isConfirmed).toBe(true);
    expect(written).toContain(PIPED_CONFIRM_WARNING);
  });

  it("stillRequiresLiteralYFromAPipe", async () => {
    expect((await confirmAnswer("yes", false)).isConfirmed).toBe(false);
    expect((await confirmAnswer("", false)).isConfirmed).toBe(false);
  });

  it("doesNotWarnOnATerminal", async () => {
    const { isConfirmed, written } = await confirmAnswer("Y", true);
    expect(isConfirmed).toBe(true);
    expect(written).not.toContain(PIPED_CONFIRM_WARNING);
  });
});

const CALL: ContractCall = {
  from: "0xedBEDaF88ec96B8Aa4E6dF36de335b77C53cAAcd",
  to: "0x1111111111111111111111111111111111111111",
  data: "0xdeadbeef",
  value: 10100000000000000n,
};
const PREVIEW_OK = JSON.stringify({ success: true, data: { requestId: "req-42", risks: {} } });
const EXECUTE_OK = JSON.stringify({
  success: true,
  data: { orderId: "o-1", status: "BROADCASTED", txHash: "0xabc", message: null },
});

function scriptedExec(...outputs: string[]) {
  const queue = [...outputs];
  return vi.fn(async (_args: string[]) => {
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected extra baw call");
    return next;
  });
}

describe("runContractCall", () => {
  it("previews, asks for confirmation, then executes with the preview requestId", async () => {
    const exec = scriptedExec(PREVIEW_OK, EXECUTE_OK);
    const confirm = vi.fn(async () => true);
    const result = await runContractCall(CALL, exec, confirm);

    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0]?.[0]).toEqual([
      "contract-call", "preview",
      "--binanceChainId", "56",
      "--from", CALL.from,
      "--to", CALL.to,
      "--value", "10100000000000000",
      "--inputData", CALL.data,
      "--json",
    ]);
    expect(exec.mock.calls[1]?.[0]).toEqual(["contract-call", "execute", "--requestId", "req-42", "--json"]);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(exec.mock.invocationCallOrder[1] ?? 0);
    expect(result).toEqual({ txHash: "0xabc", status: "BROADCASTED" });
  });

  it("passes --gasLimit on preview only when the call carries one", async () => {
    const exec = scriptedExec(PREVIEW_OK, EXECUTE_OK);
    await runContractCall({ ...CALL, gasLimit: 3_500_000n }, exec, async () => true);
    const previewArgs = exec.mock.calls[0]?.[0] ?? [];
    expect(previewArgs.slice(-3)).toEqual(["--gasLimit", "3500000", "--json"]);
    expect(exec.mock.calls[1]?.[0]).not.toContain("--gasLimit");
  });

  it("does not execute when the user declines", async () => {
    const exec = scriptedExec(PREVIEW_OK);
    await expect(runContractCall(CALL, exec, async () => false)).rejects.toThrow(/declined/);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed preview with the baw error message", async () => {
    const failed = JSON.stringify({ success: false, error: { code: 351805, message: "execution reverted" } });
    const exec = scriptedExec(failed);
    const confirm = vi.fn(async () => true);
    await expect(runContractCall(CALL, exec, confirm)).rejects.toThrow(/preview failed.*execution reverted/);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("rejects a preview without a requestId", async () => {
    const exec = scriptedExec(JSON.stringify({ success: true, data: {} }));
    await expect(runContractCall(CALL, exec, async () => true)).rejects.toThrow(/requestId/);
  });

  it("returns a null txHash while the Binance App confirmation is pending", async () => {
    const pending = JSON.stringify({
      success: true,
      data: { orderId: "o-2", status: "PENDING_CONFIRMATION", txHash: null, message: "confirm in app" },
    });
    const exec = scriptedExec(PREVIEW_OK, pending);
    const result = await runContractCall(CALL, exec, async () => true);
    expect(result).toEqual({ txHash: null, status: "PENDING_CONFIRMATION" });
  });
});
