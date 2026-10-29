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
// Reads TALORYS_WORKER_NAME (required), TALORYS_CUSTOM_DOMAIN, TALORYS_PUBLIC_URL,
// TALORYS_ACCESS_TEAM_DOMAIN, TALORYS_ACCESS_AUD, TALORYS_VAPID_SUBJECT, TALORYS_DEFAULT_TIMEZONE, TALORYS_AGENT_NAME,
// TALORYS_ALERT_EMAIL_FROM and TALORYS_DEPLOYED_VERSION from the environment.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export class ConfigError extends Error {}

// Worker names: lowercase letters, digits and dashes, no leading or trailing dash, at most 63.
const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// A plain hostname with at least two labels; no scheme, port, path or wildcard.
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const TIMEZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const VERSION = /^[A-Za-z0-9._+-]{1,64}$/;
// The Zero Trust team domain and the Access application's AUD tag (both public identifiers).
const ACCESS_TEAM = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const ACCESS_AUD = /^[0-9a-f]{64}$/;
// The contact push services may use about this sender (RFC 8292): an e-mail or an https URL.
const VAPID_SUBJECT = /^(?:mailto:[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+|https:\/\/[^\s<>"]+)$/;
// The sender of e-mail alerts: a plain address on a domain with Cloudflare Email Routing.
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/** The host of an https:// URL with nothing else in it, or undefined when unset. */
function publicHost(value) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return undefined;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConfigError(`TALORYS_PUBLIC_URL is not valid: "${trimmed}".`);
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.port || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || !HOSTNAME.test(host)) {
    throw new ConfigError(`TALORYS_PUBLIC_URL must be https://<host> with nothing after it: "${trimmed}".`);
  }
  return host;
}

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
  const publicUrlHost = publicHost(env.TALORYS_PUBLIC_URL);
  const accessTeam = optional(env.TALORYS_ACCESS_TEAM_DOMAIN?.toLowerCase(), ACCESS_TEAM, "TALORYS_ACCESS_TEAM_DOMAIN");
  const vapidSubject = optional(env.TALORYS_VAPID_SUBJECT, VAPID_SUBJECT, "TALORYS_VAPID_SUBJECT");
  const accessAud = optional(env.TALORYS_ACCESS_AUD?.toLowerCase(), ACCESS_AUD, "TALORYS_ACCESS_AUD");
  if (!accessTeam !== !accessAud) {
    throw new ConfigError("Set both TALORYS_ACCESS_TEAM_DOMAIN and TALORYS_ACCESS_AUD to use Cloudflare Access, or neither.");
  }
  const alertEmailFrom = optional(env.TALORYS_ALERT_EMAIL_FROM?.toLowerCase(), EMAIL, "TALORYS_ALERT_EMAIL_FROM");
  const agentName = (env.TALORYS_AGENT_NAME ?? "").trim();
  if (agentName.length > 64 || /\p{Cc}/u.test(agentName)) {
    throw new ConfigError("TALORYS_AGENT_NAME must be at most 64 characters, without control characters.");
  }

  const config = structuredClone(base);
  delete config.$schema;
  config.name = name;
  // Preview URLs would expose every uploaded version on a public *.workers.dev host.
  config.preview_urls = false;
  // The Worker runs before every asset, so the HTTPS redirect, the allowed hosts, Access and
  // the security headers cover the UI as well as the API. A base config can't turn that off.
  if (!config.assets) throw new ConfigError("The base config must serve the web UI (assets).");
  config.assets = { ...config.assets, binding: "ASSETS", run_worker_first: true };
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
  // The API answers 404 on any other host (AUTH-03): the domain, or the workers.dev address
  // given for the health check. With neither, every host is accepted, as before.
  const allowedHost = domain ?? publicUrlHost;
  if (allowedHost) vars.TALORYS_ALLOWED_HOSTS = allowedHost;
  if (vapidSubject) vars.VAPID_SUBJECT = vapidSubject;
  if (accessTeam) {
    vars.TALORYS_ACCESS_TEAM_DOMAIN = accessTeam;
    vars.TALORYS_ACCESS_AUD = accessAud;
  }
  if (alertEmailFrom) {
    // E-mail alerts: the binding may only send from this address, and Email Routing only delivers
    // to verified addresses (the owner's, in the ALERT_EMAIL_TO or OWNER_EMAIL secret).
    vars.ALERT_EMAIL_FROM = alertEmailFrom;
    config.send_email = [{ name: "SEND_EMAIL", allowed_sender_addresses: [alertEmailFrom] }];
  } else {
    delete config.send_email;
  }
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
