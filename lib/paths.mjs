// Where things are. The kit root is the folder that contains bin/, lib/ and kit/.
//
// Source of `lib/paths.mjs` — edit here, then `npm run build`. Never hand-edit the output.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFile, toPosix } from './util.mjs';
export const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const KIT_DIR = join(KIT_ROOT, 'kit');
export const TEMPLATES = join(KIT_DIR, 'templates');
/**
 * The roles the kit serves, each a folder in kit/ with its own skills/ and agents/:
 * developer — what developers' agents use day to day; admin — setting the kit up in a
 * project, measuring it and routing what it learns. Projects get one flat skills folder
 * (agents read only that), so the role travels in the catalog, not in the installed path.
 */
export const ROLES = ['developer', 'admin'];
/** Vendored skills belong to the developer role, and their licences sit beside them. */
export const VENDOR_SKILLS_DIR = join(KIT_DIR, 'developer', 'skills');
export const LICENSES_DIR = join(KIT_DIR, 'developer', 'licenses');
export const INBOX_DIR = process.env.AGENT_SETUP_INBOX_DIR ? resolve(process.env.AGENT_SETUP_INBOX_DIR) : join(KIT_ROOT, 'inbox');
/**
 * Machine-local state: the project registry. Per user, not per kit checkout, so moving or
 * re-cloning the kit never orphans the projects it serves. Overridable for tests.
 */
export const STATE_DIR = process.env.AGENT_SETUP_STATE_DIR ? resolve(process.env.AGENT_SETUP_STATE_DIR) : join(homedir(), '.agent-setup');
/** Where the registry lived before it moved per user; read once, then migrated. Never with an override. */
export const LEGACY_STATE_DIR = process.env.AGENT_SETUP_STATE_DIR ? null : join(KIT_ROOT, '.state');
/** The kit's home in a project: one folder every agent can read. */
export const HOME_REL = '.agents';
export const MANIFEST_REL = '.agents/agent-setup.json';
/** Where installs before 2.0 kept everything, the manifest included; `update` migrates them. */
export const LEGACY_MANIFEST_REL = '.claude/agent-setup.json';
/** A project folder of the kit's home (learnings, overlays…), or its pre-2.0 place while that is the one that exists. */
export function homeDir(target, name) {
    const home = join(target, HOME_REL, name);
    const legacy = join(target, '.claude', name);
    return existsSync(home) || !existsSync(legacy) ? home : legacy;
}
/** The project's sdlc config file, wherever it is (home, pre-2.0, legacy .ai/), or null. */
export function sdlcConfigPath(target) {
    return [HOME_REL, '.claude', '.ai'].map((d) => join(target, d, 'sdlc.config.json')).find((p) => existsSync(p)) ?? null;
}
let cachedVersion = null;
export function kitVersion() {
    if (cachedVersion)
        return cachedVersion;
    cachedVersion = readJsonFile(join(KIT_ROOT, 'package.json')).value?.version ?? '0.0.0';
    return cachedVersion;
}
/** The kit's own location, POSIX-style, as recorded in project manifests. */
export const kitSource = () => toPosix(KIT_ROOT);
