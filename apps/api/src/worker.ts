import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadEnvFile } from './config/load-env-file.js';
import { WorkerModule } from './worker/worker.module.js';

/** The compose healthcheck looks for this file. */
export const WORKER_READY_FILE = join(tmpdir(), 'cv-worker.ready');

loadEnvFile();

const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
const logger = app.get(Logger);
app.useLogger(logger);
app.enableShutdownHooks();
await app.init();

await writeFile(WORKER_READY_FILE, String(process.pid));
logger.log('Worker ready', 'Worker');
