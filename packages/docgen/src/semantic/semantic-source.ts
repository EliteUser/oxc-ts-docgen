import type * as TypeScript from "typescript";

import { normalizePath } from "../utils/path-utils";

export const hasReadonlyModifier = (
  ts: typeof TypeScript,
  declaration: TypeScript.Declaration,
): boolean => {
  return Boolean(
    ts.canHaveModifiers(declaration) &&
    ts
      .getModifiers(declaration)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword),
  );
};

export const semanticSourceLocation = (
  declaration: TypeScript.Declaration,
): {
  filePath: string;
  line: number;
  column: number;
} => {
  const sourceFile = declaration.getSourceFile();
  const position = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile));

  return {
    filePath: normalizePath(sourceFile.fileName),
    line: position.line + 1,
    column: position.character,
  };
};

export const isRestParameter = (
  ts: typeof TypeScript,
  declaration: TypeScript.Declaration | undefined,
): boolean => {
  return Boolean(declaration && ts.isParameter(declaration) && declaration.dotDotDotToken);
};

export const isExternalPath = (filePath: string): boolean => {
  return normalizePath(filePath).includes("/node_modules/");
};
