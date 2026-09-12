// Pons25 — static reference list of the top 25 Robinhood-Chain tokenized
// stock/ETF tokens by ON-CHAIN market cap (circulating supply × price, NOT the
// underlying company's market cap). Finch does NOT index Transfer events for
// these — it is display-only reference data.
//
// Source: robinscan.io/api/stocks (reads Robinhood Chain's on-chain asset
// registry), cross-checked against docs.robinhood.com/chain/contracts for the
// address list. Snapshot 2026-08-31 — on-chain market cap moves constantly.
// Non-stock ecosystem assets (PONS, WETH, USDG, memecoins) are excluded.

export const PONS25_SNAPSHOT = "2026-08-31"

export interface Pons25Row { symbol: string; address: string; mcapUsd: number; name: string }

export const PONS25: Pons25Row[] = [
  { symbol: "SPY",   address: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c", mcapUsd: 17455653, name: "SPDR S&P 500 ETF Trust" },
  { symbol: "NVDA",  address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", mcapUsd: 15246072, name: "NVIDIA" },
  { symbol: "SPCX",  address: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea", mcapUsd:  8852290, name: "Space Exploration Technologies (SpaceX) Class A" },
  { symbol: "AMC",   address: "0x05a3d1cd21d0c88145e82600e62e7e496e0f222b", mcapUsd:  7284970, name: "AMC Entertainment" },
  { symbol: "GLD",   address: "0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e", mcapUsd:  6459952, name: "SPDR Gold Trust" },
  { symbol: "AAPL",  address: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", mcapUsd:  5679164, name: "Apple" },
  { symbol: "TSLA",  address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", mcapUsd:  4695925, name: "Tesla" },
  { symbol: "MU",    address: "0xff080c8ce2e5feadaca0da81314ae59d232d4afd", mcapUsd:  4291413, name: "Micron Technology" },
  { symbol: "LLY",   address: "0x8005d266423c7ea827372c9c864491e5786600ea", mcapUsd:  3870359, name: "Eli Lilly" },
  { symbol: "QQQ",   address: "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68", mcapUsd:  3760179, name: "Invesco QQQ Trust" },
  { symbol: "HIMS",  address: "0xccee82fe024c36fa15e1005ede3e9e4787e23d09", mcapUsd:  3597612, name: "Hims & Hers Health" },
  { symbol: "DJT",   address: "0x1d11f0496982706c5e14a514d4e79f2e6bde4516", mcapUsd:  2912200, name: "Trump Media & Technology Group" },
  { symbol: "GOOGL", address: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", mcapUsd:  2838318, name: "Alphabet Class A" },
  { symbol: "GME",   address: "0x1b0e319c6a659f002271b69db8a7df2f911c153e", mcapUsd:  2591699, name: "GameStop" },
  { symbol: "AMZN",  address: "0x12f190a9f9d7d37a250758b26824b97ce941bf54", mcapUsd:  2549556, name: "Amazon" },
  { symbol: "MSFT",  address: "0xe93237c50d904957cf27e7b1133b510c669c2e74", mcapUsd:  2395662, name: "Microsoft" },
  { symbol: "MSTR",  address: "0xec262a75e413fafd0df80480274532c79d42da09", mcapUsd:  2339503, name: "Strategy Inc. (MicroStrategy)" },
  { symbol: "CRCL",  address: "0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5", mcapUsd:  2271723, name: "Circle Internet Group" },
  { symbol: "SGOV",  address: "0x92fd66527192e3e61d4ddd13322aa222de86f9b5", mcapUsd:  2183883, name: "iShares 0-3 Month Treasury Bond ETF" },
  { symbol: "RDDT",  address: "0x05b37fb53a299a1b874a619e1c4c404d52c36f4c", mcapUsd:  2132567, name: "Reddit" },
  { symbol: "AMD",   address: "0x86923f96303d656e4aa86d9d42d1e57ad2023fdc", mcapUsd:  1886176, name: "Advanced Micro Devices" },
  { symbol: "TTWO",  address: "0x5e81213613b6b86eab4c6c50d718d34359459786", mcapUsd:  1783302, name: "Take-Two Interactive Software" },
  { symbol: "SNDK",  address: "0xb90a19ff0af67f7779aff50a882a9cff42446400", mcapUsd:  1760084, name: "Sandisk Corporation" },
  { symbol: "META",  address: "0xc0d6457c16cc70d6790dd43521c899c87ce02f35", mcapUsd:  1750718, name: "Meta Platforms" },
  { symbol: "PLTR",  address: "0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a", mcapUsd:  1721000, name: "Palantir Technologies" },
]

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n}`
}

export function pons25Text(): string {
  const lines = PONS25.map((r, i) => {
    const rank = String(i + 1).padStart(2)
    return `${rank}. ${r.symbol.padEnd(6)} ${r.address}  ${money(r.mcapUsd)}`
  })
  return (
    `Pons25 — top tokenized stocks by on-chain market cap (as of ${PONS25_SNAPSHOT}):\n` +
    lines.join("\n") +
    `\n\nSource: robinscan.io on-chain asset registry (Robinhood Chain), address list ` +
    `cross-checked vs docs.robinhood.com/chain/contracts. Figures are ON-CHAIN token ` +
    `market cap (circulating supply x price) — not the underlying company's — and move ` +
    `constantly. PONS/WETH/USDG/memecoins excluded.`
  )
}
