// Types for _prompt.mjs, for the CLI's TypeScript (src/ imports the module from
// kit/hooks/ so there is one prompt rubric). Never installed: the installer copies
// only *.mjs hooks. Change this file with _prompt.mjs.

export interface PromptCheck {
  id: string;
  label: string;
  pass: boolean;
}

/** The rubric's verdict on one prompt. */
export interface PromptScore {
  score: number;
  grade: string;
  words: number;
  vagueWords: number;
  checks: PromptCheck[];
  suggestions: string[];
}

export type PromptKind = 'empty' | 'command' | 'reply' | 'question' | 'task';

/** Why a task prompt should be restated as a brief: its gaps, the risky areas it touches, and its size. */
export interface Intake {
  score: number;
  words: number;
  missing: Array<'acceptance' | 'context' | 'scope'>;
  risks: string[];
  large: boolean;
}

/** Prompt-quality facts for one window. */
export interface PromptFacts {
  tasks: number;
  mean_score: number | null;
  with_acceptance: number;
  with_scope: number;
}

export function userText(message: unknown): string;
export function classifyPrompt(message: unknown): { kind: PromptKind; words: number };
export function scorePrompt(prompt: unknown): PromptScore;
export function improvePrompt(prompt: unknown, result?: PromptScore): string;
export function risksOf(message: unknown): string[];
export function intakeFor(message: unknown): Intake | null;
export function promptFacts(prompts: unknown): PromptFacts;
