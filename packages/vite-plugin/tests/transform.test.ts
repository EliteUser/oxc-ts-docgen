import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { transformGetDocs } from "../src/transform";

const fixturesDir = resolve(__dirname, "..", "..", "docgen", "tests", "fixtures", "cross-file");
const pluginFixturesDir = resolve(__dirname, "fixtures");

describe("transformGetDocs", () => {
  it("returns null when no getDocs call is present", () => {
    const code = `const x = 1;`;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).toBeNull();
  });

  it("returns null when getDocs is not imported from docgen", () => {
    const code = `
      import { getDocs } from './my-lib'
      const docs = getDocs<MyType>()
    `;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).toBeNull();
  });

  it("transforms getDocs call with a local type", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@oxc-ts-docgen/docgen'
import type { ButtonSize } from '${typesFile.replace(/\\/g, "/")}'

const docs = getDocs<ButtonSize>()
console.log(docs)
`;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.code).not.toContain("getDocs");
    expect(result!.deps.length).toBeGreaterThan(0);
  });

  it("transforms getDocs call and produces valid JSON", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@oxc-ts-docgen/docgen'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

const docs = getDocs<BaseProps>()
`;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");

    const jsonMatch = result!.code.match(/JSON\.parse\(("[^"]*(?:\\.[^"]*)*")\)/);
    expect(jsonMatch).not.toBeNull();

    const innerJson = JSON.parse(jsonMatch![1]);
    const parsed = typeof innerJson === "string" ? JSON.parse(innerJson) : innerJson;
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].name).toBe("BaseProps");
    expect(parsed.entries[0].properties.length).toBeGreaterThan(0);
  });

  it("records dependency on the source file", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const normalizedTypesFile = typesFile.replace(/\\/g, "/");
    const code = `
import { getDocs } from '@oxc-ts-docgen/docgen'
import type { ButtonSize } from '${normalizedTypesFile}'

const docs = getDocs<ButtonSize>()
`;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).not.toBeNull();
    const normalizedDeps = result!.deps.map((d) => d.replace(/\\/g, "/"));
    expect(normalizedDeps).toContain(normalizedTypesFile);
  });

  it("transforms aliased getDocs imports", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs as docs } from '@oxc-ts-docgen/docgen'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

const schema = docs<BaseProps>()
`;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.code).not.toContain("docs<BaseProps>()");
  });

  it("resolves aliased imported type names to their exported declaration", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@oxc-ts-docgen/docgen'
import type { BaseProps as Props } from '${typesFile.replace(/\\/g, "/")}'

const schema = getDocs<Props>()
`;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");

    const jsonMatch = result!.code.match(/JSON\.parse\(("[^"]*(?:\\.[^"]*)*")\)/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(JSON.parse(jsonMatch![1]));
    expect(parsed.entries[0].name).toBe("BaseProps");
  });

  it("does not transform getDocs from unrelated docgen-like packages", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from 'my-docgen-utils'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

const schema = getDocs<BaseProps>()
`;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).toBeNull();
  });

  it("does not transform shadowed getDocs calls", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@oxc-ts-docgen/docgen'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

function local() {
  const getDocs = <T>() => ({})
  return getDocs<BaseProps>()
}

const schema = getDocs<BaseProps>()
`;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).not.toBeNull();
    expect(result!.code.match(/JSON\.parse/g)).toHaveLength(1);
    expect(result!.code).toContain("return getDocs<BaseProps>()");
  });

  it("does not transform getDocs calls shadowed in nested scopes", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@oxc-ts-docgen/docgen'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

{
  const getDocs = <T>() => ({})
  getDocs<BaseProps>()
}

const withParam = (getDocs: <T>() => unknown) => getDocs<BaseProps>()

class Example {
  render(getDocs: <T>() => unknown) {
    return getDocs<BaseProps>()
  }
}

const schema = getDocs<BaseProps>()
`;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).not.toBeNull();
    expect(result!.code.match(/JSON\.parse/g)).toHaveLength(1);
    expect(result!.code).toContain("getDocs<BaseProps>()");
    expect(result!.code).toContain("return getDocs<BaseProps>()");
  });

  it("resolves directory imports to index files", () => {
    const typesDir = resolve(pluginFixturesDir, "directory-types");
    const normalizedTypesDir = typesDir.replace(/\\/g, "/");
    const code = `
import { getDocs } from '@oxc-ts-docgen/docgen'
import type { DirectoryProps } from '${normalizedTypesDir}'

const schema = getDocs<DirectoryProps>()
`;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.deps.map((d) => d.replace(/\\/g, "/"))).toContain(
      `${normalizedTypesDir}/index.ts`,
    );
  });

  it("resolves getDocs type imports through tsconfig paths aliases", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-paths-"));
    const componentsDir = resolve(root, "src", "components");
    mkdirSync(componentsDir, { recursive: true });

    const buttonFile = resolve(componentsDir, "button.ts");
    const consumerFile = resolve(root, "src", "main.ts");
    writeFileSync(
      resolve(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@components/*": ["src/components/*"],
          },
        },
      }),
    );
    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(consumerFile, "");

    const code = `
import { getDocs } from '@oxc-ts-docgen/docgen'
import type { ButtonProps } from '@components/button'

const schema = getDocs<ButtonProps>()
`;
    const result = transformGetDocs(code, consumerFile, {});
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.deps.map((d) => d.replace(/\\/g, "/"))).toContain(
      buttonFile.replace(/\\/g, "/"),
    );
  });

  it("resolves getDocs type imports through barrel re-exports", () => {
    const root = mkdtempSync(resolve(tmpdir(), "oxc-docgen-transform-barrel-"));
    const srcDir = resolve(root, "src");
    mkdirSync(srcDir, { recursive: true });

    const buttonFile = resolve(srcDir, "button.ts");
    const barrelFile = resolve(srcDir, "index.ts");
    const consumerFile = resolve(srcDir, "main.ts");
    writeFileSync(buttonFile, "export interface ButtonProps { label: string }\n");
    writeFileSync(barrelFile, "export type { ButtonProps as PublicButtonProps } from './button'\n");
    writeFileSync(consumerFile, "");

    const code = `
import { getDocs } from '@oxc-ts-docgen/docgen'
import type { PublicButtonProps } from './index'

const schema = getDocs<PublicButtonProps>()
`;
    const result = transformGetDocs(code, consumerFile, {});
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.deps.map((d) => d.replace(/\\/g, "/"))).toContain(
      buttonFile.replace(/\\/g, "/"),
    );
  });

  it("preserves getDocs imports when some calls remain unresolved in dev transforms", () => {
    const typesFile = resolve(fixturesDir, "types.ts");
    const code = `
import { getDocs } from '@oxc-ts-docgen/docgen'
import type { BaseProps } from '${typesFile.replace(/\\/g, "/")}'

const known = getDocs<BaseProps>()
const missing = getDocs<MissingProps>()
`;
    const result = transformGetDocs(code, "/test.ts", {});
    expect(result).not.toBeNull();
    expect(result!.code).toContain("JSON.parse(");
    expect(result!.code).toContain("import { getDocs } from '@oxc-ts-docgen/docgen'");
    expect(result!.code).toContain("getDocs<MissingProps>()");
  });

  it("throws in strict mode when getDocs calls cannot be resolved", () => {
    const code = `
import { getDocs } from '@oxc-ts-docgen/docgen'

const missing = getDocs<MissingProps>()
`;
    expect(() => transformGetDocs(code, "/test.ts", {}, { failOnUnresolved: true })).toThrow(
      "could not compile all getDocs<T>() calls",
    );
  });
});
