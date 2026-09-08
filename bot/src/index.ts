import { Bot } from "grammy"
import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { answer } from "./answer.js"
import { getWallet, setWallet, clearWallet, getMode, setMode } from "./session.js"
import { setSeeMode, seeMode, callStats, tailCalls, callLogSize, type CallRecord } from "./calllog.js"
import { freshness } from "./freshness.js"
import { pons25Text } from "./pons25.js"
import { finchTopText, coverageText } from "./lists.js"

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) { console.error("TELEGRAM_BOT_TOKEN missing (expected in ../.env)"); process.exit(1) }

const bot = new Bot(token)
const ADDR = /^0x[0-9a-fA-F]{40}$/

const HELP = [
  "Finch — where your Robinhood Chain tokens came from.",
  "The Graph subgraph (Goldsky) · Uniswap V4 pools · callable via Bazantic.",
  "",
  "/process    how Finch works out an answer",
  "/forAgents  how agents call Finch (HTTP / MCP / Bazantic)",
  "",
  "",
  "① SET YOUR WALLET (once)",
  "   /account 0x…",
  "   try it:",
  "   /account 0x2a58fb44f78d7b600aec945ba8cb253896793ed3",
  "   /account 0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0",
  "",
  "② ASK",
  "   NVDA                     ← just the symbol",
  "   why did I get NVDA?",
  "   trace NVDA               ← adds the tx route + path",
  "   (one-shot: paste an address and a symbol together)",
  "",
  "   /forget   clear your wallet",
  "",
  "PONS LAUNCHES",
  "   /launches                recent launches",
  "   /launches NVDA           …paired against NVDA  (or Pons25, or FinchTop)",
  "   /grads NVDA              graduated only (now on a Uniswap V4 pool)",
  "   <token address> graduated?   check one token",
  "",
  "LISTS",
  "   /pons25     top 25 tokenized stocks by on-chain market cap",
  "   /finchtop   the tokens Finch tracks for transfers",
  "",
  "/health   index freshness",
].join("\n")

const PROCESS = [
  "How Finch answers \"why did I get this token?\"",
  "",
  "THE PROBLEM",
  "On Robinhood Chain, wallets keep receiving tokenized stocks — NVDA, COST, GLD — they never bought. Someone launches a memecoin on Pons, it graduates to a Uniswap V4 pool paired against a stock, and the creator redirects their fee cut (paid in that stock) to a holder-fee distributor that sprays it to a rotating set of holders. Your wallet just sees \"+0.09 NVDA from 0xe25e…\". No block explorer tells you which memecoin that came from, or why you. Finch reconstructs the route.",
  "",
  "1. FIND THE TRANSFER",
  "The most recent transfer of that token into your wallet — from The Graph subgraph (live window first, deep history as fallback).",
  "",
  "2. RESOLVE THE PAYER",
  "If the sender is a contract, Finch reads it on-chain: token() and quoteToken() — the token it distributes for and the asset it pays out. It cross-checks the payer against the official PonsHolderFeeManager registry (distributorOf(token) == payer), and reads epochCount(), the claim() functions in its bytecode, and whether its logic references the Uniswap V4 PoolManager.",
  "",
  "3. CONFIRM THE PATH",
  "If quoteToken() is the asset you received, the route is confirmed: that asset is token()'s creator-fee cut, taken in the currency its Uniswap V4 pool is paired against → Pons FeeEscrow → the distributor → an epoch batch that included your wallet. Finch reports the route, not a per-holder rate.",
  "",
  "4. WHAT FINCH DOESN'T CLAIM",
  "Which addresses are in a given epoch's batch is not on-chain-readable — the distributor's distribution logic is unverified source, and entry is claim-gated. If quoteToken() doesn't match, Finch says \"not confirmed\" and lists correlational candidates: tokens you hold that also have a Uniswap V4 pool paired against what you received. \"Could be\", not proof.",
  "",
  "WHAT THIS MISSES",
  "• Why your wallet, and not another holder, is in an epoch's batch — the selection rule is off-chain.",
  "• A project can fund payouts by buying the asset with its treasury, with no pool ever pairing it against that asset — invisible to this method.",
  "• Off-chain / other-rollup treasuries are invisible to Finch.",
  "• Non-Pons launchpads (lunch.fun, etc.) are not yet indexed.",
  "",
  "Data retrieval only — no signals, scores, or buy/sell calls.",
  "The Graph subgraph + Uniswap V4 pool data; callable by agents via Bazantic.",
].join("\n")

const AGENTS = [
  "Finch for agents — same backend as this bot, three ways in.",
  "",
  "1. HTTP API",
  "Base: {BASE}",
  "",
  "/query?wallet=0x…&q=<question>&format=json|prose",
  "— GET or POST; ask why a wallet received a token",
  "/health — subgraph freshness vs chain head",
  "/calls — who has called Finch (proof of real agent calls)",
  "/SKILL.md and /spec — manifest + OpenAPI",
  "",
  "2. MCP server (stdio) — Claude Code / Desktop / Cursor",
  "Tools: finch_wallet_provenance, finch_pons_activity, finch_health",
  "",
  "3. Bazantic gateway (x402/MPP, metered)",
  "Wraps the /query endpoint above.",
  "",
  "Every response carries confidence: \"signal only - not a recommendation\". Candidate tokens are correlational, never causal — and the true source can be absent entirely (treasury buys the asset and airdrops it). Only Pons is indexed; for status see /health.",
  "",
  "Full manifest: {BASE}/SKILL.md",
].join("\n")

bot.command("start", (ctx) => { clearWallet(ctx.chat.id); return ctx.reply(HELP) })
bot.command("help", (ctx) => ctx.reply(HELP))
bot.command(["process", "method", "how"], (ctx) => ctx.reply(PROCESS, { link_preview_options: { is_disabled: true } }))
bot.command(["foragents", "api"], (ctx) => ctx.reply(agentsText(), { link_preview_options: { is_disabled: true } }))
bot.command("ping", (ctx) => ctx.reply("pong"))

function agentsText(): string {
  const base = process.env.FINCH_PUBLIC_URL || "https://<finch-host>"
  return AGENTS.replaceAll("{BASE}", base)
}

bot.command("account", (ctx) => {
  const arg = ctx.match.trim()
  if (!arg) {
    const w = getWallet(ctx.chat.id)
    return ctx.reply(w ? `Your wallet is set to ${w}. Ask me why you received a token, or /forget to clear it.`
                       : "No wallet set. Use /account 0x… to set one.")
  }
  if (!ADDR.test(arg)) return ctx.reply("That doesn't look like a wallet address. Use /account 0x… (40 hex chars).")
  setWallet(ctx.chat.id, arg)
  return ctx.reply(`Wallet set to ${arg.toLowerCase()}.\nNow send a token symbol (NVDA, SPY, GME, …) or "why did I get NVDA?"`)
})

bot.command(["forget", "clear"], (ctx) => { clearWallet(ctx.chat.id); return ctx.reply("Wallet cleared.") })

bot.command(["health", "status"], async (ctx) => {
  try {
    const f = await freshness()
    const s = callStats()
    return ctx.reply(
      `The Graph subgraph (Goldsky): block ${f.subgraph_block} · chain ${f.chain_block}\n` +
      `Lag: ${f.lag_blocks.toLocaleString()} blocks (~${Math.round(f.lag_seconds / 60)} min) · ${f.fresh ? "fresh" : "backfilling"}\n` +
      `Indexing: Pons launch factory + Uniswap V4 PoolManager + stock-token transfers\n` +
      `Agents: ${s.total} calls logged (${seeMode()}) · live on the Bazantic gateway`)
  } catch (e) {
    return ctx.reply(`Health check failed: ${e}`)
  }
})

bot.command("pons25", (ctx) => ctx.reply(pons25Text(), { link_preview_options: { is_disabled: true } }))
bot.command("finchtop", (ctx) => ctx.reply(finchTopText()))

async function replyLaunches(ctx: any) {
  setMode(ctx.chat.id, "launches")
  await ctx.replyWithChatAction("typing")
  const arg = (ctx.match ?? "").toString().trim()
  const a = await answer(`what launched on pons recently ${arg}`.trim(), undefined, "launches")
  return ctx.reply(a, { link_preview_options: { is_disabled: true }, parse_mode: "HTML" })
}
bot.command(["launchespons", "launches", "pons", "recent"], replyLaunches)

async function replyGraduated(ctx: any) {
  setMode(ctx.chat.id, "launches")
  await ctx.replyWithChatAction("typing")
  const arg = (ctx.match ?? "").toString().trim()
  return ctx.reply(await answer(`graduated pons tokens ${arg}`.trim(), undefined, "launches"),
    { link_preview_options: { is_disabled: true }, parse_mode: "HTML" })
}
bot.command(["graduated", "grads", "graduates"], replyGraduated)

// Call-visibility toggles. Beyond flipping the HTTP API's log verbosity, they
// subscribe THIS chat to a live feed: the bot tails the shared call log and
// posts each new agent call here until /agentOff.
const WATCH_FILE = new URL("../.seewatch.json", import.meta.url).pathname
type Watch = { chatId: number; offset: number }
function readWatch(): Watch | null { try { return JSON.parse(readFileSync(WATCH_FILE, "utf8")) } catch { return null } }
function writeWatch(w: Watch | null) {
  try { w ? writeFileSync(WATCH_FILE, JSON.stringify(w)) : unlinkSync(WATCH_FILE) } catch { /* ignore */ }
}
function startWatching(chatId: number) { writeWatch({ chatId, offset: callLogSize() }) }

const seeAgentReply = (mode: "min" | "full") =>
  mode === "min"
    ? "Agent calls: ON — terse (time + caller). New calls appear here. /agentOff to stop."
    : "Agent calls: ON (caller, question, latency). New calls appear here. /agentOff to stop."

bot.command(["seeagent", "seeagentfull"], (ctx) => { setSeeMode("full"); startWatching(ctx.chat.id); return ctx.reply(seeAgentReply("full")) })
bot.command("seeagentmin",                (ctx) => { setSeeMode("min");  startWatching(ctx.chat.id); return ctx.reply(seeAgentReply("min")) })
bot.command("agentoff",                   (ctx) => { setSeeMode("off");  writeWatch(null); return ctx.reply("Agent calls: OFF.") })

function trimAnswer(a: string, keep = 3): string {
  const lines = a.split("\n")
  const out: string[] = []
  let bullets = 0, dropped = 0
  for (const l of lines) {
    if (/^\s*[•\-*]/.test(l)) {
      bullets++
      if (bullets <= keep) out.push(l); else dropped++
    } else out.push(l)
  }
  if (dropped) out.push(`…${dropped} more`)
  const s = out.join("\n")
  return s.length > 1200 ? s.slice(0, 1200) + " …" : s
}

function fmtCall(r: CallRecord, mode: "min" | "full"): string {
  const t = r.ts.slice(11, 19) + "Z"
  const caller = r.caller || "anonymous"
  if (mode === "min") return `↘ agent call  ${t}  ${caller}  ${r.ok ? "ok" : "err"}`
  const bits = [`↘ agent call  ${t}  ${caller}`]
  if (r.wallet) bits.push(`   wallet ${r.wallet}`)
  if (r.question) bits.push(`   q: ${r.question}`)
  bits.push(`   ${r.format} · ${r.took_ms}ms · ${r.ok ? "ok" : "err"}`)
  if (r.answer) bits.push("", "answer: " + trimAnswer(r.answer))
  return bits.join("\n")
}

async function pumpWatch() {
  const w = readWatch()
  const mode = seeMode()
  if (!w || mode === "off") return
  const { records, offset } = tailCalls(w.offset)
  if (offset !== w.offset) writeWatch({ ...w, offset })
  for (const r of records) {
    if (r.route !== "/query") continue
    try {
      await bot.api.sendMessage(w.chatId, fmtCall(r, mode === "full" ? "full" : "min"))
      console.log(`feed -> chat ${w.chatId}: ${r.caller} ${r.question || "-"}`)
    } catch (e) { console.error("feed send failed:", e) }
  }
}
setInterval(() => { pumpWatch().catch(() => {}) }, 2500)

const PONS25_RE = /^\s*pons\s*25\s*$/i
const FINCHTOP_RE = /^\s*finch\s*top\s*$/i
const COVERAGE_RE = /(pons\s*25.*finch\s*top|finch\s*top.*pons\s*25|coverage|what does finch (see|track|cover))/i

bot.on("message:text", async (ctx) => {
  const q = ctx.message.text
  // never write wallet addresses to the journal
  console.log(`msg from @${ctx.from?.username ?? ctx.from?.id}: ${q.replace(/0x[0-9a-fA-F]{40}/g, "0x…")}`)

  // Call-log toggles — accept any casing, with or without the slash
  // (Telegram commands are case-sensitive, so /agentOff misses bot.command).
  const bt = q.trim().replace(/^\//, "")
  if (/^see\s?agent\s?min$/i.test(bt))      { setSeeMode("min");  startWatching(ctx.chat.id); return ctx.reply(seeAgentReply("min")) }
  if (/^see\s?agent(\s?full)?$/i.test(bt))  { setSeeMode("full"); startWatching(ctx.chat.id); return ctx.reply(seeAgentReply("full")) }
  if (/^agent\s?off$/i.test(bt))            { setSeeMode("off");  writeWatch(null); return ctx.reply("Agent calls: OFF.") }

  // A message that is ONLY an address just sets the wallet — same as /account.
  const bare = q.trim()
  if (ADDR.test(bare)) {
    setWallet(ctx.chat.id, bare)
    return ctx.reply(`Wallet set to ${bare.toLowerCase()}.\nNow send a token symbol (NVDA, SPY, GME, …) or "why did I get NVDA?"`)
  }

  if (/^\/?(process|method|methodology|how it works)$/i.test(bare)) return ctx.reply(PROCESS, { link_preview_options: { is_disabled: true } })
  if (/^\/?(for\s?agents|api)$/i.test(bare)) return ctx.reply(agentsText(), { link_preview_options: { is_disabled: true } })
  if (COVERAGE_RE.test(q)) return ctx.reply(coverageText(), { link_preview_options: { is_disabled: true } })
  if (FINCHTOP_RE.test(q)) return ctx.reply(finchTopText())
  // bare "pons25" only shows the reference list when NOT in launches mode
  if (PONS25_RE.test(q) && getMode(ctx.chat.id) !== "launches" && !/launch/i.test(q))
    return ctx.reply(pons25Text(), { link_preview_options: { is_disabled: true } })

  // short text form, any casing, with an optional filter arg:
  //   "launches", "launches NVDA", "grads NVDA", "graduates pons25"
  let m = bare.match(/^\/?(launchespons|launches|recent launches)\b\s*(.*)$/i)
  if (m) { ctx.match = m[2]; return replyLaunches(ctx) }
  m = bare.match(/^\/?(grads?|graduates?|graduated)\b\s*(.*)$/i)
  if (m) { ctx.match = m[2]; return replyGraduated(ctx) }

  // switch context: a launch-y ask puts the chat in "launches" mode so a
  // follow-up bare symbol filters by pairing token.
  if (/(launch|what.*pons|newly|just dropped|new (token|coin))/i.test(q)) setMode(ctx.chat.id, "launches")

  await ctx.replyWithChatAction("typing")
  try {
    const a = await answer(q, getWallet(ctx.chat.id), getMode(ctx.chat.id))
    await ctx.reply(a, { link_preview_options: { is_disabled: true }, parse_mode: "HTML" })
    console.log("replied ok")
  } catch (e) {
    console.error("answer failed:", e)
    await ctx.reply("Something went wrong reaching the index. Try again in a moment.")
  }
})

bot.catch((err) => console.error("bot error:", err))

const MENU = [
  { command: "start", description: "Reset and show the intro" },
  { command: "account", description: "Set your wallet: /account 0x…" },
  { command: "forget", description: "Clear the saved wallet" },
  { command: "launches", description: "Recent Pons launches (add a symbol to filter)" },
  { command: "grads", description: "Graduated tokens on Uniswap V4 (add a symbol)" },
  { command: "finchtop", description: "The tokens Finch tracks" },
  { command: "pons25", description: "The Pons25 basket" },
  { command: "health", description: "Subgraph freshness vs chain head" },
  { command: "process", description: "How Finch answers “why did I get this token?”" },
  { command: "foragents", description: "HTTP API / MCP / Bazantic access" },
  { command: "seeagent", description: "Live feed of agent calls (on)" },
  { command: "agentoff", description: "Turn the agent-call feed off" },
]

async function main() {
  const me = await bot.api.getMe()
  console.log(`@${me.username} starting (long-polling)…`)
  await bot.api.setMyCommands(MENU).catch(e => console.error("setMyCommands failed:", e))
  await bot.start({
    onStart: (i) => console.log(`polling as @${i.username}, id ${i.id}`),
    drop_pending_updates: true,
  })
}

main()
