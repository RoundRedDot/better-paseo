# Formula renderer provenance

The daemon renderer, RPC contract and request queue are adapted from [Math Renderer Plus v1.4](https://github.com/EviterLesRoses2/paseo-math-renderer-plus/tree/v1.4), based on geoqiao’s Math Renderer. The original MIT notice is included in `MATH-RENDERER-PLUS-LICENSE`.

MathJax `@mathjax/src` 4.1.3 uses Apache-2.0. The matching [New Computer Modern font package](https://github.com/mathjax/MathJax-newcm-font) carries its own font notices in the installed package. Noto Sans CJK SC Regular is redistributed unmodified under the SIL Open Font License in `fonts/OFL.txt`. The resvg 2.6.2 WASM is unmodified and is available with its [MPL-2.0 source](https://github.com/yisibl/resvg-js/tree/9ca058462ac529120c8cc84ddcd6fef644cc5406). The local build embeds the pinned WASM and fonts into the daemon bundle.
