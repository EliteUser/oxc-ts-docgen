import type * as TypeScript from "typescript";

import type { DocgenConfig } from "../public/config";
import type { DocTagValue } from "../schema/doc-schema";

import { applyJSDocTagParsers } from "../utils/jsdoc";

type SemanticJsDocContext = {
  /**
   * TypeScript namespace used for display-part conversion.
   */
  ts: typeof TypeScript;
  /**
   * Active checker used to read symbol documentation comments.
   */
  checker: TypeScript.TypeChecker;
  /**
   * Effective docgen config used for custom tag parsers.
   */
  config: Pick<DocgenConfig, "tags">;
};

export type GetSemanticJsDocOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticJsDocContext;
  /**
   * Symbol whose JSDoc should be converted for docs output.
   */
  symbol: TypeScript.Symbol;
};

export type GetSemanticSignatureJsDocOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticJsDocContext;
  /**
   * Signature whose JSDoc should be converted for docs output.
   */
  signature: TypeScript.Signature;
};

export const getSemanticJSDoc = (
  options: GetSemanticJsDocOptions,
): {
  description: string;
  tags: Record<string, DocTagValue>;
  defaultValue: string | undefined;
} => {
  const { context, symbol } = options;
  const description = context.ts.displayPartsToString(
    symbol.getDocumentationComment(context.checker),
  );
  return buildSemanticJSDocData({
    context,
    description,
    tags: symbol.getJsDocTags(),
  });
};

export const getSemanticSignatureJSDoc = (
  options: GetSemanticSignatureJsDocOptions,
): {
  description: string;
  tags: Record<string, DocTagValue>;
  defaultValue: string | undefined;
} => {
  const { context, signature } = options;
  const description = context.ts.displayPartsToString(
    signature.getDocumentationComment(context.checker),
  );

  return buildSemanticJSDocData({
    context,
    description,
    tags: signature.getJsDocTags(),
  });
};

type BuildSemanticJSDocDataOptions = {
  /**
   * Shared semantic conversion context.
   */
  context: SemanticJsDocContext;
  /**
   * Normalized description text.
   */
  description: string;
  /**
   * TypeScript JSDoc tag metadata.
   */
  tags: TypeScript.JSDocTagInfo[];
};

const buildSemanticJSDocData = (
  options: BuildSemanticJSDocDataOptions,
): {
  description: string;
  tags: Record<string, DocTagValue>;
  defaultValue: string | undefined;
} => {
  const { context, description } = options;
  const tags: Record<string, string | string[] | true> = {};
  let defaultValue: string | undefined;

  for (const tag of options.tags) {
    const tagName = normalizeSemanticTagName(tag.name);
    const value = context.ts.displayPartsToString(tag.text ?? []);
    const tagValue = value || true;

    if (tagName === "default") {
      defaultValue = value || undefined;
      tags.default = tagValue;
      continue;
    }

    addSemanticTagValue({ tags, tagName, tagValue });
  }

  return applyJSDocTagParsers(
    {
      description,
      tags,
      defaultValue,
    },
    context.config.tags,
  );
};

type AddSemanticTagValueOptions = {
  tags: Record<string, string | string[] | true>;
  tagName: string;
  tagValue: string | true;
};

const addSemanticTagValue = (options: AddSemanticTagValueOptions): void => {
  const { tags, tagName, tagValue } = options;
  const existing = tags[tagName];

  if (existing === undefined) {
    tags[tagName] = tagValue;
    return;
  }

  if (Array.isArray(existing)) {
    existing.push(typeof tagValue === "string" ? tagValue : "");
    return;
  }

  tags[tagName] = [
    typeof existing === "string" ? existing : "",
    typeof tagValue === "string" ? tagValue : "",
  ];
};

const normalizeSemanticTagName = (name: string): string => {
  const normalized = name.toLowerCase();

  if (normalized === "defaultvalue") {
    return "default";
  }

  return normalized;
};
