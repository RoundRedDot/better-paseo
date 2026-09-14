import { DEVICON_URIS } from "../../client/components/devicon-data";
import { LOBE_MARKS } from "../../client/components/lobe-marks";
import { LOCAL_MARKS } from "../../client/components/provider-logo";
import { BRAND_PATHS } from "../../client/components/glyph";
import { GENERIC_FILE_PATH, FOLDER_PATH } from "../../client/components/file-type-logo";

const marks: Array<{ id: string; svg: string; mono: boolean }> = [];
for (const [name, uri] of Object.entries(DEVICON_URIS)) {
  marks.push({
    id: `devicon:${name}`,
    svg: decodeURIComponent(uri.replace(/^data:image\/svg\+xml,/, "")),
    mono: false,
  });
}
for (const [name, mark] of Object.entries(LOBE_MARKS)) {
  marks.push({ id: `lobe:${name}`, svg: mark.svg, mono: mark.mono });
}
for (const [name, svg] of Object.entries(LOCAL_MARKS)) {
  if (svg) marks.push({ id: `provider:${name}`, svg, mono: true });
}
for (const [name, brand] of Object.entries(BRAND_PATHS)) {
  marks.push({
    id: `brand:${name.toLowerCase()}`,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${brand.viewBox}" fill="currentColor"><path d="${brand.d}"/></svg>`,
    mono: true,
  });
}
for (const [name, d] of [
  ["file", GENERIC_FILE_PATH],
  ["folder", FOLDER_PATH],
] as const) {
  marks.push({
    id: `mark:${name}`,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`,
    mono: true,
  });
}
console.log(JSON.stringify(marks));
