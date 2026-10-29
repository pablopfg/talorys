#!/usr/bin/env node
// Versioning, changelog and release notes for Axis. See docs/releases.md.
//
//   node scripts/release.mjs next [auto|patch|minor|major|X.Y.Z]   prints the next version
//   node scripts/release.mjs prepare [auto|patch|minor|major|X.Y.Z] [--date YYYY-MM-DD]
//       moves "Não lançado" into a dated version section and bumps every version file
//   node scripts/release.mjs notes X.Y.Z                            prints that version's changelog section
//   node scripts/release.mjs current                                prints the current version
//   node scripts/release.mjs check-changelog <base CHANGELOG.md>    fails unless the PR updated "Não lançado"
//   node scripts/release.mjs check-title "<pull request title>"     fails unless the title is a Conventional Commit
//   node scripts/release.mjs github-package <owner/repo>            renames the installer for GitHub Packages (CI only)
//
// Uses only Node built-ins, so CI can run it without `npm ci`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UNRELEASED = /^## (?:Não lançado|Unreleased)[ \t]*$/m;
const UNRELEASED_TITLE = "## Não lançado";
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

// Changelog groups (Portuguese, plus the English ones inherited from upstream) and the bump each implies.
const MAJOR_GROUPS = ["Incompatível", "Breaking"];
const MINOR_GROUPS = ["Adicionado", "Added", "Alterado", "Changed", "Removido", "Removed", "Obsoleto", "Deprecated"];

export const TITLE_TYPES = ["feat", "fix", "perf", "refactor", "docs", "test", "build", "ci", "chore", "revert", "style", "security", "i18n"];
const TITLE = new RegExp(`^(${TITLE_TYPES.join("|")})(\\([a-z0-9._/-]+\\))?!?: \\S.*$`);

// Files that carry the release version. build-templates.mjs refuses to build when the first two differ.
export const VERSION_FILES = {
  installer: "packages/create-talorys/package.json",
  constants: "packages/shared/src/constants.ts",
  lockfile: "package-lock.json",
  shrinkwrap: "packages/create-talorys/npm-shrinkwrap.json",
};

export function parseVersion(v) {
  const m = SEMVER.exec(v ?? "");
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null } : null;
}

/** Negative, zero or positive like a sort comparator. A prerelease sorts before its release. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Invalid version: ${!x ? a : b}`);
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] - y[k];
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The "Não lançado" section: its bounds in the file and the text between its heading and the next "## ". */
export function unreleasedSection(changelog) {
  const m = UNRELEASED.exec(changelog);
  if (!m) return null;
  const bodyStart = m.index + m[0].length;
  const next = changelog.slice(bodyStart).search(/^## /m);
  const end = next === -1 ? changelog.length : bodyStart + next;
  return { start: m.index, bodyStart, end, body: changelog.slice(bodyStart, end) };
}

/** True when a section body has an entry, not just group headings and blank lines. */
export function hasEntries(body) {
  return body.split("\n").some((line) => line.trim() !== "" && !line.startsWith("#"));
}

/** Group headings ("### Adicionado") that have at least one entry under them. */
export function groupsWithEntries(body) {
  const groups = new Set();
  let current = null;
  for (const line of body.split("\n")) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) current = heading[1];
    else if (current && line.trim() !== "") groups.add(current);
  }
  return groups;
}

export function bumpFor(body) {
  const groups = groupsWithEntries(body);
  const has = (names) => names.some((name) => groups.has(name));
  if (has(MAJOR_GROUPS)) return "major";
  if (has(MINOR_GROUPS)) return "minor";
  return "patch";
}

/** Resolves `auto`, a bump type or an explicit X.Y.Z into the next version, which must be newer than `current`. */
export function nextVersion(current, target, changelog) {
  let next;
  if (parseVersion(target)) {
    next = target;
  } else {
    const bump = target === "auto" ? bumpFor(unreleasedSection(changelog)?.body ?? "") : target;
    const v = parseVersion(current);
    if (!v) throw new Error(`Invalid current version: ${current}`);
    if (bump === "major") next = `${v.major + 1}.0.0`;
    else if (bump === "minor") next = `${v.major}.${v.minor + 1}.0`;
    else if (bump === "patch") next = v.pre ? `${v.major}.${v.minor}.${v.patch}` : `${v.major}.${v.minor}.${v.patch + 1}`;
    else throw new Error(`Expected auto, patch, minor, major or X.Y.Z, got "${target}"`);
  }
  if (compareVersions(next, current) <= 0) throw new Error(`${next} is not newer than the current version ${current}`);
  return next;
}

/** Turns "Não lançado" into "## <version> — <date>" and opens a new, empty "Não lançado" above it. */
export function releaseChangelog(changelog, version, date) {
  const section = unreleasedSection(changelog);
  if (!section) throw new Error(`CHANGELOG.md has no "Não lançado" section`);
  if (!hasEntries(section.body)) throw new Error(`"Não lançado" is empty: nothing to release`);
  if (new RegExp(`^## ${version.replaceAll(".", "\\.")}(?:\\s|$)`, "m").test(changelog)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  // Drop group headings left without entries, so the released section only lists what changed.
  const body = section.body
    .trim()
    .split(/(?=^### )/m)
    .filter((chunk) => !chunk.startsWith("### ") || hasEntries(chunk))
    .map((chunk) => chunk.trim())
    .join("\n\n");
  return `${changelog.slice(0, section.start)}${UNRELEASED_TITLE}\n\n## ${version} — ${date}\n\n${body}\n\n${changelog.slice(section.end)}`;
}

/** The body of the "## <version>" section, for the GitHub release. */
export function releaseNotes(changelog, version) {
  const heading = new RegExp(`^## ${version.replaceAll(".", "\\.")}(?:[ \\t].*)?$`, "m").exec(changelog);
  if (!heading) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const bodyStart = heading.index + heading[0].length;
  const next = changelog.slice(bodyStart).search(/^## /m);
  const body = changelog.slice(bodyStart, next === -1 ? undefined : bodyStart + next).trim();
  if (!body) throw new Error(`The ${version} section of CHANGELOG.md is empty`);
  return `${body}\n`;
}

/** Why the pull request's CHANGELOG.md is not acceptable, or null when it is. */
export function changelogProblem(base, head) {
  const before = unreleasedSection(base);
  const after = unreleasedSection(head);
  if (!after) return `CHANGELOG.md precisa de uma seção "Não lançado".`;
  // A release pull request empties "Não lançado" into a new version section.
  const versions = (text) => new Set([...text.matchAll(/^## (\d+\.\d+\.\d+\S*)/gm)].map((m) => m[1]));
  const baseVersions = versions(base);
  if ([...versions(head)].some((v) => !baseVersions.has(v))) return null;
  if (before && before.body.trim() === after.body.trim()) {
    return `Descreva a mudança em "Não lançado" no CHANGELOG.md, ou adicione o rótulo "sem-changelog" se ela não afeta quem usa o Axis.`;
  }
  if (!hasEntries(after.body)) return `"Não lançado" ficou sem nenhuma entrada.`;
  return null;
}

export function titleProblem(title) {
  if (TITLE.test(title)) return null;
  return `O título "${title}" não segue o Conventional Commits. Use "<tipo>(escopo opcional): descrição", com um destes tipos: ${TITLE_TYPES.join(", ")}. Exemplo: "feat(chat): sugerir títulos de conversa". Um "!" depois do tipo marca uma mudança incompatível.`;
}

export function currentVersion(root) {
  return JSON.parse(readFileSync(join(root, VERSION_FILES.installer), "utf8")).version;
}

/** Writes `version` to every version file, keeping each file's formatting. */
export function writeVersion(root, version) {
  const path = (key) => join(root, VERSION_FILES[key]);

  const installer = readFileSync(path("installer"), "utf8");
  const nextInstaller = installer.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);
  if (nextInstaller === installer) throw new Error(`No version field in ${VERSION_FILES.installer}`);
  writeFileSync(path("installer"), nextInstaller);

  const constants = readFileSync(path("constants"), "utf8");
  const nextConstants = constants.replace(/(TALORYS_VERSION = ")[^"]+(")/, `$1${version}$2`);
  if (nextConstants === constants) throw new Error(`No TALORYS_VERSION in ${VERSION_FILES.constants}`);
  writeFileSync(path("constants"), nextConstants);

  const lock = JSON.parse(readFileSync(path("lockfile"), "utf8"));
  const entry = lock.packages?.["packages/create-talorys"];
  if (!entry) throw new Error(`No packages/create-talorys entry in ${VERSION_FILES.lockfile}`);
  entry.version = version;
  writeFileSync(path("lockfile"), `${JSON.stringify(lock, null, 2)}\n`);

  // The published installer's own lock: its name/version fields follow the package.
  const shrinkwrap = JSON.parse(readFileSync(path("shrinkwrap"), "utf8"));
  if (!shrinkwrap.packages?.[""]) throw new Error(`No root entry in ${VERSION_FILES.shrinkwrap}`);
  shrinkwrap.version = version;
  shrinkwrap.packages[""].version = version;
  writeFileSync(path("shrinkwrap"), `${JSON.stringify(shrinkwrap, null, 2)}\n`);
}

export function prepareRelease(root, target, date) {
  const changelogPath = join(root, "CHANGELOG.md");
  const changelog = readFileSync(changelogPath, "utf8");
  const version = nextVersion(currentVersion(root), target, changelog);
  writeFileSync(changelogPath, releaseChangelog(changelog, version, date));
  writeVersion(root, version);
  return version;
}

/**
 * Turns the installer into @<owner>/create-talorys, private on GitHub Packages. Run only on the
 * release runner, never committed: the repository keeps upstream's name so syncing stays clean.
 * The command stays `create-talorys`; its dependencies still come from the public npm registry.
 * The commands shown by the built CLI, app and Worker (`npx create-talorys@latest update`...) are
 * pointed at the new name.
 */
export function githubPackage(root, repository) {
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(repository ?? "");
  if (!m) throw new Error("github-package needs the repository as owner/name");
  const name = `@${m[1].toLowerCase()}/create-talorys`;
  const path = (key) => join(root, VERSION_FILES[key]);

  const pkg = JSON.parse(readFileSync(path("installer"), "utf8"));
  pkg.name = name;
  pkg.repository = { type: "git", url: `git+https://github.com/${m[1]}/${m[2]}.git`, directory: "packages/create-talorys" };
  pkg.publishConfig = { registry: "https://npm.pkg.github.com", access: "restricted" };
  writeFileSync(path("installer"), `${JSON.stringify(pkg, null, 2)}\n`);

  const shrinkwrap = JSON.parse(readFileSync(path("shrinkwrap"), "utf8"));
  if (!shrinkwrap.packages?.[""]) throw new Error(`No root entry in ${VERSION_FILES.shrinkwrap}`);
  shrinkwrap.name = name;
  shrinkwrap.packages[""].name = name;
  writeFileSync(path("shrinkwrap"), `${JSON.stringify(shrinkwrap, null, 2)}\n`);

  // Every command the installer, the app and the Worker tell the owner to run.
  const pkgDir = dirname(path("installer"));
  for (const dir of ["dist", "templates"]) {
    if (!existsSync(join(pkgDir, dir))) continue;
    for (const file of readdirSync(join(pkgDir, dir), { recursive: true }).filter((f) => f.endsWith(".js"))) {
      const text = readFileSync(join(pkgDir, dir, file), "utf8");
      const next = text.replace(/npx create-talorys(?=[@ ])/g, `npx ${name}`);
      if (next !== text) writeFileSync(join(pkgDir, dir, file), next);
    }
  }
  return name;
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [command, arg = "auto", ...rest] = argv;
  const read = (file) => readFileSync(join(root, file), "utf8");
  switch (command) {
    case "current":
      return currentVersion(root);
    case "next":
      return nextVersion(currentVersion(root), arg, read("CHANGELOG.md"));
    case "prepare": {
      const dateFlag = rest.indexOf("--date");
      const date = dateFlag === -1 ? new Date().toISOString().slice(0, 10) : rest[dateFlag + 1];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("--date must be YYYY-MM-DD");
      return prepareRelease(root, arg, date);
    }
    case "notes":
      return releaseNotes(read("CHANGELOG.md"), arg).trimEnd();
    case "check-changelog": {
      const problem = changelogProblem(readFileSync(arg, "utf8"), read("CHANGELOG.md"));
      if (problem) throw new Error(problem);
      return "CHANGELOG.md atualizado.";
    }
    case "check-title": {
      const problem = titleProblem(arg);
      if (problem) throw new Error(problem);
      return "Título OK.";
    }
    case "github-package":
      return githubPackage(root, arg);
    default:
      throw new Error("Usage: node scripts/release.mjs <current|next|prepare|notes|check-changelog|check-title|github-package> [arg]");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (err) {
    console.error(process.env.GITHUB_ACTIONS ? `::error::${err.message}` : err.message);
    process.exit(1);
  }
}
