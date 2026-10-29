import { readFileSync } from "node:fs";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BINDING_CLAIM_TYPES, claimDomain, parseBindingFile, type BindingClaim, type BindingFile } from "../../src/bindingClaim.ts";
import { writeJsonFile } from "./files.ts";

// Public test key from the fixture's own note; never used for real funds.
const PUBLIC_TEST_PRIVATE_KEY = "0x00000000000000000000000000000000000000000000000000000000000A11CE";

const FIXTURE_PATH = new URL("../../../fixtures/binding_claim_v2.json", import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

export const FIXTURE_SIGNER: Address = fixture.signer;

/** fixtures/binding_claim_v2.json in the `/api/x/claim` response shape. */
export const PUBLIC_JSON = {
  claim: fixture.claim,
  signature: fixture.signature,
  registry: fixture.domain.verifyingContract,
  chainId: fixture.domain.chainId,
};

export const PUBLIC_FILE: BindingFile = parseBindingFile(PUBLIC_JSON);

/** Same wire format as web serializeBindingFile: tier and deadline as decimal strings. */
export function toJson(file: BindingFile): unknown {
  const { claim } = file;
  return {
    claim: { ...claim, followerTier: String(claim.followerTier), deadline: claim.deadline.toString() },
    signature: file.signature,
    registry: file.registry,
    chainId: file.chainId,
  };
}

type SignOptions = { claim?: Partial<BindingClaim>; chainId?: number; privateKey?: `0x${string}` };

/** The fixture claim with overrides, re-signed (by the public test key unless given) for the fixture registry. */
export async function signedFile(options: SignOptions = {}): Promise<BindingFile> {
  const claim = { ...PUBLIC_FILE.claim, ...options.claim };
  const chainId = options.chainId ?? PUBLIC_FILE.chainId;
  const signature = await privateKeyToAccount(options.privateKey ?? PUBLIC_TEST_PRIVATE_KEY).signTypedData({
    domain: claimDomain(PUBLIC_FILE.registry, chainId),
    types: BINDING_CLAIM_TYPES,
    primaryType: "BindingClaim",
    message: claim,
  });
  return { ...PUBLIC_FILE, claim, chainId, signature };
}

export function writeBindingFile(file: BindingFile): string {
  return writeJsonFile(toJson(file));
}
