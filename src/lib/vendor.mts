// Everything in the kit that comes from somewhere else, in one place.
//
//   kit/vendor.json       what is taken from where, and every local patch with its `why`
//   kit/vendor.lock.json  the exact upstream commits
//   kit/developer/licenses/  one licence text per upstream source
//
// Vendored skills are third-party skills copied verbatim from GitHub into
// kit/developer/skills/<name>/ (they serve the developer role) and rebuilt by `agent-setup vendor sync` (never hand-edited: the
// next sync overwrites them; local changes live in vendor.json as overrides). Licences
// are written once per source, not once per skill, and `--locked` rebuilds from the
// recorded commits instead of the upstream heads.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { KIT_DIR, LICENSES_DIR, VENDOR_SKILLS_DIR } from './paths.mjs';
import { skillIndex } from './catalog.mjs';
import { CliError, c, hashFile, listFiles, readJsonFile, say, toPosix } from './util.mjs';

/** One upstream repository listed in kit/vendor.json. */
export interface VendorRepo {
  github: string;
  license?: string;
  watch?: string;
  /** A reviewed upstream commit to stay on: sync checks it out instead of the head. */
  pin?: string;
  /** Why the repository is pinned: required with `pin`. */
  why?: string;
}

/** One vendored skill listed in kit/vendor.json, with its local frontmatter overrides. */
export interface VendorSkillEntry {
  name: string;
  repo: string;
  path: string;
  description?: string;
  compatibility?: string;
  removeKeys?: string[];
  why?: string;
}

/** One upstream skill deliberately not vendored. */
export interface VendorExcludedEntry {
  repo: string;
  path: string;
  why?: string;
}

/** The shape of kit/vendor.json. */
export interface VendorManifest {
  repos?: Record<string, VendorRepo>;
  skills?: VendorSkillEntry[];
  excluded?: VendorExcludedEntry[];
}

/** One locked vendored repository: where it was fetched and at which commit. */
export interface LockRepo {
  source: string;
  fetchedFrom: string;
  commit: string | null;
}

/** One locked vendored skill. */
export interface LockSkill {
  name: string;
  repo: string;
  path: string;
  patched: boolean;
}

/** The shape of kit/vendor.lock.json. */
export interface VendorLock {
  repos?: Record<string, LockRepo>;
  skills?: LockSkill[];
}

/** vendor.json plus its lock, as read together. */
export interface VendorPair {
  manifest: VendorManifest;
  lock: VendorLock;
}

/** Options for `vendorSync`: local checkouts instead of cloning, and locked commits. */
export interface VendorSyncOptions {
  sources?: Record<string, string>;
  locked?: boolean;
}

/** Options for `vendorStatus`: skip the network check. */
export interface VendorStatusOptions {
  offline?: boolean;
}

/** The result of `vendorStatus`: how many upstream changes were reported. */
export interface VendorStatusResult {
  changes: number;
}

/** Options for `importSkill`: rename the skill and declare its licence. */
export interface ImportSkillOptions {
  name?: string;
  license?: string;
}

/** The result of `stripToSpec`: spec-only text plus the removed key names. */
export interface StripToSpecResult {
  text: string;
  removed: string[];
}

/** Split SKILL.md frontmatter: the fence lines, the key lines and the body. */
interface FrontmatterDoc {
  open: string;
  lines: string[];
  close: string;
  body: string;
  eol: string;
}

export const VENDOR_FILE: string = join(KIT_DIR, 'vendor.json');
export const LOCK_FILE: string = process.env.AGENT_SETUP_VENDOR_LOCK ? resolve(process.env.AGENT_SETUP_VENDOR_LOCK) : join(KIT_DIR, 'vendor.lock.json');
const SKILLS = VENDOR_SKILLS_DIR;
const LICENSES = LICENSES_DIR;

// The Agent Skills spec's frontmatter fields. Anything else is rejected by the
// reference validator (skills-ref) and by claude.ai uploads.
const SPEC_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

export function readVendor(): VendorPair {
  const m = readJsonFile(VENDOR_FILE);
  if (m.error) throw new CliError(`kit/vendor.json is not valid JSON: ${m.error}`);
  const l = readJsonFile(LOCK_FILE);
  if (l.error) throw new CliError(`${toPosix(relative(KIT_DIR, LOCK_FILE))} is not valid JSON: ${l.error}`);
  return {
    manifest: (m.value as VendorManifest | null) ?? { repos: {}, skills: [] },
    lock: (l.value as VendorLock | null) ?? { repos: {}, skills: [] },
  };
}

/** Skill folder names that are rebuilt from upstream (never hand-edited). */
export function vendoredSkills(): Set<string> {
  const { manifest } = readVendor();
  return new Set((manifest.skills ?? []).map((s) => s.name));
}

/** Map skill name → licence file name (licenses/<repo>.txt) for skills that carry third-party content. */
export function licenseFiles(): Map<string, string> {
  const { manifest } = readVendor();
  const out = new Map<string, string>();
  for (const s of manifest.skills ?? []) if (existsSync(join(LICENSES, `${s.repo}.txt`))) out.set(s.name, `licenses/${s.repo}.txt`);
  return out;
}

const git = (cwd: string, ...args: string[]): string | null => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- frontmatter

const FRONTMATTER = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;

const splitFrontmatter = (text: string): FrontmatterDoc => {
  const m = text.match(FRONTMATTER);
  if (!m) throw new Error('no frontmatter');
  return { open: m[1], lines: m[2].split(/\r?\n/), close: m[3], body: text.slice(m[0].length), eol: m[1].endsWith('\r\n') ? '\r\n' : '\n' };
};
const joinFrontmatter = (fm: FrontmatterDoc): string => fm.open + fm.lines.join(fm.eol) + fm.close + fm.body;

/** Index range [start, end) of a top-level key, including its indented continuation lines. */
const keyRange = (lines: string[], key: string): [number, number] | null => {
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
  return [start, end];
};

const topLevelKeys = (text: string): string[] => splitFrontmatter(text).lines.map((l) => l.match(/^([A-Za-z0-9_-]+):/)?.[1]).filter((k): k is string => Boolean(k));

export const frontmatterValue = (text: string, key: string): string | null => {
  const fm = splitFrontmatter(text);
  const r = keyRange(fm.lines, key);
  if (!r) return null;
  // Folded (>) and literal (|) block scalars: the value is the continuation lines, joined
  // without their indentation (which would otherwise count towards the 1024-char limit).
  const raw = fm.lines
    .slice(r[0], r[1])
    .map((l, i) => (i ? l.trim() : l))
    .join(' ')
    .slice(key.length + 1)
    .trim()
    .replace(/^[>|][-+]?\s*/, '');
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through: not a JSON-compatible scalar */
    }
  }
  return raw.replace(/^['"]|['"]$/g, '');
};

// JSON.stringify output is a valid YAML double-quoted scalar, which keeps colons
// and quotes in an override from breaking the frontmatter.
const setKey = (text: string, key: string, value: unknown, after = 'description'): string => {
  const fm = splitFrontmatter(text);
  const line = `${key}: ${JSON.stringify(value)}`;
  const r = keyRange(fm.lines, key);
  if (r) fm.lines.splice(r[0], r[1] - r[0], line);
  else {
    const anchor = keyRange(fm.lines, after);
    fm.lines.splice(anchor ? anchor[1] : fm.lines.length, 0, line);
  }
  return joinFrontmatter(fm);
};

const removeKey = (text: string, key: string): string => {
  const fm = splitFrontmatter(text);
  const r = keyRange(fm.lines, key);
  if (r) fm.lines.splice(r[0], r[1] - r[0]);
  return joinFrontmatter(fm);
};

/** Agent Skills spec checks. Returns a list of problems; empty means valid. */
export const specProblems = (text: string, folder: string): string[] => {
  const problems: string[] = [];
  const name = frontmatterValue(text, 'name');
  const description = frontmatterValue(text, 'description') ?? '';
  const compatibility = frontmatterValue(text, 'compatibility');
  if (name !== folder) problems.push(`name "${name}" must equal its folder "${folder}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? '') || (name as string).length > 64) problems.push(`name "${name}" must be lowercase letters, digits and single hyphens, ≤64 chars`);
  if (!description || description.length > 1024) problems.push(`description must be 1-1024 chars (is ${description.length})`);
  if (compatibility !== null && (compatibility.length < 1 || compatibility.length > 500)) problems.push(`compatibility must be 1-500 chars (is ${compatibility.length})`);
  for (const k of topLevelKeys(text)) if (!SPEC_KEYS.has(k)) problems.push(`frontmatter key "${k}" is not in the Agent Skills spec (add it to removeKeys)`);
  return problems;
};

/** Remove frontmatter keys outside the Agent Skills spec (Claude Code's context, agent, background…). */
export const stripToSpec = (text: string): StripToSpecResult => {
  const removed = topLevelKeys(text).filter((k) => !SPEC_KEYS.has(k));
  let out = text;
  for (const k of removed) out = removeKey(out, k);
  return { text: out, removed };
};

// ---------------------------------------------------------------- sync

/**
 * Rebuild the vendored skills from upstream.
 * @param {{ sources?: Record<string,string>, locked?: boolean }} opts
 *   sources: repoKey → local checkout, instead of cloning
 *   locked:  check out the commit recorded in vendor.lock.json instead of the upstream head
 */
export function vendorSync({ sources = {}, locked = false }: VendorSyncOptions = {}): void {
  const { manifest, lock: previousLock } = readVendor();
  for (const key of Object.keys(sources)) {
    if (!manifest.repos?.[key]) throw new CliError(`--source ${key}: unknown repo; vendor.json repos are ${Object.keys(manifest.repos ?? {}).join(', ')}`);
  }

  let scratch: string | null = null;
  const repoDirs: Record<string, string> = {};
  const lock: VendorLock = { repos: {}, skills: [] };
  const usedRepos = new Set((manifest.skills ?? []).map((e) => e.repo));

  try {
    for (const key of usedRepos) {
      const repo = manifest.repos?.[key];
      if (!repo) throw new CliError(`vendor.json references unknown repo "${key}"`);
      if (sources[key]) {
        const dir = resolve(sources[key]);
        if (!existsSync(dir)) throw new CliError(`--source ${key}: ${dir} does not exist`);
        repoDirs[key] = dir;
        lock.repos![key] = { source: `github:${repo.github}`, fetchedFrom: 'local copy', commit: git(dir, 'rev-parse', 'HEAD') ?? 'unknown (not a git checkout)' };
        continue;
      }
      scratch ??= mkdtempSync(join(tmpdir(), 'agent-setup-vendor-'));
      const dir = join(scratch, key);
      say(`cloning ${repo.github} …`);
      try {
        // autocrlf off: a Windows checkout would otherwise rewrite every vendored
        // file to CRLF, so the same sync produces a full-file diff per machine.
        execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', '--depth', '1', '--quiet', `https://github.com/${repo.github}.git`, dir], { stdio: 'inherit' });
      } catch {
        throw new CliError(`git clone of ${repo.github} failed`);
      }
      // A pin wins over the head, and over --locked: it is the reviewed commit vendor.json asks for.
      const want = repo.pin ?? (locked ? previousLock.repos?.[key]?.commit : null);
      if (want && git(dir, 'rev-parse', 'HEAD') !== want) {
        try {
          execFileSync('git', ['-c', 'core.autocrlf=false', 'fetch', '--depth', '1', '--quiet', 'origin', want], { cwd: dir, stdio: 'inherit' });
          execFileSync('git', ['-c', 'core.autocrlf=false', 'checkout', '--quiet', want], { cwd: dir, stdio: 'inherit' });
        } catch {
          throw new CliError(`${repo.github}: could not check out the ${repo.pin ? 'pinned' : 'locked'} commit ${want}`);
        }
      }
      repoDirs[key] = dir;
      lock.repos![key] = { source: `github:${repo.github}`, fetchedFrom: 'github', commit: git(dir, 'rev-parse', 'HEAD') };
    }

    // Licences: one file per upstream source, normalised to LF.
    mkdirSync(LICENSES, { recursive: true });
    const licenseText: Record<string, string> = {};
    for (const key of usedRepos) {
      const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map((f) => join(repoDirs[key], f)).find(existsSync);
      if (!file) continue;
      licenseText[key] = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      writeFileSync(join(LICENSES, `${key}.txt`), licenseText[key]);
    }
    for (const f of readdirSync(LICENSES)) {
      if (f.endsWith('.txt') && !usedRepos.has(f.slice(0, -4))) rmSync(join(LICENSES, f));
    }

    // Skills.
    const problems: string[] = [];
    for (const entry of manifest.skills ?? []) {
      const src = join(repoDirs[entry.repo], entry.path);
      const skillFile = join(src, 'SKILL.md');
      if (!existsSync(skillFile)) throw new CliError(`${entry.repo}/${entry.path} has no SKILL.md (moved upstream?)`);
      const upstreamName = frontmatterValue(readFileSync(skillFile, 'utf8'), 'name');
      if (upstreamName !== entry.name) {
        throw new CliError(`${entry.repo}/${entry.path} is named "${upstreamName}" upstream, vendor.json expects "${entry.name}". Rename deliberately: other skills refer to it by name.`);
      }

      const dest = join(SKILLS, entry.name);
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
      // A licence copied along with the skill that is the repo's licence is a duplicate
      // of kit/developer/licenses/<repo>.txt; a skill-specific licence stays.
      for (const f of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
        const p = join(dest, f);
        if (existsSync(p) && readFileSync(p, 'utf8').replace(/\r\n/g, '\n') === licenseText[entry.repo]) rmSync(p);
      }

      const file = join(dest, 'SKILL.md');
      let text = readFileSync(file, 'utf8');
      if (entry.description) text = setKey(text, 'description', entry.description);
      if (entry.compatibility) text = setKey(text, 'compatibility', entry.compatibility);
      const spdx = manifest.repos?.[entry.repo]?.license;
      if (spdx && frontmatterValue(text, 'license') === null) {
        text = setKey(text, 'license', licenseText[entry.repo] ? `${spdx} (see ../../licenses/${entry.repo}.txt)` : spdx, 'name');
      }
      for (const k of entry.removeKeys ?? []) text = removeKey(text, k);
      writeFileSync(file, text);

      for (const p of specProblems(text, entry.name)) problems.push(`${entry.name}: ${p}`);
      const patched = Boolean(entry.description || entry.compatibility || entry.removeKeys?.length);
      lock.skills!.push({ name: entry.name, repo: entry.repo, path: entry.path, patched });
      say(`  skill  ${entry.name}${patched ? '  (frontmatter patched)' : ''}`);
    }

    // Orphans: vendored by an earlier sync, no longer listed. Only names from the
    // previous lock are ever deleted, so hand-authored skills are never touched.
    const keepSkills = new Set((manifest.skills ?? []).map((s) => s.name));
    for (const old of previousLock.skills ?? []) {
      if (keepSkills.has(old.name)) continue;
      rmSync(join(SKILLS, old.name), { recursive: true, force: true });
      say(`  removed  ${old.name}  (no longer in vendor.json)`);
    }

    // Upstream watch: new upstream skills that are neither vendored nor excluded.
    const accounted = new Set([...(manifest.skills ?? []), ...(manifest.excluded ?? [])].map((e) => `${e.repo}/${e.path}`));
    for (const [key, repo] of Object.entries(manifest.repos ?? {})) {
      if (!repo.watch || !repoDirs[key]) continue;
      const root = join(repoDirs[key], repo.watch);
      for (const sub of readdirSync(root)) {
        if (!existsSync(join(root, sub, 'SKILL.md')) || accounted.has(`${key}/${repo.watch}/${sub}`)) continue;
        say(c.yellow(`  NEW upstream skill ${repo.github}/${repo.watch}/${sub}: list it in vendor.json "skills" or "excluded"`));
      }
    }

    // No timestamp for vendored repos, so re-running a sync against unchanged upstreams produces no diff.
    writeFileSync(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`);
    if (problems.length) {
      for (const p of problems) say(c.red(`  spec  ${p}`));
      throw new CliError(`${problems.length} vendored skill(s) violate the Agent Skills spec; fix the overrides in kit/vendor.json`);
    }
    say(c.green('done.'), 'Every vendored skill passes the Agent Skills spec. Review the diff before committing — upstream changes land unreviewed otherwise.');
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- status

/**
 * One repository's line in `vendor status`, and whether it is a change to act on. A pinned
 * repository is reviewed: upstream moving past the pin is reported, not raised, until the
 * lock drifts from the pin.
 */
export function upstreamLine(key: string, repo: VendorRepo, lockedAt: string, head: string | null | undefined): { line: string; change: boolean } {
  const at = (s: string): string => s.slice(0, 12);
  if (!head) return { line: c.yellow(`  ${key.padEnd(20)} could not reach github.com/${repo.github}`), change: false };
  if (repo.pin && lockedAt !== repo.pin) return { line: `  ${key.padEnd(20)} ${c.yellow('pinned')} at ${at(repo.pin)}, locked at ${at(lockedAt)} — run: agent-setup vendor sync`, change: true };
  if (head === lockedAt) return { line: c.green(`  ${key.padEnd(20)} up to date (${at(head)})`), change: false };
  if (repo.pin) return { line: `  ${key.padEnd(20)} pinned at ${at(repo.pin)} (upstream at ${at(head)}): ${repo.why ?? ''}`, change: false };
  return { line: `  ${key.padEnd(20)} ${c.yellow('upstream moved')} ${at(lockedAt)} → ${at(head)} — review, then: agent-setup vendor sync, or pin the reviewed commit in vendor.json`, change: true };
}

/** Report what changed upstream: each vendored repository's head commit against the lock. */
export function vendorStatus({ offline = false }: VendorStatusOptions = {}): VendorStatusResult {
  const { manifest, lock } = readVendor();
  let changes = 0;
  say('', c.bold('Vendored repositories'));
  for (const [key, repo] of Object.entries(manifest.repos ?? {})) {
    const lockedAt = lock.repos?.[key]?.commit ?? 'not synced';
    if (offline) {
      say(`  ${key.padEnd(20)} locked ${String(lockedAt).slice(0, 12)}${repo.pin ? ' (pinned)' : ''}`);
      continue;
    }
    const head = git(process.cwd(), 'ls-remote', `https://github.com/${repo.github}.git`, 'HEAD')?.split(/\s+/)[0];
    const { line, change } = upstreamLine(key, repo, lockedAt, head);
    say(line);
    if (change) changes++;
  }
  say('');
  return { changes };
}

// ---------------------------------------------------------------- import

/** Add a GitHub skill to vendor.json and sync it into the kit. */
export function importSkill(source: unknown, { name, license }: ImportSkillOptions = {}): void {
  const gh = String(source ?? '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+?))?\/?$/);
  if (!gh) throw new CliError('usage: agent-setup import https://github.com/<owner>/<repo>/tree/<ref>/<path/to/skill> [--name x]');
  const [, owner, repoName, path = ''] = gh;
  const manifest = readJsonFile(VENDOR_FILE).value as VendorManifest;
  const key = repoName.toLowerCase();
  manifest.repos ??= {};
  manifest.repos![key] ??= { github: `${owner}/${repoName}`, ...(license ? { license } : {}) };
  const skillName = name ?? basename(path || repoName).toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName)) throw new CliError(`"${skillName}" is not a valid skill name — pass --name`);
  if (skillIndex().has(skillName) && !(manifest.skills ?? []).some((s) => s.name === skillName)) {
    throw new CliError(`a kit skill named ${skillName} already exists and is not vendored — choose another --name`);
  }
  manifest.skills = (manifest.skills ?? []).filter((s) => s.name !== skillName);
  manifest.skills.push({ name: skillName, repo: key, path, why: 'Imported with `agent-setup import`; add overrides here with a why.' });
  writeFileSync(VENDOR_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  say(`${c.green('added')} ${skillName} (${owner}/${repoName}/${path}) to kit/vendor.json — syncing…`);
  vendorSync();
  say(
    '',
    `Next: add "${skillName}" to kit/catalog.json (group and profiles; vendored skills serve the developer role), review every script it ships,`,
    'and run `agent-setup lint`. Vendored skills are never edited by hand — overrides go in kit/vendor.json.',
  );
}
