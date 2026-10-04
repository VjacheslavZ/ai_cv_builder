import { PDF_MAX_BYTES, PDF_MAX_PAGES } from '@cv/shared';
import { z } from 'zod';

const ms = (defaultMs: number) => z.coerce.number().int().positive().default(defaultMs);
const msOrZero = (defaultMs: number) => z.coerce.number().int().nonnegative().default(defaultMs);
const count = (defaultValue: number) => z.coerce.number().int().positive().default(defaultValue);
const seconds = count;

/** Used only outside production when BETTER_AUTH_SECRET is unset, so `pnpm dev` starts as is. */
const DEV_AUTH_SECRET = 'local-dev-only-secret-do-not-use-in-production';

/**
 * Every interval, timeout, and limit lives here so tests can shorten them (SPEC NFR-R4).
 * Defaults are the production values from the SPEC.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  // Required by the worker when LLM_PROVIDER=anthropic; the API never needs it.
  ANTHROPIC_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  ANTHROPIC_MAX_TOKENS: count(16_000),
  // `fake` (scripted, offline) for tests and the e2e stack.
  LLM_PROVIDER: z.enum(['anthropic', 'fake']).default('anthropic'),
  // AC-7.3's capitalized-token rule for bullets and the summary: strict, so it can be turned off.
  GROUNDING_CHECK_CAPITALIZED: z.enum(['true', 'false']).default('true'),
  // How long the fake "thinks", so the stages are visible in the browser.
  FAKE_LLM_DELAY_MS: msOrZero(1_500),
  // Required in production; an empty value (as in .env.example) counts as unset.
  BETTER_AUTH_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(32).optional(),
  ),
  // The browser-facing origin (the web app). better-auth's baseURL, the only trusted Origin
  // for mutating requests, and whether cookies are `Secure` (everything but localhost).
  WEB_ORIGIN: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),

  SESSION_TTL_S: seconds(7 * 24 * 60 * 60),
  SESSION_UPDATE_AGE_S: seconds(24 * 60 * 60),
  AUTH_RATE_LIMIT_WINDOW_S: seconds(60),
  AUTH_RATE_LIMIT_MAX: count(100),
  SIGN_IN_RATE_LIMIT_WINDOW_S: seconds(60),
  SIGN_IN_RATE_LIMIT_MAX: count(5),
  SIGN_UP_RATE_LIMIT_WINDOW_S: seconds(60),
  SIGN_UP_RATE_LIMIT_MAX: count(5),

  JSON_BODY_LIMIT: z.string().default('1mb'),

  LLM_TIMEOUT_MS: ms(120_000),
  PDF_EXTRACTION_TIMEOUT_MS: ms(15_000),
  PDF_RENDER_TIMEOUT_MS: ms(10_000),
  JOB_DEADLINE_MS: ms(600_000),
  SWEEPER_INTERVAL_MS: ms(30_000),
  WORKER_SHUTDOWN_TIMEOUT_MS: ms(30_000),
  // Keep near BullMQ's default: locks are renewed every lockDuration / 2 while the event loop
  // is free, so long steps need no long lock, and a crashed worker is noticed quickly (AC-5.7).
  WORKER_LOCK_DURATION_MS: ms(30_000),
  WORKER_STALLED_INTERVAL_MS: ms(30_000),
  WORKER_MAX_STALLED_COUNT: count(1),
  JOB_ATTEMPTS: count(3),
  JOB_BACKOFF_MS: ms(5_000),
  // AC-9.7: apply_answer jobs on one CV run one at a time under a Redis lock. The TTL bounds a
  // crashed holder; an expired lock is safe because the commit is fenced by `aiRevision`.
  CV_LOCK_TTL_MS: ms(300_000),
  // A job that finds the CV locked goes back to delayed for this long.
  CV_LOCK_RETRY_MS: ms(2_000),
  // The API answers 202 even when Redis is down; the sweeper enqueues later (AC-3.1, AC-5.7a).
  ENQUEUE_TIMEOUT_MS: ms(500),
  SWEEPER_REQUEUE_AFTER_MS: ms(30_000),
  PDF_RETENTION_MS: ms(24 * 60 * 60 * 1000),
  SSE_HEARTBEAT_MS: ms(15_000),
  // How long EventSource waits before reconnecting after a drop (the SSE `retry` field).
  SSE_RETRY_MS: ms(2_000),
  READY_CHECK_TIMEOUT_MS: ms(2_000),
  // Commands on the `general` Redis connection (sessions, counters) fail after this instead
  // of hanging, so a Redis outage turns into 503 (NFR-R12).
  REDIS_COMMAND_TIMEOUT_MS: ms(2_000),

  WORKER_CONCURRENCY: count(2),
  MAX_ACTIVE_GENERATIONS_PER_USER: count(2),
  GENERATIONS_PER_HOUR: count(20),
  ANSWERS_PER_HOUR: count(60),
  LLM_INVALID_OUTPUT_RETRIES: z.coerce.number().int().nonnegative().default(2),

  PDF_MAX_BYTES: count(PDF_MAX_BYTES),
  PDF_MAX_PAGES: count(PDF_MAX_PAGES),
  // Fewer letters and digits than this means "a scan without a text layer" (AC-4.3).
  PDF_MIN_TEXT_CHARS: count(200),
  PDF_WORKER_MAX_MEMORY_MB: count(256),

  // Per worker in tests, so parallel test files never share a queue.
  BULLMQ_PREFIX: z
    .string()
    .regex(/^[\w-]+$/)
    .default('bull'),
});

export type Env = z.infer<typeof envSchema>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function loadConfig(source: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Names only: values may be secrets.
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  ${issues.join('\n  ')}`);
  }
  const env = result.data;

  const betterAuthSecret =
    env.BETTER_AUTH_SECRET ?? (env.NODE_ENV === 'production' ? undefined : DEV_AUTH_SECRET);
  if (!betterAuthSecret) {
    throw new Error('Invalid environment configuration:\n  BETTER_AUTH_SECRET: Required');
  }
  const webOrigin = new URL(env.WEB_ORIGIN).origin;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
      effort: env.ANTHROPIC_EFFORT,
      maxTokens: env.ANTHROPIC_MAX_TOKENS,
    },
    grounding: { checkCapitalizedTokens: env.GROUNDING_CHECK_CAPITALIZED === 'true' },
    llm: {
      provider: env.LLM_PROVIDER,
      fakeDelayMs: env.FAKE_LLM_DELAY_MS,
      invalidOutputRetries: env.LLM_INVALID_OUTPUT_RETRIES,
    },
    auth: {
      secret: betterAuthSecret,
      webOrigin,
      secureCookies: !LOCAL_HOSTS.has(new URL(webOrigin).hostname),
      sessionTtlS: env.SESSION_TTL_S,
      sessionUpdateAgeS: env.SESSION_UPDATE_AGE_S,
      rateLimit: {
        windowS: env.AUTH_RATE_LIMIT_WINDOW_S,
        max: env.AUTH_RATE_LIMIT_MAX,
        signIn: { windowS: env.SIGN_IN_RATE_LIMIT_WINDOW_S, max: env.SIGN_IN_RATE_LIMIT_MAX },
        signUp: { windowS: env.SIGN_UP_RATE_LIMIT_WINDOW_S, max: env.SIGN_UP_RATE_LIMIT_MAX },
      },
    },
    http: { jsonBodyLimit: env.JSON_BODY_LIMIT },
    timeouts: {
      llmMs: env.LLM_TIMEOUT_MS,
      pdfExtractionMs: env.PDF_EXTRACTION_TIMEOUT_MS,
      pdfRenderMs: env.PDF_RENDER_TIMEOUT_MS,
      jobDeadlineMs: env.JOB_DEADLINE_MS,
      sweeperIntervalMs: env.SWEEPER_INTERVAL_MS,
      workerShutdownMs: env.WORKER_SHUTDOWN_TIMEOUT_MS,
      workerLockMs: env.WORKER_LOCK_DURATION_MS,
      workerStalledIntervalMs: env.WORKER_STALLED_INTERVAL_MS,
      jobBackoffMs: env.JOB_BACKOFF_MS,
      cvLockTtlMs: env.CV_LOCK_TTL_MS,
      cvLockRetryMs: env.CV_LOCK_RETRY_MS,
      enqueueMs: env.ENQUEUE_TIMEOUT_MS,
      sweeperRequeueAfterMs: env.SWEEPER_REQUEUE_AFTER_MS,
      pdfRetentionMs: env.PDF_RETENTION_MS,
      sseHeartbeatMs: env.SSE_HEARTBEAT_MS,
      sseRetryMs: env.SSE_RETRY_MS,
      readyCheckMs: env.READY_CHECK_TIMEOUT_MS,
      redisCommandMs: env.REDIS_COMMAND_TIMEOUT_MS,
    },
    limits: {
      workerConcurrency: env.WORKER_CONCURRENCY,
      maxActiveGenerationsPerUser: env.MAX_ACTIVE_GENERATIONS_PER_USER,
      generationsPerHour: env.GENERATIONS_PER_HOUR,
      answersPerHour: env.ANSWERS_PER_HOUR,
      workerMaxStalledCount: env.WORKER_MAX_STALLED_COUNT,
      jobAttempts: env.JOB_ATTEMPTS,
    },
    pdf: {
      maxBytes: env.PDF_MAX_BYTES,
      maxPages: env.PDF_MAX_PAGES,
      minTextChars: env.PDF_MIN_TEXT_CHARS,
      workerMaxMemoryMb: env.PDF_WORKER_MAX_MEMORY_MB,
    },
    queue: { prefix: env.BULLMQ_PREFIX },
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
