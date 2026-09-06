# /subgraph — Finch indexer (Phase 1 POC)

## On-chain verification (via Robinhood RPC, 2026-09-05)

RPC `https://rpc.mainnet.chain.robinhood.com` — chain id `0x1237` (4663) confirmed.
Blockscout REST/GraphQL is Cloudflare-blocked to scripts (as DOC_prompt.md warned);
verification below is from `eth_getCode` / `eth_getTransactionReceipt` / `eth_getLogs`.

| Address | Check |
|---|---|
| Pons V2 Factory `0x7eD5…EC7e` | contract, 24177 bytes ✅ |
| Pons V2 Meme Hook `0xE5e7…e044` | contract, 15167 bytes ✅ |
| PoolManager `0x8366…0951` | contract, 24009 bytes (role not cross-checked) |
| FeeEscrow `0xd3AF…Ac9e` | contract, 1932 bytes (role not cross-checked) |
| Distributor `0xe25e…173e` | contract, 291 bytes (proxy-sized) |
| NVDA/AAPL/TSLA/AMZN | contracts, 283 bytes each (proxy-sized); emit standard ERC-20 `Transfer` |
| WETH `0x0Bd7…AD73` | contract, 2202 bytes |
| USDG `0x5fc5…d168` | contract, 170 bytes |

## Canonical demo, confirmed on-chain

Distribution tx `0x022e94a3…b53b9` — **block 53,505,176**, one Multicall3
`aggregate3` (`0xca11…ca11`) sent by the distributor `0xe25e…173e`. It contains
**100 NVDA `Transfer`s** to 100 distinct passive recipients. Each emits a normal
ERC-20 `Transfer`, so a plain handler on the NVDA contract catches them with no
Multicall3 decoding.

Phase-1 target recipient — **`0x2a58fb44f78d7b600aec945ba8cb253896793ed3`**
(plain EOA, non-personal, unclaimed). Never use a personal wallet as a fixture.

| Wallet | Amount (raw wei) | = NVDA |
|---|---|---|
| `0x2a58fb44f78d7b600aec945ba8cb253896793ed3` | `7370695524996258` | 0.007371 |

Recurring recipient: full history = NVDA received 11× (~9.72 total), 10 from
`0xe25e…173e`. The subgraph already sees two — this tx and block 53,599,582
(`0xaa0ff1fb…`). `0x2a888c0a8ec1853fffb74e72fb17bc401f7e751d` is a single-receipt
dead end — do not use.

The distributor was funded by an earlier separate claim against FeeEscrow
(tx `0xb823345c…731055d`, block 53,489,627 — a 14-token settlement batch). **Not
needed for Phase 1.**

`startBlock` = **53,480,000** in every data source (precedes the demo tx).

## What's indexed

- `PonsV2Factory` — `TokenLaunched` + graduation events (real ABI from source)
- `PoolManager` — `Initialize` / `Swap` / `ModifyLiquidity`, filtered in-handler
  to the Meme Hook. `Pool.token` = the side that is NOT a known pairing asset
  (zero addr + every watched token in `constants.ts` `WATCHED`); null +
  `log.warning` when both/neither match (e.g. a graduated NVDA/WETH pool).
- **14 watched tokens** (`constants.ts` `WATCHED`): NVDA, AAPL, TSLA, AMZN, SPCX,
  cbBTC, GLD, SPY, QQQ, DJT, GME, RDDT, GOOGL, RBLX. `Transfer` via one shared
  `handleTransfer`, `from`/`to` tagged through `labelFor`.
- **WETH + USDG** are NOT watched for Transfers but ARE pool pairing/quote assets
  (`constants.ts` `PAIRING_EXTRA`) — needed so `Pool.token` derives the memecoin
  side of a memecoin/WETH or memecoin/USDG pool.

## Phase 1 — DONE

- Deployed to **Goldsky** as `finch-rpc/0.2.0` (chain `robinhood-mainnet`).
  Endpoint in `.env` `SUBGRAPH_QUERY_URL`. Goldsky supports Robinhood Chain for
  RPC subgraphs; it does NOT support substreams-powered subgraphs (that's Track B).
- Real Pons `TokenLaunched` ABI applied (from `ponsdotdev/ponsfamily`), plus
  `PoolGraduated` / `GraduationTokensPermanentlyLocked` handlers.
- Success query verified live:

```graphql
{
  transfers(
    where: {
      txHash: "0x022e94a3a3670b6f0dfdbfa50ffad5a6d48a970e39fc26915ea0b62e051b53b9"
      to: "0x2a58fb44f78d7b600aec945ba8cb253896793ed3"
    }
  ) { from fromLabel to toLabel amount txHash block }
}
```

→ `amount 7370695524996258`, `fromLabel "Pons fee claim contract"`, `toLabel null`.

Expect: one record, `fromLabel` = `"Pons fee claim contract"`, `toLabel` = null,
`amount` = `4459483197045479`.

## Commands

```
npm install
npm run codegen && npm run build     # both currently pass
npm run deploy:goldsky               # or the Pinax equivalent
```

## Not in Phase 1

Multicall3 calldata decoding, curve trades, graduation events, non-Pons
launchpads, Substreams, any bot/NLI code. `TokenLaunch` graduation fields exist
in the schema; no handler yet.
