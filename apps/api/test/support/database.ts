import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';

export interface TestDatabase {
  url: string;
  drop(): Promise<void>;
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = new URL(inject('templateDatabaseUrl'));
  url.pathname = '/postgres';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * A fresh database copied from the migrated template (`CREATE DATABASE … TEMPLATE`): fast,
 * and test files never see each other's rows. Call in `beforeAll`, drop in `afterAll`.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const template = new URL(inject('templateDatabaseUrl'));
  const templateName = template.pathname.slice(1);
  const name = `test_${randomUUID().replaceAll('-', '')}`;

  await withAdmin((c) => c.query(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`));

  const url = new URL(template);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      await withAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    },
  };
}
