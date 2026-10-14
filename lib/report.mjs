// `agent-setup report` — the maintainer's weekly cycle in one command.
//
// It gathers what the other commands show one at a time — every registered project's
// health and learnings, the kit's eval scorecards, the session metrics (and the baseline
// comparison where a project measured first) — and ends with the next actions, ranked:
// the few things worth doing this week, each with its command. `--harvest` also collects
// the projects' proposals into inbox/ first; `--md <file>` writes the same report as
// Markdown to share with the team (it names projects, so keep it out of this repository).
//
// Source of `lib/report.mjs` — edit here, then `npm run build`. Never hand-edit the output.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { compareSets, compareWindows, formatMetric, METRICS, readRows, windowsSince } from '../kit/hooks/_transcript.mjs';
import { usageLine, usageReport } from '../kit/hooks/_usage.mjs';
import { kitModels } from './models.mjs';
import { KIT_ROOT, homeDir, kitVersion, sdlcConfigPath } from './paths.mjs';
import { listProjects, readManifest } from './state.mjs';
import { harvest, status } from './commands.mjs';
import { isBaseline, projectRows, suiteSummaries } from './evals.mjs';
import { c, readJsonFile, say, toPosix, writeText } from './util.mjs';
function lastRetro(project) {
    try {
        const dir = join(homeDir(project, 'learnings'), 'archive');
        return readdirSync(dir)
            .filter((f) => f.endsWith('.md'))
            .map((f) => statSync(join(dir, f)).mtime.toISOString())
            .sort()
            .pop() ?? null;
    }
    catch {
        return null;
    }
}
export function projectHealth(path) {
    const m = readManifest(path);
    const s = status(path, { quiet: true });
    const file = join(homeDir(path, 'learnings'), 'eval-windows.jsonl');
    const rows = existsSync(file) ? readRows(readFileSync(file, 'utf8')) : [];
    const retro = lastRetro(path);
    const cfgFile = sdlcConfigPath(path);
    const cfg = (cfgFile ? readJsonFile(cfgFile).value : null);
    const every = Number(cfg?.workflow?.retroEvery ?? 20);
    return {
        name: basename(path),
        path,
        version: m?.kit?.version ?? null,
        mode: m?.selection?.mode === 'measure' ? 'measure' : 'full',
        outdated: Boolean(s.outdated),
        windows: rows.length,
        lastWindow: rows.length ? String(rows[rows.length - 1].recorded_at ?? rows[rows.length - 1].ended ?? '').slice(0, 10) || null : null,
        sinceRetro: windowsSince(rows, retro),
        retroEvery: Number.isFinite(every) && every >= 0 ? every : 20,
        lastRetro: retro ? retro.slice(0, 10) : null,
        inbox: s.inbox ?? 0,
        universal: s.universal ?? 0,
        outbox: s.outbox ?? 0,
        provisional: cfg?._provisional === true,
        problems: (s.problems ?? []).length,
    };
}
/** The ranked next actions for the week, from the projects, the scorecards and the session metrics. */
export function nextActions(projects, suites, rows, retroEvery = 20) {
    const out = [];
    const names = (list) => list.map((p) => p.name).join(', ');
    const broken = projects.filter((p) => p.problems);
    if (broken.length)
        out.push({ rank: 0, why: `${names(broken)}: kit files missing or settings broken`, run: 'agent-setup status <project>, then update' });
    for (const s of suites)
        if (s.regressions.length)
            out.push({ rank: 1, why: `${s.suite} scorecard regressed (${s.regressions.length} bucket(s))`, run: 'read the failing cases; fix the skill, or `agent-setup evals --promote` an intended change' });
    for (const s of suites)
        if (s.incomparable)
            out.push({ rank: 2, why: `${s.suite} baseline is not comparable: ${s.incomparable} — nothing gates this suite`, run: 'review `agent-setup evals`, then `agent-setup evals --promote`' });
    const unbaselined = suites.filter((s) => s.suite !== 'outcome' && s.baselineTrials === null);
    if (unbaselined.length)
        out.push({ rank: 2, why: `no baseline for ${unbaselined.map((s) => s.suite).join(', ')} — nothing gates it`, run: 'review `agent-setup evals`, then `agent-setup evals --promote`' });
    const outbox = projects.filter((p) => p.outbox);
    if (outbox.length)
        out.push({ rank: 2, why: `${outbox.reduce((a, p) => a + p.outbox, 0)} kit proposal(s) waiting in ${names(outbox)}`, run: 'agent-setup harvest, then docs/maintaining/harvest.md' });
    // The learning loop's reminders live here, for the admin, not in developers' sessions.
    const universal = projects.filter((p) => p.universal);
    if (universal.length)
        out.push({ rank: 3, why: `${names(universal)}: universal lessons still in the inbox (never exported)`, run: '/self-improve retro in each of them' });
    const waiting = projects.filter((p) => p.inbox > p.universal);
    if (waiting.length)
        out.push({ rank: 3, why: `${waiting.reduce((a, p) => a + p.inbox - p.universal, 0)} lesson(s) waiting in the inbox of ${names(waiting)}`, run: '/self-improve retro in each of them' });
    // Each project's own threshold (`workflow.retroEvery`), grouped so the line stays short.
    const due = new Map();
    for (const p of projects) {
        const every = p.retroEvery ?? retroEvery;
        if (p.mode === 'full' && every > 0 && p.sinceRetro >= every)
            due.set(every, [...(due.get(every) ?? []), p]);
    }
    for (const [every, list] of due)
        out.push({ rank: 3, why: `${names(list)}: ${every}+ windows since the last retro`, run: '/self-improve retro in each of them' });
    const ready = projects.filter((p) => p.mode === 'measure' && p.windows >= 20);
    if (ready.length)
        out.push({ rank: 4, why: `${names(ready)}: the baseline has 20+ windows — time to turn the kit on`, run: 'agent-setup update <project> --setup full, then /sdlc-init there' });
    const provisional = projects.filter((p) => p.mode === 'full' && p.provisional);
    if (provisional.length)
        out.push({ rank: 4, why: `${names(provisional)}: no verified gates (sdlc.config.json is provisional)`, run: '/sdlc-init in each of them' });
    const outdated = projects.filter((p) => p.outdated);
    if (outdated.length)
        out.push({ rank: 5, why: `${names(outdated)}: behind kit ${kitVersion()}`, run: 'agent-setup update --all --dry-run, then update --all' });
    const kitRows = rows.filter((r) => !isBaseline(r));
    if (kitRows.length >= 5) {
        const now = compareWindows(kitRows, 20).rows;
        for (const m of METRICS) {
            const r = now.find((x) => x.key === m.key);
            if (m.target === undefined || r?.now === null || r?.now === undefined)
                continue;
            const off = m.better === 'up' ? r.now < m.target : r.now > m.target;
            if (off)
                out.push({ rank: 6, why: `${m.label}: ${r.shown} (target ${formatMetric(m.format, m.target)})`, run: 'docs/PLAYBOOK.md §3 names the lever; the retro finds the windows behind it' });
        }
    }
    // A model the price table does not know is costed at $0: the usage numbers would be wrong.
    const unpriced = kitRows.length ? usageReport(kitRows.slice(-100), kitModels()).unpriced : [];
    if (unpriced.length)
        out.push({ rank: 6, why: `no price for ${unpriced.join(', ')}: the usage report counts it as $0`, run: 'add it to kit/models.json (its price, with the source, and the family it belongs to), then lint' });
    for (const s of suites) {
        for (const b of s.weakest.filter((w) => w.total && w.passed / w.total < 0.7))
            out.push({ rank: 7, why: `${s.suite}: ${b.bucket} ${b.passed}/${b.total}`, run: `rewrite the description or the cases, then agent-setup eval-routing --suite all --skill ${b.bucket.split('/')[0]} --save` });
        for (const l of (s.lift ?? []).filter((x) => x.lift !== null && x.lift <= 0))
            out.push({ rank: 7, why: `${l.skill} adds nothing over vanilla (lift ${l.lift})`, run: `sharpen its "mistakes that matter", or drop it; then agent-setup eval-outcomes --skill ${l.skill} --save` });
    }
    if (!suites.some((s) => s.suite === 'outcome'))
        out.push({ rank: 8, why: 'no outcome scorecard yet: nothing says the kit beats vanilla', run: 'agent-setup eval-outcomes --skill deliver --save (then one skill at a time)' });
    if (!projects.length)
        out.push({ rank: 0, why: 'no registered projects', run: 'agent-setup install <project> --setup measure (a baseline first), or update an existing install' });
    return out.sort((a, b) => a.rank - b.rank);
}
export function report(opts = {}) {
    if (opts.harvest)
        harvest({});
    const projects = listProjects().map((p) => projectHealth(p.path));
    const suites = suiteSummaries(opts.scorecards ? resolve(opts.scorecards) : join(KIT_ROOT, 'scorecards'));
    const rows = projectRows(projects.map((p) => p.path));
    const baseline = rows.filter(isBaseline);
    const kitRows = rows.filter((r) => !isBaseline(r));
    const actions = nextActions(projects, suites, rows);
    const date = new Date().toISOString().slice(0, 10);
    const md = [`# Agent setup report — ${date}`, '', `Kit ${kitVersion()} · ${projects.length} project(s) · ${kitRows.length} window(s) with the kit · ${baseline.length} baseline window(s)`, ''];
    md.push('## Next actions', '');
    if (!actions.length)
        md.push('Nothing pressing. Keep working; run this again next week.');
    actions.forEach((a, i) => md.push(`${i + 1}. ${a.why} — \`${a.run}\``));
    md.push('', '## Projects', '', '| Project | Setup | Kit | Windows | Last | Since retro | Inbox | Outbox |', '|---|---|---|---|---|---|---|---|');
    for (const p of projects)
        md.push(`| ${p.name} | ${p.mode === 'measure' ? 'baseline' : 'kit'} | ${p.version ?? '?'}${p.outdated ? ' (behind)' : ''} | ${p.windows} | ${p.lastWindow ?? '—'} | ${p.sinceRetro} | ${p.inbox}${p.universal ? ` (${p.universal} universal)` : ''} | ${p.outbox} |`);
    md.push('', '## Kit evals', '');
    if (!suites.length)
        md.push('No scorecards yet.');
    for (const s of suites) {
        const rate = s.trials ? `${Math.round((s.passed / s.trials) * 100)}%` : '—';
        md.push(`- **${s.suite}**: ${s.passed}/${s.trials} (${rate})${s.regressions.length ? `, ${s.regressions.length} regression(s)` : ''}${s.lift?.length ? ` · lift over vanilla: ${s.lift.map((l) => `${l.skill} ${l.lift === null ? '?' : `${l.lift > 0 ? '+' : ''}${l.lift}`}`).join(', ')}` : ''}`);
    }
    md.push('', '## Sessions', '');
    if (baseline.length) {
        const cmp = compareSets(kitRows, baseline);
        md.push(`Baseline (${cmp.previousWindows} windows) against the kit (${cmp.windows}):`, '', '| Metric | Baseline | Kit | |', '|---|---|---|---|');
        for (const r of cmp.rows)
            md.push(`| ${r.label} | ${r.prevShown} | ${r.shown} | ${r.trend && r.trend !== '=' ? r.trend : ''} |`);
        md.push('');
    }
    const cmp = compareWindows(kitRows, 20);
    if (cmp.windows) {
        md.push(`With the kit, last ${cmp.windows} window(s)${cmp.previousWindows ? ` against the ${cmp.previousWindows} before` : ''}:`, '', '| Metric | Now | Before | Target |', '|---|---|---|---|');
        for (const r of cmp.rows) {
            const t = METRICS.find((m) => m.key === r.key)?.target;
            md.push(`| ${r.label} | ${r.shown} | ${r.prevShown} | ${t === undefined ? '' : formatMetric(METRICS.find((m) => m.key === r.key).format, t)} |`);
        }
    }
    else
        md.push('No windows recorded with the kit yet.');
    const cost = usageLine(usageReport(kitRows.slice(-20), kitModels()));
    if (cost)
        md.push('', `Model usage, last ${Math.min(20, kitRows.length)} window(s): ${cost}. By model and tier: \`agent-setup usage --all\`.`);
    if (opts.md) {
        const file = resolve(opts.md);
        if (file.toLowerCase().startsWith(resolve(KIT_ROOT).toLowerCase()))
            say(c.yellow('note: the report names projects — keep it out of this repository (inbox/ is gitignored; elsewhere is fine).'));
        writeText(file, `${md.join('\n')}\n`);
        say(`${c.green('wrote')} ${toPosix(file)}`);
        return 0;
    }
    say('', c.bold(`Agent setup report — ${date}`) + c.dim(`  kit ${kitVersion()} · ${projects.length} project(s) · ${kitRows.length} kit window(s) · ${baseline.length} baseline window(s)`), '');
    say(c.bold('Next actions'));
    if (!actions.length)
        say(c.green('  Nothing pressing. Keep working; run this again next week.'));
    actions.forEach((a, i) => say(`  ${String(i + 1).padStart(2)}. ${a.why}\n      ${c.dim(a.run)}`));
    say('', c.bold('Projects'));
    for (const p of projects) {
        say(`  ${p.name.padEnd(24)} ${(p.mode === 'measure' ? 'baseline' : 'kit').padEnd(9)} ${`${p.version ?? '?'}${p.outdated ? '*' : ''}`.padEnd(8)} ${String(p.windows).padStart(4)} windows · last ${p.lastWindow ?? '—'} · ${p.sinceRetro} since retro · inbox ${p.inbox} · outbox ${p.outbox}`);
    }
    if (!projects.length)
        say(c.dim('  none registered'));
    if (cost)
        say('', `${c.bold('Model usage')}  last ${Math.min(20, kitRows.length)} window(s): ${cost}`);
    say('', c.dim('Detail: agent-setup evals (scorecards and session metrics) · agent-setup usage --all (cost by model and tier) · agent-setup status --all · --md <file> to share this report'), '');
    return 0;
}
