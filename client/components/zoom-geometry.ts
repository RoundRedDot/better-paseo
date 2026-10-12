/**
 * Pan and zoom arithmetic for the full-screen image viewer.
 *
 * Adapted from Paseo's `components/zoomable-viewport/geometry.ts`
 * (Apache-2.0, Copyright (c) 2025-present Mohamed Boudra), so the plugin's
 * viewer clamps, zooms about a point and tells backdrop from picture exactly
 * as the host's attachment lightbox does.
 *
 * The content is first fitted into the viewport; a transform then scales that
 * fitted box about its centre and offsets it from the viewport centre.
 */

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

export interface ViewportTransform {
  scale: number;
  x: number;
  y: number;
}

export interface ViewportScaleLimits {
  minScale: number;
  maxScale: number;
}

export interface ViewportFitOptions {
  padding?: number;
  /** False keeps a small image at its own pixels instead of blowing it up. */
  upscale?: boolean;
}

export const FIT_TRANSFORM: ViewportTransform = { scale: 1, x: 0, y: 0 };

export function fitContentSize(
  content: ViewportSize,
  viewport: ViewportSize,
  options: ViewportFitOptions = {},
): ViewportSize {
  const padding = options.padding ?? 0;
  const availableWidth = Math.max(0, viewport.width - padding * 2);
  const availableHeight = Math.max(0, viewport.height - padding * 2);
  let fitScale = Math.min(availableWidth / content.width, availableHeight / content.height);
  if (options.upscale === false) fitScale = Math.min(1, fitScale);
  return { width: content.width * fitScale, height: content.height * fitScale };
}

export function isPointInsideTransformedContent(input: {
  point: ViewportPoint;
  transform: ViewportTransform;
  fittedContent: ViewportSize;
  viewport: ViewportSize;
}): boolean {
  const centerX = input.viewport.width / 2 + input.transform.x;
  const centerY = input.viewport.height / 2 + input.transform.y;
  const halfWidth = (input.fittedContent.width * input.transform.scale) / 2;
  const halfHeight = (input.fittedContent.height * input.transform.scale) / 2;
  return (
    input.point.x >= centerX - halfWidth &&
    input.point.x <= centerX + halfWidth &&
    input.point.y >= centerY - halfHeight &&
    input.point.y <= centerY + halfHeight
  );
}

function clampScale(scale: number, limits: ViewportScaleLimits): number {
  return Math.min(limits.maxScale, Math.max(limits.minScale, scale));
}

function clampOffset(offset: number, maximum: number): number {
  if (maximum === 0) return 0;
  return Math.min(maximum, Math.max(-maximum, offset));
}

/** Keeps the scale in range and stops a zoomed picture sliding past its edges. */
export function clampTransform(
  transform: ViewportTransform,
  fittedContent: ViewportSize,
  viewport: ViewportSize,
  limits: ViewportScaleLimits,
): ViewportTransform {
  const scale = clampScale(transform.scale, limits);
  const maxX = Math.max(0, (fittedContent.width * scale - viewport.width) / 2);
  const maxY = Math.max(0, (fittedContent.height * scale - viewport.height) / 2);
  return { scale, x: clampOffset(transform.x, maxX), y: clampOffset(transform.y, maxY) };
}

/** Zooms so the content under `focalPoint` stays under it. */
export function zoomContentAtPoint(input: {
  transform: ViewportTransform;
  scale: number;
  focalPoint: ViewportPoint;
  fittedContent: ViewportSize;
  viewport: ViewportSize;
  limits: ViewportScaleLimits;
}): ViewportTransform {
  const scale = clampScale(input.scale, input.limits);
  const centerX = input.viewport.width / 2;
  const centerY = input.viewport.height / 2;
  const contentX = (input.focalPoint.x - centerX - input.transform.x) / input.transform.scale;
  const contentY = (input.focalPoint.y - centerY - input.transform.y) / input.transform.scale;
  return clampTransform(
    {
      scale,
      x: input.focalPoint.x - centerX - contentX * scale,
      y: input.focalPoint.y - centerY - contentY * scale,
    },
    input.fittedContent,
    input.viewport,
    input.limits,
  );
}

export function panContent(input: {
  transform: ViewportTransform;
  delta: ViewportPoint;
  fittedContent: ViewportSize;
  viewport: ViewportSize;
  limits: ViewportScaleLimits;
}): ViewportTransform {
  return clampTransform(
    {
      ...input.transform,
      x: input.transform.x + input.delta.x,
      y: input.transform.y + input.delta.y,
    },
    input.fittedContent,
    input.viewport,
    input.limits,
  );
}
