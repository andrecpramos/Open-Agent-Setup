// `agent-setup eval-outcomes` — is the work better with the kit than without it?
//
// Every case in kit/skills/<skill>/evals/evals.json runs twice, each time in a fresh
// scratch project — the skill's `evals/fixture/` when it has one (the project its cases are
// about), otherwise a bare repository — committed on a `develop` branch:
//
//   kit      the kit installed the way a team gets it — skills, agents, hooks, AGENTS.md
//            (`--setup skills` copies only the skills and agents into the project)
//   vanilla  the same agent and project, nothing installed
//
// A separate grader run, blind to which arm produced what, checks everything the agent wrote
// and did, in order (timelineOf), its final reply and the files it changed against the case's
// `expectations`. Each expectation
// met is one passed trial. The kit arm's buckets are the scorecard (gated by
// `evals --check`, like the other suites); the vanilla arm is the reference beside it, so
// the lift — kit minus vanilla, per skill — is the answer to "is this better than vanilla?".
// A skill whose lift stays at zero teaches nothing and should be rewritten or removed.
//
// Every run is real agent usage: a full pass is cases × arms × runs agent runs plus as many
// grader runs. `--skill`, `--only` and `--max-runs` keep it small; a usage limit stops it.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIT_DIR, kitVersion } from './paths.mjs';
import { CliError, c, hashFile, listFiles, say, toPosix } from './util.mjs';
import { sync } from './sync.mjs';
import { EVAL_METHOD, activations, layFixture, laySkills, modelOf, previousScorecard, runError } from './routing.mjs';
import { agentFiles, skillDir, skillDirs } from './catalog.mjs';
/** Every outcome case in the kit, or one skill's; `id` is `<skill>/<id>`. */
export function loadOutcomeCases(skill) {
    const names = skill ? [skill] : skillDirs();
    const out = [];
    for (const name of names) {
        const file = join(skillDir(name), 'evals', 'evals.json');
        if (!existsSync(file)) {
            if (skill)
                throw new CliError(`kit/skills/${skill}/evals/evals.json does not exist`);
            continue;
        }
        const data = JSON.parse(readFileSync(file, 'utf8'));
        for (const e of data.evals ?? []) {
            const expectations = Array.isArray(e.expectations) ? e.expectations.filter((x) => typeof x === 'string' && x.trim() !== '' && !/^TODO/.test(x)) : [];
            if (typeof e.prompt !== 'string' || !e.prompt.trim() || /^TODO/.test(e.prompt) || !expectations.length)
                continue;
            out.push({ skill: name, id: String(e.id ?? out.length + 1), name: String(e.name ?? e.id ?? ''), prompt: e.prompt, expected: String(e.expected_output ?? ''), expectations });
        }
    }
    return out;
}
/** The final reply in an agent's stream-json output: the result event, else the last assistant text. */
export function finalText(stdout) {
    let last = '';
    let result = null;
    for (const line of String(stdout).split(/\r?\n/)) {
        if (!line.trim().startsWith('{'))
            continue;
        try {
            const e = JSON.parse(line);
            if (e.type === 'result' && typeof e.result === 'string')
                result = e.result;
            if (e.type === 'assistant') {
                const text = (e.message?.content ?? []).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
                if (text.trim())
                    last = text;
            }
        }
        catch {
            /* not a JSON line */
        }
    }
    return result ?? last;
}
/** The tools an agent called, in order — name and target only, for the grader. */
export function traceOf(stdout, limit = 60) {
    const out = [];
    for (const line of String(stdout).split(/\r?\n/)) {
        if (!line.includes('"tool_use"'))
            continue;
        try {
            const e = JSON.parse(line);
            if (e.type !== 'assistant')
                continue;
            for (const b of e.message?.content ?? []) {
                if (b.type !== 'tool_use' || typeof b.name !== 'string')
                    continue;
                const i = b.input ?? {};
                const target = [i.subagent_type, i.skill, i.command, i.file_path, i.pattern, i.url].find((v) => typeof v === 'string' && v);
                out.push(`${b.name}${target ? ` ${String(target).replace(/\s+/g, ' ').slice(0, 120)}` : ''}`);
            }
        }
        catch {
            /* not a JSON line */
        }
    }
    return out.length > limit ? [...out.slice(0, limit), `… ${out.length - limit} more`] : out;
}
/**
 * Everything the agent wrote and did, in order: its messages (a brief or plan written before
 * the first edit shows up here, and nowhere in the final reply) interleaved with its tool
 * calls. Long messages keep their start; a long run keeps its start and its end.
 */
export function timelineOf(stdout, budget = 14000) {
    const out = [];
    for (const line of String(stdout).split(/\r?\n/)) {
        if (!line.includes('"assistant"'))
            continue;
        try {
            const e = JSON.parse(line);
            if (e.type !== 'assistant')
                continue;
            for (const b of e.message?.content ?? []) {
                if (b.type === 'text' && typeof b.text === 'string' && b.text.trim())
                    out.push(`[says] ${b.text.trim().slice(0, 1200)}`);
                else if (b.type === 'tool_use' && typeof b.name === 'string') {
                    const i = b.input ?? {};
                    const target = [i.subagent_type, i.skill, i.command, i.file_path, i.pattern, i.url].find((v) => typeof v === 'string' && v);
                    out.push(`[does] ${b.name}${target ? ` ${String(target).replace(/\s+/g, ' ').slice(0, 160)}` : ''}`);
                }
            }
        }
        catch {
            /* not a JSON line */
        }
    }
    const text = out.join('\n');
    if (text.length <= budget)
        return text;
    return `${text.slice(0, Math.floor(budget * 0.6))}\n… (middle of the run left out)\n${text.slice(-Math.floor(budget * 0.4))}`;
}
/** The grader's instructions. It never learns which arm produced the work. */
export function gradePrompt(k, reply, files, timeline) {
    return [
        "You are grading an AI coding agent's work against a checklist. Judge only what the work shows:",
        'no credit for intentions it did not act on, or for claims the tools it used do not support.',
        '<work_in_order> is everything the agent wrote ([says]) and did ([does]), in order: what it',
        'wrote before its first edit counts as written before the work.',
        '',
        '<task>',
        k.prompt,
        '</task>',
        '',
        '<reference>',
        k.expected || '(none)',
        '</reference>',
        '',
        '<work_in_order>',
        timeline || '(nothing recorded)',
        '</work_in_order>',
        '',
        '<final_reply>',
        reply.slice(0, 8000) || '(no reply)',
        '</final_reply>',
        '',
        '<files_changed>',
        files || '(none)',
        '</files_changed>',
        '',
        'Checklist — decide each item on its own:',
        ...k.expectations.map((x, i) => `${i + 1}. ${x}`),
        '',
        'Answer with JSON only, no prose and no code fence:',
        '{"results":[{"item":1,"pass":true,"evidence":"at most 20 words"}]}',
    ].join('\n');
}
/** The grader's verdicts, or null when its answer is not the JSON asked for. Missing items fail. */
export function parseGrade(text, count) {
    const s = String(text);
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start < 0 || end <= start)
        return null;
    try {
        const v = JSON.parse(s.slice(start, end + 1));
        if (!Array.isArray(v.results))
            return null;
        const by = new Map(v.results.map((r) => [Number(r.item), r]));
        return Array.from({ length: count }, (_, i) => {
            const r = by.get(i + 1);
            return { item: i + 1, pass: r?.pass === true, evidence: typeof r?.evidence === 'string' ? r.evidence.slice(0, 200) : r ? '' : 'not graded' };
        });
    }
    catch {
        return null;
    }
}
/** Hash every file under a folder (except .git): the snapshot a run's changes are measured against. */
function snapshot(dir) {
    return new Map(listFiles(dir).filter((f) => !f.startsWith('.git/')).map((f) => [f, hashFile(join(dir, f))]));
}
/** What the agent wrote: files new or changed since the snapshot, outside .git and the kit's own state. */
export function changedFiles(dir, before, budget = 12000) {
    const parts = [];
    let left = budget;
    for (const f of listFiles(dir)) {
        if (f.startsWith('.git/') || f.startsWith('.agents/learnings/') || f.startsWith('.claude/learnings/') || f.startsWith('.claude/agent-memory') || f.startsWith('.claude/skills/'))
            continue;
        if (before.get(f) === hashFile(join(dir, f)))
            continue;
        if (left <= 0) {
            parts.push(`… more files changed (${f})`);
            break;
        }
        let text = '';
        try {
            text = readFileSync(join(dir, f), 'utf8');
        }
        catch {
            continue;
        }
        const chunk = text.slice(0, Math.min(4000, left));
        left -= chunk.length;
        parts.push(`--- ${f}${chunk.length < text.length ? ' (truncated)' : ''}\n${chunk}`);
    }
    return parts.join('\n');
}
/** A scratch project: a package manifest and a README, committed on develop. */
function scratchProject(dir) {
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'app', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`);
    writeFileSync(join(dir, 'README.md'), '# app\n');
    const g = (...args) => {
        execFileSync('git', ['-c', 'user.email=eval@example.com', '-c', 'user.name=eval', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
    };
    g('init', '-q', '-b', 'main');
    g('add', '-A');
    g('commit', '-q', '-m', 'init');
    g('checkout', '-q', '-b', 'develop');
}
/** Spawn argv (Windows .cmd shims through cmd.exe, each argument quoted) and collect its output. */
function runArgv(argv, cwd, timeoutS) {
    let file = argv[0];
    let args = argv.slice(1);
    let verbatim = false;
    if (process.platform === 'win32') {
        try {
            file =
                execFileSync('where', [argv[0]], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .find((p) => /\.(exe|cmd|bat)$/i.test(p)) ?? argv[0];
        }
        catch {
            /* not on PATH: let spawn report it */
        }
        if (/\.(cmd|bat)$/i.test(file)) {
            const quote = (a) => `"${String(a).replace(/"/g, '""')}"`;
            args = ['/d', '/s', '/c', `"${[file, ...argv.slice(1)].map(quote).join(' ')}"`];
            file = 'cmd.exe';
            verbatim = true;
        }
    }
    return new Promise((done) => {
        const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: verbatim });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
        const timer = setTimeout(() => child.kill(), timeoutS * 1000);
        child.on('error', (e) => (err += String(e)));
        child.on('close', (code) => {
            clearTimeout(timer);
            done({ out, err, code });
        });
    });
}
const USAGE_LIMIT_RE = /\b(usage|session|weekly|rate) limit\b|hit your [\w ]*limit|\b429\b|overloaded/i;
// Both arms may run the project's tests and read git; nothing else runs without asking, so
// neither arm gets a shell the other lacks.
// The same commands through either shell tool: on Windows the agent often reaches for PowerShell.
const ALLOWED = ['node:*', 'npm test:*', 'npm run test:*', 'git status:*', 'git diff:*', 'git log:*'].flatMap((c) => [`Bash(${c})`, `PowerShell(${c})`]);
/** Merge the buckets that ran into `<dir>/outcome.latest.json` (from the baseline when there is no latest). */
export function saveOutcomeScorecard(dir, results, runs, setup) {
    const file = join(dir, 'outcome.latest.json');
    const ran = results.find((r) => r.model)?.model ?? null;
    const { prev, restarted } = previousScorecard(dir, 'outcome', ran);
    const date = new Date().toISOString().slice(0, 10);
    const fresh = { kit: {}, vanilla: {} };
    for (const r of results) {
        if (r.passed === null)
            continue;
        const b = (fresh[r.arm][r.k.skill] ??= { passed: 0, total: 0, runs, date });
        b.total += r.k.expectations.length;
        b.passed += r.passed;
    }
    const buckets = { ...(prev.buckets ?? {}), ...fresh.kit };
    const vanilla = { ...(prev.vanilla ?? {}), ...fresh.vanilla };
    const sum = (bs, k) => Object.values(bs).reduce((a, b) => a + b[k], 0);
    const sorted = (bs) => Object.fromEntries(Object.entries(bs).sort(([a], [b]) => a.localeCompare(b)));
    const model = ran ?? prev.model ?? null;
    const card = {
        suite: 'outcome',
        candidate: `kit ${kitVersion()}${model ? ` + ${model}` : ''}`,
        kit: kitVersion(),
        method: EVAL_METHOD,
        model,
        date,
        runs: Math.min(...[...Object.values(buckets), ...Object.values(vanilla)].map((b) => b.runs ?? 1), runs),
        setup,
        buckets: sorted(buckets),
        vanilla: sorted(vanilla),
        metrics: {
            trials: sum(buckets, 'total'),
            passed: sum(buckets, 'passed'),
            vanillaTrials: sum(vanilla, 'total'),
            vanillaPassed: sum(vanilla, 'passed'),
        },
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`);
    return { file, restarted };
}
/** Lift per skill: kit pass rate minus vanilla pass rate, in points; null where an arm has not run. */
export function liftBySkill(card) {
    const rate = (b) => (b && b.total ? b.passed / b.total : null);
    const skills = [...new Set([...Object.keys(card.buckets ?? {}), ...Object.keys(card.vanilla ?? {})])].sort();
    return skills.map((skill) => {
        const k = rate(card.buckets?.[skill]);
        const v = rate(card.vanilla?.[skill]);
        return { skill, kit: k, vanilla: v, lift: k !== null && v !== null ? Math.round((k - v) * 100) : null };
    });
}
export async function evalOutcomes({ skill, only = [], arms = ['kit', 'vanilla'], runs = 1, maxRuns = 0, jobs = 2, timeout = 600, save = null, setup = 'install', cmd, graderCmd, verbose = false } = {}) {
    if (!['install', 'skills'].includes(setup))
        throw new CliError(`--setup must be install or skills, not "${setup}"`);
    const armList = arms.filter((a) => a === 'kit' || a === 'vanilla');
    if (!armList.length)
        throw new CliError('--arms takes kit, vanilla or both');
    const cases = loadOutcomeCases(skill).filter((k) => !only.length || only.includes(k.id) || only.includes(k.name));
    if (!cases.length)
        throw new CliError(`no outcome cases found${skill ? ` for ${skill}` : ''} (kit/skills/*/evals/evals.json)`);
    const agentArgv = cmd
        ? JSON.parse(cmd)
        : ['claude', '-p', '{prompt}', '--setting-sources', 'project', '--max-turns', '15', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED];
    const graderArgv = graderCmd ? JSON.parse(graderCmd) : ['claude', '-p', '{prompt}', '--setting-sources', 'project', '--max-turns', '1', '--output-format', 'json'];
    const known = new Set([...skillDirs(), ...agentFiles().map((a) => `agent:${a}`)]);
    const trials = cases.flatMap((k) => armList.flatMap((arm) => Array.from({ length: runs }, (_, n) => ({ k, arm, n }))));
    const queue = trials.slice(0, maxRuns > 0 ? maxRuns : trials.length);
    say(c.dim(`${cases.length} case(s) × ${armList.length} arm(s) × ${runs} run(s) = ${trials.length} agent run(s) + one short grader run each${queue.length < trials.length ? `; capped at ${queue.length}` : ''}. Setup: ${setup}.`));
    const work = mkdtempSync(join(tmpdir(), 'agent-setup-outcomes-'));
    const run = async ({ k, arm, n }) => {
        const dir = mkdtempSync(join(work, `${k.skill}-${k.id}-${arm}-r${n}-`));
        // A skill's evals/fixture is the project its cases are about; without one, a bare project.
        const fixture = join(skillDir(k.skill), 'evals', 'fixture');
        if (existsSync(fixture))
            layFixture(fixture, dir, { pending: false });
        else
            scratchProject(dir);
        if (arm === 'kit' && setup === 'install')
            sync(dir, { mode: 'install', profile: 'standard', skills: [k.skill], targets: ['agents', 'claude'], quiet: true, register: false, sdlcConfig: true });
        if (arm === 'kit' && setup === 'skills')
            laySkills(dir, 'claude');
        const before = snapshot(dir);
        const argv = agentArgv.map((a) => a.replaceAll('{prompt}', k.prompt).replaceAll('{kit}', KIT_DIR));
        const agent = await runArgv(argv, dir, timeout);
        const error = runError(agent.out, agent.code, agent.err);
        const base = { k, arm, model: modelOf(agent.out), skillLoaded: activations(agent.out, known).includes(k.skill) };
        if (error)
            return { ...base, passed: null, error, verdicts: [] };
        const graderDir = mkdtempSync(join(work, 'grade-'));
        const reply = finalText(agent.out);
        const trace = traceOf(agent.out);
        const prompt = gradePrompt(k, reply, changedFiles(dir, before), timelineOf(agent.out));
        const graded = await runArgv(graderArgv.map((a) => a.replaceAll('{prompt}', prompt)), graderDir, 300);
        let text = graded.out;
        try {
            const j = JSON.parse(graded.out);
            if (typeof j.result === 'string')
                text = j.result;
        }
        catch {
            text = finalText(graded.out) || graded.out;
        }
        const verdicts = parseGrade(text, k.expectations.length);
        if (!verdicts)
            return { ...base, passed: null, error: `grader answered without the JSON asked for: ${String(graded.err || text).trim().slice(0, 160)}`, verdicts: [], reply, trace };
        return { ...base, passed: verdicts.filter((v) => v.pass).length, error: null, verdicts, reply, trace };
    };
    const results = [];
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
    }
    finally {
        rmSync(work, { recursive: true, force: true });
    }
    // One line per case: each arm's expectations met, and which items the kit arm missed.
    for (const k of cases) {
        const mine = results.filter((r) => r.k === k);
        if (!mine.length) {
            say(`${c.dim('—')}  ${`${k.skill}/${k.id}`.padEnd(34)} ${c.dim('(not run)')}`);
            continue;
        }
        const cell = (arm) => {
            const rs = mine.filter((r) => r.arm === arm);
            if (!rs.length)
                return '—';
            const ok = rs.filter((r) => r.passed !== null);
            if (!ok.length)
                return c.red('ERROR');
            return `${ok.reduce((a, r) => a + (r.passed ?? 0), 0)}/${ok.length * k.expectations.length}`;
        };
        const kit = mine.find((r) => r.arm === 'kit' && r.passed !== null);
        const missed = kit ? kit.verdicts.filter((v) => !v.pass).map((v) => `#${v.item}`) : [];
        const loaded = mine.some((r) => r.arm === 'kit') ? (mine.some((r) => r.arm === 'kit' && r.skillLoaded) ? '' : c.yellow(' (skill did not load)')) : '';
        say(`   ${`${k.skill}/${k.id}`.padEnd(34)} kit ${cell('kit').padStart(5)}  vanilla ${cell('vanilla').padStart(5)}${loaded}${missed.length ? c.dim(`  missed ${missed.join(' ')}`) : ''}`);
        for (const r of mine.filter((x) => x.error))
            say(c.red(`      ${r.arm}: ${r.error}`));
        // Why each missed expectation was missed, in the grader's words: read these before changing anything.
        for (const r of mine.filter((x) => x.passed !== null)) {
            for (const v of r.verdicts.filter((x) => !x.pass))
                say(c.dim(`      ${r.arm} #${v.item} ${k.expectations[v.item - 1].slice(0, 70)} — ${v.evidence}`));
            if (verbose) {
                say(c.dim(`      ${r.arm} reply: ${(r.reply ?? '').replace(/\s+/g, ' ').slice(0, 300)}`));
                say(c.dim(`      ${r.arm} tools: ${(r.trace ?? []).join(' · ').slice(0, 400)}`));
            }
        }
    }
    const scored = results.filter((r) => r.passed !== null);
    const tally = { buckets: {}, vanilla: {} };
    for (const r of scored) {
        const b = ((r.arm === 'kit' ? tally.buckets : tally.vanilla)[r.k.skill] ??= { passed: 0, total: 0, runs, date: '' });
        b.total += r.k.expectations.length;
        b.passed += r.passed ?? 0;
    }
    say('', c.bold(`${'skill'.padEnd(28)}${'kit'.padStart(8)}${'vanilla'.padStart(10)}${'lift'.padStart(8)}`));
    const pct = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`);
    for (const l of liftBySkill(tally)) {
        const lift = l.lift === null ? '—' : `${l.lift > 0 ? '+' : ''}${l.lift}`;
        say(`${l.skill.padEnd(28)}${pct(l.kit).padStart(8)}${pct(l.vanilla).padStart(10)}${(l.lift !== null && l.lift <= 0 ? c.yellow(lift) : lift).padStart(8)}`);
    }
    const errored = results.filter((r) => r.passed === null).length;
    const notRun = trials.length - results.length;
    if (errored)
        say(c.red(`${errored} run(s) errored and were not scored. Rerun them before trusting these numbers.`));
    if (notRun)
        say(c.yellow(`${notRun} run(s) not run — ${stoppedBy ? 'stopped at a usage limit' : `--max-runs ${maxRuns}`}.`));
    if (save && scored.length) {
        const saved = saveOutcomeScorecard(save, scored, runs, setup);
        if (saved.restarted)
            say(c.yellow(`scorecard: ${saved.restarted}`));
        say(c.dim(`scorecard: ${toPosix(saved.file)}`));
    }
    return errored || notRun ? 1 : 0;
}
