import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { bsc } from "viem/chains";
import launchpadAbi from "./abi/launchpad.json" with { type: "json" };
import taxTokenAbi from "./abi/taxToken.json" with { type: "json" };

/** The read surface the CLI needs; a viem PublicClient satisfies it, tests pass a scripted transport. */
export type ChainClient = Pick<PublicClient, "readContract" | "simulateContract">;

// Mirrors AgentLaunchpad.Status (contracts/src/LaunchpadStorage.sol).
export const STATUS_LABELS = ["Live", "Graduated"] as const;
export const STATUS_GRADUATED = 1;

export type LaunchInfo = { id: bigint; status: number; taxed: boolean; token: Address; creator: Address };

export function createChainClient(rpcUrl: string): ChainClient {
  return createPublicClient({ chain: bsc, transport: http(rpcUrl) }) as ChainClient;
}

export function statusLabel(status: number): string {
  return STATUS_LABELS[status] ?? `Unknown(${status})`;
}

/** Custom error name of a reverted contract call, or undefined when the failure is not a decoded revert. */
export function revertErrorName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
}

/** Rethrows a contract read failure as `<label> reverted: <ErrorName>` when it is a decoded revert. */
export function describeReadFailure(label: string, error: unknown): Error {
  const name = revertErrorName(error);
  if (name) return new Error(`${label} reverted: ${name}`, { cause: error });
  const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
  return new Error(`${label} failed: ${reason}`, { cause: error });
}

type LaunchTarget = { client: ChainClient; launchpad: Address; id: bigint };

export function readLaunchpad(target: Omit<LaunchTarget, "id">, functionName: string, args: readonly unknown[] = []) {
  return target.client.readContract({ address: target.launchpad, abi: launchpadAbi, functionName, args });
}

export function readTaxToken(client: ChainClient, token: Address, functionName: string, args: readonly unknown[] = []) {
  return client.readContract({ address: token, abi: taxTokenAbi, functionName, args });
}

/**
 * Reads launch `id`, proving it exists with `id < nextId()`: statusOf and launches return a zeroed Live
 * record for unknown ids, so they cannot be trusted alone.
 */
export async function readLaunch(target: LaunchTarget): Promise<LaunchInfo> {
  const nextId = (await readLaunchpad(target, "nextId")) as bigint;
  if (target.id >= nextId) throw new Error(`launch ${target.id} does not exist (nextId is ${nextId})`);
  const launch = (await readLaunchpad(target, "launches", [target.id])) as {
    creator: Address;
    status: number;
    taxed: boolean;
    token: Address;
  };
  return { id: target.id, status: Number(launch.status), taxed: launch.taxed, token: launch.token, creator: launch.creator };
}

/** ERC-20 balance; plain and tax tokens share balanceOf, so the tax-token ABI reads both. */
export async function readTokenBalance(client: ChainClient, token: Address, account: Address): Promise<bigint> {
  return (await readTaxToken(client, token, "balanceOf", [account])) as bigint;
}
