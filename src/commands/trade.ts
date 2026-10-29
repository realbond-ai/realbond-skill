import { formatEther, type Address } from "viem";
import { encodeBuy, encodeSell } from "../calldata.ts";
import { describeReadFailure, readIsEligible, readLaunch, readLaunchpad, readTokenBalance, type ChainClient } from "../chain.ts";
import { grossForNet, minOutForQuote } from "../fee.ts";
import type { Command } from "./parse.ts";
import { notify, requireClient, requireTarget, requireWallet, type TxRequest, type WriteContext } from "./context.ts";

// Any buy may be the one that reaches 15 BNB and graduates into PancakeSwap in the same transaction
// (spec §3.7: >= fork-measured graduation gas x 1.15); it is a cap, only used gas is charged.
export const BUY_GAS_LIMIT = 7_000_000n;

type BuyCommand = Extract<Command, { kind: "buy" }>;
type SellCommand = Extract<Command, { kind: "sell" }>;
type Reads = { client: ChainClient; launchpad: Address; wallet: Address };

function readsFor(ctx: WriteContext, kind: string): Reads {
  return {
    client: requireClient(ctx, kind),
    launchpad: requireTarget(ctx.targets.launchpad, "LAUNCHPAD_ADDRESS"),
    wallet: requireWallet(ctx, kind),
  };
}

/**
 * quoteBuy runs before every buy (spec §3.7): it fails early on WrongStatus / WalletCapReached / BuyTooSmall and
 * reveals the refund. An explicit --min-tokens only replaces the computed 99% bound.
 */
async function resolveMinTokens(cmd: BuyCommand, gross: bigint, ctx: WriteContext): Promise<bigint> {
  const reads = readsFor(ctx, "buy");
  let quote: readonly [bigint, bigint, bigint];
  try {
    quote = (await readLaunchpad(reads, "quoteBuy", [cmd.id, reads.wallet, gross])) as readonly [bigint, bigint, bigint];
  } catch (error) {
    throw describeReadFailure(`quoteBuy for launch ${cmd.id}`, error);
  }
  const [tokens, , refund] = quote;
  if (refund > 0n) {
    notify(ctx, `${formatEther(refund)} BNB exceeds the wallet cap or the 15 BNB target and will be refunded`);
  }
  if (cmd.minTokens === undefined) return minOutForQuote(tokens);
  if (cmd.minTokens > tokens) {
    notify(ctx, `warning: --min-tokens ${cmd.minTokens} is above the current quote ${tokens}; the buy will revert with Slippage`);
  }
  return cmd.minTokens;
}

/**
 * Buying is the one gated action (anyone may create a launch, any holder may sell): an ineligible wallet would
 * only revert with NotEligible, so stop before quoting. The registry comes from the launchpad itself.
 */
async function assertCanBuy(ctx: WriteContext): Promise<void> {
  const reads = readsFor(ctx, "buy");
  let isEligible: boolean;
  try {
    isEligible = await readIsEligible(reads.client, reads.launchpad, reads.wallet);
  } catch (error) {
    throw describeReadFailure("registry.isEligible for AGENT_WALLET", error);
  }
  if (!isEligible) {
    throw new Error(
      `NOT_ELIGIBLE: ${reads.wallet} cannot buy; buying requires an Agent ID and an X binding (run status). Creating a launch and selling do not.`,
    );
  }
}

export async function buildBuyTx(cmd: BuyCommand, ctx: WriteContext): Promise<TxRequest> {
  const launchpad = requireTarget(ctx.targets.launchpad, "LAUNCHPAD_ADDRESS");
  await assertCanBuy(ctx);
  const value = grossForNet(cmd.netWei);
  const minTokens = await resolveMinTokens(cmd, value, ctx);
  return { to: launchpad, data: encodeBuy(cmd.id, minTokens), value, gasLimit: BUY_GAS_LIMIT };
}

async function resolveSellAmount(cmd: SellCommand, ctx: WriteContext): Promise<bigint> {
  if (cmd.tokens !== "all") return cmd.tokens;
  const reads = readsFor(ctx, "sell all");
  const launch = await readLaunch({ ...reads, id: cmd.id });
  const balance = await readTokenBalance(reads.client, launch.token, reads.wallet);
  if (balance === 0n) throw new Error(`AGENT_WALLET holds no tokens of launch ${cmd.id}`);
  return balance;
}

/** quoteSell net of the fee: the contract compares minBnb against bnbOut - fee. */
async function quotedMinBnb(id: bigint, tokens: bigint, ctx: WriteContext): Promise<bigint> {
  const reads = readsFor(ctx, "sell without --min-bnb");
  try {
    const [bnbOut, fee] = (await readLaunchpad(reads, "quoteSell", [id, tokens])) as readonly [bigint, bigint];
    return minOutForQuote(bnbOut - fee);
  } catch (error) {
    throw describeReadFailure(`quoteSell for launch ${id}`, error);
  }
}

export async function buildSellTx(cmd: SellCommand, ctx: WriteContext): Promise<TxRequest> {
  const launchpad = requireTarget(ctx.targets.launchpad, "LAUNCHPAD_ADDRESS");
  const tokens = await resolveSellAmount(cmd, ctx);
  const minBnb = cmd.minBnb ?? (await quotedMinBnb(cmd.id, tokens, ctx));
  return { to: launchpad, data: encodeSell(cmd.id, tokens, minBnb), value: 0n };
}
