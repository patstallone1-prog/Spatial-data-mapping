// The model behind the city's characters: DeepSeek's chat completions API (OpenAI-compatible).
//
//   DEEPSEEK_API_KEY    the key. Without it no model is called and characters answer from their
//                       set lines (docs/city/npc-talk.mjs).
//   DEEPSEEK_MODEL      the model id (default below).
//   DEEPSEEK_BASE_URL   the API's address (default https://api.deepseek.com).

//: DeepSeek V4.1 Flash, as the API's own model list names it (GET /models, 2026-11-16).
export const DEFAULT_MODEL = "deepseek-flash";
export const DEFAULT_BASE = "https://api.deepseek.com";

export function modelConfig(env = process.env) {
  if (!env.DEEPSEEK_API_KEY) return null;
  return { key: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL || DEFAULT_MODEL, base: (env.DEEPSEEK_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "") };
}

//: One reply. Throws (with ``code``) when the model can not be reached or answers nothing.
export async function chat(config, messages, { fetch: f = globalThis.fetch, timeout = 7_000, maxTokens = 500, temperature = 0.7 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await f(`${config.base}/chat/completions`, { method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
      // The model thinks before it speaks and its thinking is counted in max_tokens: low effort, and room for both.
      body: JSON.stringify({ model: config.model, messages, max_tokens: maxTokens, temperature, stream: false, reasoning_effort: "low" }) });
    if (!r.ok) { const e = new Error(`the model answered ${r.status}`); e.code = r.status === 401 || r.status === 403 ? "model_key" : r.status === 404 || r.status === 400 ? "model_request" : "model_down"; throw e; }
    const out = await r.json();
    const text = out?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) { const e = new Error("the model said nothing"); e.code = "model_empty"; throw e; }
    return { text: tidy(text), usage: out.usage || null };
  } catch (error) {
    if (error?.name === "AbortError") { const e = new Error("the model took too long"); e.code = "model_slow"; throw e; }
    throw error;
  } finally { clearTimeout(timer); }
}

//: A reply as a character would say it: one paragraph, no markup, bounded.
export function tidy(text) {
  return String(text).replace(/```[\s\S]*?```/g, " ").replace(/[*_#`>]+/g, "").replace(/\s+/g, " ").trim().slice(0, 700);
}
