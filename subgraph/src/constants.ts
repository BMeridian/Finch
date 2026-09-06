import { Address, BigInt } from "@graphprotocol/graph-ts"

// ---- VERIFIED (cross-checked against independent sources; code confirmed on-chain) ----
export let PONS_V2_FACTORY  = Address.fromString("0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e")
export let PONS_V2_MEME_HOOK = Address.fromString("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044")

// ---- Confirmed to hold contract code on-chain; roles NOT independently verified on Blockscout ----
export let POOL_MANAGER     = Address.fromString("0x8366a39CC670B4001A1121B8F6A443A643e40951")
export let FEE_ESCROW       = Address.fromString("0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e")
// demo-fixture claim/distributor contract — one instance among many, not a chain-wide hub
export let DEMO_DISTRIBUTOR = Address.fromString("0xe25e9bc31d24bb652fb6e2e466d7c9c89701173e")

// ---- Stock tokens (code confirmed on-chain; each emits standard ERC-20 Transfer) ----
export let NVDA = Address.fromString("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC")
export let AAPL = Address.fromString("0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9")
export let TSLA = Address.fromString("0x322F0929c4625eD5bAd873c95208D54E1c003b2d")
export let AMZN = Address.fromString("0x12f190a9F9d7D37a250758b26824B97CE941bF54")
export let WETH = Address.fromString("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73")
export let USDG = Address.fromString("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168")

export let ZERO = BigInt.fromI32(0)

// Known pairing assets for Pool.token derivation. The launched token is whichever
// pool side is NOT in this set. NOTE: this includes the stock tokens, so a
// graduated stock-token pool (e.g. NVDA/WETH) has both sides in the set -> token
// is left null and flagged, rather than guessing. That is intentional for Phase 1.
export function isPairingAsset(a: Address): boolean {
  return a.equals(Address.zero())
      || a.equals(WETH) || a.equals(USDG)
      || a.equals(NVDA) || a.equals(AAPL) || a.equals(TSLA) || a.equals(AMZN)
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
