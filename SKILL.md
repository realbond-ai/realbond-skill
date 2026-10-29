---
name: realbond
description: |
  Use when a wallet wants to create a launch on Realbond (1% tax token; open to any wallet), when an Agent ID holder
  wants to bind its X account from a website-signed binding.json, buy (needs Agent ID + X binding) or sell a launch on
  its bonding curve, process tax or claim tax-token dividends (paid in the token), or check its binding or position on
  BSC. Every transaction goes through
  the Binance Agentic Wallet (`baw contract-call`) with a human confirmation before execution.
metadata:
  author: realbond-ai
  version: '0.2.0'
  requiredCliVersion: '1.11.0'
  openclaw:
    requires:
      bins:
        - baw
        - node
---

# Realbond Skill

TypeScript CLI that encodes calldata for the v2 `IdentityRegistry`, `AgentLaunchpad` and tax tokens on BSC
(chain 56) and sends it through the agent wallet with `baw contract-call preview` -> confirm -> `baw contract-call execute`.

## Install

```bash
npx skills add realbond-ai/realbond-skill
```

Or from a clone (run every command from the skill directory):

```bash
git clone https://github.com/realbond-ai/realbond-skill && cd realbond-skill
npm install
npx tsx src/cli.ts <command> [args] [--dry-run]
```

The website prints commands in exactly this form (`npx tsx src/cli.ts ...`). Requires Node 22+ and a
logged-in `baw` CLI (`baw auth` / `baw wallet status`).

## Environment

| Variable | Used by | Meaning |
|---|---|---|
| `RPC_URL` | `status`, `position`, `bind`, `create`, `buy`, `sell` (pause check, quote or `all`), tax commands | BSC JSON-RPC endpoint, e.g. `https://bsc-dataseed.binance.org` |
| `LAUNCHPAD_REGISTRY` | `status`, `bind` | v2 `IdentityRegistry` proxy; `status` prints `registry: "not configured"` (and `paused.bind: "not configured"`) when unset |
| `LAUNCHPAD_ADDRESS` | all launch commands, `status` | v2 `AgentLaunchpad` proxy; `status` prints `paused.launch`/`paused.trade: "not configured"` when unset |
| `AGENT_WALLET` | `bind`, `buy`, `sell` quotes / `all`, tax commands, `position`, every non-dry-run write, default `status` address | agent wallet passed to `baw ... --from` |

v2 contract addresses (BSC mainnet): `LAUNCHPAD_REGISTRY=0xc94D593B1162BB93e95951f9ecaab8B9fC4849b5`,
`LAUNCHPAD_ADDRESS=0x71Be2d9EC26b637a35e66fFDE80849625d29fEEE`. The v1 addresses do not work with this version. Never commit a private RPC URL.

## Commands

| Command | Contract call | Notes |
|---|---|---|
| `status [address]` | Agent ID `balanceOf`/`handleOf`, registry `isEligible`/`bindingOf`, launchpad and registry `pausedFlags` | read-only JSON; `binding` shows `isBound`, `xId`, `isPublic`, `followerTier`, `followerThresholdAtBinding`, `isBlueVerified` (X verified), `boundAt`, and `screenName` only for public bindings; `paused` shows `launch`, `trade`, `bind` (see "Platform pause") |
| `bind <binding.json>` | registry `bind(claim, signature)` | see "Binding" below; gas cap `400000` |
| `create <ticket.json>` | launchpad `createLaunch(name, symbol, metaCid, taxed)` | open to any wallet (no Agent ID or X binding needed); file from the Create page; name ≤ 64, symbol ≤ 16, metaCid ≤ 128 UTF-8 bytes, `taxed` must be `true` (an untaxed launch reverts `UntaxedLaunchDisabled`); a v1 ticket with `salt` is refused |
| `buy <id> <netBnb> [--min-tokens <wei>]` | launchpad `buy(id, minTokens)` payable | needs Agent ID + X binding (`NOT_ELIGIBLE` otherwise); gas cap `7000000`; see "Trading" |
| `sell <id> <amount\|all> [--min-bnb <wei>]` | launchpad `sell(id, tokens, minBnb)` | `amount` in tokens (decimal, 18 decimals); `all` reads the wallet balance; no approve needed |
| `position <id>` | launch, token and tax-token reads | read-only JSON for `AGENT_WALLET`: `status`, `token`, `taxed`, `balance`, `walletCap`/`remainingCap`/`quoteSellAll` (Live only), `tax: {withdrawableDividend, accruedTax}` (tax tokens; both in token wei) |
| `process-tax <id>` | tax token `processTax()` | tax tokens only; refused locally when `accruedTax` is 0 |
| `claim-dividend <id>` | tax token `claimDividend()` | tax tokens only; pays tokens, not BNB; refused locally when nothing is withdrawable |

The two tax commands send the transaction to the **token contract**, not to the launchpad.
A launch id is checked with `id < nextId()`; `statusOf` alone reports `Live` for ids that do not exist.

Removed in v2 (the parser says so): `register` (use `bind`), `claim`, `refund`, `graduate`, `update-salt`,
`update-salt-and-graduate`. There is no deadline, refund or separate graduation step any more.

Global flag `--dry-run`: prints `{to, data, value, gasLimit}` JSON (`value` in wei, `gasLimit` decimal or
`null` when the backend estimates) and exits 0 without calling `baw`. Chain reads still run when the command
needs them (pause check, `buy` quote, `sell` quote or `all`, bind simulation), so a paused feature still fails with
`PLATFORM_PAUSED`.

## Binding (`bind`)

1. On the Verify page enter the agent wallet, acknowledge that the binding is public, authorize X read-only
   access and download `binding.json`: a claim signed by the Realbond backend (`claim`, `signature`, `registry`,
   `chainId`). The follower tier is set from your follower count at authorization time.
2. Run `bind binding.json` within **one hour**: the claim carries a `deadline` one hour after authorization, and
   the CLI refuses one with less than 2 minutes (120 s) left.
3. The CLI checks locally that `claim.agent == AGENT_WALLET`, `chainId == 56`, `registry == LAUNCHPAD_REGISTRY`,
   the deadline, and that the signature recovers to the registry's on-chain `signer()`. It prints the
   visibility, tier (printed as its lower bound `>= 0 / 100 / 1,000 / 10,000 / 100,000` followers; tier 0 means
   fewer than 100) and X verified status, then dry-runs
   `bind` with `eth_call` from `AGENT_WALLET`. A revert (`AlreadyBound`, `XAlreadyBound`, `BadSignature`,
   `ClaimExpired`, ...) stops with the decoded error name before `baw` is called.
4. The transaction goes through `baw` with `--gasLimit 400000`.

**Bindings are public-only; the screen name and tier cannot be changed after bind.** One X account binds at most one wallet and vice versa.
The tier is the follower bucket at authorization time (<100, 100–1k, 1k–10k, 10k–100k, ≥100k) and is never updated. Do not hand
`binding.json` to anyone else: it binds your X account to the wallet named in it.

Privacy: the backend signs only public claims, so the screen name, tier, X verified status, Agent ID handle and
wallet are public and the screen name stays in on-chain events forever; the plain uid is never on chain, only
`xId = SHA256(uid)`. The Realbond backend knows and keeps your X identity, and the leaderboard shows the exact
follower count captured at authorization and is sorted by it.

## Trading

Each launch mints 1,000,000,000 tokens into the launchpad. Bound agents buy with BNB on a bonding curve; the buy
that brings the net raise to **15 BNB** graduates the launch in the same transaction: the remaining tokens and
15 BNB go into a PancakeSwap V2 pair whose LP is burned. Before graduation tokens cannot be transferred, each
wallet (creator included) may hold at most 20,000,000 tokens (2%), counted on its current balance so selling frees
room, and the curve charges 1% on buys and sells. Any wallet may create a launch, but buying needs an eligible
wallet (an Agent ID held and an X binding); selling back to the curve is open to any holder and is the only exit
before graduation. A creator without a binding cannot buy its own launch.

- Before every buy the CLI reads `registry()` from the launchpad and `isEligible(AGENT_WALLET)` (needs `RPC_URL`).
  An ineligible wallet exits with `NOT_ELIGIBLE: ... buying requires an Agent ID and an X binding` and nothing is
  sent; run `status` to see which part is missing. The contract itself reverts `NotEligible` on such a buy.

- `buy <id> <netBnb>` takes the **net** BNB for the curve; the CLI sends `value = ceil(net * 10100 / 10000)`
  (1% fee on top), e.g. `buy 1 0.01` sends `0.0101` BNB. Every buy first calls
  `quoteBuy(id, AGENT_WALLET, value)` (needs `RPC_URL`): a quote revert is reported by name (`WrongStatus`:
  not live or unknown, `WalletCapReached`, `BuyTooSmall`) and nothing is sent. `minTokens` is 99% of the
  quoted tokens (1% slippage) unless `--min-tokens` overrides it; an override above the quote prints a warning
  that the buy will revert with `Slippage`. The part that exceeds your wallet cap or the 15 BNB target is
  refunded in the same transaction; the CLI warns when the quote shows a refund.
- `sell <id> <amount|all>`: without `--min-bnb` it calls `quoteSell` and sets `minBnb` to 99% of
  `bnbOut - fee` (the contract compares the post-fee payout).
- The website's buy and sell panels print commands with `--min-tokens` / `--min-bnb` already filled in.
- Every `buy` carries `--gasLimit 7000000`: any buy may be the one that graduates (fork-measured graduation
  gas about 3.65M). It is a cap; only used gas is charged.

After graduation the curve is closed (`WrongStatus`); trade on PancakeSwap, e.g. with `baw` swap. A tax token
charges 1% on PancakeSwap buys and sells, so the swap must support fee-on-transfer tokens (Router
`swapExact...SupportingFeeOnTransferTokens`).

## Tax tokens

Every launch is a tax token (`taxed: true`); the rate and split are fixed forever. After graduation every buy or
sell against the token's canonical PancakeSwap V2 pair pays 1% in tokens to the token contract, split 50/50
(wallet-to-wallet transfers are untaxed):

- **Holders (50%)**: credited at once, in the token itself, to wallets holding more than 10,000 tokens before the
  trade, pro rata (the pair, the dead address, the launchpad and the token contract are excluded). The trader earns nothing on the tokens it just bought. Withdraw with `claim-dividend`; claimed
  tokens count toward future dividends.
- **Platform (50%)**: accrues as `accruedTax`; `process-tax` (anyone, at most once per block, at most 0.5% of the
  pool per call) sells it for BNB and sends all of it to the platform treasury. If no wallet qualifies for
  dividends, the holder half joins `accruedTax` too.

Holders above 10,000 tokens also get a pro-rata slice of the tax on their own buys and sells (from their pre-trade
balance), always less than the tax they pay. Sandwiching someone else's trade to harvest the holder half loses money
unless that trade is more than about 5x the eligible shares. Crediting dividends inside each trade makes a pair buy
cost about 30k more gas.

The creator receives 0% of the tax, gets no allocation and makes no buy at creation; it buys on the curve under
the same cap. Use `position <id>` to see `accruedTax` and `withdrawableDividend` (token wei) first.

## Platform pause

The platform owner can pause three features independently: `launch` (`create`) and `trade` (curve `buy` and
`sell`) on the launchpad, and `bind` on the registry. `status` prints them as
`paused: {launch, trade, bind}`, each `true`/`false`, `"not configured"` when that contract's address is unset, or
`{error}` when the read failed.

Before building `create`, `buy`, `sell` or `bind` (also with `--dry-run`) the CLI reads the matching
`pausedFlags()`. When the feature is paused it exits with `PLATFORM_PAUSED: <launch|trade|bind> is paused by the
platform owner` before `baw` is called; if the read itself fails it exits with that error instead of sending.
`PLATFORM_PAUSED` means the owner switched the feature off on purpose: wait and check `status` later, do not retry
in a loop. Tax commands (`process-tax`, `claim-dividend`) are not paused. Graduated tokens trade on PancakeSwap and
are unaffected by the pause.

## Confirmation before every execute

Each write command runs:

1. `baw contract-call preview --binanceChainId 56 --from <AGENT_WALLET> --to <contract> --value <wei> --inputData <calldata> [--gasLimit <cap>] --json`
2. Prints the preview (simulation, risks) to stderr and asks `Execute this transaction? [y/N]`.
3. Only on `y`: `baw contract-call execute --requestId <requestId> --json`, then prints `{txHash, status}`.
   `status: PENDING_CONFIRMATION` with `txHash: null` means approve it in the Binance App.

Never answer `y` on behalf of the user; the confirmation is the human checkpoint. When stdin is
not a terminal (piped input), the CLI prints a warning to stderr and still requires a literal `y`.

## Network note

`baw` talks to `https://www.binance.com` directly and ignores `HTTPS_PROXY`. If `baw wallet status`
fails with `Connection refused (0.0.0.0:443)`, the local resolver is returning a poisoned answer:
check `dig +short www.binance.com` and point the system DNS at a trusted resolver (for example
`8.8.8.8`) before signing in. A TUN-mode proxy does not help unless it also takes over DNS.
