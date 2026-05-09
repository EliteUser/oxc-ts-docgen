import type { DocgenConfig } from "@synthfall/oxc-ts-docgen";

import type { TransformOptions, TransformResult } from "./transform";

import { transformGetDocs } from "./transform";

type VueScriptLang = "ts" | "tsx" | "js" | "jsx";

type VueScriptBlock = {
  /**
   * Script source without surrounding SFC tags.
   */
  code: string;
  /**
   * Start offset of the script source in the full SFC.
   */
  start: number;
  /**
   * End offset of the script source in the full SFC.
   */
  end: number;
  /**
   * Parser language inferred from the script tag.
   */
  lang: VueScriptLang;
};

type VueScriptReplacement = {
  /**
   * Start offset of the script source in the full SFC.
   */
  start: number;
  /**
   * End offset of the script source in the full SFC.
   */
  end: number;
  /**
   * Transformed script source.
   */
  code: string;
};

export type TransformVueSfcGetDocsOptions = {
  /**
   * Raw Vue SFC source text.
   */
  code: string;
  /**
   * Absolute or Vite-normalized Vue SFC module id.
   */
  id: string;
  /**
   * Docgen config overrides for this transform.
   */
  config: Partial<DocgenConfig>;
  /**
   * Internal transform services and behavior flags.
   */
  options?: TransformOptions;
};

export const transformVueSfcGetDocs = (
  input: TransformVueSfcGetDocsOptions,
): TransformResult | null => {
  const { code, id, config, options } = input;
  const blocks = findVueScriptBlocks(code);
  if (blocks.length === 0) {
    return null;
  }

  const deps: string[] = [];
  const virtualModules: string[] = [];
  const replacements: VueScriptReplacement[] = [];

  for (const block of blocks) {
    const result = transformGetDocs({
      code: block.code,
      id,
      lang: block.lang,
      config,
      options,
    });
    if (!result) {
      continue;
    }

    deps.push(...result.deps);
    virtualModules.push(...result.virtualModules);
    replacements.push({
      start: block.start,
      end: block.end,
      code: result.code,
    });
  }

  if (replacements.length === 0) {
    return null;
  }

  let transformed = code;
  for (let index = replacements.length - 1; index >= 0; index--) {
    const replacement = replacements[index];
    transformed =
      transformed.slice(0, replacement.start) +
      replacement.code +
      transformed.slice(replacement.end);
  }

  return {
    code: transformed,
    deps,
    virtualModules,
  };
};

const findVueScriptBlocks = (code: string): VueScriptBlock[] => {
  const blocks: VueScriptBlock[] = [];
  const openScriptPattern = /<script\b[^>]*>/gi;

  for (;;) {
    const openMatch = openScriptPattern.exec(code);
    if (!openMatch) {
      break;
    }

    const openTag = openMatch[0];
    const contentStart = openMatch.index + openTag.length;
    const closeScriptPattern = /<\/script\s*>/gi;
    closeScriptPattern.lastIndex = contentStart;
    const closeMatch = closeScriptPattern.exec(code);
    if (!closeMatch) {
      break;
    }

    const lang = inferVueScriptLang(openTag);
    if (lang) {
      blocks.push({
        code: code.slice(contentStart, closeMatch.index),
        start: contentStart,
        end: closeMatch.index,
        lang,
      });
    }

    openScriptPattern.lastIndex = closeMatch.index + closeMatch[0].length;
  }

  return blocks;
};

const inferVueScriptLang = (openTag: string): VueScriptLang | undefined => {
  const langMatch = openTag.match(/\blang\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  const rawLang = (langMatch?.[1] ?? langMatch?.[2] ?? langMatch?.[3] ?? "js").toLowerCase();

  if (rawLang === "ts" || rawLang === "tsx" || rawLang === "js" || rawLang === "jsx") {
    return rawLang;
  }

  return undefined;
};
