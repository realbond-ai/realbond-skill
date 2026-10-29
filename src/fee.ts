// Mirrored by web/lib/fee.ts. Mirrors AgentLaunchpad.FEE_BPS: the contract takes 1% on top of the net amount.
export const FEE_BPS = 100n;
export const BPS_DENOMINATOR = 10_000n;

/** Gross msg.value needed so that `net` lands in the curve after the fee. Rounds up. */
export function grossForNet(net: bigint): bigint {
  if (net < 0n) throw new Error(`grossForNet: negative amount ${net}`);
  const numerator = net * (BPS_DENOMINATOR + FEE_BPS);
  return (numerator + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

// Tolerated move between quote and inclusion when the caller passes no explicit bound (same as the web).
export const BUY_SLIPPAGE_BPS = 100n;

/** Minimum acceptable output for a quoted amount: 99% of it, rounded down. */
export function minOutForQuote(quoted: bigint): bigint {
  if (quoted < 0n) throw new Error(`minOutForQuote: negative amount ${quoted}`);
  return (quoted * (BPS_DENOMINATOR - BUY_SLIPPAGE_BPS)) / BPS_DENOMINATOR;
}
