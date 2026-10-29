// Mirrored by web/lib/calldata.ts (no cross-package import); web/test/calldataParity.test.ts pins the encoding.
import { encodeFunctionData, type Hex } from "viem";
import type { BindingFile } from "./bindingClaim.ts";
import launchpadAbi from "./abi/launchpad.json" with { type: "json" };
import registryAbi from "./abi/registry.json" with { type: "json" };
import taxTokenAbi from "./abi/taxToken.json" with { type: "json" };

/** Launch ticket as downloaded from the Create page; only 1% tax-token launches are open, so `taxed` is always true. */
export type Ticket = { name: string; symbol: string; metaCid: string; taxed: true };

function launchpadCall(functionName: string, args: readonly unknown[]): Hex {
  return encodeFunctionData({ abi: launchpadAbi, functionName, args });
}

function taxTokenCall(functionName: string): Hex {
  return encodeFunctionData({ abi: taxTokenAbi, functionName });
}

/** registry.bind(claim, signature) for a backend-signed binding file; only `claim.agent` can submit it. */
export function encodeBind(file: BindingFile): Hex {
  return encodeFunctionData({ abi: registryAbi, functionName: "bind", args: [file.claim, file.signature] });
}

export function encodeCreateLaunch(t: Ticket): Hex {
  return launchpadCall("createLaunch", [t.name, t.symbol, t.metaCid, t.taxed]);
}

export function encodeBuy(id: bigint, minTokens: bigint): Hex {
  return launchpadCall("buy", [id, minTokens]);
}

export function encodeSell(id: bigint, tokens: bigint, minBnb: bigint): Hex {
  return launchpadCall("sell", [id, tokens, minBnb]);
}

/** Called on the tax token itself, not on the launchpad. */
export function encodeProcessTax(): Hex {
  return taxTokenCall("processTax");
}

export function encodeClaimDividend(): Hex {
  return taxTokenCall("claimDividend");
}
