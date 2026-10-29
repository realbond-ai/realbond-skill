import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import type { Address, Hex } from "viem";

export const BSC_BINANCE_CHAIN_ID = "56";
const BAW_BINARY = "baw";
const BAW_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export type ContractCall = { from: Address; to: Address; data: Hex; value: bigint; gasLimit?: bigint };
export type BawExec = (args: string[]) => Promise<string>;
export type Confirm = (preview: unknown) => Promise<boolean>;
export type CallResult = { txHash: string | null; status: string };

type BawEnvelope = { success?: boolean; data?: Record<string, unknown>; error?: { code?: unknown; message?: unknown } };

export const defaultExec: BawExec = (args) =>
  new Promise((resolve, reject) => {
    execFile(BAW_BINARY, args, { maxBuffer: BAW_MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
      // baw reports failures as JSON on stdout with a non-zero exit; let the caller parse that.
      if (error && !stdout) {
        reject(new Error(`baw ${args.slice(0, 2).join(" ")} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });

export const PIPED_CONFIRM_WARNING =
  "warning: stdin is not a terminal; the confirmation is being read from a pipe, not typed by a human\n";

type ConfirmIo = { input: NodeJS.ReadableStream & { isTTY?: boolean }; output: NodeJS.WritableStream };

/** Prints the preview and accepts only a literal "y"; warns when the answer comes from a pipe. */
export async function confirmWith(preview: unknown, io: ConfirmIo): Promise<boolean> {
  io.output.write(`${JSON.stringify(preview, null, 2)}\n`);
  // A piped "y" (e.g. `yes | cli buy ...`) bypasses the human checkpoint; still allowed, but loudly.
  if (!io.input.isTTY) io.output.write(PIPED_CONFIRM_WARNING);
  const rl = createInterface({ input: io.input, output: io.output });
  try {
    const answer = await rl.question("Execute this transaction? [y/N] ");
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

export const defaultConfirm: Confirm = (preview) =>
  confirmWith(preview, { input: process.stdin, output: process.stderr });

function previewArgs(call: ContractCall): string[] {
  const args = [
    "contract-call", "preview",
    "--binanceChainId", BSC_BINANCE_CHAIN_ID,
    "--from", call.from,
    "--to", call.to,
    "--value", call.value.toString(),
    "--inputData", call.data,
  ];
  if (call.gasLimit !== undefined) args.push("--gasLimit", call.gasLimit.toString());
  args.push("--json");
  return args;
}

function parseEnvelope(step: string, stdout: string): Record<string, unknown> {
  let envelope: BawEnvelope;
  try {
    envelope = JSON.parse(stdout) as BawEnvelope;
  } catch (cause) {
    throw new Error(`baw ${step} returned non-JSON output: ${stdout.slice(0, 200)}`, { cause });
  }
  if (!envelope.success || !envelope.data) {
    const detail = envelope.error ? `${envelope.error.code}: ${envelope.error.message}` : stdout.slice(0, 200);
    throw new Error(`baw ${step} failed: ${detail}`);
  }
  return envelope.data;
}

/** preview -> human confirmation -> execute. Never executes without an explicit "y". */
export async function runContractCall(
  call: ContractCall,
  exec: BawExec = defaultExec,
  confirm: Confirm = defaultConfirm,
): Promise<CallResult> {
  const preview = parseEnvelope("preview", await exec(previewArgs(call)));
  const requestId = preview.requestId;
  if (typeof requestId !== "string" || requestId === "") {
    throw new Error(`baw preview returned no requestId for call to ${call.to}`);
  }
  if (!(await confirm(preview))) throw new Error(`user declined execution of preview ${requestId}`);

  const executed = parseEnvelope("execute", await exec(["contract-call", "execute", "--requestId", requestId, "--json"]));
  const txHash = typeof executed.txHash === "string" ? executed.txHash : null;
  return { txHash, status: String(executed.status ?? "UNKNOWN") };
}
