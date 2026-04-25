import type { Request, Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';
import type { UserStore } from '../../core/auth.js';

const COOKIE_NAME = 'kb_session';

export interface AuthenticatedRequest extends Request {
  user?: { email: string; name: string };
}

/**
 * Returns middleware that protects ingest routes when auth is enabled.
 * When auth is disabled the middleware is a no-op pass-through.
 */
export function createRequireIngestAuth(
  authEnabled: boolean,
  jwtSecret: string | undefined,
  userStore: UserStore | null,
) {
  if (!authEnabled || !jwtSecret || !userStore) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const secret = new TextEncoder().encode(jwtSecret);

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, secret);
      const email = payload.email as string | undefined;
      if (!email) {
        res.status(401).json({ success: false, error: 'Invalid token' });
        return;
      }

      // Verify user is still in the whitelist
      const user = await userStore.findByEmail(email);
      if (!user) {
        res.status(403).json({ success: false, error: 'User not authorized' });
        return;
      }

      req.user = { email: user.email, name: user.name };
      next();
    } catch {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
  };
}

/**
 * Returns middleware that protects read/browse/search routes when both
 * AUTH_ENABLED and AUTH_READ_ENABLED are true.
 * When either flag is off the middleware is a no-op pass-through.
 */
export function createRequireReadAuth(
  authEnabled: boolean,
  readEnabled: boolean,
  jwtSecret: string | undefined,
  userStore: UserStore | null,
) {
  if (!authEnabled || !readEnabled || !jwtSecret || !userStore) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const secret = new TextEncoder().encode(jwtSecret);

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, secret);
      const email = payload.email as string | undefined;
      if (!email) {
        res.status(401).json({ success: false, error: 'Invalid token' });
        return;
      }

      const user = await userStore.findByEmail(email);
      if (!user) {
        res.status(403).json({ success: false, error: 'User not authorized' });
        return;
      }

      req.user = { email: user.email, name: user.name };
      next();
    } catch {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
  };
}

/**
 * Non-failing JWT parser — returns the user if a valid token is present, null otherwise.
 * Used by the config endpoint to tell the frontend who is logged in.
 */
export async function parseUserFromCookie(
  cookies: Record<string, string> | undefined,
  jwtSecret: string | undefined,
  userStore: UserStore | null,
): Promise<{ email: string; name: string } | null> {
  if (!jwtSecret || !userStore || !cookies) return null;

  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret);
    const email = payload.email as string | undefined;
    if (!email) return null;

    const user = await userStore.findByEmail(email);
    if (!user) return null;

    return { email: user.email, name: user.name };
  } catch {
    return null;
  }
}
