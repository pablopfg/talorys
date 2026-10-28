// Regenerates npm-shrinkwrap.json: the exact runtime dependency tree, with integrity hashes,
// that `npx create-talorys` installs. Run after changing `dependencies`: npm run shrinkwrap -w create-talorys
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
// Outside the workspace, so npm resolves only what a user's install would: no dev or workspace packages.
const work = mkdtempSync(join(tmpdir(), "talorys-shrinkwrap-"));
try {
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, dependencies: pkg.dependencies }, null, 2));
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: work, stdio: "inherit" });
  execFileSync("npm", ["shrinkwrap"], { cwd: work, stdio: "inherit" });
  copyFileSync(join(work, "npm-shrinkwrap.json"), join(pkgDir, "npm-shrinkwrap.json"));
  console.log("Updated packages/create-talorys/npm-shrinkwrap.json");
} finally {
  rmSync(work, { recursive: true, force: true });
}
