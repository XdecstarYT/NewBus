/**
 * AI helpers (Claude). The key comes from the Netlify environment variable AIK.
 * Every call asks for JSON that matches a schema, so the game never has to guess
 * what came back. Without a key the game falls back to its built-in content.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type * as z from 'zod/v4';

const key = () => (process.env.AIK || process.env.ANTHROPIC_API_KEY || '').trim();
export const aiModel = () => (process.env.AIK_MODEL || '').trim() || 'claude-opus-5-5';

let client: Anthropic | null = null;
let clientKey = '';
function getClient() {
  const k = key();
  if (!client || clientKey !== k) {
    client = new Anthropic({ apiKey: k, maxRetries: 0 });
    clientKey = k;
  }
  return client;
}

export type AiRunner = <S extends z.ZodType>(schema: S, system: string, prompt: string, opts?: { timeoutMs?: number; maxTokens?: number }) => Promise<z.infer<S>>;
let override: AiRunner | null = null;
/** Tests plug in a fake AI here. */
export function setAiForTests(fn: AiRunner | null) {
  override = fn;
}

export function aiAvailable() {
  return !!override || key().length > 10;
}

export function aiStatus() {
  const k = key();
  return {
    configured: !!override || k.length > 10,
    looksLikeClaudeKey: k.startsWith('sk-ant-'),
    model: aiModel(),
    calls: stats.calls,
    failures: stats.failures,
    lastError: stats.lastError,
  };
}

const stats = { calls: 0, failures: 0, lastError: null as string | null };

export class AiError extends Error {}

/** Ask Claude for JSON matching `schema`. Throws AiError when unavailable, refused or too slow. */
export async function aiJson<S extends z.ZodType>(schema: S, system: string, prompt: string, opts: { timeoutMs?: number; maxTokens?: number } = {}): Promise<z.infer<S>> {
  if (override) return override(schema, system, prompt, opts);
  if (!aiAvailable()) throw new AiError('No AI key: set AIK in Netlify to turn AI on.');
  stats.calls++;
  try {
    const response = await getClient().beta.messages.parse(
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
    stats.failures++;
    stats.lastError = e instanceof Error ? e.message.slice(0, 200) : String(e);
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('The AI key (AIK) was rejected. Check it in Netlify.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('The AI is busy right now. Try again in a minute.');
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiError('The AI took too long.');
    if (e instanceof Anthropic.APIError) throw new AiError(`AI error ${e.status ?? ''}: ${e.message}`.trim());
    throw new AiError(`AI error: ${stats.lastError}`);
  }
}
