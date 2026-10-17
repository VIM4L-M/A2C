import type { NextFunction, Request, Response } from 'express';
import { isLoopback, type ProxyConfig } from './config';

/**
 * Request hardening:
 *  - Local mode: Host header must be loopback (mitigates DNS rebinding).
 *  - Origin must be the configured extension (web pages cannot call the API).
 *  - JSON content type only (forces a CORS preflight from browsers).
 *  - Fixed-window rate limits (per IP before auth, per user after auth).
 * Authentication itself lives in auth.ts.
 */

const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;

export function isOriginAllowed(origin: string | undefined, config: ProxyConfig): boolean {
  if (!origin) return false;
  if (config.allowedOrigins.length > 0) return config.allowedOrigins.includes(origin);
  return EXTENSION_ORIGIN_RE.test(origin);
}

export function hostGuard(config: ProxyConfig) {
  const allowed = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`, `[::1]:${config.port}`]);
  return (req: Request, res: Response, next: NextFunction) => {
    // Public deployments sit behind their own hostname; the check applies to local mode only.
    if (!isLoopback(config.host)) {
      next();
      return;
    }
    if (!allowed.has(String(req.headers.host ?? '').toLowerCase())) {
      res.status(421).json({ error: 'invalid_host' });
      return;
    }
    next();
  };
}

export function corsGuard(config: ProxyConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    // A browser page cannot forge this fallback without a preflight. Always
    // prioritize its real Origin (including "null"), so the fallback cannot
    // override a denied website. This is origin filtering, not authentication.
    const origin = req.headers.origin ?? req.get('X-A2C-Extension-Origin');
    const allowed = isOriginAllowed(origin, config);
    if (allowed && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-A2C-Extension-Origin');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.status(allowed ? 204 : 403).end();
      return;
    }
    // Health is readable without an Origin (curl, Render health checks) but never by web pages.
    if (req.path === '/api/health' && req.method === 'GET' && (!origin || allowed)) {
      next();
      return;
    }
    if (!allowed) {
      res.status(403).json({ error: 'origin_not_allowed' });
      return;
    }
    if (req.method === 'POST' && !req.is('application/json')) {
      res.status(415).json({ error: 'json_required' });
      return;
    }
    next();
  };
}

export function rateLimit(perMinute: number, keyOf: (req: Request, res: Response) => string = (req) => req.ip ?? 'unknown') {
  const windows = new Map<string, { start: number; count: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyOf(req, res);
    const w = windows.get(key);
    if (!w || now - w.start > 60_000) {
      if (windows.size > 10_000) windows.clear();
      windows.set(key, { start: now, count: 1 });
    } else if (++w.count > perMinute) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    next();
  };
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
}
