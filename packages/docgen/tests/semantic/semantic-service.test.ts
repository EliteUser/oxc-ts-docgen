import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveConfig } from "../../src/public/config";
import { TypeScriptSemanticService } from "../../src/semantic/semantic-service";

describe("TypeScriptSemanticService", () => {
  it("creates the TypeScript language service lazily and reuses it", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-semantic-lazy-"));
    const filePath = resolve(root, "types.ts");
    writeFileSync(filePath, "export interface ButtonProps { label: string }\n");

    const service = new TypeScriptSemanticService({
      config: resolveConfig(),
      rootFiles: [filePath],
      currentDirectory: root,
    });

    expect(service.getLanguageServiceCreateCount()).toBe(0);
    expect(service.getProgram()?.getSourceFile(filePath.replace(/\\/g, "/"))).toBeDefined();
    expect(service.getLanguageServiceCreateCount()).toBe(1);
    expect(service.getTypeChecker()).toBeDefined();
    expect(service.getLanguageServiceCreateCount()).toBe(1);

    service.dispose();
  });

  it("tracks in-memory file updates through script versions and program snapshots", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-semantic-update-"));
    const filePath = resolve(root, "types.ts");
    writeFileSync(filePath, "export interface ButtonProps { label: string }\n");

    const service = new TypeScriptSemanticService({
      config: resolveConfig(),
      rootFiles: [filePath],
      currentDirectory: root,
    });

    expect(service.getVersion(filePath)).toBe(0);
    service.updateFile(
      filePath,
      "export interface ButtonProps { label: string; count?: number }\n",
    );
    expect(service.getVersion(filePath)).toBe(1);

    const sourceFile = service.getProgram()?.getSourceFile(filePath.replace(/\\/g, "/"));
    expect(sourceFile?.text).toContain("count?: number");

    service.dispose();
  });

  it("reloads invalidated files from disk without recreating the service", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-semantic-invalidate-"));
    const filePath = resolve(root, "types.ts");
    writeFileSync(filePath, "export interface ButtonProps { label: string }\n");

    const service = new TypeScriptSemanticService({
      config: resolveConfig(),
      rootFiles: [filePath],
      currentDirectory: root,
    });

    expect(service.getProgram()).toBeDefined();
    expect(service.getLanguageServiceCreateCount()).toBe(1);

    writeFileSync(filePath, "export interface ButtonProps { disabled?: boolean }\n");
    service.invalidateFile(filePath);

    const sourceFile = service.getProgram()?.getSourceFile(filePath.replace(/\\/g, "/"));
    expect(service.getLanguageServiceCreateCount()).toBe(1);
    expect(service.getVersion(filePath)).toBe(1);
    expect(sourceFile?.text).toContain("disabled?: boolean");

    service.dispose();
  });

  it("uses tsconfig project files and compiler options when available", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-semantic-tsconfig-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });
    const filePath = resolve(srcDir, "types.ts");
    writeFileSync(
      resolve(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          jsx: "react-jsx",
        },
        include: ["src/**/*.ts"],
      }),
    );
    writeFileSync(filePath, "export interface ButtonProps { label: string }\n");

    const service = new TypeScriptSemanticService({
      config: resolveConfig(),
      currentDirectory: root,
    });

    expect(service.getTsconfigFile()).toBe(resolve(root, "tsconfig.json").replace(/\\/g, "/"));
    expect(service.getProgram()?.getSourceFile(filePath.replace(/\\/g, "/"))).toBeDefined();

    service.dispose();
  });
});
