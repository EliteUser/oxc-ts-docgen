import type { Dirent } from "node:fs";

import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  readdirSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readdirSync: fsMock.readdirSync,
}));

import { resolveConfig } from "../../src/public/config";
import { scanProjectFiles } from "../../src/resolver/project-file-scanner";
import { normalizePath } from "../../src/utils/path-utils";

const directoryEntry = (name: string): Dirent => {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false,
  } as Dirent;
};

const fileEntry = (name: string): Dirent => {
  return {
    name,
    isDirectory: () => false,
    isFile: () => true,
  } as Dirent;
};

describe("scanProjectFiles", () => {
  beforeEach(() => {
    fsMock.readdirSync.mockReset();
  });

  it("does not descend into excluded project directories", () => {
    const root = normalizePath(join("C:/workspace", "app"));
    const calls: string[] = [];

    fsMock.readdirSync.mockImplementation((dirPath: string) => {
      const normalized = normalizePath(dirPath);
      calls.push(normalized);

      if (normalized === root) {
        return [directoryEntry("src"), directoryEntry("dist"), directoryEntry("node_modules")];
      }

      if (normalized === normalizePath(join(root, "src"))) {
        return [fileEntry("button.ts"), directoryEntry("generated")];
      }

      if (
        normalized === normalizePath(join(root, "dist")) ||
        normalized === normalizePath(join(root, "node_modules")) ||
        normalized === normalizePath(join(root, "src", "generated"))
      ) {
        return [fileEntry("should-not-be-read.ts")];
      }

      return [];
    });

    const config = resolveConfig({
      exclude: ["dist/**", "src/generated/**", "**/node_modules/**"],
    });

    expect(scanProjectFiles(root, config).map(normalizePath)).toEqual([
      normalizePath(join(root, "src", "button.ts")),
    ]);
    expect(calls).not.toContain(normalizePath(join(root, "dist")));
    expect(calls).not.toContain(normalizePath(join(root, "node_modules")));
    expect(calls).not.toContain(normalizePath(join(root, "src", "generated")));
  });

  it("does not descend into directories that cannot match include globs", () => {
    const root = normalizePath(join("C:/workspace", "app"));
    const calls: string[] = [];

    fsMock.readdirSync.mockImplementation((dirPath: string) => {
      const normalized = normalizePath(dirPath);
      calls.push(normalized);

      if (normalized === root) {
        return [directoryEntry("src"), directoryEntry("docs"), directoryEntry("scripts")];
      }

      if (normalized === normalizePath(join(root, "src"))) {
        return [directoryEntry("components")];
      }

      if (normalized === normalizePath(join(root, "src", "components"))) {
        return [fileEntry("button.ts")];
      }

      if (
        normalized === normalizePath(join(root, "docs")) ||
        normalized === normalizePath(join(root, "scripts"))
      ) {
        return [fileEntry("should-not-be-read.ts")];
      }

      return [];
    });

    const config = resolveConfig({
      include: ["src/**/*.ts"],
      exclude: [],
    });

    expect(scanProjectFiles(root, config).map(normalizePath)).toEqual([
      normalizePath(join(root, "src", "components", "button.ts")),
    ]);
    expect(calls).not.toContain(normalizePath(join(root, "docs")));
    expect(calls).not.toContain(normalizePath(join(root, "scripts")));
  });

  it("keeps include empty as include all during directory pruning", () => {
    const root = normalizePath(join("C:/workspace", "app"));

    fsMock.readdirSync.mockImplementation((dirPath: string) => {
      const normalized = normalizePath(dirPath);

      if (normalized === root) {
        return [directoryEntry("src")];
      }

      if (normalized === normalizePath(join(root, "src"))) {
        return [fileEntry("button.ts")];
      }

      return [];
    });

    const config = resolveConfig({
      include: [],
      exclude: [],
    });

    expect(scanProjectFiles(root, config).map(normalizePath)).toEqual([
      normalizePath(join(root, "src", "button.ts")),
    ]);
  });
});
