import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { generateDocsWithResolver } from "../../src/public/api";
import { resolveConfig } from "../../src/public/config";
import { getSemanticService, TypeResolver, updateSemanticFile } from "../../src/resolver/resolver";

describe("TypeResolver semantic service lifecycle", () => {
  it("reuses one semantic service and refreshes snapshots on invalidation", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-resolver-semantic-"));
    const filePath = resolve(root, "types.ts");
    writeFileSync(filePath, "export interface ButtonProps { label: string }\n");

    const resolver = new TypeResolver(resolveConfig());
    const service = getSemanticService(resolver, filePath);
    expect(service.getLanguageServiceCreateCount()).toBe(0);
    expect(service.getProgram()).toBeDefined();
    expect(service.getLanguageServiceCreateCount()).toBe(1);

    writeFileSync(filePath, "export interface ButtonProps { disabled?: boolean }\n");
    resolver.invalidateFile(filePath);

    expect(getSemanticService(resolver, filePath)).toBe(service);
    expect(service.getProgram()?.getSourceFile(filePath.replace(/\\/g, "/"))?.text).toContain(
      "disabled?: boolean",
    );
    expect(service.getLanguageServiceCreateCount()).toBe(1);

    resolver.dispose();
  });

  it("accepts in-memory semantic snapshots before disk writes", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-resolver-semantic-memory-"));
    const filePath = resolve(root, "types.ts");
    writeFileSync(filePath, "export interface ButtonProps { label: string }\n");

    const resolver = new TypeResolver(resolveConfig());
    updateSemanticFile({
      resolver,
      filePath,
      source: "export interface ButtonProps { count?: number }\n",
    });

    const sourceFile = getSemanticService(resolver, filePath)
      .getProgram()
      ?.getSourceFile(filePath.replace(/\\/g, "/"));
    expect(sourceFile?.text).toContain("count?: number");

    resolver.dispose();
  });

  it("keys semantic services by nearest tsconfig for shared resolvers", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-resolver-semantic-projects-"));
    const packageA = resolve(root, "package-a");
    const packageB = resolve(root, "package-b");
    mkdirSync(packageA, { recursive: true });
    mkdirSync(packageB, { recursive: true });

    const indexA = resolve(packageA, "index.ts");
    const indexB = resolve(packageB, "index.ts");

    writeFileSync(
      resolve(packageA, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@model": ["model-a.ts"],
          },
        },
        include: ["*.ts"],
      }),
    );
    writeFileSync(resolve(packageA, "model-a.ts"), "export interface Model { a: string }\n");
    writeFileSync(
      indexA,
      [
        'import type { Model } from "@model";',
        "declare const createModel: () => Model;",
        "export type Props = ReturnType<typeof createModel>;",
      ].join("\n"),
    );

    writeFileSync(
      resolve(packageB, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@model": ["model-b.ts"],
          },
        },
        include: ["*.ts"],
      }),
    );
    writeFileSync(resolve(packageB, "model-b.ts"), "export interface Model { b: number }\n");
    writeFileSync(
      indexB,
      [
        'import type { Model } from "@model";',
        "declare const createModel: () => Model;",
        "export type Props = ReturnType<typeof createModel>;",
      ].join("\n"),
    );

    const resolver = new TypeResolver(resolveConfig());
    const schemaA = generateDocsWithResolver({ filePath: indexA, typeName: "Props", resolver });
    const serviceA = getSemanticService(resolver, indexA);
    const schemaB = generateDocsWithResolver({ filePath: indexB, typeName: "Props", resolver });
    const serviceB = getSemanticService(resolver, indexB);

    expect(serviceA).not.toBe(serviceB);
    expect(serviceA.getTsconfigFile()).toBe(resolve(packageA, "tsconfig.json").replace(/\\/g, "/"));
    expect(serviceB.getTsconfigFile()).toBe(resolve(packageB, "tsconfig.json").replace(/\\/g, "/"));
    expect(schemaA.entries[0]?.properties.map((prop) => prop.name)).toEqual(["a"]);
    expect(schemaB.entries[0]?.properties.map((prop) => prop.name)).toEqual(["b"]);

    resolver.dispose();
  });

  it("surfaces semantic tsconfig diagnostics through the resolver", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-resolver-semantic-diagnostics-"));
    const filePath = resolve(root, "types.ts");
    writeFileSync(
      resolve(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true },
        include: [123],
      }),
    );
    writeFileSync(filePath, "export interface ButtonProps { label: string }\n");

    const resolver = new TypeResolver(resolveConfig());
    getSemanticService(resolver, filePath).getProgram();

    expect(resolver.getDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "tsconfig-invalid",
          filePath: resolve(root, "tsconfig.json").replace(/\\/g, "/"),
          message: expect.stringContaining("TypeScript semantic service"),
          cause: expect.stringContaining("include"),
        }),
      ]),
    );

    resolver.dispose();
  });
});
