# Release the kit

For whoever maintains the kit, with any agent or by hand: follow it to cut a version — when the
Unreleased section of the changelog is worth shipping, or an agent is asked to "release", "cut a
version" or "update all my projects".

## 1 · Gate

```bash
npm run check                               # lint (0 errors) + every test
node bin/agent-setup.mjs vendor status      # did a vendored repo move? (exit 1 if so)
```

Stop on any failure of the first. If a vendored repository moved, report it — taking a
`vendor sync` is a separate decision, never part of a release.

### Evals

A description, a router table or a skill body changed since the last release? Rerun the suites
it could move — the skill's own, and every suite when a description changed (a description edit
can steal prompts from another skill):

```bash
node bin/agent-setup.mjs eval-routing --suite all --save                 # every suite, ~30 min
node bin/agent-setup.mjs eval-routing --suite all --skill <name> --save  # one skill's buckets
node bin/agent-setup.mjs eval-outcomes --skill <name> --save             # content changed: kit vs vanilla
node bin/agent-setup.mjs evals --check                                   # latest vs baseline
```

A skill whose content changed gets its outcome suite rerun: the kit arm must hold against the
baseline, and the lift over vanilla must not drop (`evals` prints it per skill).

`evals --check` fails on a regression beyond sampling noise. Read the failing cases before
anything else. If the change is intended (a case was wrong, a near-miss moved on purpose), fix
the case or accept it with `node bin/agent-setup.mjs evals --promote`, and say so in the
changelog. Never promote to make a red gate green without reading why it went red. Commit the
scorecards with the release.

## 2 · Choose the version

From `CHANGELOG.md` → **Unreleased**:

| Change | Bump |
|---|---|
| wording, examples, new eval cases, bug fixes that keep behaviour | patch |
| new guidance, new skill, new CLI option, new hook behaviour behind a default-on setting | minor |
| changed manifest/settings format, removed skill, renamed files, anything that needs a manual step in projects | major |

## 3 · Bump the version

- `package.json` `version` — the kit's one version
- `CHANGELOG.md`: rename **Unreleased** to `## x.y.z — YYYY-MM-DD`, start a new empty
  Unreleased section.

Run `npm run check` again.

## 4 · Preview the rollout

```bash
node bin/agent-setup.mjs status --all
node bin/agent-setup.mjs update --all --dry-run
```

Report per project: files that will change, and **conflicts** — kit files a project modified
locally (they will get `.kit-new` files instead of updates).

## 5 · Roll out — only when the user says so

```bash
node bin/agent-setup.mjs update --all
```

Then list the projects with `.kit-new` files to merge. Committing in each project is that
project's business — do not commit there unless asked.

## 6 · Publish — only when asked

Two protected branches. Every change, a release included, lands on `develop` through a pull
request whose four CI checks pass (Ubuntu and Windows, Node 18 and 22). `main` is production —
what `git clone`, `git pull` and `npx github:` give adopters — and moves only when `develop` is
promoted to it; CI fails a pull request into `main` from any other branch. On both, no approval
is required; history stays linear, and force-pushes and deletion are refused, for admins too.

```bash
# the release lands on develop, like any change
git switch develop && git pull --ff-only
git switch -c release/x.y.z && git commit -am "chore(release): x.y.z" && git push -u origin HEAD
gh pr create --base develop --fill && gh pr merge --squash --auto --delete-branch   # merges once CI is green

# develop is promoted to main: a pull request for the checks, then a fast-forward
git switch develop && git pull --ff-only
gh pr create --base main --head develop --title "Release x.y.z" --body "Promotes develop to main."
gh pr checks --watch
git push origin develop:main                 # GitHub marks the pull request merged
git switch main && git pull --ff-only
git tag -a vx.y.z -m "x.y.z" && git push origin vx.y.z
gh release create vx.y.z --title "x.y.z" --notes-file <the changelog section, for adopters>
```

Never merge the promotion pull request with the button or `gh pr merge`: squash and rebase both
rewrite the commits, so `main` and `develop` would part ways and the next promotion would
conflict. A fast-forward gives `main` develop's commits unchanged. Never delete `develop`: its
protection refuses deletion, and that is also what keeps the repository's delete-on-merge
setting off it, since GitHub counts the promotion pull request as merged.

The tag is what adopters update to.
