import type { Address } from "viem";
import { readLaunch, readLaunchpad, readTaxToken, readTokenBalance, statusLabel, STATUS_GRADUATED, type ChainClient, type LaunchInfo } from "../chain.ts";

export type PositionInput = { launchpad: Address; wallet: Address; id: bigint };
type Reads = PositionInput & { client: ChainClient };

/** Curve-only fields; after graduation the cap no longer applies and selling goes through PancakeSwap. */
async function readCurveFields(reads: Reads, balance: bigint) {
  const cap = (await readLaunchpad(reads, "capOf", [reads.wallet])) as bigint;
  const remainingCap = balance >= cap ? 0n : cap - balance;
  if (balance === 0n) return { walletCap: cap.toString(), remainingCap: remainingCap.toString(), quoteSellAll: null };
  const [bnbOut, fee] = (await readLaunchpad(reads, "quoteSell", [reads.id, balance])) as readonly [bigint, bigint];
  return {
    walletCap: cap.toString(),
    remainingCap: remainingCap.toString(),
    quoteSellAll: { bnbOut: bnbOut.toString(), fee: fee.toString() },
  };
}

/** Token-wei amounts so the agent can tell whether claim-dividend / process-tax would revert. */
async function readTaxFields(reads: Reads, launch: LaunchInfo) {
  const read = (functionName: string, args: readonly unknown[] = []) =>
    readTaxToken(reads.client, launch.token, functionName, args) as Promise<bigint>;
  const [withdrawableDividend, accruedTax] = await Promise.all([
    read("withdrawableDividendOf", [reads.wallet]),
    read("accruedTax"),
  ]);
  return { withdrawableDividend: withdrawableDividend.toString(), accruedTax: accruedTax.toString() };
}

/** The wallet's holding in launch `id`: token balance, remaining cap while Live, and tax-token claimables. */
export async function readPosition(client: ChainClient, input: PositionInput): Promise<Record<string, unknown>> {
  const reads: Reads = { ...input, client };
  const launch = await readLaunch(reads);
  const balance = await readTokenBalance(client, launch.token, input.wallet);
  const isGraduated = launch.status === STATUS_GRADUATED;
  return {
    status: statusLabel(launch.status),
    token: launch.token,
    taxed: launch.taxed,
    balance: balance.toString(),
    ...(isGraduated ? { walletCap: null, remainingCap: null, quoteSellAll: null } : await readCurveFields(reads, balance)),
    tax: launch.taxed ? await readTaxFields(reads, launch) : null,
  };
}
