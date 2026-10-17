import { mergeSystemIntoUser, type ChatMessage } from '@a2c/shared';
import { gemmaTarget, type ChatTarget, type ProxyConfig } from './config';

/**
 * Minimal client for an OpenAI-compatible /chat/completions endpoint serving
 * Gemma 4 (llama.cpp llama-server, Ollama, vLLM, TGI / Hugging Face Inference
 * Endpoints, ...) or the optional fine-tuned specialist. API keys stay on this
 * server; they are never sent to the browser extension.
 */

export class GemmaError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'unavailable' | 'timeout' | 'upstream_error' | 'bad_response',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GemmaError';
  }
}

export interface GemmaClient {
  readonly configured: boolean;
  readonly model: string | null;
  chat(messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<string>;
  listModels(): Promise<{ reachable: boolean; models: string[] }>;
}

type FetchLike = typeof fetch;

const RETRYABLE = new Set(['unavailable', 'timeout']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createChatClient(t: ChatTarget, fetchImpl: FetchLike = fetch): GemmaClient {
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (t.apiKey) h.Authorization = `Bearer ${t.apiKey}`;
    return h;
  };

  async function post(body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), t.timeoutMs);
    try {
      return await fetchImpl(`${t.baseUrl}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new GemmaError(`${t.label} request timed out`, 'timeout');
      throw new GemmaError(`${t.label} inference server is unreachable`, 'unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  async function once(messages: ChatMessage[], maxTokens: number): Promise<string> {
    const msgs = t.mergeSystemPrompt ? mergeSystemIntoUser(messages) : messages;
    const body: Record<string, unknown> = { model: t.model, messages: msgs, temperature: 0, max_tokens: maxTokens, stream: false };
    if (t.jsonResponseFormat) body.response_format = { type: 'json_object' };

    let res = await post(body);
    if (res.status === 400 && t.jsonResponseFormat) {
      // Some servers do not support response_format; retry once without it.
      delete body.response_format;
      res = await post(body);
    }
    if (!res.ok) {
      throw new GemmaError(`${t.label} server responded with HTTP ${res.status}`, res.status >= 500 ? 'unavailable' : 'upstream_error', res.status);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new GemmaError(`${t.label} server returned non-JSON`, 'bad_response');
    }
    const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new GemmaError(`${t.label} returned an empty completion`, 'bad_response');
    return content;
  }

  return {
    configured: Boolean(t.baseUrl && t.model),
    model: t.model,
    async chat(messages, opts) {
      if (!t.baseUrl || !t.model) throw new GemmaError(`${t.label} is not configured`, 'not_configured');
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await once(messages, opts?.maxTokens ?? t.maxTokens);
        } catch (err) {
          if (!(err instanceof GemmaError) || !RETRYABLE.has(err.code) || attempt >= t.maxRetries) throw err;
          await sleep(400 * (attempt + 1));
        }
      }
    },

    async listModels() {
      if (!t.baseUrl) return { reachable: false, models: [] };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        const res = await fetchImpl(`${t.baseUrl}/models`, { headers: headers(), signal: controller.signal });
        if (!res.ok) return { reachable: true, models: [] };
        const data = (await res.json()) as { data?: Array<{ id?: unknown }> };
        const models = (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
        return { reachable: true, models: models.slice(0, 50) };
      } catch {
        return { reachable: false, models: [] };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createGemmaClient(config: ProxyConfig, fetchImpl: FetchLike = fetch): GemmaClient {
  return createChatClient(gemmaTarget(config), fetchImpl);
}
