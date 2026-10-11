# vendor-marked (dev only)

Produces `client/vendor/marked.js`: marked, lowered with the class-only Babel
plugins so the plugin client loads under Hermes (plan D5, D9), then minified
with esbuild (target es2020; the host does not minify plugin bundles). The generated
file, its type declarations and the MIT licence are committed; this package is
not a dependency of the plugin.

```
cd tools/vendor-marked
npm ci
npm run build      # rewrites client/vendor/marked.{js,d.ts,LICENSE}
```

To upgrade, bump `marked` in `package.json` (exact version), run `npm install`,
then `npm run build`, and run `npm run check:hermes` at the repo root. The build
fails if any class, private name or static block survives the lowering.
