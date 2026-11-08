import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Game } from "../src/shared/types";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MAX = 30;

interface EnrichOptions {
  max: number;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
}

interface GroqConfig {
  groqModel?: string;
}

async function getModel(env: NodeJS.ProcessEnv, configPath: string): Promise<string | null> {
  if (env.GROQ_MODEL?.trim()) return env.GROQ_MODEL.trim();
  try {
    const config = JSON.parse(await readFile(resolve(configPath), "utf8")) as GroqConfig;
    if (typeof config.groqModel === "string" && config.groqModel.trim()) return config.groqModel.trim();
  } catch {
    // A missing or malformed local config should not prevent updates.
  }
  return null;
}

async function summarize(description: string, store: string, apiKey: string, model: string): Promise<string | null> {
  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 120,
        messages: [
          { role: "system", content: "入力の説明文に書かれた事実だけを使い、日本語で60字以内の簡潔な一行紹介を作ってください。説明にない事実や推測を加えず、ストア名をそのまま紹介文に含めないでください。紹介文だけを返してください。" },
          { role: "user", content: `ストア: ${store}\n説明文: ${description}` }
        ]
      })
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const cleaned = content.trim().replace(/^[「『"']|[」』"']$/g, "").replace(/\s+/g, " ");
    if (!cleaned) return null;
    return Array.from(cleaned).slice(0, 60).join("");
  } catch {
    // Keep enrichment failures local to this game and never log request data or credentials.
    return null;
  }
}

/** Adds short Japanese summaries to eligible games while preserving all records on failure. */
export async function enrich(games: Game[], opts: EnrichOptions = { max: DEFAULT_MAX }): Promise<Game[]> {
  const env = opts.env ?? process.env;
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return games.map(game => ({ ...game }));

  const max = Number.isFinite(opts.max) ? Math.max(0, Math.floor(opts.max)) : DEFAULT_MAX;
  const candidates = games.flatMap((game, index) =>
    !game.summaryJa?.trim() && game.descriptionOrig?.trim() ? [{ game, index }] : []
  ).slice(0, max);
  if (candidates.length === 0) return games.map(game => ({ ...game }));

  const model = await getModel(env, opts.configPath ?? "config.json");
  if (!model) return games.map(game => ({ ...game }));
  const result = games.map(game => ({ ...game }));
  for (const { game, index } of candidates) {
    const summary = await summarize(game.descriptionOrig!, game.store, apiKey, model);
    if (summary) result[index] = { ...result[index], summaryJa: summary };
  }
  return result;
}
