// Survey a target project from its manifests and git state. Everything here is
// "detected" in the sdlc-init sense — read from the tree, never invented — and it
// is only used to pre-fill AGENTS.md and a provisional sdlc config, which
// /sdlc-init then verifies against CI.

import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { git, readJsonFile, readText, isDir } from './util.mjs';

/** A package.json shape as read for detection. */
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

/** Everything detected about a target project. */
export interface DetectedProject {
  name: string;
  isGit: boolean;
  defaultBranch: string | null;
  integration: string | null;
  production?: string;
  packageManager: string | null;
  stack: string[];
  commands: string[][];
  ci: string[];
  llm: boolean;
  frontend: boolean;
  backend: boolean;
  /** The project already shows Claude Code use (.claude/ or CLAUDE.md): it gets the claude target by default. */
  usesClaude: boolean;
  /** Other agents with hooks the project already shows (their config folders or instruction files): each gets its target by default. */
  agents: string[];
}

const has = (dir: string, f: string): boolean => existsSync(join(dir, f));

// What shows a project already uses an agent: its config folder or its instruction files.
// (.agents/ alone shows nothing: it is the shared home, and the kit writes it.)
const AGENT_MARKERS: Record<string, string[]> = {
  codex: ['.codex'],
  cursor: ['.cursor', '.cursorrules'],
  copilot: ['.github/copilot-instructions.md', '.github/hooks', '.github/instructions', '.github/prompts', '.github/agents', '.github/skills'],
  antigravity: ['.agents/rules', '.agents/workflows', '.gemini', 'GEMINI.md'],
  windsurf: ['.windsurf', '.windsurfrules', '.devin'],
};

const JS_MARKERS: Array<[string, string]> = [
  ['next', 'Next.js'],
  ['react', 'React'],
  ['react-native', 'React Native'],
  ['expo', 'Expo'],
  ['vue', 'Vue'],
  ['nuxt', 'Nuxt'],
  ['svelte', 'Svelte'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['@angular/core', 'Angular'],
  ['solid-js', 'Solid'],
  ['astro', 'Astro'],
  ['@remix-run/react', 'Remix'],
  ['electron', 'Electron'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['@nestjs/core', 'NestJS'],
  ['hono', 'Hono'],
  ['koa', 'Koa'],
  ['@trpc/server', 'tRPC'],
  ['graphql', 'GraphQL'],
  ['prisma', 'Prisma'],
  ['@prisma/client', 'Prisma'],
  ['drizzle-orm', 'Drizzle'],
  ['typeorm', 'TypeORM'],
  ['mongoose', 'Mongoose'],
  ['@tanstack/react-query', 'TanStack Query'],
  ['tailwindcss', 'Tailwind CSS'],
  ['vite', 'Vite'],
  ['vitest', 'Vitest'],
  ['jest', 'Jest'],
  ['@playwright/test', 'Playwright'],
  ['cypress', 'Cypress'],
  ['storybook', 'Storybook'],
  ['@anthropic-ai/sdk', 'Anthropic SDK'],
  ['@anthropic-ai/claude-agent-sdk', 'Claude Agent SDK'],
  ['openai', 'OpenAI SDK'],
  ['ai', 'Vercel AI SDK'],
  ['langchain', 'LangChain'],
  ['@langchain/core', 'LangChain'],
  ['typescript', 'TypeScript'],
];

const PY_MARKERS: Array<[string, string]> = [
  ['django', 'Django'],
  ['fastapi', 'FastAPI'],
  ['flask', 'Flask'],
  ['sqlalchemy', 'SQLAlchemy'],
  ['pydantic', 'Pydantic'],
  ['pytest', 'pytest'],
  ['anthropic', 'Anthropic SDK'],
  ['openai', 'OpenAI SDK'],
  ['langchain', 'LangChain'],
];

export function detectProject(dir: string): DetectedProject {
  const d: DetectedProject = {
    name: basename(dir),
    isGit: git(dir, 'rev-parse', '--is-inside-work-tree') === 'true',
    defaultBranch: null,
    integration: null,
    packageManager: null,
    stack: [],
    commands: [],
    ci: [],
    llm: false,
    frontend: false,
    backend: false,
    usesClaude: has(dir, '.claude') || has(dir, 'CLAUDE.md'),
    agents: Object.entries(AGENT_MARKERS)
      .filter(([, markers]) => markers.some((m) => has(dir, m)))
      .map(([agent]) => agent),
  };

  // --- git --------------------------------------------------------------
  if (d.isGit) {
    const originHead = git(dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
    const locals = (git(dir, 'branch', '--format=%(refname:short)') ?? '').split(/\r?\n/).filter(Boolean);
    const remotes = (git(dir, 'branch', '-r', '--format=%(refname:short)') ?? '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((r) => r.replace(/^[^/]+\//, ''));
    const all = new Set([...locals, ...remotes]);
    if (originHead) d.defaultBranch = originHead.replace(/^[^/]+\//, '');
    const prodCandidate = ['main', 'master', 'trunk', 'production'].find((b) => all.has(b));
    const integration = ['develop', 'dev', 'development'].find((b) => all.has(b));
    d.integration = integration ?? null;
    // With a develop line, production is the classic main/master even when the
    // remote HEAD points at develop (the two-trunk recommendation).
    d.production = integration ? (prodCandidate ?? 'main') : (d.defaultBranch ?? prodCandidate ?? git(dir, 'rev-parse', '--abbrev-ref', 'HEAD') ?? 'main');
    if (d.production === 'HEAD') d.production = 'main';
  }

  // --- Node ---------------------------------------------------------------
  const pkg = readJsonFile(join(dir, 'package.json')).value as PackageJson | null;
  if (pkg) {
    d.packageManager = has(dir, 'pnpm-lock.yaml')
      ? 'pnpm'
      : has(dir, 'yarn.lock')
        ? 'yarn'
        : has(dir, 'bun.lockb') || has(dir, 'bun.lock')
          ? 'bun'
          : 'npm';
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
    const found = new Set(['Node.js']);
    for (const [dep, label] of JS_MARKERS) if (dep in deps) found.add(label);
    if (Object.keys(deps).some((k) => k.startsWith('@storybook/'))) found.add('Storybook');
    d.stack.push(...found);
    const pm = d.packageManager;
    const run = (s: string): string => (pm === 'npm' ? `npm run ${s}` : pm === 'yarn' ? `yarn ${s}` : `${pm} run ${s}`);
    const install =
      pm === 'pnpm'
        ? 'pnpm install --frozen-lockfile'
        : pm === 'yarn'
          ? 'yarn install --immutable'
          : pm === 'bun'
            ? 'bun install --frozen-lockfile'
            : has(dir, 'package-lock.json')
              ? 'npm ci'
              : 'npm install';
    d.commands.push(['Install', install]);
    const scripts = pkg.scripts ?? {};
    const pick = (label: string, names: string[]): void => {
      const n = names.find((x) => x in scripts);
      if (n) d.commands.push([label, run(n)]);
    };
    pick('Dev server', ['dev', 'start:dev', 'serve', 'start']);
    pick('Build', ['build']);
    pick('Test', ['test', 'test:unit']);
    pick('E2E', ['test:e2e', 'e2e']);
    pick('Lint', ['lint']);
    pick('Typecheck', ['typecheck', 'type-check', 'tsc', 'check-types', 'types']);
    pick('Format', ['format', 'fmt']);
    d.frontend = ['React', 'Vue', 'Svelte', 'Angular', 'Next.js', 'Nuxt', 'Solid', 'Astro', 'React Native', 'Expo'].some((x) => found.has(x));
    d.backend = ['Express', 'Fastify', 'NestJS', 'Hono', 'Koa', 'Prisma', 'Drizzle', 'TypeORM', 'Mongoose', 'tRPC'].some((x) => found.has(x));
    d.llm = ['Anthropic SDK', 'Claude Agent SDK', 'OpenAI SDK', 'Vercel AI SDK', 'LangChain'].some((x) => found.has(x));
  }

  // --- Python -------------------------------------------------------------
  const pyproject = readText(join(dir, 'pyproject.toml'));
  const requirements = readText(join(dir, 'requirements.txt'));
  if (pyproject !== null || requirements !== null) {
    const text = `${pyproject ?? ''}\n${requirements ?? ''}`.toLowerCase();
    d.stack.push('Python');
    for (const [marker, label] of PY_MARKERS) if (new RegExp(`\\b${marker}\\b`).test(text)) d.stack.push(label);
    const uv = has(dir, 'uv.lock');
    const poetry = has(dir, 'poetry.lock');
    d.packageManager ??= uv ? 'uv' : poetry ? 'poetry' : 'pip';
    d.commands.push(['Install (Python)', uv ? 'uv sync' : poetry ? 'poetry install' : requirements !== null ? 'pip install -r requirements.txt' : 'pip install -e .']);
    if (/\bpytest\b/.test(text)) d.commands.push(['Test (Python)', uv ? 'uv run pytest' : poetry ? 'poetry run pytest' : 'pytest']);
    if (/\bruff\b/.test(text)) d.commands.push(['Lint (Python)', uv ? 'uv run ruff check .' : 'ruff check .']);
    if (/\bmypy\b/.test(text)) d.commands.push(['Typecheck (Python)', uv ? 'uv run mypy .' : 'mypy .']);
    d.backend ||= /\b(django|fastapi|flask)\b/.test(text);
    d.llm ||= /\b(anthropic|openai|langchain)\b/.test(text);
  }

  // --- Others ---------------------------------------------------------------
  if (has(dir, 'go.mod')) {
    d.stack.push('Go');
    d.packageManager ??= 'go';
    d.commands.push(['Build (Go)', 'go build ./...'], ['Test (Go)', 'go test ./...'], ['Vet (Go)', 'go vet ./...']);
    d.backend = true;
  }
  if (has(dir, 'Cargo.toml')) {
    d.stack.push('Rust');
    d.packageManager ??= 'cargo';
    d.commands.push(['Build (Rust)', 'cargo build'], ['Test (Rust)', 'cargo test'], ['Lint (Rust)', 'cargo clippy -- -D warnings']);
  }
  if (has(dir, 'pom.xml')) {
    d.stack.push('Java', 'Maven');
    d.packageManager ??= 'maven';
    d.commands.push(['Test (Maven)', has(dir, 'mvnw') ? './mvnw test' : 'mvn test']);
    d.backend = true;
  }
  if (has(dir, 'build.gradle') || has(dir, 'build.gradle.kts')) {
    d.stack.push('Gradle');
    d.packageManager ??= 'gradle';
    d.commands.push(['Test (Gradle)', has(dir, 'gradlew') ? './gradlew test' : 'gradle test']);
    d.backend = true;
  }
  try {
    if (readdirSync(dir).some((f) => f.endsWith('.sln') || f.endsWith('.csproj'))) {
      d.stack.push('.NET');
      d.packageManager ??= 'dotnet';
      d.commands.push(['Build (.NET)', 'dotnet build'], ['Test (.NET)', 'dotnet test']);
      d.backend = true;
    }
  } catch {
    // unreadable dir
  }
  if (has(dir, 'Gemfile')) d.stack.push('Ruby');
  if (has(dir, 'composer.json')) d.stack.push('PHP');
  if (has(dir, 'pubspec.yaml')) {
    d.stack.push('Dart/Flutter');
    d.frontend = true;
  }
  if (has(dir, 'Dockerfile') || has(dir, 'docker-compose.yml') || has(dir, 'compose.yaml')) d.stack.push('Docker');

  // --- CI -----------------------------------------------------------------
  if (isDir(join(dir, '.github', 'workflows'))) {
    try {
      for (const f of readdirSync(join(dir, '.github', 'workflows'))) if (/\.ya?ml$/.test(f)) d.ci.push(`.github/workflows/${f}`);
    } catch {
      // ignore
    }
  }
  for (const f of ['.gitlab-ci.yml', 'Jenkinsfile', 'azure-pipelines.yml', 'bitbucket-pipelines.yml', '.circleci/config.yml']) {
    if (has(dir, f)) d.ci.push(f);
  }

  d.stack = [...new Set(d.stack)];
  return d;
}

/** Suggest a profile from what was detected. The user can always override. */
export function suggestProfile(d: DetectedProject): string {
  if (d.llm) return 'ai-app';
  if (d.frontend && d.backend) return 'web';
  if (d.frontend) return 'frontend';
  if (d.backend) return 'service';
  return 'standard';
}
