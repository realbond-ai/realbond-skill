import { isAddress, type Address } from "viem";

export type Config = {
  rpcUrl?: string;
  registry?: Address;
  launchpad?: Address;
  agentWallet?: Address;
};

function optionalAddress(env: NodeJS.ProcessEnv, name: string): Address | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  if (!isAddress(raw)) throw new Error(`${name} is not a valid address: ${raw}`);
  return raw;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    rpcUrl: env.RPC_URL?.trim() || undefined,
    registry: optionalAddress(env, "LAUNCHPAD_REGISTRY"),
    launchpad: optionalAddress(env, "LAUNCHPAD_ADDRESS"),
    agentWallet: optionalAddress(env, "AGENT_WALLET"),
  };
}
