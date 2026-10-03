import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.schema.js';

const base = {
  DATABASE_URL: 'postgresql://cv:cv@localhost:5432/cv',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  it('applies the SPEC defaults', () => {
    const config = loadConfig(base);
    expect(config.timeouts).toMatchObject({
      llmMs: 120_000,
      pdfExtractionMs: 15_000,
      pdfRenderMs: 10_000,
      jobDeadlineMs: 600_000,
      sweeperIntervalMs: 30_000,
    });
    expect(config.limits).toMatchObject({ generationsPerHour: 20, answersPerHour: 60 });
    expect(config.http.jsonBodyLimit).toBe('1mb');
  });

  it('lets tests shorten intervals', () => {
    const config = loadConfig({ ...base, SWEEPER_INTERVAL_MS: '200', JOB_DEADLINE_MS: '2000' });
    expect(config.timeouts.sweeperIntervalMs).toBe(200);
    expect(config.timeouts.jobDeadlineMs).toBe(2000);
  });

  it('fails with variable names but without values', () => {
    const secret = 'short-secret';
    let message = '';
    try {
      loadConfig({ ...base, BETTER_AUTH_SECRET: secret, REDIS_URL: 'nope' });
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/REDIS_URL/);
    expect(message).toMatch(/BETTER_AUTH_SECRET/);
    expect(message).not.toContain(secret);
  });
});
