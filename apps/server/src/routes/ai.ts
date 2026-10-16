import {
  buildDraftMessages,
  buildMappingMessages,
  detectSecretValue,
  DraftRequestSchema,
  DraftResponseSchema,
  extractJsonObject,
  FieldMappingRequestSchema,
  FieldMappingResponseSchema,
} from '@contextfill/shared';
import { Router, type Response } from 'express';
import { isConfigured, type ProxyConfig } from '../config';
import { GemmaError, type GemmaClient } from '../gemmaClient';

function sendGemmaError(res: Response, err: unknown) {
  if (err instanceof GemmaError) {
    const status = err.code === 'not_configured' ? 503 : err.code === 'timeout' ? 504 : 502;
    res.status(status).json({ error: err.code, message: err.message });
    return;
  }
  res.status(500).json({ error: 'internal_error' });
}

export function aiRouter(config: ProxyConfig, client: GemmaClient): Router {
  const router = Router();

  router.get('/health', async (req, res) => {
    const probe = req.query.probe === '1';
    const upstream = probe ? await client.listModels() : undefined;
    res.json({
      ok: true,
      service: 'contextfill-gemma-proxy',
      provider: 'gemma',
      configured: isConfigured(config),
      model: config.gemmaModel,
      upstreamHost: config.gemmaBaseUrl ? new URL(config.gemmaBaseUrl).host : null,
      upstream: upstream ?? null,
    });
  });

  router.post('/map', async (req, res) => {
    const parsed = FieldMappingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.slice(0, 5).map((i) => i.message) });
      return;
    }
    const request = parsed.data;
    try {
      const text = await (client.chat(buildMappingMessages(request)));
      const out = FieldMappingResponseSchema.safeParse(extractJsonObject(text));
      if (!out.success) {
        res.status(502).json({ error: 'invalid_model_output', message: 'Gemma output did not match the mapping schema' });
        return;
      }
      // Server-side filtering (the extension validates again).
      const fieldIds = new Set(request.fields.map((f) => f.id));
      const keys = new Set(request.availableMemoryKeys.map((k) => k.key));
      const mappings = out.data.mappings
        .filter((m) => fieldIds.has(m.fieldId))
        .map((m) =>
          m.memoryKey && !keys.has(m.memoryKey)
            ? { ...m, action: 'ask_user' as const, memoryKey: null, reason: 'Model proposed an unknown memory key' }
            : m,
        );
      res.json({ mappings });
    } catch (err) {
      sendGemmaError(res, err);
    }
  });

  router.post('/draft', async (req, res) => {
    const parsed = DraftRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.slice(0, 5).map((i) => i.message) });
      return;
    }
    try {
      const text = await client.chat(buildDraftMessages(parsed.data));
      const out = DraftResponseSchema.safeParse(extractJsonObject(text));
      if (!out.success) {
        res.status(502).json({ error: 'invalid_model_output', message: 'Gemma output did not match the draft schema' });
        return;
      }
      if (detectSecretValue(out.data.draft).secret) {
        res.status(502).json({ error: 'unsafe_model_output', message: 'Draft contained secret-like content and was discarded' });
        return;
      }
      const allowedKeys = new Set(parsed.data.facts.map((f) => f.key));
      res.json({
        draft: out.data.draft.slice(0, parsed.data.maxLength),
        usedKeys: out.data.usedKeys.filter((k) => allowedKeys.has(k)),
        missingFacts: out.data.missingFacts,
      });
    } catch (err) {
      sendGemmaError(res, err);
    }
  });

  return router;
}
