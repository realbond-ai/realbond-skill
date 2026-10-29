# Realbond Skill

Agent-side CLI for [Realbond](https://realbond.fun), the fair launchpad on BNB Chain where every agent has a human behind it.

An agent wallet that holds an Agent ID binds one X account, then creates launches and trades them on the bonding curve. Every transaction is built locally and sent through the [Binance Agentic Wallet](https://www.binance.com) CLI (`baw`), and a human confirms it before it executes.

## What it does

| Command | What happens |
|---|---|
| `status [address]` | Agent ID, X binding, and platform pause state (read-only) |
| `bind <binding.json>` | Submits the X binding signed by the Realbond website |
| `create <ticket.json>` | Creates a launch (1% tax token) from a Create-page ticket |
| `buy <id> <netBnb>` / `sell <id> <amount\|all>` | Trades a launch on its bonding curve |
| `position <id>` | Shows your balance, remaining cap, sell quote and tax state |
| `process-tax <id>` / `claim-dividend <id>` | Tax-token actions after graduation |

Launch rules:
- A launch graduates to PancakeSwap V2 when its net raise reaches 15 BNB, and the LP is burned.
- Each wallet can hold at most 2% of supply while the launch is on its curve.

Full rules are in the [docs](https://docs.realbond.fun).

## Install

Requires Node 22+ and a logged-in `baw` CLI.

```bash
npx skills add realbond-ai/realbond-skill
```

Or run from a clone:

```bash
git clone https://github.com/realbond-ai/realbond-skill && cd realbond-skill
npm install
npx tsx src/cli.ts status
```

## Configure

```bash
export RPC_URL=<your BSC JSON-RPC endpoint>
export LAUNCHPAD_REGISTRY=0xc94D593B1162BB93e95951f9ecaab8B9fC4849b5
export LAUNCHPAD_ADDRESS=0x71Be2d9EC26b637a35e66fFDE80849625d29fEEE
export AGENT_WALLET=<your agent wallet>
```

Use an RPC endpoint you control. Public endpoints work, but when they are slow or rate-limited the CLI stops with a read error and sends nothing. Never commit a private RPC URL.

## Safety

- The CLI never holds keys. `baw` signs, and every write shows a preview and waits for confirmation.
- `--dry-run` prints the exact transaction (`to`, `data`, `value`, `gasLimit`) without sending it.
- A wallet's X binding is permanent and public.
- When the platform owner pauses a feature, the CLI stops with `PLATFORM_PAUSED` before building a transaction. Wait for the platform to resume instead of retrying in a loop. Graduated tokens keep trading on PancakeSwap.

## Agents

[`SKILL.md`](SKILL.md) is the full reference written for AI agents: every command, argument, gas cap and error.

## Development

```bash
npm test
npm run lint
```

## License

[MIT](LICENSE)
