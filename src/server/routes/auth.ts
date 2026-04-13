import { Router } from 'express';
import { Google, generateState, generateCodeVerifier } from 'arctic';
import { SignJWT } from 'jose';
import type { UserStore } from '../../core/auth.js';

const COOKIE_NAME = 'kb_session';
const STATE_COOKIE = 'kb_oauth_state';
const VERIFIER_COOKIE = 'kb_oauth_verifier';

interface AuthRouterOptions {
  googleClientId: string;
  googleClientSecret: string;
  jwtSecret: string;
  host: string;
  userStore: UserStore;
}

export function createAuthRouter(opts: AuthRouterOptions): Router {
  const router = Router();
  const { googleClientId, googleClientSecret, jwtSecret, host, userStore } = opts;
  const jwtKey = new TextEncoder().encode(jwtSecret);
  const isSecure = host.startsWith('https');

  function getGoogle(): Google {
    return new Google(googleClientId, googleClientSecret, `${host}/auth/callback/google`);
  }

  /**
   * GET /auth/login/google — initiate Google OAuth flow
   */
  router.get('/login/google', (_req, res) => {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const google = getGoogle();
    const url = google.createAuthorizationURL(state, codeVerifier, ['openid', 'email', 'profile']);

    const cookieOpts = {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax' as const,
      path: '/auth',
      maxAge: 10 * 60 * 1000, // 10 minutes
    };

    res.cookie(STATE_COOKIE, state, cookieOpts);
    res.cookie(VERIFIER_COOKIE, codeVerifier, cookieOpts);
    res.redirect(url.toString());
  });

  /**
   * GET /auth/callback/google — handle OAuth callback
   */
  router.get('/callback/google', async (req, res) => {
    const { code, state } = req.query;
    const storedState = req.cookies?.[STATE_COOKIE];
    const codeVerifier = req.cookies?.[VERIFIER_COOKIE];

    // Clear OAuth cookies regardless of outcome
    const clearOpts = { httpOnly: true, secure: isSecure, sameSite: 'lax' as const, path: '/auth' };
    res.clearCookie(STATE_COOKIE, clearOpts);
    res.clearCookie(VERIFIER_COOKIE, clearOpts);

    if (!code || !state || !storedState || !codeVerifier || state !== storedState) {
      res.redirect('/login?authError=invalid_state');
      return;
    }

    try {
      const google = getGoogle();
      const tokens = await google.validateAuthorizationCode(code as string, codeVerifier as string);
      const accessToken = tokens.accessToken();

      // Fetch user profile from Google
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profile = (await profileRes.json()) as { email?: string; name?: string };
      const email = (profile.email ?? '').toLowerCase();

      if (!email) {
        res.redirect('/login?authError=no_email');
        return;
      }

      // Check whitelist
      const user = await userStore.findByEmail(email);
      if (!user) {
        res.redirect('/login?authError=not_whitelisted');
        return;
      }

      // Update name from Google profile if we have one
      if (profile.name && profile.name !== user.name) {
        await userStore.removeUser(user.email);
        await userStore.addUser(user.email, profile.name);
      }

      // Mint JWT
      const jwt = await new SignJWT({ email: user.email, name: profile.name ?? user.name })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.email)
        .setIssuedAt()
        .setExpirationTime('30d')
        .sign(jwtKey);

      res.cookie(COOKIE_NAME, jwt, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.redirect('/?authSuccess=1');
    } catch (err) {
      console.error('[auth] OAuth callback error:', (err as Error).message);
      res.redirect('/login?authError=oauth_failed');
    }
  });

  /**
   * POST /auth/logout — clear session cookie
   */
  router.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
    });
    res.json({ success: true });
  });

  /**
   * GET /auth/me — return current user (or null)
   */
  router.get('/me', async (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      res.json({ success: true, data: null });
      return;
    }

    try {
      const { jwtVerify } = await import('jose');
      const { payload } = await jwtVerify(token, jwtKey);
      const email = payload.email as string | undefined;
      if (!email) {
        res.json({ success: true, data: null });
        return;
      }

      const user = await userStore.findByEmail(email);
      if (!user) {
        res.json({ success: true, data: null });
        return;
      }

      res.json({ success: true, data: { email: user.email, name: user.name } });
    } catch {
      res.json({ success: true, data: null });
    }
  });

  return router;
}
