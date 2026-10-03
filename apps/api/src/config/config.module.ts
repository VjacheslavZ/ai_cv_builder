import { Global, Inject, Module } from '@nestjs/common';
import { loadConfig } from './env.schema.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Injects the validated, typed config: `@InjectConfig() private readonly config: AppConfig`. */
export const InjectConfig = () => Inject(APP_CONFIG);

/**
 * Parsed when the DI container is built (not at import time), so tests can set the
 * environment or override APP_CONFIG before creating the app.
 */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
