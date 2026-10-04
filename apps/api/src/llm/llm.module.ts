import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { AnthropicLlmClient } from './anthropic-llm-client.js';
import { FakeLlmClient } from './fake-llm-client.js';
import { LLM_CLIENT, type LlmClient } from './llm-client.js';

/**
 * Selected by `LLM_PROVIDER` (`anthropic` by default; `fake` for tests and the e2e stack). Tests
 * override `LLM_CLIENT` with a scripted fake. The worker refuses to start without a key.
 */
@Module({
  providers: [
    {
      provide: LLM_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): LlmClient => {
        if (config.llm.provider === 'fake')
          return new FakeLlmClient({ delayMs: config.llm.fakeDelayMs });
        if (!config.anthropic.apiKey) {
          throw new Error('Invalid environment configuration:\n  ANTHROPIC_API_KEY: Required');
        }

        return new AnthropicLlmClient({
          apiKey: config.anthropic.apiKey,
          model: config.anthropic.model,
          effort: config.anthropic.effort,
          maxTokens: config.anthropic.maxTokens,
          timeoutMs: config.timeouts.llmMs,
        });
      },
    },
  ],
  exports: [LLM_CLIENT],
})
export class LlmModule {}
