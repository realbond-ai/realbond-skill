import { formatEther, type Address, type Hex } from "viem";
import { encodeClaimDividend, encodeProcessTax } from "../calldata.ts";
import { readLaunch, readTaxToken, type ChainClient, type LaunchInfo } from "../chain.ts";
import type { TaxCommandKind } from "./parse.ts";
import { notify, requireClient, requireTarget, requireWallet, type TxRequest, type WriteContext } from "./context.ts";

type TaxCheck = { client: ChainClient; launch: LaunchInfo; wallet: Address; ctx: WriteContext };

// Each check mirrors the token's own NothingToProcess / NothingToClaim revert, so the agent gets a readable reason
// before anything reaches baw.
const TAX_ACTIONS: Record<TaxCommandKind, { encode: () => Hex; check: (input: TaxCheck) => Promise<void> }> = {
  "process-tax": { encode: encodeProcessTax, check: checkAccruedTax },
  "claim-dividend": { encode: encodeClaimDividend, check: checkDividend },
};

async function checkAccruedTax({ client, launch }: TaxCheck): Promise<void> {
  const accrued = (await readTaxToken(client, launch.token, "accruedTax")) as bigint;
  if (accrued === 0n) throw new Error(`launch ${launch.id} has no accrued tax to process`);
}

/** Dividends are paid in the launch token itself (18 decimals), not in BNB. */
async function checkDividend({ client, launch, wallet, ctx }: TaxCheck): Promise<void> {
  const owed = (await readTaxToken(client, launch.token, "withdrawableDividendOf", [wallet])) as bigint;
  if (owed === 0n) throw new Error(`AGENT_WALLET has no dividend to claim on launch ${launch.id}`);
  notify(ctx, `claiming ${formatEther(owed)} tokens of launch ${launch.id} (${launch.token}), paid in the token itself`);
}

/** process-tax / claim-dividend: calls go to the tax token, not to the launchpad. */
export async function buildTaxTx(cmd: { kind: TaxCommandKind; id: bigint }, ctx: WriteContext): Promise<TxRequest> {
  const client = requireClient(ctx, cmd.kind);
  const wallet = requireWallet(ctx, cmd.kind);
  const launchpad = requireTarget(ctx.targets.launchpad, "LAUNCHPAD_ADDRESS");
  const launch = await readLaunch({ client, launchpad, id: cmd.id });
  if (!launch.taxed) throw new Error(`launch ${cmd.id} is a plain token; ${cmd.kind} only applies to tax tokens`);
  const action = TAX_ACTIONS[cmd.kind];
  await action.check({ client, launch, wallet, ctx });
  return { to: launch.token, data: action.encode(), value: 0n };
}
