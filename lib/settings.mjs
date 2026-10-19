// Merging the kit's settings fragment into a project's .claude/settings.json.
//
// The rules:
//   · permissions are unioned; nothing existing is removed;
//   · a hook handler is added only for the event/tool combinations that no
//     equivalent handler (same .claude/hooks/<script>) already covers — so a
//     project whose own guard already runs on `Bash` gains `PowerShell`
//     coverage instead of a second, duplicate guard;
//   · a session `model` (install --session-model) is set only when the project's settings
//     choose none, and removed again only while it is still the one the kit set;
//   · everything added is recorded, so update and uninstall remove exactly that;
//   · .claude/settings.local.json is never read or written.
export const SETTINGS_SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';
/** The hook script a handler runs (in .agents/hooks, or .claude/hooks before 2.0), e.g. 'guard-git.mjs', or null. */
export function scriptOf(handler) {
    const text = [handler?.command ?? '', ...(Array.isArray(handler?.args) ? handler.args : [])].join(' ');
    const m = text.match(/\.(?:agents|claude)[\\/]+hooks[\\/]+([A-Za-z0-9_.-]+\.(?:mjs|cjs|js|ps1|sh|py))/);
    return m ? m[1] : null;
}
export const signature = (h) => JSON.stringify([h?.type ?? 'command', h?.command ?? '', Array.isArray(h?.args) ? h.args : []]);
// What a rule cannot carry literally: `*` is the rule's own wildcard; expansions, substitutions
// and redirects are for Claude Code to judge each time, not for a rule to approve ahead.
const NOT_IN_RULE = /[*$`<>(){}\\\n]/;
/**
 * Allow rules for a project's gate commands (sdlc.config.json `gates`): the checks the agent and
 * its helpers run after every edit, step and review — approved once instead of prompting each
 * time. A compound command gets a rule per part (Claude Code matches each part on its own; a
 * `cd` into the tree needs none), a leading `VAR=value` is dropped (Claude Code matches past the
 * safe ones), and a part of two words or more also takes arguments (`npm test *`: one test
 * file). A single word stays exact: `make *` would approve every target. A command holding a
 * wildcard, an expansion or a redirect gets no rule and keeps prompting.
 */
export function gateAllowRules(gates) {
    const out = [];
    for (const g of Array.isArray(gates) ? gates : []) {
        const cmd = typeof g?.command === 'string' ? g.command.trim() : '';
        if (!cmd || NOT_IN_RULE.test(cmd))
            continue;
        for (const raw of cmd.split(/\s*(?:&&|\|\||;|\|)\s*/)) {
            const part = raw.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '').trim();
            if (!part || part.includes('&') || /^cd(?:\s|$)/.test(part))
                continue;
            const rule = /\s/.test(part) ? `Bash(${part} *)` : `Bash(${part})`;
            if (!out.includes(rule))
                out.push(rule);
        }
    }
    return out;
}
function matcherCovers(matcher, name) {
    if (matcher === undefined || matcher === null || matcher === '' || matcher === '*')
        return true;
    try {
        return new RegExp(`^(?:${matcher})$`).test(name);
    }
    catch {
        return matcher === name;
    }
}
const namesOf = (matcher) => (matcher ? String(matcher).split('|').map((s) => s.trim()).filter(Boolean) : ['*']);
function equivalent(a, b) {
    const sa = scriptOf(a);
    const sb = scriptOf(b);
    if (sa && sb)
        return sa === sb;
    return signature(a) === signature(b);
}
/**
 * @returns {{ settings: object, added: { hooks: Array<{event:string, matcher?:string, signature:string, script:string|null}>, permissions: Record<string,string[]> }, notes: string[] }}
 */
export function mergeSettings(existing, fragment) {
    const out = structuredClone(existing && typeof existing === 'object' ? existing : {});
    if (!existing || !Object.keys(existing).length)
        out.$schema = SETTINGS_SCHEMA;
    const added = { hooks: [], permissions: { allow: [], ask: [], deny: [] } };
    const notes = [];
    for (const kind of ['allow', 'ask', 'deny']) {
        const want = fragment.permissions?.[kind] ?? [];
        if (!want.length)
            continue;
        out.permissions ??= {};
        if (!Array.isArray(out.permissions[kind]))
            out.permissions[kind] = [];
        for (const rule of want) {
            if (!out.permissions[kind].includes(rule)) {
                out.permissions[kind].push(rule);
                added.permissions[kind].push(rule);
            }
        }
    }
    if (typeof fragment.model === 'string' && fragment.model) {
        if (out.model === undefined) {
            out.model = fragment.model;
            added.model = fragment.model;
        }
        else if (out.model !== fragment.model) {
            notes.push(`model: the project's settings already choose "${String(out.model)}" — kept; the session model "${fragment.model}" was not set`);
        }
    }
    for (const [event, groups] of Object.entries(fragment.hooks ?? {})) {
        for (const group of groups) {
            for (const handler of group.hooks ?? []) {
                const current = Array.isArray(out.hooks?.[event]) ? out.hooks[event] : [];
                const names = namesOf(group.matcher);
                const uncovered = names.filter((n) => !current.some((g) => (g.hooks ?? []).some((h) => equivalent(h, handler)) && (n === '*' || matcherCovers(g.matcher, n))));
                if (!uncovered.length)
                    continue;
                if (uncovered.length < names.length) {
                    notes.push(`${event}: an existing ${scriptOf(handler) ?? 'handler'} already covers ${names.filter((n) => !uncovered.includes(n)).join('|')}; added coverage for ${uncovered.join('|')}`);
                }
                const matcher = group.matcher ? uncovered.join('|') : undefined;
                out.hooks ??= {};
                out.hooks[event] ??= [];
                let target = out.hooks[event].find((g) => (g.matcher ?? undefined) === matcher);
                if (!target) {
                    target = matcher === undefined ? { hooks: [] } : { matcher, hooks: [] };
                    out.hooks[event].push(target);
                }
                target.hooks ??= [];
                target.hooks.push(structuredClone(handler));
                added.hooks.push({ event, ...(matcher === undefined ? {} : { matcher }), signature: signature(handler), script: scriptOf(handler) });
            }
        }
    }
    return { settings: out, added, notes };
}
/** Remove exactly what a previous merge added. */
export function unmergeSettings(existing, added) {
    const out = structuredClone(existing && typeof existing === 'object' ? existing : {});
    for (const a of added?.hooks ?? []) {
        const groups = out.hooks?.[a.event];
        if (!Array.isArray(groups))
            continue;
        let removed = false;
        for (const g of groups) {
            if (removed)
                break;
            if ((g.matcher ?? undefined) !== (a.matcher ?? undefined))
                continue;
            const i = (g.hooks ?? []).findIndex((h) => signature(h) === a.signature);
            if (i >= 0) {
                g.hooks.splice(i, 1);
                removed = true;
            }
        }
        out.hooks[a.event] = groups.filter((g) => (g.hooks ?? []).length);
        if (!out.hooks[a.event].length)
            delete out.hooks[a.event];
    }
    if (out.hooks && !Object.keys(out.hooks).length)
        delete out.hooks;
    for (const kind of ['allow', 'ask', 'deny']) {
        const rm = new Set(added?.permissions?.[kind] ?? []);
        if (!rm.size || !Array.isArray(out.permissions?.[kind]))
            continue;
        out.permissions[kind] = out.permissions[kind].filter((r) => !rm.has(r));
        if (!out.permissions[kind].length)
            delete out.permissions[kind];
    }
    if (out.permissions && !Object.keys(out.permissions).length)
        delete out.permissions;
    // Only while it is still the kit's: a model someone chose since stays.
    if (added?.model && out.model === added.model)
        delete out.model;
    return out;
}
/** Which of the fragment's scripts are wired for which events (for `status`). */
export function wiredScripts(settings) {
    const found = new Map();
    for (const [event, groups] of Object.entries(settings?.hooks ?? {})) {
        for (const g of Array.isArray(groups) ? groups : []) {
            for (const h of g.hooks ?? []) {
                const s = scriptOf(h);
                if (!s)
                    continue;
                if (!found.has(s))
                    found.set(s, new Set());
                found.get(s).add(event);
            }
        }
    }
    return found;
}
