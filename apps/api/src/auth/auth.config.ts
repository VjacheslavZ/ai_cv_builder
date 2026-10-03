import { Logger } from '@nestjs/common';
import { redisStorage } from '@better-auth/redis-storage';
import { AUTH_COOKIE_PREFIX, ErrorCode, signInSchema, signUpSchema } from '@cv/shared';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { Redis } from 'ioredis';
import type { z } from 'zod';

import { issuesToFields } from '../common/validation/validation.pipe.js';
import type { AppConfig } from '../config/env.schema.js';
import type { PrismaClient } from '../generated/prisma/client.js';

export const AUTH_BASE_PATH = '/api/auth';
export const AUTH_REDIS_PREFIX = 'better-auth:';

export interface AuthDeps {
  prisma: PrismaClient;
  redis: Redis;
  config: AppConfig;
}

const BODY_SCHEMAS: Record<string, z.ZodType<Record<string, unknown>>> = {
  '/sign-up/email': signUpSchema,
  '/sign-in/email': signInSchema,
};

export function createAuth({ prisma, redis, config }: AuthDeps) {
  const logger = new Logger('BetterAuth');
  const { auth } = config;

  return betterAuth({
    appName: 'AI CV Builder',
    baseURL: auth.webOrigin,
    basePath: AUTH_BASE_PATH,
    secret: auth.secret,
    trustedOrigins: [auth.webOrigin],
    telemetry: { enabled: false },

    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secondaryStorage: redisStorage({ client: redis, keyPrefix: AUTH_REDIS_PREFIX }),

    user: {
      fields: { name: 'firstName' },
      additionalFields: {
        lastName: { type: 'string', required: true, input: true },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: auth.sessionTtlS,
      updateAge: auth.sessionUpdateAgeS,
      cookieCache: { enabled: false },
    },

    rateLimit: {
      enabled: true,
      storage: 'secondary-storage',
      window: auth.rateLimit.windowS,
      max: auth.rateLimit.max,
      customRules: {
        '/sign-in/email': { window: auth.rateLimit.signIn.windowS, max: auth.rateLimit.signIn.max },
        '/sign-up/email': { window: auth.rateLimit.signUp.windowS, max: auth.rateLimit.signUp.max },
      },
    },

    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: auth.secureCookies,
      // better-auth skips its Origin check when NODE_ENV=test; keep it on so tests see production.
      disableOriginCheck: false,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      // The API is reached only through the Next.js rewrite, which sets X-Forwarded-For to the
      // browser's address (apps/web/server/forwarded-for.cjs). Without it every user would
      // share the proxy's rate-limit counter (AC-1.6).
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
      database: { generateId: 'uuid' },
    },

    hooks: {
      // The same Zod schemas as the web forms; failures are `400 { code, message, fields }`.
      // Other errors are mapped to our shape by `rewriteAuthResponses` (auth-responses.ts).
      before: createAuthMiddleware(async (ctx) => {
        const schema = BODY_SCHEMAS[ctx.path];
        if (!schema) return;
        const result = schema.safeParse(ctx.body);
        if (!result.success) {
          throw new APIError('BAD_REQUEST', {
            code: ErrorCode.VALIDATION_ERROR,
            message: 'Invalid request',
            fields: issuesToFields(result.error.issues),
          });
        }
        if (ctx.path !== '/sign-up/email') return { context: { body: result.data } };
        // better-auth's `name` is the first name (see `user.fields`).
        const { firstName, ...rest } = result.data as { firstName: string };
        return { context: { body: { ...rest, name: firstName } } };
      }),
    },

    logger: {
      level: 'warn',
      // Messages only: better-auth may pass request data as extra arguments.
      log: (level, message) => {
        if (level === 'error') logger.error(message);
        else logger.warn(message);
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
