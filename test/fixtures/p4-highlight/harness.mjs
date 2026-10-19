import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const root = path.resolve(import.meta.dirname, '../../..');
export const source = readFileSync(path.join(root, 'index.server.ts'), 'utf8');
// Read the production declarations, rather than maintain a second resolver.
const ast = ts.createSourceFile('index.server.ts', source, ts.ScriptTarget.Latest, true);
export function declaration(name) {
  for (const node of ast.statements) if (ts.isVariableStatement(node)) {
    for (const d of node.declarationList.declarations) if (d.name.getText(ast) === name) {
      return new Function(`return (${d.initializer.getText(ast)})`)();
    }
  }
  throw new Error(`Declaration not found: ${name}`);
}
export const aliases = declaration('ALIASES');
export const extensions = declaration('EXTENSIONS');
export const paths = [...source.matchAll(/import\("(@shikijs\/langs\/[^"]+)"\)/g)].map(m => m[1]);
export const ids = paths.map(p => p.split('/').at(-1).replace('dockerfile', 'docker'));
const require = createRequire(path.join(root, 'package.json'));
export async function serverBundle({ observe = true, tokenizeTimeLimit } = {}) {
  const realCore = require.resolve('@shikijs/core');
  const buildEngine = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'buildEngine');
  if (!buildEngine?.body) throw new Error('buildEngine body not found');
  const body = buildEngine.body;
  // Timing-only instrumentation of the benchmark's in-memory copy; repository source is untouched.
  const observedSource = source.slice(0, body.getStart(ast) + 1) +
    'const p4Started = performance.now(); try {' +
    source.slice(body.getStart(ast) + 1, body.end - 1) +
    '} finally { globalThis.__p4BuildEngineMs = performance.now() - p4Started; }' + source.slice(body.end - 1);
  const tokenizeCall = tokenizeTimeLimit === undefined
    ? 'tokenize(...args)'
    : `tokenize(args[0], { ...args[1], tokenizeTimeLimit: ${JSON.stringify(tokenizeTimeLimit)} })`;
  const result = await build({
    entryPoints: [path.join(root, 'index.server.ts')], bundle: true, format: 'cjs',
    platform: 'node', target: 'es2022', write: false,
    external: ['@getpaseo/plugin', '@getpaseo/plugin/*', 'zod'],
    plugins: observe ? [{ name: 'observe-core', setup(b) {
      b.onLoad({ filter: /index\.server\.ts$/ }, () => ({ contents: observedSource, loader: 'ts', resolveDir: root }));
      b.onResolve({ filter: /^@shikijs\/core$/ }, () => ({ path: 'core-observer', namespace: 'p4' }));
      b.onLoad({ filter: /.*/, namespace: 'p4' }, () => ({
        resolveDir: root, loader: 'js', contents: `
          export * from ${JSON.stringify(realCore)};
          import { createHighlighterCore as create } from ${JSON.stringify(realCore)};
          export async function createHighlighterCore(options) {
            const start = performance.now();
            const h = await create(options);
            globalThis.__p4 = { highlighter: h, createMs: performance.now() - start, tokenMs: [] };
            const tokenize = h.codeToTokens;
            h.codeToTokens = (...args) => {
              const t = performance.now();
              try { return ${tokenizeCall}; }
              finally { globalThis.__p4.tokenMs.push(performance.now() - t); }
            };
            return h;
          }`,
      }));
    } }] : [],
  });
  return result.outputFiles[0].text;
}
export function loadServer(code) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  const handlers = new Map();
  module.exports.default({ registerSettings() {}, handle(contract, handler) { handlers.set(contract.name, handler); } });
  const handler = handlers.get('highlight.tokens');
  if (!handler) throw new Error('Highlight handler was not registered');
  return handler;
}
export async function groupBundle() {
  // All loaders stay in ONE bundle, as in the plugin; selecting a subset only defers execution.
  const loaders = paths.map(p => `${JSON.stringify(p.split('/').at(-1).replace('dockerfile', 'docker'))}: () => import(${JSON.stringify(p)})`).join(',');
  const result = await build({ stdin: { resolveDir: root, contents: `
    export const loaders = { ${loaders} };
    export async function base() {
      const [core, regex] = await Promise.all([import('@shikijs/core'), import('@shikijs/engine-javascript')]);
      const themes = await Promise.all([import('@shikijs/themes/github-dark-default'), import('@shikijs/themes/github-light-default')]);
      return { core, regex, themes };
    }`, }, bundle: true, format: 'cjs', platform: 'node', target: 'es2022', write: false });
  return result.outputFiles[0].text;
}
export async function clientHelpers() {
  const result = await build({ stdin: { resolveDir: root, contents: `
    export { classifyTool } from './client/tools/classify';
    export { lexBlock } from './client/components/markdown/lex';
    export { codeLanguage } from './client/components/markdown/render/text';
  ` }, bundle: true, format: 'cjs', platform: 'node', write: false });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}
