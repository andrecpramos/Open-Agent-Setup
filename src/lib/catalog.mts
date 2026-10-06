// The kit's catalog: every skill (with its group), every agent, every hook (with its role),
// and the install profiles. Skills and agents live in their role's folder —
// kit/developer/ or kit/admin/ — and a name is unique across both.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_DIR, ROLES } from './paths.mjs';
import type { Role } from './paths.mjs';
import { CliError, readJsonFile, readText } from './util.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

export const skillsDirOf = (role: Role): string => join(KIT_DIR, role, 'skills');
export const agentsDirOf = (role: Role): string => join(KIT_DIR, role, 'agents');

/** One hook entry in kit/catalog.json: the role it serves and what it does. */
export interface HookMeta {
  role: Role;
  summary?: string;
  [key: string]: unknown;
}

/** One skill entry in kit/catalog.json. */
export interface SkillMeta {
  group: string;
  summary?: string;
  [key: string]: unknown;
}

/** One agent entry in kit/catalog.json. */
export interface AgentMeta {
  requires?: string[];
  summary?: string;
  /** The delivery step it serves (Explore, Review, Verify, Docs) and when to delegate to it: the AGENTS.md team table. */
  step?: string;
  when?: string;
  [key: string]: unknown;
}

/** One install profile in kit/catalog.json. */
export interface ProfileDef {
  description?: string;
  skills?: string[] | '*';
  [key: string]: unknown;
}

/** The shape of kit/catalog.json. */
export interface Catalog {
  roles?: Record<string, string>;
  groups?: Record<string, string>;
  skills?: Record<string, SkillMeta>;
  agents?: Record<string, AgentMeta>;
  hooks?: Record<string, HookMeta>;
  core?: string[];
  defaultProfile?: string;
  profiles?: Record<string, ProfileDef>;
  [key: string]: unknown;
}

/** The profile plus include/exclude lists a selection is resolved from. */
export interface SelectionOptions {
  profile?: string;
  skills?: string[];
  exclude?: string[];
  /** Only these roles' skills and agents (default: every role). */
  roles?: string[];
}

/** One chosen skill, resolved to its folder. */
export interface ResolvedSkill {
  name: string;
  dir: string;
  group: string;
  role: Role;
}

/** One chosen agent, resolved to its file. */
export interface ResolvedAgent {
  name: string;
  file: string;
  role: Role;
}

/** Concrete skills and agents a profile plus include/exclude lists expand to. */
export interface ResolvedSelection {
  profile: string;
  roles: Role[];
  skills: ResolvedSkill[];
  agents: ResolvedAgent[];
}

/** Where one skill or agent lives: its role and its path in the kit. */
export interface KitEntry {
  role: Role;
  path: string;
}

export function loadCatalog(): Catalog {
  const r = readJsonFile(join(KIT_DIR, 'catalog.json'));
  if (!r.value) throw new CliError(`kit/catalog.json is unreadable: ${r.error ?? 'missing'}`);
  return r.value as Catalog;
}

const listDir = (dir: string): string[] => {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
};

/** Every skill folder with a SKILL.md, in every role: name → role and folder. */
export function skillIndex(): Map<string, KitEntry> {
  const out: Map<string, KitEntry> = new Map();
  for (const role of ROLES) {
    for (const name of listDir(skillsDirOf(role))) {
      const path = join(skillsDirOf(role), name);
      if (existsSync(join(path, 'SKILL.md')) && !out.has(name)) out.set(name, { role, path });
    }
  }
  return out;
}

/** Every agent file, in every role: name → role and file. */
export function agentIndex(): Map<string, KitEntry> {
  const out: Map<string, KitEntry> = new Map();
  for (const role of ROLES) {
    for (const f of listDir(agentsDirOf(role))) {
      if (!f.endsWith('.md') || f.toLowerCase() === 'readme.md') continue;
      if (!out.has(f.slice(0, -3))) out.set(f.slice(0, -3), { role, path: join(agentsDirOf(role), f) });
    }
  }
  return out;
}

/** Skill names, sorted. */
export const skillDirs = (): string[] => [...skillIndex().keys()].sort();
/** Agent names, sorted. */
export const agentFiles = (): string[] => [...agentIndex().keys()].sort();
/** A skill's folder in the kit (in the developer role when it does not exist yet). */
export const skillDir = (name: string): string => skillIndex().get(name)?.path ?? join(skillsDirOf('developer'), name);

/** One line describing a skill, for tables. Accepts the full catalog or any smaller shape with skill summaries. */
export function skillSummary(catalog: { skills?: Record<string, { summary?: string }> }, name: string): string {
  if (catalog.skills?.[name]?.summary) return catalog.skills?.[name]?.summary as string;
  const fm = (parseFrontmatter(readText(join(skillDir(name), 'SKILL.md')) ?? '') as { data?: Record<string, unknown> | null }).data;
  const desc: string = String(fm?.description ?? '').replace(/\s+/g, ' ').trim();
  const first: string = desc.split(/(?<=\.)\s/)[0] ?? desc;
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

/** Skills of one group, in catalog order. */
export const groupSkills = (catalog: Catalog, group: string): string[] => Object.entries(catalog.skills ?? {}).filter(([, m]) => m.group === group).map(([n]) => n);

/** Validate a --roles list. Unknown roles are an error; an empty list means every role. */
export function parseRoles(list: string[] | undefined): Role[] {
  const roles: string[] = (list ?? []).map((r) => r.trim()).filter(Boolean);
  for (const r of roles) if (!(ROLES as readonly string[]).includes(r)) throw new CliError(`unknown role "${r}" (roles: ${ROLES.join(', ')})`);
  return roles.length ? ROLES.filter((r) => roles.includes(r)) : [...ROLES];
}

/**
 * Expand a list of skill names and @group references. A `pack:skill` prefix left
 * over from before the packs were merged is accepted and stripped.
 */
function expand(catalog: Catalog, list: string[], available: Set<string>): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const item: string = raw.includes(':') ? (raw.split(':').pop() ?? raw) : raw;
    if (item.startsWith('@')) {
      const g = item.slice(1);
      if (!catalog.groups?.[g]) {
        throw new CliError(`unknown group "@${g}". Groups: ${Object.keys(catalog.groups ?? {}).map((x) => `@${x}`).join(', ')}`);
      }
      out.push(...groupSkills(catalog, g).filter((n) => available.has(n)));
    } else {
      if (!available.has(item)) throw new CliError(`unknown skill "${item}". Run \`agent-setup list\` for the skills and groups.`);
      out.push(item);
    }
  }
  return out;
}

/**
 * Turn a profile plus include/exclude lists into concrete skills and agents, within the
 * selected roles. The `core` skills are always chosen; so are every admin skill and agent
 * when the admin role is selected (it is a small, fixed set, invoked by name).
 */
export function resolveSelection(catalog: Catalog, { profile, skills = [], exclude = [], roles }: SelectionOptions = {}): ResolvedSelection {
  const profileName: string = profile ?? catalog.defaultProfile ?? 'standard';
  const prof: ProfileDef | undefined = catalog.profiles?.[profileName];
  if (!prof) throw new CliError(`unknown profile "${profileName}". Available: ${Object.keys(catalog.profiles ?? {}).join(', ')}`);
  const chosenRoles: Role[] = parseRoles(roles);

  const index = skillIndex();
  const agentsAt = agentIndex();
  const available: Set<string> = new Set(index.keys());
  const isAgent = (x: string): boolean => agentsAt.has(x.split(':').pop() ?? x);
  const excluded: Set<string> = new Set(expand(catalog, exclude.filter((x) => !isAgent(x)), available));
  const excludedAgents: Set<string> = new Set(exclude.map((x): string => x.split(':').pop() ?? x).filter((x) => agentsAt.has(x)));

  const base: string[] = prof.skills === '*' ? [...available] : expand(catalog, prof.skills ?? [], available);
  const core: string[] = (catalog.core ?? []).filter((n) => available.has(n));
  const admin: string[] = [...index].filter(([, e]) => e.role === 'admin').map(([n]) => n);
  const inRoles = (n: string): boolean => chosenRoles.includes((index.get(n) as KitEntry).role);
  const chosen: Set<string> = new Set([...base, ...core, ...admin, ...expand(catalog, skills, available)].filter((n) => !excluded.has(n) && inRoles(n)));

  const agents: string[] = [...agentsAt.keys()]
    .sort()
    .filter((a) => !excludedAgents.has(a) && chosenRoles.includes((agentsAt.get(a) as KitEntry).role) && (catalog.agents?.[a]?.requires ?? []).every((r) => chosen.has(r)));
  return {
    profile: profileName,
    roles: chosenRoles,
    skills: [...chosen].sort().map((name) => {
      const e = index.get(name) as KitEntry;
      return { name, dir: e.path, group: catalog.skills?.[name]?.group ?? 'other', role: e.role };
    }),
    agents: agents.map((name) => {
      const e = agentsAt.get(name) as KitEntry;
      return { name, file: e.path, role: e.role };
    }),
  };
}
