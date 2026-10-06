// Small filesystem and process helpers shared by every command. No dependencies.
//
// Source of `lib/util.mjs` — edit here, then `npm run build`. Never hand-edit the output.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, writeFileSync, copyFileSync, } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
export const toPosix = (p) => String(p).split(sep).join('/').replace(/\\/g, '/');
export const exists = (p) => existsSync(p);
export function isDir(p) {
    try {
        return statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
export function isSymlink(p) {
    try {
        return lstatSync(p).isSymbolicLink();
    }
    catch {
        return false;
    }
}
/** Read a UTF-8 text file without its BOM, or null when it does not exist. */
export function readText(p) {
    try {
        return readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    }
    catch {
        return null;
    }
}
export function readJsonFile(p) {
    const text = readText(p);
    if (text === null)
        return { value: null, error: null, missing: true };
    try {
        return { value: JSON.parse(text), error: null, missing: false };
    }
    catch (err) {
        return { value: null, error: err.message, missing: false };
    }
}
export function writeText(p, content) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
}
export function writeJson(p, value) {
    writeText(p, `${JSON.stringify(value, null, 2)}\n`);
}
export function copyFile(src, dest) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
}
/**
 * Content hash that ignores line-ending differences, so a checkout with
 * core.autocrlf=true is not reported as "locally modified" on every file.
 * Binary content (anything with a NUL byte) is hashed as-is.
 */
export function hashBuffer(buf) {
    const isBinary = buf.includes(0);
    const data = isBinary ? buf : Buffer.from(buf.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), 'utf8');
    return createHash('sha256').update(data).digest('hex').slice(0, 32);
}
export function hashFile(p) {
    try {
        return hashBuffer(readFileSync(p));
    }
    catch {
        return null;
    }
}
export const hashText = (text) => hashBuffer(Buffer.from(text, 'utf8'));
const SKIP_DIRS = new Set(['node_modules', '.git', '.state', '__pycache__']);
/** Recursive file list, POSIX paths relative to `dir`, sorted. */
export function listFiles(dir) {
    const out = [];
    const walk = (d) => {
        let entries = [];
        try {
            entries = readdirSync(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            if (SKIP_DIRS.has(e.name) || e.name.endsWith('-workspace'))
                continue;
            const full = join(d, e.name);
            if (e.isDirectory())
                walk(full);
            else if (e.isFile())
                out.push(toPosix(relative(dir, full)));
        }
    };
    walk(dir);
    return out.sort();
}
/** Remove now-empty directories from `start` upward, stopping at `stopAt`. */
export function pruneEmptyDirs(start, stopAt) {
    let d = start;
    const stop = stopAt.replace(/[\\/]+$/, '');
    while (d.length > stop.length && d.startsWith(stop)) {
        try {
            if (readdirSync(d).length)
                return;
            rmdirSync(d);
        }
        catch {
            return;
        }
        d = dirname(d);
    }
}
export function git(cwd, ...args) {
    try {
        return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
    }
    catch {
        return null;
    }
}
export const today = () => new Date().toISOString().slice(0, 10);
// --- Output ---------------------------------------------------------------
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : String(s));
export const c = {
    bold: paint(1),
    dim: paint(2),
    red: paint(31),
    green: paint(32),
    yellow: paint(33),
    cyan: paint(36),
};
export const say = (...lines) => {
    for (const l of lines)
        process.stdout.write(`${l}\n`);
};
export class CliError extends Error {
    exitCode;
    constructor(message, code = 1) {
        super(message);
        this.exitCode = code;
    }
}
/** Minimal argv parser: positionals, --flag, --key value, --key=value, repeated keys → arrays. */
export function parseArgs(argv, { booleans = [] } = {}) {
    const flags = {};
    const positionals = [];
    const bool = new Set(booleans);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--') {
            positionals.push(...argv.slice(i + 1));
            break;
        }
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            let key = eq > 0 ? a.slice(2, eq) : a.slice(2);
            let value;
            if (eq > 0)
                value = a.slice(eq + 1);
            else if (key.startsWith('no-') && !bool.has(key)) {
                key = key.slice(3);
                value = false;
            }
            else if (bool.has(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--'))
                value = true;
            else
                value = argv[++i];
            if (key in flags && value !== true && value !== false) {
                flags[key] = [].concat(flags[key], value);
            }
            else
                flags[key] = value;
            continue;
        }
        if (a.startsWith('-') && a.length === 2) {
            flags[a.slice(1)] = true;
            continue;
        }
        positionals.push(a);
    }
    return { flags, positionals };
}
/** "a,b" | ["a","b,c"] | undefined → ['a','b','c'] */
export function listFlag(v) {
    if (v === undefined || v === true || v === false)
        return [];
    return []
        .concat(v)
        .flatMap((x) => String(x).split(','))
        .map((s) => s.trim())
        .filter(Boolean);
}
