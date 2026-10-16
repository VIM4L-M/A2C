import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ProxyConfig } from './config';

/**
 * Bearer-token authentication.
 *
 * Users are configured on the server as A2C_USERS="alice:<sha256 hex>,bob:<sha256 hex>".
 * Only SHA-256 hashes of tokens are stored; the extension sends the raw token
 * in "Authorization: Bearer <token>". Every memory operation is scoped to the
 * authenticated user id (res.locals.userId).
 *
 * Local development (no users configured AND bound to loopback) uses the
 * single user id "local". Public binding without users is refused at startup.
 */

export interface UserRecord {
  id: string;
  tokenHash: Buffer;
}

const USER_ID_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/;

export function sha256(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function parseUsers(raw: string | undefined): UserRecord[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, hash] = entry.split(':');
      if (!id || !hash || !USER_ID_RE.test(id) || !/^[a-f0-9]{64}$/i.test(hash)) {
        throw new Error(`Invalid A2C_USERS entry "${entry.slice(0, 20)}..." (expected userId:sha256hex)`);
      }
      return { id, tokenHash: Buffer.from(hash, 'hex') };
    });
}

export function findUser(users: UserRecord[], token: string): UserRecord | undefined {
  const presented = sha256(token);
  let match: UserRecord | undefined;
  // Compare against every record in constant time per record.
  for (const u of users) if (timingSafeEqual(u.tokenHash, presented)) match = u;
  return match;
}

export function authenticate(config: ProxyConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (config.users.length === 0) {
      res.locals.userId = 'local';
      next();
      return;
    }
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const user = token && token.length <= 200 ? findUser(config.users, token) : undefined;
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.locals.userId = user.id;
    next();
  };
}
