// Mirror of the subset of web/lib/bindingClaim.ts the bind pre-flight needs (no cross-package import);
// web/test/calldataParity.test.ts compares both copies on fixtures/binding_claim_v2.json.
import { getAddress, hashTypedData, isAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";

/** Binding claim signed by the backend and submitted on-chain by the agent wallet it names. */
export type BindingClaim = {
  agent: Address;
  xId: Hex;
  isPublic: boolean;
  screenName: string;
  followerTier: number;
  isBlueVerified: boolean;
  deadline: bigint;
};

/** `binding.json` as served by the website's `/api/x/claim`. */
export type BindingFile = { claim: BindingClaim; signature: Hex; registry: Address; chainId: number };

export const FOLLOWER_TIER_THRESHOLDS = [0, 100, 1000, 10000, 100000] as const;

/** Same `code` and `field` as the web's CodedError; defined here so web tsc can import this file. */
export class BindingFormatError extends Error {
  readonly code: string;
  readonly field?: string;

  constructor(code: string, message: string, options?: { field?: string }) {
    super(message);
    this.name = "BindingFormatError";
    this.code = code;
    this.field = options?.field;
  }
}

const CLAIM_DOMAIN_NAME = "Realbond Registry";
const CLAIM_DOMAIN_VERSION = "2";
const PRIMARY_TYPE = "BindingClaim";
const SCREEN_NAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;
const FOLLOWER_TIER_PATTERN = /^[0-4]$/;
const UINT64_DECIMAL_PATTERN = /^[0-9]{1,20}$/;
const MAX_UINT64 = 2n ** 64n - 1n;

export const BINDING_CLAIM_TYPES = {
  BindingClaim: [
    { name: "agent", type: "address" },
    { name: "xId", type: "bytes32" },
    { name: "isPublic", type: "bool" },
    { name: "screenName", type: "string" },
    { name: "followerTier", type: "uint8" },
    { name: "isBlueVerified", type: "bool" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export function claimDomain(registry: Address, chainId: number) {
  return { name: CLAIM_DOMAIN_NAME, version: CLAIM_DOMAIN_VERSION, chainId, verifyingContract: registry } as const;
}

function typedClaim(file: Pick<BindingFile, "claim" | "registry" | "chainId">) {
  return {
    domain: claimDomain(file.registry, file.chainId),
    types: BINDING_CLAIM_TYPES,
    primaryType: PRIMARY_TYPE,
    message: file.claim,
  } as const;
}

export function hashClaim(file: Pick<BindingFile, "claim" | "registry" | "chainId">): Hex {
  return hashTypedData(typedClaim(file));
}

export function recoverClaimSigner(file: BindingFile): Promise<Address> {
  return recoverTypedDataAddress({ ...typedClaim(file), signature: file.signature });
}

function badRequest(field: string): never {
  throw new BindingFormatError("bad_request", `binding file has an invalid ${field}`, { field });
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) badRequest(field);
  return value as Record<string, unknown>;
}

function readAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) badRequest(field);
  return getAddress(value);
}

function readPattern(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== "string" || !pattern.test(value)) badRequest(field);
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") badRequest(field);
  return value;
}

function readDeadline(value: unknown): bigint {
  const deadline = BigInt(readPattern(value, UINT64_DECIMAL_PATTERN, "claim.deadline"));
  if (deadline > MAX_UINT64) badRequest("claim.deadline");
  return deadline;
}

// Hidden bindings must carry an empty name so the handle never reaches the chain; public ones need a real handle.
function readScreenName(value: unknown, isPublic: boolean): string {
  if (typeof value !== "string") badRequest("claim.screenName");
  const isConsistent = isPublic ? SCREEN_NAME_PATTERN.test(value) : value === "";
  if (!isConsistent) badRequest("claim.screenName");
  return value;
}

// The registry reverts BadClaim on a zero xId, so reject it before the user pays for a failing transaction.
function readXId(value: unknown): Hex {
  const xId = readPattern(value, BYTES32_PATTERN, "claim.xId") as Hex;
  if (BigInt(xId) === 0n) badRequest("claim.xId");
  return xId;
}

function parseClaim(json: unknown): BindingClaim {
  const raw = asRecord(json, "claim");
  const isPublic = readBoolean(raw.isPublic, "claim.isPublic");
  return {
    agent: readAddress(raw.agent, "claim.agent"),
    xId: readXId(raw.xId),
    isPublic,
    screenName: readScreenName(raw.screenName, isPublic),
    followerTier: Number(readPattern(raw.followerTier, FOLLOWER_TIER_PATTERN, "claim.followerTier")),
    isBlueVerified: readBoolean(raw.isBlueVerified, "claim.isBlueVerified"),
    deadline: readDeadline(raw.deadline),
  };
}

export function parseBindingFile(json: unknown): BindingFile {
  const raw = asRecord(json, "file");
  const chainId = raw.chainId;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) badRequest("chainId");
  return {
    claim: parseClaim(raw.claim),
    signature: readPattern(raw.signature, SIGNATURE_PATTERN, "signature") as Hex,
    registry: readAddress(raw.registry, "registry"),
    chainId,
  };
}
