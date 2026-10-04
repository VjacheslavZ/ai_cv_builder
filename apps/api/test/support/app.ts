import { randomUUID } from 'node:crypto';
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap/configure-app.js';
import { APP_CONFIG } from '../../src/config/config.module.js';
import { loadConfig, type AppConfig } from '../../src/config/env.schema.js';

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

/** The environment every test process (API, in-process worker, child worker) starts from. */
export function testEnv(options: Omit<TestAppOptions, 'controllers'>): Record<string, string> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: options.databaseUrl,
    REDIS_URL: options.redisUrl ?? inject('redisUrl'),
    READY_CHECK_TIMEOUT_MS: '1000',
    REDIS_COMMAND_TIMEOUT_MS: '1000',
    WEB_ORIGIN: TEST_ORIGIN,
    LLM_PROVIDER: 'fake',
    FAKE_LLM_DELAY_MS: '0',
    ...options.env,
  };
}

export function testConfig(options: Omit<TestAppOptions, 'controllers'>): AppConfig {
  return loadConfig(testEnv(options));
}

/** A BullMQ prefix of its own, so test files never share a queue. Pass it as `BULLMQ_PREFIX`. */
export function uniqueQueuePrefix(): string {
  return `test-${randomUUID().slice(0, 8)}`;
}

/** The real HTTP app (same middleware as main.ts), in-process, against test containers. */
export async function createTestApp(options: TestAppOptions): Promise<NestExpressApplication> {
  const config = testConfig(options);

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
