#!/usr/bin/env bash
# bazDemo.sh — the "agent side" of the Bazantic demo.
#
# Run this in a second terminal while the Telegram chat is on camera with
# /seeAgentFull active. Each call here lands in the chat as "↘ agent call …".
#
# It plays a cold agent: discover Finch through the gateway, read the x402
# price challenge, then pay-per-call ($0.00001 USDC on Base, real on-chain) and
# get structured provenance back — no Finch key, no Robinhood-Chain RPC.
#
# To settle, pay from a grant off the Bazantic hosted balance:
#   baz grant create --name finch --cap 0.10
#   BAZ_ACCOUNT=finch ./bazDemo.sh all NVDA
#
#   ./bazDemo.sh                     # full run (token defaults to NVDA)
#   ./bazDemo.sh wallet              # wallet-provenance call (default fixture)
#   ./bazDemo.sh 0x2a58fb44… NVDA    # provenance for that wallet + token
#   ./bazDemo.sh wallet 0x2a58fb44… SPY   # same, explicit form
#   ./bazDemo.sh launches TSLA       # recent Pons launches paired vs TSLA
#   ./bazDemo.sh grads TSLA          # graduated Pons tokens paired vs TSLA
#   ./bazDemo.sh all GME             # full run, filtered by GME
#   BAZ_ENDPOINT=https://… ./bazDemo.sh   # skip discovery, use this endpoint
#
# Env:
#   BAZ_ENDPOINT   gateway base URL (else resolved from `baz gateway list`)
#   BAZ_MAX        max USDC per call (default 0.02)
#   BAZ_ACCOUNT    pay from: "wallet" or a grant name (default wallet)
#   DEMO_WALLET    wallet to look up (default the canonical fixture)
#
# Needs: baz (@bazantic/cli), python3, a `baz wallet`. No jq required.

set -euo pipefail

WALLET="${DEMO_WALLET:-0x2a58fb44f78d7b600aec945ba8cb253896793ed3}"
MAX="${BAZ_MAX:-0.02}"
ACCT="${BAZ_ACCOUNT:-wallet}"        # "wallet" (self-custody) or a grant name (baz grant create)
STEP="${1:-all}"
TOK="${2:-NVDA}"          # pairing-token filter for launches / grads

# Shorthand: `./bazDemo.sh 0x… [SYM]`  ==  `./bazDemo.sh wallet` for that wallet.
if [[ "$STEP" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  WALLET="$STEP"; STEP="wallet"; TOK="${2:-NVDA}"
fi
# `./bazDemo.sh wallet 0x… [SYM]`  — explicit form.
if [ "$STEP" = wallet ] && [[ "${2:-}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  WALLET="$2"; TOK="${3:-NVDA}"
fi

have()  { command -v "$1" >/dev/null 2>&1; }
pause() { printf '\n\033[2m— press enter —\033[0m'; read -r _; }
say()   { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
run()   { printf '\033[2m$ %s\033[0m\n' "$*"; eval "$*"; }
pp()    { python3 -m json.tool 2>/dev/null || cat; }   # pretty-print JSON, passthrough on failure

have baz     || { echo "need @bazantic/cli:  npm i -g @bazantic/cli"; exit 1; }
have python3 || { echo "need python3"; exit 1; }

# --- 0. wallet check (x402 pays from a local signer; needed even at $0) ---
WADDR="$(baz wallet address 2>/dev/null | tr -d '[:space:]')"
if [ -z "$WADDR" ]; then
  echo "no baz wallet — run:  baz wallet new --passphrase-stdin"
  exit 1
fi
echo "payer wallet: $WADDR"

# --- 1. DISCOVER: find Finch by capability, not by URL ---
if [ -n "${BAZ_ENDPOINT:-}" ]; then
  ENDPOINT="$BAZ_ENDPOINT"
  say "1. discovery (skipped — BAZ_ENDPOINT set)"
else
  say "1. DISCOVER — an agent that has never heard of Finch"
  run "baz gateway list --json | python3 -c 'import sys,json; [print(json.dumps({k:g[k] for k in (\"name\",\"category\",\"slug\",\"endpointUrl\",\"mcp\")}, indent=2)) for g in json.load(sys.stdin)[\"listings\"] if g[\"name\"]==\"Finch\" and g[\"status\"]==\"active\"]'"
  ENDPOINT="$(baz gateway list --json | python3 -c 'import sys,json; xs=[g["endpointUrl"] for g in json.load(sys.stdin)["listings"] if g["name"]=="Finch" and g["status"]=="active"]; print(xs[0] if xs else "")')"
  [ -n "$ENDPOINT" ] || { echo "Finch gateway not found — is it registered / active?"; exit 1; }
fi
echo "   endpoint: $ENDPOINT"
echo "   (no Finch API key, no Robinhood-Chain RPC, no subgraph URL)"
[ "$STEP" = all ] && pause

# --- 2. READ THE x402 CHALLENGE ---
# GET the priced route with a real param (a bare /query is a no-op probe and
# passes through). The gateway answers 402 with a `payment-required` header:
# x402 v2, scheme exact, network Base (eip155:8453), asset USDC, amount "10"
# (= $0.00001), payTo, maxTimeoutSeconds.
say "2. INSPECT — the x402 payment challenge (HTTP 402)"
run "curl -s -i \"$ENDPOINT/query?wallet=$WALLET\" | sed -n '1,12p'"
echo "   -> 402 Payment Required; decode the payment-required header for the accepts block"
[ "$STEP" = all ] && pause

# --- 3. PAY-PER-CALL: baz curl settles the 402 and retries ---
# Needs a funded payer: USDC on Base in `baz wallet address` (a few cents covers
# thousands of calls at $0.00001), or a `baz grant` off a hosted balance. With an
# empty wallet this returns {"ok":false,"error":"payment_rejected"} and its
# `detail` still shows the full accepts block.
call() {
  local url="$1" label="$2"
  say "$label"
  local out; out="$(baz curl "$url" --account "$ACCT" --max-amount "$MAX" --yes --json 2>&1)"
  printf '\033[2m$ baz curl "%s" --account %s --json\033[0m\n' "$url" "$ACCT"
  echo "$out" | pp
  echo "   ^ 'paid' is the x402 settlement record; watch Telegram: '↘ agent call … bazantic:<id>'"
  # Finch reads its own payment off Base and confirms it on-chain.
  local tx; tx="$(echo "$out" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("paid",{}).get("transaction","") or "")
except Exception: print("")' 2>/dev/null)"
  if [ -n "$tx" ]; then
    say "   verify the payment on Base — Finch checks its own settlement"
    run "curl -s \"$ENDPOINT/x402/verify?tx=$tx\" | pp"
  fi
}

case "$STEP" in
  wallet)   call "$ENDPOINT/query?wallet=$WALLET&q=why+did+I+get+$TOK" "3. PAID CALL — wallet provenance ($TOK)" ;;
  launches) call "$ENDPOINT/query?q=what+launched+on+pons+recently+$TOK&format=prose" "3. PAID CALL — recent Pons launches vs $TOK" ;;
  grads)    call "$ENDPOINT/query?q=graduated+pons+tokens+$TOK&format=prose" "3. PAID CALL — graduated (Uniswap V4) vs $TOK" ;;
  all)
    call "$ENDPOINT/query?wallet=$WALLET&q=why+did+I+get+NVDA" "3a. PAID CALL — wallet provenance"
    pause
    call "$ENDPOINT/query?q=what+launched+on+pons+recently+$TOK&format=prose" "3b. PAID CALL — recent launches vs $TOK"
    pause
    call "$ENDPOINT/query?q=graduated+pons+tokens+$TOK&format=prose" "3c. PAID CALL — graduated vs $TOK"
    ;;
  *) echo "unknown step: $STEP (use: wallet | launches | grads | all) [token]"; exit 1 ;;
esac

# --- 4. optional: the auto-generated MCP endpoint (no Finch MCP code on this path) ---
if [ "$STEP" = all ]; then
  pause
  say "4. MCP — same gateway, tools generated from the OpenAPI spec"
  run "curl -s -X POST \"$ENDPOINT/mcp\" -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}' | pp"
fi

say "done — Finch shipped an OpenAPI spec; Bazantic made it paid, discoverable, and MCP-callable."
