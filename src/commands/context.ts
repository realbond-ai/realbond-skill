import { readFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import type { ChainClient } from "../chain.ts";

export type Targets = { registry?: Address; launchpad?: Address };
export type TxRequest = { to: Address; data: Hex; value: bigint; gasLimit?: bigint };

/** Everything a write command may need; chain reads and the wallet are only required by commands that use them. */
export type WriteContext = {
  targets: Targets;
  wallet?: Address;
  client?: ChainClient;
  /** Milliseconds since epoch; injectable so the binding claim deadline check is testable. */
  now?: () => number;
  /** Human-facing notes (bind summary, refund warning); the CLI prints them to stderr. */
  notify?: (line: string) => void;
};

export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    throw new Error(`cannot read JSON file ${file}`, { cause });
  }
}

export function requireTarget(address: Address | undefined, envName: string): Address {
  if (!address) throw new Error(`${envName} is not set`);
  return address;
}

export function requireWallet(ctx: WriteContext, kind: string): Address {
  if (!ctx.wallet) throw new Error(`${kind} needs AGENT_WALLET`);
  return ctx.wallet;
}

export function requireClient(ctx: WriteContext, kind: string): ChainClient {
  if (!ctx.client) throw new Error(`${kind} needs RPC_URL for chain reads`);
  return ctx.client;
}

export function notify(ctx: WriteContext, line: string): void {
  ctx.notify?.(line);
}
