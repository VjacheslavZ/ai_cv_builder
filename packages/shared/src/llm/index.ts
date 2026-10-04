import { z } from 'zod';

// What the LLM must return (AC-6.6, AC-7.1). Deliberately separate from `CvDocument`: every
// fact carries `evidence` (verbatim quotes from the source), there are no ids (the server
// assigns them), and dates are raw strings the server parses. Strict length caps reject
// "huge strings" (NFR-R5). Nothing here may reach a CV before the grounding check.

export const LLM_EVIDENCE_MAX_LENGTH = 1_000;
export const LLM_QUESTIONS_MAX = 10;

/** Verbatim quotes from the source, in the source's language. */
const evidence = z.array(z.string().min(1).max(LLM_EVIDENCE_MAX_LENGTH)).min(1).max(8);

/** `YYYY`, `YYYY-MM`, or `present` (end dates only); `null` when the source has none. */
const llmDate = z
  .string()
  .regex(/^(\d{4}(-(0[1-9]|1[0-2]))?|present)$/)
  .nullable();

const contactField = z.object({ value: z.string().min(1).max(200), evidence }).nullable();

export const llmCvOutputSchema = z.object({
  contact: z.object({
    name: contactField,
    email: contactField,
    phone: contactField,
    city: contactField,
    links: z
      .array(
        z.object({
          label: z.string().max(100),
          url: z.string().min(1).max(2_048),
          evidence,
        }),
      )
      .max(10),
  }),
  /** 2–4 sentences. No evidence field: it is checked against the whole source. */
  summary: z.string().max(2_000),
  experience: z
    .array(
      z.object({
        company: z.string().max(200),
        title: z.string().max(200),
        start: llmDate,
        end: llmDate,
        evidence,
        bullets: z.array(z.object({ text: z.string().min(1).max(500), evidence })).max(30),
      }),
    )
    .max(30),
  education: z
    .array(
      z.object({
        institution: z.string().max(200),
        degree: z.string().max(200),
        start: llmDate,
        end: llmDate,
        evidence,
      }),
    )
    .max(20),
  skills: z.array(z.object({ name: z.string().min(1).max(100), evidence })).max(100),
  questions: z
    .array(
      z.object({
        /**
         * Index-based, since the LLM never sees ids: `contact.email`, `summary`, `experience`,
         * `experience.0.dates`, `experience.0.bullets`, `education`, `education.1.dates`,
         * `skills`. The server maps indexes to ids.
         */
        path: z.string().max(100),
        type: z.enum(['missing', 'vague']),
        text: z.string().min(1).max(300),
      }),
    )
    .max(LLM_QUESTIONS_MAX),
});

export type LlmCvOutput = z.infer<typeof llmCvOutputSchema>;
export type LlmQuestion = LlmCvOutput['questions'][number];
