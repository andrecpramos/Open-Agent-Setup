// Rendering the project-facing documents from kit/templates.

import { join } from 'node:path';
import { TEMPLATES, kitVersion } from './paths.mjs';
import { readText, today } from './util.mjs';
import { tierTable } from './models.mjs';
import type { ModelTable } from '../kit/hooks/_usage.mjs';

/** A skill reference as used when building template variables. */
export interface RenderSkill {
  name: string;
  group?: string;
  [key: string]: unknown;
}

/** An agent reference as used when building template variables. */
export interface RenderAgent {
  name: string;
  [key: string]: unknown;
}

/** The install selection: which skills and agents were chosen. */
export interface RenderSelection {
  skills: RenderSkill[];
  agents: RenderAgent[];
}

/** The detected project shape that buildVars reads. */
export interface RenderDetection {
  name: string;
  stack: string[];
  commands: string[][];
  integration?: string | null;
  production?: string | null;
  packageManager?: string | null;
}

/** The catalog shape that buildVars reads. */
export interface RenderCatalog {
  skills?: Record<string, { summary?: string; group?: string; [key: string]: unknown }>;
  agents?: Record<string, { summary?: string; step?: string; when?: string; tier?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** Options accepted by buildVars. */
export interface BuildVarsOptions {
  detection: RenderDetection;
  selection: RenderSelection;
  catalog: RenderCatalog;
  agentSummaries: Record<string, string | undefined>;
  targets?: string[];
  hooks?: boolean;
  /** The installed roles; the admin role adds the learning loop and the admin skills' row. */
  roles?: string[];
  /** The model tiers (kit/models.json with the project's overrides): the AGENTS.md tier table. */
  models?: ModelTable;
}

/** Template variables produced by buildVars. A type alias (not an interface) so the result carries an implicit index signature for render(). */
export type BuiltVars = {
  SKILLS_LOCATION: string;
  ENFORCEMENT_NOTE: string;
  PROJECT_NAME: string;
  KIT_VERSION: string;
  DATE: string;
  STACK: string;
  COMMANDS: string;
  TEAM_TABLE: string;
  CLAUDE_AGENTS: string;
  CLAUDE_SECTION: string;
  KB_NOTE: string;
  LEARNING_LOOP: string;
  MODEL_TIERS: string;
};

/** A provisional sdlc config written from detection. */
export interface ProvisionalConfig {
  $schema: string;
  version: number;
  _provisional: boolean;
  _comment: string;
  project: {
    name: string;
    stack?: string[];
    packageManager?: string;
    [key: string]: unknown;
  };
  branching: {
    model: string;
    production: string;
    integration?: string | null;
    featurePrefix: string;
    releaseOnRequestOnly: boolean;
  };
  sharedTree: boolean;
  gates: unknown[];
}

export const template = (name: string): string => {
  const t = readText(join(TEMPLATES, name));
  if (t === null) throw new Error(`missing template kit/templates/${name}`);
  return t;
};

/** Replace {{KEY}} placeholders that have a value; leave the rest visible. */
export function render(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

const WORKFLOW_ORDER = ['deliver', 'gates', 'ship-it', 'handoff'];
// The agents whose hooks run the git guard, by install target.
const GUARD_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', copilot: 'GitHub Copilot', antigravity: 'Antigravity', windsurf: 'Windsurf' };
const ADMIN_ORDER = ['sdlc-init', 'self-improve', 'enforcement-audit'];
// The team table reads in the order of the delivery cycle.
const STEP_ORDER = ['Explore', 'Plan', 'Build', 'Verify', 'Review', 'Docs'];

export function buildVars({ detection, selection, catalog, agentSummaries, targets = ['claude'], hooks = true, roles = ['developer', 'admin'], models }: BuildVarsOptions): BuiltVars {
  // Catalog order (front, back, middle, …) reads better than alphabetical.
  const order = Object.keys(catalog.skills ?? {});
  const skills = [...selection.skills].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const names = new Set(skills.map((s) => s.name));
  const domain = skills.filter((s) => s.group !== 'core' && s.group !== 'admin');
  const workflow = WORKFLOW_ORDER.filter((n) => names.has(n));
  const admin = ADMIN_ORDER.filter((n) => names.has(n));

  // The names only: a tool that loads skills already sees their descriptions, every session, and
  // one that does not opens the SKILL.md the name points at. A summary table here paid twice.
  const code = (list: string[]): string => list.map((n) => `\`${n}\``).join(' · ');
  const skillGroups: string[] = [
    ...(domain.length ? [`${code(domain.map((s) => s.name))} for the areas`] : []),
    ...(workflow.length ? [`${code(workflow)} for the workflow`] : []),
    ...(admin.length ? [`${code(admin)} for whoever maintains the setup, run by name only`] : []),
  ];

  const commands = detection.commands.length
    ? [
        '| Task | Command |',
        '|---|---|',
        ...detection.commands.map(([task, cmd]) => `| ${task} | \`${cmd}\` |`),
        '| Single test | TODO(sdlc-init) |',
        '',
        '> Detected from manifests at install time. `/sdlc-init` checks each one against what CI',
        '> actually runs — a command that differs from CI is worse than no command.',
      ].join('\n')
    : 'TODO(sdlc-init): no build manifest was detected — record the exact install, build, test (including a single test), lint and typecheck commands here.';

  // One table for every agent tool: AGENTS.md is read by all of them; the agent files say how.
  const rank = (name: string): number => {
    const i = STEP_ORDER.indexOf(catalog.agents?.[name]?.step ?? '');
    return i < 0 ? STEP_ORDER.length : i;
  };
  const agentOrder = Object.keys(catalog.agents ?? {});
  const team = [...selection.agents].sort((a, b) => rank(a.name) - rank(b.name) || agentOrder.indexOf(a.name) - agentOrder.indexOf(b.name));
  // Subagents live in Claude Code's folder when it is targeted, in the home otherwise.
  const agentsDir: string = targets.includes('claude') ? '.claude/agents' : '.agents/agents';
  const teamTable = team.length
    ? [
        '| Step | Agent | Tier | Delegate when |',
        '|---|---|---|---|',
        ...team.map((a) => `| ${catalog.agents?.[a.name]?.step ?? '—'} | \`${a.name}\` | ${catalog.agents?.[a.name]?.tier ?? '—'} | ${catalog.agents?.[a.name]?.when ?? agentSummaries[a.name] ?? `see ${agentsDir}/`} |`),
        '',
        `Agents that cannot spawn subagents do the step themselves, following \`${agentsDir}/<name>.md\`.`,
      ].join('\n')
    : 'No subagents installed: do each step yourself.';
  const claudeAgents = team.length
    ? '- **Subagents:** run independent reviews in parallel, give each the brief and the diff, and check what comes back; spawn them from the repository root, where they write their project memory. Each runs on its tier\'s model; to move one run up a tier, pass the Agent tool\'s `model` (`fable` for frontier, `opus` when Fable is not available to you).'
    : '';

  const skillsWhere: string = `Playbooks live in \`.agents/skills/<name>/SKILL.md\`${skillGroups.length ? `: ${skillGroups.join('; ')}` : ''}.`;
  const skillsLocation = targets.includes('claude') ? `${skillsWhere} Claude Code reads the same folders through per-clone links in \`.claude/skills/\`.` : skillsWhere;
  // Which agents' sessions a hook holds it in: Claude Code's own hooks, the others through run-hook.
  const guarded: string[] = hooks ? targets.map((t) => GUARD_NAMES[t]).filter((n): n is string => Boolean(n)) : [];
  const enforcementNote = !guarded.length
    ? 'Nothing mechanical enforces this here — follow it exactly.'
    : `In ${guarded.length > 1 ? `${guarded.slice(0, -1).join(', ')} and ${guarded[guarded.length - 1]}` : guarded[0]} sessions a hook denies it; in any other agent this line is the rule.`;
  const withAdmin: boolean = roles.includes('admin');
  const kbNote = withAdmin
    ? 'Missing? Whoever maintains the setup runs `/sdlc-init` (other agents: follow `.agents/skills/sdlc-init/SKILL.md`).'
    : 'Missing? Work from the code and this file; ask the user before assuming a rule.';
  const learningLoop = withAdmin
    ? [
        '## Learning loop',
        '',
        'When the user corrects you, or something non-obvious costs real time, add one entry to',
        '`.agents/learnings/inbox.md` (format: `.agents/learnings/README.md`) once the task is done.',
        'Whoever maintains the setup routes each entry to where it is enforced.',
        '',
        '',
      ].join('\n')
    : '';
  return {
    SKILLS_LOCATION: skillsLocation,
    ENFORCEMENT_NOTE: enforcementNote,
    PROJECT_NAME: detection.name,
    KIT_VERSION: kitVersion(),
    DATE: today(),
    STACK: detection.stack.length ? detection.stack.join(', ') : 'nothing detected — fill in by hand',
    COMMANDS: commands,
    TEAM_TABLE: teamTable,
    CLAUDE_AGENTS: claudeAgents,
    // Only with the claude target: AGENTS.md is every agent's file, and Claude Code reads it too.
    CLAUDE_SECTION: targets.includes('claude')
      ? `${render(template('claude-section.md'), { CLAUDE_AGENTS: claudeAgents }).replace(/\n{3,}/g, '\n\n')}\n`
      : '',
    KB_NOTE: kbNote,
    LEARNING_LOOP: learningLoop,
    MODEL_TIERS: models && team.length ? modelTiers(models, targets) : '',
  };
}

/** Under the team table: the orchestrator and the tiers' models, and when a step changes tier. */
function modelTiers(models: ModelTable, targets: string[]): string {
  return [
    tierTable(models, targets),
    '',
    'Your session is the **orchestrator**: run it on that row\'s model and spend it on judgement — the',
    'brief, the plan\'s decisions, routing each step, checking what comes back. XS and S work stays',
    'with you: a subagent starts cold and re-reads what you have. From M up, hand each step to the',
    'agent of its tier — reading to the scout, building to the implementer, checks to the gate-runner,',
    'docs to the doc-writer — and keep the decisions. Escalate on evidence — a step that failed twice',
    'moves up one tier — and never move a review of risky work down to save money.',
    '',
    '',
  ].join('\n');
}

/** A provisional sdlc.config.json from what git and the manifests showed. */
export function provisionalConfig(detection: RenderDetection): ProvisionalConfig {
  const twoTrunk = Boolean(detection.integration);
  return {
    $schema: './skills/sdlc-init/assets/sdlc.config.schema.json',
    version: 1,
    _provisional: true,
    _comment:
      'Written by agent-setup install from what git showed — NOT verified, and no gates yet. Run /sdlc-init to survey the repo, confirm the branch model, and add the gates CI actually runs. Delete _provisional when done.',
    project: {
      name: detection.name,
      ...(detection.stack.length ? { stack: detection.stack } : {}),
      ...(detection.packageManager ? { packageManager: detection.packageManager } : {}),
    },
    branching: twoTrunk
      ? { model: 'two-trunk', production: detection.production ?? 'main', integration: detection.integration, featurePrefix: 'feature/', releaseOnRequestOnly: true }
      : { model: 'trunk', production: detection.production ?? 'main', featurePrefix: 'feature/', releaseOnRequestOnly: true },
    sharedTree: false,
    gates: [],
  };
}
