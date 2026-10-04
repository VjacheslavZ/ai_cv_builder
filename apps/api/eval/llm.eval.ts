import { llmCvOutputSchema } from '@cv/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.schema.js';
import { loadEnvFile } from '../src/config/load-env-file.js';
import { AnthropicLlmClient } from '../src/llm/anthropic-llm-client.js';
import { runGenerationLoop } from '../src/worker/generation-loop.js';
import { CASES, type EvalCase } from './cases.js';
import { runChecks, type Draft } from './checks.js';
import { Judge, type JudgeUsage } from './judge.js';
import { readBaseline, rubricScores, saveBaseline, writeReport, type CaseRun } from './report.js';

// Manual quality run against the real API (docs/plans/testing.md, "LLM quality evaluation").
// Costs money: `pnpm eval:llm` with ANTHROPIC_API_KEY set. Never part of `pnpm test` or CI.
//
// Each case runs the production generation loop (schema, re-requests, grounding) and is graded
// three ways: deterministic checks (hard ones fail the test), an LLM judge rubric, and a blind
// pairwise comparison with the frozen baseline in eval/out/baseline/. Judge verdicts are
// signals for the report, not pass/fail: see the calibration test at the bottom.
//
//   EVAL_JUDGE_MODEL     judge model (default claude-haiku-4-5; not the generator's model)
//   EVAL_JUDGE=false     skip the judge (deterministic checks only)
//   EVAL_REPEATS=3       run every case N times: the generator and the judge are not deterministic
//   EVAL_SAVE_BASELINE=true  freeze this run's drafts as the new baseline

loadEnvFile();
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('pnpm eval:llm needs ANTHROPIC_API_KEY (in .env or the environment)');
}
// The eval uses the generation settings only; the database and Redis are never touched.
const config = loadConfig({
  DATABASE_URL: 'postgres://unused/eval',
  REDIS_URL: 'redis://unused',
  ...process.env,
});
const apiKey = process.env.ANTHROPIC_API_KEY;
const judgeModel = process.env.EVAL_JUDGE_MODEL ?? 'claude-haiku-4-5';
const judgeOn = process.env.EVAL_JUDGE !== 'false';
const repeats = Number(process.env.EVAL_REPEATS ?? 1);
const saveAsBaseline = process.env.EVAL_SAVE_BASELINE === 'true';

const generator = new AnthropicLlmClient({
  apiKey,
  model: config.anthropic.model,
  effort: config.anthropic.effort,
  maxTokens: config.anthropic.maxTokens,
  timeoutMs: config.timeouts.llmMs,
});
const judge = new Judge(apiKey, judgeModel, config.timeouts.llmMs);
const runs: CaseRun[] = [];

const addUsage = (a: JudgeUsage, b?: JudgeUsage) => {
  a.inputTokens += b?.inputTokens ?? 0;
  a.outputTokens += b?.outputTokens ?? 0;
};

async function runCase(c: EvalCase, repeat: number): Promise<CaseRun> {
  const started = Date.now();
  const generatorUsage = { inputTokens: 0, outputTokens: 0 };
  const judgeUsage = { inputTokens: 0, outputTokens: 0 };
  let calls = 0;
  let draft: Draft | null = null;
  let rawForbidden: string[] = [];
  let error: string | undefined;
  try {
    const loop = await runGenerationLoop({
      targetRole: c.role,
      sources: c.sources,
      invalidOutputRetries: config.llm.invalidOutputRetries,
      checkCapitalizedTokens: config.grounding.checkCapitalizedTokens,
      call: async (request) => {
        calls++;
        const response = await generator.generateCv({
          ...request,
          signal: AbortSignal.timeout(config.timeouts.llmMs),
        });
        addUsage(generatorUsage, response.usage);
        return response.output;
      },
    });
    const { document, questions, removed } = loop.result;
    draft = { document, questions, removed };
    // Did the prompt hold, or only grounding? (AC-7.8)
    const raw = JSON.stringify(llmCvOutputSchema.parse(loop.output));
    rawForbidden = (c.expect.forbidden ?? []).filter((re) => re.test(raw)).map(String);
  } catch (err) {
    error = (err as Error).message;
  }

  const run: CaseRun = {
    caseId: c.id,
    repeat,
    durationMs: Date.now() - started,
    calls,
    generatorUsage,
    draft,
    rawForbidden,
    checks: draft ? runChecks(c, draft) : [],
    judgeUsage,
    ...(error ? { error } : {}),
  };
  if (!draft || !judgeOn) return run;

  const baseline = readBaseline(c.id);
  const [rubric, pairwise] = await Promise.all([
    judge.rubric(c, draft),
    baseline && !saveAsBaseline ? judge.pairwise(c, draft, baseline) : undefined,
  ]);
  addUsage(judgeUsage, rubric.usage);
  addUsage(judgeUsage, pairwise?.usage);
  run.rubric = {
    verdict: rubric.verdict,
    scores: rubricScores(rubric.verdict, draft.document.summary === ''),
  };
  if (pairwise) run.pairwise = { outcome: pairwise.outcome, reason: pairwise.reason };
  if (saveAsBaseline && repeat === 1) saveBaseline(c.id, draft);
  return run;
}

describe('LLM quality evaluation (real API)', () => {
  const matrix = CASES.flatMap((c) =>
    Array.from({ length: repeats }, (_, i) => ({ ...c, repeat: i + 1 })),
  );

  it.each(matrix)('$name #$repeat', async ({ repeat, ...c }) => {
    const run = await runCase(c, repeat);
    runs.push(run);
    expect(run.error, 'the pipeline produced a draft').toBeUndefined();
    for (const check of run.checks.filter((k) => k.severity === 'hard')) {
      expect.soft(check.ok, `${check.id} ${check.detail ?? ''}`).toBe(true);
    }
  });

  afterAll(() => {
    if (runs.length === 0) return;
    const file = writeReport(runs, {
      generatorModel: config.anthropic.model,
      generatorEffort: config.anthropic.effort,
      judgeModel: judgeOn ? judgeModel : null,
      repeats,
      savedBaseline: saveAsBaseline,
    });
    console.log(`\nFull results: ${file}`);
  });
});

// Calibration: hand-written drafts with planted defects. The judge must flag every defect and
// pass the clean draft; if it does not, fix the judge prompt before trusting its numbers.
describe.skipIf(!judgeOn)('judge calibration', () => {
  const c = CASES.find((k) => k.id === 'sales-vague')!;
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const draft = (bullets: string[], summary: string): Draft => ({
    document: {
      contact: {
        name: 'Tom Hughes',
        email: 'tom.hughes@example.com',
        phone: '',
        city: '',
        links: [],
      },
      summary,
      experience: [
        {
          id: id(1),
          company: 'Northgate Supplies',
          title: 'Sales representative',
          dates: { start: '2017', end: '2023' },
          bullets: bullets.map((text, i) => ({ id: id(i + 2), text })),
        },
      ],
      education: [],
      skills: [{ id: id(9), name: 'Salesforce' }],
      editedPaths: [],
    },
    questions: [
      {
        path: 'contact.phone',
        type: 'missing',
        text: 'What phone number should employers use?',
        priority: 1,
      },
    ],
    removed: [],
  });
  const CLEAN = draft(
    [
      'Grew territory revenue from £400k to £650k a year.',
      'Looked after about 60 accounts.',
      'Used Salesforce every day.',
    ],
    'Sales representative who grew territory revenue from £400k to £650k a year. Looked after about 60 accounts using Salesforce.',
  );
  const DEFECTS = draft(
    [
      'Responsible for revenue growth from £400k to £650k a year.', // no action verb
      'Led a team of 12 account managers across 60 accounts.', // unfaithful: invented team and lead
      'Grew revenue to £650k and used Salesforce daily and planned trade shows.', // not one idea
    ],
    'Experienced Account Manager with a proven record of leading teams.', // role claim, unfaithful
  );

  it('passes a clean draft', async () => {
    const { verdict } = await judge.rubric(c, CLEAN);
    const failed = Object.entries(rubricScores(verdict, false)).filter(([, t]) => t.pass < t.total);
    expect(failed.map(([k]) => k)).toEqual([]);
  });

  it('flags every planted defect', async () => {
    const { verdict } = await judge.rubric(c, DEFECTS);
    const bullet = (n: number) => verdict.bullets.find((b) => b.id === `B1.${n}`);
    expect.soft(bullet(1)?.actionVerb, 'B1.1 actionVerb').toBe(false);
    expect.soft(bullet(2)?.faithful, 'B1.2 faithful').toBe(false);
    expect.soft(bullet(3)?.oneIdea, 'B1.3 oneIdea').toBe(false);
    expect.soft(verdict.summary.noRoleClaim, 'summary noRoleClaim').toBe(false);
    expect.soft(verdict.summary.faithful, 'summary faithful').toBe(false);
  });
});
