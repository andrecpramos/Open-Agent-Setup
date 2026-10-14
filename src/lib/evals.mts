// `agent-setup evals` — the summary rows. For the kit: each eval scorecard
// (scorecards/<suite>.latest.json, written by `eval-routing --save`) against its
// committed baseline, compared by the agent-eval skill's compare-scorecards
// script. For projects: the metrics the session-eval hook recorded, the last
// windows against the ones before. `--check` is the CI gate; `--promote` accepts
// the latest scorecards as the new baselines after a reviewed change.
//
// Source of `lib/evals.mjs` — edit here, then `npm run build`. Never hand-edit the output.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { compareSets, compareWindows, readRows, summaryTable } from '../kit/hooks/_transcript.mjs';
import { usageLine, usageReport } from '../kit/hooks/_usage.mjs';
import type { WindowRow } from '../kit/hooks/_transcript.mjs';
import { KIT_DIR, KIT_ROOT, homeDir } from './paths.mjs';
import { kitModels, modelsFor } from './models.mjs';
import { listProjects } from './state.mjs';
import { liftBySkill } from './outcomes.mjs';
import { incomparable } from './routing.mjs';
import { c, say, toPosix } from './util.mjs';

const COMPARE: string = join(KIT_DIR, 'developer', 'skills', 'agent-eval', 'scripts', 'compare-scorecards.mjs');
const KINDS: string[] = ['routing', 'trigger', 'outcome'];

/** Options for `agent-setup evals`. */
export interface EvalsOptions {
  project?: string | null;
  last?: number;
  check?: boolean;
  promote?: boolean;
  json?: boolean;
  scorecards?: string | null;
}

/** One eval suite: its latest scorecard against the committed baseline. */
export interface SuiteSummary {
  suite: string;
  /** Only the baseline exists: nothing has run since the last promote. */
  accepted: boolean;
  trials: number;
  passed: number;
  baselineTrials: number | null;
  baselinePassed: number | null;
  model: string | null;
  date: string | null;
  regressions: string[];
  noise: string[];
  warnings: string[];
  /** Why the baseline cannot be compared with the latest (another method or model), or null. */
  incomparable: string | null;
  /** The lowest-scoring buckets of the latest scorecard, whatever the baseline says: where to work next. */
  weakest: Array<{ bucket: string; passed: number; total: number }>;
  /** Outcome suite only: kit minus vanilla pass rate per skill, in points. */
  lift?: Array<{ skill: string; kit: number | null; vanilla: number | null; lift: number | null }>;
}

interface CardBucket {
  passed?: number;
  total?: number;
}
interface Card {
  method?: number;
  model?: string | null;
  date?: string | null;
  buckets?: Record<string, CardBucket>;
  /** The outcome suite's reference arm: the same cases without the kit. */
  vanilla?: Record<string, CardBucket>;
}

function readCard(path: string): Card | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Card;
  } catch {
    return null;
  }
}

function totals(card: Card | null): { passed: number; total: number } {
  const bs: CardBucket[] = Object.values(card?.buckets ?? {});
  return { passed: bs.reduce((a, b) => a + (b.passed ?? 0), 0), total: bs.reduce((a, b) => a + (b.total ?? 0), 0) };
}

/** Every suite with a latest scorecard, compared with its baseline when one exists. */
export function suiteSummaries(dir: string): SuiteSummary[] {
  const out: SuiteSummary[] = [];
  for (const kind of KINDS) {
    const latest: string = join(dir, `${kind}.latest.json`);
    const baseline: string = join(dir, `${kind}.baseline.json`);
    const hasLatest: boolean = existsSync(latest);
    if (!hasLatest && !existsSync(baseline)) continue;
    // Right after a promote there is only the baseline: it is the current result.
    const card: Card | null = readCard(hasLatest ? latest : baseline);
    const base: Card | null = hasLatest && existsSync(baseline) ? readCard(baseline) : null;
    const accepted: boolean = !hasLatest;
    const summary: SuiteSummary = {
      suite: kind,
      ...((t) => ({ trials: t.total, passed: t.passed }))(totals(card)),
      accepted,
      baselineTrials: base ? totals(base).total : accepted ? totals(card).total : null,
      baselinePassed: base ? totals(base).passed : accepted ? totals(card).passed : null,
      model: card?.model ?? null,
      date: card?.date ?? null,
      regressions: [],
      noise: [],
      warnings: [],
      incomparable: base && card ? incomparable(base, card) : null,
      weakest: Object.entries(card?.buckets ?? {})
        .map(([bucket, b]) => ({ bucket, passed: b.passed ?? 0, total: b.total ?? 0 }))
        .filter((b) => b.total > 0 && b.passed < b.total)
        .sort((a, b) => a.passed / a.total - b.passed / b.total || b.total - a.total)
        .slice(0, 5),
    };
    if (kind === 'outcome') {
      const asBuckets = (bs?: Record<string, CardBucket>) => Object.fromEntries(Object.entries(bs ?? {}).map(([k, b]) => [k, { passed: b.passed ?? 0, total: b.total ?? 0, runs: 1, date: '' }]));
      summary.lift = liftBySkill({ buckets: asBuckets(card?.buckets), vanilla: asBuckets(card?.vanilla) });
    }
    if (summary.incomparable) {
      // Another method or model: the difference would be the measurement, not the kit.
      summary.warnings.push(`baseline ${summary.incomparable} — not compared; review the latest, then accept it with --promote`);
    } else if (base) {
      const r = spawnSync(process.execPath, [COMPARE, baseline, latest, '--json'], { encoding: 'utf8' });
      try {
        const res = JSON.parse(r.stdout) as { regressions: string[]; warnings: string[]; rows: Array<{ bucket: string; verdict: string }> };
        summary.regressions = res.regressions;
        summary.warnings = res.warnings.filter((w) => !w.startsWith('fewer than 3 runs'));
        summary.noise = res.rows.filter((x) => x.verdict === 'noise').map((x) => x.bucket);
      } catch {
        summary.regressions = [`compare-scorecards failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`];
      }
    }
    out.push(summary);
  }
  return out;
}

/**
 * Accept each latest scorecard as its suite's baseline. The file moves: one copy
 * (AGENTS.md rule 6), and the next `eval-routing --save` starts from the baseline's
 * buckets, so a one-skill rerun keeps every other skill's rows.
 */
export function promoteScorecards(dir: string): string[] {
  const done: string[] = [];
  for (const kind of KINDS) {
    const latest: string = join(dir, `${kind}.latest.json`);
    if (!existsSync(latest)) continue;
    renameSync(latest, join(dir, `${kind}.baseline.json`));
    done.push(kind);
  }
  return done;
}

/** Every eval-windows row from the given projects, oldest first. */
export function projectRows(projects: string[]): Array<WindowRow & { project: string }> {
  const rows: Array<WindowRow & { project: string }> = [];
  for (const p of projects) {
    const file: string = join(homeDir(p, 'learnings'), 'eval-windows.jsonl');
    if (!existsSync(file)) continue;
    for (const r of readRows(readFileSync(file, 'utf8'))) rows.push({ ...r, project: basename(p) });
  }
  const at = (r: WindowRow): string => r.ended ?? r.recorded_at ?? '';
  return rows.sort((a, b) => at(a).localeCompare(at(b)));
}

const pct = (n: number, d: number | null): string => (d ? `${Math.round((n / d) * 100)}%` : '—');

/** A row recorded by a measure-only install: the baseline the kit is compared with. */
export const isBaseline = (r: { setup?: { mode?: string } }): boolean => r.setup?.mode === 'measure';

/** The kit's windows against the baseline's, as plain text: the honest "with the kit vs without it". */
export function baselineTable(baseline: unknown[], kit: unknown[]): string {
  const cmp = compareSets(kit, baseline);
  const lines: string[] = [`${'metric'.padEnd(40)}${`baseline ${cmp.previousWindows}`.padStart(13)}${`kit ${cmp.windows}`.padStart(10)}`];
  for (const r of cmp.rows) lines.push(`${r.label.padEnd(40)}${r.prevShown.padStart(13)}${r.shown.padStart(10)}${r.trend && r.trend !== '=' ? `  ${r.trend}` : ''}`);
  return lines.join('\n');
}

/** Delegation and intake facts over some rows: which subagents ran, and briefs per task prompt. */
export function teamLine(rows: Array<{ tools?: { agents?: Record<string, number> }; prompt_quality?: { tasks?: number; briefs?: number } }>): string {
  const agents: Record<string, number> = {};
  let tasks = 0;
  let briefs = 0;
  for (const r of rows) {
    for (const [name, n] of Object.entries(r.tools?.agents ?? {})) agents[name] = (agents[name] ?? 0) + n;
    tasks += r.prompt_quality?.tasks ?? 0;
    briefs += r.prompt_quality?.briefs ?? 0;
  }
  const used: string = Object.entries(agents)
    .sort(([, a], [, b]) => b - a)
    .map(([n, k]) => `${n} ${k}`)
    .join(' · ');
  return `subagents: ${used || 'none'}  ·  briefs ${briefs} for ${tasks} task prompt(s)`;
}

export function evals(opts: EvalsOptions = {}): number {
  const dir: string = opts.scorecards ? resolve(opts.scorecards) : join(KIT_ROOT, 'scorecards');
  if (opts.promote) {
    const done: string[] = promoteScorecards(dir);
    say(done.length ? `Promoted ${done.join(' and ')}: the latest scorecards are now the baselines in ${toPosix(dir)}. Commit them with the change they accept.` : `No latest scorecards in ${toPosix(dir)} — run \`agent-setup eval-routing --suite all --save\` first.`);
    return 0;
  }
  const suites: SuiteSummary[] = opts.project ? [] : suiteSummaries(dir);
  const projects: string[] = opts.project ? [resolve(opts.project)] : listProjects().map((p) => p.path);
  const all = projectRows(projects);
  const baseline = all.filter(isBaseline);
  const rows = all.filter((r) => !isBaseline(r));
  const last: number = opts.last && opts.last > 0 ? opts.last : 20;
  const failed: boolean = suites.some((s) => s.regressions.length > 0);

  if (opts.json) {
    const vsBaseline = baseline.length ? compareSets(rows, baseline) : null;
    process.stdout.write(`${JSON.stringify({ suites, windows: compareWindows(rows, last), baseline: vsBaseline, projects: projects.length, rows: rows.length, baselineRows: baseline.length }, null, 2)}\n`);
    return opts.check && failed ? 1 : 0;
  }

  if (!opts.project) {
    say('', c.bold('Kit evals') + c.dim(`  ${toPosix(dir)} — latest against baseline`));
    if (!suites.length) say(c.dim('  No scorecards yet: run `agent-setup eval-routing --suite all --save`.'));
    else {
      say(c.bold(`${'suite'.padEnd(10)}${'trials'.padStart(7)}${'passed'.padStart(9)}${'baseline'.padStart(10)}   ${'model'.padEnd(20)}${'date'.padEnd(12)}verdict`));
      for (const s of suites) {
        const verdict: string = s.accepted
          ? c.green('baseline (nothing newer)')
          : s.baselineTrials === null
            ? c.yellow('no baseline — accept with --promote')
            : s.incomparable
              ? c.yellow('not comparable — see below')
              : s.regressions.length
                ? c.red(`REGRESSION (${s.regressions.length})`)
                : s.noise.length
                  ? `ok (${s.noise.length} within noise)`
                  : c.green('ok');
        say(`${s.suite.padEnd(10)}${String(s.trials).padStart(7)}${pct(s.passed, s.trials).padStart(9)}${pct(s.baselinePassed ?? 0, s.baselineTrials).padStart(10)}   ${(s.model ?? '?').padEnd(20)}${(s.date ?? '?').padEnd(12)}${verdict}`);
      }
      for (const s of suites) {
        for (const r of s.regressions) say(c.red(`  ${s.suite}: ${r}`));
        if (s.noise.length) say(c.dim(`  ${s.suite}: within noise, worth a look: ${s.noise.join(', ')}`));
        if (s.weakest.length) say(`  ${s.suite}: weakest — ${s.weakest.map((b) => `${b.bucket} ${b.passed}/${b.total}`).join(' · ')}`);
        if (s.lift?.length) say(`  ${s.suite}: lift over vanilla — ${s.lift.map((l) => `${l.skill} ${l.lift === null ? '?' : `${l.lift > 0 ? '+' : ''}${l.lift}`}`).join(' · ')}`);
        for (const w of s.warnings) say(c.dim(`  ${s.suite}: ${w}`));
      }
    }
  }

  if (baseline.length) {
    say('', c.bold('Baseline vs kit') + c.dim(`  ${baseline.length} measure-only window(s) against ${rows.length} with the kit${opts.project ? '' : ', all projects'}`));
    say(baselineTable(baseline, rows));
    if (baseline.length < 20 || rows.length < 20) say(c.dim('  fewer than 20 windows on a side: read it as a hint, not a result'));
  }
  const withRows: number = new Set(all.map((r) => r.project)).size;
  say('', c.bold('Sessions') + c.dim(`  ${opts.project ? toPosix(projects[0]) : `${withRows} of ${projects.length} registered project(s) with rows`}, ${rows.length} context window(s)`));
  if (!opts.project && !projects.length) say(c.dim('No registered projects: `agent-setup update <project>` registers an existing install.'));
  say(summaryTable(rows, last));
  if (rows.length) say(c.dim(`  ${teamLine(rows.slice(-last))}`));
  const cost: string = rows.length ? usageLine(usageReport(rows.slice(-last), opts.project ? modelsFor(projects[0]) : kitModels())) : '';
  if (cost) say(c.dim(`  cost: ${cost} — by model and tier: agent-setup usage ${opts.project ? '<project>' : '--all'}`));
  say('');
  return opts.check && failed ? 1 : 0;
}
