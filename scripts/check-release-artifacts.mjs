import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkPackedConsumer } from "./check-packed-consumer.mjs";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

const failures = [];

const findPublishablePackageDirs = () => {
  const packagesRoot = resolveWorkspacePath("packages");

  return readdirSync(packagesRoot, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("packages", entry.name))
    .filter((packageDir) => {
      const manifest = readPackageManifest(packageDir);

      return manifest.private !== true;
    });
};

const readPackageManifest = (packageDir) => {
  const packageJsonPath = resolveWorkspacePath(packageDir, "package.json");

  return JSON.parse(readFileSync(packageJsonPath, "utf-8"));
};

const checkPackage = async (packageDir) => {
  const manifest = readPackageManifest(packageDir);
  const packageName = manifest.name ?? packageDir;

  checkPublishedFilePolicy({
    packageName,
    manifest,
  });

  for (const filePath of collectManifestFileReferences(manifest)) {
    checkDistReference({
      packageName,
      filePath,
    });
    checkFileExists({
      packageName,
      filePath: join(packageDir, filePath),
    });
  }

  for (const filePath of collectBinFileReferences(manifest)) {
    checkCliShebang({
      packageName,
      filePath: join(packageDir, filePath),
    });
  }

  await checkPackageImportSmoke({
    packageDir,
    packageName,
    manifest,
  });
};

const checkPublishedFilePolicy = (options) => {
  const { packageName, manifest } = options;

  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 1 ||
    manifest.files[0] !== "dist"
  ) {
    failures.push(
      `${packageName} must publish only the generated dist directory through package.json files field.`,
    );
  }
};

const collectManifestFileReferences = (manifest) => {
  const references = new Set();
  collectManifestValueReferences({
    references,
    value: manifest.main,
  });
  collectManifestValueReferences({
    references,
    value: manifest.module,
  });
  collectManifestValueReferences({
    references,
    value: manifest.types,
  });
  collectManifestValueReferences({
    references,
    value: manifest.typings,
  });
  collectManifestValueReferences({
    references,
    value: manifest.bin,
  });
  collectManifestValueReferences({
    references,
    value: manifest.exports,
  });

  return [...references];
};

const collectManifestValueReferences = (options) => {
  const { references, value } = options;

  if (!value) {
    return;
  }

  if (typeof value === "string") {
    if (value.startsWith("./")) {
      references.add(value.slice(2));
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectManifestValueReferences({
        references,
        value: item,
      });
    }

    return;
  }

  if (typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      collectManifestValueReferences({
        references,
        value: nestedValue,
      });
    }
  }
};

const collectBinFileReferences = (manifest) => {
  const references = new Set();
  collectManifestValueReferences({
    references,
    value: manifest.bin,
  });

  return [...references];
};

const checkDistReference = (options) => {
  const { packageName, filePath } = options;

  if (!filePath.startsWith("dist/")) {
    failures.push(
      `${packageName} package manifest references ${filePath}, but only dist is published.`,
    );
  }
};

const checkFileExists = (options) => {
  const { packageName, filePath } = options;
  const absolutePath = resolveWorkspacePath(filePath);

  try {
    const stats = statSync(absolutePath);

    if (!stats.isFile()) {
      failures.push(`${packageName} expected ${filePath} to be a file.`);
    }
  } catch {
    failures.push(`${packageName} package manifest references missing file ${filePath}.`);
  }
};

const checkCliShebang = (options) => {
  const { packageName, filePath } = options;
  const absolutePath = resolveWorkspacePath(filePath);
  const source = readFileSync(absolutePath, "utf-8");

  if (!source.startsWith("#!/usr/bin/env node")) {
    failures.push(`${packageName} CLI artifact ${filePath} must start with a node shebang.`);
  }
};

const checkPackageImportSmoke = async (options) => {
  const { packageDir, packageName, manifest } = options;
  const importEntry = getExportEntry(manifest, "import") ?? manifest.module;
  const requireEntry = getExportEntry(manifest, "require") ?? manifest.main;

  if (importEntry) {
    await checkEsmImport({
      packageDir,
      packageName,
      filePath: importEntry,
    });
  }

  if (requireEntry) {
    checkCjsRequire({
      packageDir,
      packageName,
      filePath: requireEntry,
    });
  }
};

const getExportEntry = (manifest, condition) => {
  const rootExport = manifest.exports?.["."];
  const conditionExport = rootExport?.[condition];

  if (typeof conditionExport === "string") {
    return conditionExport;
  }

  if (typeof conditionExport === "object" && typeof conditionExport.default === "string") {
    return conditionExport.default;
  }

  return undefined;
};

const checkEsmImport = async (options) => {
  const { packageDir, packageName, filePath } = options;
  const absolutePath = resolveManifestPath(packageDir, filePath);

  try {
    await import(pathToFileURL(absolutePath).href);
  } catch (error) {
    failures.push(
      `${packageName} ESM entry ${filePath} failed import smoke test: ${errorMessage(error)}`,
    );
  }
};

const checkCjsRequire = (options) => {
  const { packageDir, packageName, filePath } = options;
  const absolutePath = resolveManifestPath(packageDir, filePath);

  try {
    require(absolutePath);
  } catch (error) {
    failures.push(
      `${packageName} CJS entry ${filePath} failed require smoke test: ${errorMessage(error)}`,
    );
  }
};

const resolveManifestPath = (packageDir, filePath) => {
  return resolveWorkspacePath(packageDir, filePath.startsWith("./") ? filePath.slice(2) : filePath);
};

const errorMessage = (error) => {
  return error instanceof Error ? error.message : String(error);
};

const resolveWorkspacePath = (...segments) => {
  return join(workspaceRoot, ...segments);
};

for (const packageDir of findPublishablePackageDirs()) {
  await checkPackage(packageDir);
}

try {
  checkPackedConsumer({
    packageDirs: findPublishablePackageDirs(),
    workspaceRoot,
  });
} catch (error) {
  failures.push(`Packed consumer smoke test failed: ${errorMessage(error)}`);
}

if (failures.length > 0) {
  console.error("Release artifact check failed:");

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  process.exitCode = 1;
} else {
  console.log("Release artifact check passed.");
}
