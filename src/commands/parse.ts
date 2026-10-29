import { parseArgs } from "node:util";
import { isAddress, parseEther, type Address } from "viem";

const UINT_PATTERN = /^\d+$/;
const ALL_KEYWORD = "all";

export type TaxCommandKind = "process-tax" | "claim-dividend";

export type Command =
  | { kind: "status"; address?: Address }
  | { kind: "position"; id: bigint }
  | { kind: "bind" | "create"; file: string }
  | { kind: "buy"; id: bigint; netWei: bigint; minTokens?: bigint }
  | { kind: "sell"; id: bigint; tokens: bigint | "all"; minBnb?: bigint }
  | { kind: TaxCommandKind; id: bigint };

export type ParsedCommand = Command & { dryRun: boolean };
type RawFlags = { "min-tokens"?: string; "min-bnb"?: string };

const USAGE: Record<string, string> = {
  status: "status [address]",
  position: "position <id>",
  bind: "bind <binding.json>",
  create: "create <ticket.json>",
  buy: "buy <id> <netBnb> [--min-tokens <wei>]",
  sell: "sell <id> <amount|all> [--min-bnb <wei>]",
  "process-tax": "process-tax <id>",
  "claim-dividend": "claim-dividend <id>",
};

// v1 commands: the bonding curve has no deadline, refunds or separate graduation (spec §3.7).
const REMOVED_COMMANDS: Record<string, string> = {
  register: "register was removed in v2, use bind <binding.json>",
  claim: "claim was removed in v2: tokens arrive with every buy",
  refund: "refund was removed in v2: exit by selling back to the curve",
  graduate: "graduate was removed in v2: the buy that reaches 15 BNB graduates",
  "update-salt": "update-salt was removed in v2",
  "update-salt-and-graduate": "update-salt-and-graduate was removed in v2",
  "claim-creator-fee": "claim-creator-fee was removed: the creator receives 0% of the tax",
};

// Each slippage flag belongs to exactly one command; elsewhere it would be silently ignored.
const FLAG_OWNERS: Record<keyof RawFlags, string> = { "min-tokens": "buy", "min-bnb": "sell" };

export const USAGE_TEXT = Object.values(USAGE).map((line) => `  ${line}`).join("\n");

function parseUint(raw: string | undefined, label: string): bigint {
  if (raw === undefined || !UINT_PATTERN.test(raw)) throw new Error(`invalid ${label}: ${raw ?? "(missing)"}`);
  return BigInt(raw);
}

function parseOptionalUint(raw: string | undefined, label: string): bigint | undefined {
  return raw === undefined ? undefined : parseUint(raw, label);
}

/** Decimal amount with 18 decimals (BNB or launch tokens); must be > 0. */
function parseDecimal18(raw: string, label: string): bigint {
  let wei: bigint;
  try {
    wei = parseEther(raw);
  } catch (cause) {
    throw new Error(`invalid ${label}: ${raw}`, { cause });
  }
  if (Number.isNaN(Number(raw)) || wei <= 0n) throw new Error(`invalid ${label}: ${raw} (must be > 0)`);
  return wei;
}

function parseSellAmount(raw: string): bigint | "all" {
  return raw.toLowerCase() === ALL_KEYWORD ? ALL_KEYWORD : parseDecimal18(raw, "token amount");
}

function requireArity(kind: string, args: string[], min: number, max = min): void {
  if (args.length < min || args.length > max) throw new Error(`usage: ${USAGE[kind]}`);
}

function parseStatus(args: string[]): Command {
  requireArity("status", args, 0, 1);
  const [address] = args;
  if (address === undefined) return { kind: "status" };
  if (!isAddress(address)) throw new Error(`invalid address: ${address}`);
  return { kind: "status", address };
}

function assertFlagScope(kind: string, raw: RawFlags): void {
  for (const [flag, owner] of Object.entries(FLAG_OWNERS) as [keyof RawFlags, string][]) {
    if (raw[flag] !== undefined && kind !== owner) throw new Error(`--${flag} is only valid for ${owner}, not ${kind}`);
  }
}

function buildCommand(kind: string, args: string[], flags: RawFlags): Command {
  const removed = REMOVED_COMMANDS[kind];
  if (removed) throw new Error(removed);
  switch (kind) {
    case "status":
      return parseStatus(args);
    case "bind":
    case "create":
      requireArity(kind, args, 1);
      return { kind, file: args[0] as string };
    case "buy":
      requireArity(kind, args, 2);
      return {
        kind,
        id: parseUint(args[0], "launch id"),
        netWei: parseDecimal18(args[1] as string, "BNB amount"),
        minTokens: parseOptionalUint(flags["min-tokens"], "--min-tokens"),
      };
    case "sell":
      requireArity(kind, args, 2);
      return {
        kind,
        id: parseUint(args[0], "launch id"),
        tokens: parseSellAmount(args[1] as string),
        minBnb: parseOptionalUint(flags["min-bnb"], "--min-bnb"),
      };
    case "position":
    case "process-tax":
    case "claim-dividend":
      requireArity(kind, args, 1);
      return { kind, id: parseUint(args[0], "launch id") };
    default:
      throw new Error(`unknown command: ${kind || "(none)"}\nusage:\n${USAGE_TEXT}`);
  }
}

export function parseCommand(argv: string[]): ParsedCommand {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      "min-tokens": { type: "string" },
      "min-bnb": { type: "string" },
    },
  });
  const [kind = "", ...args] = positionals;
  assertFlagScope(kind, values);
  return { ...buildCommand(kind, args, values), dryRun: values["dry-run"] };
}
