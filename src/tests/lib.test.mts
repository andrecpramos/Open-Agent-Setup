// Unit tests for the pure parts of lib/: routing verdicts and the Agent Skills spec checks
// used by vendoring.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { activations, verdict, resolveScope } from '../lib/routing.mjs';
import { frontmatterValue, specProblems } from '../lib/vendor.mjs';
import { resolveSelection, loadCatalog } from '../lib/catalog.mjs';

// ---------------------------------------------------------------------------
describe('routing: which skills an agent activated', () => {
  const known: Set<string> = new Set(['frontend-design-workflow', 'design-md-library', 'brandkit', 'backend']);
  const line = (o: unknown): string => JSON.stringify(o);

  test('counts a Skill tool call and an opened SKILL.md, in order', () => {
    const stream = [
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'agent-setup:frontend-design-workflow' } }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:/kit/skills/design-md-library/SKILL.md' } }] } }),
    ].join('\n');
    assert.deepEqual(activations(stream, known), ['frontend-design-workflow', 'design-md-library']);
  });

  test('ignores skills merely mentioned in tool results', () => {
    const stream = line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'see ../brandkit/SKILL.md and ../backend/SKILL.md' }] } });
    assert.deepEqual(activations(stream, known), []);
  });

  test('ignores unknown names and non-JSON lines', () => {
    const stream = ['not json', line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'other' } }] } })].join('\n');
    assert.deepEqual(activations(stream, known), []);
  });
});

describe('routing: verdicts judge only the suite scope', () => {
  const scope: Set<string> = new Set(['a', 'b', 'c']);

  test('the first scoped skill must be one of `first`; out-of-scope skills are ignored', () => {
    assert.equal(verdict({ first: ['a'] }, ['backend', 'a', 'b'], scope), null);
    assert.match(verdict({ first: ['a'] }, ['b', 'a'], scope)!, /first skill b, expected one of a/);
    assert.equal(verdict({ first: ['a'] }, [], scope), 'no scoped skill activated');
  });

  test('`none` allows only out-of-scope skills; `forbid` names skills that must not fire', () => {
    assert.equal(verdict({ none: true }, ['backend'], scope), null);
    assert.match(verdict({ none: true }, ['c'], scope)!, /expected no scoped skill, got c/);
    assert.match(verdict({ first: ['a'], forbid: ['c'] }, ['a', 'c'], scope)!, /forbidden skill activated: c/);
  });

  test('@group scopes expand from the catalog', () => {
    const design = resolveScope(['@design']);
    assert.ok(design.has('design-taste-frontend'));
    assert.ok(design.has('agent-browser'));
    assert.equal(design.has('backend'), false);
  });
});

// ---------------------------------------------------------------------------
describe('vendoring: frontmatter and the Agent Skills spec', () => {
  const skill = (fm: string): string => `---\n${fm}\n---\n\n# body\n`;

  test('reads plain, quoted and folded values', () => {
    const text = skill('name: demo-skill\ndescription: >\n  Does one thing.\n  Use when testing.\nlicense: "MIT (see ../../licenses/x.txt)"');
    assert.equal(frontmatterValue(text, 'name'), 'demo-skill');
    assert.equal(frontmatterValue(text, 'description'), 'Does one thing. Use when testing.');
    assert.equal(frontmatterValue(text, 'license'), 'MIT (see ../../licenses/x.txt)');
    assert.equal(frontmatterValue(text, 'compatibility'), null);
  });

  test('a valid skill has no problems', () => {
    assert.deepEqual(specProblems(skill('name: demo-skill\ndescription: Does one thing. Use when testing.'), 'demo-skill'), []);
  });

  test('flags a name that differs from its folder, a Claude-only key and an over-long description', () => {
    const problems = specProblems(skill(`name: demo-skill\ndescription: ${'x'.repeat(1100)}\ncontext: fork`), 'other-name');
    assert.ok(problems.some((p) => /must equal its folder/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /description must be 1-1024 chars \(is 1100\)/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /"context" is not in the Agent Skills spec/.test(p)), problems.join('\n'));
  });
});

// ---------------------------------------------------------------------------
describe('selection: profiles and groups', () => {
  const catalog = loadCatalog();
  const names = (sel: { skills: Array<{ name: string }> }): string[] => sel.skills.map((s) => s.name);

  test('the default profile is standard: the general domain skills, the workflow and the admin skills; nothing opt-in', () => {
    const sel = resolveSelection(catalog, {});
    assert.equal(sel.profile, 'standard');
    assert.deepEqual(sel.roles, ['developer', 'admin']);
    assert.ok(names(sel).includes('backend'));
    assert.ok(names(sel).includes('self-improve'));
    for (const s of ['design-system', 'agent-eval', 'design-taste-frontend']) assert.equal(names(sel).includes(s), false, s);
    assert.equal(sel.skills.find((s) => s.name === 'self-improve')!.role, 'admin');
    assert.equal(sel.skills.find((s) => s.name === 'backend')!.role, 'developer');
  });

  test('roles filter the selection: developer alone has no admin skill or agent; admin alone has nothing else', () => {
    const dev = resolveSelection(catalog, { roles: ['developer'] });
    assert.equal(dev.skills.some((s) => s.role === 'admin'), false);
    assert.equal(dev.agents.some((a) => a.name === 'docs-keeper'), false);
    const admin = resolveSelection(catalog, { roles: ['admin'] });
    assert.deepEqual(names(admin), ['enforcement-audit', 'sdlc-init', 'self-improve']);
    assert.deepEqual(admin.agents.map((a) => a.name), ['docs-keeper']);
    assert.throws(() => resolveSelection(catalog, { roles: ['manager'] }), /unknown role "manager"/);
  });

  test('@design adds the group, a pack prefix left from 1.0 is accepted, exclude wins', () => {
    const sel = resolveSelection(catalog, { profile: 'minimal', skills: ['@design', 'frontend-kit:design-system'], exclude: ['agent-browser'] });
    assert.ok(names(sel).includes('design-taste-frontend'));
    assert.ok(names(sel).includes('design-system'));
    assert.equal(names(sel).includes('agent-browser'), false);
    assert.equal(sel.skills.find((s) => s.name === 'design-taste-frontend')!.group, 'design');
  });

  test('agents come only with the skills they require', () => {
    const minimal = resolveSelection(catalog, { profile: 'minimal' });
    assert.deepEqual(minimal.agents.map((a) => a.name).sort(), ['code-reviewer', 'doc-writer', 'docs-keeper', 'gate-runner', 'implementer', 'planner', 'scout'], 'the agents that require no skill come with every profile');
    const noScout = resolveSelection(catalog, { profile: 'minimal', exclude: ['scout'] });
    assert.deepEqual(noScout.agents.map((a) => a.name).sort(), ['code-reviewer', 'doc-writer', 'docs-keeper', 'gate-runner', 'implementer', 'planner']);
  });
});
