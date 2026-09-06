// OpenRouter chat wrapper. Two call sites only: (1) pull structured params out
// of a free-text question, (2) phrase a raw result as prose. Never used to
// decide what a label means or to invent values.

const KEY = process.env.OPENROUTER_API_KEY
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5"

export const llmAvailable = () => !!KEY

export async function chat(system: string, user: string): Promise<string> {
  if (!KEY) throw new Error("OPENROUTER_API_KEY missing")
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      "x-title": "Finch",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  })
  if (!res.ok) throw new Error(`openrouter HTTP ${res.status}: ${await res.text()}`)
  const body = await res.json() as { choices: { message: { content: string } }[] }
  return body.choices[0]?.message?.content?.trim() ?? ""
}
