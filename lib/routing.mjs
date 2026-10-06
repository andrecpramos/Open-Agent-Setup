// `agent-setup eval-routing` — does a real agent pick the right skill for a prompt?
//
// Cases live beside the skill they test: kit/skills/<skill>/evals/routing.json.
// Each file declares a `scope` — the skills its cases are about (names or @group).
// Only scoped skills count: `first` is the first scoped skill the agent activates,
// `none` means no scoped skill may activate, `forbid` lists scoped skills that must
// not activate at all. Other kit skills may legitimately fire alongside (a backend
// prompt should trigger `backend`), and are reported but never judged.
//
// Each case runs headless in a scratch folder holding a small index.html. The runner
// reads the agent's JSON event stream and records which skills were activated, in
// order: a skill counts when the agent invokes it by name or opens its SKILL.md.
// Only tool-call INPUTS are inspected, never tool results — a router's body links to
// every other skill, so scanning results would report skills merely mentioned.
//
// The kit's skills and agents are copied into each scratch folder (without their evals,
// so no answer is ever in reach). Default agent: Claude Code, which reads them from
// .claude/; a custom --cmd gets them in .agents/skills, where other agents look.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { KIT_DIR, kitVersion } from './paths.mjs';
import { CliError, c, say } from './util.mjs';
import { agentFiles, agentIndex, loadCatalog, skillDir, skillDirs, skillIndex } from './catalog.mjs';
/** All routing suites in the kit, or one skill's. */
export function loadRoutingSuites(skill) {
    const names = skill ? [skill] : skillDirs();
    const suites = [];
    for (const name of names) {
        const file = join(skillDir(name), 'evals', 'routing.json');
        if (!existsSync(file)) {
            if (skill)
                throw new CliError(`kit/skills/${skill}/evals/routing.json does not exist`);
            continue;
        }
        const data = JSON.parse(readFileSync(file, 'utf8'));
        suites.push({
            skill: name,
            file,
            kind: 'routing',
            scope: resolveScope(data.scope),
            cases: (data.cases ?? []).map((k) => ({ ...k, kind: 'routing' })),
            fixture: typeof data.fixture === 'string' && data.fixture ? join(skillDir(name), 'evals', data.fixture) : null,
        });
    }
    return suites;
}
/**
 * Every skill's trigger suite (evals/trigger.json, the skill-creator format), or
 * one skill's. Each entry becomes a case about that skill alone: it must load for
 * a `should_trigger` query and stay out of a near-miss.
 */
export function loadTriggerSuites(skill) {
    const names = skill ? [skill] : skillDirs();
    const suites = [];
    for (const name of names) {
        const file = join(skillDir(name), 'evals', 'trigger.json');
        if (!existsSync(file))
            continue;
        const data = JSON.parse(readFileSync(file, 'utf8'));
        const cases = data
            .filter((t) => typeof t.query === 'string' && t.query.trim())
            .map((t, i) => ({ id: `t${String(i + 1).padStart(2, '0')}`, prompt: t.query, kind: 'trigger', target: name, expect: t.should_trigger === true }));
        suites.push({ skill: name, file, kind: 'trigger', scope: new Set([name]), cases });
    }
    return suites;
}
/** Judge a trigger case: its skill loaded (anywhere in the run) exactly when it should. */
export function triggerVerdict(kase, got) {
    const loaded = got.includes(kase.target);
    if (kase.expect && !loaded)
        return `${kase.target} did not load`;
    if (!kase.expect && loaded)
        return `${kase.target} loaded for a near-miss`;
    return null;
}
/** The scorecard bucket a case counts in: `<skill>/should` or `<skill>/should-not`. */
export function bucketOf(k) {
    if (k.kind === 'trigger')
        return `${k.target}/${k.expect ? 'should' : 'should-not'}`;
    return `${k.suite?.skill ?? 'routing'}/${k.none ? 'should-not' : 'should'}`;
}
/**
 * Why a run cannot be scored, or null when it can. A launch that printed nothing,
 * or a run that ended in an API or usage-limit error, says nothing about routing
 * — scoring it as "no skill loaded" once turned a rate limit into a 20 % suite.
 * Running out of turns is a real result: the skill did not load in time.
 */
export function runError(stdout, code, stderr) {
    let events = 0;
    let result = null;
    for (const line of String(stdout).split(/\r?\n/)) {
        if (!line.trim().startsWith('{'))
            continue;
        try {
            const e = JSON.parse(line);
            events += 1;
            if (e.type === 'result')
                result = e;
        }
        catch {
            /* not a JSON line */
        }
    }
    const why = String(stderr).trim().split(/\r?\n/)[0]?.slice(0, 200) ?? '';
    if (!events)
        return `no output${code !== null ? ` (exit ${code})` : ''}${why ? `: ${why}` : ''}`;
    if (result?.is_error === true && result.subtype !== 'error_max_turns')
        return `agent error: ${String(result.result ?? result.subtype).slice(0, 200)}`;
    return null;
}
/** The model named in the agent's stream-json init event, when it reports one. */
export function modelOf(stdout) {
    for (const line of String(stdout).split(/\r?\n/)) {
        if (!line.includes('"init"'))
            continue;
        try {
            const e = JSON.parse(line);
            if (e.type === 'system' && e.subtype === 'init' && typeof e.model === 'string')
                return e.model;
        }
        catch {
            /* not a JSON line */
        }
    }
    return null;
}
/**
 * How the eval runs are measured: the scratch project and where its skills sit, what counts
 * as an activation, the verdict rules, the grader prompt. Bump it with any change to those.
 * Scorecards of another method — or of another model — are never merged into a new run nor
 * gated against it: the difference would be the measurement, not the kit.
 */
export const EVAL_METHOD = 2;
/** Why scorecard `prev` cannot be merged with or compared to `next`, or null when it can. */
export function incomparable(prev, next) {
    const m = (v) => (v === undefined || v === null ? 'unstamped' : `${String(v)}`);
    if (m(prev.method) !== m(next.method))
        return `measured with method ${m(prev.method)}, this one with ${m(next.method)}`;
    if (prev.model && next.model && prev.model !== next.model)
        return `measured on ${String(prev.model)}, this one on ${String(next.model)}`;
    return null;
}
/**
 * Read the scorecard a new run merges into: the latest, or just after `evals --promote` the
 * baseline. One of another method or model is set aside (`restarted` says why).
 */
export function previousScorecard(dir, kind, model) {
    for (const source of [join(dir, `${kind}.latest.json`), join(dir, `${kind}.baseline.json`)]) {
        let prev;
        try {
            prev = JSON.parse(readFileSync(source, 'utf8'));
        }
        catch {
            continue;
        }
        const why = incomparable(prev, { method: EVAL_METHOD, model });
        return why ? { prev: {}, restarted: `${basename(source)} was ${why} — not merged; buckets that did not run are left out` } : { prev, restarted: null };
    }
    return { prev: {}, restarted: null };
}
/**
 * Merge the buckets that just ran into `<dir>/<kind>.latest.json`, keeping the
 * buckets of cases that did not run, so a one-skill rerun updates only its rows.
 * With no latest yet (just after `evals --promote`), it starts from the baseline.
 */
export function saveScorecard(dir, kind, results, runs) {
    const file = join(dir, `${kind}.latest.json`);
    const ran = results.find((r) => r.model)?.model ?? null;
    const { prev, restarted } = previousScorecard(dir, kind, ran);
    const date = new Date().toISOString().slice(0, 10);
    const buckets = { ...(prev.buckets ?? {}) };
    const fresh = {};
    for (const r of results) {
        const b = (fresh[bucketOf(r.k)] ??= { passed: 0, total: 0, runs, date });
        b.total += 1;
        if (!r.problem)
            b.passed += 1;
    }
    Object.assign(buckets, fresh);
    const model = ran ?? prev.model ?? null;
    const card = {
        suite: kind,
        candidate: `kit ${kitVersion()}${model ? ` + ${model}` : ''}`,
        kit: kitVersion(),
        method: EVAL_METHOD,
        model,
        date,
        runs: Math.min(...Object.values(buckets).map((b) => b.runs ?? 1)),
        buckets: Object.fromEntries(Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b))),
        metrics: {
            trials: Object.values(buckets).reduce((a, b) => a + b.total, 0),
            passed: Object.values(buckets).reduce((a, b) => a + b.passed, 0),
        },
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`);
    return { file, restarted };
}
/** Expand ["@domain", "frontend"] into skill names using the catalog groups. */
export function resolveScope(scope) {
    const all = skillDirs();
    if (!Array.isArray(scope) || !scope.length)
        return new Set(all);
    const catalog = loadCatalog();
    const out = new Set();
    for (const s of scope) {
        // A subagent the agent should delegate to: agent:<name>, matched against Task/Agent calls.
        if (s.startsWith('agent:'))
            out.add(s);
        else if (s.startsWith('@')) {
            const group = s.slice(1);
            for (const [name, meta] of Object.entries(catalog.skills ?? {}))
                if (meta.group === group)
                    out.add(name);
        }
        else
            out.add(s);
    }
    return out;
}
/** Kit skills activated, in order, found in tool-call inputs of the event stream. */
export function activations(stdout, known) {
    const found = [];
    const note = (name) => {
        if (name !== undefined && known.has(name) && found.at(-1) !== name)
            found.push(name);
    };
    const scanString = (s) => {
        for (const m of s.matchAll(/(?:^|[\\/:\s"'])([a-z0-9]+(?:-[a-z0-9]+)*)[\\/]SKILL\.md/g))
            note(m[1]);
    };
    // Keys that carry what the agent asked a tool to do, across agent formats.
    const INPUT_KEYS = new Set(['input', 'arguments', 'args', 'command', 'cmd', 'file_path', 'path', 'params']);
    const walk = (node, inInput) => {
        if (typeof node === 'string') {
            if (inInput)
                scanString(node);
            return;
        }
        if (!node || typeof node !== 'object')
            return;
        if (Array.isArray(node)) {
            for (const v of node)
                walk(v, inInput);
            return;
        }
        // Claude Code's Skill tool: {"type":"tool_use","name":"Skill","input":{"skill":"agent-setup:x"}}
        if (node.type === 'tool_use' && node.name === 'Skill' && typeof node.input?.skill === 'string') {
            note(node.input.skill.split(':').pop());
            return;
        }
        // A delegation: {"type":"tool_use","name":"Agent","input":{"subagent_type":"agent-setup:scout", "prompt": …}}.
        // The prompt it carries is not scanned: a brief that names a skill is not the skill loading.
        if (node.type === 'tool_use' && (node.name === 'Agent' || node.name === 'Task') && typeof node.input?.subagent_type === 'string') {
            note(`agent:${node.input.subagent_type.split(':').pop()}`);
            return;
        }
        for (const [k, v] of Object.entries(node)) {
            if (['content', 'output', 'result', 'stdout', 'aggregated_output', 'text'].includes(k) && !inInput) {
                // Assistant message content still holds tool_use blocks; results do not.
                if (k === 'content' && Array.isArray(v))
                    for (const block of v)
                        if (block?.type === 'tool_use')
                            walk(block, false);
                continue;
            }
            walk(v, inInput || INPUT_KEYS.has(k));
        }
    };
    for (const line of String(stdout).split(/\r?\n/)) {
        const t = line.trim();
        if (!t.startsWith('{') && !t.startsWith('['))
            continue;
        try {
            walk(JSON.parse(t), false);
        }
        catch {
            /* not a JSON line */
        }
    }
    return found;
}
/** Judge one case against the activations, counting only scoped skills. Takes the full case or just its expectations. */
export function verdict(kase, got, scope) {
    const scoped = got.filter((s) => scope.has(s));
    if (kase.none)
        return scoped.length ? `expected no ${[...scope].length > 1 ? 'scoped ' : ''}skill, got ${scoped.join(' → ')}` : null;
    if (!scoped.length)
        return 'no scoped skill activated';
    if (kase.first && !kase.first.includes(scoped[0]))
        return `first skill ${scoped[0]}, expected one of ${kase.first.join(' | ')}`;
    const missing = (kase.need ?? []).filter((n) => !n.split('|').some((alt) => scoped.includes(alt)));
    if (missing.length)
        return `never activated: ${missing.join(', ')}`;
    const bad = (kase.forbid ?? []).filter((f) => scoped.includes(f));
    return bad.length ? `forbidden skill activated: ${bad.join(', ')}` : null;
}
/** A skill folder's files that an agent may see: everything but its evals. */
const NOT_EVALS = (src) => !/[\\/]evals([\\/]|$)/.test(src);
/**
 * Copy the kit's skills (and, for Claude Code, its agents) into a scratch project, the way
 * an agent finds a project's own: `.claude/skills` and `.claude/agents`, or
 * `.agents/skills` for other agents. Evals stay behind.
 */
export function laySkills(dir, layout) {
    const skillsDir = layout === 'claude' ? join(dir, '.claude', 'skills') : join(dir, '.agents', 'skills');
    // Both roles, as a default install lays them: the admin skills load only when invoked by name.
    for (const [name, e] of skillIndex()) {
        cpSync(e.path, join(skillsDir, name), { recursive: true, filter: (src) => NOT_EVALS(src.slice(e.path.length)) });
    }
    if (layout === 'claude') {
        mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
        for (const [name, e] of agentIndex())
            cpSync(e.path, join(dir, '.claude', 'agents', `${name}.md`));
    }
}
/**
 * Lay a suite's fixture into a scratch folder: the files, committed on a `develop` branch so
 * the folder looks like a project mid-work, then `.pending/` copied over as uncommitted
 * changes — the diff a "review my changes" case reviews.
 */
export function layFixture(fixture, dir, { pending = true } = {}) {
    cpSync(fixture, dir, { recursive: true, filter: (src) => !/[\\/]\.pending([\\/]|$)/.test(src.slice(fixture.length)) });
    const g = (...args) => {
        execFileSync('git', ['-c', 'user.email=eval@example.com', '-c', 'user.name=eval', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
    };
    g('init', '-q', '-b', 'main');
    g('add', '-A');
    g('commit', '-q', '-m', 'fixture');
    g('checkout', '-q', '-b', 'develop');
    const diff = join(fixture, '.pending');
    if (pending && existsSync(diff))
        cpSync(diff, dir, { recursive: true });
}
/**
 * How to start argv[0]. Native executables spawn directly. On Windows, npm-installed
 * CLIs are .cmd shims, which only run through cmd.exe; each argument is then quoted by
 * hand, because Node's shell:true concatenates arguments unescaped.
 */
function launcher(argv) {
    if (process.platform !== 'win32')
        return [argv[0], argv.slice(1)];
    let resolved = argv[0];
    try {
        resolved =
            execFileSync('where', [argv[0]], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
                .split(/\r?\n/)
                .map((s) => s.trim())
                .find((p) => /\.(exe|cmd|bat)$/i.test(p)) ?? argv[0];
    }
    catch {
        /* not on PATH: let spawn report it */
    }
    if (!/\.(cmd|bat)$/i.test(resolved))
        return [resolved, argv.slice(1)];
    const quote = (a) => `"${String(a).replace(/"/g, '""')}"`;
    return ['cmd.exe', ['/d', '/s', '/c', `"${[resolved, ...argv.slice(1)].map(quote).join(' ')}"`]];
}
/** `backend/t03 +` for a trigger case, `deliver/brief-first` for a routing case. */
export function caseLabel(k) {
    return k.kind === 'trigger' ? `${k.target}/${k.id} ${k.expect ? '+' : '-'}` : `${k.suite?.skill ?? '?'}/${k.id}`;
}
/** The summary rows: trials passed per scorecard bucket. */
function reportBuckets(results) {
    const buckets = new Map();
    for (const r of results) {
        const b = buckets.get(bucketOf(r.k)) ?? { passed: 0, total: 0 };
        b.total += 1;
        if (!r.problem)
            b.passed += 1;
        buckets.set(bucketOf(r.k), b);
    }
    say('', c.bold(`${'bucket'.padEnd(40)} passed`));
    for (const [name, b] of [...buckets].sort(([x], [y]) => x.localeCompare(y))) {
        const text = `${`${b.passed}/${b.total}`.padStart(7)}  ${Math.round((b.passed / b.total) * 100)}%`;
        say(`${name.padEnd(40)}${b.passed === b.total ? text : c.yellow(text)}`);
    }
}
/** An agent error that means the plan's limit was reached: every further run would fail too. */
const USAGE_LIMIT_RE = /\b(usage|session|weekly|rate) limit\b|hit your [\w ]*limit|\b429\b|overloaded/i;
export async function evalRouting({ skill, only = [], cmd, assume, jobs = 4, timeout = 300, suite = 'routing', runs = 1, save = null, maxRuns = 0 } = {}) {
    if (!['routing', 'trigger', 'all'].includes(suite))
        throw new CliError(`--suite must be routing, trigger or all, not "${suite}"`);
    const hasRouting = !skill || existsSync(join(skillDir(skill), 'evals', 'routing.json'));
    const suites = [
        ...(suite === 'trigger' || (suite === 'all' && !hasRouting) ? [] : loadRoutingSuites(skill)),
        ...(suite === 'routing' ? [] : loadTriggerSuites(skill)),
    ];
    if (!suites.length)
        throw new CliError(`no ${suite === 'all' ? '' : `${suite} `}suites found (kit/skills/*/evals/${suite === 'trigger' ? 'trigger' : 'routing'}.json)`);
    const known = new Set([...skillDirs(), ...agentFiles().map((a) => `agent:${a}`)]);
    const command = cmd
        ? JSON.parse(cmd)
        : // Project settings only: the user's own plugins and skills stay out, so the kit is measured
            // against Claude Code's built-in skills alone — the same field in every environment.
            ['claude', '-p', '{prompt}', '--setting-sources', 'project', '--max-turns', '6', '--output-format', 'stream-json', '--verbose'];
    const caps = new Set((assume ?? (cmd ? '' : 'non-gpt-model,no-image-generation')).split(',').filter(Boolean));
    const runnable = (k) => !k.when || caps.has(k.when);
    const work = mkdtempSync(join(tmpdir(), 'agent-setup-routing-'));
    const all = suites.flatMap((s) => s.cases.map((k) => ({ ...k, suite: s })));
    const selected = all.filter((k) => (!only.length || only.includes(k.id)) && runnable(k));
    const skipped = all.filter((k) => (!only.length || only.includes(k.id)) && !runnable(k));
    const trials = selected.flatMap((k) => Array.from({ length: runs }, (_, n) => ({ k, n })));
    const run = ({ k, n }) => {
        const dir = mkdtempSync(join(work, `${k.kind === 'trigger' ? `${k.target}-` : ''}${k.id}-r${n}-`));
        if (k.suite?.fixture)
            layFixture(k.suite.fixture, dir);
        else
            writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="en"><body><h1>Shop</h1><img src="a.png"><button>Buy</button></body></html>\n');
        laySkills(dir, cmd ? 'agents' : 'claude');
        const argv = command.map((a) => a.replaceAll('{prompt}', k.prompt).replaceAll('{kit}', KIT_DIR));
        const [file, fileArgs] = launcher(argv);
        return new Promise((done) => {
            const child = spawn(file, fileArgs, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: file === 'cmd.exe' });
            let out = '';
            let err = '';
            let settled = false;
            child.stdout.on('data', (d) => {
                out += d;
                // A should-trigger case is decided the moment its skill loads: stop paying for the rest.
                if (!settled && k.kind === 'trigger' && k.expect && /Skill|SKILL\.md/.test(String(d)) && activations(out, known).includes(k.target)) {
                    settled = true;
                    child.kill();
                }
            });
            child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
            const timer = setTimeout(() => child.kill(), timeout * 1000);
            child.on('close', (code) => {
                clearTimeout(timer);
                const got = activations(out, known);
                const error = settled ? null : runError(out, code, err);
                const problem = error ? null : k.kind === 'trigger' ? triggerVerdict(k, got) : verdict(k, got, k.suite.scope);
                done({ k, got, problem, error, model: modelOf(out) });
            });
        });
    };
    const results = [];
    // Every trial is a real agent run on the user's plan: cap them, and stop at the first
    // usage or rate limit instead of launching the rest of the queue into it.
    const queue = trials.slice(0, maxRuns && maxRuns > 0 ? maxRuns : trials.length);
    let notRun = trials.length - queue.length;
    let stoppedBy = null;
    try {
        await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
            while (queue.length && !stoppedBy) {
                const r = await run(queue.shift());
                results.push(r);
                if (r.error && USAGE_LIMIT_RE.test(r.error))
                    stoppedBy = r.error;
            }
        }));
        notRun += queue.length;
    }
    finally {
        rmSync(work, { recursive: true, force: true });
    }
    results.sort((a, b) => selected.indexOf(a.k) - selected.indexOf(b.k));
    // One line per case: pass, FAIL, flaky (some runs passed), or ERROR (the agent never ran).
    const scored = results.filter((r) => !r.error);
    const errored = results.filter((r) => r.error);
    const failed = scored.filter((r) => r.problem).length;
    for (const k of selected) {
        const mine = scored.filter((r) => r.k === k);
        const lost = errored.filter((r) => r.k === k);
        const bad = mine.filter((r) => r.problem);
        if (!mine.length && !lost.length) {
            say(`${c.dim('—    ')}  ${caseLabel(k).padEnd(30)} ${c.dim('(not run)')}`);
            continue;
        }
        const status = !mine.length ? c.red('ERROR') : !bad.length ? c.green('pass ') : bad.length === mine.length ? c.red('FAIL ') : c.yellow('flaky');
        const tally = runs > 1 ? ` ${mine.length - bad.length}/${mine.length}` : '';
        const query = k.kind === 'trigger' ? c.dim(`  ${k.prompt.slice(0, 60)}${k.prompt.length > 60 ? '…' : ''}`) : '';
        const why = bad.length ? `\n        ${bad[0].problem}` : !mine.length && lost.length ? `\n        ${lost[0].error}` : '';
        say(`${status}${tally}  ${caseLabel(k).padEnd(30)} ${mine[0]?.got.join(' → ') || '(none)'}${query}${why}`);
    }
    for (const k of skipped)
        say(`${c.dim('skip ')}  ${caseLabel(k).padEnd(30)} (assumes ${k.when})`);
    say('', `${scored.length - failed}/${scored.length} trials passed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
    if (errored.length)
        say(c.red(`${errored.length} run(s) errored and were not scored — ${errored[0].error}. Rerun them before trusting this suite.`));
    if (notRun)
        say(c.yellow(`${notRun} trial(s) not run — ${stoppedBy ? 'stopped at a usage limit' : `--max-runs ${maxRuns}`}. Their buckets keep their last scores.`));
    reportBuckets(scored);
    if (save) {
        for (const kind of ['routing', 'trigger']) {
            const mine = scored.filter((r) => r.k.kind === kind);
            if (!mine.length)
                continue;
            const saved = saveScorecard(save, kind, mine, runs);
            if (saved.restarted)
                say(c.yellow(`scorecard: ${saved.restarted}`));
            say(c.dim(`scorecard: ${saved.file}`));
        }
    }
    return failed || errored.length || notRun ? 1 : 0;
}
