import type { Address } from "viem";
import registryAbi from "./abi/registry.json" with { type: "json" };
import type { BindingFile } from "./bindingClaim.ts";
import { describeReadFailure, type ChainClient } from "./chain.ts";

export type SimulateTarget = { client: ChainClient; registry: Address };

/**
 * eth_call dry run of registry.bind(claim, signature) from `wallet`. A revert (AlreadyBound, XAlreadyBound,
 * BadSignature, ClaimExpired, ...) throws with the decoded error name so nothing is sent to baw.
 */
export async function simulateBind(file: BindingFile, wallet: Address, target: SimulateTarget): Promise<void> {
  try {
    await target.client.simulateContract({
      address: target.registry,
      abi: registryAbi,
      functionName: "bind",
      args: [file.claim, file.signature],
      account: wallet,
    });
  } catch (error) {
    throw describeReadFailure("bind simulation", error);
  }
}
