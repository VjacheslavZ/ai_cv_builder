import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Superuser URL of the migrated template database. Tests create their own copies. */
    templateDatabaseUrl: string;
    redisUrl: string;
  }
}

export const TEMPLATE_DATABASE = 'cv_template';

/** Same flags as docker-compose.yml (SPEC §6.1). */
export const REDIS_COMMAND = [
  'redis-server',
  '--appendonly',
  'yes',
  '--appendfsync',
  'everysec',
  '--maxmemory-policy',
  'noeviction',
];

const apiRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Starts Postgres and Redis once per run and migrates the template database. */
export default async function setup(project: TestProject) {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16')
      .withDatabase(TEMPLATE_DATABASE)
      .withUsername('cv')
      .withPassword('cv')
      .start(),
    new RedisContainer('redis:7').withCommand(REDIS_COMMAND).start(),
  ]);

  const templateDatabaseUrl = postgres.getConnectionUri();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: templateDatabaseUrl },
    stdio: 'pipe',
  });

  project.provide('templateDatabaseUrl', templateDatabaseUrl);
  project.provide('redisUrl', redis.getConnectionUrl());

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
