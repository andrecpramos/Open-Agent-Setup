// Types for _transcript.mjs, for the CLI's TypeScript (src/ imports the module
// from kit/hooks/ so there is one parser). Never installed: the installer copies
// only *.mjs hooks. Change this file with _transcript.mjs.

export interface SessionPrompt {
  text: string;
  ts: string | null;
}

export interface ModelStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  /** API calls: one per message id, however many transcript lines it spans. */
  calls: number;
  costUsd: number | null;
}

export interface ToolEntry {
  name: string;
  /** The command, file, URL or pattern (full text; never written to a row). */
  summary: string;
  error: boolean;
  /** The tool_result has arrived. */
  done: boolean;
  /** Estimated tokens of the result. */
  tokens: number;
  /** API calls made up to and including the one that requested this tool. */
  call: number;
  /** A Read of the same slice of a file, with no edit to it since the last read. */
  redundant: boolean;
  /** The check-command phrase ("npm test", "node --test", "gate-runner"), or null. */
  verify: string | null;
  /** A check that ran but reported failure without a failed call (gate-runner's BLOCKED). */
  checkFailed: boolean;
  /** Refused before it ran (permissions, the user, a hook): never counted as a check. */
  denied: boolean;
}

/** Folded transcript facts: token totals, tools, files and skill activity. */
export interface LiveSession {
  sessionId: string;
  prompts: SessionPrompt[];
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreate: number;
  calls: number;
  compactions: number;
  models: Record<string, ModelStats>;
  tools: ToolEntry[];
  /** Files an edit tool changed successfully. */
  filesChanged: string[];
  skillCalls: string[];
  skillDocReads: string[];
  /** One entry per Task/Agent call: the subagent type, without a plugin prefix. */
  agentCalls: string[];
  /** Assistant replies that restated the request as a brief (a Goal and an Acceptance line). */
  briefs: number;
  lastAssistantText: string;
  costUsd: number | null;
  apiMs: number | null;
  toolMs: number | null;
  totalMs: number | null;
  started: string | null;
  ended: string | null;
}

export interface HeavyResult {
  tool: string;
  /** A project-relative file path, or a shell command's program name. */
  target: string;
  tokens: number;
  /** tokens × the API calls after the result, each of which re-read it. */
  carried: number;
}

/** What one eval-windows.jsonl row records about a window, besides its identity. */
export interface WindowFacts {
  started: string | null;
  ended: string | null;
  prompts: number;
  /** Prompts that read as a correction or a standing instruction (isCorrection). */
  corrections: number;
  calls: number;
  models: Record<string, { input: number; output: number; cache_read: number; cache_create: number; calls: number }>;
  tokens: { input: number; output: number; cache_read: number; cache_create: number; cache_hit: number | null; tool_results: number };
  tools: { calls: number; failed: number; repeated_failures: number; subagents: number; agents: Record<string, number> };
  /** Task prompts in the window (classifyPrompt), their mean rubric score, and the briefs the agent wrote. */
  prompt_quality: { tasks: number; mean_score: number | null; with_acceptance: number; with_scope: number; briefs: number };
  skills: string[];
  files_changed: string[];
  /** `edited` counts code and config inside the project only: not prose, scratch files or agent memory. */
  verification: { edited: boolean; after_last_edit: boolean | null; passed: boolean | null; commands: string[]; last_edit: number | null };
  claims: { verified: boolean; unverified: boolean };
  waste: { tokens: number; share: number | null; carried: number; redundant_reads: number; redundant_tokens: number; failed_tokens: number };
  heavy: { count: number; tokens: number; carried: number; top: HeavyResult[] };
}

export const HEAVY_TOKENS: number;
export function emptySession(sessionId?: string): LiveSession;
export function addTranscriptLines(acc: LiveSession, text: string): LiveSession;
export function parseTranscript(text: string, sessionId?: string): LiveSession;
export function windowSlice(text: string): { index: number; text: string };
export function claimsVerification(text: string): boolean;
export function isCorrection(message: unknown): boolean;
/** A text with a Goal and an Acceptance line: the request restated as a brief. */
export function isBrief(text: unknown): boolean;
/** `checks`: a project's own check commands (its gate commands), matched as substrings of shell commands. */
export function windowFacts(acc: LiveSession, opts?: { root?: string; checks?: string[] }): WindowFacts;

/** A row of .claude/learnings/eval-windows.jsonl: the window's identity plus its facts. */
export interface WindowRow extends WindowFacts {
  v: number;
  session_id: string;
  window: number;
  end: string;
  recorded_at: string;
  /** The setup the window ran under: the kit version, and `measure` for a measure-only baseline install. */
  setup?: { kit: string | null; mode: 'measure' | 'full' };
}

export interface MetricSpec {
  key: string;
  label: string;
  better: 'up' | 'down';
  format: 'pct' | 'count' | 'ratio' | 'tokens';
  /** The starting goal from docs/PLAYBOOK.md, when there is one. */
  target?: number;
}

export interface WindowMetrics {
  windows: number;
  checked: number | null;
  passed: number | null;
  unverified: number | null;
  corrections: number | null;
  acceptance: number | null;
  failed: number | null;
  waste: number | null;
  heavy: number | null;
  cache_hit: number | null;
  cost: number | null;
  [key: string]: number | null;
}

export interface MetricRow {
  key: string;
  label: string;
  now: number | null;
  prev: number | null;
  shown: string;
  prevShown: string;
  trend: 'better' | 'worse' | '=' | null;
}

export const METRICS: MetricSpec[];
export function costUnits(tokens: unknown): number;
export function readRows(text: string): WindowRow[];
export function windowsSince(rows: unknown[], iso: string | null): number;
export function windowMetrics(rows: unknown[]): WindowMetrics;
export function formatMetric(format: string, v: number | null | undefined): string;
export function compareWindows(rows: unknown[], last?: number): { windows: number; previousWindows: number; rows: MetricRow[] };
export function compareSets(recent: unknown[], previous: unknown[]): { windows: number; previousWindows: number; rows: MetricRow[] };
export function summaryLine(rows: unknown[], last?: number): string;
export function summaryTable(rows: unknown[], last?: number): string;
