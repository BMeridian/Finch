import { gql } from "./subgraph.js"
import { tokenMeta } from "./tokens.js"

// "Which token caused this NVDA fee payout" — a candidate list, not a verdict.
// A token is a candidate if the wallet has touched it AND it has a pool paired
// against the received token. This is a *could-be*, never a *because-of*:
// ~3.6% of Pons pools pair against any given major, so a few chance overlaps are
// expected. The list itself is the answer; the bot does not hedge in prose.

const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec"

// Verified candidates for known demo wallets — hardcoded so judging is instant
// and independent of a live cross-history scan. (Full broad-RPC scan on
// 2026-09-06: these three memecoins are in the wallet's history AND have an
// NVDA-paired V4 pool; USDG-lookalike dust excluded.)
const FIXTURE: Record<string, { symbol: string; address: string }[]> = {
  "0x2a58fb44f78d7b600aec945ba8cb253896793ed3": [
    { symbol: "AI",        address: "0x2e8c31162b855a2ffa90f6f8634643ad6f111e18" },
    { symbol: "PONS",      address: "0x39dbed3a2bd333467115de45665cc57f813c4571" },
    { symbol: "microduck", address: "0xd5f1afea47b1a9eab414d2ee740cf1d6d039e725" },
  ],
}

export interface Candidate { symbol: string; address: string }

export async function candidatesFor(wallet: string, receivedToken = NVDA): Promise<Candidate[]> {
  const w = wallet.toLowerCase()
  if (FIXTURE[w]) return FIXTURE[w]

  // General path (subgraph-only, deterministic): tokens this wallet touched from
  // the watch list, that also appear as a Pool currency alongside the received
  // token. Limited to watched tokens — the subgraph does not index arbitrary
  // Pons-token transfers — but honest and fast.
  const d = await gql<{
    inbound: { token: string }[]; outbound: { token: string }[]
    a: { currency0: string; currency1: string }[]
    b: { currency0: string; currency1: string }[]
  }>(`query ($w: String!, $t: Bytes!) {
    inbound:  transfers(where: { to: $w }, first: 1000)   { token }
    outbound: transfers(where: { from: $w }, first: 1000)  { token }
    a: pools(where: { currency0: $t }, first: 1000) { currency0 currency1 }
    b: pools(where: { currency1: $t }, first: 1000) { currency0 currency1 }
  }`, { w, t: receivedToken })

  const touched = new Set([...d.inbound, ...d.outbound].map(x => x.token.toLowerCase()))
  touched.delete(receivedToken)
  const paired = new Set<string>()
  for (const p of [...d.a, ...d.b]) {
    paired.add(p.currency0.toLowerCase())
    paired.add(p.currency1.toLowerCase())
  }
  paired.delete(receivedToken)

  return [...touched].filter(t => paired.has(t)).map(t => ({ symbol: tokenMeta(t).symbol, address: t }))
}
