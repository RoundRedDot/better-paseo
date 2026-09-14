import React from "react";
import { Image } from "react-native";
import { MARK_BITMAPS } from "./mark-bitmaps";

export type SupportedFileType =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "json"
  | "bash"
  | "markdown"
  | "html"
  | "css"
  | "sql"
  | "go"
  | "react"
  | "docker"
  | "yaml"
  | "generic";

interface FileTypeLogoProps {
  filename?: string;
  language?: string;
  size?: "sm" | "md" | "lg";
  foregroundColor?: string;
}

const LANGUAGE_ALIASES: Record<string, SupportedFileType> = {
  typescript: "typescript",
  ts: "typescript",
  tsx: "react",
  javascript: "javascript",
  js: "javascript",
  jsx: "react",
  python: "python",
  py: "python",
  rust: "rust",
  rs: "rust",
  json: "json",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  markdown: "markdown",
  md: "markdown",
  html: "html",
  css: "css",
  scss: "css",
  sql: "sql",
  go: "go",
  golang: "go",
  dockerfile: "docker",
  yaml: "yaml",
  yml: "yaml",
};

const EXTENSION_MAP: Record<string, SupportedFileType> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "react",
  jsx: "react",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  json: "json",
  jsonc: "json",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  sass: "css",
  sql: "sql",
  go: "go",
  yaml: "yaml",
  yml: "yaml",
};

export function detectFileType(filename?: string, language?: string): SupportedFileType {
  const lang = (language || "").toLowerCase();
  const languageAlias = LANGUAGE_ALIASES[lang];
  if (languageAlias) return languageAlias;
  if (!filename) return "generic";
  const lower = filename.toLowerCase().trim();

  // Dockerfile carries its identity in the name, not an extension.
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "docker";

  // A read carries its selector on the path (`main.ts:55-85`), and a code
  // block header appends the line range (`main.ts 55-85`). Either suffix
  // swallows the extension and the file falls back to a monogram.
  const base = (lower.split(/[/\\]/).pop() ?? lower).split(/[\s:?#]/)[0] ?? "";
  const ext = base.includes(".") ? (base.split(".").pop() ?? "") : "";
  return EXTENSION_MAP[ext] ?? "generic";
}

const DIMENSIONS = {
  sm: { box: 15 },
  md: { box: 17 },
  lg: { box: 21 },
} as const;

function isDirectoryPath(filename?: string): boolean {
  const path = filename?.trim();
  return (
    path === "." || path === ".." || path?.endsWith("/") === true || path?.endsWith("\\") === true
  );
}

/**
 * The file's own brand mark. Unknown types use a document mark, and an explicit
 * directory path uses a folder mark. Every mark is a PNG: React Native cannot
 * decode an SVG data URI, so an inlined SVG renders on web only.
 */
export function FileTypeLogo({
  filename,
  language,
  size = "md",
  foregroundColor,
}: FileTypeLogoProps) {
  const type = detectFileType(filename, language);
  const { box } = DIMENSIONS[size];
  const brand = MARK_BITMAPS[`devicon:${type}`];

  if (brand) {
    return (
      <Image
        source={{ uri: brand }}
        style={
          type === "markdown" && foregroundColor
            ? { width: box, height: box, tintColor: foregroundColor }
            : { width: box, height: box }
        }
        resizeMode="contain"
        accessibilityLabel={`${type} file`}
      />
    );
  }

  const isDirectory = isDirectoryPath(filename);
  const uri = MARK_BITMAPS[isDirectory ? "mark:folder" : "mark:file"];
  return (
    <Image
      source={{ uri }}
      style={{
        width: box,
        height: box,
        tintColor: isDirectory ? "#EAB308" : "#94A3B8",
      }}
      resizeMode="contain"
      accessibilityLabel={isDirectory ? "Folder" : "File"}
    />
  );
}
