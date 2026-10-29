# Security

Talorys is single-user. The threat model assumes the internet can reach your
`pages.dev` URL; only the owner should be able to read or change data.

## Authentication

- The owner password is hashed **on the installer's machine** with
  PBKDF2-HMAC-SHA256 (100,000 iterations — the Workers maximum — 16-byte random
  salt) and stored as the `OWNER_PASSWORD_HASH` Worker secret. The plaintext
  never leaves the machine, is never written to disk and is never logged.
  The exception is a [one-Worker deploy](deployment.md#one-worker-without-pages)
  using `OWNER_PASSWORD`: the plaintext is then stored as an (encrypted) Worker
  secret. It must pass the installer's strength check, or the Worker treats
  the password as not configured and refuses every login.
- A 256-bit `SESSION_SECRET` is generated locally and stored as a Worker secret.
- Sessions are random 256-bit tokens in an `HttpOnly; Secure; SameSite=Strict;
  Path=/` cookie named `__Host-talorys_session`. Outside development the
  Worker refuses plain HTTP and always issues this cookie, never the
  unprefixed one used by local development. The database stores only
  `HMAC(SESSION_SECRET, token)`; a storage leak cannot be replayed.
- A session ends on the server, whichever comes first, after:
  - **30 minutes without use** (a click, a key, the mouse wheel: only requests the
    owner started count, marked with the `x-talorys-activity` header, never
    background polling);
  - **5 minutes with no open tab** (one tab per browser sends a presence
    signal to `POST /api/auth/heartbeat` once a minute);
  - **6 hours** in total, used or not.
  While the owner keeps using an open tab, only the maximum ends a session.
  The owner can change these in Settings → Security (5–60 minutes, 3–15
  minutes, 1–24 hours); making any of them longer asks for the password
  again. The browser warns 2 minutes before the end, signs every tab out at
  once, and the session cookie has no expiry date, so it goes when the
  browser closes. Logout and "sign out other sessions" revoke server-side,
  logout also sends `Clear-Site-Data: "cache"` (not `"cookies"`, which would
  also clear the cookies of every other site on your domain, Cloudflare
  Access's included), and each end is
  recorded in the activity log. At most 20 sessions are kept.
- Signing in ends the session the browser already had, so a cookie planted
  before sign-in cannot ride along.
- Changing the password in the UI ends every session and access token,
  the current one too, and signs this browser back in on a new session.
- `reset-password` (CLI) replaces the secret; the Durable Object detects the
  changed fingerprint, discards any UI-set password, turns two-step sign-in
  off (so a lost phone never locks the owner out for good) and revokes every
  session.
- Sensitive actions need the password typed within the last 15 minutes in
  this session: exporting or importing a backup, turning remote access on, and
  creating an access token. Signing in counts; after that the app asks for the
  password again (`POST /api/auth/confirm`, under the same rate limit as
  sign-in). With two-step sign-in on, a current authenticator code works
  instead of the password (recovery codes don't). A stolen session cookie
  alone can't take the data or open a back door. Turning remote access off and revoking tokens never ask.
- There is no signup, setup or ownership-claim endpoint.

## Two-step sign-in

Optional, and recommended: while it is off, the app shows a reminder on every
screen but Settings (it can be put off for 3 days on a browser, never for good).

- **Authenticator app (TOTP, RFC 6238).** HMAC-SHA1, 6 digits, 30-second
  steps, as every authenticator app expects. A code from the step before or
  after also counts, for a phone clock a little off; a step already used never
  counts again, so a code seen over a shoulder can't be replayed. Turning it on
  shows a QR code (drawn in the browser, never sent anywhere) and the key as
  text, and takes effect only after a first right code.
- **The secret** is stored encrypted with AES-256-GCM under a key derived
  (HKDF) from `SESSION_SECRET`, so a copy of the Durable Object's storage alone
  can't make codes. It is never shown again after setup and never goes into a
  backup. If `SESSION_SECRET` changes, the app's codes stop working; recovery
  codes still do, and `reset-password` turns the second step off.
- **Recovery codes.** 10 single-use codes of 80 random bits, shown once (copy
  or download) and stored only as SHA-256 hashes. Each one signs in once in
  place of the app code; using one notifies the owner. Settings shows how many
  are left and asks for new ones at 2 or fewer.
- **Sign-in.** A right password with the second step on opens no session: it
  sets `__Host-talorys_mfa` (random, 5 minutes, `HttpOnly; Secure;
  SameSite=Strict`), whose HMAC names a challenge row in the database. The
  challenge allows 5 wrong codes, then the password is asked again; at most 5
  challenges are kept. The password attempt keeps counting as a failure in the
  [brute-force limit](#brute-force) until the code is right too, so knowing the
  password doesn't buy extra guesses. Each try is taken from the challenge
  before the code is checked, so parallel requests can't share one count.
  Past 10 wrong codes in 15 minutes across every network, only networks the
  owner signed in from in the last 30 days may try codes until the window
  clears, so opening challenges from many addresses buys no extra guesses
  either. Three wrong codes in a row notify the owner, since they mean the
  password is known. Changing the password ends every sign-in waiting for its
  code.
- **Changing it.** Turning it on or off and making new recovery codes need the
  password typed within the last 15 minutes and a current code (turning off
  also takes a recovery code). Turning it on or off ends every other session
  and notifies the owner. Wrong codes when turning it off or making new codes
  count in the sign-in rate limit.
- **Activity.** Each step is in the [sign-in activity](#sign-in-activity):
  code asked, wrong code (and why), which factor signed in, turned on or off,
  new codes. Codes themselves are never logged.
- Passkeys come later, once the deployment has its own domain.

## Brute force

3 failed logins per client within 15 minutes lock that client. A client is the
IP address from `CF-Connecting-IP` (outside development a request without it
is refused, so it can't land in a shared bucket), or its whole /64 for IPv6, since one
subscriber usually holds a /64 and could otherwise rotate addresses. When 25
failures pile up across all clients in the window (a distributed attack), login is
never locked for everyone: networks that signed in successfully within the last
30 days keep their normal allowance, and any other network gets a single attempt
per window. Guessing from many addresses is slowed to one guess per address, and
the owner on a new network can still sign in once. The owner gets a notification
when this starts (at most every 6 hours). Responses include `Retry-After`.
Password changes and password confirmation use the same limiter.

## Sign-in activity

Settings → Security → Sign-in activity lists every sign-in, failed attempt,
blocked attempt, sign-out (by hand, automatic or from another session),
password change and confirmation, and every refused access token. Each record
holds the time, the client IP and its rate-limit network, the edge's country,
region, city, ASN and data center, the host, the user agent (300 characters at
most), whether the browser carried a known device cookie, and the first 16
characters of the session's public id.

- **Never stored:** passwords, codes, tokens, or the e-mail address typed in a
  failed attempt.
- **Location comes only from Cloudflare's edge.** The Worker entry point
  removes any `x-talorys-client-geo` header the client sends and sets it from
  `request.cf`; the API never trusts a location from the browser.
- **Bounded.** Past 20 failures from one network in 15 minutes, further
  failures fold into one row with a counter. A blocked network gets one row
  per window, and its counter reaches storage at most once a minute, so
  hammering a blocked login costs no extra writes. At most 50,000 detailed
  rows are kept, 5,000 of them reserved for the owner's own events (sign-ins,
  sign-outs, password changes): a flood of refusals pushes out older
  refusals, never the record of who signed in. Text is stripped of control characters, and the CSV export escapes
  cells a spreadsheet would run as a formula.
- **Retention (LGPD).** Details with IP and user agent are kept 90 days by
  default (30–180, in Settings), then reduced to daily counts per country and
  kind, without IP or user agent, kept one year. The legal basis is the
  controller's legitimate interest in the security of the account (LGPD
  art. 7, IX, and art. 46). Expired rows are reduced at most an hour after
  they expire, whenever the activity is written or read. The owner can export
  the detailed records as CSV or delete everything. The 24-hour summary is
  shown with the session; the detailed list, the export, deleting and any
  change of retention ask for the password typed within the last 15 minutes,
  so a stolen session cookie alone can't read the IPs or erase the record.
- **Device cookie.** A sign-in sets `__Host-talorys_device` (random, 180
  days, `HttpOnly; Secure; SameSite=Strict`). The server stores only its HMAC,
  for at most 50 devices. It only tells a known browser from a new one: it
  never authenticates, never skips a password or a second factor, and never
  relaxes the rate limit.
- **Alerts.** A sign-in from a new device or a new country, after the first
  one, creates a notification (and a push). Its text is generic, so a locked
  phone screen shows nothing about where or how.
- **Not recorded:** requests refused at the Worker entry before the agent
  (a host outside `TALORYS_ALLOWED_HOSTS`, a missing Cloudflare Access token).
  Recording them would cost one Durable Object request each, so a flood of
  junk traffic would spend the free tier; Cloudflare's own analytics and
  Access logs cover those.

## CSRF

Every non-GET request must carry `x-talorys-request: 1` (cross-site forms cannot
set custom headers, and no CORS is ever granted), an `Origin` equal to the
request origin (or a same-origin `Sec-Fetch-Site`), and the cookie is
`SameSite=Strict`.

## Backend exposure

The Worker is deployed with `workers_dev: false` and `preview_urls: false`. It is
reachable only through the Pages service binding. A one-Worker deploy is public
on `workers.dev` instead, behind the same checks. Authorization is enforced in
the Worker for every route except `GET /api/health`, `POST /api/auth/login` and
`GET /api/auth/session`. Without a session or token, `GET /api/health` answers
only `{ "ok": true|false }`; the version, schema and configuration details are
for the owner. The agent instance name is fixed server-side.

Two optional gates run in the Worker's entry point, before the Durable Object:

- **Allowed hosts.** With `TALORYS_ALLOWED_HOSTS` (comma-separated), any other
  host gets 404. The GitHub deploy sets it to the custom domain (or the
  `workers.dev` host of `TALORYS_PUBLIC_URL`).
- **Cloudflare Access.** With `TALORYS_ACCESS_TEAM_DOMAIN` and
  `TALORYS_ACCESS_AUD`, every request needs a `Cf-Access-Jwt-Assertion` token
  signed by that team for that application (RS256, audience, issuer, expiry and
  signature checked against the team's published keys). A host Access does not
  cover therefore cannot skip it. Only the anonymous `GET /api/health`, without
  a cookie or token, is exempt, so a deploy can check itself through an Access
  bypass rule. Half a configuration answers 503 instead of turning the check off.
  The Telegram webhook (`POST /api/telegram/webhook`) is exempt too, but only
  without a cookie or token and with Telegram's secret header, an HMAC of
  `SESSION_SECRET` compared in constant time (see [alerts.md](alerts.md#segurança-do-telegram)).

## XSS and browser hardening

- React escapes output; Markdown is rendered without raw HTML; remote images in
  model output are not loaded; links open with `noopener noreferrer`.
- `_headers` sets a strict CSP (`script-src 'self'`, `connect-src 'self'`,
  `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, HSTS
  (`max-age=63072000; includeSubDomains`; serve Talorys on a subdomain, not the
  bare domain) and a restrictive `Permissions-Policy` (camera, geolocation and
  payment off; the microphone only for the app's own origin, for chat voice
  input).
- Voice input sends one recorded clip (at most 60 s and 2 MB) to `POST
  /api/transcribe`, which needs the owner session and is not open to remote
  access tokens. The audio goes only to Workers AI and is never stored;
  transcription has its own daily cap of audio minutes.
- Telegram voice messages from the owner's linked private chat (at most 5 minutes
  and 5 MB) are downloaded only from `api.telegram.org`, never following
  redirects, with the file path checked and the read cut off past 5 MB. They
  share the same transcription lock and daily cap, and the audio is never
  stored.
- Security alerts (new sign-in, two-step changes, many failed sign-ins, a
  recovery code used) are critical, go to every channel and insist (again after
  15 minutes and 1 hour). Nothing done inside the app stops that: reading,
  lowering, muting or deleting them does not, so someone in the owner's session
  can't silence the warning about what they just did. Only an answer from the
  owner's Telegram (a button, or a message in the bot's private chat) confirms
  them. Push notifications of these alerts carry no buttons. See
  [alerts.md](alerts.md#insistência).
- Changes that open a door to the owner's data raise a security alert too: a
  password change, remote access turned on, an access token created, a Telegram
  chat or group linked or unlinked, the Telegram conversation turned on, a push
  device added (which also needs the password typed recently) or removed, an
  MCP server added, the sign-in activity deleted, and a backup exported or
  imported (raised as soon as the import commits). They go to every channel, e-mail included, even when the
  person who made the change is signed in, and say only what happened (never
  the token name, the IP or the data). Deleting a security alert needs the
  password typed recently, and the newest 200 are kept apart from other alerts,
  so a flood of routine alerts can't push them out of the record.
- E-mail alerts use Cloudflare Email Routing's `send_email` binding, restricted
  to one sender (`allowed_sender_addresses`) and able to deliver only to
  addresses verified in the account. Talorys sends to one address (the
  `ALERT_EMAIL_TO` or `OWNER_EMAIL` secret, never in the repository), accepts
  only plain addresses, strips line breaks from the subject, sends plain text
  only, and caps e-mail at 10 messages in 24 hours (counted before each send,
  failed ones included), whatever the priority. The last 4 are reserved for
  security and critical alerts, and the test e-mail needs the password typed
  recently and goes out at most twice a day, so a stolen session can't use up
  the limit before acting. Only an alert's first try is
  e-mailed. Logs carry the error code, never the addresses. Each security e-mail
  says Talorys never asks for the password or codes by e-mail.
- The learned priority never touches security alerts: they have no profile, are
  always critical, can't be pinned, and lowering one (app, API or Telegram) is
  refused. Learning can't make any alert critical, and events from outside
  Talorys stay at most high. The owner's corrections reach the model only as a
  data block (tags defused), never as instructions.
- The watchers (every 15 minutes) are deterministic SQL checks with no AI and
  no outbound calls, except the npm update check once a day when the owner
  turned it on. Task titles, routine and MCP server names go into alert text
  with links defanged; each round raises at most 5 task alerts, and dedupe keys
  keep a finding from repeating. Insistent overdue-task alerts count toward the
  cap of 20 alerts insisting at once.
- Push notification buttons (Done, Snooze, Mute) call
  `POST /api/notifications/:id/action` from the service worker with the session
  cookie and the CSRF header, like the app; remote access tokens can't reach it.
- API responses carry their own `Content-Security-Policy: default-src 'none';
  frame-ancestors 'none'`, `X-Frame-Options: DENY` and HSTS, so a JSON answer
  opened directly can't load anything or be framed.
- Push subscriptions must carry exactly a 65-byte P-256 key and a 16-byte
  secret, as RFC 8291 requires.
- The service worker (`/sw.js`) only shows push notifications and caches
  nothing; a notification click can only open a path on the app's own origin.
- Notification bodies render every link, in any Markdown form, as plain code
  next to its label: a reminder, digest or routine can't plant a clickable link
  the owner might trust as Talorys' own.
- No secrets or bindings exist in browser code (the build checks for this).

## Prompt injection and tool safety

- The system prompt marks notes, memories, tool results and history as data.
- Destructive tools (`delete_task`, `delete_note`, `forget_memory`,
  `cancel_automation`, `replace_note_content`) never run during the agent's turn.
  They only create a proposal; the owner approves or declines it with a button
  (an authenticated, CSRF-protected request), and each proposal runs at most once.
  A proposed note rewrite shows the new text in full on its card.
- A proposal is bound to the item as it was shown: if the item changes before the
  owner approves (an edit, another tab, a backup import), approval fails and
  nothing is done.
- Task plans (`propose_task_plan`) only store a draft. Tasks are created by the
  owner's authenticated confirm request, which is bound to the draft's
  conversation and revision, re-validates the final plan on the server, and
  runs in one transaction at most once. Expired, cancelled and outdated drafts
  are refused. Plan routes are not reachable with remote access tokens.
- The agent cannot erase text on its own: `update_note` only renames a note or
  appends to it (up to 50,000 characters), `update_task` only adds a
  description to a task that has none (`replace_task_description` is a
  proposal; titles can still change without approval), and `update_memory`
  saves the new wording as a new memory while the old one is kept as a past
  fact. `complete_task` runs at most 3 times a turn.
- AI routines (`agent_prompt` automations) run unattended, so the agent can only
  propose one (`propose_ai_routine`): the card shows the full prompt and
  schedule, and nothing is scheduled until the owner approves. A note, memory or
  tool result that tells the model to set one up can't schedule it on its own.
  The agent can't repeat any schedule more often than hourly, and at most 50
  automations can be active at once.
- Memories, the conversation summary and recalled tasks, notes and reminders
  enter the system prompt inside `<data>` blocks, one item per line, with
  anything shaped like the block's own tags defused, so stored text can't close
  the block and pose as rules. The result of an approved MCP call is added the
  same way, so a server's reply can't pose as another approval outcome.
- A conversation restored from a backup is shown to the model as past
  conversation, not as the owner's instructions, and keeps that label when it
  is summarized.
- Reminders and automations the agent creates store links as visible,
  unclickable text, and the task digest shows task titles the same way, so
  injected text can't plant a clickable link in a notification. `update_task`
  can't mark a task done; that goes through `complete_task` and its cap.
- Scheduled AI runs get read-only tools plus `notify_owner`, which exists only
  there. Its title always starts with the routine's name, and links in it, and
  in the run's reply, are shown as plain text that can't be clicked.
- Per-request limits: tool calls, per-tool caps, duplicate-call detection,
  reasoning steps, output and context tokens; daily caps on AI requests and
  scheduled AI runs. Every model call (each tool-loop step and each history
  summary) is counted against the daily cap before it is made, and the SDK's
  automatic retries are off so no call goes uncounted. A scheduled AI run and an
  embedding request are also counted before the call, so concurrent requests
  cannot overrun their caps.
- No shell, code execution, credentials or deployment tools exist, and no
  built-in tool makes outbound HTTP requests. Web Push sends are made by the
  notification service, never by a tool. The only tools that reach the network
  are remote MCP tools the owner connected and turned on (below).

## Events from automations

- `POST /api/remote/events` only accepts a remote token of scope `events`, and
  that scope reaches nothing else (`apps/agent/src/remote/middleware.ts`): a
  leaked n8n token can raise alerts but cannot read or change data.
- At most 60 events an hour and 100 in 24 hours across all tokens (counted
  before raising, so repeats count), bodies of at most 2 KB, and never
  `critical`: the alert center caps the Events category at High, so an outside
  system can't make an alert that only Telegram can silence.
- Events can't crowd out the owner's alerts: they get only the first half of
  each channel's hourly and daily limit, at most 3 insist at once
  (`EVENT_ALERTS`), and past 50 source + kind pairs new ones share one learned
  profile, so the owner's learned priorities are never pushed out.
- Titles start with the source and stay on one line; links are defanged
  (`hxxps://` in backticks) so neither the app, Telegram nor a mail client makes
  them clickable: a leaked token can't send a convincing sign-in link.

## Push notifications

- The VAPID private key is a Worker secret, generated locally by the installer
  and sent to Wrangler via stdin. Only the public key reaches the browser.
- Subscription endpoints come from the browser, so they are treated as
  untrusted URLs the Worker will POST to. Only the browser push services are
  accepted (`fcm.googleapis.com`, `updates.push.services.mozilla.com`,
  `*.push.apple.com`, `*.notify.windows.com`; the list is in
  `apps/agent/src/push/endpoint.ts`), over `https` on the default port with no
  credentials in the URL. Redirects are not followed, each send has a 10-second
  timeout, and there are at most 3 devices.
- Payloads are encrypted for each device (RFC 8291, `aes128gcm`). The push
  service (Google, Mozilla, Apple or Microsoft) sees the endpoint, the time and
  the ciphertext size, not the text. The payload is the notification title and
  the first 240 characters of its body, which the device's lock screen may show.
- Subscriptions are device-specific secrets: they are never included in
  backups. Endpoints the push service reports as gone (404/410) are deleted at
  once, and one that fails 10 times in a row is dropped.
- A device that has not opened Talorys signed in for 7 days is removed (checked
  every 15 minutes, even with the watchers off), so a lost or forgotten phone
  stops receiving the owner's alerts on its own. A signed-in browser reports its
  own endpoint to `POST /api/push/seen` at most once an hour; the removal is
  logged in the activity and the owner is told on the remaining channels.
- When the browser rotates a subscription, the service worker sends the new one
  with the old endpoint in `replaces`; the server moves that device without a
  recent password and keeps its last-access time. Endpoints are never returned
  by the API, so only the browser that held one can name it.
- Sending runs in the background and never fails the automation, reminder or
  chat turn that created the notification.
- The routes (`/api/push/*`) need a session and the CSRF checks like every other
  owner route.

## Backups

A backup file is untrusted input; importing one cannot change what Talorys
does on its own:

- New automations arrive paused, and existing ones are never rewritten or
  re-enabled (a backup may only pause them).
- The model, limits, demo mode, auto-memory and memory history settings are
  not imported.
- Conversation summaries are dropped; they feed the system prompt but are
  invisible in the UI. They are regenerated from the visible messages.
- Imported messages are marked as imported. Retry refuses them, and recorded
  approvals are stripped, so they never count as the owner's input.
- Malformed tool activity is dropped instead of breaking the chat view.
- MCP servers arrive turned off, with no credential and no enabled tools; an
  existing server is never changed, and unsafe URLs or ids that aren't UUIDs
  are skipped.
- Messages only join conversations the import creates or that hold only
  imported messages; a backup can't add turns to, or retitle, a chat you had.
- Due dates that aren't full ISO date-times are dropped, and memories are cut
  to 2,000 characters, as the API allows.
- A date that can't be read, or that lies more than 5 minutes in the future,
  is replaced by the import time and never replaces a local record, so a forged
  date can't win "newer copy wins" against your later edits.
- A file is at most 10 MB, with a cap on records of each kind (for example
  50,000 messages and 500 automations); past either, nothing is imported.

## Installer

- Commands are spawned with argument arrays (no shell).
- Secrets go to Wrangler via stdin only.
- `talorys.json` is checked to contain no secret-like values before writing.
- Error output is sanitized of token-like strings.
- The published package ships `npm-shrinkwrap.json`, so `npx create-talorys`
  installs exactly the dependency tree that was tested, with integrity hashes,
  instead of whatever versions are newest that day. After changing the
  installer's `dependencies`, run `npm run shrinkwrap -w create-talorys`;
  the release tests fail while the two disagree.

## Dependencies

- Every `package.json` in the repository pins exact versions (`save-exact=true`
  in `.npmrc`), and CI installs with `npm ci` from the committed lockfile. A
  test fails on any range such as `^1.2.3`.
- Dependabot proposes updates daily, after a cooldown of 3 to 14 days, so a
  compromised release is usually pulled before it reaches a PR. Security
  updates skip the cooldown.
- With npm 11 (bundled with Node.js 26, from `.nvmrc`), no dependency install
  script runs: npm blocks them by default, and the `allowScripts` field in the
  root `package.json` records the ones in the tree as denied (`esbuild`,
  `workerd`, `core-js-pure`). Their binaries come from platform packages in the
  lockfile. The deploy job also installs with
  `--ignore-scripts`. Review any new package that `npm install-scripts ls`
  lists before approving it.
- Development, CI and deploy use the Node.js version in `.nvmrc` (the active
  LTS). The installer accepts the oldest supported LTS in `engines` and is
  tested on it in CI.

## Update check

Off by default. When turned on, once a day, when Settings → About is opened, the Worker fetches
`https://registry.npmjs.org/create-talorys/latest` to see if a newer version
exists. The request carries no user data; npm only sees the Worker's IP. The
browser never contacts npm (`connect-src 'self'` is unchanged). Turn it on or
off under Settings → About → Check for updates.

## Remote access

Optional machine-client access with named personal access tokens (`tal_…`).

- Tokens are stored as **HMAC(SESSION_SECRET, token)** only; plaintext is returned **once** at creation and cannot be recovered from the database.
- Scopes: `read` (GET allowlist) or `write` (owner-level replace + delete on the allowlist). Max **20** tokens.
- Tokens expire **90 days** after creation.
- **Revoke** / **Revoke all** destroy hashes immediately. Turning Remote access **off** suspends tokens (Bearer 401) without deleting them; turning it back on restores them.
- CORS stays closed. Server-side clients only.
- Token rows are excluded from backups; a restore never enables Remote access or resurrects tokens.
- **Auth ordering:** a present `Authorization` header must validate as Bearer. Only a **validated** token skips CSRF/session checks. Invalid Bearer never falls back to a cookie.
- Failed-Bearer throttling is keyed by client IP (`CF-Connecting-IP`; IPv6 by /64) and is separate from browser login lockout. Soft per-token rate limits (in-memory; reset on Durable Object restart) return **429** with `Retry-After`.
- Mutations are attributed in the activity log by token name/id prefix (no bodies or credentials), coalesced to at most one `remote.request` row per token per 15-minute window; write volume is also counted per token per day. Memories created via Bearer use source `remote`.
- Bearer cannot create or change `agent_prompt` automations (403); see [Remote access](remote-access.md).

## Remote MCP servers

Optional. Full details: [Remote MCP servers](mcp.md#security-model).

- Managed only from an owner session (`/api/mcp`, CSRF-protected). Access tokens
  are refused, and no tool can add servers or turn tools on.
- Discovered tools start off. An enabled tool either asks for approval on every
  call (the default, through the same pending-action flow as deletions, bound to
  the exact arguments and the tool's permission state) or, if the owner chooses,
  runs without asking. Server annotations such as `readOnlyHint` are shown but
  never trusted.
- Scheduled runs get an MCP tool only when the owner set it to run without
  asking and also allowed it in scheduled automations (off by default). Tools
  that ask first are never offered there, since nobody is present to approve:
  switching a tool to ask first takes it out of scheduled runs, and the executor
  drops any other external tool outside chat.
- Bearer tokens and OAuth sign-ins (tokens, client registration, PKCE verifier)
  are AES-256-GCM encrypted under `MCP_CREDENTIAL_KEY`, bound to the server id,
  sent only to the configured origin, and never returned, logged, sent to the
  model or exported.
- OAuth uses the authorization code flow with PKCE as a public client. The
  state is random, server-bound, single use and expires in 10 minutes; the
  callback is finished by an app page that posts it with the owner's session
  and CSRF header. Authorization servers must pass the same endpoint checks as
  MCP servers, and the access token is never sent to them.
- Endpoints must be public `https://` hosts. Private, loopback, link-local,
  metadata and reserved addresses are refused, both as literals and as DNS
  answers (checked over DNS-over-HTTPS before each new connection). Redirects
  are refused, and every request must stay on the configured origin.
- Calls share the turn's tool budget, per-tool caps and duplicate detection, and
  are bounded by timeouts, response-size limits and a 35-second limit on how
  long any response may stay open. Results and descriptions are marked as
  untrusted third-party data in the prompt.
- A tool that runs without asking is re-checked at call time: once the owner
  switches it to ask first, or out of scheduled runs, a turn or run already in
  progress can't call it on its own either.
- Regular expressions in a tool's input schema (`pattern`,
  `patternProperties`) are not run inside the agent, so a server can't stall
  the Durable Object with a backtracking pattern; the server validates them.
- A changed tool definition hides the tool until the owner reviews it again.
- Backups carry only server names, URLs and auth types; imported servers arrive
  turned off, without credentials or tools.

## Reporting

Please report vulnerabilities privately via GitHub Security Advisories.
