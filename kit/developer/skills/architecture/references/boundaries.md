# Boundaries: seeing them and enforcing them

## Contents

1. Deriving the real dependency graph
2. Enforcement tools by ecosystem
3. Structural patterns
4. How modules should talk
5. Measuring coupling

## 1 · Deriving the real dependency graph

Start from the code; the diagram in the docs is a hypothesis.

```bash
# Which modules does module X import? (TS/JS, adjust the paths)
rg -o "from ['\"](@/|\.\./)*(modules|packages)/[a-z-]+" src/modules/orders | sort | uniq -c

# Cycles and a graph (if available)
npx madge --circular --extensions ts,tsx src
npx depcruise src --output-type err-long

# Python
rg -o "^(from|import) app\.[a-z_]+" app/orders | sort | uniq -c
lint-imports                      # import-linter, if configured

# Go
go list -deps ./internal/orders/... | rg "your/module/path"

# Java/Kotlin: jdeps, or read the package imports
rg -o "^import com\.acme\.[a-z]+" src/main/java/com/acme/orders | sort | uniq -c
```

Record the result as a matrix of "module → modules it imports". Every arrow pointing the
wrong way is a finding, with a count.

## 2 · Enforcement tools

A boundary is real when a check fails in CI if it is crossed. Use what the project has:

| Ecosystem | Tool | What to configure |
|---|---|---|
| TS/JS | dependency-cruiser | `forbidden` rules: `from: { path: "^src/domain" }, to: { path: "^src/infrastructure" }`; `no-circular` |
| TS/JS | ESLint `import/no-restricted-paths` or `eslint-plugin-boundaries` | zones per layer/module |
| Nx monorepo | `@nx/enforce-module-boundaries` | tags per project, `depConstraints` |
| TS | project references | each layer its own `tsconfig` with explicit `references` |
| Python | import-linter | `layers` and `forbidden` contracts |
| Java/Kotlin | ArchUnit / Spring Modulith `verify()` | layer rules, "no classes in ..domain.. depend on ..infrastructure.." |
| .NET | NetArchTest / ArchUnitNET | same, as unit tests |
| Go | `internal/` packages + depguard (golangci-lint) | deny lists per package |

Wire the check into the gates (`.agents/sdlc.config.json`) as a blocking gate, and — per the
sdlc method — make it fail once on purpose to prove it reads what it claims to.

## 3 · Structural patterns

- **Layered / clean / hexagonal** — domain at the centre with no framework imports;
  application services orchestrate use cases; adapters (HTTP, DB, messaging, vendors)
  implement ports the domain defines.
- **Modular monolith** — modules by business capability, each with a small public API
  (facade, published interfaces, events) and everything else internal; one deployable.
- **Vertical slices** — code organised per feature/use case end to end; shared code only
  when a second slice genuinely needs it.
- **Services** — separate deployables with their own data; justified by the forces in the
  SKILL.md heuristics.

The pattern matters less than consistency: one codebase using three patterns is harder than
any single one.

## 4 · How modules should talk

- **Through the public API** of a module (facade/service interface), never its repositories
  or tables.
- **Domain events** for "something happened, others may react" — in process for a modular
  monolith (with an outbox if reactions must survive a crash), via a broker between services.
- **The inner layer registers; it never enumerates.** No `switch` over the kinds of outer
  things in the core — a new case should be a registration, not a core edit.
- **Shared kernel** only for genuinely universal types (money, ids, time); keep it tiny.

## 5 · Measuring coupling

- **Change coupling** — files that change together across modules signal a hidden dependency:

  ```bash
  git log --since=6.months --name-only --pretty=format: | rg "^src/" | sort | uniq -c | sort -rn | head
  ```

  For pairs, a tool like code-maat, or a short script over `git log --name-only`.
- **Fan-in/fan-out** — a module imported by everything is either a legitimate kernel or a
  dumping ground; one importing everything is an orchestrator or a god module.
- **Cycles** — always a defect between modules; break them with an event, an interface
  owned by the inner module, or by moving the shared piece down.
