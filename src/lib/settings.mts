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

/** A single hook handler entry in a settings file. */
export interface HookHandler {
  type?: string;
  command?: string;
  args?: unknown;
  [key: string]: unknown;
}

/** A matcher group holding hook handlers. */
export interface HookGroup {
  matcher?: string;
  hooks?: HookHandler[];
  [key: string]: unknown;
}

/** Permissions section of the settings fragment. */
export interface SettingsPermissions {
  allow?: string[];
  ask?: string[];
  deny?: string[];
  [kind: string]: string[] | undefined;
}

/** The kit's settings fragment merged into a project. */
export interface SettingsFragment {
  permissions?: SettingsPermissions;
  hooks?: Record<string, HookGroup[]>;
  /** The session model the team starts on (`opusplan`, `sonnet`, …), when the install chose one. */
  model?: string;
  [key: string]: unknown;
}

/** One hook handler added by a merge. */
export interface AddedHook {
  event: string;
  matcher?: string;
  signature: string;
  script: string | null;
}

/** Permission rules added by a merge. */
export interface AddedPermissions {
  allow: string[];
  ask: string[];
  deny: string[];
  [kind: string]: string[];
}

/** Everything a merge added, for exact removal by update/uninstall. */
export interface AddedRecord {
  hooks: AddedHook[];
  permissions: AddedPermissions;
  /** The session model the merge set, when it set one. */
  model?: string;
}

/** The result of merging a fragment into existing settings. */
export interface MergeResult {
  settings: Record<string, unknown>;
  added: AddedRecord;
  notes: string[];
}

/** The settings shape that wiredScripts inspects. */
export interface WiredSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export const SETTINGS_SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';

/** The hook script a handler runs (in .agents/hooks, or .claude/hooks before 2.0), e.g. 'guard-git.mjs', or null. */
export function scriptOf(handler: HookHandler | null | undefined): string | null {
  const text = [handler?.command ?? '', ...(Array.isArray(handler?.args) ? handler.args : [])].join(' ');
  const m = text.match(/\.(?:agents|claude)[\\/]+hooks[\\/]+([A-Za-z0-9_.-]+\.(?:mjs|cjs|js|ps1|sh|py))/);
  return m ? m[1] : null;
}

export const signature = (h: HookHandler | null | undefined): string => JSON.stringify([h?.type ?? 'command', h?.command ?? '', Array.isArray(h?.args) ? h.args : []]);

function matcherCovers(matcher: unknown, name: string): boolean {
  if (matcher === undefined || matcher === null || matcher === '' || matcher === '*') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(name);
  } catch {
    return matcher === name;
  }
}

const namesOf = (matcher: unknown): string[] => (matcher ? String(matcher).split('|').map((s) => s.trim()).filter(Boolean) : ['*']);

function equivalent(a: HookHandler | null | undefined, b: HookHandler | null | undefined): boolean {
  const sa = scriptOf(a);
  const sb = scriptOf(b);
  if (sa && sb) return sa === sb;
  return signature(a) === signature(b);
}

/**
 * @returns {{ settings: object, added: { hooks: Array<{event:string, matcher?:string, signature:string, script:string|null}>, permissions: Record<string,string[]> }, notes: string[] }}
 */
export function mergeSettings(existing: unknown, fragment: SettingsFragment): MergeResult {
  const out = structuredClone(existing && typeof existing === 'object' ? existing : {}) as Record<string, any>;
  if (!existing || !Object.keys(existing).length) out.$schema = SETTINGS_SCHEMA;
  const added: AddedRecord = { hooks: [], permissions: { allow: [], ask: [], deny: [] } };
  const notes: string[] = [];

  for (const kind of ['allow', 'ask', 'deny']) {
    const want = fragment.permissions?.[kind] ?? [];
    if (!want.length) continue;
    out.permissions ??= {};
    if (!Array.isArray(out.permissions[kind])) out.permissions[kind] = [];
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
    } else if (out.model !== fragment.model) {
      notes.push(`model: the project's settings already choose "${String(out.model)}" — kept; the session model "${fragment.model}" was not set`);
    }
  }

  for (const [event, groups] of Object.entries(fragment.hooks ?? {})) {
    for (const group of groups) {
      for (const handler of group.hooks ?? []) {
        const current: HookGroup[] = Array.isArray(out.hooks?.[event]) ? out.hooks[event] : [];
        const names = namesOf(group.matcher);
        const uncovered = names.filter(
          (n) => !current.some((g) => (g.hooks ?? []).some((h) => equivalent(h, handler)) && (n === '*' || matcherCovers(g.matcher, n))),
        );
        if (!uncovered.length) continue;
        if (uncovered.length < names.length) {
          notes.push(`${event}: an existing ${scriptOf(handler) ?? 'handler'} already covers ${names.filter((n) => !uncovered.includes(n)).join('|')}; added coverage for ${uncovered.join('|')}`);
        }
        const matcher = group.matcher ? uncovered.join('|') : undefined;
        out.hooks ??= {};
        out.hooks[event] ??= [];
        let target = out.hooks[event].find((g: HookGroup) => (g.matcher ?? undefined) === matcher);
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
export function unmergeSettings(existing: unknown, added: AddedRecord | null | undefined): Record<string, unknown> {
  const out = structuredClone(existing && typeof existing === 'object' ? existing : {}) as Record<string, any>;
  for (const a of added?.hooks ?? []) {
    const groups = out.hooks?.[a.event];
    if (!Array.isArray(groups)) continue;
    let removed = false;
    for (const g of groups) {
      if (removed) break;
      if ((g.matcher ?? undefined) !== (a.matcher ?? undefined)) continue;
      const i = (g.hooks ?? []).findIndex((h: HookHandler) => signature(h) === a.signature);
      if (i >= 0) {
        g.hooks.splice(i, 1);
        removed = true;
      }
    }
    out.hooks[a.event] = groups.filter((g) => (g.hooks ?? []).length);
    if (!out.hooks[a.event].length) delete out.hooks[a.event];
  }
  if (out.hooks && !Object.keys(out.hooks).length) delete out.hooks;

  for (const kind of ['allow', 'ask', 'deny']) {
    const rm = new Set(added?.permissions?.[kind] ?? []);
    if (!rm.size || !Array.isArray(out.permissions?.[kind])) continue;
    out.permissions[kind] = out.permissions[kind].filter((r) => !rm.has(r));
    if (!out.permissions[kind].length) delete out.permissions[kind];
  }
  if (out.permissions && !Object.keys(out.permissions).length) delete out.permissions;
  // Only while it is still the kit's: a model someone chose since stays.
  if (added?.model && out.model === added.model) delete out.model;
  return out;
}

/** Which of the fragment's scripts are wired for which events (for `status`). */
export function wiredScripts(settings: WiredSettings | null | undefined): Map<string, Set<string>> {
  const found = new Map();
  for (const [event, groups] of Object.entries(settings?.hooks ?? {})) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of g.hooks ?? []) {
        const s = scriptOf(h);
        if (!s) continue;
        if (!found.has(s)) found.set(s, new Set());
        found.get(s).add(event);
      }
    }
  }
  return found;
}
