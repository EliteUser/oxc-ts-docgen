import type { Comment } from "oxc-parser";

import { parse as parseJSDoc } from "comment-parser";

import type { DocTagParser } from "../public/config";
import type { ParsedSource } from "../resolver/parser";
import type { DocTagValue } from "../schema/doc-schema";
export type JSDocData = {
  /**
   * Freeform JSDoc description text.
   */
  description: string;
  /**
   * Normalized JSDoc tag values keyed by lower-case tag name.
   */
  tags: Record<string, DocTagValue>;
  /**
   * Parsed default value from `@default` or `@defaultValue`.
   */
  defaultValue: string | undefined;
};
const EMPTY_JSDOC: JSDocData = {
  description: "",
  tags: {},
  defaultValue: undefined,
};
export type ExtractJSDocForNodeOptions = {
  /**
   * Parsed source that owns the target node.
   */
  parsed: ParsedSource;
  /**
   * Start offset of the target AST node.
   */
  nodeStart: number;
  /**
   * Optional custom parsers keyed by tag name.
   */
  tagParsers?: Record<string, DocTagParser>;
};
type FindPrecedingJSDocOptions = {
  /**
   * Sorted JSDoc comments from the parsed source index.
   */
  comments: Comment[];
  /**
   * Start offset of the target AST node.
   */
  nodeStart: number;
  /**
   * Full source text used to verify whitespace gaps.
   */
  source: string;
};
type ParseSingleTagValueOptions = {
  /**
   * Raw tag string passed to the configured parser.
   */
  parserValue: string;
  /**
   * Value to keep if the configured parser throws.
   */
  fallback: DocTagValue;
  /**
   * Configured parser for the tag.
   */
  parser: DocTagParser;
};
export const extractJSDocForNode = (options: ExtractJSDocForNodeOptions): JSDocData => {
  const { parsed, nodeStart, tagParsers = {} } = options;
  const comment = findPrecedingJSDoc({
    comments: parsed.index.jsdocComments,
    nodeStart,
    source: parsed.source,
  });
  if (!comment) {
    return { ...EMPTY_JSDOC };
  }

  return applyJSDocTagParsers(parseCachedJSDocComment(comment), tagParsers);
};
const parsedCommentCache = new WeakMap<Comment, JSDocData>();
const findPrecedingJSDoc = (options: FindPrecedingJSDocOptions): Comment | undefined => {
  const { comments, nodeStart, source } = options;
  let low = 0;
  let high = comments.length - 1;
  let candidate: Comment | undefined;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const comment = comments[mid];
    if (comment.end <= nodeStart) {
      candidate = comment;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (!candidate) {
    return undefined;
  }

  const gap = source.slice(candidate.end, nodeStart);
  if (!/^[\s]*$/.test(gap)) {
    return undefined;
  }

  return candidate;
};
const parseCachedJSDocComment = (comment: Comment): JSDocData => {
  const cached = parsedCommentCache.get(comment);
  if (cached) {
    return cached;
  }

  const parsed = parseJSDocComment(comment.value);
  parsedCommentCache.set(comment, parsed);
  return parsed;
};
export const parseJSDocComment = (rawValue: string): JSDocData => {
  const commentText = `/*${rawValue}*/`;
  const parsed = parseJSDoc(commentText);
  if (parsed.length === 0) {
    return { ...EMPTY_JSDOC };
  }
  const block = parsed[0];
  const description = block.description.trim();
  const tags: Record<string, string | string[] | true> = {};
  let defaultValue: string | undefined;
  for (const tag of block.tags) {
    const tagName = tag.tag.toLowerCase();
    const tagValue = buildTagValue(tag);
    if (tagName === "default" || tagName === "defaultvalue") {
      defaultValue = typeof tagValue === "string" ? tagValue : undefined;
      tags["default"] = tagValue;
      continue;
    }
    const existing = tags[tagName];
    if (existing !== undefined) {
      if (Array.isArray(existing)) {
        existing.push(typeof tagValue === "string" ? tagValue : "");
      } else {
        tags[tagName] = [
          typeof existing === "string" ? existing : "",
          typeof tagValue === "string" ? tagValue : "",
        ];
      }
    } else {
      tags[tagName] = tagValue;
    }
  }
  return { description, tags, defaultValue };
};
const buildTagValue = (tag: { name: string; description: string }): string | true => {
  const parts = [tag.name, tag.description].filter(Boolean);
  const combined = parts.join(" ").trim();
  return combined || true;
};
export const applyJSDocTagParsers = (
  jsdoc: JSDocData,
  tagParsers: Record<string, DocTagParser>,
): JSDocData => {
  if (Object.keys(tagParsers).length === 0) {
    return {
      description: jsdoc.description,
      tags: { ...jsdoc.tags },
      defaultValue: jsdoc.defaultValue,
    };
  }
  const tags: Record<string, DocTagValue> = {};
  for (const [tagName, tagValue] of Object.entries(jsdoc.tags)) {
    const parser = tagParsers[tagName.toLowerCase()];
    tags[tagName] = parser ? parseTagValue(tagValue, parser) : cloneTagValue(tagValue);
  }
  return {
    description: jsdoc.description,
    tags,
    defaultValue: jsdoc.defaultValue,
  };
};
const parseTagValue = (value: DocTagValue, parser: DocTagParser): DocTagValue => {
  if (Array.isArray(value)) {
    return value.map((item) => parseTagValue(item, parser));
  }

  if (typeof value === "string") {
    return parseSingleTagValue({
      parserValue: value,
      fallback: value,
      parser,
    });
  }
  if (value === true) {
    return parseSingleTagValue({
      parserValue: "",
      fallback: value,
      parser,
    });
  }
  return cloneTagValue(value);
};
const parseSingleTagValue = (options: ParseSingleTagValueOptions): DocTagValue => {
  const { parserValue, fallback, parser } = options;
  try {
    return parser(parserValue);
  } catch {
    return cloneTagValue(fallback);
  }
};
const cloneTagValue = (value: DocTagValue): DocTagValue => {
  if (Array.isArray(value)) {
    return value.map(cloneTagValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneTagValue(nested)]),
    );
  }
  return value;
};
