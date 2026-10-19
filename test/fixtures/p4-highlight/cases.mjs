export const samples = {
  typescript: 'interface User { name: string }\nconst user: User = { name: "Ada" };',
  tsx: 'const View = () => <div title="hello">{1 + 2}</div>;',
  javascript: '// greeting\nconst greet = (name) => `Hello ${name}`;',
  jsx: 'const View = () => <span>{"hello"}</span>;',
  json: '{"name": "Ada", "active": true, "count": 2}',
  shellscript: '# greeting\nfor name in Ada Bob; do echo "$name"; done',
  python: '# greeting\ndef greet(name: str):\n    return f"Hello {name}"',
  diff: '--- a/main.ts\n+++ b/main.ts\n@@ -1 +1 @@\n-const n = 1;\n+const n = 2;',
  yaml: '# config\nname: Ada\nactive: true\nports:\n  - 8080',
  markdown: '# **Heading**\n\n*italic* and `inline`\n\n```ts\nconst n: number = 2;\n```\n\n```python\nprint("hello")\n```\n\n```html\n<style>body { color: red; }</style>\n<script>const x = 1;</script>\n```',
  rust: 'fn main() {\n    let value: i32 = 2;\n    println!("{}", value);\n}',
  go: 'package main\nimport "fmt"\nfunc main() { fmt.Println("hello") }',
  html: '<style>body { color: red; }</style>\n<script>const value = 2;</script>\n<div id="app">Hello</div>',
  css: '/* theme */\nbody { color: red; margin: 2px; }',
  sql: '-- query\nSELECT name FROM users WHERE active = true;',
  toml: '# config\n[server]\nport = 8080\nenabled = true',
  docker: 'FROM node:24\nWORKDIR /app\nRUN echo "hello"\nCMD ["node", "index.js"]',
  powershell: '# greeting\n$name = "Ada"\nWrite-Host "Hello $name"',
};
export function inputs() {
  const out = [];
  for (const dark of [true, false]) {
    for (const [language, code] of Object.entries(samples)) out.push({ name: `${language}-${dark}`, input: { code, language, dark } });
    for (const language of ['plaintext', 'text', 'txt', 'unknown-language']) out.push({ name: `${language}-${dark}`, input: { code: 'hello\r\n\nworld', language, dark } });
    out.push({ name: `empty-${dark}`, input: { code: '', language: 'typescript', dark } });
    out.push({ name: `diff-dual-${dark}`, input: { code: samples.diff, language: 'diff', filename: 'main.ts', dark, diffBodyCode: '\n\n\nconst n = 1;\nconst n = 2;' } });
    out.push({ name: `diff-unknown-file-${dark}`, input: { code: samples.diff, language: 'diff', filename: 'main.unknown', dark, diffBodyCode: 'const n = 2;' } });
    for (const [guard, code] of [['bytes', ('x'.repeat(1000) + '\n').repeat(410)], ['lines', 'x\n'.repeat(4000)], ['line', 'x'.repeat(1001)]]) {
      out.push({ name: `oversize-${guard}-${dark}`, input: { code, language: 'typescript', dark } });
    }
  }
  return out;
}
