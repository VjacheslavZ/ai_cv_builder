import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap/configure-app.js';
import { APP_CONFIG } from '../../src/config/config.module.js';
import { loadConfig, type AppConfig } from '../../src/config/env.schema.js';
import { loggerParams } from '../../src/logging/logger.module.js';

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
  /** Where log lines go instead of stdout (the PII test); set `LOG_LEVEL` in `env` too. */
  logDestination?: DestinationStream;
}

export type TestEnvOptions = Pick<TestAppOptions, 'databaseUrl' | 'redisUrl' | 'env'>;

/** The environment every test process (API, in-process worker, child worker) starts from. */
export function testEnv(options: TestEnvOptions): Record<string, string> {
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

export function testConfig(options: TestEnvOptions): AppConfig {
  return loadConfig(testEnv(options));
}

/** A BullMQ prefix of its own, so test files never share a queue. Pass it as `BULLMQ_PREFIX`. */
export function uniqueQueuePrefix(): string {
  return `test-${randomUUID().slice(0, 8)}`;
}

/** The real HTTP app (same middleware as main.ts), in-process, against test containers. */
export async function createTestApp(options: TestAppOptions): Promise<NestExpressApplication> {
  const config = testConfig(options);

  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config);
  if (options.logDestination) {
    builder = builder
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(loggerParams(config, options.logDestination));
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    bufferLogs: true,
  });
  configureApp(app);
  // Listen on IPv4 loopback ourselves: left unbound, supertest listens on `::` per request, and
  // on macOS another test process may bind 127.0.0.1 on that same port and take its requests.
  await app.listen(0, '127.0.0.1');
  return app;
}

/** `http://127.0.0.1:<port>` of a test app, for clients other than supertest (SSE). */
export function baseUrl(app: NestExpressApplication): string {
  return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
}
