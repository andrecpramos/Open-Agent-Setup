// `agent-setup usage` — what the work cost, model by model, and what routing it across the
// model tiers saved, with the quality of routed windows beside the rest.
//
// From the rows the session-eval hook recorded in a project (or every registered project),
// or straight from one Claude Code transcript (`--transcript <file>`, `--session <id>`, or
// `--session current` for the project's live session) — the subagents' own transcripts
// included. The math is _usage.mjs's, the same the hook prints with `--usage`; the live
// session is the one the learning-signals hook points at (.agents/learnings/live-session.json).
//
// Source of `lib/usage.mjs` — edit here, then `npm run build`. Never hand-edit the output.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseTranscript, windowFacts } from '../kit/hooks/_transcript.mjs';
import { subagentUsage, usageReport, usageText } from '../kit/hooks/_usage.mjs';
import type { ModelTable, UsageReport } from '../kit/hooks/_usage.mjs';
import { isBaseline, projectRows } from './evals.mjs';
import { homeDir } from './paths.mjs';
import { kitModels, modelsFor } from './models.mjs';
import { listProjects } from './state.mjs';
import { CliError, c, readText, say, toPosix } from './util.mjs';

export interface UsageOptions {
  /** A project folder (default: the current directory). */
  project?: string | null;
  /** Every registered project. */
  all?: boolean;
  /** Only the last n windows. */
  last?: number;
  /** The reference to compare with: main (default), a tier, or a model id. */
  vs?: string;
  /** One transcript file instead of the recorded rows. */
  transcript?: string | null;
  /** A session id of the project, or `current`, instead of the recorded rows. */
  session?: string | null;
  json?: boolean;
}

/** The live-session pointer the learning-signals hook leaves at session start. */
interface SessionPointer {
  session_id: string;
  transcript_path: string | null;
}

/** The project's current session, as the learning-signals hook recorded it, or null. */
function readPointer(project: string): SessionPointer | null {
  const raw = readText(join(homeDir(project, 'learnings'), 'live-session.json'));
  if (raw === null) return null;
  try {
    const p = JSON.parse(raw) as { session_id?: unknown; transcript_path?: unknown };
    return { session_id: typeof p.session_id === 'string' ? p.session_id : '', transcript_path: typeof p.transcript_path === 'string' ? p.transcript_path : null };
  } catch {
    return null;
  }
}

/** A session's transcript: the pointer's path while it exists, else found by id under Claude Code's projects folder. */
function transcriptOf(pointer: SessionPointer | null, sessionId: string): string | null {
  if (pointer?.transcript_path && existsSync(pointer.transcript_path)) return pointer.transcript_path;
  if (!sessionId) return null;
  const projects: string = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  let dirs: string[] = [];
  try {
    dirs = readdirSync(projects);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const candidate: string = join(projects, d, `${sessionId}.jsonl`);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not in this one
    }
  }
  return null;
}

/** One transcript, its subagents included, folded into a single row. */
export function transcriptRow(file: string): { row: Record<string, unknown>; reported: number | null } {
  const text = readText(file);
  if (text === null) throw new CliError(`cannot read ${toPosix(file)}`);
  const acc = parseTranscript(text);
  const row: Record<string, unknown> = { v: 1, session_id: acc.sessionId, window: 0, end: 'transcript', recorded_at: acc.ended ?? '', ...windowFacts(acc) };
  const agents = subagentUsage(file, acc.subagentRuns);
  if (Object.keys(agents).length) row.agents_usage = agents;
  return { row, reported: acc.costUsd };
}

export function usage(opts: UsageOptions = {}): number {
  const project: string = resolve(opts.project ?? '.');
  let report: UsageReport;
  let scope: string;
  let left = 0;
  if (opts.transcript || opts.session) {
    let file: string | null = opts.transcript ? resolve(opts.transcript) : null;
    if (!file) {
      const pointer = readPointer(project);
      const id: string = opts.session === 'current' ? (pointer?.session_id ?? '') : String(opts.session);
      file = transcriptOf(opts.session === 'current' ? pointer : null, id);
      if (!file) throw new CliError(opts.session === 'current' ? `no live session recorded in ${toPosix(project)} (the learning-signals hook writes the pointer when a session starts)` : `no transcript found for session ${id}`);
    }
    if (!existsSync(file)) throw new CliError(`no such transcript: ${toPosix(file)}`);
    const { row, reported } = transcriptRow(file);
    const table: ModelTable = existsSync(resolve(project, '.agents')) ? modelsFor(project) : kitModels();
    report = usageReport([row], table, { reference: opts.vs, reported });
    scope = toPosix(file);
  } else {
    const projects: string[] = opts.all ? listProjects().map((p) => p.path) : [project];
    const all = projectRows(projects);
    // A measure-only baseline ran without the kit, so without routing: `agent-setup evals` compares it.
    const rows = all.filter((r) => !isBaseline(r));
    left = all.length - rows.length;
    const last: number = opts.last && opts.last > 0 ? opts.last : 0;
    report = usageReport(last ? rows.slice(-last) : rows, opts.all ? kitModels() : modelsFor(project), { reference: opts.vs });
    scope = opts.all ? `${projects.length} registered project(s)` : toPosix(project);
  }
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  say('', c.dim(scope));
  say(usageText(report));
  if (left) say(c.dim(`${left} baseline window(s) left out: they ran without the kit — \`agent-setup evals\` compares them.`));
  say('');
  return 0;
}
