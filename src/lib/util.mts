// Small filesystem and process helpers shared by every command. No dependencies.
//
// Source of `lib/util.mjs` — edit here, then `npm run build`. Never hand-edit the output.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export const toPosix = (p: string): string => String(p).split(sep).join('/').replace(/\\/g, '/');

export const exists = (p: string): boolean => existsSync(p);

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Read a UTF-8 text file without its BOM, or null when it does not exist. */
export function readText(p: string): string | null {
  try {
    return readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

export interface JsonReadResult<T = unknown> {
  value: T | null;
  error: string | null;
  missing: boolean;
}

export function readJsonFile(p: string): JsonReadResult {
  const text = readText(p);
  if (text === null) return { value: null, error: null, missing: true };
  try {
    return { value: JSON.parse(text) as unknown, error: null, missing: false };
  } catch (err) {
    return { value: null, error: (err as Error).message, missing: false };
  }
}

export function writeText(p: string, content: string): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

export function writeJson(p: string, value: unknown): void {
  writeText(p, `${JSON.stringify(value, null, 2)}\n`);
}

export function copyFile(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

/**
 * Content hash that ignores line-ending differences, so a checkout with
 * core.autocrlf=true is not reported as "locally modified" on every file.
 * Binary content (anything with a NUL byte) is hashed as-is.
 */
export function hashBuffer(buf: Buffer): string {
  const isBinary = buf.includes(0);
  const data = isBinary ? buf : Buffer.from(buf.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha256').update(data).digest('hex').slice(0, 32);
}

export function hashFile(p: string): string | null {
  try {
    return hashBuffer(readFileSync(p));
  } catch {
    return null;
  }
}

export const hashText = (text: string): string => hashBuffer(Buffer.from(text, 'utf8'));

const SKIP_DIRS: Set<string> = new Set(['node_modules', '.git', '.state', '__pycache__']);

/** Recursive file list, POSIX paths relative to `dir`, sorted. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || e.name.endsWith('-workspace')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(toPosix(relative(dir, full)));
    }
  };
  walk(dir);
  return out.sort();
}

/** Remove now-empty directories from `start` upward, stopping at `stopAt`. */
export function pruneEmptyDirs(start: string, stopAt: string): void {
  let d = start;
  const stop = stopAt.replace(/[\\/]+$/, '');
  while (d.length > stop.length && d.startsWith(stop)) {
    try {
      if (readdirSync(d).length) return;
      rmdirSync(d);
    } catch {
      return;
    }
    d = dirname(d);
  }
}

export function git(cwd: string, ...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
  } catch {
    return null;
  }
}

export const today = (): string => new Date().toISOString().slice(0, 10);

// --- Output ---------------------------------------------------------------

const useColor: boolean = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
type Painter = (s: string) => string;
const paint = (code: number): Painter => (s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : String(s));
export const c: Record<'bold' | 'dim' | 'red' | 'green' | 'yellow' | 'cyan', Painter> = {
  bold: paint(1),
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  cyan: paint(36),
};

export const say = (...lines: unknown[]): void => {
  for (const l of lines) process.stdout.write(`${l}\n`);
};

export class CliError extends Error {
  exitCode: number;
  constructor(message: string, code = 1) {
    super(message);
    this.exitCode = code;
  }
}

export type FlagValue = string | boolean | Array<string | boolean>;
export interface ParsedArgs {
  flags: Record<string, FlagValue>;
  positionals: string[];
}

/** Minimal argv parser: positionals, --flag, --key value, --key=value, repeated keys → arrays. */
export function parseArgs(argv: string[], { booleans = [] }: { booleans?: string[] } = {}): ParsedArgs {
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];
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
      let value: FlagValue;
      if (eq > 0) value = a.slice(eq + 1);
      else if (key.startsWith('no-') && !bool.has(key)) {
        key = key.slice(3);
        value = false;
      } else if (bool.has(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) value = true;
      else value = argv[++i];
      if (key in flags && value !== true && value !== false) {
        flags[key] = ([] as Array<string | boolean>).concat(flags[key], value);
      } else flags[key] = value;
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
export function listFlag(v: FlagValue | undefined): string[] {
  if (v === undefined || v === true || v === false) return [];
  return ([] as unknown[])
    .concat(v)
    .flatMap((x) => String(x).split(','))
    .map((s) => s.trim())
    .filter(Boolean);
}
