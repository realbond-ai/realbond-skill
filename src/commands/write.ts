import { runContractCall, type BawExec, type CallResult, type Confirm } from "../baw.ts";
import { encodeCreateLaunch, type Ticket } from "../calldata.ts";
import { validateTicket } from "../ticket.ts";
import { buildBindTx } from "./bind.ts";
import { readJson, requireTarget, requireWallet, type TxRequest, type WriteContext } from "./context.ts";
import type { Command, ParsedCommand } from "./parse.ts";
import { assertFeatureOpen, isPausable } from "./pause.ts";
import { buildTaxTx } from "./tax.ts";
import { buildBuyTx, buildSellTx } from "./trade.ts";

export { BIND_GAS_LIMIT } from "./bind.ts";
export { BUY_GAS_LIMIT } from "./trade.ts";
export type { Targets, TxRequest, WriteContext } from "./context.ts";

export type WriteCommand = Exclude<Command, { kind: "status" | "position" }>;

function readTicket(file: string): Ticket {
  const raw = readJson(file);
  try {
    return validateTicket(raw);
  } catch (cause) {
    throw new Error(`ticket ${file}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/** Builds the transaction for a write command, running the chain reads and local checks it needs first. */
export async function buildTx(cmd: Command, ctx: WriteContext): Promise<TxRequest> {
  switch (cmd.kind) {
    case "status":
    case "position":
      throw new Error(`${cmd.kind} is a read-only command`);
    case "bind":
      return buildBindTx(cmd.file, ctx);
    case "create": {
      const to = requireTarget(ctx.targets.launchpad, "LAUNCHPAD_ADDRESS");
      return { to, data: encodeCreateLaunch(readTicket(cmd.file)), value: 0n };
    }
    case "buy":
      return buildBuyTx(cmd, ctx);
    case "sell":
      return buildSellTx(cmd, ctx);
    default:
      return buildTaxTx(cmd, ctx);
  }
}

export function dryRunJson(tx: TxRequest): string {
  const gasLimit = tx.gasLimit === undefined ? null : tx.gasLimit.toString();
  return JSON.stringify({ to: tx.to, data: tx.data, value: tx.value.toString(), gasLimit }, null, 2);
}

export type BawDeps = { exec?: BawExec; confirm?: Confirm };

/**
 * Owner pause check (create/buy/sell/bind only) -> build; dry run prints the transaction, otherwise
 * baw preview -> human confirmation -> execute.
 */
export async function runWrite(cmd: ParsedCommand, ctx: WriteContext, baw: BawDeps = {}): Promise<string> {
  if (isPausable(cmd.kind)) await assertFeatureOpen(cmd.kind, ctx);
  const tx = await buildTx(cmd, ctx);
  if (cmd.dryRun) return dryRunJson(tx);
  const from = requireWallet(ctx, `${cmd.kind} (baw preview needs --from)`);
  const result: CallResult = await runContractCall({ ...tx, from }, baw.exec, baw.confirm);
  return JSON.stringify(result, null, 2);
}
