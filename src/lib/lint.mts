// `agent-setup lint` — the kit's own gate.
//
//   skills     Own skills (written here) meet docs/AUTHORING.md: every mechanical rule is an
//              error. Vendored skills (listed in kit/vendor.json) are rebuilt from upstream
//              and never hand-edited, so they are held to the Agent Skills spec only — a
//              style finding in one could not be fixed without forking it.
//   kit        catalog, agents and their model tiers (kit/models.json), hooks, settings
//              fragment, templates, routing suites,
//              vendoring record and licences.
//   repository one place per theme: the tree must match the Layout tables in AGENTS.md;
//              no two files with the same content; no corrupted text (control characters
//              left by shell quoting, U+FFFD, BOMs); no stray or empty files and folders.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { KIT_DIR, KIT_ROOT, LICENSES_DIR, ROLES, TEMPLATES, VENDOR_SKILLS_DIR, kitVersion } from './paths.mjs';
import { c, isDir, listFiles, readJsonFile, readText, say, toPosix } from './util.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { agentIndex, loadCatalog, skillDirs, skillIndex, skillsDirOf, agentFiles } from './catalog.mjs';
import { readVendor, specProblems } from './vendor.mjs';
import type { Catalog } from './catalog.mjs';
import type { VendorLock, VendorManifest } from './vendor.mjs';
import { MODELS_FILE, isTier } from './models.mjs';
import { TIERS, normalizeModel, priceFor, readModels } from '../kit/hooks/_usage.mjs';
import { LONG_PROMPT } from '../kit/hooks/_transcript.mjs';

/** Severity of one lint finding. */
export type FindingLevel = 'error' | 'warn';

/** One lint finding: where and what. */
export interface Finding {
  level: FindingLevel;
  file: string;
  msg: string;
}

/** The `(level, file, msg)` collector threaded through every lint helper. */
export type AddFinding = (level: FindingLevel, file: string, msg: string) => void;

/** Options for `lint`: limit the gate to subtrees. */
export interface LintOptions {
  paths?: string[];
}

/** The gate's result: counts plus every finding. */
export interface LintResult {
  errors: number;
  warnings: number;
  findings: Finding[];
}

/** One entry in a skill's evals/evals.json. */
interface EvalsEntry {
  prompt?: unknown;
  expected_output?: unknown;
  expectations?: unknown;
  assertions?: unknown;
}

/** One hook entry in kit/settings.fragment.json. */
interface FragmentHook {
  command?: unknown;
  args?: unknown;
}

/** One event group in kit/settings.fragment.json. */
interface FragmentGroup {
  hooks?: FragmentHook[];
}

/** The shape of kit/settings.fragment.json. */
interface SettingsFragment {
  hooks?: Record<string, FragmentGroup[]>;
}

const SKILL_KEYS = new Set([
  'name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable',
  'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell',
  'metadata', 'license', 'compatibility',
]);
const PORTABLE_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const AGENT_KEYS = new Set([
  'name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns', 'skills', 'mcpServers', 'hooks',
  'memory', 'background', 'omitClaudeMd', 'effort', 'isolation', 'color', 'initialPrompt', 'experimental',
]);
// Names Claude Code already uses for built-in commands or bundled skills; a
// custom skill with one of these names shadows the built-in.
const BUILTIN = new Set([
  'init', 'review', 'security-review', 'code-review', 'simplify', 'loop', 'schedule', 'run', 'help', 'clear', 'compact',
  'config', 'memory', 'hooks', 'agents', 'mcp', 'plugin', 'model', 'status', 'cost', 'doctor', 'login', 'logout',
  'permissions', 'resume', 'export', 'context', 'add-dir', 'bug', 'ide', 'upgrade', 'vim', 'verify', 'update-config',
  'keybindings-help', 'fewer-permission-prompts', 'claude-api', 'import',
]);
const MODELS = /^(sonnet|opus|haiku|fable|inherit|claude-[a-z0-9-]+)$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Machine-local or generated, never part of the layout (all git-ignored).
const LOCAL = new Set(['.git', 'node_modules', '.build-ts', '.state', '.claude', '.agents', '.codex', '.cursor', '.gemini', '.windsurf', 'CLAUDE.md', 'CLAUDE.local.md', 'settings.local.json']);
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip']);
const STRAY = /(\.kit-new|\.bak|\.orig|\.rej|\.tmp|\.swp|~)$|^(\.DS_Store|Thumbs\.db|desktop\.ini|nul)$/i;
// Invisible characters: a BOM after the start of any text file, and in code also zero-width
// spaces and joiners (prose may use a joiner inside an emoji). A literal one works until an
// editor or a copy drops it, so code spells them as escapes. Built from char codes so this
// file itself contains none.
const CODE = new Set(['.mjs', '.mts', '.cjs', '.js', '.ts', '.json']);
const INVISIBLE = new RegExp(`[${[0xfeff, 0x200b, 0x200c, 0x200d, 0x2060].map((n) => String.fromCharCode(n)).join('')}]`);
const MID_BOM = new RegExp(String.fromCharCode(0xfeff));

export function lint({ paths = [] }: LintOptions = {}): LintResult {
  const findings: Finding[] = [];
  const add: AddFinding = (level, file, msg) => findings.push({ level, file: toPosix(relative(KIT_ROOT, file)) || '.', msg });
  const catalog = loadCatalog();
  const scopes = paths.length ? paths.map((p) => resolve(p).toLowerCase()) : null;
  const inScope = (p: string): boolean => !scopes || scopes.some((s) => resolve(p).toLowerCase().startsWith(s));
  const covers = (p: string): boolean => !scopes || scopes.some((s) => resolve(p).toLowerCase().startsWith(s) || resolve(KIT_ROOT).toLowerCase().startsWith(s));

  let vendor: { manifest: VendorManifest; lock: VendorLock } = { manifest: {}, lock: {} };
  try {
    vendor = readVendor();
  } catch (err) {
    add('error', join(KIT_DIR, 'vendor.json'), (err as Error).message);
  }
  const vendored = new Set((vendor.manifest.skills ?? []).map((s) => s.name));

  const skills = skillDirs();
  const seen: Map<string, string> = new Map();
  for (const role of ROLES) {
    for (const e of readdirSafe(skillsDirOf(role))) {
      const dir = join(skillsDirOf(role), e);
      if (!isDir(dir) || !inScope(dir)) continue;
      if (!existsSync(join(dir, 'SKILL.md'))) {
        add('error', dir, 'skill folder has no SKILL.md');
        continue;
      }
      if (seen.has(e)) {
        add('error', dir, `a skill named "${e}" is also in kit/${seen.get(e)}/skills — one name, one role`);
        continue;
      }
      seen.set(e, role);
      if (vendored.has(e)) lintVendoredSkill({ dir, name: e, add, catalog });
      else lintSkill({ dir, name: e, add, catalog, role });
      lintRouting({ dir, name: e, add, catalog, skills });
    }
  }
  const agentRoles: Map<string, string> = new Map();
  for (const role of ROLES) {
    for (const f of readdirSafe(join(KIT_DIR, role, 'agents'))) {
      if (!f.endsWith('.md')) continue;
      if (agentRoles.has(f)) add('error', join(KIT_DIR, role, 'agents', f), `an agent named "${f.slice(0, -3)}" is also in kit/${agentRoles.get(f)}/agents — one name, one role`);
      else agentRoles.set(f, role);
    }
  }
  for (const [a, e] of agentIndex()) {
    if (inScope(e.path)) lintAgent({ file: e.path, name: a, add, skills });
  }

  if (covers(KIT_DIR)) {
    lintCatalog({ catalog, add, skills });
    lintModels({ catalog, add });
    lintHooks({ add });
    lintVendor({ vendor, add });
  }
  if (!scopes || scopes.some((s) => resolve(KIT_ROOT).toLowerCase().startsWith(s))) lintRepository({ add });

  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');
  const byFile: Map<string, Finding[]> = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file)!.push(f);
  }
  for (const [file, list] of [...byFile].sort()) {
    say(c.bold(file));
    for (const f of list) say(`  ${f.level === 'error' ? c.red('✖ error') : c.yellow('⚠ warn ')}  ${f.msg}`);
  }
  say(
    '',
    `${errors.length ? c.red(`${errors.length} error(s)`) : c.green('0 errors')}, ${warns.length} warning(s) — ${skills.length} skills (${skills.length - vendored.size} own, ${vendored.size} vendored), ${agentFiles().length} agents`,
  );
  return { errors: errors.length, warnings: warns.length, findings };
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- skills

/**
 * Relative links in a skill's own markdown. Templates under assets/ describe a project layout
 * that does not exist here. A link into a sibling skill (`../<skill>/…`) is resolved where that
 * skill really lives: in projects every skill sits in one folder, in the kit each in its role's.
 */
function brokenLinks(dir: string): Array<{ abs: string; link: string }> {
  const out: Array<{ abs: string; link: string }> = [];
  const index = skillIndex();
  for (const f of listFiles(dir)) {
    if (!f.endsWith('.md') || f.startsWith('assets/') || f.startsWith('evals/')) continue;
    const abs = join(dir, f);
    for (const link of relativeLinks(readText(abs) ?? '')) {
      const target = resolve(dirname(abs), decodeURIComponent(link));
      const rel = toPosix(relative(dirname(dir), target)).split('/');
      const sibling = rel[0] && !rel[0].startsWith('.') ? index.get(rel[0]) : undefined;
      const real = sibling ? join(sibling.path, ...rel.slice(1)) : target;
      if (!existsSync(real)) out.push({ abs, link });
    }
  }
  return out;
}

function relativeLinks(markdown: string): string[] {
  const md = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const out: string[] = [];
  for (const m of md.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const link = m[1].split('#')[0];
    if (!link || /^(https?:|mailto:|#|\/|~|\$|\{|<|\.claude\/|\.agents\/)/.test(link)) continue;
    out.push(link);
  }
  return out;
}

function syntaxErrors(dir: string, add: AddFinding, level: FindingLevel): void {
  for (const f of listFiles(dir).filter((x) => /\.(mjs|cjs|js)$/.test(x))) {
    try {
      execFileSync(process.execPath, ['--check', join(dir, f)], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      add(level, join(dir, f), `syntax error: ${String((err as { stderr?: unknown }).stderr ?? (err as Error).message).split('\n').slice(0, 4).join(' ')}`);
    }
  }
}

function lintVendoredSkill({ dir, name, add, catalog }: { dir: string; name: string; add: AddFinding; catalog: Catalog }): void {
  const skillPath = join(dir, 'SKILL.md');
  const text = readText(skillPath) ?? '';
  let problems: string[];
  try {
    problems = specProblems(text, name);
  } catch (err) {
    problems = [(err as Error).message];
  }
  for (const p of problems) add('error', skillPath, `${p} — fix the override in kit/vendor.json and run \`agent-setup vendor sync --locked\``);
  const lic = String(parseFrontmatter(text).data?.license ?? '').match(/\(see ([^)]+)\)/)?.[1];
  if (lic && !existsSync(resolve(dir, lic))) add('error', skillPath, `license points at ${lic}, which does not exist — run \`agent-setup vendor sync --locked\``);
  for (const { abs, link } of brokenLinks(dir)) add('warn', abs, `broken link upstream: ${link} — report it upstream or exclude the skill in kit/vendor.json`);
  syntaxErrors(dir, add, 'error');
  if (!catalog.skills?.[name]) add('error', skillPath, 'vendored skill is missing from kit/catalog.json');
}

function lintSkill({ dir, name, add, catalog, role }: { dir: string; name: string; add: AddFinding; catalog: Catalog; role: string }): void {
  const skillPath = join(dir, 'SKILL.md');
  const text = readText(skillPath) ?? '';
  const fm = parseFrontmatter(text);
  if (!fm.data) {
    add('error', skillPath, fm.error as string);
    return;
  }
  if (fm.error) add('error', skillPath, `frontmatter: ${fm.error}`);
  const d = fm.data;

  if (!d.name) add('error', skillPath, 'frontmatter has no `name`');
  else {
    if (d.name !== name) add('error', skillPath, `name "${d.name}" differs from its folder "${name}" — the folder name is what installs`);
    if (!KEBAB.test(d.name as string) || (d.name as string).length > 64) add('error', skillPath, `name "${d.name}" must be lowercase-kebab-case, ≤64 chars`);
    if (['synced', 'anthropic-skills'].includes(d.name as string) || String(d.name).startsWith('anthropic-skills')) add('error', skillPath, `"${d.name}" is reserved by Claude Code`);
    if (BUILTIN.has(d.name as string)) add('error', skillPath, `"${d.name}" shadows a built-in Claude Code command or bundled skill`);
  }

  const desc = String(d.description ?? '');
  if (!desc) add('error', skillPath, 'frontmatter has no `description` — it is the only thing that decides whether the skill loads');
  else {
    const withWhen = desc.length + String(d.when_to_use ?? '').length;
    if (desc.length > 1024) add('error', skillPath, `description is ${desc.length} chars; the Agent Skills spec caps it at 1024`);
    if (withWhen > 1536) add('error', skillPath, `description + when_to_use is ${withWhen} chars; Claude Code truncates at 1536`);
    if (desc.length < 80) add('warn', skillPath, 'description is very short — say what it does AND when to use it, in the words a user types');
    if (!/\b(use (it |this( skill)? )?(when|whenever|for|before|after|to)|trigger)/i.test(`${desc} ${d.when_to_use ?? ''}`)) {
      add('error', skillPath, 'description never says when to use the skill ("Use when/whenever …")');
    }
  }

  for (const k of Object.keys(d)) {
    if (!SKILL_KEYS.has(k)) add('warn', skillPath, `unknown frontmatter key "${k}" — Claude Code ignores it; claude.ai rejects it`);
  }
  // Admin skills run only when invoked by name: disable-model-invocation keeps their descriptions
  // out of every developer session in Claude Code (other agents ignore the key; export strips it).
  const nonPortable = Object.keys(d).filter((k) => SKILL_KEYS.has(k) && !PORTABLE_KEYS.has(k));
  if (nonPortable.length && role !== 'admin') {
    add('warn', skillPath, `Claude-only frontmatter (${nonPortable.join(', ')}) — other agents ignore it, claude.ai upload rejects it`);
  }
  if (role === 'admin' && d['disable-model-invocation'] !== true) {
    add('error', skillPath, 'admin skills set `disable-model-invocation: true` — invoked by name, they cost developer sessions nothing');
  }

  const bodyLines = fm.body.split(/\r?\n/).length;
  if (bodyLines > 500) add('error', skillPath, `SKILL.md body is ${bodyLines} lines; keep it under 500 and move depth into references/`);
  else if (bodyLines > 400) add('warn', skillPath, `SKILL.md body is ${bodyLines} lines — close to the 500-line budget`);

  if (!text.includes(`.agents/overlays/${name}.md`)) {
    add('error', skillPath, `own skills must read their project overlay (.agents/overlays/${name}.md) before starting`);
  }

  for (const { abs, link } of brokenLinks(dir)) add('error', abs, `broken link: ${link}`);
  for (const f of listFiles(dir)) {
    if (f === 'SKILL.md' || !f.endsWith('.md') || f.startsWith('assets/') || f.startsWith('evals/')) continue;
    const t = readText(join(dir, f)) ?? '';
    if (t.split(/\r?\n/).length > 300 && !/^#+ (contents|table of contents)/im.test(t)) {
      add('warn', join(dir, f), `${t.split(/\r?\n/).length} lines without a "Contents" section — long references need a table of contents`);
    }
  }
  syntaxErrors(dir, add, 'error');

  const evalsPath = join(dir, 'evals', 'evals.json');
  const ev = readJsonFile(evalsPath);
  if (ev.missing) {
    if (catalog.skills?.[name]?.group === 'domain') add('warn', skillPath, 'domain skill has no evals/evals.json — nothing guards it against regressions');
  } else if (ev.error) add('error', evalsPath, `invalid JSON: ${ev.error}`);
  else {
    const evValue = ev.value as { skill_name?: unknown; evals?: unknown };
    if (evValue.skill_name !== name) add('error', evalsPath, `skill_name "${evValue.skill_name}" ≠ "${name}"`);
    if (!Array.isArray(evValue.evals) || !evValue.evals.length) add('error', evalsPath, 'needs a non-empty `evals` array');
    else
      evValue.evals.forEach((e: EvalsEntry, i: number) => {
        if (!e.prompt || !e.expected_output) add('error', evalsPath, `evals[${i}] needs prompt and expected_output`);
        if (e.expectations !== undefined && (!Array.isArray(e.expectations) || e.expectations.some((x) => typeof x !== 'string'))) {
          add('error', evalsPath, `evals[${i}].expectations must be a list of strings (skill-creator format)`);
        }
        if (e.assertions !== undefined) add('warn', evalsPath, `evals[${i}] uses "assertions"; skill-creator reads "expectations" (list of strings)`);
        if (/^TODO/.test(String(e.prompt ?? ''))) add('warn', evalsPath, `evals[${i}] is still a TODO`);
      });
  }
  const trigPath = join(dir, 'evals', 'trigger.json');
  const tr = readJsonFile(trigPath);
  if (!tr.missing) {
    if (tr.error) add('error', trigPath, `invalid JSON: ${tr.error}`);
    else if (!Array.isArray(tr.value) || tr.value.some((q) => typeof q.query !== 'string' || typeof q.should_trigger !== 'boolean')) {
      add('error', trigPath, 'must be an array of {query: string, should_trigger: boolean}');
    } else {
      if (tr.value.length < 8) add('warn', trigPath, `only ${tr.value.length} trigger queries — aim for 16–20`);
      if (!tr.value.some((q) => !q.should_trigger)) add('warn', trigPath, 'no should_trigger:false near-misses — those are the queries that test a description');
    }
  }

  if (!catalog.skills?.[name]) add('error', skillPath, 'skill is missing from kit/catalog.json');
}

/** evals/routing.json: which skill a real agent picks first (agent-setup eval-routing). */
function lintRouting({ dir, name, add, catalog, skills }: { dir: string; name: string; add: AddFinding; catalog: Catalog; skills: string[] }): void {
  const file = join(dir, 'evals', 'routing.json');
  const r = readJsonFile(file);
  if (r.missing) return;
  if (r.error || !r.value) {
    add('error', file, `invalid JSON: ${r.error}`);
    return;
  }
  const known = new Set(skills);
  const scope = new Set<string>();
  const rawScope = (r.value as { scope?: unknown }).scope;
  if (rawScope !== undefined && (!Array.isArray(rawScope) || !rawScope.length)) add('error', file, '`scope` must be a non-empty list of skill names or @groups');
  const agents = new Set(agentFiles());
  for (const s of Array.isArray(rawScope) ? rawScope : [...known]) {
    if (typeof s === 'string' && s.startsWith('agent:')) {
      if (!agents.has(s.slice(6))) add('error', file, `scope names unknown agent "${s}" (kit/agents/${s.slice(6)}.md)`);
      else scope.add(s);
    } else if (typeof s === 'string' && s.startsWith('@')) {
      if (!catalog.groups?.[s.slice(1)]) add('error', file, `scope names unknown group "${s}"`);
      for (const [n, m] of Object.entries(catalog.skills ?? {})) if (m.group === s.slice(1)) scope.add(n);
    } else if (!known.has(s)) add('error', file, `scope names unknown skill "${s}"`);
    else scope.add(s);
  }
  if (!scope.has(name)) add('error', file, `scope does not include the skill the suite belongs to (${name})`);
  const fixture = (r.value as { fixture?: unknown }).fixture;
  if (fixture !== undefined && (typeof fixture !== 'string' || !isDir(join(dir, 'evals', fixture)))) add('error', file, `fixture "${String(fixture)}" is not a folder under evals/`);
  const cases = (r.value as { cases?: unknown }).cases;
  if (!Array.isArray(cases) || !cases.length) {
    add('error', file, 'needs a non-empty `cases` array');
    return;
  }
  const ids = new Set<string>();
  cases.forEach((k, i) => {
    const at = `cases[${i}]${k?.id ? ` (${k.id})` : ''}`;
    if (!k?.id || !KEBAB.test(k.id)) add('error', file, `${at} needs a kebab-case id`);
    else if (ids.has(k.id)) add('error', file, `${at}: duplicate id`);
    ids.add(k?.id);
    if (typeof k?.prompt !== 'string' || !k.prompt.trim()) add('error', file, `${at} needs a prompt`);
    const hasFirst = Array.isArray(k?.first) && k.first.length > 0;
    const hasNeed = Array.isArray(k?.need) && k.need.length > 0;
    if ((hasFirst || hasNeed) === Boolean(k?.none)) add('error', file, `${at} needs \`first\` and/or \`need\` (non-empty lists), or \`none: true\` — not both, not neither`);
    for (const key of ['first', 'forbid', 'need']) {
      if (k?.[key] === undefined) continue;
      if (!Array.isArray(k[key])) add('error', file, `${at}.${key} must be a list`);
      else
        for (const entry of k[key])
          for (const s of String(entry).split('|')) if (!scope.has(s)) add('error', file, `${at}.${key} names "${s}", which is not in the suite's scope — it would never be judged`);
    }
    if (k?.when !== undefined && (typeof k.when !== 'string' || !k.when)) add('error', file, `${at}.when must be a capability name`);
  });
}

function lintAgent({ file, name, add, skills }: { file: string; name: string; add: AddFinding; skills: string[] }): void {
  const fm = parseFrontmatter(readText(file) ?? '');
  if (!fm.data) {
    add('error', file, fm.error as string);
    return;
  }
  const d = fm.data;
  if (!d.name) add('error', file, 'no `name` — Claude Code treats the file as documentation and skips it');
  else {
    if (d.name !== name) add('error', file, `name "${d.name}" differs from the file name`);
    if (String(d.name).includes(':') || String(d.name).startsWith('-')) add('error', file, 'name cannot contain ":" or start with "-"');
  }
  if (!d.description) add('error', file, 'no `description` — it is how Claude decides when to delegate');
  for (const k of Object.keys(d)) if (!AGENT_KEYS.has(k)) add('warn', file, `unknown frontmatter key "${k}"`);
  if (d.model && !MODELS.test(String(d.model))) add('error', file, `model "${d.model}" is not sonnet|opus|haiku|fable|inherit|claude-*`);
  if (d.memory && !['user', 'project', 'local'].includes(d.memory as string)) add('error', file, 'memory must be user, project or local');
  const preload = Array.isArray(d.skills) ? d.skills : d.skills ? [d.skills] : [];
  const known = new Set(skills);
  for (const s of preload) if (!known.has(s)) add('error', file, `preloads unknown skill "${s}"`);
}

// ---------------------------------------------------------------- kit

function lintCatalog({ catalog, add, skills }: { catalog: Catalog; add: AddFinding; skills: string[] }): void {
  const file = join(KIT_DIR, 'catalog.json');
  const dirs = new Set(skills);
  const groups = catalog.groups ?? {};
  if (!Object.keys(groups).length) add('error', file, '`groups` is empty — every skill belongs to a group');
  const validItem = (item: string): boolean => (item.startsWith('@') ? Boolean(groups[item.slice(1)]) : dirs.has(item));

  const index = skillIndex();
  for (const r of ROLES) if (!catalog.roles?.[r]) add('error', file, `role "${r}" has no description in \`roles\``);
  for (const r of Object.keys(catalog.roles ?? {})) if (!(ROLES as readonly string[]).includes(r)) add('error', file, `unknown role "${r}" (roles: ${ROLES.join(', ')})`);
  for (const s of skills) if (!catalog.skills?.[s]) add('error', file, `kit/${index.get(s)?.role}/skills/${s} is not in the catalog`);
  for (const [s, meta] of Object.entries(catalog.skills ?? {})) {
    if (!dirs.has(s)) add('error', file, `catalog lists skill "${s}" but no kit/<role>/skills/${s}/SKILL.md exists`);
    if (!meta.summary) add('error', file, `skill "${s}" has no summary`);
    if (!groups[meta.group]) add('error', file, `skill "${s}" is in unknown group "${meta.group}" (groups: ${Object.keys(groups).join(', ')})`);
    // The admin group is the admin role: one name for one set.
    if (dirs.has(s) && (meta.group === 'admin') !== (index.get(s)?.role === 'admin')) {
      add('error', file, `skill "${s}" is in group ${meta.group} but lives in kit/${index.get(s)?.role}/ — admin skills, and only they, are in group admin`);
    }
  }
  for (const s of catalog.core ?? []) {
    if (!dirs.has(s)) add('error', file, `core list names unknown skill "${s}"`);
    else if (catalog.skills?.[s]?.group !== 'core') add('error', file, `core list names "${s}", which is not in group core`);
  }
  const hookFiles = listFiles(join(KIT_DIR, 'hooks')).filter((f) => f.endsWith('.mjs') && !f.startsWith('_') && !f.includes('/'));
  for (const f of hookFiles) {
    const meta = catalog.hooks?.[f.slice(0, -4)];
    if (!meta) add('error', file, `hook kit/hooks/${f} is not in the catalog's \`hooks\` (each hook names the role it serves)`);
    else if (!(ROLES as readonly string[]).includes(meta.role)) add('error', file, `hook "${f.slice(0, -4)}" has unknown role "${meta.role}"`);
  }
  for (const h of Object.keys(catalog.hooks ?? {})) if (!hookFiles.includes(`${h}.mjs`)) add('error', file, `catalog lists hook "${h}" but kit/hooks/${h}.mjs does not exist`);
  for (const [p, def] of Object.entries(catalog.profiles ?? {})) {
    if (!def.description) add('error', file, `profile "${p}" has no description`);
    if (def.skills === '*') continue;
    if (!Array.isArray(def.skills)) add('error', file, `profile "${p}": skills must be "*" or a list`);
    else for (const s of def.skills) if (!validItem(s)) add('error', file, `profile "${p}" names unknown skill or group "${s}"`);
  }
  if (!catalog.profiles?.[catalog.defaultProfile as string]) add('error', file, `defaultProfile "${catalog.defaultProfile}" is not a profile`);

  const agents = new Set(agentFiles());
  for (const [a, meta] of Object.entries(catalog.agents ?? {})) {
    if (!agents.has(a)) add('error', file, `catalog lists agent "${a}" but no kit/<role>/agents/${a}.md exists`);
    if (!meta.summary) add('error', file, `agent "${a}" has no summary`);
    for (const r of meta.requires ?? []) if (!dirs.has(r)) add('error', file, `agent "${a}" requires unknown skill "${r}"`);
  }
  for (const a of agents) if (!catalog.agents?.[a]) add('error', file, `agent "${a}" is not in the catalog`);
}

/** Prices older than this many days get a warning: providers change them. */
const PRICES_STALE_DAYS = 180;
const SANDBOXES = new Set(['read-only', 'workspace-write']);

/**
 * kit/models.json is complete — every provider runs every tier on a priced model — and every
 * agent runs on its catalog tier: its file's model is the tier's Claude Code alias and its
 * effort the tier's effort, so the agent file, the AGENTS.md table and other tools' copies agree.
 */
function lintModels({ catalog, add }: { catalog: Catalog; add: AddFinding }): void {
  const file = MODELS_FILE;
  const raw = readModels(file);
  if (!raw) {
    add('error', file, 'unreadable or not a JSON object');
    return;
  }
  const asOf = typeof raw.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.asOf) ? Date.parse(raw.asOf) : NaN;
  if (!Number.isFinite(asOf)) add('error', file, '`asOf` must be the date the prices were checked (YYYY-MM-DD)');
  else if ((Date.now() - asOf) / 86_400_000 > PRICES_STALE_DAYS) add('warn', file, `prices last checked ${raw.asOf}: check them against each provider's source and update \`asOf\``);
  for (const t of TIERS) if (!raw.tiers?.[t]?.use) add('error', file, `tier "${t}" needs a \`use\` line (the AGENTS.md table shows it)`);
  for (const t of Object.keys(raw.tiers ?? {})) if (!isTier(t)) add('error', file, `unknown tier "${t}" (tiers: ${TIERS.join(', ')})`);
  for (const [k, v] of Object.entries(raw.families ?? {})) if (!k.startsWith('$') && !isTier(v)) add('error', file, `family "${k}" maps to unknown tier "${v}"`);
  const priceNums = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h'] as const;
  for (const [id, p] of Object.entries(raw.prices ?? {})) {
    if (id !== normalizeModel(id)) add('error', file, `price "${id}" must be listed under its bare id "${normalizeModel(id)}" — lookups normalise before matching`);
    for (const k of priceNums) {
      const v = (p as unknown as Record<string, unknown>)[k];
      if ((k === 'input' || k === 'output' || v !== undefined) && !(typeof v === 'number' && v >= 0)) add('error', file, `price "${id}": ${k} must be a number of USD per million tokens`);
    }
    if (p.long !== undefined && p.long.above !== LONG_PROMPT) add('error', file, `price "${id}": long.above must be ${LONG_PROMPT}, the threshold the transcript parser counts long prompts at`);
  }
  for (const [name, prov] of Object.entries(raw.providers ?? {})) {
    if (!prov.label) add('error', file, `provider "${name}" needs a label`);
    if (!Array.isArray(prov.agents)) add('error', file, `provider "${name}" needs \`agents\`: the install targets that run its models`);
    for (const t of TIERS) {
      const spec = prov.tiers?.[t];
      if (!spec?.model) {
        add('error', file, `provider "${name}" has no model for tier "${t}"`);
        continue;
      }
      if (!priceFor(raw, spec.model)) add('error', file, `provider "${name}", tier "${t}": no price for ${spec.model} — the usage report could not cost it`);
      if (name === 'anthropic' && !(spec.alias && MODELS.test(spec.alias) && spec.alias !== 'inherit')) add('error', file, `anthropic tier "${t}" needs the Claude Code alias its agents name (fable, opus, sonnet or haiku)`);
    }
  }
  const claude = raw.providers?.anthropic?.tiers ?? {};
  for (const [a, meta] of Object.entries(catalog.agents ?? {})) {
    const at = join(KIT_DIR, 'catalog.json');
    if (!isTier(meta.tier)) {
      add('error', at, `agent "${a}" needs a \`tier\` (${TIERS.join(', ')}): the model it runs on`);
      continue;
    }
    if (meta.sandbox !== undefined && !SANDBOXES.has(meta.sandbox)) add('error', at, `agent "${a}": sandbox must be ${[...SANDBOXES].join(' or ')}`);
    const entry = agentIndex().get(a);
    const fm = entry ? parseFrontmatter(readText(entry.path) ?? '') : null;
    if (!entry || !fm?.data) continue;
    const want = claude[meta.tier];
    if (want?.alias && fm.data.model !== want.alias) add('error', entry.path, `model "${String(fm.data.model ?? '')}" but the catalog puts it on the ${meta.tier} tier: \`model: ${want.alias}\` (kit/models.json)`);
    if (want?.effort && fm.data.effort !== want.effort) add('error', entry.path, `effort "${String(fm.data.effort ?? '')}" but the ${meta.tier} tier runs at \`effort: ${want.effort}\` (kit/models.json)`);
  }
}

function lintHooks({ add }: { add: AddFinding }): void {
  const hooksDir = join(KIT_DIR, 'hooks');
  for (const f of listFiles(hooksDir).filter((x) => x.endsWith('.mjs'))) {
    try {
      execFileSync(process.execPath, ['--check', join(hooksDir, f)], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      add('error', join(hooksDir, f), `syntax error: ${String((err as { stderr?: unknown }).stderr ?? (err as Error).message).split('\n')[0]}`);
    }
  }
  const fragPath = join(KIT_DIR, 'settings.fragment.json');
  const frag = readJsonFile(fragPath);
  if (frag.error || !frag.value) add('error', fragPath, `invalid JSON: ${frag.error}`);
  else {
    for (const [event, groups] of Object.entries((frag.value as SettingsFragment).hooks ?? {})) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          const script = ((h.args ?? []) as unknown[]).join(' ').match(/\.agents\/hooks\/([\w.-]+)/)?.[1];
          if (!script || !existsSync(join(hooksDir, script))) add('error', fragPath, `${event} handler runs a script that is not in kit/hooks: ${JSON.stringify(h.args)}`);
          if (h.command !== 'node' || !Array.isArray(h.args)) add('warn', fragPath, `${event} handler is not exec form (command: "node", args: [...])`);
        }
      }
    }
  }
  for (const t of ['AGENTS.md', 'agents-block.md', 'agents-README.md', 'claude-block.md', 'claude-section.md', 'gemini-block.md', 'learnings-README.md', 'learnings-inbox.md', 'overlays-README.md', 'workflow-guide.md', 'gitignore-block.txt']) {
    if (!existsSync(join(TEMPLATES, t))) add('error', join(TEMPLATES, t), 'template missing');
  }
}

/** kit/vendor.json, its lock and kit/developer/licenses agree with each other and with the skills. */
function lintVendor({ vendor, add }: { vendor: { manifest: VendorManifest; lock: VendorLock }; add: AddFinding }): void {
  const file = join(KIT_DIR, 'vendor.json');
  const { manifest, lock } = vendor;
  const repos = manifest.repos ?? {};
  const used = new Set<string>();
  const names = new Set<string>();
  for (const [i, s] of (manifest.skills ?? []).entries()) {
    const at = `skills[${i}] (${s.name ?? '?'})`;
    if (!s.name || !KEBAB.test(s.name)) add('error', file, `${at}: invalid name`);
    if (names.has(s.name)) add('error', file, `${at}: listed twice`);
    names.add(s.name);
    if (!repos[s.repo]) add('error', file, `${at}: unknown repo "${s.repo}"`);
    used.add(s.repo);
    if ((s.description || s.compatibility || s.removeKeys?.length) && !s.why) add('error', file, `${at}: overrides need a \`why\``);
    if (!existsSync(join(VENDOR_SKILLS_DIR, s.name ?? '', 'SKILL.md'))) add('error', file, `${at}: kit/developer/skills/${s.name} is missing — run \`agent-setup vendor sync --locked\``);
    if (!(lock.skills ?? []).some((l) => l.name === s.name)) add('warn', file, `${at}: not in vendor.lock.json yet — run \`agent-setup vendor sync\``);
  }
  for (const [i, x] of (manifest.excluded ?? []).entries()) if (!x.why) add('error', file, `excluded[${i}] needs a \`why\``);
  for (const key of used) if (repos[key] && !lock.repos?.[key]?.commit) add('warn', file, `repo "${key}" has no locked commit — run \`agent-setup vendor sync\``);
  for (const key of Object.keys(repos)) if (!used.has(key)) add('warn', file, `repo "${key}" is not used by any skill`);

  // One licence per upstream source, and only for sources in use.
  const licDir = LICENSES_DIR;
  for (const key of used) {
    if (repos[key]?.license && !existsSync(join(licDir, `${key}.txt`))) {
      add('error', file, `repo "${key}" declares ${repos[key].license} but kit/developer/licenses/${key}.txt is missing — run \`agent-setup vendor sync --locked\``);
    }
  }
  for (const f of readdirSafe(licDir)) {
    if (!f.endsWith('.txt') || !used.has(f.slice(0, -4))) add('error', join(licDir, f), 'not the licence of any vendored source — remove it');
  }
}

// ---------------------------------------------------------------- repository

/** Paths named in the first column of the tables under "## Layout" in AGENTS.md. */
function documentedLayout(): Set<string> {
  const text = readText(join(KIT_ROOT, 'AGENTS.md')) ?? '';
  const section = text.split(/^## /m).find((s) => s.startsWith('Layout')) ?? '';
  const out = new Set<string>();
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const first = line.split('|')[1] ?? '';
    for (const m of first.matchAll(/`([^`]+)`/g)) out.add(m[1].replace(/\/$/, ''));
  }
  return out;
}

function lintRepository({ add }: { add: AddFinding }): void {
  // 1 · One place per theme: the tree matches the documented layout, both ways.
  const agentsMd = join(KIT_ROOT, 'AGENTS.md');
  const layout = documentedLayout();
  if (!layout.size) add('error', agentsMd, 'no "## Layout" table — the linter checks the tree against it');
  else {
    const actual = new Set([
      ...readdirSafe(KIT_ROOT).filter((e) => !LOCAL.has(e)),
      ...readdirSafe(KIT_DIR).map((e) => `kit/${e}`),
    ]);
    for (const p of actual) {
      if (!layout.has(p)) add('error', join(KIT_ROOT, p), 'not in the Layout tables of AGENTS.md — put it where its theme already lives, or document the new place on purpose');
    }
    for (const p of layout) if (!actual.has(p)) add('error', agentsMd, `Layout names \`${p}\`, which does not exist`);
  }
  // A role folder holds that role's skills and agents (and, for the developer role, the
  // licences of the vendored skills) — nothing else.
  for (const role of ROLES) {
    for (const e of readdirSafe(join(KIT_DIR, role))) {
      const allowed = ['skills', 'agents', ...(role === 'developer' ? ['licenses'] : [])];
      if (!allowed.includes(e)) add('error', join(KIT_DIR, role, e), `a role folder holds only ${allowed.join(', ')}/ — put this where its theme lives`);
    }
  }

  // 2 · Every file once; no corrupted, stray or empty files; no empty folders.
  const byHash: Map<string, string[]> = new Map();
  const walk = (dir: string): void => {
    const entries = readdirSafe(dir).filter((e) => !LOCAL.has(e) && !e.endsWith('-workspace'));
    if (!entries.length && dir !== KIT_ROOT) add('warn', dir, 'empty folder — remove it');
    for (const e of entries) {
      const abs = join(dir, e);
      if (isDir(abs)) {
        walk(abs);
        continue;
      }
      if (STRAY.test(e)) add('error', abs, 'stray file (backup, merge leftover or OS metadata) — remove it');
      const buf = readFileSync(abs);
      if (!buf.length) {
        if (e !== '.gitkeep') add('warn', abs, 'empty file');
        continue;
      }
      let data = buf;
      if (!BINARY.has(extname(e).toLowerCase()) && !buf.includes(0)) {
        const s = buf.toString('utf8');
        if (s.charCodeAt(0) === 0xfeff) add('error', abs, 'starts with a BOM — frontmatter and JSON parsers in some agents choke on it');
        const bad = s.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
        if (bad) {
          const line = s.slice(0, bad.index).split('\n').length;
          add('error', abs, `control character 0x${bad[0].charCodeAt(0).toString(16).padStart(2, '0')} on line ${line} — usually a backtick escape eaten by a shell (\`a → BEL, \`b → BS, \`f → FF); write files with an editor or a quoted heredoc`);
        }
        const hidden = s.slice(1).match(CODE.has(extname(e).toLowerCase()) ? INVISIBLE : MID_BOM);
        if (hidden) {
          const code = hidden[0].charCodeAt(0).toString(16).toUpperCase();
          add('error', abs, `invisible character U+${code} on line ${s.slice(0, (hidden.index as number) + 1).split('\n').length} — write it as an escape sequence (backslash, u, ${code})`);
        }
        if (s.includes('\uFFFD')) add('error', abs, 'contains U+FFFD (a character lost in an encoding conversion)');
        data = Buffer.from(s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
      }
      const h = createHash('sha256').update(data).digest('hex');
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h)!.push(abs);
    }
  };
  walk(KIT_ROOT);
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const [first, ...rest] = group.map((p) => toPosix(relative(KIT_ROOT, p)));
    for (const p of rest) add('error', join(KIT_ROOT, p), `identical to ${first} — keep one copy and link or reference it`);
  }

  // 3 · Links in the repository's own docs (skills are checked above).
  const docs = ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'scorecards/README.md', ...listFiles(join(KIT_ROOT, 'docs')).map((f) => `docs/${f}`), ...listFiles(join(KIT_ROOT, 'inbox')).map((f) => `inbox/${f}`)];
  for (const rel of docs.filter((f) => f.endsWith('.md'))) {
    const abs = join(KIT_ROOT, rel);
    for (const link of relativeLinks(readText(abs) ?? '')) {
      if (!existsSync(resolve(dirname(abs), decodeURIComponent(link)))) add('error', abs, `broken link: ${link}`);
    }
  }
}
