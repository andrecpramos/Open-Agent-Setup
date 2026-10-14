// The model tiers in the CLI: the kit's table (kit/models.json) with a project's overrides,
// the AGENTS.md tier table, and the agent files of tools that read their own format.
//
// The tiers, prices and cost math live in kit/hooks/_usage.mjs, which the session-eval hook
// uses in projects; this module only adds what the installer and lint need.
//
// Source of `lib/models.mjs` — edit here, then `npm run build`. Never hand-edit the output.
import { join } from 'node:path';
import { KIT_DIR, sdlcConfigPath } from './paths.mjs';
import { CliError, readJsonFile, readText } from './util.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { TIERS, mergeModels, readModels } from '../kit/hooks/_usage.mjs';
export const MODELS_FILE = join(KIT_DIR, 'models.json');
/** Tools that run models from any provider: their tier table shows every provider. */
const OPEN_TOOLS = new Set(['cursor', 'copilot', 'windsurf']);
export const isTier = (v) => typeof v === 'string' && TIERS.includes(v);
/** The kit's table, as shipped. */
export function kitModels() {
    const t = readModels(MODELS_FILE);
    if (!t)
        throw new CliError('kit/models.json is unreadable');
    return mergeModels(t, null);
}
/** The kit's table with a project's `models` overrides from its sdlc.config.json. */
export function modelsFor(target) {
    const file = sdlcConfigPath(target);
    const cfg = (file ? readJsonFile(file).value : null);
    return mergeModels(kitModels(), cfg?.models ?? null);
}
/**
 * The providers whose models the targeted tools run (Claude Code → anthropic, Codex → openai,
 * Gemini → google). A tool that runs any provider's models, or no tool named at all, shows
 * every provider: the reader picks the column of the model they run.
 */
export function providersFor(table, targets) {
    const all = Object.keys(table.providers);
    const named = all.filter((p) => (table.providers[p].agents ?? []).some((a) => targets.includes(a)));
    return named.length && !targets.some((t) => OPEN_TOOLS.has(t)) ? named : all;
}
const cell = (tm, alias) => (tm ? `\`${alias && tm.alias ? tm.alias : tm.model}\`${tm.effort ? ` · ${tm.effort}` : ''}` : '—');
/** The AGENTS.md "Model tiers" table: each tier's use, and its model and effort per provider. */
export function tierTable(table, targets) {
    const provs = providersFor(table, targets);
    const claude = targets.includes('claude');
    const head = (p) => (p === 'anthropic' && claude ? `${table.providers[p].label} (Claude Code)` : table.providers[p].label);
    const rows = [`| Tier | Use it for | ${provs.map(head).join(' | ')} |`, `|---|---|${provs.map(() => '---|').join('')}`];
    for (const tier of TIERS) {
        rows.push(`| ${tier} | ${table.tiers?.[tier]?.use ?? ''} | ${provs.map((p) => cell(table.providers[p].tiers[tier], p === 'anthropic' && claude)).join(' | ')} |`);
    }
    return rows.join('\n');
}
const tomlString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
/** A multi-line TOML string: literal (no escapes) unless the text holds the literal delimiter. */
const tomlBlock = (s) => (s.includes("'''") ? `"""\n${s.replace(/\\/g, '\\\\').replace(/"""/g, '""\\"')}\n"""` : `'''\n${s}\n'''`);
/** One kit agent as a Codex custom agent (.codex/agents/<name>.toml), on its tier's OpenAI model. */
export function codexAgent(name, file, tier, opts) {
    const fm = parseFrontmatter(readText(file) ?? '');
    if (!fm.data)
        throw new CliError(`${file}: ${fm.error}`);
    const skills = (Array.isArray(fm.data.skills) ? fm.data.skills : fm.data.skills ? [fm.data.skills] : []).map(String);
    const notes = [];
    if (skills.length)
        notes.push(`Your procedure is in ${skills.map((s) => `\`.agents/skills/${s}/SKILL.md\``).join(' and ')}: read it before you start. Where this file says "preloaded", that is the skill it means.`);
    if (fm.data.memory)
        notes.push('The memory section below is for Claude Code: skip it, and put durable facts in your report instead.');
    const body = `${notes.length ? `${notes.join('\n')}\n\n` : ''}${fm.body.trim()}`;
    const spec = opts.table.providers.openai?.tiers?.[tier];
    const lines = [
        `# Managed by agent-setup v${opts.version}: the kit's ${name} agent, on the ${tier} tier (.agents/models.json).`,
        '# `agent-setup update` rewrites this file. To run the tier on another model, set it in',
        '# .agents/sdlc.config.json under "models" and run update; to change the agent, add your own.',
        `name = ${tomlString(name)}`,
        `description = ${tomlString(String(fm.data.description ?? ''))}`,
    ];
    if (spec?.model)
        lines.push(`model = ${tomlString(spec.model)}`);
    if (spec?.effort)
        lines.push(`model_reasoning_effort = ${tomlString(spec.effort)}`);
    if (opts.sandbox)
        lines.push(`sandbox_mode = ${tomlString(opts.sandbox)}`);
    lines.push(`developer_instructions = ${tomlBlock(body)}`);
    return `${lines.join('\n')}\n`;
}
