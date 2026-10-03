import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap/configure-app.js';
import { APP_CONFIG } from '../../src/config/config.module.js';
import { loadConfig } from '../../src/config/env.schema.js';

/** The web origin the test app trusts; send it as `Origin` on mutating requests. */
export const TEST_ORIGIN = 'http://localhost:3000';

export interface TestAppOptions {
  databaseUrl: string;
  /** Defaults to the shared Redis container. */
  redisUrl?: string;
  /** Extra env vars, e.g. shortened timeouts. */
  env?: Record<string, string>;
  /** Test-only controllers mounted next to the real ones. */
  controllers?: Type[];
}

/** The real HTTP app (same middleware as main.ts), in-process, against test containers. */
export async function createTestApp(options: TestAppOptions): Promise<NestExpressApplication> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: options.databaseUrl,
    REDIS_URL: options.redisUrl ?? inject('redisUrl'),
    READY_CHECK_TIMEOUT_MS: '1000',
    REDIS_COMMAND_TIMEOUT_MS: '1000',
    WEB_ORIGIN: TEST_ORIGIN,
    ...options.env,
  });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    bufferLogs: true,
  });
  configureApp(app);
  await app.init();
  return app;
}
