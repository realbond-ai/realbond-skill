import { isAddressEqual, type Address } from "viem";
import registryAbi from "../abi/registry.json" with { type: "json" };
import { BSC_BINANCE_CHAIN_ID } from "../baw.ts";
import { FOLLOWER_TIER_THRESHOLDS, parseBindingFile, recoverClaimSigner, type BindingFile } from "../bindingClaim.ts";
import { encodeBind } from "../calldata.ts";
import { describeReadFailure, type ChainClient } from "../chain.ts";
import { simulateBind } from "../simulate.ts";
import { notify, readJson, requireClient, requireTarget, requireWallet, type TxRequest, type WriteContext } from "./context.ts";

// Fixed cap (spec §3.2): >= 1.5x the fork-measured bind gas, so the estimate never under-shoots signature recovery.
export const BIND_GAS_LIMIT = 400_000n;
// Leaves time for the human confirmation and inclusion before the claim deadline; the web uses the same floor.
export const MIN_SUBMIT_SECONDS = 120;

const BSC_CHAIN_ID = Number(BSC_BINANCE_CHAIN_ID);
const MS_PER_SECOND = 1000;

export function readBindingFile(file: string): BindingFile {
  const raw = readJson(file);
  try {
    return parseBindingFile(raw);
  } catch (cause) {
    throw new Error(`binding ${file}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/** Seconds are compared whole: `deadline - floor(now / 1000) < 120` is rejected. */
function assertDeadline(deadline: bigint, nowMs: number): void {
  const remaining = Number(deadline) - Math.floor(nowMs / MS_PER_SECOND);
  if (remaining >= MIN_SUBMIT_SECONDS) return;
  const shown = Math.max(0, remaining);
  throw new Error(
    `binding claim expires in ${shown}s (needs at least ${MIN_SUBMIT_SECONDS}s); authorize X again on the Verify page`,
  );
}

type CheckInput = { wallet: Address; registry: Address; nowMs: number };

/** Local pre-flight that needs no chain read: submitter, chain, registry and deadline. */
export function checkBindingFile(file: BindingFile, input: CheckInput): void {
  if (!isAddressEqual(file.claim.agent, input.wallet)) {
    throw new Error(`claim.agent ${file.claim.agent} does not match AGENT_WALLET ${input.wallet}`);
  }
  if (file.chainId !== BSC_CHAIN_ID) throw new Error(`binding claim is for chainId ${file.chainId}, expected ${BSC_CHAIN_ID}`);
  if (!isAddressEqual(file.registry, input.registry)) {
    throw new Error(`binding claim registry ${file.registry} does not match LAUNCHPAD_REGISTRY ${input.registry}`);
  }
  assertDeadline(file.claim.deadline, input.nowMs);
}

type SignerTarget = { client: ChainClient; registry: Address };

async function readChainSigner(target: SignerTarget): Promise<Address> {
  try {
    return (await target.client.readContract({ address: target.registry, abi: registryAbi, functionName: "signer" })) as Address;
  } catch (error) {
    throw describeReadFailure("registry.signer() read", error);
  }
}

/** The registry reverts BadSignature unless the claim was signed by its current signer(). */
export async function assertChainSigner(file: BindingFile, target: SignerTarget): Promise<void> {
  const chainSigner = await readChainSigner(target);
  const claimSigner = await recoverClaimSigner(file);
  if (!isAddressEqual(claimSigner, chainSigner)) {
    throw new Error(`binding claim was signed by ${claimSigner} but registry.signer() is ${chainSigner}`);
  }
}

/** One-line summary; a hidden binding never prints the screen name. */
export function bindNotice(file: BindingFile): string {
  const { claim } = file;
  const visibility = claim.isPublic ? `public (@${claim.screenName})` : "hidden (screen name not stored on chain)";
  const threshold = FOLLOWER_TIER_THRESHOLDS[claim.followerTier];
  return (
    `binding: ${visibility}, follower tier ${claim.followerTier} (>= ${threshold} followers at authorization), ` +
    `X verified: ${claim.isBlueVerified ? "yes" : "no"}. Visibility and tier cannot be changed after bind.`
  );
}

export async function buildBindTx(path: string, ctx: WriteContext): Promise<TxRequest> {
  const wallet = requireWallet(ctx, "bind");
  const registry = requireTarget(ctx.targets.registry, "LAUNCHPAD_REGISTRY");
  const client = requireClient(ctx, "bind");
  const file = readBindingFile(path);
  checkBindingFile(file, { wallet, registry, nowMs: (ctx.now ?? Date.now)() });
  await assertChainSigner(file, { client, registry });
  notify(ctx, bindNotice(file));
  await simulateBind(file, wallet, { client, registry });
  return { to: registry, data: encodeBind(file), value: 0n, gasLimit: BIND_GAS_LIMIT };
}
