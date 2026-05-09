import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli";

function createIO(cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      cwd,
      stdout: { log: (message: string) => stdout.push(message) },
      stderr: { error: (message: string) => stderr.push(message) },
    },
    stdout,
    stderr,
  };
}

describe("oxc-ts-docgen CLI", () => {
  it("loads JSON config files and applies serializable options", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-cli-config-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "button.ts"),
      [
        "export interface ButtonProps {",
        "  /** Public label. */",
        "  label: string",
        "  internal: boolean",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "docgen.config.json"),
      JSON.stringify({ skipPropsWithName: ["internal"] }),
    );

    const { io, stdout, stderr } = createIO(root);
    const code = runCli(["src/button.ts", "ButtonProps", "--config", "docgen.config.json"], io);

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    const output = JSON.parse(stdout[0]);
    expect(output.entries[0].properties.map((prop: { name: string }) => prop.name)).toEqual([
      "label",
    ]);
  });

  it("resolves tsconfig paths in JSON config files from the config file directory", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-cli-config-tsconfig-"));
    const configDir = join(root, "config");
    const sharedDir = join(root, "src", "shared");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@shared/*": ["src/shared/*"] },
        },
      }),
    );
    writeFileSync(
      join(configDir, "docgen.config.json"),
      JSON.stringify({ tsconfig: "../tsconfig.json" }),
    );
    writeFileSync(join(sharedDir, "base.ts"), "export interface BaseProps { base: string }\n");
    writeFileSync(
      join(root, "src", "button.ts"),
      [
        "import type { BaseProps } from '@shared/base'",
        "export interface ButtonProps extends BaseProps { label: string }",
      ].join("\n"),
    );

    const { io, stdout, stderr } = createIO(root);
    const code = runCli(
      ["src/button.ts", "ButtonProps", "--config", "config/docgen.config.json"],
      io,
    );

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    const output = JSON.parse(stdout[0]);
    expect(output.entries[0].properties.map((prop: { name: string }) => prop.name)).toEqual([
      "base",
      "label",
    ]);
  });

  it("reports invalid preset names from JSON config files", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-cli-invalid-preset-"));
    writeFileSync(join(root, "button.ts"), "export interface ButtonProps { label: string }\n");
    writeFileSync(join(root, "docgen.config.json"), JSON.stringify({ presets: ["vue"] }));

    const { io, stderr } = createIO(root);
    const code = runCli(["button.ts", "ButtonProps", "--config", "docgen.config.json"], io);

    expect(code).toBe(1);
    expect(stderr.join("\n")).toContain("Error [invalid-configuration]");
    expect(stderr.join("\n")).toContain('Invalid docgen config preset "vue"');
  });

  it("distinguishes unresolved type failures", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-cli-unresolved-"));
    writeFileSync(join(root, "button.ts"), "export interface ButtonProps { label: string }\n");

    const { io, stderr } = createIO(root);
    const code = runCli(["button.ts", "MissingProps"], io);

    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("Error [unresolved-type]");
  });

  it("applies include and exclude patterns to explicit input files", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-cli-patterns-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "button.ts"),
      "export interface ButtonProps { label: string }\n",
    );

    let result = createIO(root);
    expect(
      runCli(["src/button.ts", "ButtonProps", "--include", "components/**/*.ts"], result.io),
    ).toBe(2);
    expect(result.stderr.join("\n")).toContain("Error [file-excluded]");

    result = createIO(root);
    expect(runCli(["src/button.ts", "ButtonProps", "--include", "src/**/*.ts"], result.io)).toBe(0);
    expect(JSON.parse(result.stdout[0]).entries[0].name).toBe("ButtonProps");

    result = createIO(root);
    expect(runCli(["src/button.ts", "ButtonProps", "--exclude", "src/button.ts"], result.io)).toBe(
      2,
    );
    expect(result.stderr.join("\n")).toContain("Error [file-excluded]");
  });

  it("distinguishes parse failures", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-cli-parse-"));
    writeFileSync(join(root, "broken.ts"), "export interface BrokenProps { label: }\n");

    const { io, stderr } = createIO(root);
    const code = runCli(["broken.ts", "BrokenProps"], io);

    expect(code).toBe(1);
    expect(stderr.join("\n")).toContain("Error [parse-failure]");
  });

  it("can fail on resolver diagnostics", () => {
    const root = mkdtempSync(join(tmpdir(), "oxc-docgen-cli-diagnostics-"));
    writeFileSync(join(root, "button.ts"), "export interface ButtonProps { label: string }\n");

    const { io, stderr } = createIO(root);
    const code = runCli(
      ["button.ts", "ButtonProps", "--tsconfig", "missing-tsconfig.json", "--fail-on-diagnostics"],
      io,
    );

    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("Error [resolver-diagnostics]");
    expect(stderr.join("\n")).toContain("tsconfig-not-found");
  });
});
