#!/usr/bin/env node
// Per-clone setup for what git does not carry. Reads the kit manifest
// (.agents/agent-setup.json) and makes this clone match it:
//
//   1. Claude Code's links: .claude/skills/<name> → .agents/skills/<name> (and
//      .claude/licenses → .agents/licenses), when the project targets Claude Code. The one
//      copy of every skill lives in .agents/, where every other agent reads it; Claude Code
//      reads project skills only from .claude/skills and follows a linked skill folder. The
//      links are git-ignored: git on Windows walks through a junction and would commit its
//      contents twice.
//   2. Clean-up: the git hooks an install before 3.0 could add to the git directory are
//      removed, here and at every Claude Code session start.
//
//   node .agents/hooks/setup-clone.mjs              set up or repair (idempotent)
//   node .agents/hooks/setup-clone.mjs --uninstall  remove the links
//   node .agents/hooks/setup-clone.mjs --hook       Claude Code's SessionStart: repair the
//                                                   links only, say so when it made any
//
// In Claude Code the session-start hook runs it; other agents read .agents/ directly. Links
// are removed with unlink, never a recursive delete — a recursive delete through a junction
// would reach the real skill files.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const hookMode = args.includes('--hook');
const quiet = args.includes('--quiet') || hookMode;
const lines = [];
const log = (m) => lines.push(m);

const git = (...a) => {
  try {
    return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const same = (a, b) => resolve(a).replace(/\\/g, '/').toLowerCase() === resolve(b).replace(/\\/g, '/').toLowerCase();
// One folder, two spellings: a short 8.3 name on Windows (RUNNER~1) or a link on the way (macOS
// /var → /private/var), while git reports the real path. Compare real paths where they exist.
const realPath = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
};
const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

const root = git('rev-parse', '--show-toplevel') ?? resolve(here, '..', '..');
let manifest = null;
for (const rel of [['.agents', 'agent-setup.json'], ['.claude', 'agent-setup.json']]) {
  try {
    manifest = JSON.parse(readFileSync(join(root, ...rel), 'utf8').replace(/^\uFEFF/, ''));
    break;
  } catch {
    // not here
  }
}

// ---------------------------------------------------------------- 1. links

// Folders that hold the kit's skills or licences, now or before 2.0 (when the links ran the
// other way): a link into one of them is ours.
const homes = [join(root, '.agents', 'skills'), join(root, '.claude', 'skills')];
const licenceDirs = [join(root, '.agents', 'licenses'), join(root, '.claude', 'licenses')];
const wanted = uninstall || !manifest ? {} : (manifest.links ?? {});

/** Remove our links that are no longer wanted. */
function removeOurLinks(keep) {
  const candidates = ['.claude/licenses', '.agents/licenses'];
  for (const dir of ['.claude/skills', '.agents/skills']) {
    try {
      for (const name of readdirSync(join(root, dir))) candidates.push(`${dir}/${name}`);
    } catch {
      // no such folder
    }
  }
  let removed = 0;
  for (const rel of candidates) {
    const p = join(root, rel);
    if (!isLink(p) || keep.has(rel)) continue;
    let real = null;
    try {
      real = realpathSync(p);
    } catch {
      real = null; // dangling link
    }
    if (real === null || homes.some((h) => same(dirname(real), h)) || licenceDirs.some((d) => same(real, d))) {
      unlinkSync(p);
      removed++;
    }
  }
  for (const d of [join(root, '.claude', 'skills'), join(root, '.agents', 'skills')]) {
    try {
      if (!readdirSync(d).length) rmdirSync(d);
    } catch {
      // not empty, or already gone
    }
  }
  return removed;
}

function syncLinks() {
  let created = 0;
  const blocked = [];
  for (const [rel, targetRel] of Object.entries(wanted)) {
    const abs = join(root, rel);
    const target = join(root, targetRel);
    if (!existsSync(target)) continue;
    if (isLink(abs)) {
      if (existsSync(abs)) continue; // a live link
      unlinkSync(abs); // dangling (moved project): recreate below
    } else if (existsSync(abs)) {
      blocked.push(rel);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    symlinkSync(process.platform === 'win32' ? target : relative(dirname(abs), target), abs, 'junction');
    created++;
  }
  const removed = removeOurLinks(new Set(Object.keys(wanted)));
  return { created, removed, blocked };
}

if (hookMode) {
  // Claude Code's SessionStart: never fail the session, say something only when it helped.
  try {
    removeRetiredGitHooks();
    const { created } = syncLinks();
    if (created) {
      process.stdout.write(
        JSON.stringify({
          systemMessage: `agent-setup: linked ${created} kit skill(s) into .claude/skills for this clone — run /reload-skills (or restart) to load them.`,
        }),
      );
    }
  } catch (err) {
    process.stderr.write(`[agent-setup:setup-clone] ${err?.stack ?? err}\n`);
  }
  process.exit(0);
}

const { created, removed, blocked } = syncLinks();
if (created || removed) log(`skills for Claude Code: ${created} link(s) created, ${removed} removed in .claude/`);
else if (Object.keys(wanted).length) log(`skills for Claude Code: ${Object.keys(wanted).length} link(s) in .claude/ already in place`);
for (const b of blocked) log(`skills for Claude Code: ${b} is a real folder, not a link — left alone`);
if (removeRetiredGitHooks()) log('git hooks: the retired agent-setup hooks were removed from this clone');

// ---------------------------------------------------------------- 2. retired git hooks

// Installs before 3.0 could add pre-commit/pre-push hooks in <git-dir>/agent-setup/ and point
// core.hooksPath at them. That layer is gone (branch protection on the git host does its job),
// so any clone that still has it gets it removed — core.hooksPath only while it is ours.
function removeRetiredGitHooks() {
  const common = git('rev-parse', '--path-format=absolute', '--git-common-dir') ?? git('rev-parse', '--git-common-dir');
  if (!common) return false;
  const dest = join(resolve(common), 'agent-setup');
  const current = git('config', '--get', 'core.hooksPath');
  if (current && same(realPath(current), realPath(join(dest, 'hooks')))) git('config', '--unset', 'core.hooksPath');
  if (!existsSync(dest)) return false;
  rmSync(dest, { recursive: true, force: true });
  return true;
}

if (!manifest && !uninstall) log('agent-setup is not installed here (.agents/agent-setup.json missing) — nothing to set up');
if (!quiet) for (const l of lines) process.stdout.write(`agent-setup: ${l}\n`);
