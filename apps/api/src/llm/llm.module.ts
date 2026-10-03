import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { FakeLlmClient } from './fake-llm-client.js';
import { LLM_CLIENT, type LlmClient } from './llm-client.js';

/** Selected by `LLM_PROVIDER`; tests override `LLM_CLIENT` with a scripted fake. */
@Module({
  providers: [
    {
      provide: LLM_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): LlmClient =>
        new FakeLlmClient({ delayMs: config.llm.fakeDelayMs }),
    },
  ],
  exports: [LLM_CLIENT],
})
export class LlmModule {}
