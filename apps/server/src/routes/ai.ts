import {
  buildDraftMessages,
  buildMappingMessages,
  buildSpecialistPrompt,
  detectSecretValue,
  DraftRequestSchema,
  DraftResponseSchema,
  extractJsonObject,
  FieldMappingRequestSchema,
  FieldMappingResponseSchema,
  parseSpecialistOutput,
  specialistMapping,
} from '@a2c/shared';
import { Router, type Response } from 'express';
import type { BackboardClient } from '../backboardClient';
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

/** Unauthenticated: liveness only (used by Render health checks). */
export function publicRouter(config: ProxyConfig): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'a2c-backend',
      provider: 'gemma',
      configured: isConfigured(config),
      model: config.gemmaModel,
      authRequired: config.users.length > 0,
    });
  });
  return router;
}

const MAX_SPECIALIST_FIELDS = 60;

export function aiRouter(config: ProxyConfig, gemma: GemmaClient, specialist: GemmaClient, backboard: BackboardClient): Router {
  const router = Router();

  // Connection status shown in the extension's Settings tab. probe=1 performs real checks.
  router.get('/status', async (req, res) => {
    const probe = req.query.probe === '1';
    const [gemmaUp, specialistUp, backboardUp] = probe
      ? await Promise.all([
          gemma.configured ? gemma.listModels() : Promise.resolve(null),
          specialist.configured ? specialist.listModels() : Promise.resolve(null),
          backboard.configured ? backboard.ping() : Promise.resolve(null),
        ])
      : [null, null, null];
    res.json({
      ok: true,
      user: res.locals.userId,
      authRequired: config.users.length > 0,
      gemma: { configured: gemma.configured, model: gemma.model, reachable: gemmaUp ? gemmaUp.reachable : null, models: gemmaUp?.models ?? [] },
      specialist: { configured: specialist.configured, model: specialist.model, reachable: specialistUp ? specialistUp.reachable : null },
      backboard: { configured: backboard.configured, reachable: backboardUp },
    });
  });

  router.post('/map', async (req, res) => {
    const parsed = FieldMappingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.slice(0, 5).map((i) => i.message) });
      return;
    }
    const request = parsed.data;
    const fieldIds = new Set(request.fields.map((f) => f.id));
    const keys = new Set(request.availableMemoryKeys.map((k) => k.key));
    // Fine-tuned specialist: one short label per field (about a second), same policy downstream.
    const runSpecialist = async () => {
      const fields = request.fields.slice(0, MAX_SPECIALIST_FIELDS);
      return Promise.all(
        fields.map(async (f) => {
          const text = await specialist.chat([{ role: 'user', content: buildSpecialistPrompt({ label: f.label, type: f.type, options: f.options }) }], { maxTokens: 12 });
          return specialistMapping(f, parseSpecialistOutput(text, keys));
        }),
      );
    };
    try {
      const engine = req.query.engine;
      if (engine === 'specialist' || (engine === 'auto' && specialist.configured)) {
        try {
          const mappings = await runSpecialist();
          res.setHeader('X-A2C-Engine', 'specialist');
          res.json({ mappings });
          return;
        } catch (err) {
          // Auto mode never fails because the specialist is down: fall through to Gemma.
          if (engine === 'specialist') throw err;
        }
      }
      res.setHeader('X-A2C-Engine', 'gemma');
      const text = await gemma.chat(buildMappingMessages(request));
      const out = FieldMappingResponseSchema.safeParse(extractJsonObject(text));
      if (!out.success) {
        res.status(502).json({ error: 'invalid_model_output', message: 'Gemma output did not match the mapping schema' });
        return;
      }
      // Server-side filtering (the extension validates again).
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
      // Cap generation: roughly 1 token per 3-4 characters plus JSON overhead. Long uncapped outputs dominate latency on CPU.
      const text = await gemma.chat(buildDraftMessages(parsed.data), { maxTokens: Math.min(1500, Math.ceil((parsed.data.maxLength ?? 800) / 3) + 160) });
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
