import type { TalorysAgent } from "./agent/talorys-agent";

export interface Env {
  AI?: Ai;
  /** The built web UI, in the one-Worker deploy only (wrangler.standalone.jsonc). */
  ASSETS?: Fetcher;
  TalorysAgent: DurableObjectNamespace<TalorysAgent>;
  /** Cloudflare Workflows behind the Workflows menu (free plan). Without it the menu shows workflows as unavailable. */
  TALORYS_WORKFLOW?: Workflow;
  /** PBKDF2 hash of the owner password, set by the installer as a Worker secret. */
  OWNER_PASSWORD_HASH?: string;
  /** Plain owner password, for deploys that cannot set the hash (a one-Worker deploy). Ignored when the hash is set; a weak one counts as not configured. */
  OWNER_PASSWORD?: string;
  /** Random 256-bit secret used to key session token hashes. Worker secret. */
  SESSION_SECRET?: string;
  /** Random secret (32+ characters) mixed into password hashes, so a leaked hash can't be guessed offline without it. Worker secret. */
  PASSWORD_PEPPER?: string;
  /** The owner's e-mail address. When set, signing in asks for it too. Worker secret, never in the repository. */
  OWNER_EMAIL?: string;
  /**
   * Cloudflare Turnstile for risky sign-ins: the widget's site key (a plain variable) and its
   * secret key (a Worker secret). Without both, sign-in works as before, with no robot check.
   */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** "off": don't check new passwords against Have I Been Pwned (only 5 characters of a hash are ever sent). Development only. */
  TALORYS_HIBP?: string;
  /**
   * Web Push (VAPID) key pair, base64url: the uncompressed public point and the private scalar.
   * Set by the installer as Worker secrets; without them push is unavailable and nothing else changes.
   */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Contact sent to push services ("mailto:..." or "https://..."). Defaults to the app's own URL. */
  VAPID_SUBJECT?: string;
  /**
   * Random secret that encrypts remote MCP server credentials at rest. Worker secret, set by the
   * installer. Without it, servers that need a bearer token can't be added; nothing else changes.
   */
  MCP_CREDENTIAL_KEY?: string;
  /**
   * Telegram bot token from @BotFather. Worker secret. Without it the Telegram channel is
   * unavailable and nothing else changes. The webhook secret is derived from SESSION_SECRET.
   */
  TELEGRAM_BOT_TOKEN?: string;
  /**
   * E-mail alerts: Cloudflare Email Routing's send_email binding, the sender on a domain with Email
   * Routing (a plain variable) and the owner's address, verified in Email Routing (a Worker secret;
   * OWNER_EMAIL when unset). Without all three the e-mail channel is unavailable and nothing else changes.
   */
  SEND_EMAIL?: SendEmail;
  ALERT_EMAIL_FROM?: string;
  ALERT_EMAIL_TO?: string;
  /**
   * Google Calendar: the OAuth client from Google Cloud (free). The ID can be a plain variable; the
   * secret is a Worker secret. Tokens are sealed with MCP_CREDENTIAL_KEY. Without all three the
   * calendar is unavailable and nothing else changes.
   */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** "off" turns remote MCP servers off for this deployment. */
  TALORYS_MCP?: string;
  /** Comma-separated origins MCP servers may use (https://n8n.example.com, https://*.example.com). Unset: any public host. */
  TALORYS_MCP_ALLOWED_ORIGINS?: string;
  /** Most MCP tools enabled at once (default 20, at most 64). */
  TALORYS_MCP_MAX_TOOLS?: string;
  /** "development" enables local-only conveniences (mock AI, http cookies). Never set in production. */
  TALORYS_ENV?: string;
  /** Development only: use the deterministic mock AI provider. */
  TALORYS_MOCK_AI?: string;
  /** Development only: extra allowed origins (comma separated), e.g. the Vite dev server. */
  TALORYS_DEV_ORIGINS?: string;
  /** Comma-separated hostnames the API answers on; any other host gets 404. Unset: every host. */
  TALORYS_ALLOWED_HOSTS?: string;
  /** Cloudflare Access in front of the app: the team domain (team.cloudflareaccess.com) and the application's AUD tag. Both or neither. */
  TALORYS_ACCESS_TEAM_DOMAIN?: string;
  TALORYS_ACCESS_AUD?: string;
  /** Installer defaults: the owner's timezone and chosen agent name. */
  TALORYS_DEFAULT_TIMEZONE?: string;
  TALORYS_AGENT_NAME?: string;
  /** Language of a new installation ("system", "en", "ko" or "pt-BR"); pt-BR when unset. */
  TALORYS_DEFAULT_LANGUAGE?: string;
  /** Informational, written by the installer. */
  TALORYS_INSTALLATION_ID?: string;
  TALORYS_DEPLOYED_VERSION?: string;
}
