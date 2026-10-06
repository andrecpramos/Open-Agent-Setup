// Per-project manifest (.agents/agent-setup.json) and the machine-local registry
// of projects the kit is installed in (~/.agent-setup/projects.json).
//
// Source of `lib/state.mjs` — edit here, then `npm run build`. Never hand-edit the output.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LEGACY_MANIFEST_REL, LEGACY_STATE_DIR, MANIFEST_REL, STATE_DIR } from './paths.mjs';
import { readJsonFile, toPosix, writeJson } from './util.mjs';
/** Where a project's manifest is: the .agents/ home, the pre-2.0 .claude/ one, or nowhere. */
export function manifestLocation(target) {
    if (existsSync(join(target, MANIFEST_REL)))
        return 'home';
    if (existsSync(join(target, LEGACY_MANIFEST_REL)))
        return 'legacy';
    return null;
}
export function readManifest(target) {
    const where = manifestLocation(target);
    if (!where)
        return null;
    return readJsonFile(join(target, where === 'home' ? MANIFEST_REL : LEGACY_MANIFEST_REL)).value;
}
export function writeManifest(target, manifest) {
    const files = Object.fromEntries(Object.entries(manifest.files ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    writeJson(join(target, MANIFEST_REL), { ...manifest, files });
}
const REGISTRY = () => join(STATE_DIR, 'projects.json');
/** The registry; until the first write, the one a kit checkout used to keep in `.state/`. */
export function listProjects() {
    const file = existsSync(REGISTRY()) || !LEGACY_STATE_DIR ? REGISTRY() : join(LEGACY_STATE_DIR, 'projects.json');
    const v = readJsonFile(file).value;
    return Array.isArray(v?.projects) ? v.projects : [];
}
export function registerProject(target, info) {
    const path = toPosix(resolve(target));
    const projects = listProjects().filter((p) => p.path.toLowerCase() !== path.toLowerCase());
    projects.push({ path, ...info });
    projects.sort((a, b) => a.path.localeCompare(b.path));
    writeJson(REGISTRY(), { $comment: 'Projects this kit is installed in, on this machine. Used by `update --all`, `status --all`, `harvest`, `evals` and `report`.', projects });
}
export function unregisterProject(target) {
    const path = toPosix(resolve(target)).toLowerCase();
    const projects = listProjects().filter((p) => p.path.toLowerCase() !== path);
    writeJson(REGISTRY(), { $comment: 'Projects this kit is installed in, on this machine.', projects });
}
