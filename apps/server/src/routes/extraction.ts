import { Router } from 'express';
import { ContextExtractionRequestSchema, extractionMessages, extractJsonObject, groundedExtraction, safeExtractionText } from '@a2c/shared';
import { isLoopback, type ProxyConfig } from '../config';
import type { GemmaClient } from '../gemmaClient';

export function extractionRouter(config: ProxyConfig, gemma: GemmaClient) {
  const router = Router();
  router.post('/extract', async (req, res) => {
    // Raw context must never go through a hosted backend or remote model.
    let local = false;
    try {
      const model = new URL(config.gemmaBaseUrl ?? '');
      local = !config.production && isLoopback(config.host) && model.protocol === 'http:' && isLoopback(model.hostname) && !model.username && !model.password;
    } catch { /* Unconfigured model. */ }
    if (!local) { res.status(403).json({ error: 'local_only', message: 'Context extraction requires a local backend and local model.' }); return; }
    const parsed = ContextExtractionRequestSchema.safeParse(req.body);
    if (!parsed.success || !safeExtractionText(parsed.data.text)) {
      res.status(400).json({ error: 'invalid_context', message: 'Use at most 12,000 characters of profile text without credentials or secrets.' }); return;
    }
    try {
      const raw = await gemma.chat(extractionMessages(parsed.data.text), { maxTokens: 1536 });
      res.json(groundedExtraction(extractJsonObject(raw), parsed.data.text));
    } catch {
      res.status(502).json({ error: 'extraction_failed', message: 'Local extraction failed. Try shorter text or use labelled lines.' });
    }
  });
  return router;
}
