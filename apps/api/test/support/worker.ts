import { Test, type TestingModule } from '@nestjs/testing';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { APP_CONFIG } from '../../src/config/config.module.js';
import { FakeLlmClient } from '../../src/llm/fake-llm-client.js';
import { LLM_CLIENT, type LlmClient } from '../../src/llm/llm-client.js';
import { loggerParams } from '../../src/logging/logger.module.js';
import { WorkerModule } from '../../src/worker/worker.module.js';
import { testConfig, type TestAppOptions } from './app.js';

export interface TestWorkerOptions extends Omit<TestAppOptions, 'controllers'> {
  /** Defaults to a fake that answers every call with a valid draft. */
  llm?: LlmClient;
}

/**
 * The worker's DI context, in-process: the BullMQ worker and the sweeper start on `init()` and
 * stop (gracefully) on `close()`. The sweeper's interval is the configured one; tests usually
 * call `get(Sweeper).tick()` themselves.
 */
export async function startTestWorker(options: TestWorkerOptions): Promise<TestingModule> {
  const config = testConfig(options);
  let builder = Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(LLM_CLIENT)
    .useValue(options.llm ?? new FakeLlmClient());
  if (options.logDestination) {
    builder = builder
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(loggerParams(config, options.logDestination));
  }
  const worker = await builder.compile();
  // `compile()` swaps Nest's global logger for a TestingLogger (errors only); the PII test
  // needs every line, so it takes the global logger back.
  if (options.logDestination) worker.useLogger(worker.get(Logger));
  await worker.init();
  return worker;
}
