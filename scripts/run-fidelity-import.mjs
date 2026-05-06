import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const tempDir = path.join(process.cwd(), ".tmp", "fidelity-import");
const outfile = path.join(tempDir, "import-fidelity-batch.cjs");
const require = createRequire(import.meta.url);

await mkdir(tempDir, { recursive: true });

try {
  await build({
    entryPoints: [path.resolve(process.cwd(), "scripts/import-fidelity-batch.ts")],
    outfile,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    tsconfig: path.resolve(process.cwd(), "tsconfig.base.json"),
    external: ["@prisma/client"]
  });

  require(outfile);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
