import type { ViewProps } from "react-native";

/**
 * Opts a subtree out of the host's global font rule.
 *
 * Paseo forces its own UI font onto everything it renders:
 *
 *   :is(#root, #overlay-root) *:not([data-pmono]):not([data-pmono] *) {
 *     font-family: var(--paseo-ui-font);
 *   }
 *
 * `:is(#root, …)` contributes an id to the selector, so that rule scores about
 * (1,1,0) against the (0,1,0) of a React Native Web atomic class. It therefore
 * beats every `fontFamily` a plugin sets, which is why embedded faces load and
 * then never appear. `data-pmono` is the host's own opt-out: the attribute and
 * everything beneath it are excluded, so a plugin root carrying it keeps its
 * own typography for the whole subtree.
 *
 * React Native Web maps `dataSet` onto `data-*` attributes. The cast is needed
 * because React Native's `ViewProps` has no `dataSet`, being a web-only
 * affordance — on native the prop is ignored, which is correct, since there is
 * no host stylesheet to escape.
 */
export const hostFontEscape = {
  dataSet: { pmono: true },
} as unknown as ViewProps;

/**
 * Marks a monospace region — code, diff, terminal output, a path, a command —
 * with the host's own code-surface attribute (`CODE_SURFACE_DATASET` in
 * Paseo, `data-pmono=""`). Plan §3.10 item 4: once item roots stop carrying
 * `hostFontEscape` (slice S5), interface text follows the host UI font and
 * only these regions keep their own family. Spread through `surfaceProps`
 * when combined with another marker. Ignored on native.
 */
export const codeSurface = {
  dataSet: { pmono: "" },
} as unknown as ViewProps;
