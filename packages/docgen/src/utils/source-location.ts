import type { ParsedSource } from "../resolver/parser";
import type { DocSourceLocation } from "../schema/doc-schema";
export type OffsetToLocationOptions = {
  parsed: ParsedSource;
  offset: number;
  filePath: string;
};
export const offsetToLocation = (options: OffsetToLocationOptions): DocSourceLocation => {
  const { parsed, offset, filePath } = options;
  const lineStarts = parsed.index.lineStarts;
  let low = 0;
  let high = lineStarts.length - 1;
  let lineIndex = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      lineIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const line = lineIndex + 1;
  const column = offset - lineStarts[lineIndex];
  return { filePath, line, column };
};
