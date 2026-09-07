import { Address, BigInt } from "@graphprotocol/graph-ts"

// ---- VERIFIED (cross-checked against independent sources; code confirmed on-chain) ----
export let PONS_V2_FACTORY  = Address.fromString("0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e")
export let PONS_V2_MEME_HOOK = Address.fromString("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044")

// ---- Confirmed to hold contract code on-chain; roles NOT independently verified on Blockscout ----
export let POOL_MANAGER     = Address.fromString("0x8366a39CC670B4001A1121B8F6A443A643e40951")
export let FEE_ESCROW       = Address.fromString("0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e")
// demo-fixture claim/distributor contract — one instance among many, not a chain-wide hub
export let DEMO_DISTRIBUTOR = Address.fromString("0xe25e9bc31d24bb652fb6e2e466d7c9c89701173e")

// ---- Watched tokens: Robinhood stock/ETF tokens whose Transfer events Finch
// indexes. Each emits standard ERC-20 Transfer; symbols/decimals confirmed from
// the FeeEscrow settlement tx 0xb823345c…731055d and robinscan.io. LOWERCASE. ----
export let WATCHED: string[] = [
  "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", // NVDA
  "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", // AAPL
  "0x322f0929c4625ed5bad873c95208d54e1c003b2d", // TSLA
  "0x12f190a9f9d7d37a250758b26824b97ce941bf54", // AMZN
  "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea", // SPCX
  "0xcec185eb182c47d1ba1efc84e6959e18cd620be4", // cbBTC
  "0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e", // GLD
  "0x117cc2133c37b721f49de2a7a74833232b3b4c0c", // SPY
  "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68", // QQQ
  "0x1d11f0496982706c5e14a514d4e79f2e6bde4516", // DJT
  "0x1b0e319c6a659f002271b69db8a7df2f911c153e", // GME
  "0x05b37fb53a299a1b874a619e1c4c404d52c36f4c", // RDDT
  "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", // GOOGL
  "0xf0c4bf4c582cb3836e98394b1d4e7b7281101be8", // RBLX
  "0x32ac8c1d7672667d5ebdea22935f7b06fc8d496f", // HOOD
]

// Pool pairing/quote assets — NOT watched for Transfers, but still needed for
// Pool.token derivation (a memecoin/WETH pool's launched side is the memecoin).
export let PAIRING_EXTRA: string[] = [
  "0x0000000000000000000000000000000000000000", // native
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73", // WETH
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // USDG
]

export let ZERO = BigInt.fromI32(0)

// Known pairing assets for Pool.token derivation. The launched token is whichever
// pool side is NOT in this set — every watched token plus the quote assets. When
// both/neither side is a pairing asset, token is left null and flagged.
export function isPairingAsset(a: Address): boolean {
  let h = a.toHexString()
  for (let i = 0; i < WATCHED.length; i++) { if (WATCHED[i] == h) return true }
  for (let i = 0; i < PAIRING_EXTRA.length; i++) { if (PAIRING_EXTRA[i] == h) return true }
  return false
}

// Deterministic classification — a plain lookup, no LLM. Phase 2's NLI formatter
// reuses this as-is. Never surface a bare hex address in a user-facing answer.
export function labelFor(a: Address): string | null {
  if (a.equals(FEE_ESCROW))        return "Pons V2 FeeEscrow"
  if (a.equals(DEMO_DISTRIBUTOR))  return "Pons fee claim contract"
  if (a.equals(PONS_V2_FACTORY))   return "Pons launch factory"
  if (a.equals(PONS_V2_MEME_HOOK)) return "Pons Meme Hook"
  if (a.equals(POOL_MANAGER))      return "Uniswap V4 PoolManager"
  return null
}
