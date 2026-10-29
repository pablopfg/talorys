// Run with: npm run test:release
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bumpFor,
  changelogProblem,
  compareVersions,
  githubPackage,
  nextVersion,
  prepareRelease,
  releaseChangelog,
  releaseNotes,
  titleProblem,
  unreleasedSection,
  VERSION_FILES,
} from "./release.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const changelog = `# Changelog

Intro.

## Não lançado

### Adicionado

- Nova tela de rotinas (#10)

### Corrigido

### Atualização

- Migração 14 adiciona a tabela \`tal_x\`.

## 1.0.0 — 2026-11-01

### Adicionado

- Primeira versão do fork.

## Histórico do Talorys original (até a versão 0.1.7)

## 0.1.7 — 2026-10-19

### Added

- Upstream entry
`;

describe("versions", () => {
  test("compare", () => {
    assert.ok(compareVersions("1.0.0", "0.9.9") > 0);
    assert.ok(compareVersions("1.0.0-rc.1", "1.0.0") < 0);
    assert.ok(compareVersions("1.0.0-rc.2", "1.0.0-rc.1") > 0);
    assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
    assert.throws(() => compareVersions("1.2", "1.2.3"), /Invalid version/);
  });

  test("bump from the changelog groups that have entries", () => {
    assert.equal(bumpFor("### Corrigido\n\n- x\n\n### Adicionado\n"), "patch");
    assert.equal(bumpFor("### Corrigido\n\n### Adicionado\n\n- x\n"), "minor");
    assert.equal(bumpFor("### Added\n\n- x\n"), "minor");
    assert.equal(bumpFor("### Segurança\n\n- x\n### Atualização\n- y\n"), "patch");
    assert.equal(bumpFor("### Incompatível\n\n- x\n### Adicionado\n- y\n"), "major");
  });

  test("next version", () => {
    assert.equal(nextVersion("1.0.0", "auto", changelog), "1.1.0");
    assert.equal(nextVersion("1.0.0", "patch", changelog), "1.0.1");
    assert.equal(nextVersion("1.4.2", "minor", changelog), "1.5.0");
    assert.equal(nextVersion("1.4.2", "major", changelog), "2.0.0");
    assert.equal(nextVersion("0.1.7", "1.0.0", changelog), "1.0.0");
    assert.equal(nextVersion("1.0.0-rc.1", "patch", changelog), "1.0.0");
    assert.throws(() => nextVersion("1.0.0", "1.0.0", changelog), /not newer/);
    assert.throws(() => nextVersion("1.0.0", "0.9.0", changelog), /not newer/);
    assert.throws(() => nextVersion("1.0.0", "huge", changelog), /Expected auto/);
  });
});

describe("changelog", () => {
  test("release moves Não lançado into a dated section and drops empty groups", () => {
    const out = releaseChangelog(changelog, "1.1.0", "2026-11-20");
    const unreleased = unreleasedSection(out);
    assert.equal(unreleased.body.trim(), "");
    assert.match(out, /## Não lançado\n\n## 1\.1\.0 — 2026-11-20\n\n### Adicionado\n\n- Nova tela de rotinas \(#10\)\n\n### Atualização\n/);
    assert.doesNotMatch(releaseNotes(out, "1.1.0"), /Corrigido/);
    assert.match(out, /## 1\.0\.0 — 2026-11-01/);
    assert.match(out, /## 0\.1\.7 — 2026-10-19\n\n### Added\n\n- Upstream entry\n$/);
  });

  test("release accepts the upstream English heading and refuses empty or repeated releases", () => {
    const english = changelog.replace("## Não lançado", "## Unreleased");
    assert.match(releaseChangelog(english, "1.1.0", "2026-11-20"), /^## Não lançado$/m);
    const empty = releaseChangelog(changelog, "1.1.0", "2026-11-20");
    assert.throws(() => releaseChangelog(empty, "1.2.0", "2026-11-21"), /empty/);
    assert.throws(() => releaseChangelog(changelog, "1.0.0", "2026-11-21"), /already has a section/);
    assert.throws(() => releaseChangelog("# Changelog\n", "1.0.0", "2026-11-21"), /no "Não lançado"/);
  });

  test("release notes are the version's section only", () => {
    assert.equal(releaseNotes(changelog, "1.0.0"), "### Adicionado\n\n- Primeira versão do fork.\n");
    assert.equal(releaseNotes(changelog, "0.1.7"), "### Added\n\n- Upstream entry\n");
    assert.throws(() => releaseNotes(changelog, "9.9.9"), /no section/);
    assert.throws(() => releaseNotes(changelog, "1.0"), /no section/);
  });

  test("a pull request must change Não lançado", () => {
    const added = changelog.replace("- Nova tela de rotinas (#10)", "- Nova tela de rotinas (#10)\n- Outra coisa (#11)");
    assert.equal(changelogProblem(changelog, added), null);
    assert.match(changelogProblem(changelog, changelog), /sem-changelog/);
    // Editing an old release does not count.
    assert.match(changelogProblem(changelog, changelog.replace("Upstream entry", "Upstream entry!")), /sem-changelog/);
    assert.match(changelogProblem(changelog, changelog.replace("## Não lançado", "## Something")), /precisa de uma seção/);
    const wiped = changelog.replace(/## Não lançado[\s\S]*?(?=## 1\.0\.0)/, "## Não lançado\n\n");
    assert.match(changelogProblem(changelog, wiped), /sem nenhuma entrada/);
  });

  test("a release pull request passes", () => {
    assert.equal(changelogProblem(changelog, releaseChangelog(changelog, "1.1.0", "2026-11-20")), null);
  });
});

describe("pull request titles", () => {
  for (const ok of ["feat: rotinas com MCP", "fix(agent): limite por IP", "feat(web)!: novo layout", "chore(release): v1.0.0", "ci(deps): bump actions/checkout"]) {
    test(`accepts "${ok}"`, () => assert.equal(titleProblem(ok), null));
  }
  for (const bad of ["Add pt-BR translation", "feat:sem espaço", "feature: x", "Fix(agent): x", "feat(): x", "feat: "]) {
    test(`rejects "${bad}"`, () => assert.match(titleProblem(bad), /Conventional Commits/));
  }
});

describe("prepare on a copy of the repository files", () => {
  test("bumps every version file and keeps the build's version check passing", () => {
    const dir = mkdtempSync(join(tmpdir(), "talorys-release-"));
    try {
      for (const file of [...Object.values(VERSION_FILES), "CHANGELOG.md"]) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        cpSync(join(root, file), join(dir, file));
      }
      writeFileSync(join(dir, "CHANGELOG.md"), changelog);
      const lockBefore = readFileSync(join(dir, VERSION_FILES.lockfile), "utf8");

      assert.equal(prepareRelease(dir, "9.0.0", "2026-11-20"), "9.0.0");

      const pkg = JSON.parse(readFileSync(join(dir, VERSION_FILES.installer), "utf8"));
      assert.equal(pkg.version, "9.0.0");
      const constants = readFileSync(join(dir, VERSION_FILES.constants), "utf8");
      assert.match(constants, /TALORYS_VERSION = "9\.0\.0"/);
      const lockAfter = readFileSync(join(dir, VERSION_FILES.lockfile), "utf8");
      assert.equal(JSON.parse(lockAfter).packages["packages/create-talorys"].version, "9.0.0");
      // Only the installer's lockfile entry changes.
      const changed = lockAfter.split("\n").filter((line, i) => line !== lockBefore.split("\n")[i]);
      assert.deepEqual(changed, ['      "version": "9.0.0",']);
      const shrinkwrap = JSON.parse(readFileSync(join(dir, VERSION_FILES.shrinkwrap), "utf8"));
      assert.equal(shrinkwrap.version, "9.0.0");
      assert.equal(shrinkwrap.packages[""].version, "9.0.0");
      assert.match(readFileSync(join(dir, "CHANGELOG.md"), "utf8"), /## 9\.0\.0 — 2026-11-20/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("every dependency in the repository is pinned to an exact version", () => {
    const manifests = ["package.json", "apps/agent/package.json", "apps/web/package.json", "packages/shared/package.json", "packages/create-talorys/package.json"];
    for (const file of manifests) {
      const pkg = JSON.parse(readFileSync(join(root, file), "utf8"));
      const specs = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.overrides?.tsup };
      for (const [name, spec] of Object.entries(specs)) {
        // "*" is a workspace package, resolved to the local copy.
        if (spec !== "*") assert.match(spec, /^\d+\.\d+\.\d+/, `${file}: ${name} "${spec}" should be exact (save-exact=true in .npmrc)`);
      }
    }
  });

  test("the repository's own changelog and version files are consistent", () => {
    const pkg = JSON.parse(readFileSync(join(root, VERSION_FILES.installer), "utf8"));
    const constants = readFileSync(join(root, VERSION_FILES.constants), "utf8");
    assert.equal(constants.match(/TALORYS_VERSION = "([^"]+)"/)[1], pkg.version);
    // The published installer installs exactly the locked tree: same version and same direct dependencies.
    const shrinkwrap = JSON.parse(readFileSync(join(root, VERSION_FILES.shrinkwrap), "utf8"));
    assert.equal(shrinkwrap.packages[""].version, pkg.version);
    assert.deepEqual(shrinkwrap.packages[""].dependencies, pkg.dependencies, "run npm run shrinkwrap -w create-talorys");
    for (const [name, spec] of Object.entries(pkg.dependencies)) {
      assert.match(spec, /^\d+\.\d+\.\d+/, `${name} is pinned to an exact version`);
      assert.equal(shrinkwrap.packages[`node_modules/${name}`]?.version, spec, `${name} is locked at ${spec}`);
    }
    assert.ok(unreleasedSection(readFileSync(join(root, "CHANGELOG.md"), "utf8")), "CHANGELOG.md has a Não lançado section");
  });
});

describe("GitHub Packages", () => {
  test("renames the installer to the owner's private scope and keeps everything else", () => {
    const dir = mkdtempSync(join(tmpdir(), "talorys-package-"));
    try {
      for (const file of [VERSION_FILES.installer, VERSION_FILES.shrinkwrap]) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        cpSync(join(root, file), join(dir, file));
      }
      const before = JSON.parse(readFileSync(join(dir, VERSION_FILES.installer), "utf8"));
      const cli = join(dir, "packages/create-talorys/dist/cli.js");
      mkdirSync(dirname(cli), { recursive: true });
      writeFileSync(cli, "Run `npx create-talorys@latest update`. Run `npx create-talorys@latest doctor`.");
      assert.equal(githubPackage(dir, "PabloX/talorys"), "@pablox/create-talorys");

      const pkg = JSON.parse(readFileSync(join(dir, VERSION_FILES.installer), "utf8"));
      assert.equal(pkg.name, "@pablox/create-talorys");
      assert.deepEqual(pkg.publishConfig, { registry: "https://npm.pkg.github.com", access: "restricted" });
      assert.equal(pkg.repository.url, "git+https://github.com/PabloX/talorys.git");
      // The command, version, files and dependencies are the same as the tested package's.
      for (const key of ["version", "bin", "files", "dependencies", "engines"]) assert.deepEqual(pkg[key], before[key]);
      const shrinkwrap = JSON.parse(readFileSync(join(dir, VERSION_FILES.shrinkwrap), "utf8"));
      assert.equal(shrinkwrap.name, "@pablox/create-talorys");
      assert.equal(shrinkwrap.packages[""].name, "@pablox/create-talorys");
      assert.equal(shrinkwrap.packages[""].version, before.version);
      assert.equal(readFileSync(cli, "utf8"), "Run `npx @pablox/create-talorys@latest update`. Run `npx @pablox/create-talorys@latest doctor`.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses anything but owner/name", () => {
    for (const bad of ["", "talorys", "a/b/c", "-x/talorys", "x/ta lorys", "../x", "x/talorys\n"]) {
      assert.throws(() => githubPackage("/nonexistent", bad), /owner\/name/);
    }
  });
});

describe("command line", () => {
  const cli = (...args) => execFileSync(process.execPath, [join(root, "scripts/release.mjs"), ...args], { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } });

  test("current and notes", () => {
    assert.match(cli("current"), /^\d+\.\d+\.\d+/);
    assert.match(cli("notes", "0.1.7"), /Personal access tokens/);
  });

  test("check-title fails with a readable message", () => {
    assert.equal(cli("check-title", "fix: x").trim(), "Título OK.");
    assert.throws(() => cli("check-title", "Fix x"), (err) => err.status === 1 && /Conventional Commits/.test(err.stderr));
  });
});
