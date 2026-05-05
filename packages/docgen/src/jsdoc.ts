import { parse as parseJSDoc } from "comment-parser";
import type { Comment } from "oxc-parser";
import type { ParsedSource } from "./parser";

export interface JSDocData {
  description: string;
  tags: Record<string, string | string[] | true>;
  defaultValue: string | undefined;
}

const EMPTY_JSDOC: JSDocData = {
  description: "",
  tags: {},
  defaultValue: undefined,
};

export function extractJSDocForNode(parsed: ParsedSource, nodeStart: number): JSDocData {
  const comment = findPrecedingJSDoc(parsed.index.jsdocComments, nodeStart, parsed.source);
  if (!comment) return { ...EMPTY_JSDOC };
  return parseCachedJSDocComment(comment);
}

const parsedCommentCache = new WeakMap<Comment, JSDocData>();

function findPrecedingJSDoc(
  comments: Comment[],
  nodeStart: number,
  source: string,
): Comment | undefined {
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

  if (!candidate) return undefined;

  const gap = source.slice(candidate.end, nodeStart);
  return /^[\s]*$/.test(gap) ? candidate : undefined;
}

function parseCachedJSDocComment(comment: Comment): JSDocData {
  const cached = parsedCommentCache.get(comment);
  if (cached) return cached;

  const parsed = parseJSDocComment(comment.value);
  parsedCommentCache.set(comment, parsed);
  return parsed;
}

export function parseJSDocComment(rawValue: string): JSDocData {
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
}

function buildTagValue(tag: { name: string; description: string }): string | true {
  const parts = [tag.name, tag.description].filter(Boolean);
  const combined = parts.join(" ").trim();
  return combined || true;
}
