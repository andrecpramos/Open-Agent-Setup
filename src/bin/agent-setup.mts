#!/usr/bin/env node
// agent-setup — install, update and improve a portable agent setup in any project.
// Zero dependencies; Node 18+. Run `agent-setup help` for usage.

import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { CliError, c, listFlag, parseArgs, say, toPosix } from '../lib/util.mjs';
import { kitVersion, KIT_ROOT } from '../lib/paths.mjs';
import { sync } from '../lib/sync.mjs';
import { status, uninstall, harvest, list, newSkill } from '../lib/commands.mjs';
import { vendorSync, vendorStatus, importSkill } from '../lib/vendor.mjs';
import { evalRouting } from '../lib/routing.mjs';
import { evalOutcomes } from '../lib/outcomes.mjs';
import { evals } from '../lib/evals.mjs';
import { report } from '../lib/report.mjs';
import { usage } from '../lib/usage.mjs';
import { startEvalBoard, evalBoardJson } from '../lib/eval-board.mjs';
import { exportSkills } from '../lib/export.mjs';
import { lint } from '../lib/lint.mjs';
import { listProjects } from '../lib/state.mjs';

const KIT_CMD = `node ${toPosix(join(KIT_ROOT, 'bin', 'agent-setup.mjs'))}`;

/** The first screen: the two commands an adopter needs, and where the rest is. */
const START = `
${c.bold('Agent_Setup')} ${kitVersion()} — sets up a repository for coding agents (Claude Code, Codex, Cursor, Copilot…)

  Add it to a project     ${KIT_CMD} install <path-to-your-project>
                          shows what it will add, in plain words, and asks before writing anything
  Remove it again         ${KIT_CMD} uninstall <path-to-your-project>
  Every command           ${KIT_CMD} help
`;

const HELP = `
${c.bold('agent-setup')} ${kitVersion()} — a portable, self-improving agent setup for any repository

${c.bold('Project commands')}
  install <project>   Install the kit: skills, agents, hooks, the AGENTS.md block, learning loop.
                      In a terminal it shows what it will add and asks first (--yes skips the question)
      --roles r         developer (always) and admin (default: both). The admin role adds sdlc-init,
                        self-improve, enforcement-audit and docs-keeper (run by name only), the
                        session recorder and the learning loop; --roles developer leaves them out
      --profile <p>     web | frontend | service | ai-app | library | standard | minimal | full
                        (default: chosen from what the project contains — the report says which)
      --skills a,b      add skills or whole groups on top of the profile (e.g. @design, agent-eval)
      --exclude a,b     leave these skills, groups or agents out
      --targets t       agents (always): AGENTS.md and the .agents/ home, where every skill lives once
                        (every Agent Skills reader uses it); claude: Claude Code's hooks, subagents
                        and .claude/skills links; codex, cursor, copilot, antigravity, windsurf: the
                        same hooks in that agent's own hook file; gemini: GEMINI.md. Default: the
                        agents the project already shows (.claude/, .cursor/, .codex/, …)
      --no-hooks        skip the Claude Code hooks and their settings
      --no-sdlc-config  don't write a provisional .agents/sdlc.config.json
      --setup measure   a baseline first: only the session recorder, nothing the agent sees, so the
                        kit can later be compared with how the team worked without it
                        (--measure-only is the same; "update --setup full" turns the kit on)
      --dry-run         show what would change, write nothing
  update [project]    Bring a project to this kit version (never overwrites local changes)
      --all             every registered project
      --reset-hooks     re-add hook handlers you removed from settings.json
      (selection flags above change what is installed)
  status [project]    Health: version, drift, pending merges, links, sdlc config, learnings  (--all)
  usage [project]     What the work cost, model by model, and what routing it across the model tiers
                      saved — main thread and subagents, priced with kit/models.json and the
                      project's overrides — with the quality of routed windows beside the rest
      --all             every registered project   --last n   --json
      --vs <ref>        compare with: main (each window's main model, the default), a tier
                        (frontier | high | medium | low) or a model id
      --session <id>    one session instead of the recorded windows (current: the live one)
      --transcript f    one transcript file, its subagents included
  uninstall <project> Remove exactly what the kit added; keep anything modified or project-owned

${c.bold('Kit commands')}  (run in the kit)
  report              The weekly cycle in one screen: every project's health and learnings, the
                      scorecards, the session metrics, and the next actions ranked, with commands
      --harvest         collect the projects' proposals into inbox/ first
      --md <file>       write it as Markdown to share (it names projects: keep it out of this repo)
  list                Roles, skills by group, agents, hooks and profiles
  lint [path]         Validate skills, agents, hooks, catalog, vendoring, licences, duplicates — the gate
  new-skill <name>    Scaffold an own skill that already meets the lint rules  (--group domain|core|design|admin, --summary)
  harvest             Collect kit-improvement proposals from every project's learnings outbox
      --from <path>     only this project (repeatable)
  export <dir>        Self-contained copies of the skills for routes that copy one folder at a time
                      (npx skills add, claude.ai upload): licences bundled, Claude-only keys removed
      --profile, --skills, --exclude as for install; --roles admin for the admin's own skills
                        (per user: npx skills add <dir> -g); --force replaces an earlier export
  import <github-url> Vendor a third-party skill: adds it to kit/vendor.json and syncs it  (--name)
  vendor sync         Rebuild every vendored skill from upstream; fails on Agent Skills spec violations
      --locked          use the commits in kit/vendor.lock.json instead of the upstream heads
      --source k=dir    use a local checkout for repo k (repeatable)
  vendor status       What changed upstream: each vendored repository's head against the lock  (--offline)
  eval-routing        Run the routing suites (kit/<role>/skills/*/evals/routing.json) in a real agent
      --suite s         routing (default) | trigger (every evals/trigger.json) | all
      --runs n          repeat each case n times; flaky cases show as such   --save  write
                        scorecards/<suite>.latest.json (only the buckets that ran are replaced)
      --max-runs n      at most n agent runs (each is real usage); a usage limit stops the run
      --skill <s>       one suite   --only id,id   --jobs 4   --timeout 300 (seconds per case)
      --cmd '[...]'     agent command as a JSON array; {prompt} and {kit} are substituted
      --assume caps     capabilities the agent has (e.g. gpt-model,image-generation)
  eval-outcomes       Is the work better with the kit than without it? Each evals/evals.json case
                      runs with the kit installed and without anything (vanilla), in fresh scratch
                      projects; a blind grader run checks each answer against the case's expectations
      --skill <s>       one skill's cases   --only id,id   --runs n   --jobs 2   --timeout 600
      --max-runs n      at most n agent runs (plus one short grader run each); a usage limit stops it
      --arms a,b        kit, vanilla (default both)   --setup install|skills (default install)
      --save            write scorecards/outcome.latest.json: kit buckets (gated), vanilla beside them
      --verbose         each run's reply and tools, besides the grader's reasons for every miss
      --cmd / --grader-cmd '[...]'  agent and grader commands as JSON arrays; {prompt} is substituted
  evals               The summary rows: eval scorecards against their baselines, then session
                      metrics from every registered project (checked after edit, corrections,
                      wasted output, cache hits, cost per window), last 20 windows vs the 20 before
      --project <dir>   one project's windows only   --last n   --json
      --check           exit 1 when a scorecard regressed against its baseline (the CI gate)
      --promote         accept the latest scorecards as the new baselines (commit with the change)
  eval-board          Local eval UI: score a prompt, a run (tokens/cost/turns) and its output
      --port <n>        localhost port (default: a free ephemeral port)   --no-open to skip the browser
      --project <dir>   live project context: installed skills plus the live session feed
                        (tokens, cost, model, tool calls and skill activations from the transcript)
      --session <id>    follow one session instead of the current pointer   --expect-file f
                        live polls record .agents/learnings/eval-history.jsonl; the board
                        promotes missed expectations and tool-loops to permanent cases
      --json            evaluate without the UI: --prompt s --output s --expect a,b --run '{...}'
                        (--prompt-file/--output-file/--run-file read the same from files;
                        with --project, prints the live snapshot instead)

Docs: ${resolve(KIT_ROOT, 'README.md')}
`;

/** Ask a yes/no question; Enter means yes. */
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = (await rl.question(question)).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

const number = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Best-effort browser open. The board works without it; failures stay silent. */
function openBrowser(url: string): void {
  try {
    const [file, args] =
      process.platform === 'win32'
        ? ['cmd.exe', ['/d', '/s', '/c', 'start', '', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    const child = spawn(file, args, { stdio: 'ignore', detached: true });
    child.unref();
  } catch {
    // fail open: the URL is already printed
  }
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { flags, positionals } = parseArgs(rest, { booleans: ['dry-run', 'all', 'force', 'reset-hooks', 'json', 'quiet', 'git-hooks', 'locked', 'offline', 'save', 'check', 'promote', 'measure-only', 'harvest', 'verbose', 'yes'] });
  if (flags.packs !== undefined) {
    throw new CliError('--packs is gone: the design pack merged into the kit. Use --skills @design, or --profile web / frontend.');
  }
  const selection = {
    profile: typeof flags.profile === 'string' ? flags.profile : undefined,
    skills: listFlag(flags.skills),
    exclude: listFlag(flags.exclude),
    targets: listFlag(flags.targets),
    hooks: flags.hooks === false ? false : flags.hooks === true ? true : undefined,
    gitHooks: flags['git-hooks'] === true ? true : undefined,
    roles: listFlag(flags.roles),
    sdlcConfig: flags['sdlc-config'] === false ? false : undefined,
    setup: typeof flags.setup === 'string' ? flags.setup : flags['measure-only'] ? 'measure' : undefined,
    resetHooks: Boolean(flags['reset-hooks']),
    dryRun: Boolean(flags['dry-run']),
    force: Boolean(flags.force),
    verbose: Boolean(flags.verbose),
  };

  switch (cmd) {
    case 'install': {
      if (!positionals[0]) throw new CliError(`usage: ${KIT_CMD} install <path-to-your-project> [options]`);
      // In a terminal, a person is watching: show what will be added and ask before writing.
      // Scripts and CI (no terminal) and --yes install straight away; --dry-run only shows.
      const ask: boolean = !selection.dryRun && !flags.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY);
      if (ask) {
        sync(positionals[0], { mode: 'install', ...selection, dryRun: true, interactive: true });
        if (!(await confirm('  Install? [Y/n] '))) {
          say('  Nothing was written.', '');
          return 0;
        }
        sync(positionals[0], { mode: 'install', ...selection, brief: true });
        return 0;
      }
      sync(positionals[0], { mode: 'install', ...selection });
      return 0;
    }

    case 'update': {
      const targets: string[] = flags.all ? listProjects().map((p) => p.path) : [positionals[0] ?? '.'];
      if (!targets.length) throw new CliError('no registered projects');
      let failed = 0;
      for (const t of targets) {
        try {
          sync(t, { mode: 'update', ...selection });
        } catch (err) {
          failed++;
          say(`${c.red('✖')} ${t}: ${(err as Error).message}`);
        }
      }
      return failed ? 1 : 0;
    }

    case 'status':
    case 'doctor': {
      const targets: string[] = flags.all ? listProjects().map((p) => p.path) : [positionals[0] ?? '.'];
      if (!targets.length) {
        say('No registered projects. `install` registers a new one; `update <project>` registers an existing install.');
        return 0;
      }
      let ok = true;
      for (const t of targets) ok = status(t).ok && ok;
      return ok ? 0 : 1;
    }

    case 'uninstall':
      if (!positionals[0]) throw new CliError('usage: agent-setup uninstall <project>');
      uninstall(positionals[0], { dryRun: selection.dryRun });
      return 0;

    case 'harvest':
      harvest({ from: listFlag(flags.from), dryRun: selection.dryRun });
      return 0;

    case 'lint':
      return lint({ paths: positionals }).errors ? 1 : 0;

    case 'list':
      list();
      return 0;

    case 'new-skill':
      if (flags.pack !== undefined) throw new CliError('--pack is gone: there is one kit. Use --group domain|core|design|admin.');
      newSkill(positionals[0], { group: (flags.group ?? 'domain') as string, summary: flags.summary as string | undefined });
      return 0;

    case 'export':
      exportSkills(positionals[0], { profile: selection.profile, skills: selection.skills, exclude: selection.exclude, roles: selection.roles, force: selection.force });
      return 0;

    case 'import':
      importSkill(positionals[0], { name: flags.name as string | undefined, license: flags.license as string | undefined });
      return 0;

    case 'vendor': {
      const [sub] = positionals;
      if (sub === 'sync') {
        const sources: Record<string, string> = {};
        for (const s of flags.source === undefined ? [] : ([] as unknown[]).concat(flags.source)) {
          const eq = String(s).indexOf('=');
          if (eq < 1) throw new CliError(`--source expects repo=dir, got "${s}"`);
          sources[String(s).slice(0, eq)] = String(s).slice(eq + 1);
        }
        vendorSync({ sources, locked: Boolean(flags.locked) });
        return 0;
      }
      if (sub === 'status') return vendorStatus({ offline: Boolean(flags.offline) }).changes ? 1 : 0;
      throw new CliError('usage: agent-setup vendor sync|status');
    }

    case 'eval-routing':
      return evalRouting({
        skill: typeof flags.skill === 'string' ? flags.skill : undefined,
        only: listFlag(flags.only),
        cmd: typeof flags.cmd === 'string' ? flags.cmd : undefined,
        assume: typeof flags.assume === 'string' ? flags.assume : undefined,
        jobs: number(flags.jobs, 4),
        timeout: number(flags.timeout, 300),
        suite: typeof flags.suite === 'string' ? flags.suite : undefined,
        runs: number(flags.runs, 1),
        maxRuns: number(flags['max-runs'], 0),
        save: flags.save ? (typeof flags.scorecards === 'string' ? resolve(flags.scorecards) : resolve(KIT_ROOT, 'scorecards')) : null,
      });

    case 'eval-outcomes':
      return evalOutcomes({
        skill: typeof flags.skill === 'string' ? flags.skill : undefined,
        only: listFlag(flags.only),
        arms: flags.arms === undefined ? undefined : listFlag(flags.arms),
        runs: number(flags.runs, 1),
        maxRuns: number(flags['max-runs'], 0),
        jobs: number(flags.jobs, 2),
        timeout: number(flags.timeout, 600),
        setup: typeof flags.setup === 'string' ? flags.setup : undefined,
        cmd: typeof flags.cmd === 'string' ? flags.cmd : undefined,
        graderCmd: typeof flags['grader-cmd'] === 'string' ? flags['grader-cmd'] : undefined,
        verbose: Boolean(flags.verbose),
        save: flags.save ? (typeof flags.scorecards === 'string' ? resolve(flags.scorecards) : resolve(KIT_ROOT, 'scorecards')) : null,
      });

    case 'report':
      return report({ harvest: Boolean(flags.harvest), md: typeof flags.md === 'string' ? flags.md : null, scorecards: typeof flags.scorecards === 'string' ? flags.scorecards : null });

    case 'usage':
      return usage({
        project: positionals[0] ?? null,
        all: Boolean(flags.all),
        last: number(flags.last, 0),
        vs: typeof flags.vs === 'string' ? flags.vs : undefined,
        session: typeof flags.session === 'string' ? flags.session : null,
        transcript: typeof flags.transcript === 'string' ? flags.transcript : null,
        json: Boolean(flags.json),
      });

    case 'evals':
      return evals({
        project: typeof flags.project === 'string' && flags.project ? flags.project : null,
        last: number(flags.last, 20),
        check: Boolean(flags.check),
        promote: Boolean(flags.promote),
        json: Boolean(flags.json),
        scorecards: typeof flags.scorecards === 'string' ? flags.scorecards : null,
      });

    case 'eval-board': {
      if (flags.json) {
        let report: unknown;
        try {
          report = evalBoardJson(flags);
        } catch (err) {
          throw new CliError((err as Error).message);
        }
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return 0;
      }
      const port: number = flags.port === undefined ? 0 : number(flags.port, 0);
      const project: string | null = typeof flags.project === 'string' && flags.project ? flags.project : null;
      const { url } = await startEvalBoard({ port, project });
      say('', `${c.bold('agent-setup eval-board')}  ${c.dim(url)}${project ? c.dim(`  (project ${project})`) : ''}`);
      say(
        project
          ? '  Live feed: the current session is scored from its transcript — prompts, tokens, cost, model, tools and skill activations.'
          : '  Paste the prompt, the run numbers and the output — the board scores each and suggests the next fix.',
      );
      say(`  ${c.dim('Ctrl+C to stop')}`, '');
      if (flags.open !== false && flags.quiet !== true) openBrowser(url);
      await new Promise(() => {});
      return 0;
    }

    case 'upstream':
      throw new CliError('`upstream` is now `vendor status`.');

    case 'version':
    case '--version':
    case '-v':
      say(kitVersion());
      return 0;

    case undefined:
      say(START);
      return 0;

    case 'help':
    case '--help':
    case '-h':
      say(START, HELP);
      return 0;

    default:
      throw new CliError(`unknown command "${cmd}". Run: agent-setup help`);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof CliError) {
    say(`${c.red('error')} ${err.message}`);
    process.exitCode = err.exitCode;
  } else {
    console.error(err);
    process.exitCode = 1;
  }
}
