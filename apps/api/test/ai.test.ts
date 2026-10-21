import { describe, it, expect, afterEach, vi } from 'vitest';
import * as z from 'zod/v4';
import { aiJson, aiStatus, AiError } from '../src/services/ai';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const chat = (content: string) => reply(200, { choices: [{ message: { content }, finish_reason: 'stop' }] });
const Grade = z.object({ score: z.number(), feedback: z.string() });
/** A fake Groq that answers chat calls from the queue. */
function fakeGroq(...chats: Response[]) {
  return vi.fn(async (_url: string, _init?: RequestInit) => chats.shift() ?? chat('{}'));
}
const chatCalls = (f: ReturnType<typeof fakeGroq>) => f.mock.calls as unknown as Array<[string, RequestInit]>;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AIK;
  delete process.env.AIK_MODEL;
});

describe('Groq AI (key in AIK)', () => {
  it('a gsk_ key uses Groq: JSON mode, the schema in the prompt, the parsed reply', async () => {
    process.env.AIK = 'gsk_test_key_123456';
    const fetch = fakeGroq(chat('{"score": 88, "feedback": "Nice work."}'));
    vi.stubGlobal('fetch', fetch);
    expect(aiStatus()).toMatchObject({ provider: 'groq', keyLooksRight: true, model: 'openai/gpt-oss-120b' });
    expect(await aiJson(Grade, 'Grade it.', 'answer')).toEqual({ score: 88, feedback: 'Nice work.' });
    expect(fetch.mock.calls).toHaveLength(1); // just the chat call, no model lookup
    const [url, init] = chatCalls(fetch)[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer gsk_test_key_123456');
    const body = JSON.parse(String(init.body));
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toContain('"feedback"');
    expect(body.model).toBe('openai/gpt-oss-120b');
    expect(body.reasoning_effort).toBe('low');
  });

  it('asks once more when the reply does not match the schema', async () => {
    process.env.AIK = 'gsk_test_key_123456';
    const fetch = fakeGroq(chat('{"score": "great"}'), chat('{"score": 70, "feedback": "ok"}'));
    vi.stubGlobal('fetch', fetch);
    expect(await aiJson(Grade, 'Grade it.', 'answer')).toEqual({ score: 70, feedback: 'ok' });
    const second = JSON.parse(String(chatCalls(fetch)[1][1].body));
    expect(second.messages.at(-1).content).toMatch(/does not match/);
  });

  it('explains a rejected key, a rate limit and an unknown model in plain words', async () => {
    process.env.AIK = 'gsk_bad_key_1234567';
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: { message: 'Invalid API Key' } })));
    await expect(aiJson(Grade, 's', 'p')).rejects.toThrow(/rejected by Groq/);
    process.env.AIK_MODEL = 'some-model';
    vi.stubGlobal('fetch', vi.fn(async () => reply(429, { error: { message: 'slow down' } })));
    await expect(aiJson(Grade, 's', 'p')).rejects.toThrow(/busy/);
    vi.stubGlobal('fetch', vi.fn(async () => reply(404, { error: { message: 'The model `some-model` does not exist', code: 'model_not_found' } })));
    await expect(aiJson(Grade, 's', 'p')).rejects.toBeInstanceOf(AiError);
    expect(aiStatus().lastError).toMatch(/Set AIK_MODEL/);
  });
});
