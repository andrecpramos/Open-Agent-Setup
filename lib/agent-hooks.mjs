// The kit's hooks in agents other than Claude Code (whose wiring is .claude/settings.json, see
// settings.mts): which of the kit's hooks each agent can run, the file its project hooks live
// in, and putting the kit's entries into that file — and taking them out — without touching
// anything else in it. Every entry runs .agents/hooks/run-hook.mjs, which translates the
// agent's payload for the kit's hooks and their answer back.
//
// An agent gets a hook only where it has an event that can do that hook's job: every agent
// here can deny a shell command (guard-git); only some can hand the agent a note after an
// edit, at session start or on a prompt. The table is in docs/ARCHITECTURE.md.
export const HOOK_AGENTS = ['codex', 'cursor', 'copilot', 'antigravity', 'windsurf'];
/** The kit's named set in a "named" file. */
const SET = 'agent-setup';
const RUN_RE = /\.agents[\\/]hooks[\\/]run-hook\.mjs\s+([\w-]+)\s+([\w-]+)/;
export const commandFor = (agent, hook) => `node .agents/hooks/run-hook.mjs ${agent} ${hook}`;
export const AGENT_HOOKS = {
    codex: {
        name: 'Codex',
        file: '.codex/hooks.json',
        shape: 'nested',
        wiring: [
            { event: 'PreToolUse', matcher: '^Bash$', hook: 'guard-git' },
            { event: 'PostToolUse', matcher: '^apply_patch$', hook: 'check-gates' },
            { event: 'SessionStart', matcher: 'startup|resume|clear|compact', hook: 'branch-check' },
            { event: 'UserPromptSubmit', hook: 'prompt-intake' },
            { event: 'UserPromptSubmit', hook: 'learning-signals', role: 'admin' },
        ],
        handler: (command) => ({ type: 'command', command, timeout: 30 }),
        covers: 'the git guard, the post-edit checks, the branch note and the brief on risky requests',
        trust: 'Codex runs a project\'s hooks only once you trust them: type /hooks in Codex and approve the agent-setup ones.',
    },
    cursor: {
        name: 'Cursor',
        file: '.cursor/hooks.json',
        shape: 'flat',
        version: 1,
        wiring: [
            { event: 'beforeShellExecution', hook: 'guard-git' },
            { event: 'postToolUse', matcher: 'Write', hook: 'check-gates' },
            { event: 'sessionStart', hook: 'branch-check' },
        ],
        handler: (command, w) => ({ command, timeout: 30, ...(w.matcher ? { matcher: w.matcher } : {}) }),
        covers: 'the git guard, the post-edit checks and the branch note',
    },
    copilot: {
        name: 'GitHub Copilot (CLI and cloud agent)',
        file: '.github/hooks/agent-setup.json',
        shape: 'flat',
        version: 1,
        wiring: [
            { event: 'preToolUse', hook: 'guard-git' },
            { event: 'postToolUse', hook: 'check-gates' },
            { event: 'sessionStart', hook: 'branch-check' },
        ],
        handler: (command) => ({ type: 'command', command, timeoutSec: 30 }),
        covers: 'the git guard, the post-edit checks and the branch note',
    },
    antigravity: {
        name: 'Antigravity',
        file: '.agents/hooks.json',
        shape: 'named',
        wiring: [{ event: 'PreToolUse', matcher: 'run_command', hook: 'guard-git' }],
        handler: (command) => ({ type: 'command', command, timeout: 30 }),
        covers: 'the git guard',
    },
    windsurf: {
        name: 'Windsurf',
        file: '.windsurf/hooks.json',
        shape: 'flat',
        wiring: [{ event: 'pre_run_command', hook: 'guard-git' }],
        handler: (command) => ({ command, powershell: command, show_output: false }),
        covers: 'the git guard',
    },
};
export const isHookAgent = (t) => HOOK_AGENTS.includes(t);
/** The wiring keys (event|hook) an install wants, for the selected roles. */
export const wantedKeys = (spec, roles) => spec.wiring.filter((w) => roles.includes(w.role ?? 'developer')).map((w) => `${w.event}|${w.hook}`);
const isKitHandler = (h) => RUN_RE.test(String(h?.command ?? h?.bash ?? ''));
const hookOf = (h) => String(h?.command ?? h?.bash ?? '').match(RUN_RE)?.[2] ?? null;
/** The event → entries map the file holds (the kit's named set, for the named shape). */
function eventsOf(spec, json) {
    if (spec.shape === 'named')
        return json[SET] && typeof json[SET] === 'object' ? json[SET] : {};
    return json.hooks && typeof json.hooks === 'object' ? json.hooks : {};
}
/** The kit's entries present in a hook file, as event|hook keys. */
export function presentKeys(spec, json) {
    const out = [];
    for (const [event, entries] of Object.entries(eventsOf(spec, json ?? {}))) {
        if (!Array.isArray(entries))
            continue;
        for (const e of entries) {
            const handlers = spec.shape === 'flat' ? [e] : Array.isArray(e?.hooks) ? e.hooks : [];
            for (const h of handlers)
                if (isKitHandler(h))
                    out.push(`${event}|${hookOf(h)}`);
        }
    }
    return out;
}
/** The file with every kit entry taken out; containers left empty go too. */
export function removeKitHooks(spec, json) {
    const out = structuredClone(json ?? {});
    if (spec.shape === 'named') {
        delete out[SET];
        return out;
    }
    const hooks = out.hooks && typeof out.hooks === 'object' ? out.hooks : null;
    if (!hooks)
        return out;
    for (const [event, entries] of Object.entries(hooks)) {
        if (!Array.isArray(entries))
            continue;
        const kept = spec.shape === 'flat'
            ? entries.filter((h) => !isKitHandler(h))
            : entries
                .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isKitHandler(h)) } : g))
                .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length);
        if (kept.length)
            hooks[event] = kept;
        else
            delete hooks[event];
    }
    if (!Object.keys(hooks).length)
        delete out.hooks;
    return out;
}
/** The file with the given kit entries added (call on a file the kit entries were removed from). */
export function addKitHooks(spec, agent, json, keys) {
    const out = structuredClone(json);
    const chosen = spec.wiring.filter((w) => keys.includes(`${w.event}|${w.hook}`));
    if (!chosen.length)
        return out;
    if (spec.version !== undefined && out.version === undefined) {
        // "version" first, as the agents' own examples have it.
        const rest = { ...out };
        for (const k of Object.keys(out))
            delete out[k];
        Object.assign(out, { version: spec.version }, rest);
    }
    let events;
    if (spec.shape === 'named') {
        out[SET] = { enabled: true };
        events = out[SET];
    }
    else {
        out.hooks = out.hooks && typeof out.hooks === 'object' ? out.hooks : {};
        events = out.hooks;
    }
    for (const w of chosen) {
        const handler = spec.handler(commandFor(agent, w.hook), w);
        events[w.event] = Array.isArray(events[w.event]) ? events[w.event] : [];
        if (spec.shape === 'flat') {
            events[w.event].push(handler);
            continue;
        }
        let group = events[w.event].find((g) => (g?.matcher ?? undefined) === w.matcher);
        if (!group) {
            group = w.matcher === undefined ? { hooks: [] } : { matcher: w.matcher, hooks: [] };
            events[w.event].push(group);
        }
        group.hooks = Array.isArray(group.hooks) ? group.hooks : [];
        group.hooks.push(handler);
    }
    return out;
}
/** Nothing left but what the kit itself would write for an empty file: the file can go. */
export function isEmptyHookFile(spec, json) {
    return Object.keys(json).every((k) => k === 'version' || (k === 'hooks' && !Object.keys(json.hooks ?? {}).length));
}
/** The spec whose file this is (for uninstall, which knows only the manifest's paths). */
export const specForFile = (file) => Object.entries(AGENT_HOOKS).find(([, s]) => s.file === file) ?? null;
