// Model tiers, prices and the usage report, shared by the session-eval hook and the CLI.
//
// The data is kit/models.json, installed as .agents/models.json: the four tiers (frontier,
// high, medium, low), the model and reasoning effort each provider runs a tier on, and what
// each model costs. A project adapts it in .agents/sdlc.config.json under `models` — its own
// prices, another model for a tier, the reference a report compares against — merged here.
//
// The report answers three questions about recorded work, with the math shown:
//   - what it cost: every model's tokens priced, the main thread and each subagent run
//     (whose own transcript _transcript.mjs points at);
//   - what routing changed: each subagent run priced again on the window's main model —
//     delegating down saves the difference, escalating up costs it — and the total against
//     running everything on one reference model;
//   - whether quality held: the windows that routed work against the ones that did not, on
//     the quality metrics the session rows already carry.
// Repricing keeps the token counts, but another model on the same work would use its own
// number of tokens, so savings are an estimate; the report says so. Against the main model
// they are an upper bound: a subagent's tokens include its cold start (the instructions and
// files it re-reads), which the main thread doing the step itself would not have spent.
// Measured on real sessions, the true saving on a small docs task was a sixth of the repriced
// one; the main thread's own model is the larger lever.
//
// Node builtins only; nothing runs at import; bad input folds to empty results instead of
// throwing (the hook fails open). Typed by _usage.d.mts, which is never installed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LONG_PROMPT, formatMetric, modelBuckets, parseTranscript, windowMetrics } from './_transcript.mjs';

export const TIERS = ['frontier', 'high', 'medium', 'low'];
const RANK = Object.fromEntries(TIERS.map((t, i) => [t, i]));

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Read a models.json; null when it is missing or not an object. */
export function readModels(file) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * A project's `models` overrides over the kit's table: `prices` per model id (fields merge),
 * `tiers` per provider and tier ({ "openai": { "low": { "model": "…" } } }), and `reference`.
 */
export function mergeModels(base, overrides) {
  const out = isRecord(base) ? clone(base) : {};
  if (!isRecord(out.prices)) out.prices = {};
  if (!isRecord(out.providers)) out.providers = {};
  if (!isRecord(overrides)) return out;
  if (isRecord(overrides.prices)) {
    for (const [id, p] of Object.entries(overrides.prices)) if (isRecord(p)) out.prices[normalizeModel(id)] = { ...(out.prices[normalizeModel(id)] ?? {}), ...p };
  }
  if (isRecord(overrides.tiers)) {
    for (const [prov, tiers] of Object.entries(overrides.tiers)) {
      if (!isRecord(tiers)) continue;
      const p = isRecord(out.providers[prov]) ? out.providers[prov] : (out.providers[prov] = { label: prov, agents: [], tiers: {} });
      if (!isRecord(p.tiers)) p.tiers = {};
      for (const [tier, spec] of Object.entries(tiers)) {
        if (!TIERS.includes(tier)) continue;
        if (typeof spec === 'string') p.tiers[tier] = { ...(p.tiers[tier] ?? {}), model: spec };
        else if (isRecord(spec)) p.tiers[tier] = { ...(p.tiers[tier] ?? {}), ...spec };
      }
    }
  }
  if (typeof overrides.reference === 'string' && overrides.reference) out.reference = overrides.reference;
  return out;
}

/** The project's table: .agents/models.json under `root`, with `config.models` merged in. */
export function projectModels(root, config) {
  return mergeModels(readModels(join(root, '.agents', 'models.json')), isRecord(config) ? config.models : null);
}

/**
 * The bare model id a price is listed under: no provider prefix (`us.anthropic.`, `openai/`),
 * no date or version suffix (`-20251001`, `@20251101`, `-v1:0`), no context tag (`[1m]`).
 */
export function normalizeModel(id) {
  let s = String(id ?? '').trim().toLowerCase();
  s = s.replace(/\[[^\]]*\]$/, '');
  s = s.split('/').pop() ?? s;
  s = s.replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '');
  s = s.replace(/@.*$/, '');
  s = s.replace(/-v\d+(?::\d+)?$/, '');
  s = s.replace(/-\d{8}$/, '');
  return s;
}

/** The price card for a model id, or null when the table does not list it. */
export function priceFor(table, id) {
  const p = isRecord(table?.prices) ? table.prices[normalizeModel(id)] : null;
  return isRecord(p) ? p : null;
}

/** Every tier a model serves: the provider tiers that name it, else its family's tier ([] if unknown). */
export function tiersOf(table, id) {
  const n = normalizeModel(id);
  if (!n) return [];
  const found = new Set();
  for (const p of Object.values(isRecord(table?.providers) ? table.providers : {})) {
    for (const [tier, spec] of Object.entries(isRecord(p?.tiers) ? p.tiers : {})) {
      if (isRecord(spec) && normalizeModel(spec.model) === n) found.add(tier);
    }
  }
  if (found.size) return TIERS.filter((t) => found.has(t));
  const families = Object.entries(isRecord(table?.families) ? table.families : {})
    .filter(([k, v]) => !k.startsWith('$') && TIERS.includes(v))
    .sort(([a], [b]) => b.length - a.length);
  for (const [family, tier] of families) if (n === family || n.startsWith(`${family}-`) || n.includes(`-${family}`)) return [tier];
  return [];
}

/** The highest tier a model serves, or null. */
export const tierOf = (table, id) => tiersOf(table, id)[0] ?? null;

/** The provider whose tiers name models of the same line as `id` (claude-…, gpt-…, gemini-…), or null. */
export function providerOf(table, id) {
  const head = normalizeModel(id).split('-')[0];
  for (const [name, p] of Object.entries(isRecord(table?.providers) ? table.providers : {})) {
    if (Object.values(isRecord(p?.tiers) ? p.tiers : {}).some((s) => isRecord(s) && normalizeModel(s.model).split('-')[0] === head)) return name;
  }
  return null;
}

/** The model a reference names: a model id as given, or a tier resolved for `like`'s provider. */
function referenceModel(table, reference, like) {
  if (!TIERS.includes(reference)) return reference;
  const prov = providerOf(table, like) ?? 'anthropic';
  return table?.providers?.[prov]?.tiers?.[reference]?.model ?? null;
}

/**
 * USD for one bucket of tokens on one price card (USD per million). Cache writes without a
 * 1-hour price are billed at the 5-minute one, and without either at the input price; cache
 * reads without a price at the input price. A `long` card applies to the calls the parser
 * counted as long (prompts over LONG_PROMPT). Null without a card.
 */
export function costOf(price, bucket) {
  if (!isRecord(price) || !isRecord(bucket)) return null;
  const part = (p, b) => {
    const create1h = Math.min(num(b.cache_create), num(b.cache_create_1h));
    const create5m = num(b.cache_create) - create1h;
    const read = p.cacheRead ?? p.input;
    const write = p.cacheWrite ?? p.input;
    const write1h = p.cacheWrite1h ?? write;
    return (num(b.input) * num(p.input) + num(b.output) * num(p.output) + num(b.cache_read) * num(read) + create5m * num(write) + create1h * num(write1h)) / 1e6;
  };
  const long = isRecord(bucket.long) && isRecord(price.long) && num(price.long.above) === LONG_PROMPT ? bucket.long : null;
  if (!long) return part(price, bucket);
  const short = {};
  for (const k of ['input', 'output', 'cache_read', 'cache_create', 'cache_create_1h']) short[k] = Math.max(0, num(bucket[k]) - num(long[k]));
  return part(price, short) + part({ ...price, ...price.long }, long);
}

/** Add one token bucket into another (in place); `long` is added too. */
export function addBucket(into, b) {
  for (const k of ['input', 'output', 'cache_read', 'cache_create', 'cache_create_1h', 'calls']) into[k] = num(into[k]) + num(b?.[k]);
  if (isRecord(b?.long)) {
    into.long = into.long ?? { input: 0, output: 0, cache_read: 0, cache_create: 0, cache_create_1h: 0 };
    for (const k of Object.keys(into.long)) into.long[k] += num(b.long[k]);
  }
  return into;
}

/**
 * What a window's subagent runs used, read from their own transcripts beside the session's
 * (<session>/subagents/agent-<id>.jsonl): by type, the runs and their tokens per model. A run
 * whose file is gone is skipped; runs a subagent started itself are followed, two levels deep.
 */
export function subagentUsage(transcriptPath, runs, state = { depth: 0, seen: new Set() }) {
  const out = {};
  if (typeof transcriptPath !== 'string' || !transcriptPath || !Array.isArray(runs) || state.depth > 2) return out;
  const dir = join(transcriptPath.replace(/\.jsonl$/i, ''), 'subagents');
  for (const run of runs) {
    const id = isRecord(run) && typeof run.id === 'string' && /^[\w-]+$/.test(run.id) ? run.id : null;
    if (!id || state.seen.has(id)) continue;
    state.seen.add(id);
    let text;
    try {
      text = readFileSync(join(dir, `agent-${id}.jsonl`), 'utf8');
    } catch {
      continue;
    }
    const acc = parseTranscript(text);
    const type = typeof run.type === 'string' && run.type ? run.type : 'general-purpose';
    const slot = out[type] ?? (out[type] = { runs: 0, models: {} });
    slot.runs += 1;
    for (const [model, b] of Object.entries(modelBuckets(acc.models))) slot.models[model] = addBucket(slot.models[model] ?? {}, b);
    const nested = subagentUsage(transcriptPath, acc.subagentRuns, { depth: state.depth + 1, seen: state.seen });
    for (const [t, s] of Object.entries(nested)) {
      const into = out[t] ?? (out[t] = { runs: 0, models: {} });
      into.runs += s.runs;
      for (const [model, b] of Object.entries(s.models)) into.models[model] = addBucket(into.models[model] ?? {}, b);
    }
  }
  return out;
}

/** The main thread's model in a window: the one that wrote the most output. */
function mainModel(models) {
  let best = null;
  let most = -1;
  for (const [m, b] of Object.entries(isRecord(models) ? models : {})) {
    if (num(b?.output) > most) {
      best = m;
      most = num(b?.output);
    }
  }
  return best;
}

const QUALITY = [
  { key: 'checked', label: 'code checked after its last edit', format: 'pct' },
  { key: 'passed', label: 'last check passed', format: 'pct' },
  { key: 'corrections', label: 'user corrections per prompt', format: 'ratio' },
  { key: 'unverified', label: 'windows with unbacked check claims', format: 'pct' },
  { key: 'failed', label: 'tool calls that failed', format: 'pct' },
];

/**
 * Price recorded windows, split routing into delegated down, escalated up and same tier,
 * compare with a reference, and set the quality of routed windows beside the others.
 * `reference`: 'main' (each window's main model, the default), a tier name, or a model id.
 * `reported`: Claude Code's own cost figure for the same session (its cost-state line), shown as a cross-check.
 */
export function usageReport(rows, table, { reference, reported = null } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(isRecord);
  const ref = typeof reference === 'string' && reference ? reference : typeof table?.reference === 'string' ? table.reference : 'main';
  const byModel = new Map();
  const unpriced = new Set();
  const routing = {
    main: { cost: 0 },
    down: { runs: {}, cost: 0, atMain: 0 },
    up: { runs: {}, cost: 0, atMain: 0 },
    same: { runs: {}, cost: 0, atMain: 0 },
  };
  let total = 0;
  let refCost = 0;
  let refPriced = true;
  const routed = [];
  const single = [];
  const add = (model, b, where) => {
    const price = priceFor(table, model);
    const cost = costOf(price, b);
    if (cost === null) unpriced.add(model);
    const row = byModel.get(model) ?? { model, tiers: tiersOf(table, model), bucket: {}, cost: 0, priced: cost !== null, where: new Set() };
    addBucket(row.bucket, b);
    row.cost += cost ?? 0;
    row.where.add(where);
    byModel.set(model, row);
    total += cost ?? 0;
    return cost ?? 0;
  };
  for (const r of list) {
    const main = mainModel(r.models);
    const mainPrice = main ? priceFor(table, main) : null;
    const mainRank = main ? RANK[tierOf(table, main)] : undefined;
    const refModel = ref === 'main' ? main : referenceModel(table, ref, main ?? '');
    const refPrice = refModel ? priceFor(table, refModel) : null;
    const reprice = (b, actual) => {
      const c = costOf(refPrice, b);
      if (c === null) refPriced = false;
      refCost += c ?? actual;
    };
    for (const [m, b] of Object.entries(isRecord(r.models) ? r.models : {})) {
      const c = add(m, b, 'main');
      routing.main.cost += c;
      reprice(b, c);
    }
    let crossed = false;
    for (const [type, a] of Object.entries(isRecord(r.agents_usage) ? r.agents_usage : {})) {
      for (const [m, b] of Object.entries(isRecord(a?.models) ? a.models : {})) {
        const c = add(m, b, type);
        reprice(b, c);
        const rank = RANK[tierOf(table, m)];
        const side = rank === undefined || mainRank === undefined || rank === mainRank ? 'same' : rank > mainRank ? 'down' : 'up';
        if (side !== 'same') crossed = true;
        const slot = routing[side];
        slot.runs[type] = (slot.runs[type] ?? 0) + num(a.runs);
        slot.cost += c;
        slot.atMain += costOf(mainPrice, b) ?? c;
      }
    }
    (crossed ? routed : single).push(r);
  }
  const models = [...byModel.values()]
    .map((m) => ({
      model: m.model,
      tier: m.tiers.join('/') || null,
      calls: num(m.bucket.calls),
      input: num(m.bucket.input),
      output: num(m.bucket.output),
      cache_read: num(m.bucket.cache_read),
      cache_write: num(m.bucket.cache_create),
      cost: m.priced ? m.cost : null,
      share: total > 0 && m.priced ? m.cost / total : null,
      where: [...m.where].sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b))),
    }))
    .sort((a, b) => (RANK[a.tier?.split('/')[0]] ?? 9) - (RANK[b.tier?.split('/')[0]] ?? 9) || num(b.cost) - num(a.cost));
  const at = (r) => String(r.ended ?? r.recorded_at ?? '');
  const dates = list.map(at).filter(Boolean).sort();
  const quality = (set) => {
    const m = windowMetrics(set);
    return { windows: set.length, ...Object.fromEntries(QUALITY.map((q) => [q.key, m[q.key] ?? null])) };
  };
  return {
    asOf: typeof table?.asOf === 'string' ? table.asOf : null,
    windows: list.length,
    from: dates[0]?.slice(0, 10) ?? null,
    to: dates[dates.length - 1]?.slice(0, 10) ?? null,
    models,
    total,
    unpriced: [...unpriced].sort(),
    reported: Number.isFinite(reported) && reported !== null ? reported : null,
    routing,
    reference: {
      name: ref,
      label: ref === 'main' ? 'every step on the main model' : `every step on ${TIERS.includes(ref) ? `the ${ref} tier` : ref}`,
      cost: refCost,
      priced: refPriced,
      saved: refCost - total,
      share: refCost > 0 ? (refCost - total) / refCost : null,
    },
    quality: { routed: quality(routed), single: quality(single) },
  };
}

/** Dollars, with as many decimals as a small amount needs. */
export function formatUsd(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a === 0 ? '0.00' : a < 0.001 ? '<0.001' : a < 1 ? a.toFixed(3) : a < 1000 ? a.toFixed(2) : Math.round(a).toLocaleString('en-US');
  return `${v < 0 ? '-' : ''}$${s}`;
}

const tok = (v) => formatMetric('tokens', v);
const pct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`);
const runsOf = (runs) =>
  Object.entries(runs)
    .sort(([, a], [, b]) => b - a)
    .map(([t, n]) => `${t} ${n}`)
    .join(' · ');

/** The report as plain text: the cost table, the routing math, quality side by side. */
export function usageText(rep) {
  if (!rep?.windows) return 'No usage recorded yet: session rows land in .agents/learnings/eval-windows.jsonl as sessions end or compact.';
  const L = [];
  const span = rep.from && rep.to ? (rep.from === rep.to ? ` · ${rep.from}` : ` · ${rep.from} → ${rep.to}`) : '';
  L.push(`Model usage · ${rep.windows} window${rep.windows === 1 ? '' : 's'}${span} · prices as of ${rep.asOf ?? '?'}`);
  L.push('');
  L.push(`${'tier'.padEnd(10)}${'model'.padEnd(26)}${'calls'.padStart(7)}${'input'.padStart(9)}${'output'.padStart(9)}${'cache rd'.padStart(10)}${'cache wr'.padStart(10)}${'cost'.padStart(11)}${'share'.padStart(7)}`);
  for (const m of rep.models) {
    L.push(`${(m.tier ?? '?').padEnd(10)}${m.model.slice(0, 25).padEnd(26)}${String(m.calls).padStart(7)}${tok(m.input).padStart(9)}${tok(m.output).padStart(9)}${tok(m.cache_read).padStart(10)}${tok(m.cache_write).padStart(10)}${(m.cost === null ? 'no price' : formatUsd(m.cost)).padStart(11)}${pct(m.share).padStart(7)}`);
  }
  L.push(`${'total'.padEnd(36)}${''.padStart(56)}${formatUsd(rep.total).padStart(11)}`);
  if (rep.reported !== null) L.push(`  Claude Code's own figure for the session: ${formatUsd(rep.reported)}`);
  if (rep.unpriced.length) L.push(`  no price for ${rep.unpriced.join(', ')}: counted as $0 — add it under models.prices in .agents/sdlc.config.json`);
  const r = rep.routing;
  L.push('');
  L.push('Routing — each subagent run priced again on its window\'s main model');
  L.push(`  main thread      ${formatUsd(r.main.cost)}`);
  if (Object.keys(r.down.runs).length) L.push(`  delegated down   ${runsOf(r.down.runs)}: ${formatUsd(r.down.cost)}, on the main model ${formatUsd(r.down.atMain)} — up to ${formatUsd(r.down.atMain - r.down.cost)} saved`);
  if (Object.keys(r.up.runs).length) L.push(`  escalated up     ${runsOf(r.up.runs)}: ${formatUsd(r.up.cost)}, on the main model ${formatUsd(r.up.atMain)} — ${formatUsd(r.up.cost - r.up.atMain)} more, for the harder step`);
  if (Object.keys(r.same.runs).length) L.push(`  same tier        ${runsOf(r.same.runs)}: ${formatUsd(r.same.cost)}`);
  if (!Object.keys(r.down.runs).length && !Object.keys(r.up.runs).length && !Object.keys(r.same.runs).length) L.push('  no subagent runs recorded: every token was spent in the main thread');
  const f = rep.reference;
  // Against the main model the subagents' cold starts are priced as if the main thread had spent them: a ceiling.
  const upTo = f.name === 'main' ? 'up to ' : '';
  const verdict = f.share === null ? '' : f.saved >= 0 ? ` — ${upTo}${pct(f.share)} less` : ` — ${pct(-f.share)} more`;
  L.push(`  ${f.label}: ${formatUsd(f.cost)}, actual ${formatUsd(rep.total)}${verdict}${f.priced ? '' : ' (some tokens had no reference price and kept their own)'}`);
  const q = rep.quality;
  L.push('');
  L.push(`${'Quality'.padEnd(40)}${`routed (${q.routed.windows})`.padStart(14)}${`one tier (${q.single.windows})`.padStart(16)}`);
  for (const m of QUALITY) L.push(`  ${m.label.padEnd(38)}${formatMetric(m.format, q.routed[m.key]).padStart(14)}${formatMetric(m.format, q.single[m.key]).padStart(16)}`);
  L.push('');
  L.push('Repricing keeps the token counts: another model would use its own on the same work, so every figure above is an');
  L.push("estimate, and a saving against the main model is a ceiling — it prices each subagent's cold start as if the main");
  L.push('thread had spent it. For the true saving, compare real sessions before and after a change.');
  if (q.routed.windows < 20 || q.single.windows < 20) L.push('Fewer than 20 windows on a side: read the quality columns as a hint, not a result.');
  return L.join('\n');
}

/** One line for a session-start message: what the last windows cost and what routing saved. */
export function usageLine(rep) {
  if (!rep?.windows || !(rep.total > 0)) return '';
  const f = rep.reference;
  const saved = f.share !== null && f.saved > 0 ? ` · ${f.name === 'main' ? 'up to ' : ''}${pct(f.share)} below ${f.label}` : '';
  return `${formatUsd(rep.total)} over ${rep.windows} window${rep.windows === 1 ? '' : 's'} (${formatUsd(rep.total / rep.windows)} each)${saved}`;
}
