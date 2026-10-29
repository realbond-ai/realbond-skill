// A real viem client over a scripted transport: eth_call is decoded against the v2 ABIs and answered from
// `handlers`, so revert decoding runs through viem exactly as it would against a node.
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  type Abi,
  type Hex,
} from "viem";
import { bsc } from "viem/chains";
import launchpadAbi from "../../src/abi/launchpad.json" with { type: "json" };
import registryAbi from "../../src/abi/registry.json" with { type: "json" };
import taxTokenAbi from "../../src/abi/taxToken.json" with { type: "json" };
import type { ChainClient } from "../../src/chain.ts";

const ALL_ABI = [...launchpadAbi, ...registryAbi, ...taxTokenAbi] as Abi;
const EXECUTION_REVERTED_CODE = 3;

export type Revert = { revert: string };
export type Handler = unknown | Revert | ((args: readonly unknown[]) => unknown);
export type RpcCall = { functionName: string; to: string; from?: string; args: readonly unknown[] };

function isRevert(value: unknown): value is Revert {
  return typeof value === "object" && value !== null && "revert" in value;
}

function answer(functionName: string, handler: Handler, args: readonly unknown[]): Hex {
  const result = typeof handler === "function" ? (handler as (a: readonly unknown[]) => unknown)(args) : handler;
  if (isRevert(result)) {
    const data = encodeErrorResult({ abi: ALL_ABI, errorName: result.revert });
    throw Object.assign(new Error("execution reverted"), { code: EXECUTION_REVERTED_CODE, data });
  }
  return encodeFunctionResult({ abi: ALL_ABI, functionName, result } as Parameters<typeof encodeFunctionResult>[0]);
}

/** Client whose eth_call answers come from `handlers` keyed by function name; records every call. */
export function fakeRpc(handlers: Record<string, Handler>): { client: ChainClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const request = async ({ method, params }: { method: string; params?: unknown }) => {
    if (method !== "eth_call") throw new Error(`fakeRpc: unexpected method ${method}`);
    const [tx] = params as [{ to: string; from?: string; data: Hex }];
    const { functionName, args = [] } = decodeFunctionData({ abi: ALL_ABI, data: tx.data });
    calls.push({ functionName, to: tx.to, from: tx.from, args });
    if (!(functionName in handlers)) throw new Error(`fakeRpc: unexpected call ${functionName}`);
    return answer(functionName, handlers[functionName], args);
  };
  const client = createPublicClient({ chain: bsc, transport: custom({ request }, { retryCount: 0 }) });
  return { client, calls };
}
