import type { ReactElement } from "react";
import { BrandMark } from "./glyph";
import { ProviderLogo } from "./provider-logo";

/** Render only prefixed marks, without a box; callers own ordinary icons and tint policy. */
export function renderMarkIcon({ name, size, brandColor, providerColor }: {
  name: string;
  size: number;
  brandColor: string;
  providerColor?: string;
}): ReactElement | null {
  if (name.startsWith("brand:")) {
    return <BrandMark id={name.toLowerCase()} size={size} color={brandColor} />;
  }
  if (name.startsWith("provider:")) {
    return <ProviderLogo provider={name.slice(9)} size={size} color={providerColor} />;
  }
  return null;
}
