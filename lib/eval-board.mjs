// `agent-setup eval-board` — a small local UI for evaluating agent work.
//
// Source of `lib/eval-board.mjs` — edit here, then `npm run build`.
// Never hand-edit the output.
//
// Two modes share one rubric (prompt → run → output, the agent-eval
// trajectory):
//
//   manual  Paste a prompt, run numbers and output; the board scores each,
//           rewrites a weak prompt and suggests the cheapest fix first.
//   live    `eval-board --project <dir>` reads the project's installed skills
//           and tails the live Claude Code session (via the pointer the
//           learning-signals hook leaves in `.agents/learnings/`), so tokens,
//           cost, model, tool calls and skill activations are transcript fact,
//           not pasted guesses. Predictions (which skill *should* fire) stay
//           labelled heuristic; activations and usage are transcript truth.
//
// Zero runtime dependencies; Node 18+.
import { createServer } from 'node:http';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
// The transcript parser is shared with the session-eval hook, so it lives in kit/hooks/.
import { compareWindows, parseTranscript, readRows } from '../kit/hooks/_transcript.mjs';
import { homeDir } from './paths.mjs';
import { costOf, priceFor } from '../kit/hooks/_usage.mjs';
import { kitModels } from './models.mjs';
export { emptySession, addTranscriptLines, parseTranscript } from '../kit/hooks/_transcript.mjs';
// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
const wordsOf = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean);
function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v) {
    return typeof v === 'string' ? v : null;
}
function readTextOrNull(p) {
    try {
        return readFileSync(p, 'utf8');
    }
    catch {
        return null;
    }
}
function flagStr(flags, key) {
    const v = flags[key];
    return typeof v === 'string' && v ? v : null;
}
// ---------------------------------------------------------------------------
// Scoring shapes (owned by eval-board). The prompt rubric is shared with the
// prompt-intake hook and the session-eval rows, so it lives in kit/hooks/.
// ---------------------------------------------------------------------------
import { improvePrompt, scorePrompt } from '../kit/hooks/_prompt.mjs';
export { improvePrompt, scorePrompt } from '../kit/hooks/_prompt.mjs';
// ---------------------------------------------------------------------------
// 1 · Prompt — scorePrompt and improvePrompt come from kit/hooks/_prompt.mjs (above).
// ---------------------------------------------------------------------------
export function scoreRun(run) {
    const r = isRecord(run) ? run : {};
    const inputTokens = num(r['inputTokens']);
    const outputTokens = num(r['outputTokens']);
    const rawCost = Number(r['costUsd']);
    const cost = Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : null;
    const turns = Math.floor(num(r['turns']));
    const toolCalls = Math.floor(num(r['toolCalls']));
    const failedCalls = Math.min(Math.floor(num(r['failedCalls'])), toolCalls || 0);
    const durationMs = num(r['durationMs']);
    const filesChanged = Math.floor(num(r['filesChanged']));
    const totalTokens = inputTokens + outputTokens;
    const failRate = toolCalls > 0 ? failedCalls / toolCalls : 0;
    let score = 100;
    score -= failRate * 50;
    if (turns > 20)
        score -= Math.min((turns - 20) * 1.5, 20);
    if (totalTokens > 60000)
        score -= 15;
    else if (totalTokens > 30000)
        score -= 8;
    if (durationMs > 600000)
        score -= 10;
    else if (durationMs > 180000)
        score -= 5;
    if (toolCalls > 60)
        score -= 10;
    if (filesChanged === 0 && turns >= 5)
        score -= 10;
    if (inputTokens > 0 && outputTokens > 3 * inputTokens && outputTokens > 8000)
        score -= 5;
    score = clamp(Math.round(score), 0, 100);
    const suggestions = [];
    if (failRate >= 0.3)
        suggestions.push('High tool-failure rate — the agent is guessing at arguments. Pin file paths and schemas in the prompt.');
    else if (failRate > 0)
        suggestions.push('Some tool calls failed — check whether retries repeat the same bad arguments (a prompt bug) or vary (exploration).');
    if (turns > 20)
        suggestions.push('Many turns for the result — split the task or demand a plan up front so the run converges faster.');
    if (totalTokens > 30000)
        suggestions.push('Heavy token spend — narrow the file scope or ask for diffs only, not full-file rewrites.');
    if (filesChanged === 0 && turns >= 5)
        suggestions.push('Turns with no changed files — the run explored without landing. Require a concrete deliverable per step.');
    if (toolCalls > 60)
        suggestions.push('Very chatty tool use — ask the agent to batch independent reads/calls in one block.');
    if (durationMs > 180000)
        suggestions.push('Long wall-clock time — check for serial waits that could run in parallel.');
    if (!suggestions.length)
        suggestions.push('No efficiency red flags — record this run as the cost baseline.');
    const verdict = score >= 85 ? 'Efficient' : score >= 65 ? 'Healthy' : score >= 40 ? 'Wasteful signals' : 'Critical — intervene';
    return {
        score,
        verdict,
        metrics: {
            inputTokens,
            outputTokens,
            totalTokens,
            costUsd: cost,
            costPer1kTokens: cost !== null && totalTokens > 0 ? cost / (totalTokens / 1000) : null,
            turns,
            toolCalls,
            failedCalls,
            failRate: Math.round(failRate * 1000) / 1000,
            durationMs,
            filesChanged,
            tokensPerTurn: turns > 0 ? Math.round(totalTokens / turns) : totalTokens,
        },
        suggestions,
    };
}
// ---------------------------------------------------------------------------
// 3 · Output
// ---------------------------------------------------------------------------
const STRUCTURE_RE = /(^|\n)\s*(#{1,6}\s+\S|[-*]\s+\S|\d+[.)]\s+\S|```)/;
const PLACEHOLDER_RE = /\b(TODO|FIXME|XXX|lorem ipsum|\[?insert .{0,20}(here|below)|\.\.\. rest .*unchanged)\b/i;
const VERIFY_RE = /\b(test|verified|verified by|passes|green|checked against|ran `?[^`]* (test|lint|check))\b/i;
function keywordsOf(expectation) {
    return [...new Set(String(expectation).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4))];
}
export function scoreOutput(output, expectations) {
    const text = String(output ?? '');
    const trimmed = text.trim();
    const words = wordsOf(trimmed);
    const wants = (Array.isArray(expectations) ? expectations : []).map(String).filter((s) => s.trim());
    const lower = trimmed.toLowerCase();
    const covered = wants.filter((e) => {
        const keys = keywordsOf(e);
        if (!keys.length)
            return lower.includes(e.toLowerCase().trim());
        const need = Math.max(1, Math.ceil(keys.length / 3));
        return keys.filter((k) => lower.includes(k)).length >= need;
    });
    const coverage = wants.length ? covered.length / wants.length : 1;
    const missed = wants.filter((e) => !covered.includes(e));
    let score;
    const checks = [];
    if (!trimmed) {
        score = 0;
        checks.push({ id: 'non-empty', label: 'Produces output', pass: false });
    }
    else {
        const substance = words.length >= 30;
        const structure = STRUCTURE_RE.test(trimmed);
        const hygiene = !PLACEHOLDER_RE.test(trimmed);
        checks.push({ id: 'non-empty', label: 'Produces output', pass: true });
        checks.push({ id: 'substance', label: 'Substantive (30+ words)', pass: substance });
        checks.push({ id: 'structure', label: 'Structured (headers, lists or code blocks)', pass: structure });
        checks.push({ id: 'expectations', label: `Covers expectations (${covered.length}/${wants.length})`, pass: wants.length > 0 && missed.length === 0 });
        checks.push({ id: 'hygiene', label: 'No placeholders (TODO, lorem, "…rest unchanged")', pass: hygiene });
        score = clamp(Math.round(25 + (substance ? 20 : 0) + (structure ? 15 : 0) + 25 * coverage + (hygiene ? 15 : 0)), 0, 100);
    }
    const suggestions = [];
    if (!trimmed)
        suggestions.push('Empty output — check whether the run was cut short (turn limit, error) before judging quality.');
    else {
        if (words.length < 30)
            suggestions.push('Thin output — ask for the reasoning or the full change, not just the headline.');
        if (!STRUCTURE_RE.test(trimmed))
            suggestions.push('Unstructured output — require headers or a list so the result is scannable and reviewable.');
        for (const m of missed.slice(0, 5))
            suggestions.push(`Unaddressed expectation: "${m}" — promote it to an Acceptance line in the prompt.`);
        if (PLACEHOLDER_RE.test(trimmed))
            suggestions.push('Contains placeholders — demand complete files, no "rest unchanged" sketches.');
        if (!VERIFY_RE.test(trimmed))
            suggestions.push('No verification note — require the agent to state what it ran and what passed.');
        if (!suggestions.length)
            suggestions.push('Output holds up — keep these expectations as the regression set.');
    }
    return { score, words: words.length, coverage: Math.round(coverage * 100) / 100, covered: covered.length, total: wants.length, missed, checks, suggestions };
}
export function buildReport(args = {}) {
    const prompt = scorePrompt(args.promptText ?? '');
    const proc = scoreRun(args.run ?? {});
    const output = scoreOutput(args.outputText ?? '', args.expectations ?? []);
    const overall = Math.round(prompt.score * 0.3 + proc.score * 0.35 + output.score * 0.35);
    const workflow = [];
    if (prompt.score < 50 && (proc.score < 65 || (proc.metrics.costUsd ?? 0) > 0)) {
        workflow.push('Cheapest fix first: tighten the prompt (goal + constraints + scope) before rerunning — a weak prompt with an expensive run is the worst combination.');
    }
    if (output.missed.length && prompt.checks.find((k) => k.id === 'acceptance' && !k.pass)) {
        workflow.push('The missed expectations were never acceptance criteria — paste them into the prompt so the next run is graded against them.');
    }
    if (proc.metrics.failRate >= 0.2) {
        workflow.push('Fix the tool loop with explicit constraints (exact files, allowed commands) rather than more turns.');
    }
    if (output.checks.some((k) => k.id === 'hygiene' && !k.pass)) {
        workflow.push('Ban placeholder output in the prompt: "complete files only, no TODOs, no …rest unchanged".');
    }
    if (!workflow.length) {
        workflow.push(overall >= 80 ? 'Record this as the baseline: prompt, run metrics and output expectations together.' : 'Pick the lowest-scoring panel and fix one thing — prompt first, it is the cheapest lever.');
    }
    return {
        overall,
        verdict: overall >= 85 ? 'Ship it' : overall >= 65 ? 'Good with notes' : overall >= 40 ? 'Needs work' : 'Rework the workflow',
        prompt,
        process: proc,
        output,
        improvedPrompt: improvePrompt(String(args.promptText ?? ''), prompt),
        workflow,
        scorecard: {
            suite: 'eval-board',
            candidate: 'prompt + run + output',
            date: new Date().toISOString().slice(0, 10),
            runs: 1,
            buckets: {
                prompt: { passed: prompt.score, total: 100 },
                process: { passed: proc.score, total: 100 },
                output: { passed: output.score, total: 100 },
            },
            metrics: {
                total_tokens: proc.metrics.totalTokens,
                cost_usd: proc.metrics.costUsd,
                turns: proc.metrics.turns,
                tool_fail_rate: proc.metrics.failRate,
            },
        },
    };
}
export function evaluatePayload(payload) {
    const p = isRecord(payload) ? payload : {};
    return buildReport({
        promptText: p['prompt'] ?? p['promptText'] ?? '',
        run: p['run'] ?? {},
        outputText: p['output'] ?? p['outputText'] ?? '',
        expectations: Array.isArray(p['expectations']) ? p['expectations'] : typeof p['expectations'] === 'string' ? p['expectations'].split('\n') : [],
    });
}
/** One frontmatter field: `key: value` or a folded `key: >` block. Enough for skill descriptions. */
function frontmatterField(text, field) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!m)
        return null;
    const lines = m[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
        const kv = /^([A-Za-z0-9_-]+):(.*)$/.exec(lines[i]);
        if (!kv || kv[1] !== field)
            continue;
        const rest = kv[2].trim();
        if (rest && rest !== '>' && rest !== '|')
            return rest.replace(/^["']|["']$/g, '');
        const block = [];
        for (let j = i + 1; j < lines.length; j++) {
            if (!/^[ \t]/.test(lines[j]) || !lines[j].trim())
                break;
            block.push(lines[j].trim());
        }
        if (block.length)
            return block.join(' ');
        return null;
    }
    return null;
}
function dirNames(dir) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}
export function loadProject(dir) {
    const root = resolve(dir);
    const empty = { root, installed: false, kitVersion: null, profile: null, skills: [], agents: [], overlays: [] };
    let parsed = null;
    try {
        parsed = JSON.parse(readFileSync([join(root, '.agents', 'agent-setup.json'), join(root, '.claude', 'agent-setup.json')].find((f) => existsSync(f)) ?? join(root, '.agents', 'agent-setup.json'), 'utf8'));
    }
    catch {
        return empty;
    }
    if (!isRecord(parsed))
        return empty;
    const manifest = parsed;
    const kit = isRecord(manifest['kit']) ? manifest['kit'] : {};
    const selection = isRecord(manifest['selection']) ? manifest['selection'] : {};
    const skills = [];
    const skillsDir = homeDir(root, 'skills');
    for (const name of dirNames(skillsDir)) {
        const text = readTextOrNull(join(skillsDir, name, 'SKILL.md'));
        if (text === null)
            continue;
        skills.push({ name, description: frontmatterField(text, 'description') ?? '' });
    }
    let agents = [];
    try {
        const agentsDir = [join(root, '.claude', 'agents'), join(root, '.agents', 'agents')].find((d) => existsSync(d)) ?? join(root, '.claude', 'agents');
        agents = readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
    }
    catch {
        agents = [];
    }
    let overlays = [];
    try {
        overlays = readdirSync(homeDir(root, 'overlays')).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
    }
    catch {
        overlays = [];
    }
    return {
        root,
        installed: true,
        kitVersion: str(kit['version']),
        profile: str(selection['profile']),
        skills,
        agents,
        overlays,
    };
}
// ---------------------------------------------------------------------------
// Routing: heuristic prediction vs transcript activation
// ---------------------------------------------------------------------------
const ROUTE_STOP = new Set('the,a,an,and,or,for,with,from,that,this,these,those,into,onto,your,you,we,they,their,are,is,was,were,has,have,had,will,would,can,could,should,not,but,all,any,each,per,via,its,than,then,when,what,which,who,how,why,does,doing,done,just,like,more,most,such,also,over,under,about,other,than,there,their,been,being,both,either,neither,rather,while,wherease,whether,because,until,since,once,here,there,when,where,which,while,whom,whose,whosoever,whatsoever,yourselves,ourselves,themselves,itself,herself,myself,yourself,its,our,out,off,own,same,too,very,will,shall,may,might,must,need,dare,ought,used,using,use,uses,make,makes,made,take,takes,took,get,gets,got,give,given,look,looks,come,comes,came,know,knows,want,wants,help,please,thanks,hello,hi'.split(','));
function contentTokens(s) {
    const out = new Set();
    for (const w of s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)) {
        if (w.length >= 3 && !ROUTE_STOP.has(w))
            out.add(w);
    }
    return [...out];
}
/** Keyword-overlap guess at which installed skill a prompt wants. A heuristic — activation is the fact. */
export function predictSkills(prompt, skills, top = 3) {
    const pt = new Set(contentTokens(String(prompt ?? '')));
    if (!pt.size)
        return [];
    return skills
        .map((sk) => {
        const nameTok = sk.name.split('-');
        const descTok = new Set(contentTokens(sk.description));
        let score = 0;
        for (const t of pt) {
            if (nameTok.includes(t))
                score += 3;
            else if (descTok.has(t))
                score += 1;
        }
        return { name: sk.name, score };
    })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, top));
}
export function judgeRouting(prompt, skills, activated) {
    const predicted = predictSkills(prompt, skills);
    if (!skills.length)
        return { predicted, activated, match: null, note: 'No skills installed in this project — nothing to route to.' };
    if (!predicted.length)
        return { predicted, activated, match: null, note: 'No installed skill matches this prompt heuristically — the agent likely worked without one.' };
    const top = predicted[0].name;
    if (!activated.length)
        return { predicted, activated, match: false, note: `Heuristic guess: ${top} — but the transcript shows no skill loaded. Worth asking whether it worked without one or missed it.` };
    const match = activated.includes(top);
    return {
        predicted,
        activated,
        match,
        note: match
            ? `Heuristic guess ${top} matches a skill the agent actually loaded.`
            : `Heuristic guess was ${top}, but the agent loaded ${activated.join(' → ')}. Worth asking why — prediction is a keyword guess, activation is transcript fact.`,
    };
}
// The prices are kit/models.json's, the table every cost in the kit uses; the board
// prefers the transcript's real cost-state and marks these as estimates.
export function estimateCost(model, tokens) {
    const t = tokens ?? {};
    return costOf(priceFor(kitModels(), model), { input: t.input ?? 0, output: t.output ?? 0, cache_read: t.cacheRead ?? 0, cache_create: t.cacheCreate ?? 0, cache_create_1h: t.cacheCreate1h ?? 0 });
}
export function readPointer(projectDir) {
    const raw = readTextOrNull(join(homeDir(resolve(projectDir), 'learnings'), 'live-session.json'));
    if (raw === null)
        return null;
    try {
        const p = JSON.parse(raw);
        if (!isRecord(p))
            return null;
        return {
            session_id: str(p['session_id']) ?? '',
            transcript_path: str(p['transcript_path']),
            cwd: str(p['cwd']),
            started_at: str(p['started_at']),
        };
    }
    catch {
        return null;
    }
}
export function configDir() {
    return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
}
function findTranscriptBySession(sessionId) {
    if (!sessionId)
        return null;
    let projects;
    try {
        projects = readdirSync(join(configDir(), 'projects'));
    }
    catch {
        return null;
    }
    for (const proj of projects) {
        const candidate = join(configDir(), 'projects', proj, `${sessionId}.jsonl`);
        try {
            if (statSync(candidate).isFile())
                return candidate;
        }
        catch {
            // not here
        }
    }
    return null;
}
export function resolveTranscriptPath(pointer, sessionId) {
    if (pointer && pointer.transcript_path) {
        try {
            if (statSync(pointer.transcript_path).isFile())
                return pointer.transcript_path;
        }
        catch {
            // stale pointer — fall through to the scan
        }
    }
    return findTranscriptBySession(sessionId);
}
function readTail(path, maxBytes = 5_000_000) {
    const size = statSync(path).size;
    if (size <= maxBytes)
        return { text: readFileSync(path, 'utf8'), truncated: false };
    const fd = openSync(path, 'r');
    try {
        const buf = Buffer.alloc(maxBytes);
        readSync(fd, buf, 0, maxBytes, size - maxBytes);
        const s = buf.toString('utf8');
        const nl = s.indexOf('\n');
        return { text: nl >= 0 ? s.slice(nl + 1) : s, truncated: true };
    }
    finally {
        closeSync(fd);
    }
}
export function listRecentSessions(limit = 15) {
    const found = [];
    let projects;
    try {
        projects = readdirSync(join(configDir(), 'projects'));
    }
    catch {
        return [];
    }
    for (const proj of projects) {
        const dir = join(configDir(), 'projects', proj);
        let files;
        try {
            files = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const f of files) {
            if (!f.isFile() || !f.name.endsWith('.jsonl'))
                continue;
            const path = join(dir, f.name);
            try {
                found.push({ path, mtimeMs: statSync(path).mtimeMs });
            }
            catch {
                // vanished mid-scan
            }
        }
    }
    found.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const out = [];
    for (const { path, mtimeMs } of found.slice(0, Math.max(1, limit))) {
        let firstPrompt = '';
        let cwd = null;
        let costUsd = null;
        let sessionId = path.split(/[\\/]/).pop()?.replace(/\.jsonl$/, '') ?? '';
        try {
            const text = readFileSync(path, 'utf8');
            for (const line of text.split('\n')) {
                const t = line.trim();
                if (!t.startsWith('{'))
                    continue;
                let entry;
                try {
                    entry = JSON.parse(t);
                }
                catch {
                    continue;
                }
                if (!isRecord(entry))
                    continue;
                if (cwd === null) {
                    const c = str(entry['cwd']);
                    if (c)
                        cwd = c;
                }
                const sid = str(entry['sessionId']) ?? str(entry['session_id']);
                if (sid)
                    sessionId = sid;
                if (!firstPrompt && entry['type'] === 'user' && isRecord(entry['message'])) {
                    const c = entry['message']['content'];
                    if (typeof c === 'string' && c.trim())
                        firstPrompt = c.slice(0, 120);
                    else if (Array.isArray(c)) {
                        const t2 = c.filter(isRecord).filter((b) => b['type'] === 'text').map((b) => String(b['text'] ?? ''));
                        if (t2.length)
                            firstPrompt = t2.join(' ').slice(0, 120);
                    }
                }
                if (entry['type'] === 'cost-state') {
                    const n = Number(entry['totalCostUSD']);
                    if (Number.isFinite(n) && n >= 0)
                        costUsd = n;
                }
                if (firstPrompt && cwd !== null && costUsd !== null)
                    break;
            }
        }
        catch {
            continue;
        }
        out.push({ sessionId, transcript: path, mtimeMs, cwd, firstPrompt, costUsd });
    }
    return out;
}
export function snapshotLive(projectDir, opts = {}) {
    const notes = [];
    const setup = loadProject(projectDir);
    if (!setup.installed)
        notes.push('No .agents/agent-setup.json here — run the board without --project, or point it at an installed project.');
    const pointer = readPointer(projectDir);
    const sessionId = opts.sessionId ?? pointer?.session_id ?? null;
    if (!sessionId)
        notes.push('No live session pointer yet (.agents/learnings/live-session.json) — start a session in this project, or pick one in the board.');
    // An explicit session id distrusts the pointer: its transcript belongs to another session.
    const trustedPointer = pointer && (!opts.sessionId || !pointer.session_id || pointer.session_id === opts.sessionId) ? pointer : null;
    if (opts.sessionId && pointer && pointer.session_id && pointer.session_id !== opts.sessionId) {
        notes.push(`Following explicit session ${opts.sessionId} instead of the pointer (${pointer.session_id}).`);
    }
    const transcript = sessionId ? resolveTranscriptPath(trustedPointer, sessionId) : null;
    if (sessionId && !transcript)
        notes.push('Transcript file not found under the Claude config dir — the session may run on another machine.');
    let stats = null;
    let truncated = false;
    if (transcript) {
        try {
            const tail = readTail(transcript);
            truncated = tail.truncated;
            if (truncated)
                notes.push('Transcript exceeds the 5 MB tail cap — metrics cover the recent part only.');
            stats = parseTranscript(tail.text, sessionId ?? '');
        }
        catch {
            notes.push('Transcript unreadable — it may be mid-write; the next poll retries.');
        }
    }
    const latestPrompt = stats && stats.prompts.length ? stats.prompts[stats.prompts.length - 1].text : null;
    const prompt = latestPrompt !== null ? scorePrompt(latestPrompt) : null;
    let proc = null;
    let costUsd = null;
    let costEstimated = false;
    const models = [];
    if (stats) {
        const inAll = stats.inputTokens + stats.cacheRead + stats.cacheCreate;
        if (stats.costUsd !== null) {
            costUsd = stats.costUsd;
        }
        else {
            let est = 0;
            let known = false;
            for (const [model, m] of Object.entries(stats.models)) {
                const e = estimateCost(model, m);
                if (e !== null) {
                    est += e;
                    known = true;
                }
            }
            if (known) {
                costUsd = Math.round(est * 1_000_000) / 1_000_000;
                costEstimated = true;
                notes.push('No cost-state line yet — cost is estimated from public per-model rates.');
            }
            else if (Object.keys(stats.models).length) {
                notes.push('No cost-state line and no known rate for these models — cost unknown.');
            }
        }
        const durationMs = stats.started && stats.ended ? Math.max(0, Date.parse(stats.ended) - Date.parse(stats.started)) : (stats.totalMs ?? 0);
        proc = scoreRun({
            inputTokens: inAll,
            outputTokens: stats.outputTokens,
            costUsd,
            turns: stats.prompts.length,
            toolCalls: stats.tools.length,
            failedCalls: stats.tools.filter((t) => t.error).length,
            durationMs,
            filesChanged: stats.filesChanged.length,
        });
        for (const [model, m] of Object.entries(stats.models)) {
            const e = m.costUsd !== null ? { cost: m.costUsd, est: false } : (() => {
                const v = estimateCost(model, m);
                return v !== null ? { cost: v, est: true } : { cost: null, est: false };
            })();
            models.push({ model, input: m.input, output: m.output, calls: m.calls, costUsd: e.cost, estimated: e.est });
        }
        models.sort((a, b) => b.input + b.output - (a.input + a.output));
    }
    const activated = stats ? [...stats.skillCalls, ...stats.skillDocReads.filter((s) => !stats.skillCalls.includes(s))] : [];
    const routing = latestPrompt !== null && setup.installed ? judgeRouting(latestPrompt, setup.skills, activated) : null;
    const expectations = opts.expectations ?? [];
    const output = stats && stats.lastAssistantText && expectations.length ? scoreOutput(stats.lastAssistantText, expectations) : null;
    let overall = null;
    if (prompt && proc && output)
        overall = Math.round(prompt.score * 0.3 + proc.score * 0.35 + output.score * 0.35);
    else if (prompt && proc)
        overall = Math.round(prompt.score * 0.35 + proc.score * 0.65);
    if (stats && !stats.prompts.length)
        notes.push('Session has no user prompt yet — panels fill in on the first message.');
    let nextFix = null;
    let improved = null;
    if (latestPrompt !== null) {
        improved = improvePrompt(latestPrompt, prompt ?? undefined);
        if (routing && routing.match === false)
            nextFix = routing.note;
        else if (proc && proc.score < 85 && proc.suggestions.length)
            nextFix = proc.suggestions[0];
        else if (prompt && prompt.score < 85 && prompt.suggestions.length)
            nextFix = prompt.suggestions[0];
        else if (prompt && proc)
            nextFix = 'Record this session as the cost baseline.';
    }
    return { setup, pointer, sessionId, transcript, truncated, stats, prompt, process: proc, output, routing, overall, nextFix, improvedPrompt: improved, models, costUsd, costEstimated, notes };
}
const HISTORY_CAP = 200;
function historyFile(projectDir) {
    return join(homeDir(resolve(projectDir), 'learnings'), 'eval-history.jsonl');
}
/** Idempotent upsert: re-polling or restarting the board never duplicates a session. */
export function recordHistory(projectDir, live) {
    const stats = live.stats;
    if (!stats || !stats.prompts.length)
        return;
    const dir = homeDir(resolve(projectDir), 'learnings');
    try {
        mkdirSync(dir, { recursive: true });
    }
    catch {
        return;
    }
    const entry = {
        session_id: live.sessionId ?? stats.sessionId,
        date: new Date().toISOString().slice(0, 10),
        overall: live.overall,
        prompt: live.prompt ? live.prompt.score : null,
        process: live.process ? live.process.score : null,
        output: live.output ? live.output.score : null,
        turns: stats.prompts.length,
        tokens: stats.inputTokens + stats.outputTokens + stats.cacheRead + stats.cacheCreate,
        cost_usd: live.costUsd,
        cost_estimated: live.costEstimated,
        models: live.models.map((m) => m.model),
        fail_rate: live.process ? live.process.metrics.failRate : 0,
        files_changed: stats.filesChanged.length,
        predicted: live.routing ? live.routing.predicted.map((p) => p.name) : [],
        activated: live.routing ? live.routing.activated : [],
        routing_match: live.routing ? live.routing.match : null,
        exp_total: live.output ? live.output.total : 0,
        exp_covered: live.output ? live.output.covered : 0,
    };
    let lines = [];
    try {
        lines = readFileSync(historyFile(projectDir), 'utf8').split('\n').filter(Boolean);
    }
    catch {
        lines = [];
    }
    const kept = [];
    for (const l of lines) {
        try {
            const row = JSON.parse(l);
            if (row.session_id !== entry.session_id)
                kept.push(l);
        }
        catch {
            // drop corrupt rows
        }
    }
    kept.push(JSON.stringify(entry));
    try {
        writeFileSync(historyFile(projectDir), kept.slice(-HISTORY_CAP).map((l) => `${l}\n`).join(''));
    }
    catch {
        // history must never break the feed
    }
}
export function readHistory(projectDir, limit = HISTORY_CAP) {
    let lines = [];
    try {
        lines = readFileSync(historyFile(projectDir), 'utf8').split('\n').filter(Boolean);
    }
    catch {
        return [];
    }
    const out = [];
    for (const l of lines.slice(-limit)) {
        try {
            const row = JSON.parse(l);
            if (typeof row.session_id === 'string')
                out.push(row);
        }
        catch {
            // skip corrupt rows
        }
    }
    return out;
}
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
/** Session aggregates plus per-skill routing accuracy across sessions. */
export function historyTrends(entries) {
    const per = new Map();
    const bump = (name) => {
        let s = per.get(name);
        if (!s) {
            s = { skill: name, predicted: 0, activated: 0, hits: 0 };
            per.set(name, s);
        }
        return s;
    };
    let hits = 0;
    let judged = 0;
    for (const e of entries) {
        for (const p of e.predicted ?? [])
            bump(p).predicted += 1;
        for (const a of e.activated ?? [])
            bump(a).activated += 1;
        if (e.routing_match !== null && e.routing_match !== undefined) {
            judged += 1;
            if (e.routing_match)
                hits += 1;
            if ((e.predicted ?? []).length)
                bump(e.predicted[0]).hits += e.routing_match ? 1 : 0;
        }
    }
    return {
        sessions: entries.length,
        avgOverall: avg(entries.map((e) => e.overall).filter((v) => typeof v === 'number')),
        avgCost: avg(entries.map((e) => e.cost_usd).filter((v) => typeof v === 'number')),
        avgFailRate: avg(entries.map((e) => e.fail_rate).filter((v) => typeof v === 'number')),
        routingHitRate: judged ? Math.round((hits / judged) * 100) / 100 : null,
        perSkill: [...per.values()].sort((a, b) => b.predicted + b.activated - (a.predicted + a.activated)),
        recent: entries.slice(-10),
    };
}
/** One poll plus its history row: what `/api/live` and `--json --project` serve. */
export function snapshotAndRecord(projectDir, opts = {}) {
    const live = snapshotLive(projectDir, opts);
    recordHistory(projectDir, live);
    return live;
}
const CASE_KINDS = ['expectation', 'tool-loop', 'routing'];
function kebab(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'session';
}
function caseProposal(kind, o) {
    const regression = kind === 'routing'
        ? '```json\n{\n  "query": ' +
            JSON.stringify(o.prompt.slice(0, 300)) +
            ',\n  "should_trigger": true\n}\n```\nAdd to `kit/skills/<skill>/evals/trigger.json` when the lesson is universal; otherwise route it to the project overlay.'
        : '```json\n{\n  "prompt": ' +
            JSON.stringify(o.prompt.slice(0, 300)) +
            ',\n  "expected_output": ' +
            JSON.stringify(o.text.slice(0, 300)) +
            ',\n  "expectations": [' +
            JSON.stringify(o.text.slice(0, 200)) +
            ']\n}\n```\nAdd to `kit/skills/<skill>/evals/evals.json` (next id) when the lesson is universal; otherwise keep it as a project case.';
    return (`# Proposal (eval-board): ${o.title}\n\nSource: eval-board live session ${o.session} in this project, ${o.date}.\n` +
        `Skill: ${o.skill ?? '(none named)'}. Kind: ${kind}.\n\n## Evidence\n\n${o.evidence || '(no evidence attached)'}\n\n` +
        `## Generality\n\nNeeds triage: accept only if a competent agent errs this way in another repo; ` +
        `project-specific lessons belong in that project's overlay, not the kit.\n\n## Regression case\n\n${regression}\n`);
}
/**
 * Writes every promotion to the project case corpus (`.agents/learnings/eval-cases.jsonl`);
 * skill lessons (`tool-loop`, `routing`) additionally become outbox proposals so
 * `agent-setup harvest` can triage them into kit evals.
 */
export function promoteCase(projectDir, input) {
    if (!isRecord(input) || !CASE_KINDS.includes(input['kind']) || typeof input['text'] !== 'string' || !input['text'].trim()) {
        throw new Error('case needs {kind: expectation|tool-loop|routing, text}');
    }
    const kind = input['kind'];
    const text = input['text'].trim().slice(0, 500);
    const skill = typeof input['skill'] === 'string' && input['skill'].trim() ? input['skill'].trim().slice(0, 64) : null;
    const prompt = typeof input['prompt'] === 'string' ? input['prompt'].slice(0, 2000) : '';
    const evidence = typeof input['evidence'] === 'string' ? input['evidence'].slice(0, 2000) : '';
    const session = typeof input['sessionId'] === 'string' ? input['sessionId'] : '';
    const root = resolve(projectDir);
    const dir = homeDir(root, 'learnings');
    mkdirSync(dir, { recursive: true });
    const paths = [];
    const date = new Date().toISOString().slice(0, 10);
    const line = JSON.stringify({ ts: new Date().toISOString(), session_id: session, kind, skill, prompt: prompt.slice(0, 500), expectation: text, evidence: evidence.slice(0, 500) });
    const casesFile = join(dir, 'eval-cases.jsonl');
    let prev = '';
    try {
        prev = readFileSync(casesFile, 'utf8');
    }
    catch {
        prev = '';
    }
    writeFileSync(casesFile, `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${line}\n`);
    paths.push(casesFile);
    if (kind !== 'expectation') {
        const outbox = join(dir, 'outbox');
        mkdirSync(outbox, { recursive: true });
        const base = `${date}-eval-${kind}-${kebab(skill ?? session)}`;
        let dest = join(outbox, `${base}.md`);
        for (let n = 2; n < 100 && existsSync(dest); n++)
            dest = join(outbox, `${base}-${n}.md`);
        writeFileSync(dest, caseProposal(kind, { title: `${kind}: ${skill || session || 'session'}`, session: session || '(unknown)', date, skill, prompt, evidence, text }));
        paths.push(dest);
    }
    return { paths, kind };
}
// ---------------------------------------------------------------------------
// HTTP server + page
// ---------------------------------------------------------------------------
function escAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function renderPage(opts = {}) {
    const project = opts.project ?? null;
    return ('<!doctype html>\n' +
        '<html lang="en"><head><meta charset="utf-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
        '<title>agent-setup eval-board</title>\n' +
        '<style>' +
        'body{font-family:system-ui,-apple-system,sans-serif;max-width:960px;margin:0 auto;padding:24px;color:#1a1a1a;background:#fafafa}' +
        'h1{font-size:22px}h2{font-size:16px;margin:28px 0 8px}.card{background:#fff;border:1px solid #e2e2e2;border-radius:10px;padding:16px;margin:12px 0}' +
        'textarea,input,select{width:100%;box-sizing:border-box;font:inherit;padding:8px;border:1px solid #ccc;border-radius:6px}' +
        'textarea{min-height:90px}.row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}' +
        'button{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;cursor:pointer}' +
        'button.ghost{background:#fff;color:#1a1a1a}.bar{height:10px;background:#eee;border-radius:5px;overflow:hidden;margin:6px 0}' +
        '.bar i{display:block;height:100%;background:#2d7d46}ul{margin:6px 0;padding-left:20px;font-size:14px}' +
        '.score{font-size:28px;font-weight:700}pre{white-space:pre-wrap;background:#f4f4f4;padding:12px;border-radius:6px;font-size:13px}' +
        '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.muted{color:#666;font-size:13px}' +
        'table{border-collapse:collapse;font-size:13px;width:100%}td,th{border:1px solid #e2e2e2;padding:4px 8px;text-align:left}' +
        '.feed{font-size:13px}.feed li{margin-bottom:6px}' +
        '</style></head><body data-project="' +
        escAttr(project ?? '') +
        '">\n' +
        '<h1>agent-setup eval-board</h1>\n' +
        '<p class="muted">Offline heuristics for the agent-eval trajectory: prompt, run, output. Paste, evaluate, then copy the improved prompt and the scorecard.</p>\n' +
        '<div class="card" id="liveCard"><h2>Live session</h2><div id="liveSetup" class="muted">' +
        (project ? escAttr(`Project ${project} — loading…`) : 'Start the board with --project &lt;dir&gt; (or drop a project folder onto the launcher) for a live transcript feed.') +
        '</div><div id="liveBody" style="display:none">' +
        '<p><label>Session <select id="sess"></select></label> <label style="display:inline-block;width:auto"><input type="checkbox" id="auto" checked style="width:auto"> auto-refresh (2s)</label></p>' +
        '<p class="muted">Expectations for the latest output, one per line (optional):</p><textarea id="liveExpect" style="min-height:36px"></textarea>' +
        '<div id="live"></div><div id="caseMsg" class="muted"></div><div id="hist"></div></div></div>\n' +
        '<div class="card"><h2>1 · Prompt</h2><textarea id="prompt" placeholder="The exact prompt you gave (or plan to give) the agent…"></textarea></div>\n' +
        '<div class="card"><h2>2 · Run (process)</h2><div class="row">' +
        '<label>in tokens<input id="inT" type="number" min="0" value="0"></label>' +
        '<label>out tokens<input id="outT" type="number" min="0" value="0"></label>' +
        '<label>cost USD<input id="cost" type="number" min="0" step="0.001" placeholder="n/a"></label>' +
        '<label>turns<input id="turns" type="number" min="0" value="0"></label>' +
        '<label>tool calls<input id="tools" type="number" min="0" value="0"></label>' +
        '<label>failed calls<input id="failed" type="number" min="0" value="0"></label>' +
        '<label>duration ms<input id="dur" type="number" min="0" value="0"></label>' +
        '<label>files changed<input id="files" type="number" min="0" value="0"></label>' +
        '</div></div>\n' +
        '<div class="card"><h2>3 · Output</h2><textarea id="output" placeholder="The agent output to judge…"></textarea>' +
        '<p class="muted">Expectations, one per line:</p><textarea id="expect" style="min-height:56px" placeholder="Adds pagination to lib/sync.mjs&#10;Updates the tests&#10;States what was verified"></textarea></div>\n' +
        '<p><button id="go">Evaluate</button> <button id="dl" class="ghost" disabled>Download scorecard</button></p>\n' +
        '<div id="res"></div>\n' +
        '<script>\n' +
        'var proj = document.body.getAttribute("data-project") || "";\n' +
        'var last = null;\n' +
        'var liveD = null;\n' +
        'function escH(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }\n' +
        'function bar(v) { return "<div class=bar><i style=width:" + v + "%></i></div>"; }\n' +
        'function sugList(a) { var h = "<ul>"; for (var i = 0; i < a.length; i++) h += "<li>" + escH(a[i]) + "</li>"; return h + "</ul>"; }\n' +
        'function panel(t, r) {\n' +
        '  var h = "<div class=card><h2>" + escH(t) + " — " + r.score + "/100</h2>" + bar(r.score) + sugList(r.suggestions);\n' +
        '  return h + "</div>";\n' +
        '}\n' +
        'function refreshSessions() {\n' +
        '  fetch("/api/sessions", { signal: AbortSignal.timeout(15000) }).then(function (r) { return r.json(); }).then(function (d) {\n' +
        '    var sel = document.getElementById("sess"); sel.innerHTML = "";\n' +
        '    var list = d.sessions || [];\n' +
        '    if (d.pointer && d.pointer.session_id) list = list.filter(function (s) { return true; });\n' +
        '    for (var i = 0; i < list.length; i++) {\n' +
        '      var s = list[i]; var o = document.createElement("option"); o.value = s.sessionId;\n' +
        '      var label = (s.sessionId || "?").slice(0, 8) + " — " + (s.firstPrompt || "(no prompt yet)").slice(0, 60);\n' +
        '      if (d.pointer && s.sessionId === d.pointer.session_id) label = "* " + label;\n' +
        '      o.textContent = label; sel.appendChild(o);\n' +
        '    }\n' +
        '    if (d.pointer && d.pointer.session_id) sel.value = d.pointer.session_id;\n' +
        '    document.getElementById("liveBody").style.display = "";\n' +
        '    pollLive();\n' +
        '  }).catch(function (e) { document.getElementById("liveSetup").textContent = "Live feed failed: " + e; });\n' +
        '}\n' +
        'function pollLive() {\n' +
        '  if (!document.getElementById("auto").checked) return;\n' +
        '  var sid = document.getElementById("sess").value || "";\n' +
        '  var exp = document.getElementById("liveExpect").value.split("\\n").join(",");\n' +
        '  fetch("/api/live?session=" + encodeURIComponent(sid) + "&expect=" + encodeURIComponent(exp), { signal: AbortSignal.timeout(15000) })\n' +
        '    .then(function (r) { return r.json(); }).then(function (d) { renderLive(d); renderHist(); })\n' +
        '    .catch(function () { /* next poll retries */ });\n' +
        '}\n' +
        'function latestPromptText() { return (liveD && liveD.stats && liveD.stats.prompts.length) ? liveD.stats.prompts[liveD.stats.prompts.length - 1].text : ""; }\n' +
        'function postCase(kind, text, skill, prompt, evidence) {\n' +
        '  var sid = document.getElementById("sess").value || "";\n' +
        '  fetch("/api/case", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15000),\n' +
        '    body: JSON.stringify({ sessionId: sid, kind: kind, text: text, skill: skill || null, prompt: prompt || "", evidence: evidence || "" }) })\n' +
        '    .then(function (r) { return r.json(); }).then(function (d) {\n' +
        '      document.getElementById("caseMsg").textContent = d.paths ? ("Case saved: " + d.paths.join(", ")) : ("Case failed: " + d.error);\n' +
        '    }).catch(function (e) { document.getElementById("caseMsg").textContent = "Case failed: " + e; });\n' +
        '}\n' +
        'function promoteMissed(k) { postCase("expectation", liveD.output.missed[k], null, latestPromptText(), ""); }\n' +
        'function promoteRouting() { var top = liveD.routing.predicted.length ? liveD.routing.predicted[0].name : null;\n' +
        '  postCase("routing", "Agent loaded " + liveD.routing.activated.join(", ") + " instead of predicted " + (top || "?"), top, latestPromptText(), liveD.routing.note); }\n' +
        'function promoteLoop() { var fails = liveD.stats.tools.filter(function (t) { return t.error; });\n' +
        '  var ev = fails.slice(0, 3).map(function (t) { return t.name + ": " + t.summary; }).join("; ");\n' +
        '  postCase("tool-loop", "Tool failure loop (" + fails.length + " failed calls)", null, latestPromptText(), ev); }\n' +
        'function copyLiveImp() { var t = document.getElementById("liveImp").textContent; if (navigator.clipboard) navigator.clipboard.writeText(t); }\n' +
        'function copyOverlay() { var t = "# Project overlay (from eval-board)\\n\\n" + (liveD.nextFix ? ("- " + liveD.nextFix + "\\n") : "") + "\\n```\\n" + document.getElementById("liveImp").textContent + "\\n```\\n"; if (navigator.clipboard) navigator.clipboard.writeText(t); }\n' +
        'function renderHist() {\n' +
        '  fetch("/api/history").then(function (r) { return r.json(); }).then(function (h) {\n' +
        '    var t = h.trends; var s = "<div class=card><h2>History</h2>";\n' +
        '    var w = h.windows; if (w && w.windows) { s += "<p class=muted>Context windows recorded by session-eval: last " + w.windows + (w.previousWindows ? " vs the " + w.previousWindows + " before" : "") + "</p><table><tr><th>metric</th><th>last</th><th>before</th><th></th></tr>";\n' +
        '      for (var j = 0; j < w.rows.length; j++) { var m = w.rows[j]; s += "<tr><td>" + escH(m.label) + "</td><td>" + escH(m.shown) + "</td><td>" + escH(m.prevShown) + "</td><td>" + (m.trend && m.trend !== "=" ? escH(m.trend) : "") + "</td></tr>"; }\n' +
        '      s += "</table>"; }\n' +
        '    if (!t || !t.sessions) { document.getElementById("hist").innerHTML = s + "<p class=muted>No past sessions yet — rows land here as sessions run.</p></div>"; return; }\n' +
        '    s += "<p class=muted>" + t.sessions + " session(s) · avg overall " + (t.avgOverall === null ? "?" : t.avgOverall) + " · avg cost $" + (t.avgCost === null ? "?" : t.avgCost) + " · avg fail rate " + (t.avgFailRate === null ? "?" : t.avgFailRate) + " · routing hits " + (t.routingHitRate === null ? "?" : t.routingHitRate) + "</p>";\n' +
        '    if (t.perSkill && t.perSkill.length) { s += "<table><tr><th>skill</th><th>predicted</th><th>loaded</th><th>hits</th></tr>";\n' +
        '      for (var i = 0; i < t.perSkill.length; i++) { var sk = t.perSkill[i]; s += "<tr><td>" + escH(sk.skill) + "</td><td>" + sk.predicted + "</td><td>" + sk.activated + "</td><td>" + sk.hits + "</td></tr>"; }\n' +
        '      s += "</table>"; }\n' +
        '    if (t.recent && t.recent.length) { s += "<p class=muted>Recent: " + t.recent.map(function (e) { return (e.session_id || "?").slice(0, 8) + "=" + (e.overall === null ? "?" : e.overall); }).join(" · ") + "</p>"; }\n' +
        '    document.getElementById("hist").innerHTML = s + "</div>";\n' +
        '  }).catch(function () { /* next poll retries */ });\n' +
        '}\n' +
        'function renderLive(d) {\n' +
        '  liveD = d;\n' +
        '  var h = "";\n' +
        '  if (d.setup && d.setup.installed) h += "<p class=muted>Setup: profile " + escH(d.setup.profile || "?") + ", kit " + escH(d.setup.kitVersion || "?") + ", " + d.setup.skills.length + " skill(s), " + d.setup.agents.length + " agent(s).</p>";\n' +
        '  else h += "<p class=muted>Project setup not installed here.</p>";\n' +
        '  if (d.overall !== null && d.overall !== undefined) h += "<div class=score>" + d.overall + "/100</div>";\n' +
        '  if (d.nextFix) h += "<div class=card><h2>Next fix</h2><p>" + escH(d.nextFix) + "</p></div>";\n' +
        '  if (d.prompt) h += panel("Prompt (" + d.prompt.grade + ")", d.prompt);\n' +
        '  if (d.process) h += panel("Run (" + d.process.verdict + ")", d.process);\n' +
        '  if (d.process && d.process.metrics.failRate >= 0.3) h += "<div class=card><button class=ghost onclick=promoteLoop()>Promote tool-loop case</button></div>";\n' +
        '  if (d.routing) { h += "<div class=card><h2>Routing</h2><p>" + escH(d.routing.note) + "</p>";\n' +
        '    if (d.routing.match === false) h += "<button class=ghost onclick=promoteRouting()>Promote routing case</button>"; h += "</div>"; }\n' +
        '  if (d.output) h += panel("Output", d.output);\n' +
        '  if (d.output && d.output.missed && d.output.missed.length) {\n' +
        '    h += "<div class=card><h2>Missed expectations</h2><ul>";\n' +
        '    for (var k = 0; k < d.output.missed.length; k++) h += "<li>" + escH(d.output.missed[k]) + " <button class=ghost onclick=promoteMissed(" + k + ")>Promote to case</button></li>";\n' +
        '    h += "</ul></div>";\n' +
        '  }\n' +
        '  if (d.improvedPrompt) { h += "<div class=card><h2>Improved prompt</h2><pre id=liveImp>" + escH(d.improvedPrompt) + "</pre>";\n' +
        '    h += "<button class=ghost onclick=copyLiveImp()>Copy</button> <button class=ghost onclick=copyOverlay()>Copy as overlay</button></div>"; }\n' +
        '  if (d.models && d.models.length) {\n' +
        '    h += "<div class=card><h2>Models</h2><table><tr><th>model</th><th>in</th><th>out</th><th>calls</th><th>cost USD</th></tr>";\n' +
        '    for (var i = 0; i < d.models.length; i++) { var m = d.models[i];\n' +
        '      h += "<tr><td>" + escH(m.model) + "</td><td>" + m.input + "</td><td>" + m.output + "</td><td>" + m.calls + "</td><td>" + (m.costUsd === null ? "?" : m.costUsd + (m.estimated ? " (est)" : "")) + "</td></tr>"; }\n' +
        '    h += "</table><p class=muted">Session cost: " + (d.costUsd === null ? "?" : d.costUsd + (d.costEstimated ? " (estimated)" : " (transcript)")) + "</p></div>";\n' +
        '  }\n' +
        '  if (d.stats && d.stats.prompts && d.stats.prompts.length) {\n' +
        '    h += "<div class=card><h2>Turns</h2><ul class=feed>";\n' +
        '    for (var j = 0; j < d.stats.prompts.length; j++) h += "<li>" + escH(d.stats.prompts[j].text.slice(0, 160)) + "</li>";\n' +
        '    h += "</ul></div>";\n' +
        '  }\n' +
        '  if (d.notes && d.notes.length) h += "<div class=card><h2>Notes</h2>" + sugList(d.notes) + "</div>";\n' +
        '  document.getElementById("live").innerHTML = h;\n' +
        '}\n' +
        'if (proj) { refreshSessions(); setInterval(pollLive, 2000); }\n' +
        'document.getElementById("go").onclick = function () {\n' +
        '  var costRaw = document.getElementById("cost").value;\n' +
        '  var body = { prompt: document.getElementById("prompt").value,\n' +
        '    run: { inputTokens: +document.getElementById("inT").value || 0, outputTokens: +document.getElementById("outT").value || 0,\n' +
        '      costUsd: costRaw === "" ? null : +costRaw, turns: +document.getElementById("turns").value || 0,\n' +
        '      toolCalls: +document.getElementById("tools").value || 0, failedCalls: +document.getElementById("failed").value || 0,\n' +
        '      durationMs: +document.getElementById("dur").value || 0, filesChanged: +document.getElementById("files").value || 0 },\n' +
        '    output: document.getElementById("output").value, expectations: document.getElementById("expect").value.split("\\n") };\n' +
        '  fetch("/api/evaluate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })\n' +
        '    .then(function (r) { return r.json(); })\n' +
        '    .then(function (rep) {\n' +
        '      last = rep;\n' +
        '      var h = "<div class=card><div class=score>" + rep.overall + "/100 — " + escH(rep.verdict) + "</div>";\n' +
        '      h += sugList(rep.workflow) + "</div>";\n' +
        '      h += panel("Prompt (" + rep.prompt.grade + ")", rep.prompt);\n' +
        '      h += panel("Run (" + rep.process.verdict + ")", rep.process);\n' +
        '      h += panel("Output", rep.output);\n' +
        '      h += "<div class=card><h2>Improved prompt</h2><pre id=imp>" + escH(rep.improvedPrompt) + "</pre>";\n' +
        '      h += "<button class=ghost onclick=copyImp()>Copy improved prompt</button></div>";\n' +
        '      document.getElementById("res").innerHTML = h;\n' +
        '      document.getElementById("dl").disabled = false;\n' +
        '      window.scrollTo(0, document.body.scrollHeight);\n' +
        '    })\n' +
        '    .catch(function (e) { document.getElementById("res").innerHTML = "<div class=card>Request failed: " + escH(String(e)) + "</div>"; });\n' +
        '};\n' +
        'function copyImp() {\n' +
        '  var t = document.getElementById("imp").textContent;\n' +
        '  if (navigator.clipboard) navigator.clipboard.writeText(t);\n' +
        '}\n' +
        'document.getElementById("dl").onclick = function () {\n' +
        '  if (!last) return;\n' +
        '  var blob = new Blob([JSON.stringify(last.scorecard, null, 2)], { type: "application/json" });\n' +
        '  var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "eval-board-scorecard.json"; a.click();\n' +
        '};\n' +
        '</scr' +
        'ipt></body></html>\n');
}
function readBody(req, limit = 1000000) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) {
                reject(new Error('body too large'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
export function startEvalBoard(opts = {}) {
    const project = opts.project ? resolve(opts.project) : null;
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', 'http://board');
            if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                res.end(renderPage({ project }));
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/health') {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end('{"ok":true}');
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/sessions') {
                if (!project) {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end('{"error":"board started without --project"}');
                    return;
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ pointer: readPointer(project), sessions: listRecentSessions(15) }));
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/live') {
                if (!project) {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end('{"error":"board started without --project"}');
                    return;
                }
                const expect = (url.searchParams.get('expect') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(snapshotAndRecord(project, { sessionId: url.searchParams.get('session') ?? undefined, expectations: expect })));
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/history') {
                if (!project) {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end('{"error":"board started without --project"}');
                    return;
                }
                const entries = readHistory(project);
                const windowsFile = join(homeDir(resolve(project), 'learnings'), 'eval-windows.jsonl');
                const windows = compareWindows(existsSync(windowsFile) ? readRows(readFileSync(windowsFile, 'utf8')) : []);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ entries: entries.slice(-50), trends: historyTrends(entries), windows }));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/api/case') {
                if (!project) {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end('{"error":"board started without --project"}');
                    return;
                }
                const raw = await readBody(req);
                try {
                    const input = JSON.parse(raw || '{}');
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify(promoteCase(project, input)));
                    return;
                }
                catch (err) {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'invalid case' }));
                    return;
                }
            }
            if (req.method === 'POST' && url.pathname === '/api/evaluate') {
                const raw = await readBody(req);
                let payload = {};
                try {
                    payload = JSON.parse(raw || '{}');
                }
                catch {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end('{"error":"invalid JSON"}');
                    return;
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(evaluatePayload(payload)));
                return;
            }
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end('{"error":"not found"}');
        }
        catch {
            try {
                res.writeHead(500, { 'content-type': 'application/json' });
                res.end('{"error":"internal error"}');
            }
            catch {
                // socket already gone — nothing to do
            }
        }
    });
    return new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', () => {
            const addr = server.address();
            const p = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0);
            const host = opts.host ?? '127.0.0.1';
            resolvePromise({ server, url: `http://${host}:${p}/`, port: p, project });
        });
    });
}
function readMaybeFile(file) {
    if (typeof file !== 'string' || !file)
        return null;
    try {
        return readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
}
/** `--json` mode: evaluate without a browser. Reads `--run-file` etc. itself so bin/ stays thin. */
export function evalBoardJson(flags) {
    const project = flagStr(flags, 'project');
    const csvExpect = (v) => typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const fileExpect = (v) => {
        const text = readMaybeFile(v);
        return text === null ? [] : text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    };
    const expectations = [...csvExpect(flags['expect']), ...fileExpect(flags['expect-file'])];
    if (project) {
        return snapshotAndRecord(project, { sessionId: flagStr(flags, 'session') ?? undefined, expectations });
    }
    const prompt = flagStr(flags, 'prompt') ?? readMaybeFile(flags['prompt-file']) ?? '';
    const output = flagStr(flags, 'output') ?? readMaybeFile(flags['output-file']) ?? '';
    let run = {};
    const runRaw = flagStr(flags, 'run') ?? readMaybeFile(flags['run-file']);
    if (runRaw) {
        try {
            run = JSON.parse(runRaw);
        }
        catch {
            throw new Error('--run / --run-file must be valid JSON (e.g. {"inputTokens":1200,"turns":6})');
        }
    }
    return evaluatePayload({ prompt, run, output, expectations });
}
