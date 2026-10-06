// `agent-setup export <dir>` — self-contained, portable copies of the kit's skills for the
// install routes that copy one skill folder at a time: `npx skills add` (agents with their own
// skill folder, and user-level installs for any agent) and claude.ai / Claude Desktop upload.
//
// The kit keeps one licence per upstream source (kit/licenses/), and the installer gives
// projects the licences their skills need. A skill folder copied on its own must carry its
// licence, though: MIT and Apache-2.0 require the notice to travel with every copy. So the
// export — build output, never kept in the kit — puts a LICENSE into each vendored skill
// folder and each vendored asset folder, points the skill's references at it, and removes
// frontmatter keys outside the Agent Skills spec (Claude Code's context/agent/background),
// which claude.ai upload and strict validators reject. Claude Code keeps those keys through
// `install`.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { KIT_ROOT, LICENSES_DIR, kitVersion } from './paths.mjs';
import { CliError, c, listFiles, say, toPosix } from './util.mjs';
import { loadCatalog, resolveSelection } from './catalog.mjs';
import type { ResolvedSelection, SelectionOptions } from './catalog.mjs';
import { readVendor, specProblems, stripToSpec, vendoredSkills } from './vendor.mjs';
import type { VendorManifest } from './vendor.mjs';

// Evals improve a skill; they are not part of running it (the installer leaves them out too).
const EXCLUDE = (rel: string): boolean => rel.startsWith('evals/') || rel.includes('-workspace/');
const within = (child: string, parent: string): boolean => {
  const r: string = relative(parent, child);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};

/** Options for `agent-setup export`: a selection plus whether to replace. */
export interface ExportOptions extends SelectionOptions {
  force?: boolean;
}

/** One licence placement: whose licence (`repo`) covers which folder (`dir`). */
export interface LicencePlacement {
  repo: string;
  dir: string;
}

/** Which folders of each skill hold third-party content, and whose licence covers it. */
function licencePlacements(): Map<string, LicencePlacement[]> {
  const { manifest }: { manifest: VendorManifest } = readVendor();
  const out: Map<string, LicencePlacement[]> = new Map();
  const place = (skill: string, repo: string, dir: string): void => {
    if (!out.has(skill)) out.set(skill, []);
    out.get(skill)!.push({ repo, dir });
  };
  for (const s of manifest.skills ?? []) place(s.name, s.repo, '');
  return out;
}

export function exportSkills(outArg: string, { profile, skills = [], exclude = [], roles, force = false }: ExportOptions = {}): { skills: number; licences: number } {
  if (!outArg) throw new CliError('usage: agent-setup export <dir> [--profile p] [--skills a,b] [--exclude x] [--roles developer|admin] [--force]');
  const out: string = resolve(outArg);
  if (within(out, KIT_ROOT)) throw new CliError('export writes build output — choose a folder outside the kit, so the kit keeps one copy of every file');
  const skillsOut: string = join(out, 'skills');
  if (existsSync(skillsOut) && readdirSync(skillsOut).length && !force) {
    throw new CliError(`${skillsOut} is not empty — choose an empty folder, or pass --force to replace the exported skills in it`);
  }

  const selection: ResolvedSelection = resolveSelection(loadCatalog(), { profile, skills, exclude, roles });
  const placements: Map<string, LicencePlacement[]> = licencePlacements();
  const vendored: Set<string> = vendoredSkills();
  const kitLicence: Buffer = readFileSync(join(KIT_ROOT, 'LICENSE'));
  const problems: string[] = [];
  const stripped: string[] = [];
  let licences: number = 0;

  for (const s of selection.skills) {
    const dest: string = join(skillsOut, s.name);
    rmSync(dest, { recursive: true, force: true });
    for (const f of listFiles(s.dir)) {
      if (EXCLUDE(f)) continue;
      mkdirSync(dirname(join(dest, f)), { recursive: true });
      cpSync(join(s.dir, f), join(dest, f));
    }

    // Each licence goes into the folder it covers; a source without one declares none.
    const moves: Array<{ from: string; to: string }> = [];
    for (const p of placements.get(s.name) ?? []) {
      const src: string = join(LICENSES_DIR, `${p.repo}.txt`);
      if (!existsSync(src)) continue;
      const dir: string = join(dest, p.dir);
      const target: string = join(dir, existsSync(join(dir, 'LICENSE')) ? `LICENSE-${p.repo}` : 'LICENSE');
      mkdirSync(dir, { recursive: true });
      writeFileSync(target, readFileSync(src));
      moves.push({ from: src, to: target });
      licences++;
    }

    // The kit's own skills carry the kit's licence: MIT asks for the notice in every copy.
    if (!vendored.has(s.name) && !existsSync(join(dest, 'LICENSE'))) {
      writeFileSync(join(dest, 'LICENSE'), kitLicence);
      licences++;
    }

    // References to the shared licence now point at the copy inside the folder.
    for (const f of listFiles(dest).filter((x) => x.endsWith('.md'))) {
      const abs: string = join(dest, f);
      let text: string = readFileSync(abs, 'utf8');
      for (const m of moves) {
        const was: string = toPosix(relative(dirname(join(s.dir, f)), m.from));
        const now: string = toPosix(relative(dirname(abs), m.to));
        text = text.split(was).join(now);
      }
      if (f === 'SKILL.md') {
        const r = stripToSpec(text);
        text = r.text;
        if (r.removed.length) stripped.push(`${s.name} (${r.removed.join(', ')})`);
      }
      writeFileSync(abs, text);
      if (/\.\.\/\.\.\/licenses\//.test(text)) problems.push(`${s.name}/${f}: still refers to ../../licenses/`);
    }
    for (const p of specProblems(readFileSync(join(dest, 'SKILL.md'), 'utf8'), s.name)) problems.push(`${s.name}: ${p}`);
  }

  if (problems.length) {
    for (const p of problems) say(c.red(`  ${p}`));
    throw new CliError(`${problems.length} problem(s) in the export — it is incomplete; fix the kit and run it again`);
  }

  writeFileSync(
    join(out, 'README.md'),
    [
      `# Agent_Setup skills — portable export (kit ${kitVersion()})`,
      '',
      'Generated by `agent-setup export`. Each folder under `skills/` is self-contained: third-party',
      'skills carry their LICENSE, and every SKILL.md uses only Agent Skills spec keys. Regenerate it',
      'rather than editing it.',
      '',
      '- Any agent, one project: `npx skills add <this folder> --skill \'*\' -a <agents>`',
      '- Any agent, every project (user level): the same with `-g`',
      '- claude.ai / Claude Desktop: zip one folder under `skills/` and upload it',
      '',
      'For a project with hooks, AGENTS.md and the learning loop, use `agent-setup install` instead.',
      '',
    ].join('\n'),
  );

  say(
    '',
    `${c.green('exported')} ${selection.skills.length} skill(s) to ${toPosix(skillsOut)} — ${licences} licence(s) bundled into the folders they cover, every SKILL.md within the Agent Skills spec`,
  );
  if (stripped.length) say(`  ${c.dim('removed Claude-only keys:')} ${stripped.join('; ')} — they run inline outside Claude Code`);
  say(`  Next: npx skills add "${toPosix(out)}" --skill '*' -a <agents> [-g]   ·   or zip one skills/<name> folder for claude.ai`, '');
  return { skills: selection.skills.length, licences };
}
