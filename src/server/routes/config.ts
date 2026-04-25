import { Router } from 'express';
import type { KBConfig } from '../../types/index.js';
import type { UserStore } from '../../core/auth.js';
import { parseUserFromCookie } from '../middleware/auth.js';

interface ConfigRouterOptions {
  config: KBConfig;
  authEnabled: boolean;
  authReadEnabled: boolean;
  jwtSecret?: string;
  userStore: UserStore | null;
}

export function createConfigRouter(opts: ConfigRouterOptions): Router {
  const { config, authEnabled, authReadEnabled, jwtSecret, userStore } = opts;
  const router = Router();

  router.get('/', async (req, res) => {
    const user = authEnabled
      ? await parseUserFromCookie(req.cookies, jwtSecret, userStore)
      : null;

    res.json({
      success: true,
      data: {
        name: config.name,
        topic: config.topic,
        description: config.description,
        authEnabled,
        authReadEnabled,
        user,
      },
    });
  });

  return router;
}
