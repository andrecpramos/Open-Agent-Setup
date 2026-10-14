// Prompt reading, shared by the prompt-intake hook, the session-eval rows and
// `agent-setup eval-board`: what kind of message a prompt is, how well a task
// prompt says what it wants, and whether the agent should restate it as a brief
// before it starts.
//
// Why: the cheapest place to fix a vague request is before any work starts. A
// prompt that never says how "done" is checked gets an agent that decides for
// itself, and the user finds out at the end. The rubric is the same one the
// eval-board shows people: goal, context, constraints, acceptance, scope.
//
// Pure and dependency-free: node builtins only, nothing runs at import, never
// throws. English and Portuguese, like the correction detector in _transcript.mjs.
// Its TypeScript types are in _prompt.d.mts, which is never installed; keep the
// two in step.

const GOAL_RE =
  /\b(build|create|implement|fix|repair|refactor|rewrite|migrate|add|update|remove|delete|design|write|generate|explain|review|audit|debug|diagnose|test|verify|compare|evaluate|summari[sz]e|document|plan|propose|make|improve|polish|clean|simplify|speed up|ship|deploy|rename|move|split|merge|upgrade|configure|set up|integrate|optimi[sz]e|cria|criar|adiciona|adicionar|corrige|corrigir|implementa|implementar|faz|fazer|muda|mudar|altera|alterar|remove|remover|apaga|apagar|atualiza|atualizar|refatora|refatorar|melhora|melhorar|testa|testar|rev[êe]|rever|escreve|escrever|constr[óo]i|construir|migra|migrar|documenta|documentar|analisa|analisar|verifica|verificar|configura|configurar|integra|integrar|otimiza|otimizar)\b/i;
const CONTEXT_RE =
  /(`[^`]+`|```|\.(mjs|cjs|js|ts|tsx|jsx|json|md|py|go|rs|java|kt|rb|php|cs|css|scss|html|vue|svelte|sql|yml|yaml|toml)\b|\b(repo|codebase|project|file|folder|directory|module|component|service|endpoint|route|page|screen|table|schema|stack|branch|ficheiro|arquivo|pasta|m[óo]dulo|componente|servi[çc]o|p[áa]gina|ecr[ãa]|tabela)\b|\b(in|under|inside|em|no|na|dentro de)\s+[\w./-]+\/[\w./-]*)/i;
const CONSTRAINT_RE =
  /\b(must|must not|never|always|only|keep|avoid|do not|don't|limit|max|at most|no more than|follow|use|prefer|stay (in|on|within)|without|deve|n[ãa]o pode|nunca|sempre|mant[ée]m|manter|evita|evitar|usa|usar|sem|segue|seguir)\b/i;
const ACCEPTANCE_RE =
  /\b(tests?|verify|check|done means|acceptance|expected|should\b.{0,20}(pass|hold|work|return|show)|criteria|confirm|ensure|prove|until|so that|testes?|verifica|confirma|garante|crit[ée]rio|deve (passar|funcionar|mostrar|devolver)|at[ée] que|para que)\b/i;
const SCOPE_RE =
  /\b(only|out of scope|don't touch|do not touch|leave (alone|untouched)|not in scope|excluding|except|just the|no other|s[óo]|apenas|somente|n[ãa]o (mexas|toques|alteres)|fora do [âa]mbito|exceto|excepto)\b/i;
const VAGUE_RE = /\b(something|stuff|things?|somehow|whatever|magic|nicely?|nicer|cleaner|good|better|etc\.?|kind of|sort of|qualquer coisa|coisas?|tipo|melhor|bonito)\b/gi;

// Work where a wrong guess is expensive: the brief names the risk, and the
// change gets a review before it is called done.
const RISKS = [
  ['auth', /\b(auth(entication|orization|orisation)?|log ?in|sign ?in|sign ?up|passwords?|oauth|jwt|(access|refresh|session) tokens?|session cookies?|permissions?|rbac|acl|autentica\w*|permiss[õo]es)\b/i],
  ['payments', /\b(payments?|billing|invoices?|checkout|stripe|refunds?|subscriptions?|pagamentos?|fatura\w*)\b/i],
  ['data', /\b(migrations?|schema change|drop (table|column)|backfill|delete (all|users|records)|truncate|data loss|migra[çc][ãa]o|apagar dados)\b/i],
  ['personal data', /\b(pii|personal data|gdpr|rgpd|dados pessoais)\b/i],
  ['production', /\b(prod|production|deploy(ment)?|rollout|infra(structure)?|terraform|kubernetes|k8s|produ[çc][ãa]o)\b/i],
  ['secrets', /\b(secrets?|api[ -]?keys?|credentials?|\.env|certificates?|segredos?|credenciais)\b/i],
];
const LARGE_RE =
  /\b(feature|end[- ]to[- ]end|from scratch|whole (app|site|module|system)|redesign|refactor (the|all)|migrate (the|all|from)|new (service|module|page|screen|flow)|funcionalidade|de raiz|do zero|redesenh\w*)\b/i;
const QUESTION_START_RE =
  /^(what|why|how|where|when|which|who|whose|is|are|was|were|does|do|did|has|have|explain|o que|que|porqu[êe]|por ?que|como|onde|quando|qual|quais|quem|ser[áa]|explica)\b/i;
// "Can you add…", "please fix…", "I need you to…": a request, not a question.
const REQUEST_RE =
  /^(please|pls|can you|could you|would you|will you|i want|i need|we need|i'?d like|let'?s|lets|go ahead and|podes|pode|consegues|consegue|preciso que|quero que|queria que|vamos|por favor)\b/i;
const REPLY_RE =
  /^(y(es|ep|eah)?|no(pe)?|ok(ay)?|sure|go( ahead)?|do it|continue|proceed|next|done|thanks?|thank you|perfect|great|nice|cool|lgtm|stop|wait|sim|n[ãa]o|certo|claro|continua|avan[çc]a|segue|faz( isso)?|pode|obrigad[oa]|perfeito|[óo]timo|espera|para)\b/i;

/** The words the user typed: IDE and harness context that editors prepend is not the user speaking. */
export function userText(message) {
  return String(message ?? '')
    .replace(/<(ide_[a-z_]+|system-reminder|command-[a-z-]+|local-command-[a-z]+)>[\s\S]*?<\/\1>/g, ' ')
    .trim();
}

const wordsOf = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * What kind of message this is. Only a `task` is scored and briefed.
 *   empty · command (a slash command) · reply (a short answer to the agent) · question · task
 */
export function classifyPrompt(message) {
  const text = userText(message);
  const words = wordsOf(text);
  if (!text) return { kind: 'empty', words: 0 };
  if (text.startsWith('/')) return { kind: 'command', words: words.length };
  const head = text.replace(/```[\s\S]*?```/g, ' ').trim();
  const headWords = wordsOf(head);
  if (headWords.length <= 4 || (headWords.length <= 8 && REPLY_RE.test(head) && !GOAL_RE.test(head))) return { kind: 'reply', words: words.length };
  const opening = headWords.slice(0, 14).join(' ');
  const firstLine = head.split(/\r?\n/)[0] ?? '';
  if (!REQUEST_RE.test(head) && !GOAL_RE.test(headWords.slice(0, 2).join(' ')) && (QUESTION_START_RE.test(head) || (/\?\s*$/.test(firstLine) && !GOAL_RE.test(opening)))) {
    return { kind: 'question', words: words.length };
  }
  return { kind: 'task', words: words.length };
}

/** The rubric: goal 30, context 20, constraints 20, acceptance 20, scope 10, minus vague words. */
export function scorePrompt(prompt) {
  const trimmed = userText(prompt);
  const words = wordsOf(trimmed);
  const checks = [
    { id: 'goal', label: 'States a concrete goal (verb + object)', weight: 30, pass: GOAL_RE.test(trimmed) && words.length >= 4 },
    { id: 'context', label: 'Names context (files, repo, stack)', weight: 20, pass: CONTEXT_RE.test(trimmed) },
    { id: 'constraints', label: 'Sets constraints (must / never / limits)', weight: 20, pass: CONSTRAINT_RE.test(trimmed) },
    { id: 'acceptance', label: 'Defines acceptance (tests, done-means)', weight: 20, pass: ACCEPTANCE_RE.test(trimmed) },
    { id: 'scope', label: 'Bounds the scope (only / out of scope)', weight: 10, pass: SCOPE_RE.test(trimmed) },
  ];
  const vague = (trimmed.match(VAGUE_RE) ?? []).length;
  const penalty = Math.min(vague * 5, 15);
  const score = clamp(checks.reduce((s, k) => s + (k.pass ? k.weight : 0), 0) - penalty, 0, 100);
  const advice = {
    goal: 'Start with an imperative verb and an object: "Add pagination to …", "Fix the race in …".',
    context: 'Name the files, folder or stack the agent should work in (backticks help: `lib/sync.mjs`).',
    constraints: 'Add 1–3 hard constraints: what it must do and what it must never touch.',
    acceptance: 'Say how success is checked: the command, test or observable behaviour.',
    scope: 'Bound the blast radius: "only …", "do not touch …".',
  };
  const suggestions = checks.filter((k) => !k.pass).map((k) => advice[k.id] ?? k.label);
  if (trimmed.length === 0) suggestions.unshift('The prompt is empty — there is nothing for the agent to act on.');
  else if (words.length < 8) suggestions.unshift('Very short prompts force the agent to guess — add the goal object and one constraint.');
  if (vague > 0) suggestions.push(`Replace ${vague} vague word(s) ("something", "stuff", "etc.") with exact names or numbers.`);
  const grade = score >= 85 ? 'A — ready to run' : score >= 70 ? 'B — solid, one gap' : score >= 50 ? 'C — runnable but guessy' : score >= 30 ? 'D — likely to drift' : 'F — rewrite first';
  return { score, grade, words: words.length, vagueWords: vague, checks: checks.map(({ id, label, pass }) => ({ id, label, pass })), suggestions };
}

/** The original prompt plus a scaffold for only the parts it is missing. */
export function improvePrompt(prompt, result) {
  const text = userText(prompt);
  const r = result ?? scorePrompt(text);
  const failed = new Set(r.checks.filter((k) => !k.pass).map((k) => k.id));
  const lines = [`Goal: ${text || '[describe the task]'}`];
  if (failed.has('context')) lines.push('Context: [files/stack — e.g. `lib/sync.mjs`, Node 18]');
  if (failed.has('constraints')) lines.push('Constraints: [must … / must never …]');
  if (failed.has('acceptance')) lines.push('Acceptance: [how to verify — command, test, observable behaviour]');
  if (failed.has('scope')) lines.push('Out of scope: [what not to touch]');
  if (!failed.size) lines.push('Constraints: [already covered — keep them]');
  return lines.join('\n');
}

/** The risky areas a prompt touches, by name ("auth", "payments", …). */
export function risksOf(message) {
  const text = userText(message);
  return RISKS.filter(([, rx]) => rx.test(text)).map(([name]) => name);
}

/**
 * Should the agent restate this prompt as a brief before it starts? Only for a
 * task that is large or touches risky ground; null otherwise. Returns the gaps
 * (what the prompt leaves out), the risks and the size, for the intake note.
 */
export function intakeFor(message) {
  const { kind, words } = classifyPrompt(message);
  if (kind !== 'task' || words < 8) return null;
  const s = scorePrompt(message);
  const pass = Object.fromEntries(s.checks.map((k) => [k.id, k.pass]));
  const missing = ['acceptance', 'context', 'scope'].filter((id) => !pass[id]);
  const risks = risksOf(message);
  const text = userText(message);
  const bullets = (text.match(/^\s*([-*•]|\d+[.)])\s+/gm) ?? []).length;
  const large = words >= 80 || bullets >= 3 || LARGE_RE.test(text);
  // A trigger, not a toll: only large or risky work gets a brief. A vague small request costs
  // little to correct, and a brief on it costs more than the fix.
  if (!risks.length && !large) return null;
  return { score: s.score, words, missing, risks, large };
}

// A task the main conversation would do on its own model, where a cheaper tier's agent does it
// as well: documentation, and building a plan someone already wrote. Measured: a top model given
// either writes it out itself, whatever the agents' descriptions say; a line at the prompt is
// what moves it. Narrow on purpose — a code change that also mentions the README is not a docs
// task, and a plan of fewer than three steps costs less built in place.
const DOCS_RE =
  /^(?:please\s+)?document\b|\bdocumenting\b|\b(?:write|update|add|create|generate|draft|refresh|rewrite|expand)\b[^.\n]{0,50}?\b(?:docs?|documentation|readme|guide|docstrings?|jsdoc|api reference|changelog)\b|^(?:documenta|escreve|atualiza)\b[^.\n]{0,50}?\b(?:docs?|documenta[çc][ãa]o|readme|guia)\b/i;
const CODE_RE = /\b(fix|implement|refactor|build|migrate|feature|bug|broken|crash|error|fails?|optimi[sz]e|corrige|implementa|erro)\b/i;
const PLAN_RE = /\b(plan|steps|plano|passos)\b/i;
const BUILD_RE = /\b(build|implement|apply|execute|carry out|make|constr[óo]i|implementa|aplica)\b/i;

/**
 * The cheaper agent a task is better handed to: `docs` (the doc-writer) for a documentation
 * task with no code change in it, `build` (the implementer) for a plan of three or more steps
 * to build. Null for everything else, which is nearly everything.
 */
export function routeFor(message) {
  const { kind, words } = classifyPrompt(message);
  if (kind !== 'task' || words < 8) return null;
  const text = userText(message);
  const steps = (text.match(/(?:^|\s)(?:\d+[.)]|[-*•])\s+\S/gm) ?? []).length;
  if (steps >= 3 && PLAN_RE.test(text) && BUILD_RE.test(text)) return 'build';
  if (DOCS_RE.test(text) && !CODE_RE.test(text)) return 'docs';
  return null;
}

/**
 * Prompt-quality facts for a window's prompts: how many were tasks, their mean
 * score, and how many said how done is checked and what is out of scope.
 */
export function promptFacts(prompts) {
  const tasks = (Array.isArray(prompts) ? prompts : [])
    .map((p) => (typeof p === 'string' ? p : p?.text))
    .filter((t) => typeof t === 'string' && classifyPrompt(t).kind === 'task')
    .map((t) => scorePrompt(t));
  const has = (id) => tasks.filter((s) => s.checks.find((k) => k.id === id)?.pass).length;
  return {
    tasks: tasks.length,
    mean_score: tasks.length ? Math.round(tasks.reduce((a, s) => a + s.score, 0) / tasks.length) : null,
    with_acceptance: has('acceptance'),
    with_scope: has('scope'),
  };
}
