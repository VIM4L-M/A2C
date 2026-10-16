import { mergeSystemIntoUser, type ChatMessage } from '@a2c/shared';
import type { ProxyConfig } from './config';

/**
 * Minimal client for an OpenAI-compatible /chat/completions endpoint serving
 * Gemma 4 (llama.cpp llama-server, Ollama, vLLM, TGI / Hugging Face Inference
 * Endpoints, ...). The API key stays on this server; it is never sent to the
 * browser extension.
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
  chat(messages: ChatMessage[]): Promise<string>;
  listModels(): Promise<{ reachable: boolean; models: string[] }>;
}

type FetchLike = typeof fetch;

export function createGemmaClient(config: ProxyConfig, fetchImpl: FetchLike = fetch): GemmaClient {
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.gemmaApiKey) h.Authorization = `Bearer ${config.gemmaApiKey}`;
    return h;
  };

  async function post(body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      return await fetchImpl(`${config.gemmaBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new GemmaError('Gemma request timed out', 'timeout');
      throw new GemmaError('Gemma inference server is unreachable', 'unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async chat(messages) {
      if (!config.gemmaBaseUrl || !config.gemmaModel) {
        throw new GemmaError('GEMMA_BASE_URL and GEMMA_MODEL are not configured', 'not_configured');
      }
      const msgs = config.mergeSystemPrompt ? mergeSystemIntoUser(messages) : messages;
      const body: Record<string, unknown> = {
        model: config.gemmaModel,
        messages: msgs,
        temperature: 0,
        max_tokens: config.maxTokens,
        stream: false,
      };
      if (config.jsonResponseFormat) body.response_format = { type: 'json_object' };

      let res = await post(body);
      if (res.status === 400 && config.jsonResponseFormat) {
        // Some servers do not support response_format; retry once without it.
        delete body.response_format;
        res = await post(body);
      }
      if (!res.ok) {
        throw new GemmaError(`Gemma server responded with HTTP ${res.status}`, res.status >= 500 ? 'unavailable' : 'upstream_error', res.status);
      }
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        throw new GemmaError('Gemma server returned non-JSON', 'bad_response');
      }
      const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new GemmaError('Gemma returned an empty completion', 'bad_response');
      return content;
    },

    async listModels() {
      if (!config.gemmaBaseUrl) return { reachable: false, models: [] };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        const res = await fetchImpl(`${config.gemmaBaseUrl}/models`, { headers: headers(), signal: controller.signal });
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
