import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap/configure-app.js';
import { APP_CONFIG } from './config/config.module.js';
import type { AppConfig } from './config/env.schema.js';
import { loadEnvFile } from './config/load-env-file.js';

loadEnvFile();

// bodyParser: false is required by better-auth; configureApp re-enables parsing elsewhere.
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  bodyParser: false,
  bufferLogs: true,
});
configureApp(app);
await app.listen(app.get<AppConfig>(APP_CONFIG).port, '0.0.0.0');
