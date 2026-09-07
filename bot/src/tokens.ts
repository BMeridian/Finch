// Known stock tokens on Robinhood Chain — address (lowercase) -> {symbol, decimals}.
// Used only to render raw uint256 amounts; not a classification decision.
export const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec": { symbol: "NVDA",  decimals: 18 },
  "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": { symbol: "AAPL",  decimals: 18 },
  "0x322f0929c4625ed5bad873c95208d54e1c003b2d": { symbol: "TSLA",  decimals: 18 },
  "0x12f190a9f9d7d37a250758b26824b97ce941bf54": { symbol: "AMZN",  decimals: 18 },
  "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea": { symbol: "SPCX",  decimals: 18 },
  "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68": { symbol: "QQQ",   decimals: 18 },
  "0xcec185eb182c47d1ba1efc84e6959e18cd620be4": { symbol: "cbBTC", decimals: 8 },
  "0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e": { symbol: "GLD",   decimals: 18 },
  "0x117cc2133c37b721f49de2a7a74833232b3b4c0c": { symbol: "SPY",   decimals: 18 },
  "0x1d11f0496982706c5e14a514d4e79f2e6bde4516": { symbol: "DJT",   decimals: 18 },
  "0x1b0e319c6a659f002271b69db8a7df2f911c153e": { symbol: "GME",   decimals: 18 },
  "0x05b37fb53a299a1b874a619e1c4c404d52c36f4c": { symbol: "RDDT",  decimals: 18 },
  "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3": { symbol: "GOOGL", decimals: 18 },
  "0xf0c4bf4c582cb3836e98394b1d4e7b7281101be8": { symbol: "RBLX",  decimals: 18 },
  "0x32ac8c1d7672667d5ebdea22935f7b06fc8d496f": { symbol: "HOOD",  decimals: 18 },
}

export function tokenMeta(addr: string) {
  return TOKENS[addr.toLowerCase()] ?? { symbol: "tokens", decimals: 18 }
}

const BY_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(TOKENS).map(([addr, m]) => [m.symbol, addr]),
)
export function addressForSymbol(sym: string): string | undefined {
  return BY_SYMBOL[sym.toUpperCase()]
}
export const KNOWN_SYMBOLS = Object.values(TOKENS).map(m => m.symbol)

export function human(rawAmount: string, addr: string, places = 4): string {
  const { decimals } = tokenMeta(addr)
  const neg = rawAmount.startsWith("-")
  let n = BigInt((neg ? rawAmount.slice(1) : rawAmount) || "0")
  // round to `places` decimals
  const drop = BigInt(10) ** BigInt(Math.max(0, decimals - places))
  if (drop > 1n) { n = (n + drop / 2n) / drop }
  const scaled = n.toString().padStart(places + 1, "0")
  const whole = scaled.slice(0, scaled.length - places)
  const frac = scaled.slice(scaled.length - places).replace(/0+$/, "")
  return (neg ? "-" : "") + (frac ? `${whole}.${frac}` : whole)
}
