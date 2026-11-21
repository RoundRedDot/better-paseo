import { processColor, useWindowDimensions } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { renderInput, renderMath } from "../../../../shared/math-rpc";
import type { ExtendedThemeTokens } from "../../theme-tokens";
import { enqueueRender } from "./math-queue";

export function useFormula(tex: string, tokens: ExtendedThemeTokens, size: number, display: boolean, enabled: boolean) {
  const rpc = useRpc(renderMath);
  const { fontScale, scale } = useWindowDimensions();
  const foreground = processColor(tokens.foreground);
  const color = typeof foreground === "number"
    ? `#${(foreground & 0xffffff).toString(16).padStart(6, "0")}`
    : tokens.isDark ? "#ffffff" : "#000000";
  const targetSize = Math.round(size * fontScale);
  const input = {
    tex, color, display,
    fontSize: Math.max(12, Math.min(28, targetSize)),
    scale: Math.max(1, Math.min(3, Math.ceil(scale))),
  };
  const valid = renderInput.safeParse(input).success;
  const query = useQuery({
    queryKey: ["better-paseo-math", input],
    queryFn: ({ signal }) => enqueueRender(signal, () => rpc(input)),
    enabled: valid && enabled,
    staleTime: Infinity,
    gcTime: 30_000,
    retry: false,
  });
  const error = !valid ? "Formula exceeds render limits"
    : query.isError ? "Could not reach the formula renderer"
      : query.data?.ok === false ? query.data.reason : undefined;
  return { image: query.data?.ok ? query.data : undefined, imageScale: targetSize / input.fontSize, error };
}
