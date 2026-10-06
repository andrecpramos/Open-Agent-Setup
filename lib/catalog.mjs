// The kit's catalog: every skill (with its group), every agent, every hook (with its role),
// and the install profiles. Skills and agents live in their role's folder —
// kit/developer/ or kit/admin/ — and a name is unique across both.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_DIR, ROLES } from './paths.mjs';
import { CliError, readJsonFile, readText } from './util.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
export const skillsDirOf = (role) => join(KIT_DIR, role, 'skills');
export const agentsDirOf = (role) => join(KIT_DIR, role, 'agents');
export function loadCatalog() {
    const r = readJsonFile(join(KIT_DIR, 'catalog.json'));
    if (!r.value)
        throw new CliError(`kit/catalog.json is unreadable: ${r.error ?? 'missing'}`);
    return r.value;
}
const listDir = (dir) => {
    try {
        return readdirSync(dir).sort();
    }
    catch {
        return [];
    }
};
/** Every skill folder with a SKILL.md, in every role: name → role and folder. */
export function skillIndex() {
    const out = new Map();
    for (const role of ROLES) {
        for (const name of listDir(skillsDirOf(role))) {
            const path = join(skillsDirOf(role), name);
            if (existsSync(join(path, 'SKILL.md')) && !out.has(name))
                out.set(name, { role, path });
        }
    }
    return out;
}
/** Every agent file, in every role: name → role and file. */
export function agentIndex() {
    const out = new Map();
    for (const role of ROLES) {
        for (const f of listDir(agentsDirOf(role))) {
            if (!f.endsWith('.md') || f.toLowerCase() === 'readme.md')
                continue;
            if (!out.has(f.slice(0, -3)))
                out.set(f.slice(0, -3), { role, path: join(agentsDirOf(role), f) });
        }
    }
    return out;
}
/** Skill names, sorted. */
export const skillDirs = () => [...skillIndex().keys()].sort();
/** Agent names, sorted. */
export const agentFiles = () => [...agentIndex().keys()].sort();
/** A skill's folder in the kit (in the developer role when it does not exist yet). */
export const skillDir = (name) => skillIndex().get(name)?.path ?? join(skillsDirOf('developer'), name);
/** One line describing a skill, for tables. Accepts the full catalog or any smaller shape with skill summaries. */
export function skillSummary(catalog, name) {
    if (catalog.skills?.[name]?.summary)
        return catalog.skills?.[name]?.summary;
    const fm = parseFrontmatter(readText(join(skillDir(name), 'SKILL.md')) ?? '').data;
    const desc = String(fm?.description ?? '').replace(/\s+/g, ' ').trim();
    const first = desc.split(/(?<=\.)\s/)[0] ?? desc;
    return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}
/** Skills of one group, in catalog order. */
export const groupSkills = (catalog, group) => Object.entries(catalog.skills ?? {}).filter(([, m]) => m.group === group).map(([n]) => n);
/** Validate a --roles list. Unknown roles are an error; an empty list means every role. */
export function parseRoles(list) {
    const roles = (list ?? []).map((r) => r.trim()).filter(Boolean);
    for (const r of roles)
        if (!ROLES.includes(r))
            throw new CliError(`unknown role "${r}" (roles: ${ROLES.join(', ')})`);
    return roles.length ? ROLES.filter((r) => roles.includes(r)) : [...ROLES];
}
/**
 * Expand a list of skill names and @group references. A `pack:skill` prefix left
 * over from before the packs were merged is accepted and stripped.
 */
function expand(catalog, list, available) {
    const out = [];
    for (const raw of list) {
        const item = raw.includes(':') ? (raw.split(':').pop() ?? raw) : raw;
        if (item.startsWith('@')) {
            const g = item.slice(1);
            if (!catalog.groups?.[g]) {
                throw new CliError(`unknown group "@${g}". Groups: ${Object.keys(catalog.groups ?? {}).map((x) => `@${x}`).join(', ')}`);
            }
            out.push(...groupSkills(catalog, g).filter((n) => available.has(n)));
        }
        else {
            if (!available.has(item))
                throw new CliError(`unknown skill "${item}". Run \`agent-setup list\` for the skills and groups.`);
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
export function resolveSelection(catalog, { profile, skills = [], exclude = [], roles } = {}) {
    const profileName = profile ?? catalog.defaultProfile ?? 'standard';
    const prof = catalog.profiles?.[profileName];
    if (!prof)
        throw new CliError(`unknown profile "${profileName}". Available: ${Object.keys(catalog.profiles ?? {}).join(', ')}`);
    const chosenRoles = parseRoles(roles);
    const index = skillIndex();
    const agentsAt = agentIndex();
    const available = new Set(index.keys());
    const isAgent = (x) => agentsAt.has(x.split(':').pop() ?? x);
    const excluded = new Set(expand(catalog, exclude.filter((x) => !isAgent(x)), available));
    const excludedAgents = new Set(exclude.map((x) => x.split(':').pop() ?? x).filter((x) => agentsAt.has(x)));
    const base = prof.skills === '*' ? [...available] : expand(catalog, prof.skills ?? [], available);
    const core = (catalog.core ?? []).filter((n) => available.has(n));
    const admin = [...index].filter(([, e]) => e.role === 'admin').map(([n]) => n);
    const inRoles = (n) => chosenRoles.includes(index.get(n).role);
    const chosen = new Set([...base, ...core, ...admin, ...expand(catalog, skills, available)].filter((n) => !excluded.has(n) && inRoles(n)));
    const agents = [...agentsAt.keys()]
        .sort()
        .filter((a) => !excludedAgents.has(a) && chosenRoles.includes(agentsAt.get(a).role) && (catalog.agents?.[a]?.requires ?? []).every((r) => chosen.has(r)));
    return {
        profile: profileName,
        roles: chosenRoles,
        skills: [...chosen].sort().map((name) => {
            const e = index.get(name);
            return { name, dir: e.path, group: catalog.skills?.[name]?.group ?? 'other', role: e.role };
        }),
        agents: agents.map((name) => {
            const e = agentsAt.get(name);
            return { name, file: e.path, role: e.role };
        }),
    };
}
