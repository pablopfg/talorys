#!/usr/bin/env node
// Renders the Wrangler config used by the GitHub Actions deploy (.github/workflows/deploy.yml).
//
// It starts from apps/agent/wrangler.standalone.jsonc (one Worker that serves the UI and the
// API) and applies the per-installation values that live in GitHub repository variables:
// the Worker name, the custom domain, and the installer defaults. Nothing secret passes
// through here: the Worker secrets (OWNER_PASSWORD, SESSION_SECRET, ...) are set once with
// `wrangler secret put` and survive every deploy.
//
// Usage: node scripts/deploy/render-wrangler-config.mjs <base.jsonc> <out.json>
// Reads TALORYS_WORKER_NAME (required), TALORYS_CUSTOM_DOMAIN, TALORYS_DEFAULT_TIMEZONE,
// TALORYS_AGENT_NAME and TALORYS_DEPLOYED_VERSION from the environment.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export class ConfigError extends Error {}

// Worker names: lowercase letters, digits and dashes, no leading or trailing dash, at most 63.
const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// A plain hostname with at least two labels; no scheme, port, path or wildcard.
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const TIMEZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const VERSION = /^[A-Za-z0-9._+-]{1,64}$/;

/** Removes // and /* *\/ comments and trailing commas from JSONC, leaving string contents alone. */
export function stripJsonc(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) throw new ConfigError("Unterminated block comment in the base config.");
      i = end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  // Trailing commas: a comma followed only by whitespace before } or ].
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function optional(value, pattern, label) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return undefined;
  if (!pattern.test(trimmed)) throw new ConfigError(`${label} is not valid: "${trimmed}".`);
  return trimmed;
}

/** Returns the deploy config for `base` (the parsed standalone config) and the given variables. */
export function renderConfig(base, env) {
  const name = (env.TALORYS_WORKER_NAME ?? "").trim();
  if (!name) throw new ConfigError("TALORYS_WORKER_NAME is required (GitHub variable on the production environment).");
  if (!WORKER_NAME.test(name)) throw new ConfigError(`TALORYS_WORKER_NAME is not a valid Worker name: "${name}".`);

  const domain = optional(env.TALORYS_CUSTOM_DOMAIN?.toLowerCase(), HOSTNAME, "TALORYS_CUSTOM_DOMAIN");
  const timezone = optional(env.TALORYS_DEFAULT_TIMEZONE, TIMEZONE, "TALORYS_DEFAULT_TIMEZONE");
  const version = optional(env.TALORYS_DEPLOYED_VERSION, VERSION, "TALORYS_DEPLOYED_VERSION");
  const agentName = (env.TALORYS_AGENT_NAME ?? "").trim();
  if (agentName.length > 64 || /\p{Cc}/u.test(agentName)) {
    throw new ConfigError("TALORYS_AGENT_NAME must be at most 64 characters, without control characters.");
  }

  const config = structuredClone(base);
  delete config.$schema;
  config.name = name;
  // Preview URLs would expose every uploaded version on a public *.workers.dev host.
  config.preview_urls = false;
  if (domain) {
    // With a custom domain the only way in is that domain (no *.workers.dev).
    config.routes = [{ pattern: domain, custom_domain: true }];
    config.workers_dev = false;
  } else {
    // No domain yet: the Worker stays on <name>.<subdomain>.workers.dev.
    delete config.routes;
    config.workers_dev = true;
  }

  // A deploy replaces every plain variable with what the config lists, so the installer
  // defaults are written here each time. Secrets are not touched by a deploy.
  const vars = { ...(config.vars ?? {}) };
  if (timezone) vars.TALORYS_DEFAULT_TIMEZONE = timezone;
  if (agentName) vars.TALORYS_AGENT_NAME = agentName;
  if (version) vars.TALORYS_DEPLOYED_VERSION = version;
  if (Object.keys(vars).length > 0) config.vars = vars;

  return config;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const [basePath, outPath] = argv;
  if (!basePath || !outPath) throw new ConfigError("Usage: render-wrangler-config.mjs <base.jsonc> <out.json>");
  const base = JSON.parse(stripJsonc(readFileSync(basePath, "utf8")));
  const config = renderConfig(base, env);
  writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const config = main();
    const where = config.workers_dev ? "workers.dev" : config.routes[0].pattern;
    console.log(`Rendered deploy config for Worker "${config.name}" on ${where}.`);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
