import { zeroHash } from "viem";
import { describe, expect, it, vi } from "vitest";
import { AGENT_ID_ADDRESS, readStatus } from "../src/commands/status.ts";

const REGISTRY = "0x2222222222222222222222222222222222222222";
const WALLET = "0xedBEDaF88ec96B8Aa4E6dF36de335b77C53cAAcd";
const X_ID = "0x60200d325a8ad9912736572cba043d9e6c113e08811cbd1990cb18ffbcb2d8ff";
const BOUND_AT = 1_793_106_600n;

function reader(binding: Record<string, unknown>) {
  const results: Record<string, unknown> = {
    balanceOf: 1n,
    handleOf: "agent.ai",
    isEligible: binding.xId !== zeroHash,
    bindingOf: binding,
  };
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => results[functionName]),
  } as unknown as Parameters<typeof readStatus>[0];
}

const binding = (isPublic: boolean) => ({
  xId: X_ID, isPublic, isBlueVerified: true, followerTier: 2, boundAt: BOUND_AT, screenName: isPublic ? "BrixtonTanum" : "",
});

describe("status", () => {
  it("publicBindingShowsVisibilityTierXVerifiedAndScreenName", async () => {
    const status = await readStatus(reader(binding(true)), { address: WALLET, registry: REGISTRY });
    expect(status.agentId).toEqual({ contract: AGENT_ID_ADDRESS, balance: "1", handle: "agent.ai" });
    expect(status.registry).toEqual({
      address: REGISTRY,
      isEligible: true,
      binding: {
        isBound: true, xId: X_ID, isPublic: true, followerTier: 2, followerThresholdAtBinding: 1000,
        isBlueVerified: true, boundAt: Number(BOUND_AT), screenName: "BrixtonTanum",
      },
    });
  });

  it("hiddenBindingHasNoScreenNameField", async () => {
    const status = await readStatus(reader(binding(false)), { address: WALLET, registry: REGISTRY });
    const shown = (status.registry as { binding: Record<string, unknown> }).binding;
    expect(shown).toMatchObject({ isBound: true, isPublic: false, followerTier: 2, isBlueVerified: true });
    expect(shown).not.toHaveProperty("screenName");
  });

  it("unboundWalletReportsIsBoundFalse", async () => {
    const unbound = { xId: zeroHash, isPublic: false, isBlueVerified: false, followerTier: 0, boundAt: 0n, screenName: "" };
    const status = await readStatus(reader(unbound), { address: WALLET, registry: REGISTRY });
    expect(status.registry).toEqual({ address: REGISTRY, isEligible: false, binding: { isBound: false } });
  });

  it("reportsAMissingRegistry", async () => {
    expect((await readStatus(reader(binding(true)), { address: WALLET })).registry).toBe("not configured");
  });
});
