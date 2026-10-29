import { decodeFunctionData, isAddressEqual, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import launchpadAbi from "../src/abi/launchpad.json" with { type: "json" };
import registryAbi from "../src/abi/registry.json" with { type: "json" };
import taxTokenAbi from "../src/abi/taxToken.json" with { type: "json" };
import type { BindingClaim, BindingFile } from "../src/bindingClaim.ts";
import {
  encodeBind,
  encodeBuy,
  encodeClaimDividend,
  encodeCreateLaunch,
  encodeProcessTax,
  encodeSell,
  type Ticket,
} from "../src/calldata.ts";
import { PUBLIC_FILE } from "./helpers/claimFixture.ts";

const BIND_SIGNATURE = "bind((address,bytes32,bool,string,uint8,bool,uint64),bytes)";

describe("encodeBind", () => {
  const data = encodeBind(PUBLIC_FILE);

  it("startsWithTheV2ClaimBindSelector", () => {
    expect(data.slice(0, 10)).toBe(toFunctionSelector(BIND_SIGNATURE));
  });

  it("roundTripsEveryClaimFieldAndTheSignature", () => {
    const { functionName, args } = decodeFunctionData({ abi: registryAbi, data });
    expect(functionName).toBe("bind");
    const [claim, signature] = args as readonly [BindingClaim, string];
    expect(isAddressEqual(claim.agent, PUBLIC_FILE.claim.agent)).toBe(true);
    expect({ ...claim, agent: PUBLIC_FILE.claim.agent }).toEqual(PUBLIC_FILE.claim);
    expect(signature).toBe(PUBLIC_FILE.signature);
  });

  it("rejectsAClaimMissingAStructField", () => {
    const claim: Partial<BindingClaim> = { ...PUBLIC_FILE.claim };
    delete claim.deadline;
    expect(() => encodeBind({ ...PUBLIC_FILE, claim } as BindingFile)).toThrow();
  });
});

describe("launchpad encoders", () => {
  const decode = (data: `0x${string}`) => decodeFunctionData({ abi: launchpadAbi, data });

  it("encodeCreateLaunchCarriesEveryTicketFieldInOrder", () => {
    const ticket: Ticket = { name: "Agent", symbol: "AGT", metaCid: "bafy123", taxed: true };
    const data = encodeCreateLaunch(ticket);
    expect(data.slice(0, 10)).toBe(toFunctionSelector("createLaunch(string,string,string,bool)"));
    expect(decode(data).args).toEqual(["Agent", "AGT", "bafy123", true]);
  });

  it("encodeBuyCarriesIdAndMinTokens", () => {
    const data = encodeBuy(1n, 0n);
    expect(data.slice(0, 10)).toBe(toFunctionSelector("buy(uint256,uint256)"));
    expect(decode(data).args).toEqual([1n, 0n]);
  });

  it("encodeSellCarriesTokensAndMinBnb", () => {
    const data = encodeSell(2n, 5n, 7n);
    expect(data.slice(0, 10)).toBe(toFunctionSelector("sell(uint256,uint256,uint256)"));
    expect(decode(data).args).toEqual([2n, 5n, 7n]);
  });
});

describe("tax token encoders", () => {
  it.each([
    ["processTax", encodeProcessTax],
    ["claimDividend", encodeClaimDividend],
  ] as const)("%sIsTheBareSelector", (name, encode) => {
    const data = encode();
    expect(data).toBe(toFunctionSelector(`${name}()`));
    expect(decodeFunctionData({ abi: taxTokenAbi, data }).functionName).toBe(name);
  });
});
