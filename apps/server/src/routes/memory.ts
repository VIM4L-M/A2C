import { catalogEntry, classifyMemoryKey, detectSecretValue, looksLikeOneTimeCode, MEMORY_KEY_RE, sanitizeLabel } from '@a2c/shared';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { BackboardError, type BackboardClient } from '../backboardClient';

/**
 * Opt-in cloud memory (Backboard). Every route is authenticated and scoped to
 * res.locals.userId -> that user's own assistant. Only non-sensitive facts the
 * user explicitly saves are accepted; private facts stay in the local vault.
 */

const AddSchema = z.strictObject({
  key: z.string().regex(MEMORY_KEY_RE),
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(1000),
});
const SearchSchema = z.strictObject({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(10).default(5) });
const MemoryIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

function fail(res: Response, err: unknown) {
  if (err instanceof BackboardError) {
    const status = err.code === 'not_configured' ? 503 : 502;
    res.status(status).json({ error: `backboard_${err.code}`, message: err.message });
    return;
  }
  res.status(500).json({ error: 'internal_error' });
}

/** Server-side gate: cloud memory accepts only standard, non-secret facts. */
export function cloudFactProblem(key: string, label: string, value: string): string | null {
  const cls = classifyMemoryKey(key, label);
  if (cls.risk === 'red') return 'Credentials and secrets are never stored';
  if (detectSecretValue(value).secret || looksLikeOneTimeCode(value, `${key} ${label}`)) return 'Value looks like a secret';
  const entry = catalogEntry(key);
  if (entry?.sensitivity === 'private' || (!entry && cls.risk === 'amber') || cls.rule === 'contact_phone') {
    return 'Private facts stay in the local encrypted vault';
  }
  return null;
}

export function memoryRouter(backboard: BackboardClient): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      res.json({ memories: await backboard.list(res.locals.userId as string) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/', async (req, res) => {
    const parsed = AddSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const { key, value } = parsed.data;
    const label = sanitizeLabel(parsed.data.label, 80);
    const problem = cloudFactProblem(key, label, value);
    if (problem) {
      res.status(400).json({ error: 'not_allowed', message: problem });
      return;
    }
    try {
      const out = await backboard.add(res.locals.userId as string, `${label} (${key}): ${value.trim()}`, { a2c_key: key, source: 'a2c' });
      res.status(201).json({ ok: true, id: out.id });
    } catch (err) {
      fail(res, err);
    }
  });

  // Read-only retrieval: never writes memory.
  router.post('/search', async (req, res) => {
    const parsed = SearchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    try {
      res.json({ memories: await backboard.search(res.locals.userId as string, parsed.data.query, parsed.data.limit) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete('/:id', async (req, res) => {
    const id = MemoryIdSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    try {
      await backboard.remove(res.locals.userId as string, id.data);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
