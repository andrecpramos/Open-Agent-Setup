// A deliberately small YAML-frontmatter reader: enough to lint SKILL.md and agent
// files (top-level keys, scalars, block scalars, simple lists, nested maps) without
// taking a dependency. It reports what it cannot parse instead of guessing.

/** The result of parsing frontmatter from a text file. */
export interface FrontmatterResult {
  data: Record<string, unknown> | null;
  error: string | null;
  body: string;
  bodyStart: number;
}

export function parseFrontmatter(text: unknown): FrontmatterResult {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const lines = src.split(/\r?\n/);
  if (lines[0] !== '---') return { data: null, error: 'no frontmatter: the first line must be ---', body: src, bodyStart: 0 };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { data: null, error: 'frontmatter is not closed with ---', body: src, bodyStart: 0 };

  const fm = lines.slice(1, end);
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  let i = 0;

  const indentOf = (l: string): number => l.length - l.trimStart().length;

  while (i < fm.length) {
    const line = fm[i];
    if (!line.trim() || line.trimStart().startsWith('#')) {
      i++;
      continue;
    }
    if (indentOf(line) > 0) {
      errors.push(`line ${i + 2}: unexpected indentation`);
      i++;
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!m) {
      errors.push(`line ${i + 2}: expected "key: value"`);
      i++;
      continue;
    }
    const key = m[1];
    const rest = m[2].trim();
    i++;

    if (/^[>|][+-]?$/.test(rest)) {
      // Block scalar: collect indented lines.
      const block: string[] = [];
      while (i < fm.length && (fm[i].trim() === '' || indentOf(fm[i]) > 0)) {
        block.push(fm[i]);
        i++;
      }
      const minIndent = Math.min(...block.filter((l) => l.trim()).map(indentOf), Infinity);
      const body = block.map((l) => l.slice(Number.isFinite(minIndent) ? minIndent : 0));
      data[key] = rest.startsWith('>')
        ? body
            .join('\n')
            .split(/\n{2,}/)
            .map((p) => p.replace(/\n/g, ' ').trim())
            .join('\n')
            .trim()
        : body.join('\n').trim();
      continue;
    }

    if (rest === '') {
      // A list or a nested map follows (or an empty value).
      const items: Array<string | boolean> = [];
      const map: Record<string, string | boolean> = {};
      let isList = false;
      let isMap = false;
      while (i < fm.length && (fm[i].trim() === '' || indentOf(fm[i]) > 0)) {
        const t = fm[i].trim();
        if (t.startsWith('- ')) {
          isList = true;
          items.push(unquote(t.slice(2).trim()));
        } else if (/^[A-Za-z0-9_-]+:/.test(t)) {
          isMap = true;
          const [k, ...v] = t.split(':');
          map[k.trim()] = unquote(v.join(':').trim());
        }
        i++;
      }
      data[key] = isList ? items : isMap ? map : '';
      continue;
    }

    if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      continue;
    }

    data[key] = unquote(rest);
  }

  return {
    data,
    error: errors.length ? errors.join('; ') : null,
    body: lines.slice(end + 1).join('\n'),
    bodyStart: end + 1,
  };
}

function unquote(s: string): string | boolean {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1);
    return s.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n') : inner.replace(/''/g, "'");
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}
