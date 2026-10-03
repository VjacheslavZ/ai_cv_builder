import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env. On the host, read the repo-root .env (if any); in docker
// compose and tests DATABASE_URL comes from the environment.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // no .env file: rely on the environment
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // `prisma generate` does not need a database, so a missing URL must not fail it.
    url: process.env.DATABASE_URL ?? '',
  },
});
