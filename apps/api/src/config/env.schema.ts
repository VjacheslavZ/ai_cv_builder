import { z } from 'zod';

const ms = (defaultMs: number) => z.coerce.number().int().positive().default(defaultMs);
const count = (defaultValue: number) => z.coerce.number().int().positive().default(defaultValue);

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

  // Required by the worker from Phase 3 on; optional until then so the stack starts without it.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  // Required from Phase 1 on (better-auth).
  BETTER_AUTH_SECRET: z.string().min(32).optional(),

  JSON_BODY_LIMIT: z.string().default('1mb'),

  LLM_TIMEOUT_MS: ms(120_000),
  PDF_EXTRACTION_TIMEOUT_MS: ms(15_000),
  PDF_RENDER_TIMEOUT_MS: ms(10_000),
  JOB_DEADLINE_MS: ms(600_000),
  SWEEPER_INTERVAL_MS: ms(30_000),
  WORKER_SHUTDOWN_TIMEOUT_MS: ms(30_000),
  READY_CHECK_TIMEOUT_MS: ms(2_000),

  WORKER_CONCURRENCY: count(2),
  MAX_ACTIVE_GENERATIONS_PER_USER: count(2),
  GENERATIONS_PER_HOUR: count(20),
  ANSWERS_PER_HOUR: count(60),
});

export type Env = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Names only: values may be secrets.
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  ${issues.join('\n  ')}`);
  }
  const env = result.data;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    anthropic: { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL },
    betterAuthSecret: env.BETTER_AUTH_SECRET,
    http: { jsonBodyLimit: env.JSON_BODY_LIMIT },
    timeouts: {
      llmMs: env.LLM_TIMEOUT_MS,
      pdfExtractionMs: env.PDF_EXTRACTION_TIMEOUT_MS,
      pdfRenderMs: env.PDF_RENDER_TIMEOUT_MS,
      jobDeadlineMs: env.JOB_DEADLINE_MS,
      sweeperIntervalMs: env.SWEEPER_INTERVAL_MS,
      workerShutdownMs: env.WORKER_SHUTDOWN_TIMEOUT_MS,
      readyCheckMs: env.READY_CHECK_TIMEOUT_MS,
    },
    limits: {
      workerConcurrency: env.WORKER_CONCURRENCY,
      maxActiveGenerationsPerUser: env.MAX_ACTIVE_GENERATIONS_PER_USER,
      generationsPerHour: env.GENERATIONS_PER_HOUR,
      answersPerHour: env.ANSWERS_PER_HOUR,
    },
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
