import express, { type NextFunction, type Request, type Response } from 'express';
import { authenticate } from './auth';
import { createBackboardClient, type BackboardClient } from './backboardClient';
import { specialistTarget, type ProxyConfig } from './config';
import { createChatClient, type GemmaClient } from './gemmaClient';
import { aiRouter, publicRouter } from './routes/ai';
import { memoryRouter } from './routes/memory';
import { extractionRouter } from './routes/extraction';
import { corsGuard, hostGuard, rateLimit, securityHeaders } from './security';

export interface AppDeps {
  specialist?: GemmaClient;
  backboard?: BackboardClient;
}

export function createApp(config: ProxyConfig, gemma: GemmaClient, deps: AppDeps = {}) {
  const specialist = deps.specialist ?? createChatClient(specialistTarget(config));
  const backboard = deps.backboard ?? createBackboardClient({ apiKey: config.backboardApiKey, baseUrl: config.backboardBaseUrl });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.production ? 1 : false);
  app.use(securityHeaders);
  app.use(hostGuard(config));
  app.use(corsGuard(config));
  app.use(rateLimit(config.rateLimitPerMinute * 2));
  app.use(express.json({ limit: '64kb', strict: true }));

  // Metadata-only request log: never bodies, labels, values or tokens.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (process.env.NODE_ENV !== 'test') console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  app.use('/api', publicRouter(config));
  // Everything below requires an authenticated user (or local single-user mode).
  app.use('/api', authenticate(config), rateLimit(config.rateLimitPerMinute, (_req, res) => `user:${res.locals.userId as string}`));
  app.use('/api', aiRouter(config, gemma, specialist, backboard));
  app.use('/api', extractionRouter(config, gemma));
  app.use('/api/memory', memoryRouter(backboard));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'payload_too_large' });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_json' });
      return;
    }
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
