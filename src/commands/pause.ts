import type { Address } from "viem";
import launchpadAbi from "../abi/launchpad.json" with { type: "json" };
import registryAbi from "../abi/registry.json" with { type: "json" };
import { describeReadFailure, type ChainClient } from "../chain.ts";
import { requireClient, requireTarget, type Targets, type WriteContext } from "./context.ts";

// Mirrors AgentLaunchpad PAUSE_LAUNCH / PAUSE_TRADE and IdentityRegistry PAUSE_BIND (contracts/src).
export const PAUSE_LAUNCH = 1;
export const PAUSE_TRADE = 2;
export const PAUSE_BIND = 4;

export type PauseState = { launch: boolean; trade: boolean; bind: boolean };
export type PausableKind = "create" | "buy" | "sell" | "bind";
type Reader = Pick<ChainClient, "readContract">;

const FEATURE_OF: Record<PausableKind, keyof PauseState> = { create: "launch", buy: "trade", sell: "trade", bind: "bind" };

/** Only these writes are gated by an owner switch; tax commands never read the pause state. */
export function isPausable(kind: string): kind is PausableKind {
  return kind in FEATURE_OF;
}

async function readFlags(client: Reader, address: Address, contract: "launchpad" | "registry"): Promise<number> {
  const abi = contract === "launchpad" ? launchpadAbi : registryAbi;
  try {
    return Number(await client.readContract({ address, abi, functionName: "pausedFlags" }));
  } catch (error) {
    throw describeReadFailure(`${contract}.pausedFlags() read`, error);
  }
}

/** Pause bits of the configured contracts; a side whose address is not given is left out. Throws on a failed read. */
export async function readPause(client: Reader, targets: Targets): Promise<Partial<PauseState>> {
  const [launchpadFlags, registryFlags] = await Promise.all([
    targets.launchpad ? readFlags(client, targets.launchpad, "launchpad") : undefined,
    targets.registry ? readFlags(client, targets.registry, "registry") : undefined,
  ]);
  const pause: Partial<PauseState> = {};
  if (launchpadFlags !== undefined) {
    pause.launch = (launchpadFlags & PAUSE_LAUNCH) !== 0;
    pause.trade = (launchpadFlags & PAUSE_TRADE) !== 0;
  }
  if (registryFlags !== undefined) pause.bind = (registryFlags & PAUSE_BIND) !== 0;
  return pause;
}

/** Fails closed: an unread feature is treated as an error, never as open. */
export function assertNotPaused(kind: PausableKind, pause: Partial<PauseState>): void {
  const feature = FEATURE_OF[kind];
  const isPaused = pause[feature];
  if (isPaused === undefined) throw new Error(`${kind}: the ${feature} pause state was not read`);
  if (isPaused) throw new Error(`PLATFORM_PAUSED: ${feature} is paused by the platform owner`);
}

/** Reads only the contract that gates `kind` and throws PLATFORM_PAUSED (also under --dry-run) before any tx is built. */
export async function assertFeatureOpen(kind: PausableKind, ctx: WriteContext): Promise<void> {
  const client = requireClient(ctx, kind);
  const targets: Targets =
    kind === "bind"
      ? { registry: requireTarget(ctx.targets.registry, "LAUNCHPAD_REGISTRY") }
      : { launchpad: requireTarget(ctx.targets.launchpad, "LAUNCHPAD_ADDRESS") };
  assertNotPaused(kind, await readPause(client, targets));
}
