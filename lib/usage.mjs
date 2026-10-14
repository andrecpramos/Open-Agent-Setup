// `agent-setup usage` — what the work cost, model by model, and what routing it across the
// model tiers saved, with the quality of routed windows beside the rest.
//
// From the rows the session-eval hook recorded in a project (or every registered project),
// or straight from one Claude Code transcript (`--transcript <file>`, `--session <id>`, or
// `--session current` for the project's live session) — the subagents' own transcripts
// included. The math is _usage.mjs's, the same the hook prints with `--usage`.
//
// Source of `lib/usage.mjs` — edit here, then `npm run build`. Never hand-edit the output.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTranscript, windowFacts } from '../kit/hooks/_transcript.mjs';
import { subagentUsage, usageReport, usageText } from '../kit/hooks/_usage.mjs';
import { readPointer, resolveTranscriptPath } from './eval-board.mjs';
import { isBaseline, projectRows } from './evals.mjs';
import { kitModels, modelsFor } from './models.mjs';
import { listProjects } from './state.mjs';
import { CliError, c, readText, say, toPosix } from './util.mjs';
/** One transcript, its subagents included, folded into a single row. */
export function transcriptRow(file) {
    const text = readText(file);
    if (text === null)
        throw new CliError(`cannot read ${toPosix(file)}`);
    const acc = parseTranscript(text);
    const row = { v: 1, session_id: acc.sessionId, window: 0, end: 'transcript', recorded_at: acc.ended ?? '', ...windowFacts(acc) };
    const agents = subagentUsage(file, acc.subagentRuns);
    if (Object.keys(agents).length)
        row.agents_usage = agents;
    return { row, reported: acc.costUsd };
}
export function usage(opts = {}) {
    const project = resolve(opts.project ?? '.');
    let report;
    let scope;
    let left = 0;
    if (opts.transcript || opts.session) {
        let file = opts.transcript ? resolve(opts.transcript) : null;
        if (!file) {
            const pointer = readPointer(project);
            const id = opts.session === 'current' ? (pointer?.session_id ?? '') : String(opts.session);
            file = resolveTranscriptPath(opts.session === 'current' ? pointer : null, id);
            if (!file)
                throw new CliError(opts.session === 'current' ? `no live session recorded in ${toPosix(project)} (the learning-signals hook writes the pointer when a session starts)` : `no transcript found for session ${id}`);
        }
        if (!existsSync(file))
            throw new CliError(`no such transcript: ${toPosix(file)}`);
        const { row, reported } = transcriptRow(file);
        const table = existsSync(resolve(project, '.agents')) ? modelsFor(project) : kitModels();
        report = usageReport([row], table, { reference: opts.vs, reported });
        scope = toPosix(file);
    }
    else {
        const projects = opts.all ? listProjects().map((p) => p.path) : [project];
        const all = projectRows(projects);
        // A measure-only baseline ran without the kit, so without routing: `agent-setup evals` compares it.
        const rows = all.filter((r) => !isBaseline(r));
        left = all.length - rows.length;
        const last = opts.last && opts.last > 0 ? opts.last : 0;
        report = usageReport(last ? rows.slice(-last) : rows, opts.all ? kitModels() : modelsFor(project), { reference: opts.vs });
        scope = opts.all ? `${projects.length} registered project(s)` : toPosix(project);
    }
    if (opts.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return 0;
    }
    say('', c.dim(scope));
    say(usageText(report));
    if (left)
        say(c.dim(`${left} baseline window(s) left out: they ran without the kit — \`agent-setup evals\` compares them.`));
    say('');
    return 0;
}
