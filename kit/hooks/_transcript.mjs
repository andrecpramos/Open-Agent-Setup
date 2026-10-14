// Transcript folding, shared by the session-eval hook and `agent-setup eval-board`.
//
// A Claude Code transcript is JSONL, one line per event. This module folds those
// lines into facts (tokens, tool calls, files, skills) and derives what the
// session-eval hook records for each context window: token waste, heavy tool
// results, whether a check ran after the last edit, and whether the final
// message claims a verification the transcript does not show.
//
// Pure and dependency-free: node builtins only, nothing runs at import, and bad
// input folds to empty facts instead of throwing (the hook fails open). The CLI
// imports this file from kit/hooks/, so there is one parser (AGENTS.md rule 6).
// Its TypeScript types are in _transcript.d.mts, which is never installed; keep
// the two in step.
//
// Format facts this relies on, checked against real transcripts:
//  - One API response is written as several lines, one per content block, and
//    each line repeats the same `usage`. Usage is counted once per message id.
//  - A compaction writes {type: "system", subtype: "compact_boundary"}, then a
//    user line marked isCompactSummary. The summary is not a prompt.
//  - Human prompts carry origin.kind "human". Peer messages, task notifications
//    and meta lines (skill bodies, command output) are not prompts.
//  - A failed command's tool_result has is_error: true ("Exit code N").
//  - Subagents write their own transcripts, beside the session's:
//    <session>.jsonl → <session>/subagents/agent-<agentId>.jsonl. A window's
//    facts cover the main thread; each Task/Agent call counts as one subagent,
//    by its type, and its agentId (from the result's toolUseResult) lands in
//    subagentRuns, so _usage.mjs can read and price that run.
//  - usage.cache_creation splits cache writes by lifetime: Claude Code writes
//    the main thread's cache for an hour (2× input) and a subagent's for five
//    minutes (1.25×). Both are kept, or the price math is off by the difference.

import { promptFacts } from './_prompt.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Prose a check would not catch: editing it after the last check leaves nothing unverified.
const DOC_RE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);
const SKILL_DOC_RE = /[\\/]skills[\\/](([a-z0-9]+(-[a-z0-9]+)*))\/SKILL\.md$/i;

// Tool output is measured in estimated tokens: characters / 4, a flat rate per image.
const CHARS_PER_TOKEN = 4;
const IMAGE_TOKENS = 1600;
/** A tool result at least this large (estimated tokens) is reported as heavy. */
export const HEAVY_TOKENS = 5000;
/**
 * A call whose prompt (input plus cache) is larger than this is also counted in its model's
 * `long` bucket: some models bill long prompts at a second rate card (models.json `long`).
 */
export const LONG_PROMPT = 100000;

// A command that checks the work. The first group is the phrase recorded, so a
// row never carries the rest of a command line (which may hold a secret). A
// pipeline reports its last command's status: `npm test | tail` can pass while
// the tests fail, so a pass here is the transcript's word, not proof.
const VERIFY_RE =
  /(?:^|[\s;&|(])((?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|typecheck|type-check|verify|build)[\w:-]*|node\s+--test|npx\s+(?:vitest|jest|tsc|eslint|mocha|playwright\s+test)|vitest|jest|mocha|pytest|python3?\s+-m\s+(?:pytest|unittest)|go\s+(?:test|vet)|cargo\s+(?:test|check|clippy)|dotnet\s+test|mvn\s+(?:test|verify)|\.?\/?gradlew?\s+(?:test|check)|rspec|phpunit|make\s+(?:test|check|lint)|tsc|eslint|ruff(?:\s+check)?|mypy|[\w.:/\\-]*run-gates\.mjs|[\w.:/\\-]*agent-setup\.mjs\s+lint)(?=$|[\s;&|)])/i;

// The final message claims the work was checked: "tests pass", "lint: clean",
// "verified", "all green". HEDGE_RE drops a claim that is really a plan or a
// denial in the same clause ("once the tests pass", "not verified").
const CLAIM_RE =
  /\b(?:tests?|specs?|suites?|checks?|lint(?:ing)?|typechecks?|type-?check(?:ing)?|builds?|gates?|ci)\s+(?:all\s+|now\s+|still\s+)?(?:pass(?:es|ed|ing)?\b|(?:are|is|stays?)\s+(?:green|passing|clean)\b)|\b(?:tests?|checks?|lint|typecheck|build)\s*:\s*(?:green|pass(?:ed)?|ok|clean)\b|\bverified\b|\ball\s+green\b/gi;
// A reply that restates the request as a brief (prompt-intake, the deliver skill): a Goal and an Acceptance line.
const BRIEF_RE = [/(^|\n)\W{0,4}goal\W{0,4}\s*[:—–-]/i, /(^|\n)\W{0,4}acceptance\W{0,4}\s*[:—–-]/i];

/** True when a text restates a request as a brief: it has a Goal and an Acceptance line. */
export function isBrief(text) {
  const s = String(text ?? '');
  return BRIEF_RE.every((rx) => rx.test(s));
}

const HEDGE_RE = /(?:\b(?:make sure|ensure|should|would|will|until|once|if|whether|not|never|before|unless|could|might|may|need|needs)\b|n't)[^.!?;:\n]*$/i;

// ---------------------------------------------------------------------------
// Corrections: a user message that reads like "that's wrong" or a standing
// instruction. Deliberately narrow — a false positive costs a few lines of
// context in learning-signals and skews a metric here. Only the opening of the
// message is scanned: corrections lead, and long prompts are usually pasted
// material quoting other people.
// ---------------------------------------------------------------------------

const VERBS_EN =
  'do|doing|use|using|add|adding|create|creating|touch|touching|change|changing|call|calling|write|writing|' +
  'run|running|commit|committing|push|pushing|delete|deleting|remove|removing|edit|editing|modify|modifying|' +
  'install|installing|mock|mocking|rename|renaming|refactor|refactoring|guess|guessing|assume|assuming';

const CORRECTION = [
  // English
  /\b(i|we) (already )?(told|asked) you\b/i,
  /\bi (already |just )?said\b/i,
  /\bnot what i (asked|wanted|meant|said)\b/i,
  /\bthat'?s (not (right|correct|what i)|wrong|incorrect)\b/i,
  /\bthat is (not (right|correct)|wrong|incorrect)\b/i,
  /\byou (forgot|missed|ignored|broke|deleted|removed|overwrote|skipped|keep)\b/i,
  /\bwhy (did|would) you\b/i,
  new RegExp(`\\b(don'?t|do not|never|stop) (ever )?(${VERBS_EN})\\b`, 'i'),
  /\b(remember|note) (this|that|to)\b/i,
  /\b(from now on|going forward|next time|in the future)\b/i,
  /\bwrong (file|place|approach|branch|way|one|command)\b/i,
  /\b(revert|undo) (that|this|it|your|what you)\b/i,
  // Portuguese (PT-PT and PT-BR)
  /\bj[áa] (te |lhe )?(disse|pedi|falei|expliquei)/i,
  /\beu (j[áa] )?(disse|pedi|falei)\b/i,
  /\bn[ãa]o (era|foi|é) (isso|isto|o que)/i,
  /\b(est[áa]|isso est[áa]|isto est[áa]) (errado|mal)\b/i,
  /\best[áa]s a fazer (isso |isto )?mal\b/i,
  /\bn[ãa]o (fa[çc]as|faz|fa[çc]a|uses|use|usar|mexas|mexa|toques|toque|adiciones|adicione|cries|crie|corras|corra|apagues|apague|alteres|altere|mudes|mude|inventes|invente)\b/i,
  /\bp[áa]ra de\b/i,
  /\besquece(ste|u)\b/i,
  /\bpor ?que (é que )?(fizeste|fez|voc[êe] fez)/i,
  /\b(lembra-te|lembre-se|lembra que|n[ãa]o te esque[çc]as)/i,
  /\b(a partir de agora|da pr[óo]xima vez|nunca mais)\b/i,
];

/** True when a user message reads like a correction or a standing instruction. */
export function isCorrection(message) {
  const head = String(message ?? '')
    // IDE and harness context that editors prepend to a prompt is not the user speaking.
    .replace(/<(ide_[a-z_]+|system-reminder)>[\s\S]*?<\/\1>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('>'))
    .join('\n')
    .trim()
    .slice(0, 600);
  return head.length > 0 && CORRECTION.some((rx) => rx.test(head));
}

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : null);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);

function parseLine(line) {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  try {
    const v = JSON.parse(t);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

/** A fresh accumulator. Fold state lives on a non-enumerable key, so the result serialises as plain facts. */
export function emptySession(sessionId = '') {
  const acc = {
    sessionId,
    prompts: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    cacheCreate: 0,
    calls: 0,
    compactions: 0,
    models: {},
    tools: [],
    filesChanged: [],
    skillCalls: [],
    skillDocReads: [],
    agentCalls: [],
    subagentRuns: [],
    briefs: 0,
    lastAssistantText: '',
    costUsd: null,
    apiMs: null,
    toolMs: null,
    totalMs: null,
    started: null,
    ended: null,
  };
  foldState(acc);
  return acc;
}

function foldState(acc) {
  if (!acc._fold) {
    Object.defineProperty(acc, '_fold', {
      value: { pending: new Map(), usage: new Map(), editSeq: new Map(), reads: new Map() },
      enumerable: false,
    });
  }
  return acc._fold;
}

function summarizeToolInput(name, input) {
  if (!isRecord(input)) return '';
  if (name === 'Skill') {
    const s = str(input.skill);
    return s ? (s.split(':').pop() ?? s) : '';
  }
  for (const k of ['command', 'file_path', 'notebook_path', 'path', 'url', 'pattern']) {
    if (typeof input[k] === 'string' && input[k]) return input[k];
  }
  return '';
}

function noteTimestamp(acc, ts) {
  if (typeof ts !== 'string' || !ts) return;
  if (acc.started === null || ts < acc.started) acc.started = ts;
  if (acc.ended === null || ts > acc.ended) acc.ended = ts;
}

function isHumanPrompt(entry, text) {
  if (entry.isMeta === true || entry.isCompactSummary === true) return false;
  if (isRecord(entry.origin) && typeof entry.origin.kind === 'string') return entry.origin.kind === 'human';
  // Older transcripts carry no origin: any user text is a prompt, except a task notification.
  return !text.trimStart().startsWith('<task-notification');
}

// How Claude Code words a tool call that never ran: refused by the permission system, by the
// user, or by a PreToolUse hook.
const DENIED_RE = /requested permissions? to use|haven't granted it|permission to use \S+ (has been|was) denied|doesn't want to proceed|tool use was rejected|denied by (a )?(PreToolUse )?hook|blocked by (a )?hook|operation blocked by hook/i;

function resultText(content) {
  if (typeof content === 'string') return content.slice(0, 2000);
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (isRecord(b) && typeof b.text === 'string' ? b.text : ''))
    .join(' ')
    .slice(0, 2000);
}

function resultTokens(content) {
  if (typeof content === 'string') return Math.ceil(content.length / CHARS_PER_TOKEN);
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const b of content) {
    if (!isRecord(b)) continue;
    if (b.type === 'text' && typeof b.text === 'string') n += Math.ceil(b.text.length / CHARS_PER_TOKEN);
    else if (b.type === 'image') n += IMAGE_TOKENS;
    else n += Math.ceil(JSON.stringify(b).length / CHARS_PER_TOKEN);
  }
  return n;
}

function fileOf(input) {
  if (!isRecord(input)) return null;
  return str(input.file_path) ?? str(input.notebook_path) ?? null;
}

function onUsage(acc, fold, msg) {
  const usage = msg.usage;
  // "<synthetic>" marks a message Claude Code wrote itself (an interruption, an API error): no call was made.
  if (!isRecord(usage) || msg.model === '<synthetic>') return;
  const split = isRecord(usage.cache_creation) ? usage.cache_creation : null;
  const now = {
    input: num(usage.input_tokens),
    output: num(usage.output_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheCreate: num(usage.cache_creation_input_tokens),
    // Part of cacheCreate, not added to it: the writes that live an hour and cost more.
    cacheCreate1h: split ? num(split.ephemeral_1h_input_tokens) : 0,
  };
  const model = str(msg.model) ?? 'unknown';
  const m = acc.models[model] ?? emptyModel();
  const id = str(msg.id);
  const prev = id ? fold.usage.get(id) : undefined;
  // A repeated message id is the same API call split across lines: add only what grew.
  const delta = {};
  for (const k of Object.keys(now)) delta[k] = prev ? Math.max(0, now[k] - prev[k]) : now[k];
  if (id) fold.usage.set(id, prev ? Object.fromEntries(Object.keys(now).map((k) => [k, Math.max(prev[k], now[k])])) : now);
  if (!prev) {
    acc.calls += 1;
    m.calls += 1;
  }
  acc.inputTokens += delta.input;
  acc.outputTokens += delta.output;
  acc.cacheRead += delta.cacheRead;
  acc.cacheCreate += delta.cacheCreate;
  for (const k of TOKEN_KEYS) m[k] = num(m[k]) + delta[k];
  if (now.input + now.cacheRead + now.cacheCreate > LONG_PROMPT) {
    const long = m.long ?? { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cacheCreate1h: 0 };
    for (const k of TOKEN_KEYS) long[k] += delta[k];
    m.long = long;
  }
  acc.models[model] = m;
}

const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheCreate', 'cacheCreate1h'];
const emptyModel = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cacheCreate1h: 0, calls: 0, costUsd: null });

/** A model's token counts as a row records them: snake_case, `long` only when some call was long. */
function bucketOf(m) {
  const b = { input: num(m.input), output: num(m.output), cache_read: num(m.cacheRead), cache_create: num(m.cacheCreate), cache_create_1h: num(m.cacheCreate1h), calls: num(m.calls) };
  if (isRecord(m.long)) b.long = { input: num(m.long.input), output: num(m.long.output), cache_read: num(m.long.cacheRead), cache_create: num(m.long.cacheCreate), cache_create_1h: num(m.long.cacheCreate1h) };
  return b;
}

/** Every model's token counts, as a row records them (see bucketOf). A model with no tokens and no calls is left out. */
export function modelBuckets(models) {
  const out = {};
  for (const [name, m] of Object.entries(isRecord(models) ? models : {})) {
    if (!isRecord(m)) continue;
    const b = bucketOf(m);
    if (b.calls || b.input || b.output || b.cache_read || b.cache_create) out[name] = b;
  }
  return out;
}

function onToolUse(acc, fold, b) {
  const name = b.name;
  const summary = summarizeToolInput(name, b.input).slice(0, 160);
  const tool = { name, summary, error: false, done: false, tokens: 0, call: acc.calls, redundant: false, verify: null, checkFailed: false, denied: false };
  if (SHELL_TOOLS.has(name) && isRecord(b.input) && typeof b.input.command === 'string') {
    const m = VERIFY_RE.exec(b.input.command);
    if (m) tool.verify = m[1].replace(/\s+/g, ' ');
  }
  // The kit's gate-runner agent runs the gates in its own context: that is a check too.
  if (SUBAGENT_TOOLS.has(name) && isRecord(b.input) && b.input.subagent_type === 'gate-runner') tool.verify = 'gate-runner';
  const id = str(b.id);
  if (id) fold.pending.set(id, { index: acc.tools.length, input: b.input });
  acc.tools.push(tool);
  if (name === 'Skill' && summary) acc.skillCalls.push(summary);
  if (SUBAGENT_TOOLS.has(name) && isRecord(b.input)) acc.agentCalls.push(String(b.input.subagent_type ?? 'general-purpose').split(':').pop() || 'general-purpose');
  if (name === 'Read' || name === 'Glob' || name === 'Grep') {
    const f = isRecord(b.input) ? (str(b.input.file_path) ?? str(b.input.path)) : null;
    const m = f ? SKILL_DOC_RE.exec(f) : null;
    if (m && !acc.skillDocReads.includes(m[1])) acc.skillDocReads.push(m[1]);
  }
}

function onToolResult(acc, fold, b, meta) {
  const id = str(b.tool_use_id);
  const p = id ? fold.pending.get(id) : undefined;
  if (!p) return;
  fold.pending.delete(id);
  const tool = acc.tools[p.index];
  tool.done = true;
  // A subagent's run: its id names its own transcript, which holds what it cost.
  const agentId = meta ? str(meta.agentId) : null;
  if (SUBAGENT_TOOLS.has(tool.name) && agentId && !acc.subagentRuns.some((r) => r.id === agentId)) {
    const type = str(meta.agentType) ?? (isRecord(p.input) ? str(p.input.subagent_type) : null) ?? 'general-purpose';
    acc.subagentRuns.push({ id: agentId, type: type.split(':').pop() || 'general-purpose', model: str(meta.resolvedModel) });
  }
  tool.error = b.is_error === true;
  // A call the permission system or a hook refused never ran: it is not a check that failed.
  if (tool.error && DENIED_RE.test(resultText(b.content))) tool.denied = true;
  tool.tokens = resultTokens(b.content);
  // gate-runner reports its verdict in text: BLOCKED is a failed check, not a failed call.
  if (tool.verify === 'gate-runner' && /\bBLOCKED\b/.test(JSON.stringify(b.content ?? ''))) tool.checkFailed = true;
  if (tool.error) return;
  const file = fileOf(p.input);
  if (EDIT_TOOLS.has(tool.name) && file) {
    fold.editSeq.set(file, (fold.editSeq.get(file) ?? 0) + 1);
    if (!acc.filesChanged.includes(file)) acc.filesChanged.push(file);
  }
  if (tool.name === 'Read' && file) {
    // The same slice of a file, read again with no edit to it in between.
    const key = `${file}|${p.input.offset ?? ''}|${p.input.limit ?? ''}`;
    const seq = fold.editSeq.get(file) ?? 0;
    if (fold.reads.get(key) === seq) tool.redundant = true;
    fold.reads.set(key, seq);
  }
}

/** Fold transcript lines into an accumulator (a full parse, or the next chunk). Unknown line types are ignored. */
export function addTranscriptLines(acc, text) {
  const fold = foldState(acc);
  for (const line of String(text ?? '').split('\n')) {
    const entry = parseLine(line);
    if (!entry) continue;
    const type = entry.type;
    if (type === 'cost-state') {
      // Cumulative for the session: each line replaces the last.
      const cost = Number(entry.totalCostUSD);
      if (Number.isFinite(cost) && cost >= 0) acc.costUsd = cost;
      const dur = { apiMs: entry.totalAPIDuration, toolMs: entry.totalToolDuration, totalMs: entry.totalDuration };
      for (const [k, v] of Object.entries(dur)) {
        const n = Number(v);
        if (v !== undefined && v !== null && Number.isFinite(n)) acc[k] = n;
      }
      if (isRecord(entry.modelUsage)) {
        for (const [model, u] of Object.entries(entry.modelUsage)) {
          if (!isRecord(u)) continue;
          const m = acc.models[model] ?? emptyModel();
          if (acc.inputTokens + acc.outputTokens === 0) {
            m.input += num(u.inputTokens);
            m.output += num(u.outputTokens);
          }
          const c = Number(u.costUSD);
          if (Number.isFinite(c) && c >= 0) m.costUsd = c;
          acc.models[model] = m;
        }
      }
      const sid = str(entry.sessionId);
      if (sid && !acc.sessionId) acc.sessionId = sid;
      continue;
    }
    if (type === 'system') {
      if (entry.subtype === 'compact_boundary') acc.compactions += 1;
      continue;
    }
    if (type === 'user') {
      const msg = entry.message;
      if (!isRecord(msg)) continue;
      const content = msg.content;
      const texts = [];
      if (typeof content === 'string') {
        if (content.trim()) texts.push(content);
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (!isRecord(b)) continue;
          if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) texts.push(b.text);
          if (b.type === 'tool_result') onToolResult(acc, fold, b, isRecord(entry.toolUseResult) ? entry.toolUseResult : null);
        }
      }
      const joined = texts.join('\n');
      if (joined && isHumanPrompt(entry, joined)) acc.prompts.push({ text: joined.slice(0, 2000), ts: str(entry.timestamp) });
      noteTimestamp(acc, entry.timestamp);
      continue;
    }
    if (type === 'assistant') {
      const msg = entry.message;
      if (!isRecord(msg)) continue;
      onUsage(acc, fold, msg);
      if (Array.isArray(msg.content)) {
        const texts = [];
        for (const b of msg.content) {
          if (!isRecord(b)) continue;
          if (b.type === 'text' && typeof b.text === 'string') {
            if (!b.text.startsWith('<')) texts.push(b.text);
          } else if (b.type === 'tool_use' && typeof b.name === 'string') {
            onToolUse(acc, fold, b);
          }
        }
        if (texts.length) {
          acc.lastAssistantText = texts.join('\n').slice(-4000);
          if (BRIEF_RE.every((rx) => rx.test(acc.lastAssistantText))) acc.briefs += 1;
        }
      }
      noteTimestamp(acc, entry.timestamp);
      continue;
    }
    const sid = str(entry.sessionId);
    if (sid && !acc.sessionId) acc.sessionId = sid;
  }
  return acc;
}

export function parseTranscript(text, sessionId = '') {
  return addTranscriptLines(emptySession(sessionId), text);
}

/**
 * The current context window: the text after the last compaction boundary, and
 * its index (0 for a session never compacted). Only lines that mention the
 * boundary are parsed, so this stays cheap on a large transcript.
 */
export function windowSlice(text) {
  const s = String(text ?? '');
  let index = 0;
  let start = 0;
  let pos = s.indexOf('compact_boundary');
  while (pos !== -1) {
    const ls = s.lastIndexOf('\n', pos) + 1;
    let le = s.indexOf('\n', pos);
    if (le === -1) le = s.length;
    const entry = parseLine(s.slice(ls, le));
    if (entry && entry.type === 'system' && entry.subtype === 'compact_boundary') {
      index += 1;
      start = Math.min(le + 1, s.length);
    }
    pos = s.indexOf('compact_boundary', le);
  }
  return { index, text: s.slice(start) };
}

/** True when the text claims the work was checked, outside a plan or a denial. */
export function claimsVerification(text) {
  const s = String(text ?? '');
  for (const m of s.matchAll(CLAIM_RE)) {
    const before = s.slice(Math.max(0, m.index - 40), m.index);
    if (!HEDGE_RE.test(before)) return true;
  }
  return false;
}

function targetOf(tool, root) {
  if (SHELL_TOOLS.has(tool.name)) return tool.summary.trim().split(/\s+/)[0] ?? '';
  if (tool.name === 'Read' || EDIT_TOOLS.has(tool.name)) return relPath(tool.summary, root);
  return '';
}

function relPath(p, root) {
  if (!p) return p;
  const norm = (x) => x.replace(/\\/g, '/');
  const file = norm(p);
  const base = root ? norm(root).replace(/\/+$/, '') : '';
  if (base && file.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return file.slice(base.length + 1);
  return file;
}

/**
 * An edit a check should cover: code or config inside the project. Scratch
 * files, agent memory and prose are left out, so a note written after the last
 * test run does not mark the work unverified. Without a root, every non-prose
 * path counts; a relative path is taken as inside the project.
 */
function needsCheck(tool, root) {
  if (!EDIT_TOOLS.has(tool.name) || !tool.done || tool.error || DOC_RE.test(tool.summary)) return false;
  if (!root) return true;
  const rel = relPath(tool.summary, root);
  return !/^([a-z]:)?\//i.test(rel);
}

/**
 * The facts one row records for a folded window: JSON-ready, snake_case, no
 * prompt or command text. `root` makes file paths relative to the project.
 */
export function windowFacts(acc, { root = '', checks: extraChecks = [] } = {}) {
  const tools = acc.tools;
  const calls = acc.calls;
  // A project's own gate commands (sdlc.config.json) count as checks too.
  const extra = extraChecks.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());
  const checkOf = (t) => t.verify ?? (SHELL_TOOLS.has(t.name) ? (extra.find((s) => t.summary.includes(s)) ?? null) : null);
  let lastEdit = -1;
  tools.forEach((t, i) => {
    if (needsCheck(t, root)) lastEdit = i;
  });
  const checks = tools.filter((t, i) => checkOf(t) && t.done && !t.denied && i > lastEdit);
  const edited = lastEdit >= 0;
  const last = checks[checks.length - 1];
  const passed = last ? !(last.error || last.checkFailed) : null;
  const claimed = claimsVerification(acc.lastAssistantText);

  let resultTotal = 0;
  const waste = { tokens: 0, share: null, carried: 0, redundant_reads: 0, redundant_tokens: 0, failed_tokens: 0 };
  const heavy = { count: 0, tokens: 0, carried: 0, top: [] };
  const failedKeys = new Map();
  let repeated = 0;
  for (const t of tools) {
    if (!t.done) continue;
    resultTotal += t.tokens;
    const later = Math.max(0, calls - t.call);
    if (t.redundant) {
      waste.redundant_reads += 1;
      waste.redundant_tokens += t.tokens;
    } else if (t.error) {
      waste.failed_tokens += t.tokens;
      const key = `${t.name}:${t.summary}`;
      if (failedKeys.has(key)) repeated += 1;
      failedKeys.set(key, true);
    }
    if (t.redundant || t.error) {
      waste.tokens += t.tokens;
      waste.carried += t.tokens * later;
    }
    if (t.tokens >= HEAVY_TOKENS) {
      heavy.count += 1;
      heavy.tokens += t.tokens;
      heavy.carried += t.tokens * later;
      heavy.top.push({ tool: t.name, target: targetOf(t, root), tokens: t.tokens, carried: t.tokens * later });
    }
  }
  waste.share = resultTotal ? Math.round((waste.tokens / resultTotal) * 1000) / 1000 : null;
  heavy.top = heavy.top.sort((a, b) => b.carried - a.carried).slice(0, 3);

  const inputAll = acc.inputTokens + acc.cacheRead + acc.cacheCreate;
  const models = modelBuckets(acc.models);
  return {
    started: acc.started,
    ended: acc.ended,
    prompts: acc.prompts.length,
    corrections: acc.prompts.filter((p) => isCorrection(p.text)).length,
    calls,
    models,
    tokens: {
      input: acc.inputTokens,
      output: acc.outputTokens,
      cache_read: acc.cacheRead,
      cache_create: acc.cacheCreate,
      cache_hit: inputAll ? Math.round((acc.cacheRead / inputAll) * 1000) / 1000 : null,
      tool_results: resultTotal,
    },
    tools: {
      calls: tools.length,
      failed: tools.filter((t) => t.error).length,
      repeated_failures: repeated,
      subagents: tools.filter((t) => SUBAGENT_TOOLS.has(t.name)).length,
      agents: acc.agentCalls.reduce((a, n) => ({ ...a, [n]: (a[n] ?? 0) + 1 }), {}),
    },
    prompt_quality: { ...promptFacts(acc.prompts), briefs: acc.briefs },
    skills: [...new Set([...acc.skillCalls, ...acc.skillDocReads])],
    files_changed: acc.filesChanged.map((f) => relPath(f, root)),
    verification: {
      edited,
      after_last_edit: edited ? checks.length > 0 : null,
      passed,
      commands: [...new Set(checks.map(checkOf))].slice(-3),
      last_edit: edited ? lastEdit : null,
    },
    claims: {
      verified: claimed,
      unverified: claimed && edited && (checks.length === 0 || passed === false),
    },
    waste,
    heavy,
  };
}

// ---------------------------------------------------------------------------
// Row summaries: the few numbers that say whether work is getting better.
// Shared by `agent-setup evals`, the eval-board and the session-start line.
// ---------------------------------------------------------------------------

/** Price ratios relative to input tokens, the same for current Claude models: cache write, cache read, output. */
const COST_WEIGHTS = { input: 1, cache_create: 1.25, cache_read: 0.1, output: 5 };

/** A window's cost in input-token equivalents, so windows compare across models and prices. */
export function costUnits(tokens) {
  const t = isRecord(tokens) ? tokens : {};
  return (
    num(t.input) * COST_WEIGHTS.input +
    num(t.cache_create) * COST_WEIGHTS.cache_create +
    num(t.cache_read) * COST_WEIGHTS.cache_read +
    num(t.output) * COST_WEIGHTS.output
  );
}

/** The summary metrics, in display order. `better` says which direction is an improvement. */
// `target`: the starting goal in docs/PLAYBOOK.md — the trend against a project's own history matters more.
export const METRICS = [
  { key: 'checked', label: 'code checked after its last edit', better: 'up', format: 'pct', target: 0.9 },
  { key: 'passed', label: 'last check passed', better: 'up', format: 'pct', target: 0.9 },
  { key: 'unverified', label: 'windows with unbacked check claims', better: 'down', format: 'pct', target: 0 },
  { key: 'corrections', label: 'user corrections per prompt', better: 'down', format: 'ratio', target: 0.1 },
  { key: 'acceptance', label: 'task prompts that say how done is checked', better: 'up', format: 'pct', target: 0.5 },
  { key: 'failed', label: 'tool calls that failed', better: 'down', format: 'pct', target: 0.05 },
  { key: 'waste', label: 'tool output wasted', better: 'down', format: 'pct', target: 0.03 },
  { key: 'heavy', label: 'heavy output re-read per window', better: 'down', format: 'tokens' },
  { key: 'cache_hit', label: 'cache hit rate', better: 'up', format: 'pct', target: 0.9 },
  { key: 'cost', label: 'cost per window (input-token equiv.)', better: 'down', format: 'tokens' },
];

/** Rows recorded after an ISO date (the last retro): how much work has gone unreviewed. */
export function windowsSince(rows, iso) {
  const list = Array.isArray(rows) ? rows : [];
  if (!iso) return list.length;
  return list.filter((r) => String(r?.recorded_at ?? r?.ended ?? '') > iso).length;
}

/** Read eval-windows.jsonl rows; corrupt lines are skipped. */
export function readRows(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const r = parseLine(line);
    if (r && typeof r.session_id === 'string') rows.push(r);
  }
  return rows;
}

/** The summary metrics over some rows; a metric with nothing to measure is null. */
export function windowMetrics(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sum = (f) => list.reduce((a, r) => a + num(f(r)), 0);
  const ratio = (n, d) => (d > 0 ? n / d : null);
  const edited = list.filter((r) => r.verification?.edited);
  const judged = list.filter((r) => typeof r.verification?.passed === 'boolean');
  const counted = list.filter((r) => typeof r.corrections === 'number');
  const inputAll = sum((r) => num(r.tokens?.input) + num(r.tokens?.cache_read) + num(r.tokens?.cache_create));
  return {
    windows: list.length,
    checked: ratio(edited.filter((r) => r.verification.after_last_edit).length, edited.length),
    passed: ratio(judged.filter((r) => r.verification.passed).length, judged.length),
    unverified: list.length ? list.filter((r) => r.claims?.unverified).length / list.length : null,
    corrections: ratio(
      counted.reduce((a, r) => a + r.corrections, 0),
      counted.reduce((a, r) => a + num(r.prompts), 0),
    ),
    acceptance: ratio(sum((r) => r.prompt_quality?.with_acceptance), sum((r) => r.prompt_quality?.tasks)),
    failed: ratio(sum((r) => r.tools?.failed), sum((r) => r.tools?.calls)),
    waste: ratio(sum((r) => r.waste?.tokens), sum((r) => r.tokens?.tool_results)),
    heavy: list.length ? sum((r) => r.heavy?.carried) / list.length : null,
    cache_hit: ratio(sum((r) => r.tokens?.cache_read), inputAll),
    cost: list.length ? list.reduce((a, r) => a + costUnits(r.tokens), 0) / list.length : null,
  };
}

/** Format one metric value for display. */
export function formatMetric(format, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (format === 'pct') return `${Math.round(v * 100)}%`;
  if (format === 'ratio') return v.toFixed(2);
  if (format === 'tokens') return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v));
  return String(Math.round(v));
}

/**
 * The last `last` windows against the `last` before them: one row per metric
 * with a trend word. A trend is a hint for a human, not a gate — the windows are
 * different work — so small differences read as "=".
 */
export function compareWindows(rows, last = 20) {
  const list = Array.isArray(rows) ? rows : [];
  return compareSets(list.slice(-last), list.slice(-2 * last, -last));
}

/** Two sets of windows side by side (the kit against a measure-only baseline, or recent against older). */
export function compareSets(recent, previous) {
  const now = windowMetrics(recent);
  const prev = previous.length ? windowMetrics(previous) : null;
  const trend = (m, a, b) => {
    if (a === null || b === null || a === undefined || b === undefined) return null;
    const scale = m.format === 'pct' ? 0.02 : Math.max(Math.abs(b) * 0.1, m.format === 'count' ? 0.5 : 1e-9);
    if (Math.abs(a - b) < scale) return '=';
    return (a > b) === (m.better === 'up') ? 'better' : 'worse';
  };
  return {
    windows: recent.length,
    previousWindows: previous.length,
    rows: METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      now: now[m.key],
      prev: prev ? prev[m.key] : null,
      shown: formatMetric(m.format, now[m.key]),
      prevShown: prev ? formatMetric(m.format, prev[m.key]) : '—',
      trend: prev ? trend(m, now[m.key], prev[m.key]) : null,
    })),
  };
}

/** The summary rows as plain text: one line per metric, the last windows against the ones before. */
export function summaryTable(rows, last = 20) {
  const cmp = compareWindows(rows, last);
  if (!cmp.windows) return 'No context windows recorded yet: rows land in .agents/learnings/eval-windows.jsonl as sessions end or compact.';
  const head = cmp.previousWindows ? `last ${cmp.windows}`.padStart(10) + `prev ${cmp.previousWindows}`.padStart(10) : `last ${cmp.windows}`.padStart(10);
  const lines = [`${'metric'.padEnd(40)}${head}`];
  for (const r of cmp.rows) {
    const prev = cmp.previousWindows ? r.prevShown.padStart(10) : '';
    lines.push(`${r.label.padEnd(40)}${r.shown.padStart(10)}${prev}${r.trend && r.trend !== '=' ? `  ${r.trend}` : ''}`);
  }
  return lines.join('\n');
}

/** One line for the session-start message: the headline metrics of the last windows. */
export function summaryLine(rows, last = 20) {
  const m = windowMetrics((Array.isArray(rows) ? rows : []).slice(-last));
  if (!m.windows) return '';
  const pick = ['checked', 'unverified', 'corrections', 'waste', 'cache_hit', 'cost'];
  const parts = pick
    .map((k) => METRICS.find((x) => x.key === k))
    .filter((x) => m[x.key] !== null)
    .map((x) => `${x.label} ${formatMetric(x.format, m[x.key])}`);
  return `Evals, last ${m.windows} window(s): ${parts.join(' · ')}`;
}
