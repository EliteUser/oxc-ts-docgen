import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const pnpmPath = process.env.npm_execpath;
const pnpmExecutable = pnpmPath
  ? /\.[cm]?js$/u.test(pnpmPath)
    ? {
        args: [pnpmPath],
        command: process.execPath,
      }
    : pnpmPath.endsWith(".cmd")
      ? {
          args: ["/d", "/s", "/c", pnpmPath],
          command: process.env.ComSpec ?? "cmd.exe",
        }
      : {
          args: [],
          command: pnpmPath,
        }
  : process.platform === "win32"
    ? {
        args: ["/d", "/s", "/c", "pnpm"],
        command: process.env.ComSpec ?? "cmd.exe",
      }
    : {
        args: [],
        command: "pnpm",
      };

export const checkPackedConsumer = (options) => {
  const { packageDirs, workspaceRoot } = options;
  const consumerDir = mkdtempSync(join(tmpdir(), "oxc-ts-docgen-release-"));
  const packsDir = join(consumerDir, "packs");

  try {
    mkdirSync(packsDir);
    const manifests = new Map();
    const tarballs = new Map();

    for (const packageDir of packageDirs) {
      const packageRoot = join(workspaceRoot, packageDir);
      const manifest = readManifest(packageRoot);
      runPnpm(["pack", "--pack-destination", packsDir], packageRoot);
      manifests.set(manifest.name, manifest);
      tarballs.set(manifest.name, join(packsDir, packageTarballName(manifest)));
    }

    checkPackedWorkspaceDependency({
      manifests,
      tarballs,
    });
    writePackedConsumerFiles({
      consumerDir,
      manifests,
      tarballs,
    });
    runPnpm(
      ["install", "--prefer-offline", "--frozen-lockfile=false", "--ignore-scripts"],
      consumerDir,
    );
    runPackedConsumerSmokeTests(consumerDir);
  } catch (error) {
    throw new Error(commandErrorMessage(error));
  } finally {
    rmSync(consumerDir, {
      force: true,
      recursive: true,
    });
  }
};

const readManifest = (packageRoot) => {
  return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8"));
};

const packageTarballName = (manifest) => {
  const packageSlug = manifest.name.replace(/^@/, "").replaceAll("/", "-");

  return `${packageSlug}-${manifest.version}.tgz`;
};

const checkPackedWorkspaceDependency = (options) => {
  const { manifests, tarballs } = options;
  const viteTarball = tarballs.get("@synthfall/oxc-ts-docgen-vite");

  if (!viteTarball) {
    throw new Error("Expected the packed Vite adapter tarball.");
  }

  const packedManifest = JSON.parse(readTarEntry(viteTarball, "package/package.json"));
  const expectedVersion = manifests.get("@synthfall/oxc-ts-docgen")?.version;
  const packedVersion = packedManifest.dependencies?.["@synthfall/oxc-ts-docgen"];

  if (!expectedVersion || packedVersion !== expectedVersion) {
    throw new Error(
      `Packed Vite adapter must depend on @synthfall/oxc-ts-docgen ${String(expectedVersion)}, received ${String(packedVersion)}.`,
    );
  }
};

const readTarEntry = (archivePath, expectedPath) => {
  const archive = gunzipSync(readFileSync(archivePath));
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    const name = readTarString(header.subarray(0, 100));

    if (!name) {
      break;
    }

    const sizeText = readTarString(header.subarray(124, 136));
    const size = Number.parseInt(sizeText, 8);
    const contentOffset = offset + 512;

    if (name === expectedPath) {
      return archive.subarray(contentOffset, contentOffset + size).toString("utf-8");
    }

    offset = contentOffset + Math.ceil(size / 512) * 512;
  }

  throw new Error(`Packed archive ${archivePath} does not contain ${expectedPath}.`);
};

const readTarString = (value) => {
  const nullIndex = value.indexOf(0);
  const end = nullIndex === -1 ? value.length : nullIndex;

  return value.subarray(0, end).toString("utf-8").trim();
};

const writePackedConsumerFiles = (options) => {
  const { consumerDir, manifests, tarballs } = options;
  const coreTarball = tarballs.get("@synthfall/oxc-ts-docgen");
  const viteTarball = tarballs.get("@synthfall/oxc-ts-docgen-vite");
  const coreManifest = manifests.get("@synthfall/oxc-ts-docgen");
  const viteManifest = manifests.get("@synthfall/oxc-ts-docgen-vite");

  if (!coreTarball || !viteTarball || !coreManifest || !viteManifest) {
    throw new Error("Expected both publishable package tarballs and manifests.");
  }

  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "oxc-ts-docgen-release-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@types/node": viteManifest.devDependencies["@types/node"],
          "@synthfall/oxc-ts-docgen": `file:${coreTarball}`,
          "@synthfall/oxc-ts-docgen-vite": `file:${viteTarball}`,
          typescript: coreManifest.dependencies.typescript,
          vite: viteManifest.devDependencies.vite,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(consumerDir, "pnpm-workspace.yaml"),
    `packages: []\n\noverrides:\n  "@synthfall/oxc-ts-docgen": "file:${coreTarball.replaceAll("\\", "/")}"\n`,
  );
  writeFileSync(
    join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          lib: ["ESNext"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ESNext",
          types: ["node"],
        },
        include: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(consumerDir, "consumer.ts"),
    `import type { DocSchema } from "@synthfall/oxc-ts-docgen";\nimport { docgenPlugin, type DocgenPluginOptions } from "@synthfall/oxc-ts-docgen-vite";\n\nconst schema: DocSchema = { version: 1, entries: [] };\nconst options: DocgenPluginOptions = {};\n\nvoid schema;\nvoid docgenPlugin(options);\n`,
  );
};

const runPackedConsumerSmokeTests = (consumerDir) => {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'await import("@synthfall/oxc-ts-docgen"); await import("@synthfall/oxc-ts-docgen-vite");',
    ],
    commandOptions(consumerDir),
  );
  execFileSync(
    process.execPath,
    ["--eval", 'require("@synthfall/oxc-ts-docgen"); require("@synthfall/oxc-ts-docgen-vite");'],
    commandOptions(consumerDir),
  );
  runPnpm(["exec", "tsc", "--project", "tsconfig.json"], consumerDir);
  runPnpm(["exec", "oxc-ts-docgen", "--help"], consumerDir);
};

const runPnpm = (args, cwd) => {
  execFileSync(pnpmExecutable.command, [...pnpmExecutable.args, ...args], commandOptions(cwd));
};

const commandOptions = (cwd) => {
  return {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  };
};

const commandErrorMessage = (error) => {
  if (typeof error === "object" && error !== null) {
    for (const streamName of ["stderr", "stdout"]) {
      if (streamName in error && error[streamName] !== undefined) {
        const output = String(error[streamName]).trim();

        if (output) {
          return output;
        }
      }
    }
  }

  return error instanceof Error ? error.message : String(error);
};
