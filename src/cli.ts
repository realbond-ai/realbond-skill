#!/usr/bin/env -S npx tsx
import { createChainClient, describeReadFailure, type ChainClient } from "./chain.ts";
import { parseCommand, type ParsedCommand } from "./commands/parse.ts";
import { readPosition } from "./commands/position.ts";
import { readStatus, statusInput } from "./commands/status.ts";
import { runWrite } from "./commands/write.ts";
import { readConfig, type Config } from "./config.ts";

function requireClient(config: Config): ChainClient {
  if (!config.rpcUrl) throw new Error("RPC_URL is not set");
  return createChainClient(config.rpcUrl);
}

async function runStatus(cmd: Extract<ParsedCommand, { kind: "status" }>, config: Config): Promise<string> {
  const address = cmd.address ?? config.agentWallet;
  if (!address) throw new Error("status needs an address argument or AGENT_WALLET");
  const status = await readStatus(requireClient(config), statusInput(address, config));
  return JSON.stringify(status, null, 2);
}

async function runPosition(cmd: Extract<ParsedCommand, { kind: "position" }>, config: Config): Promise<string> {
  if (!config.agentWallet) throw new Error("position needs AGENT_WALLET");
  if (!config.launchpad) throw new Error("LAUNCHPAD_ADDRESS is not set");
  const input = { launchpad: config.launchpad, wallet: config.agentWallet, id: cmd.id };
  try {
    return JSON.stringify(await readPosition(requireClient(config), input), null, 2);
  } catch (error) {
    throw describeReadFailure(`position read for launch ${cmd.id}, wallet ${config.agentWallet}`, error);
  }
}

function runWriteCommand(cmd: ParsedCommand, config: Config): Promise<string> {
  return runWrite(cmd, {
    targets: { registry: config.registry, launchpad: config.launchpad },
    wallet: config.agentWallet,
    client: config.rpcUrl ? createChainClient(config.rpcUrl) : undefined,
    notify: (line) => console.error(line),
  });
}

async function main(argv: string[]): Promise<void> {
  const cmd = parseCommand(argv);
  const config = readConfig();
  if (cmd.kind === "status") console.log(await runStatus(cmd, config));
  else if (cmd.kind === "position") console.log(await runPosition(cmd, config));
  else console.log(await runWriteCommand(cmd, config));
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
});
