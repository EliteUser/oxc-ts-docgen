import { resolve } from "node:path";
import { generateDocs } from "./api";

const args = process.argv.slice(2);

function printUsage(): void {
  console.log(`
Usage: oxc-ts-docgen <file> <typeName> [options]

Arguments:
  file         Path to the TypeScript file
  typeName     Name of the type to document

Options:
  --ignore <types>   Comma-separated list of types to ignore
  --max-depth <n>    Maximum resolution depth (default: 3)
  --pretty           Pretty-print output (default)
  --compact          Compact JSON output
  --help, -h         Show this help message

Examples:
  oxc-ts-docgen src/Button.ts ButtonProps
  oxc-ts-docgen src/Button.ts ButtonProps --ignore HTMLAttributes,CSSProperties
  oxc-ts-docgen src/Button.ts ButtonProps --compact
`);
}

function main(): void {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const file = args[0];
  const typeName = args[1];

  if (!file || !typeName) {
    console.error("Error: Both <file> and <typeName> arguments are required.");
    printUsage();
    process.exit(1);
  }

  const ignoreIdx = args.indexOf("--ignore");
  const ignoreTypes =
    ignoreIdx !== -1 && args[ignoreIdx + 1]
      ? args[ignoreIdx + 1].split(",").map((s) => s.trim())
      : [];

  const depthIdx = args.indexOf("--max-depth");
  const maxDepth = depthIdx !== -1 && args[depthIdx + 1] ? parseInt(args[depthIdx + 1], 10) : 3;

  const compact = args.includes("--compact");

  const filePath = resolve(process.cwd(), file);

  try {
    const result = generateDocs({
      filePath,
      typeName,
      config: {
        ignoreTypes,
        maxDepth,
      },
    });

    const output = compact ? JSON.stringify(result) : JSON.stringify(result, null, 2);

    console.log(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
