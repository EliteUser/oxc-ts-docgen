import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveConfig } from "../../src/public/config";
import { scanProjectFiles } from "../../src/resolver/project-file-scanner";
import { matchesGlob, normalizePath } from "../../src/utils/path-utils";

describe("path utilities", () => {
  it("normalizes Windows separators to slash-separated cache keys", () => {
    expect(normalizePath("C:\\repo\\src\\button.ts")).toBe("C:/repo/src/button.ts");
  });

  it("matches single-star and globstar file patterns", () => {
    expect(matchesGlob("src/button.ts", "src/*.ts")).toBe(true);
    expect(matchesGlob("src/components/button.ts", "src/*.ts")).toBe(false);
    expect(matchesGlob("src/components/button.ts", "src/**/*.ts")).toBe(true);
    expect(matchesGlob("src/button.ts", "src/**/*.ts")).toBe(true);
  });

  it("normalizes pattern separators before matching", () => {
    expect(matchesGlob("src/components/button.ts", "src\\**\\*.ts")).toBe(true);
  });

  it("supports question-mark wildcards without crossing directories", () => {
    expect(matchesGlob("src/a.ts", "src/?.ts")).toBe(true);
    expect(matchesGlob("src/ab.ts", "src/?.ts")).toBe(false);
    expect(matchesGlob("src/nested/a.ts", "src/?.ts")).toBe(false);
  });

  it("scans project TypeScript files with shared include and exclude policy", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-scan-"));
    mkdirSync(join(root, "src", "nested"), { recursive: true });
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });

    writeFileSync(join(root, "src", "button.ts"), "export interface ButtonProps {}");
    writeFileSync(join(root, "src", "nested", "link.tsx"), "export interface LinkProps {}");
    writeFileSync(join(root, "src", "button.test.ts"), "export interface TestProps {}");
    writeFileSync(join(root, "src", "types.d.ts"), "export interface AmbientProps {}");
    writeFileSync(
      join(root, "node_modules", "pkg", "index.ts"),
      "export interface PackageProps {}",
    );

    const files = scanProjectFiles(root, resolveConfig()).map((file) =>
      normalizePath(file).slice(normalizePath(root).length + 1),
    );

    expect(files.sort()).toEqual(["src/button.ts", "src/nested/link.tsx"]);
  });
});
