import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ConfigError, main, renderConfig, stripJsonc } from "./render-wrangler-config.mjs";

const STANDALONE = fileURLToPath(new URL("../../apps/agent/wrangler.standalone.jsonc", import.meta.url));
const base = () => JSON.parse(stripJsonc(readFileSync(STANDALONE, "utf8")));

describe("stripJsonc", () => {
  it("drops comments and trailing commas but keeps slashes inside strings", () => {
    const text = `{
      // line comment
      "url": "https://example.com/a//b", /* block */
      "list": [1, 2,],
    }`;
    assert.deepEqual(JSON.parse(stripJsonc(text)), { url: "https://example.com/a//b", list: [1, 2] });
  });

  it("keeps escaped quotes inside strings", () => {
    assert.deepEqual(JSON.parse(stripJsonc(`{"a": "say \\"hi\\" // not a comment"}`)), {
      a: 'say "hi" // not a comment',
    });
  });

  it("parses the real standalone config", () => {
    const config = base();
    assert.equal(config.main, "src/index.ts");
    assert.equal(config.assets.directory, "../web/dist");
  });
});

describe("renderConfig", () => {
  it("requires a valid Worker name", () => {
    assert.throws(() => renderConfig(base(), {}), ConfigError);
    assert.throws(() => renderConfig(base(), { TALORYS_WORKER_NAME: "Bad_Name" }), ConfigError);
    assert.throws(() => renderConfig(base(), { TALORYS_WORKER_NAME: "-edge" }), ConfigError);
  });

  it("serves only the custom domain when one is set", () => {
    const config = renderConfig(base(), {
      TALORYS_WORKER_NAME: "talorys",
      TALORYS_CUSTOM_DOMAIN: "Assistente.Example.com",
    });
    assert.equal(config.name, "talorys");
    assert.deepEqual(config.routes, [{ pattern: "assistente.example.com", custom_domain: true }]);
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.equal(config.vars.TALORYS_ALLOWED_HOSTS, "assistente.example.com");
  });

  it("limits the API to the workers.dev host given for the health check", () => {
    const config = renderConfig(base(), { TALORYS_WORKER_NAME: "talorys", TALORYS_PUBLIC_URL: "https://Talorys.Me.workers.dev/" });
    assert.equal(config.vars.TALORYS_ALLOWED_HOSTS, "talorys.me.workers.dev");
    // The custom domain wins over the public URL.
    const both = renderConfig(base(), {
      TALORYS_WORKER_NAME: "talorys",
      TALORYS_CUSTOM_DOMAIN: "a.example.com",
      TALORYS_PUBLIC_URL: "https://talorys.me.workers.dev",
    });
    assert.equal(both.vars.TALORYS_ALLOWED_HOSTS, "a.example.com");
  });

  it("rejects a public URL that is not a bare https origin", () => {
    for (const url of ["http://a.example.com", "https://a.example.com/x", "https://a.example.com:8443", "https://u:p@a.example.com", "nope"]) {
      assert.throws(() => renderConfig(base(), { TALORYS_WORKER_NAME: "talorys", TALORYS_PUBLIC_URL: url }), ConfigError, url);
    }
  });

  it("passes Cloudflare Access settings through only as a valid pair", () => {
    const aud = "a".repeat(64);
    const config = renderConfig(base(), {
      TALORYS_WORKER_NAME: "talorys",
      TALORYS_ACCESS_TEAM_DOMAIN: "MyTeam.cloudflareaccess.com",
      TALORYS_ACCESS_AUD: aud.toUpperCase(),
    });
    assert.equal(config.vars.TALORYS_ACCESS_TEAM_DOMAIN, "myteam.cloudflareaccess.com");
    assert.equal(config.vars.TALORYS_ACCESS_AUD, aud);
    const ok = { TALORYS_WORKER_NAME: "talorys" };
    assert.throws(() => renderConfig(base(), { ...ok, TALORYS_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com" }), ConfigError);
    assert.throws(() => renderConfig(base(), { ...ok, TALORYS_ACCESS_AUD: aud }), ConfigError);
    assert.throws(() => renderConfig(base(), { ...ok, TALORYS_ACCESS_TEAM_DOMAIN: "evil.example.com", TALORYS_ACCESS_AUD: aud }), ConfigError);
    assert.throws(() => renderConfig(base(), { ...ok, TALORYS_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com", TALORYS_ACCESS_AUD: "short" }), ConfigError);
  });

  it("falls back to workers.dev without a domain, still without preview URLs", () => {
    const config = renderConfig(base(), { TALORYS_WORKER_NAME: "talorys" });
    assert.equal(config.workers_dev, true);
    assert.equal(config.preview_urls, false);
    assert.equal(config.routes, undefined);
  });

  it("rejects a domain with a scheme, path or wildcard", () => {
    for (const domain of ["https://a.example.com", "a.example.com/x", "*.example.com", "localhost", "a.example.com:8443"]) {
      assert.throws(
        () => renderConfig(base(), { TALORYS_WORKER_NAME: "talorys", TALORYS_CUSTOM_DOMAIN: domain }),
        ConfigError,
        domain,
      );
    }
  });

  it("keeps the Durable Object binding and migrations untouched", () => {
    const before = base();
    const config = renderConfig(before, { TALORYS_WORKER_NAME: "talorys" });
    assert.deepEqual(config.durable_objects, before.durable_objects);
    assert.deepEqual(config.migrations, before.migrations);
    assert.deepEqual(config.assets, before.assets);
    assert.equal(config.$schema, undefined);
  });

  it("writes the installer defaults and the deployed version as plain vars", () => {
    const config = renderConfig(base(), {
      TALORYS_WORKER_NAME: "talorys",
      TALORYS_DEFAULT_TIMEZONE: "America/Sao_Paulo",
      TALORYS_AGENT_NAME: "Iris",
      TALORYS_DEPLOYED_VERSION: "0.1.7+a74c55f",
    });
    assert.deepEqual(config.vars, {
      TALORYS_DEFAULT_TIMEZONE: "America/Sao_Paulo",
      TALORYS_AGENT_NAME: "Iris",
      TALORYS_DEPLOYED_VERSION: "0.1.7+a74c55f",
    });
  });

  it("rejects malformed vars", () => {
    const ok = { TALORYS_WORKER_NAME: "talorys" };
    assert.throws(() => renderConfig(base(), { ...ok, TALORYS_DEFAULT_TIMEZONE: "$(id)" }), ConfigError);
    assert.throws(() => renderConfig(base(), { ...ok, TALORYS_DEPLOYED_VERSION: "1.0 rc" }), ConfigError);
    assert.throws(() => renderConfig(base(), { ...ok, TALORYS_AGENT_NAME: "a\nb" }), ConfigError);
  });
});

describe("main", () => {
  it("writes the rendered config to the output path", () => {
    const out = join(mkdtempSync(join(tmpdir(), "talorys-deploy-")), "wrangler.deploy.json");
    main([STANDALONE, out], { TALORYS_WORKER_NAME: "talorys" });
    assert.equal(JSON.parse(readFileSync(out, "utf8")).name, "talorys");
  });
});
