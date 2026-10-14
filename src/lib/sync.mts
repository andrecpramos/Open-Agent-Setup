// install and update are one operation: make the project match the kit's desired
// state for its selection, without ever destroying something the project owns.
//
// The home is .agents/, which every agent can read: skills, hook scripts, licences, the
// contract, learnings, overlays, the knowledge base and the manifest. .claude/ exists only
// with the claude target: settings.json (the runtime hooks), the subagents, and links in
// .claude/skills to the one copy in .agents/skills.
//
// Ownership model (docs/ARCHITECTURE.md):
//   kit-owned      skills, agents, hooks, licences, the learnings/overlays READMEs, the
//                  developers' guide. Tracked by hash in .agents/agent-setup.json; replaced
//                  on update only while unmodified. A locally modified file is never
//                  overwritten — the new version is written beside it as <file>.kit-new.
//   project-owned  AGENTS.md, CLAUDE.md, GEMINI.md, .gitignore, sdlc.config.json,
//                  inbox.md, overlays, docs. Created once from templates if absent;
//                  after that the kit only rewrites its own managed block inside them.
//   per clone      Claude Code's .claude/skills links — not in git at all; recorded in the
//                  manifest and created by .agents/hooks/setup-clone.mjs.
//
// Roles (kit/developer/, kit/admin/): the developer role is always installed. The admin role
// adds the setup, audit and learning-loop skills (invoked by name only), the recorder and
// learning hooks, and the learnings folder; `--roles developer` leaves all of it out.
//
// Installs from before 2.0 kept everything in .claude/; `update` migrates them
// (migrateLegacy): the project's own files move, the kit's are re-laid.

import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { HOME_REL, KIT_DIR, KIT_ROOT, LEGACY_MANIFEST_REL, LICENSES_DIR, kitSource, kitVersion } from './paths.mjs';
import type { Role } from './paths.mjs';
import {
  CliError,
  c,
  copyFile,
  exists,
  hashFile,
  hashText,
  isDir,
  isSymlink,
  listFiles,
  pruneEmptyDirs,
  readJsonFile,
  readText,
  say,
  toPosix,
  writeText,
} from './util.mjs';
import { detectProject, suggestProfile } from './detect.mjs';
import type { DetectedProject } from './detect.mjs';
import { agentIndex, loadCatalog, parseRoles, resolveSelection, skillIndex } from './catalog.mjs';
import type { Catalog } from './catalog.mjs';
import { mergeSettings, unmergeSettings, signature, wiredScripts } from './settings.mjs';
import type { AddedRecord, HookGroup, HookHandler, MergeResult, SettingsFragment } from './settings.mjs';
import { MD, HASH, removeBlock, upsertBlock } from './blocks.mjs';
import { buildVars, provisionalConfig, render, template } from './render.mjs';
import { manifestLocation, readManifest, registerProject, writeManifest } from './state.mjs';
import type { KitManifest } from './state.mjs';
import { licenseFiles } from './vendor.mjs';
import { AGENT_HOOKS, HOOK_AGENTS, addKitHooks, isEmptyHookFile, isHookAgent, presentKeys, removeKitHooks, wantedKeys } from './agent-hooks.mjs';
import type { HookAgent } from './agent-hooks.mjs';
import { codexAgent, isTier, modelsFor } from './models.mjs';
import type { ModelTable } from '../kit/hooks/_usage.mjs';

export interface SyncOptions {
  mode?: string;
  force?: boolean;
  profile?: string;
  skills?: string[];
  exclude?: string[];
  targets?: string[];
  hooks?: boolean;
  /** Roles to install besides developer, which is always installed: admin. */
  roles?: string[];
  /** The model Claude Code sessions start on (`opusplan`, `sonnet`…); `none` leaves it to each person. */
  sessionModel?: string;
  /** Retired: the git-hooks layer was server-side branch protection rebuilt per clone. */
  gitHooks?: boolean;
  dryRun?: boolean;
  resetHooks?: boolean;
  sdlcConfig?: boolean;
  /** No report: a caller (status) only wants the returned log. Meant for dry runs. */
  quiet?: boolean;
  /** install: a preview a person will be asked to confirm (the CLI asks right after it). */
  interactive?: boolean;
  /** install: the confirmed run after a preview — say it is done and what comes next, nothing more. */
  brief?: boolean;
  /** Also print the file-level report (what was added, updated, removed). */
  verbose?: boolean;
  /** measure: only the session-eval recorder, as a baseline before the kit; full: the kit (default). */
  setup?: string;
  /** false: leave the project out of the registry (scratch projects the eval runner installs into). */
  register?: boolean;
}

/** Resolved install selection stored in the manifest. */
export interface SelectionOpts {
  /** measure (a baseline: only the session recorder) or full. */
  mode: 'measure' | 'full';
  profile: string;
  skills: string[];
  exclude: string[];
  targets: string[];
  hooks: boolean;
  roles: Role[];
  /** The model Claude Code sessions start on (settings.json `model`), or null to leave it to each person. */
  sessionModel?: string | null;
}

/** A previous (or new) selection as recorded in a manifest, with legacy packs. */
export interface ManifestSelection {
  mode?: string;
  profile?: string;
  skills?: string[];
  packs?: string[];
  exclude?: string[];
  targets?: string[];
  hooks?: boolean;
  roles?: string[];
  sessionModel?: string | null;
  /** Written by installs before 3.0; the layer is gone and setup-clone removes its hooks. */
  gitHooks?: boolean;
}

/** Manifest fields read and written by sync. Everything else stays free-form. */
export interface SyncManifest extends KitManifest {
  files?: Record<string, string>;
  links?: Record<string, string>;
  skipped?: { skills: string[]; agents: string[] };
  /** Other agents' hook files: the kit entries added (event|hook), and those the user removed. */
  agentHooks?: Record<string, { added: string[]; removed: string[] }>;
  created?: Record<string, string>;
  blocks?: string[];
  selection?: ManifestSelection;
  settings?: { added?: AddedRecord; removedByUser?: string[] };
  kit?: { name?: string; version?: string; source?: string };
  installedAt?: string;
  updatedAt?: string;
}

// Settings shapes (AddedRecord, MergeResult, SettingsFragment, HookGroup, HookHandler)
// come from ./settings.mjs — one definition, imported above.

/** A project's settings.json as far as sync cares. */
export interface ProjectSettings {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A resolved skill reference from the catalog. A type alias (not an interface) so selections carry an implicit index signature for buildVars. */
export type SkillRef = {
  name: string;
  dir: string;
  group?: string;
};

/** A resolved agent reference from the catalog. A type alias (not an interface) so selections carry an implicit index signature for buildVars. */
export type AgentRef = {
  name: string;
  file: string;
};

/** The resolved skill/agent selection sync installs. */
export interface Selection {
  profile: string;
  roles?: Role[];
  skills: SkillRef[];
  agents: AgentRef[];
}

/** The catalog shape sync reads: the shared Catalog. */
export type SyncCatalog = Catalog;

/** What project detection reports: the shared DetectedProject. */
export type DetectionInfo = DetectedProject;

/** One kit-owned file sync wants in the project: a copy of `src`, or `content` built from it. */
export interface DesiredFile {
  src: string;
  /** Written instead of copying `src`: a kit agent rendered in another tool's format. */
  content?: string;
  kind: string;
  unit?: string;
}

/** Per-category log of what sync did. */
export interface PlanLog {
  added: string[];
  updated: string[];
  restored: string[];
  adopted: string[];
  upgraded: string[];
  removed: string[];
  conflicts: string[];
  kept: string[];
  notes: string[];
}

export interface SyncResult {
  manifest: SyncManifest;
  log: PlanLog;
}

export interface ReportArgs {
  target: string;
  opts: SyncOptions;
  prev: SyncManifest | null;
  detection: DetectionInfo;
  selection: Selection;
  skipped: { skills: string[]; agents: string[] };
  plan: Plan;
  selOpts: SelectionOpts;
  catalog: SyncCatalog;
  /** The profile was chosen from what the project contains, not given. */
  profileDetected: boolean;
}

const HOME: string = HOME_REL;
const HOOK_DIR_REL: string = `${HOME}/hooks`;
const KIT_NOTICE_REL: string = `${HOME}/licenses/agent-setup.txt`;
// agents: AGENTS.md and the .agents/ home (always) · claude: Claude Code's hooks, subagents and
// skill links · gemini: GEMINI.md · codex, cursor, copilot, antigravity, windsurf: the kit's
// hooks in that agent's own hook file (agent-hooks.mts).
const TARGETS: string[] = ['agents', 'claude', 'gemini', ...HOOK_AGENTS];
// The project-owned folders and files a pre-2.0 install kept in .claude/.
const LEGACY_PROJECT_OWNED: string[] = ['sdlc.config.json', 'learnings', 'overlays', 'docs', 'decisions', 'handoffs'];
// Skill supporting files that stay in the kit: evals are for improving a skill, not
// for running it, and workspaces are scratch.
const SKILL_EXCLUDE = (rel: string): boolean => rel.startsWith('evals/') || rel.includes('-workspace/');

// A measure-only baseline installs the recorder and nothing that changes how the agent works.
const MEASURE_HOOKS: Set<string> = new Set(['_config.mjs', '_transcript.mjs', '_prompt.mjs', '_usage.mjs', 'session-eval.mjs', 'setup-clone.mjs']);
// The model tiers and prices, where the hooks and the agents read them.
const MODELS_REL: string = `${HOME}/models.json`;
/** What --session-model accepts: Claude Code's aliases and model ids, with an optional context tag. */
const SESSION_MODEL: RegExp = /^(opusplan|sonnet|opus|haiku|fable|best|claude-[a-z0-9-]+)(\[1m\])?$/;
/** Codex reads its custom agents from .codex/agents/<name>.toml. */
const codexAgentRel = (name: string): string => `.codex/agents/${name}.toml`;

/** The role a hook script serves (catalog `hooks`); shared modules (`_*.mjs`) serve every role. */
const hookRole = (catalog: Catalog, file: string): Role | null =>
  file.startsWith('_') ? null : (catalog.hooks?.[file.replace(/\.mjs$/, '')]?.role ?? 'developer');

/** Where the subagents live: Claude Code's folder with the claude target, the home otherwise (as procedures). */
const agentsDirRel = (targets: string[]): string => (targets.includes('claude') ? '.claude/agents' : `${HOME}/agents`);

function desiredFiles(
  selection: Selection,
  skipped: Set<string>,
  { hooks, mode, targets, roles }: { hooks?: boolean; mode?: string; targets: string[]; roles: Role[] },
  catalog: Catalog,
  table: ModelTable,
  codexSkipped: Set<string>,
): Map<string, DesiredFile> {
  const out = new Map<string, DesiredFile>();
  const claude: boolean = targets.includes('claude');
  // Agents other than Claude Code run the same hooks through run-hook.mjs.
  const others: boolean = targets.some(isHookAgent);
  // The tiers and prices: the recorder prices sessions with them, a baseline's included.
  out.set(MODELS_REL, { src: join(KIT_DIR, 'models.json'), kind: 'support' });
  if (mode === 'measure') {
    for (const f of MEASURE_HOOKS) out.set(`${HOOK_DIR_REL}/${f}`, { src: join(KIT_DIR, 'hooks', f), kind: 'hook', unit: f });
    out.set(`${HOME}/learnings/README.md`, { src: join(KIT_DIR, 'templates', 'learnings-README.md'), kind: 'support' });
    // The kit's own code is MIT: its notice travels with every copy (vendored skills carry theirs).
    out.set(KIT_NOTICE_REL, { src: join(KIT_ROOT, 'LICENSE'), kind: 'notice' });
    return out;
  }
  const licenses = licenseFiles() as Map<string, string>;
  for (const s of selection.skills) {
    if (skipped.has(s.name)) continue;
    for (const f of listFiles(s.dir)) {
      if (SKILL_EXCLUDE(f)) continue;
      out.set(`${HOME}/skills/${s.name}/${f}`, { src: join(s.dir, f), kind: 'skill', unit: s.name });
    }
    // Third-party content travels with its licence; one file per source, shared by its skills.
    const lic = licenses.get(s.name);
    if (lic) out.set(`${HOME}/${lic}`, { src: join(LICENSES_DIR, basename(lic)), kind: 'license' });
  }
  for (const a of selection.agents) {
    if (skipped.has(a.name)) continue;
    out.set(`${agentsDirRel(targets)}/${a.name}.md`, { src: a.file, kind: 'agent', unit: a.name });
    // Codex reads its own format: the same agent, on its tier's OpenAI model.
    const meta = catalog.agents?.[a.name];
    if (targets.includes('codex') && isTier(meta?.tier) && !codexSkipped.has(a.name)) {
      const content: string = codexAgent(a.name, a.file, meta.tier, { table, sandbox: meta.sandbox, version: kitVersion() });
      out.set(codexAgentRel(a.name), { src: a.file, content, kind: 'agent', unit: a.name });
    }
  }
  for (const f of listFiles(join(KIT_DIR, 'hooks'))) {
    if (!f.endsWith('.mjs') || f.includes('/')) continue;
    // setup-clone is always installed: it is the per-clone entry point for Claude Code's skill
    // links. The runtime hooks are the selected roles' ones, with the shared modules they import,
    // for every targeted agent that runs hooks; run-hook only when one is not Claude Code.
    const role = hookRole(catalog, f);
    const needed = f === 'setup-clone.mjs' || ((claude || others) && hooks && (role === null || roles.includes(role)) && (f !== 'run-hook.mjs' || others));
    if (needed) out.set(`${HOOK_DIR_REL}/${f}`, { src: join(KIT_DIR, 'hooks', f), kind: 'hook', unit: f });
  }
  // The learning loop is the admin's: lessons are captured where the work happens and routed
  // with the admin skills.
  if (roles.includes('admin')) out.set(`${HOME}/learnings/README.md`, { src: join(KIT_DIR, 'templates', 'learnings-README.md'), kind: 'support' });
  out.set(KIT_NOTICE_REL, { src: join(KIT_ROOT, 'LICENSE'), kind: 'notice' });
  out.set(`${HOME}/overlays/README.md`, { src: join(KIT_DIR, 'templates', 'overlays-README.md'), kind: 'support' });
  out.set(`${HOME}/WORKFLOW.md`, { src: join(KIT_DIR, 'templates', 'workflow-guide.md'), kind: 'support' });
  // What this folder is, for whoever opens it: every part, who edits it, how to remove it all.
  out.set(`${HOME}/README.md`, { src: join(KIT_DIR, 'templates', 'agents-README.md'), kind: 'support' });
  return out;
}

/**
 * A pre-2.0 install kept everything in .claude/. Unlink its old .agents/ links (they pointed
 * into .claude/), move the project's own files to the home — never over one that exists —
 * and return the previous file record with the moved kit files at their new paths, so the
 * reconcile below sees a 2.0 project: kit files left in .claude/ are removed while
 * unmodified and kept (reported) otherwise.
 */
function migrateLegacy(plan: Plan, prev: SyncManifest): Record<string, string | undefined> {
  for (const rel of Object.keys(prev.links ?? {})) {
    if (isSymlink(plan.abs(rel)) && !plan.dryRun) unlinkSync(plan.abs(rel));
  }
  const moved: string[] = [];
  for (const name of LEGACY_PROJECT_OWNED) {
    const from: string = `.claude/${name}`;
    const to: string = `${HOME}/${name}`;
    if (!exists(plan.abs(from))) continue;
    if (exists(plan.abs(to))) {
      plan.log.notes.push(`${from} stays where it is: ${to} already exists — merge the two by hand`);
      continue;
    }
    if (!plan.dryRun) {
      try {
        mkdirSync(dirname(plan.abs(to)), { recursive: true });
        renameSync(plan.abs(from), plan.abs(to));
      } catch (err) {
        plan.log.notes.push(`could not move ${from} to ${to} (${(err as Error).message.split('\n')[0]}) — close what holds it open and run update again`);
        continue;
      }
    }
    moved.push(name);
  }
  if (moved.length) plan.log.notes.push(`moved to the ${HOME}/ home: ${moved.map((n) => `.claude/${n}`).join(', ')}`);
  const files: Record<string, string | undefined> = {};
  for (const [rel, h] of Object.entries(prev.files ?? {})) {
    const m = rel.match(/^\.claude\/(learnings|overlays)\/(.*)$/);
    files[m && moved.includes(m[1]) ? `${HOME}/${m[1]}/${m[2]}` : rel] = h;
  }
  return files;
}

class Plan {
  target: string;
  dryRun: boolean;
  log: PlanLog;
  constructor(target: string, dryRun: boolean) {
    this.target = target;
    this.dryRun = dryRun;
    this.log = { added: [], updated: [], restored: [], adopted: [], upgraded: [], removed: [], conflicts: [], kept: [], notes: [] };
  }
  abs(rel: string): string {
    return join(this.target, rel);
  }
  copy(rel: string, src: string): void {
    if (!this.dryRun) copyFile(src, this.abs(rel));
  }
  write(rel: string, text: string): void {
    if (!this.dryRun) writeText(this.abs(rel), text);
  }
  remove(rel: string): void {
    if (this.dryRun) return;
    rmSync(this.abs(rel), { force: true });
    pruneEmptyDirs(dirname(this.abs(rel)), this.target);
  }
}

export function sync(targetArg: string | null | undefined, opts: SyncOptions): SyncResult {
  const target: string = resolve(targetArg ?? '.');
  if (!isDir(target)) throw new CliError(`target is not a directory: ${target}`);
  if (resolve(target).toLowerCase() === resolve(join(KIT_DIR, '..')).toLowerCase()) {
    throw new CliError('refusing to install the kit into itself.');
  }

  const prev = readManifest(target) as SyncManifest | null;
  const legacy: boolean = manifestLocation(target) === 'legacy';
  if (opts.mode === 'install' && prev && !opts.force) {
    throw new CliError(`already installed here (v${prev.kit?.version}). Use: agent-setup update "${target}"`);
  }
  if (opts.mode === 'update' && !prev) throw new CliError(`agent-setup is not installed in ${target}. Use: agent-setup install "${target}"`);

  if (opts.gitHooks) {
    throw new CliError(
      '--git-hooks is gone: it rebuilt server-side branch protection in every clone. Protect the production branch on your git host (required pull requests and checks); in Claude Code sessions guard-git still denies production writes.',
    );
  }
  const catalog = loadCatalog() as SyncCatalog;
  const detection = detectProject(target) as DetectionInfo;
  const was: ManifestSelection = prev?.selection ?? {};
  // A manifest written by an older kit may name skills or groups the kit no longer has: drop
  // them, and say so.
  const skillsNow = skillIndex();
  const agentsNow = agentIndex();
  const known = (x: string): boolean => {
    const item: string = x.split(':').pop() ?? x;
    return item.startsWith('@') ? Boolean(catalog.groups?.[item.slice(1)]) : skillsNow.has(item) || agentsNow.has(item);
  };
  const retired: string[] = [...(was.skills ?? []), ...(was.exclude ?? [])].filter((x) => !known(x));
  const wasSkills: string[] = (was.skills ?? []).filter(known);
  const wasExclude: string[] = (was.exclude ?? []).filter(known);
  const mode: 'measure' | 'full' = opts.setup === 'measure' || opts.setup === 'full' ? opts.setup : was.mode === 'measure' ? 'measure' : 'full';
  if (opts.setup !== undefined && opts.setup !== 'measure' && opts.setup !== 'full') throw new CliError(`--setup must be measure or full, not "${opts.setup}"`);
  if (mode === 'measure' && prev && was.mode !== 'measure') {
    throw new CliError('the full kit is installed here; a measure-only baseline is taken before it. Uninstall first to measure without it.');
  }
  // A first install with no --profile takes the one that fits what the project contains; the
  // report says so, and --profile overrides it. Later updates keep what the manifest recorded.
  const profileDetected: boolean = !opts.profile && !was.profile && !prev;
  const selOpts: SelectionOpts = {
    mode,
    profile: opts.profile ?? was.profile ?? (profileDetected ? suggestProfile(detection) : catalog.defaultProfile) ?? 'standard',
    // A manifest from before the packs merged into the kit may list the design pack.
    skills: opts.skills?.length ? opts.skills : [...wasSkills, ...((was.packs ?? []).includes('frontend-kit') ? ['@design'] : [])],
    exclude: opts.exclude?.length ? opts.exclude : wasExclude,
    // Claude Code only where the project shows it; the report says how to add it.
    // Every agent the project already shows; the report says how to add another.
    targets: [...(opts.targets?.length ? opts.targets : (was.targets ?? ['agents', ...(detection.usesClaude ? ['claude'] : []), ...detection.agents]))],
    hooks: opts.hooks ?? was.hooks ?? true,
    // Developer is always installed; an install that never chose kept both roles.
    roles: parseRoles(['developer', ...(opts.roles?.length ? opts.roles : (was.roles ?? ['admin']))]),
    sessionModel: opts.sessionModel === 'none' ? null : (opts.sessionModel ?? was.sessionModel ?? null),
  };
  if (selOpts.sessionModel && !SESSION_MODEL.test(selOpts.sessionModel)) {
    throw new CliError(`--session-model must be a Claude Code model: opusplan, sonnet, opus, haiku, fable, best, a claude-* id, or none — not "${selOpts.sessionModel}"`);
  }
  const L0: string[] = [];
  for (const t of selOpts.targets) if (!TARGETS.includes(t)) throw new CliError(`unknown target "${t}" (use ${TARGETS.join(', ')})`);
  if (!selOpts.targets.includes('agents')) selOpts.targets.unshift('agents'); // .agents/ holds the one real copy
  // The baseline recorder reads Claude Code sessions: measuring needs its hook wiring.
  if (mode === 'measure' && !selOpts.targets.includes('claude')) selOpts.targets.push('claude');
  const claude: boolean = selOpts.targets.includes('claude');

  const resolved = resolveSelection(catalog, selOpts) as Selection;
  if (retired.length && !opts.skills?.length) L0.push(`no longer in the kit, dropped from the selection: ${retired.join(', ')}`);
  if (was.gitHooks) L0.push('the git-hooks layer is retired (protect the production branch on your git host instead): setup-clone removes its hooks from each clone');
  const selection: Selection = mode === 'measure' ? { ...resolved, skills: [], agents: [] } : resolved;
  const plan = new Plan(target, Boolean(opts.dryRun));
  const L = plan.log;
  L.notes.push(...L0);
  const prevFiles: Record<string, string | undefined> = legacy && prev ? migrateLegacy(plan, prev) : (prev?.files ?? {});
  const nextFiles: Record<string, string> = {};

  // --- Collisions: a skill or agent of the same name that the project owns ---
  const skipped: { skills: string[]; agents: string[] } = { skills: [], agents: [] };
  const theirs = (rel: string, src: string): boolean => exists(plan.abs(rel)) && !(rel in prevFiles) && hashFile(plan.abs(rel)) !== hashFile(src);
  for (const s of selection.skills) {
    // A project's own skill of that name — in the home, or a real folder (not our link) in
    // Claude Code's — wins.
    const claudeOwn: boolean = claude && !isSymlink(plan.abs(`.claude/skills/${s.name}`)) && theirs(`.claude/skills/${s.name}/SKILL.md`, join(s.dir, 'SKILL.md'));
    if (theirs(`${HOME}/skills/${s.name}/SKILL.md`, join(s.dir, 'SKILL.md')) || claudeOwn) skipped.skills.push(s.name);
  }
  for (const a of selection.agents) {
    if (theirs(`${agentsDirRel(selOpts.targets)}/${a.name}.md`, a.file)) skipped.agents.push(a.name);
  }
  const skippedSet: Set<string> = new Set([...skipped.skills, ...skipped.agents]);

  // --- Hooks: a locally modified _config.mjs would break every other hook ---
  // A project's own Codex agent of the same name wins over the kit's rendering of it.
  const table: ModelTable = modelsFor(target);
  const codexSkipped: Set<string> = new Set();
  if (selOpts.targets.includes('codex')) {
    for (const a of selection.agents) {
      const rel: string = codexAgentRel(a.name);
      if (!skippedSet.has(a.name) && exists(plan.abs(rel)) && !(rel in prevFiles)) codexSkipped.add(a.name);
    }
  }
  const desired = desiredFiles(selection, skippedSet, selOpts, catalog, table, codexSkipped);
  for (const a of codexSkipped) L.notes.push(`${codexAgentRel(a)} is the project's own: the kit's ${a} agent was not written for Codex`);
  let hooksBlocked: boolean = false;
  if (selOpts.hooks) {
    const rel = `${HOOK_DIR_REL}/_config.mjs`;
    const cur = hashFile(plan.abs(rel));
    const want = hashFile(join(KIT_DIR, 'hooks', '_config.mjs'));
    const recorded = prevFiles[rel];
    const ours: boolean = cur === null || cur === want || cur === recorded;
    if (!ours) {
      hooksBlocked = true;
      L.notes.push(`${rel} has local changes, so no hook was installed or updated (they all import it). Merge the .kit-new files, then run update again.`);
    }
  }

  // --- Kit-owned files ---
  for (const [rel, item] of desired) {
    const dest = plan.abs(rel);
    const cur = hashFile(dest);
    const want = (item.content !== undefined ? hashText(item.content) : hashFile(item.src)) as string;
    const recorded = prevFiles[rel];
    const put = (to: string): void => (item.content !== undefined ? plan.write(to, item.content) : plan.copy(to, item.src));

    if (item.kind === 'hook' && hooksBlocked && item.unit !== 'setup-clone.mjs') {
      if (cur !== want) {
        put(`${rel}.kit-new`);
        L.conflicts.push(rel);
      }
      if (recorded !== undefined) nextFiles[rel] = recorded;
      continue;
    }

    if (recorded !== undefined) {
      if (cur === null) {
        put(rel);
        L.restored.push(rel);
        nextFiles[rel] = want;
      } else if (cur === recorded) {
        if (want !== cur) {
          put(rel);
          L.updated.push(rel);
        }
        nextFiles[rel] = want;
      } else if (cur === want) {
        L.adopted.push(rel);
        nextFiles[rel] = want;
      } else {
        put(`${rel}.kit-new`);
        L.conflicts.push(rel);
        nextFiles[rel] = recorded;
      }
      continue;
    }

    if (cur === null) {
      put(rel);
      L.added.push(rel);
      nextFiles[rel] = want;
    } else if (cur === want) {
      L.adopted.push(rel);
      nextFiles[rel] = want;
    } else {
      put(`${rel}.kit-new`);
      L.conflicts.push(rel);
    }
  }

  // --- Files the kit no longer wants (including an old .agents/skills copy) ---
  for (const [rel, recorded] of Object.entries(prevFiles)) {
    if (desired.has(rel) || (nextFiles[rel] as string | undefined) !== undefined) continue;
    const cur = hashFile(plan.abs(rel));
    if (cur === null) continue;
    if (cur === recorded) {
      plan.remove(rel);
      L.removed.push(rel);
    } else L.kept.push(rel);
  }

  // Large selections — say so before they land in a repo.
  let bytes: number = 0;
  for (const [rel, item] of desired) {
    if (!rel.startsWith(`${HOME}/skills/`)) continue;
    try {
      bytes += statSync(item.src).size;
    } catch {
      // ignore
    }
  }
  if (bytes > 1_000_000) {
    L.notes.push(
      `the selected skills add ${(bytes / 1_048_576).toFixed(1)} MB to this repository — ` +
        'to use them without committing them, install them per user instead: `agent-setup export <dir>` then `npx skills add <dir> -g`, for any agent (see README)',
    );
  }

  // --- Claude Code's links to the one copy (recorded here, created per clone) ---
  // Claude Code reads project skills only from .claude/skills, and follows a linked skill
  // folder. The licences folder is linked too: vendored skills name their licence as
  // ../../licenses/<source>.txt, which must resolve from .claude/skills/<name> as well.
  const links: Record<string, string> = {};
  if (claude) {
    for (const s of selection.skills) if (!skippedSet.has(s.name)) links[`.claude/skills/${s.name}`] = `${HOME}/skills/${s.name}`;
    if ([...desired.values()].some((d) => d.kind === 'license')) links['.claude/licenses'] = `${HOME}/licenses`;
  }

  // --- settings.json ---
  const settingsRel = '.claude/settings.json';
  const sj = readJsonFile(plan.abs(settingsRel));
  if (sj.error) throw new CliError(`${settingsRel} is not valid JSON (${sj.error}). Fix it first — refusing to rewrite it.`);
  const fragment = readJsonFile(join(KIT_DIR, 'settings.fragment.json')).value as SettingsFragment;
  delete (fragment as Record<string, unknown>).$comment;
  if (!selOpts.hooks || hooksBlocked || !claude) fragment.hooks = {};
  if (!claude) fragment.permissions = { allow: [], ask: [], deny: [] };
  // Only the handlers of the selected roles' hooks (a baseline keeps its recorder below).
  if (mode === 'full') {
    const scriptOf = (h: HookHandler): string => ((h.args ?? []) as unknown[]).join(' ').match(/\.agents\/hooks\/([\w.-]+)/)?.[1] ?? '';
    for (const [event, groups] of Object.entries(fragment.hooks ?? {})) {
      (fragment.hooks as Record<string, HookGroup[]>)[event] = groups
        .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h: HookHandler) => {
          const role = hookRole(catalog, scriptOf(h));
          return role === null || selOpts.roles.includes(role);
        }) }))
        .filter((g) => g.hooks.length);
    }
  }
  if (mode === 'measure') {
    // Record windows silently; no permissions, no session-start line, nothing the agent sees.
    fragment.permissions = { allow: [], ask: [], deny: [] };
    const recorder = (groups: HookGroup[] | undefined): HookGroup[] =>
      (groups ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h: HookHandler) => /session-eval\.mjs/.test(JSON.stringify(h.args ?? []))) }));
    fragment.hooks = { PreCompact: recorder(fragment.hooks?.PreCompact), SessionEnd: recorder(fragment.hooks?.SessionEnd) };
  }
  const current: ProjectSettings = (sj.value ?? {}) as ProjectSettings;
  const prevAdded: AddedRecord = prev?.settings?.added ?? { hooks: [], permissions: { allow: [], ask: [], deny: [] } };
  // A handler we added that is no longer in settings was removed on purpose: respect it.
  // Keyed per event: the same script (learning-signals) serves several events, and
  // removing it from one must not be masked by its presence in another.
  const eventKey = (event: string, sig: string): string => `${event}|${sig}`;
  const presentSigs: Set<string> = new Set(
    Object.entries(current.hooks ?? {}).flatMap(([event, groups]) =>
      (Array.isArray(groups) ? groups : []).flatMap((g) => (g?.hooks ?? []).map((h: HookHandler) => eventKey(event, signature(h)))),
    ),
  );
  // A 1.x install wired the scripts from .claude/hooks/: a handler removed there stays removed here.
  const rehome = (k: string): string => (legacy ? k.split('/.claude/hooks/').join(`/${HOOK_DIR_REL}/`) : k);
  const removedByUser: Set<string> = new Set(opts.resetHooks ? [] : (prev?.settings?.removedByUser ?? []).map(rehome));
  if (!opts.resetHooks) {
    for (const h of prevAdded.hooks ?? []) if (!presentSigs.has(eventKey(h.event, h.signature))) removedByUser.add(rehome(eventKey(h.event, h.signature)));
    // The session model too: deleted by hand, it stays deleted — until someone names one again.
    if (prevAdded.model && (current as Record<string, unknown>).model === undefined) removedByUser.add('model');
  }
  if (opts.sessionModel) removedByUser.delete('model');
  if (claude && mode === 'full' && selOpts.sessionModel && !removedByUser.has('model')) fragment.model = selOpts.sessionModel;
  const base: ProjectSettings = unmergeSettings(current, prevAdded) as ProjectSettings;
  for (const [event, groups] of Object.entries(fragment.hooks ?? {})) {
    for (const g of groups) g.hooks = (g.hooks ?? []).filter((h) => !removedByUser.has(eventKey(event, signature(h))));
  }
  const merged: MergeResult = mergeSettings(base, fragment);
  L.notes.push(...merged.notes);
  const settingsText = `${JSON.stringify(merged.settings, null, 2)}\n`;
  const settingsNow: string = readText(plan.abs(settingsRel)) ?? '';
  const onlySchema: boolean = Object.keys(merged.settings).every((k) => k === '$schema');
  if (!claude && onlySchema) {
    // No Claude Code here: no settings file — and one that held only the kit's entries goes.
    if (settingsNow) {
      plan.remove(settingsRel);
      L.removed.push(`${settingsRel} (only the kit's hooks were in it)`);
    }
  } else if (settingsText !== settingsNow) {
    plan.write(settingsRel, settingsText);
    L.notes.push(`${settingsRel}: ${merged.added.hooks.length} hook handler(s) and ${Object.values(merged.added.permissions).flat().length} permission rule(s) managed by the kit`);
  }

  // --- Other agents' hook files: the kit's entries merged in, everything else left alone ---
  const agentHooks: Record<string, { added: string[]; removed: string[] }> = {};
  for (const agent of HOOK_AGENTS) {
    const spec = AGENT_HOOKS[agent];
    const on: boolean = mode === 'full' && selOpts.hooks && !hooksBlocked && selOpts.targets.includes(agent);
    const want: string[] = on ? wantedKeys(spec, selOpts.roles) : [];
    const cur = readJsonFile(plan.abs(spec.file));
    const before = prev?.agentHooks?.[spec.file] ?? { added: [], removed: [] };
    if (cur.error) {
      L.notes.push(`${spec.file} is not valid JSON, so ${spec.name}'s hooks were left as they are — fix it and run update again`);
      if (prev?.agentHooks?.[spec.file]) agentHooks[spec.file] = before;
      continue;
    }
    const existing = (cur.value ?? null) as Record<string, unknown> | null;
    const present: Set<string> = new Set(presentKeys(spec, existing));
    if (!want.length && !present.size) continue;
    // An entry the kit added that is gone now was removed on purpose: it stays removed.
    const removed: string[] = opts.resetHooks ? [] : [...new Set([...before.removed, ...before.added.filter((k) => !present.has(k))])].filter((k) => want.includes(k));
    const keys: string[] = want.filter((k) => !removed.includes(k));
    const next = addKitHooks(spec, agent, removeKitHooks(spec, existing), keys);
    const nowText: string | null = readText(plan.abs(spec.file));
    if (isEmptyHookFile(spec, next)) {
      if (nowText !== null) {
        plan.remove(spec.file);
        L.removed.push(`${spec.file} (only the kit's hooks were in it)`);
      }
    } else {
      const text = `${JSON.stringify(next, null, 2)}\n`;
      if (text !== nowText) {
        plan.write(spec.file, text);
        (nowText === null ? L.added : L.updated).push(`${spec.file}${nowText === null ? '' : ` (${spec.name} hooks)`}`);
      }
    }
    if (keys.length || removed.length) agentHooks[spec.file] = { added: keys, removed };
  }

  // --- Project-owned documents: create once, then only the managed block ---
  const agentSummaries: Record<string, string | undefined> = Object.fromEntries(Object.entries(catalog.agents ?? {}).map(([k, v]): [string, string | undefined] => [k, v.summary]));
  const vars = buildVars({
    detection,
    selection: {
      ...selection,
      skills: selection.skills.filter((s) => !skippedSet.has(s.name)),
      agents: selection.agents.filter((a) => !skippedSet.has(a.name)),
    },
    catalog,
    agentSummaries,
    targets: selOpts.targets,
    hooks: selOpts.hooks && !hooksBlocked,
    roles: selOpts.roles,
    models: table,
  });
  const created: Record<string, string> = { ...(prev?.created ?? {}) };
  const blocks: Set<string> = new Set(prev?.blocks ?? []);

  // A baseline writes no instructions: it measures how agents work without them.
  if (mode !== 'measure') {
    const agentsBlock: string = render(template('agents-block.md'), vars);
    const agentsText = readText(plan.abs('AGENTS.md'));
    if (agentsText === null) {
      const full: string = render(template('AGENTS.md'), { ...vars, KIT_BLOCK: agentsBlock.trimEnd() });
      plan.write('AGENTS.md', full);
      created['AGENTS.md'] = hashText(full);
      L.added.push('AGENTS.md');
    } else {
      const next: string = upsertBlock(agentsText, agentsBlock, MD);
      if (next !== agentsText) {
        plan.write('AGENTS.md', next);
        L.updated.push('AGENTS.md (managed block)');
      }
    }
    blocks.add('AGENTS.md');

    // Claude Code reads AGENTS.md by itself when there is no CLAUDE.md, so the kit never
    // creates one. Where the project has its own, Claude Code reads only that file: it gets
    // a block importing AGENTS.md. A CLAUDE.md that held nothing but our block goes.
    const claudeRel: string = exists(plan.abs('CLAUDE.md')) || !exists(plan.abs('.claude/CLAUDE.md')) ? 'CLAUDE.md' : '.claude/CLAUDE.md';
    const claudeText = readText(plan.abs(claudeRel));
    if (claudeText !== null && isSymlink(plan.abs(claudeRel))) {
      L.notes.push(`${claudeRel} is a symlink — left untouched (it already resolves to shared instructions).`);
    } else if (claudeText !== null) {
      const outside: string = removeBlock(claudeText, MD);
      const ours: boolean = claudeText.includes(MD.begin);
      if (ours && !outside.trim()) {
        plan.remove(claudeRel);
        delete created[claudeRel];
        blocks.delete(claudeRel);
        L.removed.push(`${claudeRel} (Claude Code reads AGENTS.md by itself)`);
      } else if (claude) {
        if (agentsText === null && outside.trim()) {
          L.notes.push(
            `${claudeRel} already holds project instructions that only Claude Code reads — /sdlc-init moves the tool-agnostic parts into AGENTS.md so every agent sees them`,
          );
        }
        const importLine = claudeRel === 'CLAUDE.md' ? '@AGENTS.md' : '@../AGENTS.md';
        const alreadyImports = /^\s*@(\.\.\/)?AGENTS\.md\s*$/m.test(outside);
        const block: string = render(template('claude-block.md'), { ...vars, AGENTS_IMPORT: alreadyImports ? '' : importLine }).replace(/\n{3,}/g, '\n\n');
        const next: string = upsertBlock(claudeText, block, MD);
        if (next !== claudeText) {
          plan.write(claudeRel, next);
          L.updated.push(`${claudeRel} (managed block)`);
        }
        blocks.add(claudeRel);
      } else if (ours) {
        plan.write(claudeRel, outside);
        blocks.delete(claudeRel);
        L.updated.push(`${claudeRel} (managed block removed: no Claude Code target)`);
      }
    }

    if (selOpts.targets.includes('gemini')) {
      const geminiBlock: string = render(template('gemini-block.md'), vars);
      const geminiText = readText(plan.abs('GEMINI.md'));
      if (geminiText === null) {
        const text = `${geminiBlock.trimEnd()}\n`;
        plan.write('GEMINI.md', text);
        created['GEMINI.md'] = hashText(text);
        L.added.push('GEMINI.md');
      } else if (!/^\s*@(\.\/)?AGENTS\.md\s*$/m.test(removeBlock(geminiText, MD)) || geminiText.includes(MD.begin)) {
        const next: string = upsertBlock(geminiText, geminiBlock, MD);
        if (next !== geminiText) {
          plan.write('GEMINI.md', next);
          L.updated.push('GEMINI.md (managed block)');
        }
      }
      blocks.add('GEMINI.md');
    }
  }

  if (detection.isGit) {
    const linkLines = Object.keys(links).length
      ? [`# Claude Code's links to the one copy in ${HOME}/ — per clone (node ${HOOK_DIR_REL}/setup-clone.mjs), never committed`, ...Object.keys(links)].join('\n')
      : '';
    const claudeLocal = claude ? ['# Claude Code: personal settings, instructions and agent memory', '.claude/settings.local.json', 'CLAUDE.local.md', '.claude/agent-memory-local/'].join('\n') : '';
    const gitignoreBlock: string = render(template('gitignore-block.txt'), { CLAUDE_LOCAL: claudeLocal, AGENT_LINKS: linkLines })
      .replace(/\n{2,}/g, '\n');
    const gi = readText(plan.abs('.gitignore')) ?? '';
    const next: string = upsertBlock(gi, gitignoreBlock, HASH);
    if (next !== gi) {
      plan.write('.gitignore', next);
      L.updated.push('.gitignore (managed block)');
    }
    blocks.add('.gitignore');
  }

  if (mode !== 'measure' && selOpts.roles.includes('admin') && !exists(plan.abs(`${HOME}/learnings/inbox.md`))) {
    plan.write(`${HOME}/learnings/inbox.md`, template('learnings-inbox.md'));
    L.added.push(`${HOME}/learnings/inbox.md`);
  }

  const hasSdlcConfig: boolean = [HOME, '.claude', '.ai'].some((d) => exists(plan.abs(`${d}/sdlc.config.json`)));
  if (mode !== 'measure' && !hasSdlcConfig && detection.isGit && selOpts.hooks && opts.sdlcConfig !== false) {
    plan.write(`${HOME}/sdlc.config.json`, `${JSON.stringify(provisionalConfig(detection), null, 2)}\n`);
    L.added.push(`${HOME}/sdlc.config.json (provisional)`);
  }

  // --- Manifest, registry, and the per-clone setup (links) ---
  const now = new Date().toISOString();
  const manifest: SyncManifest = {
    $comment:
      'Written by agent-setup. Lists the kit-owned files (by content hash) so `agent-setup update` and `uninstall` never touch anything this project changed or owns; `links` drive .agents/hooks/setup-clone.mjs. Do not edit by hand.',
    kit: { name: 'agent-setup', version: kitVersion(), source: kitSource() },
    installedAt: prev?.installedAt ?? now,
    updatedAt: now,
    selection: selOpts,
    files: nextFiles,
    links,
    skipped,
    created,
    blocks: [...blocks],
    settings: { added: merged.added, removedByUser: [...removedByUser] },
    ...(Object.keys(agentHooks).length ? { agentHooks } : {}),
  };
  if (!plan.dryRun) {
    writeManifest(target, manifest);
    if (legacy) plan.remove(LEGACY_MANIFEST_REL);
    if (opts.register !== false) registerProject(target, { version: kitVersion(), updatedAt: now });
    const r: SpawnSyncReturns<string> = spawnSync(process.execPath, [join(target, HOOK_DIR_REL, 'setup-clone.mjs')], { cwd: target, encoding: 'utf8' });
    for (const line of `${r.stdout ?? ''}${r.stderr ?? ''}`.split(/\r?\n/).filter(Boolean)) L.notes.push(line.replace(/^agent-setup: /, ''));
  } else if (Object.keys(links).length) {
    L.notes.push(`per clone: would create ${Object.keys(links).length} link(s) in .claude/`);
  }

  if (!opts.quiet) {
    const args: ReportArgs = { target, opts, prev, detection, selection, skipped, plan, selOpts, catalog, profileDetected };
    const plain: boolean = opts.mode === 'install' && mode === 'full';
    if (!plain || opts.verbose) report(args);
    if (plain) installReport(args);
  }
  return { manifest, log: L };
}

function report({ target, opts, prev, detection, selection, skipped, plan, selOpts, catalog }: ReportArgs): void {
  const L = plan.log;
  const verb: string = opts.mode === 'install' ? 'install' : `update ${prev?.kit?.version ?? '?'} →`;
  say('', `${c.bold(`agent-setup ${verb} ${kitVersion()}`)}  ${c.dim(target)}${plan.dryRun ? c.yellow('  (dry run — nothing written)') : ''}`, '');

  const git: string = detection.isGit ? `git (${[detection.production, detection.integration].filter(Boolean).join(' / ')})` : 'not a git repo';
  say(`  ${c.dim('Detected')}   ${detection.stack.join(', ') || 'no manifests'} · ${git}${detection.ci.length ? ` · CI: ${detection.ci.join(', ')}` : ' · no CI found'}`);
  const suggestion: string = suggestProfile(detection);
  say(
    `  ${c.dim('Selection')}  ${selOpts.mode === 'measure' ? `${c.bold('measure-only baseline')} · ` : ''}roles: ${selOpts.roles.join(', ')} · profile ${c.bold(selOpts.profile)}${suggestion !== selOpts.profile ? c.dim(` (detected fit: ${suggestion})`) : ''} · targets: ${selOpts.targets.join(', ')} · hooks: ${selOpts.hooks ? 'on' : 'off'}${selOpts.sessionModel ? ` · session model: ${selOpts.sessionModel}` : ''}`,
    '',
  );

  const installed: Set<string> = new Set(selection.skills.filter((s) => !skipped.skills.includes(s.name)).map((s) => s.name));
  for (const [group] of Object.entries(catalog.groups ?? {})) {
    const names = Object.keys(catalog.skills ?? {}).filter((n) => installed.has(n) && catalog.skills?.[n]?.group === group);
    if (names.length) say(`  ${c.green(group.padEnd(10))} ${names.join(', ')}`);
  }
  const installedAgents: string[] = selection.agents.map((a) => a.name).filter((n) => !skipped.agents.includes(n));
  if (selOpts.mode !== 'measure') say(`  ${c.green('agents'.padEnd(10))} ${installedAgents.join(', ') || '—'}`);
  if (selOpts.mode === 'measure') say(`  ${c.green('baseline'.padEnd(10))} measure-only: session-eval records each context window; no skills, agents, instructions or other hooks`);
  else if (selOpts.hooks && selOpts.targets.includes('claude')) {
    const wired: string[] = kitHookScripts().filter((f) => selOpts.roles.includes(hookRole(catalog, f) ?? 'developer'));
    say(`  ${c.green('hooks'.padEnd(10))} ${wired.map((f) => f.replace(/\.mjs$/, '')).join(', ')}`);
  }

  const line = (label: string, list: string[], color: (s: string) => string = c.dim): void => {
    if (list.length) say(`  ${color(label.padEnd(10))} ${list.length > 8 ? `${list.slice(0, 8).join(', ')} … (+${list.length - 8})` : list.join(', ')}`);
  };
  line('added', L.added.filter((r) => !r.startsWith(`${HOME}/skills/`)));
  line('updated', L.updated);
  line('restored', L.restored, c.yellow);
  line('upgraded', L.upgraded, c.cyan);
  line('removed', L.removed);
  for (const s of skipped.skills) say(`  ${c.yellow('skipped'.padEnd(10))} skill ${s} — the project already has its own skill of that name; yours was kept`);
  for (const a of skipped.agents) say(`  ${c.yellow('skipped'.padEnd(10))} agent ${a} — the project already has ${agentsDirRel(selOpts.targets)}/${a}.md; yours was kept`);
  for (const r of L.conflicts) say(`  ${c.red('conflict'.padEnd(10))} ${r} has local changes — kept; the kit's version is beside it as ${r.split('/').pop()}.kit-new`);
  for (const r of L.kept) say(`  ${c.yellow('kept'.padEnd(10))} ${r} — no longer part of the kit, but modified locally, so left in place`);
  for (const n of L.notes) say(`  ${c.dim('note'.padEnd(10))} ${n}`);

  if (!selOpts.targets.includes('claude') && selOpts.mode !== 'measure') {
    say(`  ${c.dim('claude'.padEnd(10))} not targeted — using Claude Code? \`agent-setup update "${target}" --targets agents,claude\` adds its hooks, subagents and skill links`);
  }

  say('');
  const switched: boolean = opts.mode === 'update' && prev?.selection?.mode === 'measure' && selOpts.mode === 'full';
  const claude: boolean = selOpts.targets.includes('claude');
  if (selOpts.mode === 'measure' && (opts.mode === 'install' || !prev)) {
    say(c.bold('Next'));
    say('  1. Restart Claude Code in the project so the recorder loads; nothing else changes for the team.');
    say('  2. Work as usual for about 20 context windows (a week or two of real work).');
    say(`  3. Then turn the kit on: agent-setup update "${target}" --setup full   (and run /sdlc-init)`);
    say(`  4. After about 20 more windows: agent-setup evals --project "${target}" compares the baseline with the kit.`);
  } else if (opts.mode === 'install' || switched) {
    say(c.bold('Next'));
    const steps: string[] = [];
    if (claude) steps.push('Restart Claude Code in the project (or open /hooks once) so the hooks load.');
    if (selOpts.roles.includes('admin')) {
      steps.push(
        `Run the sdlc-init skill (${claude ? '/sdlc-init in Claude Code' : `"follow ${HOME}/skills/sdlc-init/SKILL.md" in your agent`}) — it verifies the provisional\n     config against CI, fills in AGENTS.md, writes the knowledge base and the first overlays.`,
      );
    } else {
      steps.push('Developer role only: verify .agents/sdlc.config.json by hand (the branches, and the gates exactly as CI runs them), or add the admin role (`--roles developer,admin`) for /sdlc-init.');
    }
    steps.push(`Share ${HOME}/WORKFLOW.md with the team: how to ask, what the hooks do, the commands — one page.`);
    if (skipped.skills.length) steps.push(`For skipped skills: move the repo-specific parts of your own skill into ${HOME}/overlays/<skill>.md, delete it, and run update to get the kit version.`);
    steps.forEach((t, i) => say(`  ${i + 1}. ${t}`));
  } else if (L.conflicts.length) {
    say(c.bold('Next'), '  Merge each .kit-new file into its original (or delete the original to take the kit version), delete the .kit-new, and run update again.');
  }
  say('');
}

// Notes that only describe mechanics; the plain install report leaves them to --verbose.
const TECHNICAL_NOTE = /hook handler\(s\) and .* permission rule|link\(s\) created|link\(s\) in \.claude\/ already|per clone: would create|^skills for Claude Code/;

/**
 * The install report, in plain words: what this puts in the repository and why, that nothing
 * else changes, how to undo it, and what to do next. A preview (dry run) says "will add"; the
 * confirmed run after a preview (`brief`) only says it is done and what comes next.
 */
function installReport({ target, opts, detection, selection, skipped, plan, selOpts, catalog, profileDetected }: ReportArgs): void {
  const L = plan.log;
  const preview: boolean = plan.dryRun;
  const claude: boolean = selOpts.targets.includes('claude');
  const admin: boolean = selOpts.roles.includes('admin');
  // Catalog order: the domain skills first, the way AGENTS.md lists them.
  const order: string[] = Object.keys(catalog.skills ?? {});
  const skills: string[] = selection.skills.map((x) => x.name).filter((n) => !skipped.skills.includes(n)).sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const agents: string[] = selection.agents.map((a) => a.name).filter((n) => !skipped.agents.includes(n));
  // The other agents whose hook files this install wires, and every agent it serves, by name.
  const hookAgents: HookAgent[] = selOpts.hooks ? HOOK_AGENTS.filter((a) => selOpts.targets.includes(a)) : [];
  const named: string[] = [...(claude ? ['Claude Code'] : []), ...HOOK_AGENTS.filter((a) => selOpts.targets.includes(a)).map((a) => AGENT_HOOKS[a].name), ...(selOpts.targets.includes('gemini') ? ['Gemini CLI'] : [])];
  const hooks: string[] = (claude || hookAgents.length) && selOpts.hooks ? kitHookScripts().filter((f) => selOpts.roles.includes(hookRole(catalog, f) ?? 'developer')) : [];
  const runners: string = named.length === 1 ? named[0] : 'your agents';
  const kitCmd: string = `node "${toPosix(join(KIT_ROOT, 'bin', 'agent-setup.mjs'))}"`;
  const where: string = toPosix(target);
  const list = (names: string[], max: number): string => (names.length > max ? `${names.slice(0, max).join(', ')}…` : names.join(', '));
  const row = (path: string, what: string): void => say(`  ${c.bold(path.padEnd(22))} ${what}`);
  const sub = (path: string, what: string): void => say(`    ${path.padEnd(20)} ${c.dim(what)}`);
  const notes: string[] = L.notes.filter((n) => !TECHNICAL_NOTE.test(n));

  if (opts.brief) {
    say('', `  ${c.green('Installed.')} Undo at any time: ${kitCmd} uninstall "${where}"`);
  } else {
    say('', `${c.bold(`Agent_Setup ${kitVersion()} → ${basename(target)}`)}   ${preview ? c.yellow('preview — nothing is written yet') : c.green('installed')}`, '');
    const git: string = detection.isGit ? `git (${[detection.production, detection.integration].filter(Boolean).join(' / ')})` : 'not a git repository';
    say(`  Your project   ${detection.stack.join(', ') || 'no build files found'} · ${git}`);
    say(`  Agents         ${named.length ? named.join(', ') : 'none found — AGENTS.md and the skills work in any agent'}`);
    const what: string = String(catalog.profiles?.[selOpts.profile]?.description ?? selOpts.profile)
      .replace(/\.$/, '')
      .replace(/^./, (ch) => ch.toLowerCase());
    say(`  Setup          ${c.bold(selOpts.profile)} — ${what}${profileDetected ? c.dim('. Chosen from what the project contains; --profile changes it') : ''}`);
    if (!admin) say('  Role           developer only — no setup, audit or learning-loop tools');
    say('', `  ${preview ? 'It will add' : 'It added'}:`);
    row('AGENTS.md', L.added.includes('AGENTS.md') ? 'the instructions every coding agent reads (a new file)' : 'the instructions every coding agent reads — a block below your own text, which stays');
    const claudeMd: string | undefined = L.updated.find((u) => /^(\.claude\/)?CLAUDE\.md/.test(u));
    if (claudeMd) row(claudeMd.split(' ')[0], 'one line that makes Claude Code read AGENTS.md too');
    row('.agents/', 'the kit, in one folder (its README.md says what each part is):');
    sub('skills/', `${skills.length} playbooks the agent opens when the work matches — ${list(skills, 7)}`);
    if (hooks.length) sub('hooks/', `${hooks.length} small scripts ${runners} run${named.length === 1 ? 's' : ''}: they block risky git commands and check the work`);
    if (!claude && agents.length) sub('agents/', `${agents.length} reviewer checklists — ${list(agents, 6)}`);
    sub('WORKFLOW.md', 'one page for your team: how to ask, and what they will see');
    if (L.added.some((a) => a.startsWith(`${HOME}/sdlc.config.json`))) sub('sdlc.config.json', 'your branches and checks — a first guess until /sdlc-init confirms it');
    if (admin) sub('learnings/', 'where the agent notes lessons, for whoever maintains the setup');
    sub('overlays/', "this project's own rules for a skill (empty for now)");
    if (claude) {
      if (hooks.length) row('.claude/settings.json', `turns the hooks on in Claude Code (merged with what is there)${selOpts.sessionModel ? `, and starts sessions on ${selOpts.sessionModel}` : ''}`);
      if (agents.length) row('.claude/agents/', `${agents.length} helper agents — ${list(agents, 6)}`);
    }
    for (const a of hookAgents) {
      const spec = AGENT_HOOKS[a];
      const merged: boolean = L.updated.some((u) => u.startsWith(spec.file)) || (!preview && !L.added.includes(spec.file));
      row(spec.file, `turns on ${spec.covers} in ${spec.name}${merged ? ' (merged with what is there)' : ''}`);
    }
    if (L.updated.some((u) => u.startsWith('.gitignore'))) row('.gitignore', 'a few lines for files that stay on each machine');
    say('', '  Nothing else changes: no npm packages, nothing installed globally, none of your files overwritten.');
    for (const x of skipped.skills) say(`  ${c.yellow('Kept yours')}  your project already has a skill named ${x}; the kit's was left out`);
    for (const x of skipped.agents) say(`  ${c.yellow('Kept yours')}  your project already has an agent named ${x}; the kit's was left out`);
    for (const r of L.conflicts) say(`  ${c.yellow('Kept yours')}  ${r} already exists with other content; the kit's version is beside it as ${r.split('/').pop()}.kit-new`);
    for (const n of notes) say(`  ${c.dim('Note')}        ${n}`);
    const missing: string[] = ['claude', ...HOOK_AGENTS].filter((t) => !selOpts.targets.includes(t));
    if (missing.length) {
      const now: string = selOpts.targets.join(',');
      say(`  ${c.dim('Other agents')} ${named.length ? 'Someone on the team uses another one?' : 'Want the hooks too?'} Add it, e.g. --targets ${now},${missing[0]} (any of: ${missing.join(', ')})`);
    }
    say(`  Undo at any time: ${kitCmd} uninstall "${where}"`);
  }

  if (preview) {
    if (!opts.interactive) say('', '  Nothing was written. Run the same command without --dry-run to install.', '');
    else say('');
    return;
  }
  const steps: string[] = [];
  steps.push(
    claude
      ? 'Open the project in Claude Code (restart it if it is open): the hooks start with the session.'
      : `Open the project in ${named.length === 1 ? named[0] : 'your coding agent'}: it reads AGENTS.md and .agents/skills/ by itself.`,
  );
  for (const a of hookAgents) if (AGENT_HOOKS[a].trust) steps.push(AGENT_HOOKS[a].trust as string);
  // The session's own model is the largest share of the bill: worth one decision for the team.
  if (claude && !selOpts.sessionModel && selOpts.mode === 'full') {
    steps.push(`Optional, for the whole team: ${kitCmd} update "${where}" --session-model opusplan — sessions plan on Opus and build on Sonnet, while the helpers keep their own models.`);
  }
  if (admin) {
    steps.push(
      claude
        ? 'Type /sdlc-init. It reads your CI and branches, then fills in AGENTS.md and the checks (a few minutes).'
        : 'Ask it to "follow .agents/skills/sdlc-init/SKILL.md". It reads your CI and branches, then fills in AGENTS.md.',
    );
  } else {
    steps.push('Check .agents/sdlc.config.json: the branch names, and the exact commands your CI runs (developer role only: no /sdlc-init).');
  }
  steps.push('Look at what changed (git status), then commit it.');
  steps.push('Point your team to .agents/WORKFLOW.md. They install nothing.');
  if (skills.includes('agent-browser')) steps.push('For browser checks of UI work, once per machine: npm i -g agent-browser && agent-browser install');
  say('', c.bold('  Next'));
  steps.forEach((t, i) => say(`  ${i + 1}. ${t}`));
  say('');
}

/** The hook scripts the kit wires into settings.json, in the order the fragment lists them. */
export function kitHookScripts(): string[] {
  const fragment = readJsonFile(join(KIT_DIR, 'settings.fragment.json')).value as Record<string, unknown> | null;
  return [...wiredScripts(fragment as Parameters<typeof wiredScripts>[0]).keys()];
}
