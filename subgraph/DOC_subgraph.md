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

Phase-1 target recipient (verified, non-personal):

| Wallet | Amount (raw wei) | = NVDA |
|---|---|---|
| `0x2a466c3edd210d59ee530c93c3fd8d1b819463e9` | `4459483197045479` | 0.004459 |
| `0x2a58fb44f78d7b600aec945ba8cb253896793ed3` (backup) | `7370695524996258` | 0.007371 |
| `0x2a888c0a8ec1853fffb74e72fb17bc401f7e751d` (backup) | `4775667060679075` | 0.004776 |

The distributor was funded by an earlier separate claim against FeeEscrow
(tx `0xb823345c…731055d`, block 53,489,627 — a 14-token settlement batch). **Not
needed for Phase 1.**

`startBlock` = **53,480,000** in every data source (precedes the demo tx).

## What's indexed

- `PonsV2Factory` — `TokenLaunched` (ABI is still a plausible guess; see below)
- `PoolManager` — `Initialize` / `Swap` / `ModifyLiquidity`, filtered in-handler
  to the Meme Hook. `Pool.token` = the side that is NOT a known pairing asset
  (zero addr, WETH, USDG, NVDA, AAPL, TSLA, AMZN); null + `log.warning` when
  both/neither match (e.g. a graduated NVDA/WETH pool).
- 6 stock tokens (NVDA, AAPL, TSLA, AMZN, WETH, USDG) — `Transfer` via one
  shared `handleTransfer`, `from`/`to` tagged through `labelFor` (deterministic,
  reused by Phase 2's NLI formatter).

## Still open before Phase 1 is "done"

1. **Deploy target** — pick Pinax or Goldsky, authenticate, and confirm a deploy
   actually works *before* more mapping changes. For Goldsky use the dashboard's
   network typeahead; don't hardcode `robinhood-mainnet`.
2. **Pons `TokenLaunched` ABI** — `abis/PonsFactory.json` is guessed. Pull the
   real signature (verified source, or decode a known launch tx's logs) and
   reconcile `subgraph.yaml` + `src/pons.ts`.
3. **Run the success query** against the live endpoint and paste it back:

```graphql
{
  transfers(
    where: {
      token: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec"
      txHash: "0x022e94a3a3670b6f0dfdbfa50ffad5a6d48a970e39fc26915ea0b62e051b53b9"
      to: "0x2a466c3edd210d59ee530c93c3fd8d1b819463e9"
    }
  ) { from fromLabel to toLabel amount txHash block }
}
```

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
