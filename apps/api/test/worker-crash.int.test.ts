import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../src/llm/fake-llm-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, testEnv, uniqueQueuePrefix } from './support/app.js';
import { signUp } from './support/auth.js';
import { createCv, waitFor, waitForJob } from './support/cvs.js';
import { createTestDatabase, type TestDatabase } from './support/database.js';
import { startTestWorker } from './support/worker.js';
import { SAMPLE_TEXT } from './fixtures/pdf/pdf-fixtures.js';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const BUILD_DIR = '.test-build';

// Short locks so a dead worker's job is detected in seconds, not 30 s (still renewed every
// lockDuration / 2 by a live worker).
const LOCKS = { WORKER_LOCK_DURATION_MS: '2000', WORKER_STALLED_INTERVAL_MS: '1000' };

describe('worker crash and shutdown (AC-5.7, NFR-R2, NFR-R10)', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let env: Record<string, string>;
  let child: ChildProcess | undefined;
  let worker: TestingModule | undefined;

  beforeAll(async () => {
    // The worker runs as a real process, from compiled output.
    execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json', '--outDir', BUILD_DIR], {
      cwd: apiRoot,
      stdio: 'pipe',
    });
    db = await createTestDatabase();
    env = { BULLMQ_PREFIX: uniqueQueuePrefix(), MAX_ACTIVE_GENERATIONS_PER_USER: '50', ...LOCKS };
    app = await createTestApp({ databaseUrl: db.url, env });
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    child?.kill('SIGKILL');
    child = undefined;
    await worker?.close();
    worker = undefined;
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('recovers a job from a worker killed mid-job', async () => {
    child = spawn(process.execPath, [`${BUILD_DIR}/worker.js`], {
      cwd: apiRoot,
      env: {
        PATH: process.env.PATH,
        ...testEnv({ databaseUrl: db.url, env: { ...env, FAKE_LLM_DELAY_MS: '60000' } }),
      },
      stdio: 'ignore',
    });

    const { cookie } = await signUp(app);
    const { cvId, jobId } = await createCv(app, { cookie, text: SAMPLE_TEXT });
    // The child picked the job up and is "waiting for the LLM".
    await waitFor(
      async () => (await prisma.job.findUnique({ where: { id: jobId } }))?.stage === 'generating',
      { timeoutMs: 20_000, what: 'the child worker to reach generating' },
    );

    child.kill('SIGKILL');
    await new Promise((resolve) => child!.once('exit', resolve));

    // Another worker notices the expired lock (stalled) and runs the job again.
    worker = await startTestWorker({ databaseUrl: db.url, env, llm: new FakeLlmClient() });
    const job = await waitForJob(prisma, jobId, ['completed', 'failed'], 20_000);
    expect(job.status).toBe('completed');
    expect(await prisma.cv.findUniqueOrThrow({ where: { id: cvId } })).toMatchObject({
      status: 'ready',
      version: 1,
    });
  });

  it('finishes the current job before shutting down (NFR-R10)', async () => {
    const llm = new FakeLlmClient().slow(1_500);
    worker = await startTestWorker({ databaseUrl: db.url, env, llm });

    const { cookie } = await signUp(app);
    const { jobId } = await createCv(app, { cookie, text: SAMPLE_TEXT });
    await waitFor(async () => llm.calls.length > 0, { what: 'the LLM call' });

    const closing = worker;
    worker = undefined;
    await closing.close(); // SIGTERM → worker.close(): waits for the active job
    expect(await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({
      status: 'completed',
    });
  });
});
