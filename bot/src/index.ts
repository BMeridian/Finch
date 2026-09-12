import { Bot, InlineKeyboard } from "grammy"
import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { spawn } from "node:child_process"
import { answer } from "./answer.js"
import { getWallet, setWallet, clearWallet, resetWalletAndSymbol, getMode, setMode, getBazrep, setBazrep, getAwaiting, setAwaiting, getSymbol, setSymbol, getCategory, setCategory } from "./session.js"
import { setSeeMode, seeMode, callStats, tailCalls, callLogSize, type CallRecord } from "./calllog.js"
import { freshness } from "./freshness.js"
import { pons25Text } from "./pons25.js"
import { finchTopText, coverageText } from "./lists.js"
import { settlementsSince } from "./x402.js"
import { runFinchGraphEns } from "./bazrecipe.js"
import { addressForSymbol } from "./tokens.js"

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) { console.error("TELEGRAM_BOT_TOKEN missing (expected in ../.env)"); process.exit(1) }

const bot = new Bot(token)
const ADDR = /^0x[0-9a-fA-F]{40}$/

// grammy's bot.command() match is case-sensitive against the registered name —
// Telegram itself doesn't care ("/bazRep" and "/bazrep" both send fine), so
// lowercase the command token before any command() filter sees it.
bot.use((ctx, next) => {
  const msg = ctx.message
  if (msg?.text?.startsWith("/")) {
    const m = msg.text.match(/^\/(\w+)/)
    if (m && m[1] !== m[1].toLowerCase()) msg.text = "/" + m[1].toLowerCase() + msg.text.slice(m[1].length + 1)
  }
  return next()
})

const HELP = [
  "Finch — a bird that listens in Sherwood Forest.",
  "It snitches on where your tokens really came from.",
  "Substreams pipeline (StreamingFast) · Uniswap V4 pools · callable via Bazantic.",
  "",
  "/process    how Finch works out an answer",
  "/forAgents  how agents call Finch (HTTP / MCP / Bazantic)",
  "",
  "",
  "① <b>SET YOUR WALLET</b> (once)",
  "   /account 0x…",
  "   try it:",
  "   /account 0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0",
  "   /account 0x36de68e810781dd7699d8fc7fe7def8aae51cec2",
  "",
  "② <b>ASK QUESTION</b>:  why did I get NVDA?",
  "   NVDA                ← just the symbol",
  "   /trace NVDA         ← adds the tx route + path",
  "   /traceENS NVDA      ← + ENS names for the wallets in the path",
  "",
  "   /forget   clear your wallet",
  "   /start    reset",
  "",
  "PONS LAUNCHES",
  "   /launches                recent launches",
  "   /launches NVDA           paired against NVDA (or Pons25, or FinchTop)",
  "   /grads NVDA              graduated only (now on a Uniswap V4 pool)",
  "",
  "BAZANTIC",
  "   /agentCall1          Fire paid x402 call, watch /seeAgentFull",
  "   /bazRep              FINCH_GRAPH_ENS — paid LLM gateway calls",
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
  "On Robinhood Chain, wallets receive tokenized stocks — NVDA, COST, GLD — they never bought.",
  "",
  "Here's how it happens. Someone launches a memecoin on Pons. It graduates to a Uniswap V4 pool paired against a stock. The creator redirects their fee cut — paid in that stock — to a holder-fee distributor. The distributor pays it out to holders.",
  "",
  "Your wallet just sees \"+0.09 NVDA from 0xe25e…\". <b>No block explorer</b> tells you which memecoin that came from, or <b>why you</b>. Finch reconstructs the route.",
  "",
  "1. FIND THE TRANSFER",
  "The most recent transfer of that token into your wallet — from the Substreams-indexed Postgres store.",
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
  "• Finch indexes transfers of 15 tokenized stocks (see /finchTop). A payout in any other asset isn't seen.",
  "• Why your wallet, and not another holder, is in an epoch's batch — the selection rule is off-chain, the distributor's logic is unverified source, and entry is claim-gated.",
  "• Recurrence counts (\"37×\") are within Finch's indexed range — earlier receipts may exist before it.",
  "• A project can fund payouts by buying the asset with its treasury, with no pool ever pairing it against that asset — invisible to this method.",
  "• Off-chain / other-rollup treasuries are invisible to Finch.",
  "• Non-Pons launchpads (lunch.fun, etc.) are not yet indexed.",
  "",
  "Data source: Substreams pipeline (StreamingFast) → Postgres + on-chain contract reads + Uniswap V4 pool data; callable by agents via Bazantic.",
].join("\n")

const AGENTS = [
  "Finch — curated access to Robinhood Chain data. Same backend as this bot, three ways in.",
  "",
  "The Graph Network doesn't index Robinhood Chain; Finch does — a pure Substreams pipeline (StreamingFast endpoint via thegraph.market) sinking to Postgres. Pons lifecycle: launch → graduation → the Uniswap V4 pool the token lands in. Finch decodes the last hop, the hard part — V4's singleton PoolManager and per-pool hooks (here, a Meme Hook) are opaque to generic indexers and block explorers.",
  "",
  "1. HTTP API",
  "Base: {BASE}",
  "",
  "/query?wallet=0x…&q=<question>&format=json|prose",
  "— GET or POST; ask why a wallet received a token",
  "/ens?addresses=0x…,0x… — reverse-resolve to .eth via The Graph's ENS subgraph",
  "/SKILL.md — manifest",
  "/calls — who has called Finch (proof of real agent calls)",
  "/spec — OpenAPI",
  "/health — index freshness vs chain head",
  "",
  "2. MCP server (stdio) — Claude Code / Desktop / Cursor",
  "Tools: finch_wallet_provenance, finch_pons_activity, finch_health",
  "",
  "3. Bazantic gateway (x402/MPP, metered on Base)",
  "Bazantic Recipe, FINCH_GRAPH_ENS, chains /query + /ens.",
  "/bazRep — runs FINCH_GRAPH_ENS",
  "",
  "Every response carries confidence: \"signal only - not a recommendation\". Candidate tokens are correlational, never causal — and the true source can be absent entirely (treasury buys the asset and airdrops it). Only Pons is indexed; for status see /health.",
  "",
  "Full manifest: {BASE}/SKILL.md",
  "",
  "Watch it happen — turn on a live feed of agent calls in this chat:",
  "/seeAgent — full record (caller, question, answer)",
  "/agentOff — stop",
].join("\n")

// Button UI — a FOMO-bot-style status/menu card, layered on top of the
// existing text commands (all of which still work as typed).
async function menuText(chatId: number): Promise<string> {
  const w = getWallet(chatId)
  let idx = "checking…"
  try {
    const f = await freshness()
    idx = `${f.fresh ? "🟢 fresh" : "🟡 catching up"} · lag ${Math.round(f.lag_seconds / 60)}m`
  } catch { idx = "🔴 unavailable" }
  return [
    "🐦 <b>FINCH</b>",
    "Traces where tokenized stock tokens really came from — a Pons launch → its Uniswap V4 route — on Robinhood Chain.",
    "",
    `👛 Wallet: <b>${w ?? "Not connected"}</b>`,
    `📡 Index: ${idx}`,
    `🏷️ Tracked: 15 tokens · Pons + Uniswap V4`,
    "",
    "<i>Select an action below.</i>",
  ].join("\n")
}

// Tacked onto answer replies so the menu is one tap away — no scrolling back
// up. Returns to whichever category (Humans/Lists/AI-Agents) the user was
// browsing, not always the top-level menu.
function backToMenuKb(chatId: number): InlineKeyboard {
  const cat = getCategory(chatId)
  return cat ? new InlineKeyboard().text("◀ Back", `cat:${cat}`) : new InlineKeyboard().text("🐦 Menu", "menu")
}

// Top-level menu: just the 3 categories. Each opens its own sub-menu (with a
// Back button) rather than dumping every button on one page.
const menuKb = new InlineKeyboard()
  .text("👤 Humans", "cat:humans").text("🤖 AI / Agents", "cat:agents").row()
  .text("📋 Lists", "cat:lists").text("❤️ Health", "health").row()

const subKb = {
  humans: new InlineKeyboard()
    .text("📍 Set Wallet", "setwallet").text("🔍 Symbol", "ask").row()
    .text("🧭 Trace", "trace").text("🧭 Trace ENS", "traceens").row()
    .text("🗑️ Forget", "forget").text("📖 How It Works", "howitworks").row()
    .text("◀ Back", "menu"),
  lists: new InlineKeyboard()
    .text("🚀 Launches", "launches").text("🎓 Grads", "grads").row()
    .text("📊 Pons25", "pons25").text("🐦 FinchTop", "finchtop").row()
    .text("◀ Back", "menu"),
  agents: new InlineKeyboard()
    .text("🧾 Bazantic", "bazantic").text("🤖 For Agents", "foragents").row()
    .text("👁️ See Agents", "seeagents").text("🛑 Agents Off", "agentoff").row()
    .text("◀ Back", "menu"),
} as const

const bazanticKb = new InlineKeyboard()
  .text("📞 Demo Call", "agentcall1").text("🧾 Bazantic Recipe", "bazrep").row()
  .text("◀ Back", "cat:agents")

const catTitle = { humans: "👤 <b>HUMANS</b>", lists: "📋 <b>LISTS</b>", agents: "🤖 <b>AI / AGENTS</b>" } as const

const NEWVERSION = [
  "🆕 <b>Finch — button UI writeup</b>",
  "",
  "<b>What's new</b>",
  "/start now opens a short welcome card (like FOMO's) with 3 buttons: Set My Wallet, Open Finch Menu, How It Works — instead of a wall of text.",
  "/menu is a new status card (wallet, index freshness, tracked-token count) with a button grid: Ask · Trace · Launches · Grads · Pons25 · FinchTop · For Agents · Health · Set Wallet · Forget.",
  "",
  "<b>How it's wired</b>",
  "Every button fires a callback_query that calls the exact same function the equivalent typed command already used (replyLaunches, pons25Text, freshness, …) — no logic was duplicated, so the two UIs can't drift apart.",
  "",
  "<b>What still works, unchanged</b>",
  "/account /trace /traceENS /launches /grads /pons25 /finchtop /health /forAgents /bazRep /seeAgent — every typed command from the old flow still answers exactly as before.",
  "",
  "<b>What's untouched</b>",
  "/help still shows the full old text menu (HELP const) — that's the text-only path this is meant to replace once you're happy with the buttons.",
  "",
  "<b>Next step, on your go-ahead</b>",
  "Drop the text-only /help wall and make /start → button welcome the only entry point (menu commands stay registered for power users/agents).",
].join("\n")

bot.command("newversion", (ctx) => ctx.reply(NEWVERSION, { parse_mode: "HTML" }))

bot.command("start", async (ctx) => { clearWallet(ctx.chat.id); return ctx.reply(await menuText(ctx.chat.id), { parse_mode: "HTML", reply_markup: menuKb }) })
bot.command("menu", async (ctx) => { clearWallet(ctx.chat.id); return ctx.reply(await menuText(ctx.chat.id), { parse_mode: "HTML", reply_markup: menuKb }) })
bot.command("help", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }))
bot.command(["process", "method", "how"], (ctx) => ctx.reply(PROCESS, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }))
bot.command(["foragents", "api"], (ctx) => ctx.reply(agentsText(), { link_preview_options: { is_disabled: true } }))
bot.command("ping", (ctx) => ctx.reply("pong"))

// /agentCall1 — fire a real paid Bazantic gateway call as a background agent
// would, with no reply shown here. Discover the endpoint, then a real x402
// call ($0.00001 USDC, Base) settled from the "finch" grant. The point is the
// live /seeAgentFull feed picking it up as an incoming agent call, not this
// chat's own reply — this command is deliberately blind.
function fireAgentCall1(ctx: any) {
  // Demo Call is a one-tap Bazantic x402 flow: turn the live feed on (if it
  // isn't already) so the paid call's settlement shows up right here, then fire.
  setSeeMode("full")
  startWatching(ctx.chat.id)
  const cmd = `ENDPOINT=$(baz gateway list --json | python3 -c 'import sys,json; xs=[g["endpointUrl"] for g in json.load(sys.stdin)["listings"] if g["name"]=="Finch" and g["status"]=="active"]; print(xs[0] if xs else "")'); [ -n "$ENDPOINT" ] && baz curl "$ENDPOINT/query?q=graduated+pons+tokens+SPCX&format=prose" --account finch2 --max-amount 0.02 --yes --json`
  const child = spawn("bash", ["-lc", cmd], { detached: true, stdio: "ignore" })
  child.unref()
  return ctx.reply("Demo call fired — a real x402 payment, watch for the settlement below.")
}
bot.command("agentcall1", fireAgentCall1)

// /bazrep — run the PUBLISHED Bazantic recipe FINCH_GRAPH_ENS. Bazantic drives
// an LLM that chains Finch's own paid gateway tools (finchQuery -> ensResolve)
// and composes the answer. The bot is just another agent calling the recipe.
async function runBazrep(ctx: any, wallet: string, symbol?: string) {
  setBazrep(ctx.chat.id, undefined)
  await ctx.replyWithChatAction("typing")
  await ctx.reply("Running Bazantic recipe <b>FINCH_GRAPH_ENS</b> … (LLM chains finchQuery → ensResolve, ~40s)", { parse_mode: "HTML" })
  // Bazantic's recipe gateway has a hard ~30s timeout that a full epoch batch
  // sometimes runs over (LLM-generation time, not network latency) — retry
  // the whole recipe once, visibly, rather than silently eating the loss.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await runFinchGraphEns(wallet, symbol)
      return await ctx.reply(
        `<b>Bazantic recipe · FINCH_GRAPH_ENS</b>  <i>${feedEsc(r.gateway.replace(/^https:\/\//, ""))}</i>\n\n` +
        feedEsc(r.output).slice(0, 3500),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: backToMenuKb(ctx.chat.id) })
    } catch (e) {
      if (attempt === 1) { await ctx.reply("First attempt hit the gateway's timeout — retrying once…"); continue }
      await ctx.reply(`recipe failed twice: ${feedEsc(String(e))} — try /bazRep again in a moment`)
    }
  }
}

function startBazrepPrompt(ctx: any) {
  setBazrep(ctx.chat.id, { step: "wallet" })
  return ctx.reply(
    "Bazantic recipe: <b>FINCH_GRAPH_ENS</b>\n" +
    "<i>Finch provenance (Substreams-indexed Pons → Uniswap V4 route) → ENS names " +
    "(The Graph's ENS subgraph) — LLM-driven, a paid gateway call.</i>\n\n" +
    "Wallet (0x…), try: <code>0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0</code>",
    { parse_mode: "HTML" })
}

bot.command(["bazrep", "bazrecipe"], async (ctx) => {
  const m = (ctx.match ?? "").toString().match(/(0x[0-9a-fA-F]{40})(?:\s+([A-Za-z]{1,8}))?/)
  if (m) return runBazrep(ctx, m[1], m[2])          // one-liner: /bazrep 0x… NVDA
  return startBazrepPrompt(ctx)                      // guided: ask for the fields
})

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

// /trace NVDA — the confirmed route for a received token.
// /traceENS NVDA — same, plus resolve the addresses to ENS names (chained: the
// Finch answer's addresses feed a forward-record lookup on The Graph Network's
// canonical ENS subgraph).
async function replyTrace(ctx: any, withEns: boolean) {
  const w = getWallet(ctx.chat.id)
  if (!w) return ctx.reply("Set your wallet first: /account 0x…")
  const sym = (ctx.match ?? "").toString().trim()
  if (!sym) return ctx.reply(`Usage: /${withEns ? "traceENS" : "trace"} NVDA — the token symbol you want the route for.`)
  setSymbol(ctx.chat.id, sym)
  await ctx.replyWithChatAction("typing")
  const q = `trace ${sym}${withEns ? " and resolve the addresses to ENS names" : ""}`
  return ctx.reply(await answer(q, w, "wallet"),
    { link_preview_options: { is_disabled: true }, parse_mode: "HTML", reply_markup: backToMenuKb(ctx.chat.id) })
}
// Menu commands must be lowercase (Telegram setMyCommands rejects uppercase),
// but a manually-typed command is delivered verbatim — so match any casing.
bot.hears(/^\/trace(ns|ens)\b(?:@\w+)?\s*(.*)$/i, (ctx) => { ctx.match = ctx.match?.[2] ?? ""; return replyTrace(ctx, true) })
bot.hears(/^\/trace\b(?:@\w+)?\s*(.*)$/i, (ctx) => { ctx.match = ctx.match?.[1] ?? ""; return replyTrace(ctx, false) })

bot.command(["health", "status"], async (ctx) => {
  try {
    const f = await freshness()
    const s = callStats()
    return ctx.reply(
      `Substreams sink (StreamingFast → Postgres): block ${f.subgraph_block} · chain ${f.chain_block}\n` +
      `Lag: ${f.lag_blocks.toLocaleString()} blocks (~${Math.round(f.lag_seconds / 60)} min) · ${f.fresh ? "keeping pace" : "catching up"}\n` +
      `Indexing: Pons launch factory + graduations + Uniswap V4 pool inits + stock-token transfers\n` +
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
  return ctx.reply(a, { link_preview_options: { is_disabled: true }, parse_mode: "HTML", reply_markup: backToMenuKb(ctx.chat.id) })
}
bot.command(["launchespons", "launches", "pons", "recent"], replyLaunches)

async function replyGraduated(ctx: any) {
  setMode(ctx.chat.id, "launches")
  await ctx.replyWithChatAction("typing")
  const arg = (ctx.match ?? "").toString().trim()
  return ctx.reply(await answer(`graduated pons tokens ${arg}`.trim(), undefined, "launches"),
    { link_preview_options: { is_disabled: true }, parse_mode: "HTML", reply_markup: backToMenuKb(ctx.chat.id) })
}
bot.command(["graduated", "grads", "graduates"], replyGraduated)

// Call-visibility toggles. Beyond flipping the HTTP API's log verbosity, they
// subscribe THIS chat to a live feed: the bot tails the shared call log and
// posts each new agent call here until /agentOff.
const WATCH_FILE = new URL("../.seewatch.json", import.meta.url).pathname
type Watch = { chatId: number; offset: number; settleBlock?: number }
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
bot.command("seeagentmin", (ctx) => { setSeeMode("min"); startWatching(ctx.chat.id); return ctx.reply(seeAgentReply("min")) })
bot.command("agentoff", (ctx) => { setSeeMode("off"); writeWatch(null); return ctx.reply("Agent calls: OFF.") })

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

// feed messages go out with parse_mode "HTML" — escape all dynamic text
const feedEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function fmtCall(r: CallRecord, mode: "min" | "full"): string {
  const t = r.ts.slice(11, 19) + "Z"
  const caller = feedEsc(r.caller || "anonymous")
  if (mode === "min") return `↘ agent call  ${t}  ${caller}  ${r.ok ? "ok" : "err"}`
  const bits = [`↘ agent call  ${t}  ${caller}`]
  if (r.wallet) bits.push(`   wallet ${feedEsc(r.wallet)}`)
  if (r.question) bits.push(`   q: <b>${feedEsc(r.question)}</b>`)
  bits.push(`   ${r.format} · ${r.took_ms}ms · ${r.ok ? "ok" : "err"}`)
  // r.answer is Finch's own generated text — for format=prose it already
  // carries intentional HTML (<b>, etc.) meant to render, so don't re-escape
  // it (that would show literal tags); only caller-supplied fields get feedEsc.
  if (r.answer) bits.push("", "answer: " + trimAnswer(r.answer))
  return bits.join("\n")
}

async function pumpWatch() {
  const w = readWatch()
  const mode = seeMode()
  if (!w || mode === "off") return
  const { records, offset } = tailCalls(w.offset)
  let settleBlock = w.settleBlock ?? 0
  // Bazantic sends no payment header. Pull USDC settlements to the gateway payTo
  // off Base and hand them out to bazantic: calls in order — one tx per call.
  const wantsSettlement = records.some(r => r.route === "/query" && r.caller.startsWith("bazantic:") && (r.wallet || r.question) && r.ok)
  const settlements = wantsSettlement ? await settlementsSince(settleBlock).catch(() => []) : []
  let si = 0

  for (const r of records) {
    if (r.route !== "/query") continue
    // the feed is "proof of real agent calls" — skip price probes (no wallet,
    // no question), error responses, and localhost callers (internal plumbing:
    // the /bazrep recipe's own finchQuery hop, local curl testing).
    if (!r.wallet && !r.question) continue
    if (!r.ok || /^\{"error"/.test(r.answer ?? "")) continue
    if (r.caller === "::1" || r.caller === "127.0.0.1" || r.caller === "anonymous") continue
    try {
      let msg = fmtCall(r, mode === "full" ? "full" : "min")
      let txLine = ""
      if (r.caller.startsWith("bazantic:")) {
        const s = settlements[si++]
        if (s) settleBlock = Math.max(settleBlock, s.block)
        const paid = s
          ? `   💸 <b>$${(+s.amount_usdc).toString()} x402</b> · tx ${feedEsc(s.tx.slice(0, 10) + "…" + s.tx.slice(-6))} (Base)`
          : `   💸 <b>x402 paid</b> (Base) · settlement tx not found yet`
        msg = msg.includes("\n") ? msg.replace("\n", "\n" + paid + "\n") : msg + "\n" + paid
        if (s) txLine = `\n\n<a href="https://basescan.org/tx/${s.tx}">${feedEsc(s.tx)}</a>`
      }
      await bot.api.sendMessage(w.chatId, msg + txLine, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: backToMenuKb(w.chatId) })
      console.log(`feed -> chat ${w.chatId}: ${r.caller} ${r.question || "-"}`)
    } catch (e) { console.error("feed send failed:", e) }
  }
  if (offset !== w.offset || settleBlock !== (w.settleBlock ?? 0)) writeWatch({ ...w, offset, settleBlock })
}
setInterval(() => { pumpWatch().catch(() => { }) }, 2500)

const PONS25_RE = /^\s*pons\s*25\s*$/i
const FINCHTOP_RE = /^\s*finch\s*top\s*$/i
const COVERAGE_RE = /(pons\s*25.*finch\s*top|finch\s*top.*pons\s*25|coverage|what does finch (see|track|cover))/i

bot.on("message:text", async (ctx) => {
  const q = ctx.message.text
  // never write wallet addresses to the journal
  console.log(`msg from @${ctx.from?.username ?? ctx.from?.id}: ${q.replace(/0x[0-9a-fA-F]{40}/g, "0x…")}`)

  // /bazrep guided flow takes priority over a stale button "awaiting" state —
  // collect Wallet then Symbol, then run the recipe.
  const br = getBazrep(ctx.chat.id)
  if (br) {
    const t = q.trim()
    if (/^(cancel|stop|nvm|\/cancel)$/i.test(t)) { setBazrep(ctx.chat.id, undefined); return ctx.reply("Recipe cancelled.") }
    if (br.step === "wallet") {
      const m = t.match(/0x[0-9a-fA-F]{40}/)
      if (!m) return ctx.reply("Send a wallet address (0x… 40 hex), or 'cancel'.")
      setBazrep(ctx.chat.id, { step: "symbol", wallet: m[0].toLowerCase() })
      return ctx.reply("Symbol (default NVDA):")
    }
    if (br.step === "symbol") {
      const sym = /^[–\-]$|^skip$|^default$/i.test(t) ? undefined : t.replace(/[^A-Za-z]/g, "").slice(0, 8).toUpperCase()
      return runBazrep(ctx, br.wallet!, sym || undefined)
    }
  }

  // Symbol / Trace / TraceENS button flow: the button asked for a symbol, this message is it.
  const awaiting = getAwaiting(ctx.chat.id)
  if (awaiting) {
    setAwaiting(ctx.chat.id, undefined)
    const sym = q.trim()
    setSymbol(ctx.chat.id, sym.replace(/[^A-Za-z]/g, "").slice(0, 8) || sym)
    try {
      if (awaiting === "symbol") {
        await ctx.replyWithChatAction("typing")
        const a = await answer(sym, getWallet(ctx.chat.id), getMode(ctx.chat.id))
        return await ctx.reply(a, { link_preview_options: { is_disabled: true }, parse_mode: "HTML", reply_markup: backToMenuKb(ctx.chat.id) })
      }
      if (awaiting === "launches" || awaiting === "grads") {
        ctx.match = sym
        return await (awaiting === "launches" ? replyLaunches(ctx) : replyGraduated(ctx))
      }
      ctx.match = sym
      return await replyTrace(ctx, awaiting === "traceens")
    } catch (e) {
      console.error("awaiting-symbol reply failed:", e)
      return ctx.reply("Something went wrong reaching the index. Try again in a moment.")
    }
  }

  // Call-log toggles — accept any casing, with or without the slash
  // (Telegram commands are case-sensitive, so /agentOff misses bot.command).
  const bt = q.trim().replace(/^\//, "")
  if (/^see\s?agent\s?min$/i.test(bt)) { setSeeMode("min"); startWatching(ctx.chat.id); return ctx.reply(seeAgentReply("min")) }
  if (/^see\s?agent(\s?full)?$/i.test(bt)) { setSeeMode("full"); startWatching(ctx.chat.id); return ctx.reply(seeAgentReply("full")) }
  if (/^agent\s?off$/i.test(bt)) { setSeeMode("off"); writeWatch(null); return ctx.reply("Agent calls: OFF.") }

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

  // any free-text question that names a known symbol (bare "NVDA", "why did I
  // get NVDA?", …) caches it — so the Trace / TraceENS buttons can reuse it.
  const symMatch = bare.toUpperCase().match(/\b([A-Z]{2,8})\b/)
  if (symMatch && addressForSymbol(symMatch[1])) setSymbol(ctx.chat.id, symMatch[1])

  await ctx.replyWithChatAction("typing")
  try {
    const a = await answer(q, getWallet(ctx.chat.id), getMode(ctx.chat.id))
    await ctx.reply(a, { link_preview_options: { is_disabled: true }, parse_mode: "HTML", reply_markup: backToMenuKb(ctx.chat.id) })
    console.log("replied ok")
  } catch (e) {
    console.error("answer failed:", e)
    await ctx.reply("Something went wrong reaching the index. Try again in a moment.")
  }
})

// Inline-button dispatch — reuses the exact same handlers the typed commands
// call, so button UI and text UI never drift apart.
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data
  console.log(`button from @${ctx.from?.username ?? ctx.from?.id}: ${data}`)
  await ctx.answerCallbackQuery().catch((e) => console.error("answerCallbackQuery failed:", e))
  if (data.startsWith("cat:")) {
    const cat = data.slice(4) as keyof typeof subKb
    const kb = subKb[cat]
    if (!kb) return
    setCategory(ctx.chat!.id, cat)
    const text = `${catTitle[cat]}\n\n<i>Select an action below.</i>`
    return ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(() => ctx.reply(text, { parse_mode: "HTML", reply_markup: kb }))
  }
  switch (data) {
    case "menu": {
      clearWallet(ctx.chat!.id)
      const text = await menuText(ctx.chat!.id)
      return ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: menuKb }).catch(() => ctx.reply(text, { parse_mode: "HTML", reply_markup: menuKb }))
    }
    case "howitworks": return ctx.reply(PROCESS, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: backToMenuKb(ctx.chat!.id) })
    case "setwallet":
      resetWalletAndSymbol(ctx.chat!.id)
      return ctx.reply("Wallet + symbol reset. Send your wallet address (0x… 40 hex chars) — try <code>0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0</code>", { parse_mode: "HTML" })
    case "forget": clearWallet(ctx.chat!.id); return ctx.reply("Wallet cleared.")
    case "ask": {
      if (!getWallet(ctx.chat!.id)) return ctx.reply("Set your wallet first: tap 📍 Set My Wallet.")
      setAwaiting(ctx.chat!.id, "symbol")
      return ctx.reply("Send a token symbol (NVDA, SPY, GME, …) or ask \"why did I get NVDA?\"")
    }
    case "trace": {
      if (!getWallet(ctx.chat!.id)) return ctx.reply("Set your wallet first: tap 📍 Set My Wallet.")
      const sym = getSymbol(ctx.chat!.id)
      if (sym) { ctx.match = sym; return replyTrace(ctx, false) }
      setAwaiting(ctx.chat!.id, "trace")
      return ctx.reply("Send the token symbol you want the route for (e.g. NVDA):")
    }
    case "traceens": {
      if (!getWallet(ctx.chat!.id)) return ctx.reply("Set your wallet first: tap 📍 Set My Wallet.")
      const sym = getSymbol(ctx.chat!.id)
      if (sym) { ctx.match = sym; return replyTrace(ctx, true) }
      setAwaiting(ctx.chat!.id, "traceens")
      return ctx.reply("Send the token symbol — Finch will trace the route and resolve the addresses to ENS names (e.g. NVDA):")
    }
    case "launches":
      ctx.match = ""; setAwaiting(ctx.chat!.id, "launches")
      await replyLaunches(ctx)
      return ctx.reply("Send a symbol (e.g. SPCX) to filter, or ignore this.")
    case "grads":
      ctx.match = ""; setAwaiting(ctx.chat!.id, "grads")
      await replyGraduated(ctx)
      return ctx.reply("Send a symbol (e.g. SPCX) to filter, or ignore this.")
    case "pons25": return ctx.reply(pons25Text(), { link_preview_options: { is_disabled: true }, reply_markup: backToMenuKb(ctx.chat!.id) })
    case "finchtop": return ctx.reply(finchTopText(), { reply_markup: backToMenuKb(ctx.chat!.id) })
    case "noop": return
    case "foragents": return ctx.reply(agentsText(), { link_preview_options: { is_disabled: true }, reply_markup: backToMenuKb(ctx.chat!.id) })
    case "coverage": return ctx.reply(coverageText(), { link_preview_options: { is_disabled: true }, reply_markup: backToMenuKb(ctx.chat!.id) })
    case "bazantic": {
      const text = "🧾 <b>BAZANTIC</b>\n\n<i>Select an action below.</i>"
      return ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: bazanticKb }).catch(() => ctx.reply(text, { parse_mode: "HTML", reply_markup: bazanticKb }))
    }
    case "agentcall1": return fireAgentCall1(ctx)
    case "bazrep": return startBazrepPrompt(ctx)
    case "seeagents": setSeeMode("full"); startWatching(ctx.chat!.id); return ctx.reply(seeAgentReply("full"), { reply_markup: backToMenuKb(ctx.chat!.id) })
    case "agentoff": setSeeMode("off"); writeWatch(null); return ctx.reply("Agent calls: OFF.", { reply_markup: backToMenuKb(ctx.chat!.id) })
    case "newversion": return ctx.reply(NEWVERSION, { parse_mode: "HTML", reply_markup: backToMenuKb(ctx.chat!.id) })
    case "health": {
      try {
        const f = await freshness()
        const s = callStats()
        return ctx.reply(
          `Substreams sink (StreamingFast → Postgres): block ${f.subgraph_block} · chain ${f.chain_block}\n` +
          `Lag: ${f.lag_blocks.toLocaleString()} blocks (~${Math.round(f.lag_seconds / 60)} min) · ${f.fresh ? "keeping pace" : "catching up"}\n` +
          `Indexing: Pons launch factory + graduations + Uniswap V4 pool inits + stock-token transfers\n` +
          `Agents: ${s.total} calls logged (${seeMode()}) · live on the Bazantic gateway`,
          { reply_markup: backToMenuKb(ctx.chat!.id) })
      } catch (e) { return ctx.reply(`Health check failed: ${e}`) }
    }
  }
})

bot.catch((err) => console.error("bot error:", err))

const MENU = [
  { command: "newversion", description: "What changed in the new button UI" },
  { command: "process", description: "How Finch answers “why did I get this token?”" },
  { command: "foragents", description: "HTTP API / MCP / Bazantic access" },
  { command: "pons25", description: "The Pons25 basket" },
  { command: "finchtop", description: "The tokens Finch tracks" },
  { command: "account", description: "Set your wallet: /account 0x…" },
  { command: "forget", description: "Clear the saved wallet" },
  { command: "trace", description: "Confirmed route for a received token: /trace NVDA" },
  { command: "traceens", description: "/trace + resolve the addresses to ENS names" },
  { command: "launches", description: "Recent Pons launches (add a symbol to filter)" },
  { command: "grads", description: "Graduated tokens on Uniswap V4 (add a symbol)" },
  { command: "seeagent", description: "Live feed of agent calls (on)" },
  { command: "agentoff", description: "Turn the agent-call feed off" },
  { command: "agentcall1", description: "Fire a blind paid x402 call (watch /seeAgentFull)" },
  { command: "bazrep", description: "Run the published Bazantic recipe (Finch → ENS)" },
  { command: "health", description: "Index freshness vs chain head" },
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
