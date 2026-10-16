import express, { type NextFunction, type Request, type Response } from 'express';
import type { ProxyConfig } from './config';
import type { GemmaClient } from './gemmaClient';
import { aiRouter } from './routes/ai';
import { corsGuard, hostGuard, rateLimit, securityHeaders } from './security';

export function createApp(config: ProxyConfig, client: GemmaClient) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(hostGuard(config));
  app.use(corsGuard(config));
  app.use(rateLimit(config.rateLimitPerMinute));
  app.use(express.json({ limit: '64kb', strict: true }));

  // Metadata-only request log: never bodies, labels or values.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (process.env.NODE_ENV !== 'test') console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  app.use('/api', aiRouter(config, client));

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
