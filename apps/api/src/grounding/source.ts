import { normalize } from './normalize.js';

// Sentences that address the model instead of describing the user. They are data, never facts:
// removing them before grounding means nothing can be "quoted" from an injection (AC-7.8).
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,60}\b(instructions?|prompts?|rules|guidelines)\b/i,
  /\b(system prompt|developer message|as an ai\b|you are (an? |the )?(ai|assistant|language model|llm))/i,
  /\b(add|insert|include|invent|claim)\b.{0,40}\b(to|in|into) (the|my|this) (cv|resume|résumé)\b/i,
];

/** Splits text into sentences and lines, keeping PDF line breaks as boundaries. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\r?\n/);
}

export function isInstruction(sentence: string): boolean {
  return INSTRUCTION_PATTERNS.some((re) => re.test(sentence));
}

/**
 * The text grounding checks against: every source joined, injection-like sentences removed,
 * then normalized. Quotes are matched as substrings of this.
 */
export function groundingSource(sources: string[]): string {
  const kept = sources.flatMap((source) => sentences(source).filter((s) => !isInstruction(s)));
  return normalize(kept.join('\n'));
}
