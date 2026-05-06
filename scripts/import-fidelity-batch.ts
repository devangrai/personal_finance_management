import { readFile } from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { commitManualInvestmentImport, previewManualInvestmentImport } from "../apps/web/lib/manual-investments";
import { prisma } from "../packages/db/src";

loadEnv({ path: path.resolve(process.cwd(), ".env") });

type ImportKind = "transactions" | "holdings";
type Bucket = "retirement" | "taxable" | "other";

type ManifestEntry = {
  fileName: string;
  importKind: ImportKind;
  accountName: string;
  accountSubtype?: string | null;
  bucket: Bucket;
  asOfDate?: string | null;
  isoCurrencyCode?: string | null;
  source?: string | null;
  enabled?: boolean;
};

type ManifestFile = {
  source?: string;
  defaultCurrency?: string;
  imports: ManifestEntry[];
};

type CliOptions = {
  manifestPath: string;
  baseDir: string;
  mode: "preview" | "commit";
};

function parseArgs(argv: string[]): CliOptions {
  const defaultBaseDir = path.resolve(process.cwd(), "imports", "fidelity");
  const defaultManifestPath = path.join(defaultBaseDir, "fidelity-import-manifest.local.json");
  let manifestPath = defaultManifestPath;
  let baseDir = defaultBaseDir;
  let mode: "preview" | "commit" = "preview";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const next = argv[index + 1] ?? "";

    if (arg === "--manifest" && next) {
      manifestPath = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (arg === "--base-dir" && next) {
      baseDir = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (arg === "--mode" && (next === "preview" || next === "commit")) {
      mode = next;
      index += 1;
      continue;
    }
  }

  return {
    manifestPath,
    baseDir,
    mode
  };
}

async function loadManifest(manifestPath: string) {
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as ManifestFile;

  if (!Array.isArray(parsed.imports) || parsed.imports.length === 0) {
    throw new Error("The manifest must include at least one import entry.");
  }

  return parsed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = await loadManifest(options.manifestPath);
  const rows = manifest.imports.filter((entry) => entry.enabled !== false);

  if (rows.length === 0) {
    throw new Error("No enabled imports found in the manifest.");
  }

  const failures: string[] = [];
  let importedCount = 0;
  let duplicateCount = 0;

  console.log(`Running Fidelity batch import in ${options.mode} mode`);
  console.log(`Manifest: ${options.manifestPath}`);
  console.log(`Base dir: ${options.baseDir}`);

  for (const entry of rows) {
    const filePath = path.resolve(options.baseDir, entry.fileName);
    const csvContent = await readFile(filePath, "utf8");
    const input = {
      fileName: entry.fileName,
      csvContent,
      importKind: entry.importKind,
      accountName: entry.accountName,
      accountSubtype: entry.accountSubtype ?? null,
      bucket: entry.bucket,
      asOfDate: entry.asOfDate ?? null,
      isoCurrencyCode: entry.isoCurrencyCode ?? manifest.defaultCurrency ?? "USD",
      source: entry.source ?? manifest.source ?? "fidelity_csv"
    };

    if (options.mode === "preview") {
      const preview = previewManualInvestmentImport(input);
      if (!preview.ok) {
        failures.push(`${entry.fileName}: ${preview.error}`);
        continue;
      }

      console.log(
        `[preview] ${entry.fileName} -> ${preview.summary.accountName} (${preview.summary.importKind}) rows=${preview.summary.rowCount} warnings=${preview.summary.warnings.length}`
      );
      continue;
    }

    try {
      const result = await commitManualInvestmentImport(input);
      importedCount += result.importedCount;
      duplicateCount += result.duplicateCount;
      console.log(
        `[commit] ${entry.fileName} -> ${result.account.name} (${result.importKind}) imported=${result.importedCount} duplicates=${result.duplicateCount} warnings=${result.warnings.length}`
      );
    } catch (error) {
      failures.push(
        `${entry.fileName}: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  if (options.mode === "commit") {
    console.log(
      `Commit summary: imported=${importedCount} duplicate_rows=${duplicateCount} failures=${failures.length}`
    );
  }

  if (failures.length > 0) {
    console.error("Failures:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
