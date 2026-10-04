import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { CheckResult, Draft } from './checks.js';
import type { JudgeUsage, RubricVerdict } from './judge.js';

// Results of one `pnpm eval:llm` run. Written under eval/out/ (git-ignored): the drafts are
// synthetic, but they are CV text and never belong in logs or the repository.

const OUT_DIR = new URL('./out/', import.meta.url);
const BASELINE_DIR = new URL('./baseline/', OUT_DIR);

export interface Tally {
  pass: number;
  total: number;
}

export interface CaseRun {
  caseId: string;
  repeat: number;
  durationMs: number;
  /** Generator calls, including re-requests (AC-6.6, AC-7.7). */
  calls: number;
  generatorUsage: JudgeUsage;
  /** `null` when the pipeline failed (e.g. LLM_INVALID_OUTPUT). */
  draft: Draft | null;
  error?: string;
  /** The raw (pre-grounding) answer contained a forbidden token: the prompt let it through. */
  rawForbidden: string[];
  checks: CheckResult[];
  rubric?: { verdict: RubricVerdict; scores: Record<string, Tally> };
  pairwise?: { outcome: string; reason: string };
  judgeUsage: JudgeUsage;
}

/** Per-criterion pass counts of one rubric verdict; an empty summary is not graded. */
export function rubricScores(verdict: RubricVerdict, summaryEmpty: boolean): Record<string, Tally> {
  const scores: Record<string, Tally> = {};
  const add = (key: string, ok: boolean) => {
    const t = (scores[key] ??= { pass: 0, total: 0 });
    t.total++;
    if (ok) t.pass++;
  };
  for (const b of verdict.bullets) {
    add('bullet.actionVerb', b.actionVerb);
    add('bullet.oneIdea', b.oneIdea);
    add('bullet.faithful', b.faithful);
  }
  if (!summaryEmpty) {
    add('summary.leadsWithRelevantFacts', verdict.summary.leadsWithRelevantFacts);
    add('summary.noRoleClaim', verdict.summary.noRoleClaim);
    add('summary.faithful', verdict.summary.faithful);
  }
  for (const o of verdict.bulletOrder) add('bulletOrder.mostRelevantFirst', o.mostRelevantFirst);
  for (const q of verdict.questions) {
    add('question.specific', q.specific);
    add('question.typeCorrect', q.typeCorrect);
  }
  return scores;
}

const pct = (t: Tally) =>
  t.total ? `${Math.round((100 * t.pass) / t.total)}% (${t.pass}/${t.total})` : '–';

function merge(into: Record<string, Tally>, from: Record<string, Tally>) {
  for (const [k, t] of Object.entries(from)) {
    const acc = (into[k] ??= { pass: 0, total: 0 });
    acc.pass += t.pass;
    acc.total += t.total;
  }
}

/** Prints the summary tables and writes the full run to eval/out/runs/. Returns the file path. */
export function writeReport(runs: CaseRun[], meta: Record<string, unknown>): string {
  console.log('\n=== Per case ===');
  console.table(
    runs.map((r) => ({
      case: r.caseId,
      repeat: r.repeat,
      ok: r.draft ? 'yes' : r.error,
      calls: r.calls,
      s: Math.round(r.durationMs / 1000),
      removed: r.draft?.removed.length ?? '–',
      questions: r.draft?.questions.length ?? '–',
      'soft fails': r.checks
        .filter((c) => c.severity === 'soft' && !c.ok)
        .map((c) => c.id)
        .join('; '),
      vsBaseline: r.pairwise?.outcome ?? '–',
    })),
  );

  const checks: Record<string, Tally> = {};
  const rubric: Record<string, Tally> = {};
  const pairwise: Record<string, number> = {};
  for (const r of runs) {
    for (const c of r.checks) merge(checks, { [c.id]: { pass: +c.ok, total: 1 } });
    if (r.rubric) merge(rubric, r.rubric.scores);
    if (r.pairwise) pairwise[r.pairwise.outcome] = (pairwise[r.pairwise.outcome] ?? 0) + 1;
  }
  console.log('\n=== Deterministic checks ===');
  console.table(Object.fromEntries(Object.entries(checks).map(([k, t]) => [k, pct(t)])));
  if (Object.keys(rubric).length) {
    console.log(`\n=== Judge rubric (${String(meta.judgeModel)}) ===`);
    console.table(Object.fromEntries(Object.entries(rubric).map(([k, t]) => [k, pct(t)])));
  }
  if (Object.keys(pairwise).length) {
    console.log('\n=== Pairwise vs baseline ===');
    console.table(pairwise);
  }

  const sum = (pick: (r: CaseRun) => JudgeUsage) =>
    runs.reduce(
      (acc, r) => ({
        inputTokens: acc.inputTokens + pick(r).inputTokens,
        outputTokens: acc.outputTokens + pick(r).outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    );
  const tokens = { generator: sum((r) => r.generatorUsage), judge: sum((r) => r.judgeUsage) };
  console.log('\n=== Tokens ===');
  console.table(tokens);

  const dir = new URL('./runs/', OUT_DIR);
  mkdirSync(dir, { recursive: true });
  const file = new URL(`./${new Date().toISOString().replace(/[:.]/g, '-')}.json`, dir);
  writeFileSync(file, JSON.stringify({ meta, tokens, checks, rubric, pairwise, runs }, null, 2));
  return file.pathname;
}

type BaselineDraft = Pick<Draft, 'document' | 'questions'>;

export function readBaseline(caseId: string): BaselineDraft | null {
  try {
    return JSON.parse(
      readFileSync(new URL(`./${caseId}.json`, BASELINE_DIR), 'utf8'),
    ) as BaselineDraft;
  } catch {
    return null;
  }
}

/** Freezes a draft as the reference later runs are compared with; never regenerated silently. */
export function saveBaseline(caseId: string, draft: BaselineDraft): void {
  mkdirSync(BASELINE_DIR, { recursive: true });
  const { document, questions } = draft;
  writeFileSync(
    new URL(`./${caseId}.json`, BASELINE_DIR),
    JSON.stringify({ document, questions }, null, 2),
  );
}
