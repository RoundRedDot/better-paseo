import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { aliases, extensions, paths, root, serverBundle, loadServer } from './harness.mjs';
import { inputs } from './cases.mjs';
// Disable Shiki's load-sensitive line timeout so this golden compares grammar output.
const handler = loadServer(await serverBundle({ tokenizeTimeLimit: 0 }));
// Markdown must be the FIRST highlight in a fresh engine: freezes fenced output before other requests.
const cases = inputs();
cases.sort((a, b) => Number(b.name === 'markdown-true') - Number(a.name === 'markdown-true'));
const outputs = [];
for (const item of cases) outputs.push({ ...item, output: await handler(item.input) });
const loaded = globalThis.__p4.highlighter.getLoadedLanguages().sort();
const grammars = (await Promise.all(paths.map(p => import(p)))).flatMap(m => m.default);
const hints = [...new Set([...Object.keys(aliases), ...Object.keys(extensions), ...grammars.flatMap(g => [g.name, ...(g.aliases ?? [])])])].sort();
const resolver = [];
for (const hint of hints) {
  for (const language of [hint, ` ${hint.toUpperCase()} `]) {
    const input = { code: 'x', language, filename: 'fallback.py', dark: true };
    resolver.push({ input, language: (await handler(input)).language });
  }
  for (const input of [
    { code: 'x', language: `src/example.${hint}`, dark: true },
    { code: 'x', filename: `C:\\src\\EXAMPLE.${hint.toUpperCase()}`, dark: true },
  ]) resolver.push({ input, language: (await handler(input)).language });
}
for (const input of [
  { language: 'typescript', filename: 'other.py' }, { language: 'unknown', filename: 'file.ts' },
  { language: 'text', filename: 'file.ts' }, { language: ' ', filename: 'file.mts' },
  { filename: '/app/Dockerfile' }, { filename: 'Dockerfile.dev' }, { language: 'Dockerfile' },
  { filename: '.ts' }, { filename: 'main.ts:10' }, { filename: ' main.ts ' },
  { language: 'src\\main.cjs' }, {},
]) { const request = { code: 'x', dark: true, ...input }; resolver.push({ input: request, language: (await handler(request)).language }); }
const snapshot = { revision: 'c8ed5c7efd0bd29ea65ad560312e81e1ccad927d', shiki: '4.4.3', loaded, resolver, cases: outputs };
const fixture = path.join(root, 'test/fixtures/p4-highlight/eager.json');
if (process.argv.includes('--write')) {
  writeFileSync(fixture, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(JSON.stringify({ loaded, resolverCount: resolver.length, cases: cases.length }));
} else if (process.argv.includes('--verify')) {
  const expected = JSON.parse(readFileSync(fixture, 'utf8'));
  // Exclude provenance from semantic comparison; Phase 2 must not regenerate this golden file.
  const actual = { loaded, resolver, cases: outputs };
  const wanted = { loaded: expected.loaded, resolver: expected.resolver, cases: expected.cases };
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error('Eager equivalence fixture differs');
  console.log(JSON.stringify({ loaded, resolver, cases: outputs }));
} else console.log(JSON.stringify({ loaded, resolver, cases: outputs }));
