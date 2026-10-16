import type { NextFunction, Request, Response } from 'express';
import type { ProxyConfig } from './config';

/**
 * Request hardening for the local proxy:
 *  - Host header must be loopback (mitigates DNS rebinding).
 *  - Origin must be the configured extension (web pages cannot use the proxy).
 *  - JSON content type only (forces a CORS preflight from browsers).
 *  - Simple fixed-window rate limit.
 * Non-browser local processes can still forge headers; see SECURITY.md.
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
    if (!allowed.has(String(req.headers.host ?? '').toLowerCase())) {
      res.status(421).json({ error: 'invalid_host' });
      return;
    }
    next();
  };
}

export function corsGuard(config: ProxyConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const allowed = isOriginAllowed(origin, config);
    if (allowed && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.status(allowed ? 204 : 403).end();
      return;
    }
    // Health is readable without an Origin (e.g. curl) but never by web pages.
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

export function rateLimit(perMinute: number) {
  let windowStart = Date.now();
  let count = 0;
  return (_req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    if (count > perMinute) {
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
