import { Bot } from "grammy"

// Phase: transport skeleton only. No query logic — proves long-polling works
// end to end. The NLI layer (NL -> GraphQL against the Goldsky subgraph -> NL
// answer) plugs into the message handler below later.

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) { console.error("TELEGRAM_BOT_TOKEN missing (expected in ../.env)"); process.exit(1) }

const bot = new Bot(token)

const PLACEHOLDER =
  "Finch is online (skeleton). Query logic isn't wired yet — soon I'll answer " +
  "questions about where a Robinhood Chain wallet's tokens came from and what " +
  "just launched on Pons."

bot.command("start", (ctx) => ctx.reply(PLACEHOLDER))
bot.command("ping", (ctx) => ctx.reply("pong"))

bot.on("message:text", async (ctx) => {
  console.log(`msg from @${ctx.from?.username ?? ctx.from?.id}: ${ctx.message.text}`)
  await ctx.reply(`echo: ${ctx.message.text}\n\n${PLACEHOLDER}`)
  console.log("replied")
})

bot.catch((err) => console.error("bot error:", err))

async function main() {
  const me = await bot.api.getMe()
  console.log(`@${me.username} starting (long-polling)…`)
  await bot.start({
    onStart: (i) => console.log(`polling as @${i.username}, id ${i.id}`),
    drop_pending_updates: true,
  })
}

main()
