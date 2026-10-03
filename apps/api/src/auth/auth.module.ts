import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import type { Redis } from 'ioredis';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_GENERAL } from '../redis/redis.module.js';
import { createAuth } from './auth.config.js';
import { rewriteAuthResponses } from './auth-responses.js';

/**
 * Mounts better-auth on `/api/auth/*` and registers its global `AuthGuard`: every route is
 * protected unless marked `@AllowAnonymous()`.
 */
export const AuthModule = BetterAuthModule.forRootAsync({
  inject: [PrismaService, REDIS_GENERAL, APP_CONFIG],
  useFactory: (prisma: PrismaService, redis: Redis, config: AppConfig) => ({
    auth: createAuth({ prisma, redis, config }),
    // Same-origin through the Next.js rewrite: no CORS.
    disableTrustedOriginsCors: true,
    // configureApp installs our own parsers (with `{ code, message }` errors) and skips /api/auth.
    bodyParser: { json: { enabled: false }, urlencoded: { enabled: false } },
    // Errors leave as `{ code, message, fields? }`; sign-in bodies lose the session token.
    middleware: rewriteAuthResponses,
  }),
});
