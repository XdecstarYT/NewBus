/**
 * AI helpers. The key comes from the Netlify environment variable AIK and picks
 * the provider: a Groq key (gsk_...) uses Groq, a Claude key (sk-ant-...) uses
 * Claude. Every call asks for JSON that matches a schema and is checked against
 * it, so the game never has to guess what came back. Without a key the game
 * falls back to its built-in content.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';

const key = () => (process.env.AIK || process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim();

export type Provider = 'groq' | 'claude';
/** Groq keys start with gsk_; anything starting with sk-ant- is Claude. Unknown keys are tried on Groq. */
export const aiProvider = (): Provider => (key().startsWith('sk-ant-') ? 'claude' : 'groq');
const DEFAULT_MODEL: Record<Provider, string> = { groq: 'auto', claude: 'claude-opus-5-5' };
/** The model in use. On Groq it is picked from the models the key can use (see groqModel). */
export const aiModel = () => (process.env.AIK_MODEL || '').trim() || (aiProvider() === 'groq' ? (groqPicked ?? 'auto') : DEFAULT_MODEL.claude);

export type AiRunner = <S extends z.ZodType>(schema: S, system: string, prompt: string, opts?: { timeoutMs?: number; maxTokens?: number }) => Promise<z.infer<S>>;
let override: AiRunner | null = null;
/** Tests plug in a fake AI here. */
export function setAiForTests(fn: AiRunner | null) {
  override = fn;
}

export function aiAvailable() {
  return !!override || key().length > 10;
}

const stats = { calls: 0, failures: 0, lastError: null as string | null };

export function aiStatus() {
  const k = key();
  return {
    configured: !!override || k.length > 10,
    provider: aiProvider(),
    keyLooksRight: k.startsWith('gsk_') || k.startsWith('sk-ant-'),
    models: groqModels,
    model: aiModel(),
    calls: stats.calls,
    failures: stats.failures,
    lastError: stats.lastError,
  };
}

export class AiError extends Error {}

/** Ask the AI for JSON matching `schema`. Throws AiError when unavailable, refused or too slow. */
export async function aiJson<S extends z.ZodType>(schema: S, system: string, prompt: string, opts: { timeoutMs?: number; maxTokens?: number } = {}): Promise<z.infer<S>> {
  if (override) return override(schema, system, prompt, opts);
  if (!aiAvailable()) throw new AiError('No AI key: set AIK in Netlify to turn AI on.');
  stats.calls++;
  try {
    return aiProvider() === 'claude' ? await claudeJson(schema, system, prompt, opts) : await groqJson(schema, system, prompt, opts);
  } catch (e) {
    stats.failures++;
    stats.lastError = e instanceof Error ? e.message.slice(0, 300) : String(e);
    if (e instanceof AiError) throw e;
    throw new AiError(`AI error: ${stats.lastError}`);
  }
}

// ------------------------------------------------------------ Groq (OpenAI-compatible chat API)
const GROQ = 'https://api.groq.com/openai/v1';
type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

/** Best general chat models first. Groq retires models over time, so we ask which ones this key has. */
const GROQ_PREFERRED = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
const NOT_CHAT = /whisper|tts|guard|embed|playai|orpheus|compound|safeguard|vision/i;
let groqPicked: string | null = null;
let groqModels: string[] = [];

/** Pick a model: AIK_MODEL if set, else the best one Groq lists for this key (cached). */
async function groqModel(timeoutMs: number, refresh = false) {
  const set = (process.env.AIK_MODEL || '').trim();
  if (set) return set;
  if (groqPicked && !refresh) return groqPicked;
  let res: Response;
  try {
    res = await fetch(`${GROQ}/models`, { headers: { authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(Math.max(500, Math.min(4000, timeoutMs))) });
  } catch {
    throw new AiError('Could not reach Groq to list its models. Try again in a minute.');
  }
  if (res.status === 401 || res.status === 403) throw new AiError('The AI key (AIK) was rejected by Groq. Check it in Netlify.');
  const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; active?: boolean }> };
  groqModels = (body.data ?? []).filter((m) => m.active !== false && !NOT_CHAT.test(m.id)).map((m) => m.id);
  const pick = GROQ_PREFERRED.find((m) => groqModels.includes(m)) ?? groqModels.find((m) => /gpt-oss|llama|qwen|kimi|mixtral|gemma/i.test(m)) ?? groqModels[0];
  if (!pick) throw new AiError(`Groq did not list any chat models for this key (status ${res.status}).`);
  groqPicked = pick;
  return pick;
}

async function groqChat(messages: Msg[], maxTokens: number, timeoutMs: number, model: string) {
  let res: Response;
  try {
    res = await fetch(`${GROQ}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.6,
        // reasoning models spend tokens thinking first: keep that short and leave room for the answer
        max_completion_tokens: Math.max(maxTokens, 1500),
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : model.startsWith('qwen/qwen3') ? { reasoning_effort: 'none' } : {}),
      }),
      signal: AbortSignal.timeout(Math.max(500, timeoutMs)),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new AiError('The AI took too long.');
    throw new AiError(`Could not reach Groq: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string }; choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
  if (res.status === 401 || res.status === 403) throw new AiError('The AI key (AIK) was rejected by Groq. Check it in Netlify.');
  if (res.status === 429) throw new AiError('The AI is busy (Groq rate limit). Try again in a minute.');
  if (res.status === 404 || body.error?.code === 'model_not_found' || /model.*(decommissioned|does not exist|not found)/i.test(body.error?.message ?? '')) throw new ModelGone(model, body.error?.message ?? '');
  if (!res.ok) throw new AiError(`Groq error ${res.status}: ${body.error?.message ?? 'unknown'}`.slice(0, 300));
  return body.choices?.[0]?.message?.content ?? '';
}

class ModelGone extends AiError {
  constructor(
    public model: string,
    detail: string,
  ) {
    super(`Groq can not use the model "${model}"${detail ? ` (${detail})` : ''}.`);
  }
}

async function groqJson<S extends z.ZodType>(schema: S, system: string, prompt: string, opts: { timeoutMs?: number; maxTokens?: number }): Promise<z.infer<S>> {
  const deadline = Date.now() + (opts.timeoutMs ?? 8000);
  let model = await groqModel(deadline - Date.now());
  const shape = JSON.stringify(z.toJSONSchema(schema));
  const messages: Msg[] = [
    { role: 'system', content: `${system}\n\nReply with only one JSON object (no other text) that matches this JSON Schema exactly, with every required field:\n${shape}` },
    { role: 'user', content: prompt },
  ];
  // one retry if the reply does not match, while there is time left
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = await groqChat(messages, opts.maxTokens ?? 2000, deadline - Date.now(), model);
    } catch (e) {
      // the model was retired or is not on this account: pick another one and try once more
      if (!(e instanceof ModelGone) || attempt > 0) throw e;
      if ((process.env.AIK_MODEL || '').trim()) throw new AiError(`${e.message} Remove AIK_MODEL in Netlify to let the game pick a model.`);
      groqPicked = null;
      const next = await groqModel(deadline - Date.now(), true);
      if (next === model) throw e;
      model = next;
      text = await groqChat(messages, opts.maxTokens ?? 2000, deadline - Date.now(), model);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    const r = schema.safeParse(data);
    if (r.success) return r.data;
    const problem = data === undefined ? 'That was not valid JSON.' : `That JSON does not match the schema: ${r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`;
    if (attempt === 1 || deadline - Date.now() < 2500) throw new AiError(`The AI reply could not be read. ${problem}`.slice(0, 300));
    messages.push({ role: 'assistant', content: text.slice(0, 6000) }, { role: 'user', content: `${problem} Reply again with only the corrected JSON object.` });
  }
  throw new AiError('The AI reply could not be read.');
}

// ------------------------------------------------------------ Claude
let client: Anthropic | null = null;
let clientKey = '';
function claude() {
  const k = key();
  if (!client || clientKey !== k) {
    client = new Anthropic({ apiKey: k, maxRetries: 0 });
    clientKey = k;
  }
  return client;
}

async function claudeJson<S extends z.ZodType>(schema: S, system: string, prompt: string, opts: { timeoutMs?: number; maxTokens?: number }): Promise<z.infer<S>> {
  try {
    const response = await claude().beta.messages.parse(
      {
        model: aiModel(),
        max_tokens: opts.maxTokens ?? 2000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
      },
      { timeout: opts.timeoutMs ?? 8000 },
    );
    if (response.stop_reason === 'refusal') throw new AiError('The AI declined that request.');
    if (response.parsed_output == null) throw new AiError('The AI reply could not be read.');
    return response.parsed_output as z.infer<S>;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('The AI key (AIK) was rejected. Check it in Netlify.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('The AI is busy right now. Try again in a minute.');
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiError('The AI took too long.');
    if (e instanceof Anthropic.APIError) throw new AiError(`AI error ${e.status ?? ''}: ${e.message}`.trim());
    throw e;
  }
}
