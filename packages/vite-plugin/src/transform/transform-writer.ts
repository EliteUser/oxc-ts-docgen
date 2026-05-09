export type SourceRange = {
  start: number;
  end: number;
};
export type VirtualModuleRequest = {
  consumerFile: string;
  sourceFile: string;
  typeName: string;
  localTypeName: string;
  index: number;
};
export type VirtualSchemaReplacement = {
  importStatement: string;
  moduleId: string;
  replacement: string;
};
export type ReplaceRangeOptions = {
  code: string;
  range: SourceRange;
  replacement: string;
};
export const replaceRange = (options: ReplaceRangeOptions): string => {
  const { code, range, replacement } = options;
  return code.slice(0, range.start) + replacement + code.slice(range.end);
};
export const removeRanges = (code: string, ranges: SourceRange[]): string => {
  let transformed = code;
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index];
    transformed = replaceRange({ code: transformed, range, replacement: "" });
  }
  return transformed;
};
export const createInlineSchemaReplacement = (schema: unknown): string => {
  const json = JSON.stringify(schema);
  return `JSON.parse(${JSON.stringify(json)})`;
};
export const createVirtualSchemaReplacement = (
  request: VirtualModuleRequest,
  createVirtualModuleId?: (request: VirtualModuleRequest) => string,
): VirtualSchemaReplacement => {
  const replacement = `__oxcTsDocgenSchema${request.index}`;
  const moduleId =
    createVirtualModuleId?.(request) ?? `virtual:oxc-ts-docgen/schema/${request.index}`;
  return {
    importStatement: `import ${replacement} from ${JSON.stringify(moduleId)};`,
    moduleId,
    replacement,
  };
};
