# DOC_fresh_live — spin up finch-live on a fresh Goldsky account

The original Goldsky account (`project_cmtp3v04cmqa101vr9xgv7rvm`) ran out of
free credits on 2026-09-09; both subgraphs are **Paused** at block 58,436,370.
Paused deploys stay queryable for 30 days (7-day warning email before deletion).

Plan for submission: keep querying the paused history subgraph, stand up a
**fresh finch-live** on a new account shortly before the demo, repoint one env var.

## 1. New account (do this day-of, ~2h before demo)

```
# new email -> new $100 free credit
goldsky login          # paste the new account's CLI token
```

## 2. Pick the startBlock (deploy-time check)

The right startBlock depends on where the paused finch-rpc actually stopped and
where the chain head is *now* — both move. Check both, then set startBlock a bit
below the paused head so there is no coverage gap.

```
# a) paused finch-rpc head — log in to the OLD account first, or read it from
#    the last known value in CLAUDE.md / this repo. As of 2026-09-09: 58,436,370.
goldsky subgraph list        # "Blocks indexed: 53479999 -> <PAUSED_HEAD>"

# b) current chain head
curl -s -X POST https://rpc.mainnet.chain.robinhood.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
  | python3 -c 'import sys,json; print(int(json.load(sys.stdin)["result"],16))'
```

Set `startBlock = PAUSED_HEAD - 50000` (50k-block overlap, ~90 min of chain).
Backfill is `chain_head - startBlock` blocks; Goldsky does ~2-4k blk/s on this
chain, so 1.5M blocks ≈ 1-2h.

```
# after logging into the NEW account:
cd subgraph-live
SB=<computed startBlock>
sed -i.bak "s/startBlock: [0-9]*/startBlock: $SB/g" subgraph.yaml && rm subgraph.yaml.bak
grep -c "startBlock: $SB" subgraph.yaml    # should print 17
```

## 3. Deploy finch-live

```
cd subgraph-live && npm install && npx graph codegen && npx graph build
goldsky subgraph deploy finch-live/0.3.0 --path .
goldsky subgraph list        # Synced % climbs to 100
```

## 4. Switch the box over (one command)

```
./deploy/switch-live.sh 'https://api.goldsky.com/api/public/<NEW_PROJECT>/subgraphs/finch-live/0.3.0/gn'
```

That backs up `/etc/finch/finch.env`, swaps `SUBGRAPH_LIVE_URL`, restarts
`finch-api` + `finch-bot`, and prints `/health`. `SUBGRAPH_QUERY_URL` stays on
the paused finch-rpc (its history is complete).

`/health` should show `fresh: true` once finch-live catches the chain head —
Finch's freshness check tracks the live subgraph's head, not the paused one.

## 5. If you also want fresh deep history

Only needed if a demo query reaches for something between block 58.4M and now
that isn't a "recent" query (rare — provenance for old wallets is already
covered by the paused deploy). Deploy `subgraph/` (startBlock 53,480,000) the
same way — but that backfills ~5M blocks, **1-2 days**, so start early.

```
cd subgraph && npx graph codegen && npx graph build
goldsky subgraph deploy finch-rpc/1.0.0 --path .
# then:
./deploy/switch-live.sh --query 'https://…/<NEW_PROJECT>/subgraphs/finch-rpc/1.0.0/gn'
```

## Rollback

`/etc/finch/finch.env.bak.<timestamp>` is written before every switch. To revert:
```
ssh <box> 'sudo cp /etc/finch/finch.env.bak.<ts> /etc/finch/finch.env && sudo systemctl restart finch-api finch-bot'
```
Or just run `switch-live.sh` again with the old paused URL:
`https://api.goldsky.com/api/public/project_cmtp3v04cmqa101vr9xgv7rvm/subgraphs/finch-live/0.2.0/gn`
