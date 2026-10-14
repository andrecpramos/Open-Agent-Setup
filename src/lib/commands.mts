// status · uninstall · harvest · list · new-skill
// (vendor sync / status / record and import live in vendor.mjs; eval-routing in routing.mjs)

import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve, relative } from 'node:path';
import { HOME_REL, INBOX_DIR, KIT_DIR, KIT_ROOT, LEGACY_MANIFEST_REL, MANIFEST_REL, homeDir, kitSource, kitVersion, sdlcConfigPath } from './paths.mjs';
import {
  CliError,
  c,
  exists,
  git,
  hashFile,
  hashText,
  isDir,
  listFiles,
  pruneEmptyDirs,
  readJsonFile,
  readText,
  say,
  toPosix,
  today,
  writeJson,
  writeText,
} from './util.mjs';
import { MD, HASH, removeBlock } from './blocks.mjs';
import { unmergeSettings, wiredScripts } from './settings.mjs';
import type { AddedRecord } from './settings.mjs';
import { readManifest, listProjects, unregisterProject } from './state.mjs';
import { sync, kitHookScripts } from './sync.mjs';
import type { KitManifest, ProjectEntry } from './state.mjs';
import { agentIndex, loadCatalog, skillDirs, skillSummary, groupSkills, skillsDirOf } from './catalog.mjs';
import type { Catalog } from './catalog.mjs';
import { vendoredSkills } from './vendor.mjs';
import { isEmptyHookFile, removeKitHooks, specForFile } from './agent-hooks.mjs';

export interface StatusOptions {
  quiet?: boolean;
}

export interface StatusResult {
  ok: boolean;
  installed: boolean;
  outdated?: boolean;
  problems?: string[];
  warnings?: string[];
  inbox?: number;
  /** Inbox entries marked `Scope: universal` — lessons the kit has not received yet. */
  universal?: number;
  outbox?: number;
  /** Files `update` would add, change or remove — non-zero even when the version matches. */
  drift?: number;
}

export interface UninstallOptions {
  dryRun?: boolean;
}

export interface UninstallResult {
  removed: string[];
  kept: string[];
}

export interface HarvestOptions {
  from?: string[];
  dryRun?: boolean;
}

export interface HarvestResult {
  harvested: number;
  /** Universal lessons still in a project's inbox: the retro that exports them has not run. */
  waiting?: number;
}

export interface NewSkillOptions {
  group?: string;
  summary?: string;
}

/** Manifest fields read by status/uninstall. Everything else stays free-form. */
export interface CommandManifest extends KitManifest {
  files?: Record<string, string>;
  links?: Record<string, unknown>;
  blocks?: string[];
  created?: Record<string, string>;
  selection?: { profile?: string; skills?: string[]; hooks?: boolean; gitHooks?: boolean; mode?: string; targets?: string[]; roles?: string[] };
  settings?: { removedByUser?: string[]; added?: AddedRecord };
  agentHooks?: Record<string, { added: string[]; removed: string[] }>;
  kit?: { version?: string; source?: string };
}

/** Shape of the sdlc config as read by status. */
export interface SdlcConfigValue {
  gates?: unknown;
  _provisional?: unknown;
  branching?: { model?: string; production?: string; integration?: string };
}

const isLink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

/** The entries in a project's learnings inbox, and those its author marked universal. */
export function inboxLessons(target: string): { entries: number; universal: number; oldestUniversal: string | null } {
  const text = readText(join(homeDir(target, 'learnings'), 'inbox.md')) ?? '';
  const entries = text.split(/^(?=## \d{4}-\d{2}-\d{2})/m).filter((e) => /^## \d{4}-\d{2}-\d{2}/.test(e));
  const universal = entries.filter((e) => /\*\*Scope:\*\*\s*universal\b/i.test(e));
  return { entries: entries.length, universal: universal.length, oldestUniversal: universal[0]?.slice(3, 13) ?? null };
}

export function status(targetArg: string | null | undefined, { quiet = false }: StatusOptions = {}): StatusResult {
  const target: string = resolve(targetArg ?? '.');
  const m = readManifest(target) as CommandManifest | null;
  if (!m) {
    if (!quiet) say(`${c.yellow('not installed')}  ${target}`);
    return { ok: false, installed: false };
  }
  const problems: string[] = [];
  const warnings: string[] = [];
  const modified: string[] = [];
  const missing: string[] = [];
  for (const [rel, h] of Object.entries(m.files ?? {})) {
    const cur = hashFile(join(target, rel));
    if (cur === null) missing.push(rel);
    else if (cur !== h) modified.push(rel);
  }
  if (missing.length) problems.push(`${missing.length} kit file(s) missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''} — run update to restore`);
  if (modified.length) warnings.push(`${modified.length} kit file(s) modified locally: ${modified.slice(0, 5).join(', ')}${modified.length > 5 ? ' …' : ''} — move project-specific changes to .agents/overlays/, or export universal ones with /self-improve`);

  const kitNew = [HOME_REL, '.claude', '.codex'].flatMap((d) => listFiles(join(target, d)).filter((f) => f.endsWith('.kit-new')).map((f) => `${d}/${f}`));
  if (kitNew.length) warnings.push(`${kitNew.length} pending .kit-new file(s) to merge: ${kitNew.slice(0, 5).join(', ')}`);

  const targets: string[] = m.selection?.targets ?? ['claude', 'agents']; // 1.x manifests may predate the field
  const links = Object.keys(m.links ?? {});
  const missingLinks = links.filter((rel) => !isLink(join(target, rel)) || !existsSync(join(target, rel)));
  if (missingLinks.length) warnings.push(`${missingLinks.length} of ${links.length} link(s) for Claude Code missing in this clone — run: node .agents/hooks/setup-clone.mjs`);

  const sj = readJsonFile(join(target, '.claude', 'settings.json'));
  if (sj.error) problems.push(`.claude/settings.json is not valid JSON: ${sj.error}`);
  else if (m.selection?.hooks !== false && targets.includes('claude')) {
    const wired: Map<string, Set<string>> = wiredScripts((sj.value ?? {}) as Record<string, unknown>);
    for (const s of m.selection?.mode === 'measure' ? ['session-eval.mjs'] : kitHookScripts()) {
      if (!wired.has(s)) warnings.push(`hook ${s} is not wired in .claude/settings.json${(m.settings?.removedByUser ?? []).length ? ' (removed on purpose?)' : ''}`);
    }
  }

  const major = Number.parseInt(process.versions.node, 10);
  if (major < 18) problems.push(`Node ${process.versions.node} is too old for the hooks (need 18+)`);

  const cfgPath: string | null = sdlcConfigPath(target);
  const cfg = cfgPath ? readJsonFile(cfgPath) : null;
  let sdlc = 'missing — run /sdlc-init';
  if (cfg?.error) problems.push(`sdlc.config.json is not valid JSON: ${cfg.error}`);
  else if (cfg?.value) {
    const v = cfg.value as SdlcConfigValue;
    const gates = Array.isArray(v.gates) ? v.gates.length : 0;
    sdlc = `${v._provisional ? c.yellow('provisional') : 'verified'} · ${v.branching?.model ?? '?'} (${[v.branching?.production, v.branching?.integration].filter(Boolean).join('/')}) · ${gates} gate(s)`;
    if (v._provisional) warnings.push('sdlc.config.json is provisional — run /sdlc-init');
  }

  const lessons = inboxLessons(target);
  const inbox = lessons.entries;
  if (lessons.universal) {
    warnings.push(`${lessons.universal} universal lesson(s) waiting in the learnings inbox since ${lessons.oldestUniversal} — run /self-improve retro in the project to export them to the kit`);
  }
  let outbox = 0;
  try {
    outbox = readdirSync(join(homeDir(target, 'learnings'), 'outbox')).filter((f) => f.endsWith('.md')).length;
  } catch {
    // none
  }
  let overlays: string[] = [];
  try {
    overlays = readdirSync(homeDir(target, 'overlays')).filter((f) => f.endsWith('.md') && f !== 'README.md');
  } catch {
    // none
  }

  // The git-hooks layer is retired; a clone that still runs its hooks gets them removed by setup-clone.
  const hooksPath = git(target, 'config', '--get', 'core.hooksPath');
  if (hooksPath && /\/agent-setup\/hooks\/?$/.test(hooksPath.replace(/\\/g, '/'))) {
    warnings.push('the retired agent-setup git hooks are still active in this clone — run: node .agents/hooks/setup-clone.mjs');
  }

  // harvest, update --all and evals reach only the projects in this kit's registry.
  const source: string = m.kit?.source ?? '';
  if (source && source.toLowerCase() !== kitSource().toLowerCase()) {
    warnings.push(`installed from another copy of the kit (${source}) — run update from this one to move it here; until then its proposals and session metrics reach only that copy`);
  } else if (!listProjects().some((p) => p.path.toLowerCase() === toPosix(target).toLowerCase())) {
    warnings.push("not in this kit's project registry, so harvest, update --all and evals skip it — run update once to register it");
  }

  // The version string alone says "current" for an install from an older build of the same
  // version; a dry-run update counts what would really change.
  let drift = 0;
  try {
    const { log } = sync(target, { mode: 'update', dryRun: true, quiet: true });
    drift = log.added.length + log.updated.length + log.upgraded.length + log.removed.length;
  } catch {
    // status reports what it can; update itself reports this error
  }
  const versionBehind: boolean = m.kit?.version !== kitVersion();
  const outdated: boolean = versionBehind || drift > 0;
  if (!quiet) {
    say('', `${c.bold('agent-setup status')}  ${c.dim(target)}`);
    const versionNote: string = versionBehind
      ? c.yellow(`  (kit is ${kitVersion()} — run update)`)
      : drift
        ? c.yellow(`  (same version, but update would change ${drift} file(s))`)
        : c.green('  (current)');
    say(`  version     ${m.kit?.version}${versionNote}`);
    say(`  selection   roles ${(m.selection?.roles ?? ['developer', 'admin']).join(', ')} · profile ${m.selection?.profile}${(m.selection?.skills ?? []).length ? ` + ${m.selection?.skills?.join(', ')}` : ''} · ${Object.keys(m.files ?? {}).length} kit files · targets ${targets.join(', ')}${links.length ? ` · ${links.length} link(s) for Claude Code` : ''}`);
    say(`  sdlc        ${sdlc}`);
    say(`  learnings   ${inbox} in inbox${lessons.universal ? ` (${lessons.universal} universal)` : ''} · ${outbox} proposal(s) in outbox${outbox ? ' — run `agent-setup harvest`' : ''}`);
    const claudeHooks: string = !targets.includes('claude') ? 'not targeted' : m.selection?.hooks === false ? 'off' : 'on';
    say(
      `  enforcement Claude Code hooks: ${claudeHooks} — ${claudeHooks === 'on' ? 'agents other than Claude Code are' : 'every agent is'} bound by AGENTS.md alone; protect the production branch on the git host for everyone`,
    );
    say(`  overlays    ${overlays.join(', ') || '—'}`);
    for (const p of problems) say(`  ${c.red('problem')}     ${p}`);
    for (const w of warnings) say(`  ${c.yellow('warning')}     ${w}`);
    if (!problems.length && !warnings.length) say(`  ${c.green('healthy')}`);
    say('');
  }
  return { ok: problems.length === 0, installed: true, outdated, problems, warnings, inbox, universal: lessons.universal, outbox, drift };
}

// ---------------------------------------------------------------------------
// uninstall
// ---------------------------------------------------------------------------

export function uninstall(targetArg: string | null | undefined, { dryRun = false }: UninstallOptions = {}): UninstallResult {
  const target: string = resolve(targetArg ?? '.');
  const m = readManifest(target) as CommandManifest | null;
  if (!m) throw new CliError(`agent-setup is not installed in ${target}`);
  const removed: string[] = [];
  const kept: string[] = [];
  const act = (fn: () => void): void => {
    if (!dryRun) fn();
  };

  // Links are per clone; remove them while the setup script still exists (it also clears the
  // git hooks an install before 3.0 could add).
  const setupClone = [join(target, HOME_REL, 'hooks', 'setup-clone.mjs'), join(target, '.claude', 'hooks', 'setup-clone.mjs')].find(existsSync) ?? '';
  if (setupClone) {
    act(() => spawnSync(process.execPath, [setupClone, '--uninstall', '--quiet'], { cwd: target }));
    removed.push('per-clone links');
  }

  for (const [rel, h] of Object.entries(m.files ?? {})) {
    const abs = join(target, rel);
    const cur = hashFile(abs);
    if (cur === null) continue;
    if (cur === h) {
      act(() => {
        rmSync(abs, { force: true });
        pruneEmptyDirs(join(abs, '..'), target);
      });
      removed.push(rel);
    } else kept.push(rel);
  }

  for (const rel of m.blocks ?? []) {
    const abs = join(target, rel);
    const text = readText(abs);
    if (text === null) continue;
    const markers = rel === '.gitignore' ? HASH : MD;
    const next = removeBlock(text, markers);
    const createdHash = m.created?.[rel];
    if (createdHash && hashText(text) === createdHash) {
      act(() => rmSync(abs, { force: true }));
      removed.push(rel);
    } else if (next !== text) {
      act(() => (next.trim() ? writeText(abs, next) : rmSync(abs, { force: true })));
      removed.push(`${rel} (managed block)`);
    }
  }

  const settingsAbs = join(target, '.claude', 'settings.json');
  const sj = readJsonFile(settingsAbs);
  if (sj.value) {
    const next: Record<string, unknown> = unmergeSettings(sj.value as Record<string, unknown>, m.settings?.added);
    const keys = Object.keys(next).filter((k) => k !== '$schema');
    act(() => (keys.length ? writeJson(settingsAbs, next) : rmSync(settingsAbs, { force: true })));
    removed.push('.claude/settings.json (kit hooks and permissions)');
  }

  // Other agents' hook files: the kit's entries out, everything else kept; a file that held
  // only the kit's goes.
  for (const rel of Object.keys(m.agentHooks ?? {})) {
    const found = specForFile(rel);
    const abs = join(target, rel);
    const r = readJsonFile(abs);
    if (!found || !r.value) continue;
    const next = removeKitHooks(found[1], r.value as Record<string, unknown>);
    act(() => {
      if (isEmptyHookFile(found[1], next)) {
        rmSync(abs, { force: true });
        pruneEmptyDirs(join(abs, '..'), target);
      } else writeJson(abs, next);
    });
    removed.push(`${rel} (the kit's ${found[1].name} hooks)`);
  }

  act(() => {
    rmSync(join(target, MANIFEST_REL), { force: true });
    rmSync(join(target, LEGACY_MANIFEST_REL), { force: true });
    pruneEmptyDirs(join(target, HOME_REL), target);
    unregisterProject(target);
  });

  say('', `${c.bold('agent-setup uninstall')}  ${c.dim(target)}${dryRun ? c.yellow('  (dry run)') : ''}`);
  say(`  ${c.green('removed')}  ${removed.length} item(s)`);
  for (const k of kept) say(`  ${c.yellow('kept')}     ${k} — modified locally`);
  say(`  ${c.dim('left')}     project-owned: .agents/learnings/, .agents/overlays/*.md, .agents/sdlc.config.json, .agents/docs/ — delete by hand if unwanted`, '');
  return { removed, kept };
}

// ---------------------------------------------------------------------------
// harvest — pull kit-improvement proposals out of project outboxes
// ---------------------------------------------------------------------------

export function harvest({ from = [], dryRun = false }: HarvestOptions = {}): HarvestResult {
  const projects: ProjectEntry[] = from.length ? from.map((p) => ({ path: toPosix(resolve(p)) })) : listProjects();
  if (!projects.length) {
    say('No registered projects. Install into one first, or pass --from <project>.');
    return { harvested: 0 };
  }
  let harvested = 0;
  let waiting = 0;
  const stuck: string[] = [];
  mkdirSync(INBOX_DIR, { recursive: true });
  for (const p of projects) {
    const { universal, oldestUniversal } = inboxLessons(p.path);
    waiting += universal;
    if (universal) stuck.push(`  ${c.yellow('waiting')} ${basename(p.path)}: ${universal} universal lesson(s) in its inbox since ${oldestUniversal} — run /self-improve retro there to export them`);
    const outbox = join(homeDir(p.path, 'learnings'), 'outbox');
    if (!isDir(outbox)) continue;
    const files = readdirSync(outbox).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
    if (!files.length) continue;
    const project = basename(p.path);
    for (const f of files) {
      const dest = join(INBOX_DIR, `${today()}--${project}--${f}`);
      if (!dryRun) {
        const text = readText(join(outbox, f)) ?? '';
        writeText(dest, `<!-- harvested ${new Date().toISOString()} from ${p.path} -->\n${text}`);
        mkdirSync(join(outbox, 'harvested'), { recursive: true });
        renameSync(join(outbox, f), join(outbox, 'harvested', f));
      }
      harvested++;
      say(`  ${c.green('+')} ${project}: ${f}`);
    }
  }
  say('', harvested ? `${harvested} proposal(s) now in ${toPosix(relative(process.cwd(), INBOX_DIR)) || 'inbox'}/. Triage them with docs/maintaining/harvest.md, with any agent or by hand.` : 'Nothing to harvest — every outbox is empty.', '');
  if (stuck.length) say(...stuck, '');
  return { harvested, waiting };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export function list(): void {
  const catalog: Catalog = loadCatalog();
  const vendored: Set<string> = vendoredSkills();
  const present: Set<string> = new Set(skillDirs() as string[]);
  say('', c.bold(`agent-setup ${kitVersion()}`), '');
  for (const [role, description] of Object.entries(catalog.roles ?? {})) say(`${c.bold(`role ${role}`)}  ${c.dim(description)}`);
  say('');
  for (const [group, description] of Object.entries(catalog.groups ?? {})) {
    say(`${c.bold(`@${group}`)}  ${c.dim(description)}`);
    for (const s of (groupSkills(catalog, group) as string[]).filter((n) => present.has(n))) {
      say(`  ${s.padEnd(27)} ${vendored.has(s) ? c.dim('vendored') : c.dim('own     ')} ${skillSummary(catalog, s)}`);
    }
    say('');
  }
  say(c.bold('Agents'));
  for (const [a, e] of agentIndex()) say(`  ${a.padEnd(27)} ${c.dim(e.role.padEnd(9))} ${c.dim(String(catalog.agents?.[a]?.tier ?? '—').padEnd(9))} ${catalog.agents?.[a]?.summary ?? ''}`);
  say('', c.bold('Hooks'));
  for (const [h, meta] of Object.entries(catalog.hooks ?? {})) say(`  ${h.padEnd(27)} ${c.dim(String(meta.role).padEnd(9))} ${meta.summary ?? ''}`);
  say('', `${c.bold('Profiles')}  ${c.dim(`(default: ${catalog.defaultProfile}; @core is always included, @admin with the admin role)`)}`);
  for (const [name, p] of Object.entries(catalog.profiles ?? {})) {
    say(`  ${name.padEnd(10)} ${p.description}  ${c.dim(p.skills === '*' ? 'everything' : (p.skills as string[]).join(', ') || 'core only')}`);
  }
  say('');
}

// ---------------------------------------------------------------------------
// new-skill — scaffold a skill that already meets the lint rules
// ---------------------------------------------------------------------------

export function newSkill(name: string, { group = 'domain', summary }: NewSkillOptions = {}): void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? '')) throw new CliError('skill names are lowercase-kebab-case, e.g. `data-pipelines`');
  const catalog: Catalog = loadCatalog();
  if (!catalog.groups?.[group]) throw new CliError(`unknown group "${group}". Groups: ${Object.keys(catalog.groups ?? {}).join(', ')}`);
  // The admin group is the admin role; everything else serves developers.
  const admin: boolean = group === 'admin';
  const dir = join(skillsDirOf(admin ? 'admin' : 'developer'), name);
  if (skillDirs().includes(name)) throw new CliError(`a kit skill named ${name} already exists`);

  writeText(
    join(dir, 'SKILL.md'),
    `---
name: ${name}
description: >
  TODO — what this skill does AND the situations that should trigger it, in the words a user
  would type. Name the file types, errors and phrasings. End with the near-misses it should
  NOT handle and which skill handles them instead. Use when … — this field is the only thing
  that decides whether the skill loads.
${admin ? 'disable-model-invocation: true\n' : ''}---

# ${name}

TODO: one paragraph — the job, and the boundary (what this skill will not do).

## Before you start

- Read \`.agents/overlays/${name}.md\` if it exists — this project's adaptation of the skill. It
  wins where the two disagree.

## The procedure

1. TODO — steps in the correct order. Name the real commands.

## The mistakes that matter

- **TODO — the mistake an agent actually makes here.** Why it is wrong, how to detect it, and
  what to do instead. This section is the reason the skill exists; if it is empty, the skill
  is restating the obvious and should be deleted.

## Done means

- TODO — checkable evidence, not "it looks right".
`,
  );
  writeJson(join(dir, 'evals', 'evals.json'), {
    skill_name: name,
    evals: [
      {
        id: 1,
        prompt: 'TODO: a realistic request that needs this skill',
        expected_output: 'TODO: what a good result contains',
        files: [],
        expectations: ['TODO: an objectively checkable statement about a good result'],
      },
    ],
  });
  writeJson(join(dir, 'evals', 'trigger.json'), [
    { query: 'TODO: a realistic request that SHOULD load this skill', should_trigger: true },
    { query: 'TODO: a near-miss that shares keywords but needs a different skill', should_trigger: false },
  ]);

  const line: string = summary ?? 'TODO: one line for the AGENTS.md skills table';
  const catalogPath: string = join(KIT_DIR, 'catalog.json');
  const inserted: string | null = insertCatalogSkill(readText(catalogPath) ?? '', name, group, line);
  if (inserted) writeText(catalogPath, inserted);
  else {
    catalog.skills![name] = { group, summary: line };
    writeJson(catalogPath, catalog);
  }
  say(`${c.green('created')} ${toPosix(relative(KIT_ROOT, dir))}/  (SKILL.md, evals/evals.json, evals/trigger.json) and its catalog entry (@${group})`);
  say('Fill in the TODOs, add it to the right profiles in kit/catalog.json, then run `agent-setup lint`. Guide: docs/AUTHORING.md');
}

/**
 * Add one skill line to kit/catalog.json's `skills`, after the last skill of its group,
 * keeping the file's one-line-per-entry layout (a re-serialised catalog is a 250-line diff).
 * Null when the layout is not the expected one: the caller falls back to rewriting it.
 */
export function insertCatalogSkill(text: string, name: string, group: string, summary: string): string | null {
  const lines: string[] = text.split('\n');
  const start: number = lines.findIndex((l) => /^\s*"skills":\s*\{\s*$/.test(l));
  if (start < 0) return null;
  let end: number = start + 1;
  while (end < lines.length && !/^\s*\},?\s*$/.test(lines[end])) end++;
  if (end >= lines.length) return null;
  const entries: number[] = [];
  for (let i = start + 1; i < end; i++) {
    if (!/^\s*"[^"]+":\s*\{.*\},?\s*$/.test(lines[i])) return null;
    entries.push(i);
  }
  if (!entries.length) return null;
  const same: number[] = entries.filter((i) => lines[i].includes(`"group": ${JSON.stringify(group)}`));
  const after: number = same.length ? same[same.length - 1] : entries[entries.length - 1];
  const indent: string = lines[after].match(/^\s*/)?.[0] ?? '    ';
  const entry: string = `${indent}${JSON.stringify(name)}: { "group": ${JSON.stringify(group)}, "summary": ${JSON.stringify(summary)} }`;
  if (after === entries[entries.length - 1]) {
    lines[after] = `${lines[after].replace(/\s+$/, '').replace(/,$/, '')},`;
    lines.splice(after + 1, 0, entry);
  } else lines.splice(after + 1, 0, `${entry},`);
  const out: string = lines.join('\n');
  try {
    JSON.parse(out);
  } catch {
    return null;
  }
  return out;
}
