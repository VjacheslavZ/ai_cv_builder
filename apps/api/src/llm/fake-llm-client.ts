import type { LlmCvOutput } from '@cv/shared';
import {
  LlmError,
  type GenerateCvRequest,
  type LlmClient,
  type LlmResponse,
} from './llm-client.js';

type Step =
  | { kind: 'valid'; output?: LlmCvOutput }
  | { kind: 'invalid' }
  | { kind: 'raw'; output: unknown }
  | { kind: 'transient'; status: number }
  | { kind: 'permanent'; status: number }
  | { kind: 'slow'; ms: number };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new LlmError('Request timed out', true));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LlmError('Request timed out', true));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A grounded answer built from the source lines: every bullet quotes its own line, so the whole
 * pipeline (grounding included) works end to end without a key. Not role-targeted.
 */
export function fakeLlmOutput(request: Pick<GenerateCvRequest, 'sources'>): LlmCvOutput {
  const lines = request.sources
    .flatMap((source) => source.text.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line.length >= 3 && line.length <= 500);
  const email = request.sources
    .map((s) => s.text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0])
    .find(Boolean);
  return {
    contact: {
      name: null,
      email: email ? { value: email, evidence: [email] } : null,
      phone: null,
      city: null,
      links: [],
    },
    summary: '',
    experience: lines.length
      ? [
          {
            company: '',
            title: '',
            start: null,
            end: null,
            evidence: [lines[0]!],
            bullets: lines.slice(0, 6).map((line) => ({ text: line, evidence: [line] })),
          },
        ]
      : [],
    education: [],
    skills: [],
    // Like the real model (prompt.ts), it asks about every empty place.
    questions: [
      { path: 'contact.name', type: 'missing', text: 'What is your full name?' },
      ...(email
        ? []
        : [
            {
              path: 'contact.email',
              type: 'missing' as const,
              text: 'What email should employers use?',
            },
          ]),
      { path: 'contact.phone', type: 'missing', text: 'What phone number should be on your CV?' },
      { path: 'summary', type: 'missing', text: 'What should your summary highlight?' },
      ...(lines.length
        ? [
            {
              path: 'experience.0.dates',
              type: 'missing' as const,
              text: 'When did you work here?',
            },
          ]
        : [{ path: 'experience', type: 'missing' as const, text: 'Tell us about your work.' }]),
      { path: 'education', type: 'missing', text: 'What is your education?' },
      {
        path: 'skills',
        type: 'missing',
        text: 'Which skills, tools, or certifications do you have?',
      },
    ],
  };
}

/**
 * Scripted `LlmClient` for tests, the e2e stack, and Phase 2 (testing.md, "FakeLlmClient
 * scenarios"). Each call consumes the next scripted step; with an empty script every call
 * returns a valid draft built from the source. `delayMs` applies to every call.
 */
export class FakeLlmClient implements LlmClient {
  readonly calls: GenerateCvRequest[] = [];
  private readonly script: Step[] = [];

  constructor(private readonly options: { delayMs?: number } = {}) {}

  /** A valid structured response (the given one, or one built from the source). */
  valid(output?: LlmCvOutput): this {
    this.script.push({ kind: 'valid', output });
    return this;
  }

  /** `n` responses that fail the schema, then whatever comes next (AC-6.6 re-requests). */
  invalid(n = 1): this {
    for (let i = 0; i < n; i++) this.script.push({ kind: 'invalid' });
    return this;
  }

  /** Exactly this output, e.g. a bad-output fixture (NFR-R5). */
  raw(output: unknown, times = 1): this {
    for (let i = 0; i < times; i++) this.script.push({ kind: 'raw', output });
    return this;
  }

  /** A response containing facts the source does not support; grounding removes them. */
  fabricated(output: LlmCvOutput): this {
    return this.valid(output);
  }

  /** `429` / `5xx` / `529` / timeout: BullMQ retries (AC-5.5). */
  transient(status = 529): this {
    this.script.push({ kind: 'transient', status });
    return this;
  }

  /** `400` / `401`: the job fails at once (AC-5.6). */
  permanent(status = 400): this {
    this.script.push({ kind: 'permanent', status });
    return this;
  }

  /** A call that takes `ms` before answering with the next step (deadline, shutdown tests). */
  slow(ms: number): this {
    this.script.push({ kind: 'slow', ms });
    return this;
  }

  async generateCv(request: GenerateCvRequest): Promise<LlmResponse> {
    this.calls.push(request);
    await sleep(this.options.delayMs ?? 0, request.signal);

    let step = this.script.shift() ?? { kind: 'valid' };
    while (step.kind === 'slow') {
      await sleep(step.ms, request.signal);
      step = this.script.shift() ?? { kind: 'valid' };
    }

    switch (step.kind) {
      case 'valid':
        return { output: step.output ?? fakeLlmOutput(request) };
      case 'raw':
        return { output: step.output };
      case 'invalid':
        return { output: { summary: 42, experience: 'not a list' } };
      case 'transient':
        throw new LlmError(`Fake transient error ${step.status}`, true, step.status);
      case 'permanent':
        throw new LlmError(`Fake permanent error ${step.status}`, false, step.status);
    }
  }
}
