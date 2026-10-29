import { parseAbi, zeroHash, type Address, type Hex } from "viem";
import registryAbi from "../abi/registry.json" with { type: "json" };
import type { ChainClient } from "../chain.ts";
import { FOLLOWER_TIER_THRESHOLDS } from "../bindingClaim.ts";
import type { Config } from "../config.ts";
import { readPause, type PauseState } from "./pause.ts";

export const AGENT_ID_ADDRESS: Address = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const AGENT_ID_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function handleOf(address owner) view returns (string)",
]);

type Settled<T> = T | { error: string };
export type StatusInput = { address: Address; registry?: Address; launchpad?: Address };

const NOT_CONFIGURED = "not configured";
type Reader = Pick<ChainClient, "readContract">;
type RawBinding = {
  xId: Hex;
  isPublic: boolean;
  isBlueVerified: boolean;
  followerTier: number;
  boundAt: bigint;
  screenName: string;
};

// A failed read (e.g. handleOf reverting for an address without an Agent ID) is reported
// in the output instead of aborting the whole status call.
async function settle<T>(read: Promise<T>): Promise<Settled<T>> {
  try {
    return await read;
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { error: message ?? "unknown error" };
  }
}

async function readAgentId(client: Reader, address: Address) {
  const read = (functionName: "balanceOf" | "handleOf") =>
    client.readContract({ address: AGENT_ID_ADDRESS, abi: AGENT_ID_ABI, functionName, args: [address] });
  const [balance, handle] = await Promise.all([settle(read("balanceOf")), settle(read("handleOf"))]);
  return { contract: AGENT_ID_ADDRESS, balance: typeof balance === "bigint" ? balance.toString() : balance, handle };
}

/** Public summary of a binding; a hidden binding carries no screenName field at all. */
export function describeBinding(binding: RawBinding): Record<string, unknown> {
  if (binding.xId === zeroHash) return { isBound: false };
  const tier = Number(binding.followerTier);
  const summary: Record<string, unknown> = {
    isBound: true,
    xId: binding.xId,
    isPublic: binding.isPublic,
    followerTier: tier,
    followerThresholdAtBinding: (FOLLOWER_TIER_THRESHOLDS as readonly number[])[tier] ?? null,
    isBlueVerified: binding.isBlueVerified,
    boundAt: Number(binding.boundAt),
  };
  if (binding.isPublic) summary.screenName = binding.screenName;
  return summary;
}

async function readRegistry(client: Reader, registry: Address, address: Address) {
  const read = (functionName: "isEligible" | "bindingOf") =>
    client.readContract({ address: registry, abi: registryAbi, functionName, args: [address] });
  const [eligible, binding] = await Promise.all([settle(read("isEligible")), settle(read("bindingOf"))]);
  const isFailed = typeof binding === "object" && binding !== null && "error" in binding;
  return { address: registry, isEligible: eligible, binding: isFailed ? binding : describeBinding(binding as RawBinding) };
}

/** Status reads both contracts: the registry for the binding and bind pause, the launchpad for launch/trade pause. */
export function statusInput(address: Address, config: Config): StatusInput {
  return { address, registry: config.registry, launchpad: config.launchpad };
}

type PauseSide = Settled<Partial<PauseState>> | typeof NOT_CONFIGURED;

function pauseField(side: PauseSide, feature: keyof PauseState): Settled<boolean> | typeof NOT_CONFIGURED {
  if (typeof side === "string" || "error" in side) return side;
  return side[feature] ?? NOT_CONFIGURED;
}

// Each side is read on its own so one unset or failing contract does not hide the other's switches.
async function readPaused(client: Reader, input: StatusInput) {
  const [launchpad, registry]: [PauseSide, PauseSide] = await Promise.all([
    input.launchpad ? settle(readPause(client, { launchpad: input.launchpad })) : NOT_CONFIGURED,
    input.registry ? settle(readPause(client, { registry: input.registry })) : NOT_CONFIGURED,
  ]);
  return {
    launch: pauseField(launchpad, "launch"),
    trade: pauseField(launchpad, "trade"),
    bind: pauseField(registry, "bind"),
  };
}

export async function readStatus(client: Reader, input: StatusInput): Promise<Record<string, unknown>> {
  const [agentId, registry, paused] = await Promise.all([
    readAgentId(client, input.address),
    input.registry ? readRegistry(client, input.registry, input.address) : Promise.resolve(NOT_CONFIGURED),
    readPaused(client, input),
  ]);
  return { address: input.address, agentId, registry, paused };
}
