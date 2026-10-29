# Google Calendar

Talorys can read your Google calendars and propose events. You connect one
Google account in **Settings → Integrations → Google Calendar**, then choose,
calendar by calendar, what the agent may do:

| Setting | What the agent can do |
| --- | --- |
| **Hidden from the agent** (default) | Nothing. The calendar isn't listed to the agent. |
| **Read only** | List and search its events, in chat and in scheduled automations. |
| **Read and propose changes** | Also propose creating, moving, renaming and deleting events. Each change waits on an approval card in chat. |

This is optional and free. With nothing configured, Talorys makes no requests
to Google.

## What it can and can't do

- **One account.** Calendars shared with that account are listed too, with the
  access Google gives the account. **Read and propose changes** is offered only
  where Google lets the account edit (owner or writer). A calendar shared as
  free/busy only can't be opened.
- **Changes always ask first.** Creating, changing and deleting events are
  approval actions, offered only in chat. Scheduled automations can read, never
  change.
- **Guests are never e-mailed.** Every change is sent with `sendUpdates=none`,
  and the agent can't add guests.
- **A change made meanwhile in Google wins.** An approved move or delete is sent
  with the event's version (`If-Match`). If someone edited the event after the
  proposal, Google refuses it and nothing is done.
- **Limits:** one request reads at most 62 days and 50 events.

### Recommended: a work calendar as read only

To let Talorys see a work calendar (a clinic's, for example) without any chance
of changing it, share that calendar in Google Calendar with your own account as
**See all event details**, then set it to **Read only** in Talorys. Google
itself then refuses any change, whatever happens in Talorys.

## Daily routines with the calendar

Talorys also reads the open calendars for itself, without the AI:

- **Daily summary.** The summary (Settings → Alerts) lists today's events on
  every open calendar, in time order.
- **Notice before the first event.** Under a calendar in **Settings →
  Integrations**, choose **Notice N min before the first event** and write what
  to remember ("turn on the air conditioning"). On days with a timed event it
  goes out once, that many minutes before the first one. If the first event
  moves, the notice follows it; all-day events are ignored.
- **Routines only on days with events.** An automation can **Run only on days
  with events** on one open calendar. On a day without events there, the run is
  skipped (shown in its history). If Google can't be reached, it runs anyway.
  If that calendar is hidden later, runs are skipped and you get one alert.

In **Automations → New → AI routine**, three ready-made routines use this:

| Template | When | What |
| --- | --- | --- |
| **Morning briefing** | Every day, 07:00 | Today's events, tasks due or overdue, reminders, what to prepare. |
| **Closing the day** | Monday to Friday, 19:00 | What happened, what is still open, what to leave ready for tomorrow. |
| **Saturday closing** | Saturday, 13:00 | The same, but only on Saturdays with events on the calendar you choose (a work calendar, for example). |

Everything stays editable. Fixed bills are plain monthly reminders: create one
7 days and another 3 days before the due date.

## Setting it up

You need a free OAuth client in Google Cloud. The step-by-step guide, in
Portuguese, is in [instalacao-cloudflare.md](instalacao-cloudflare.md#25-google-agenda).
In short:

1. In the Google Cloud console, create a project and enable the **Google
   Calendar API**.
2. Configure the OAuth consent screen (Google Auth Platform), user type
   **External** (or **Internal** on Google Workspace), and add these scopes:
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
3. Publish the app (**In production**). While it is in **Testing**, Google
   expires its sign-ins after 7 days and you would have to connect again every
   week. As only you use it, Google's verification isn't needed: on the consent
   page choose **Advanced → Go to (app name)**.
4. Create an **OAuth client ID** of type **Web application** with this
   authorized redirect URI (your Talorys address):
   `https://talorys.exemplo.com.br/settings/google-calendar`
5. Add the client ID and secret as Worker secrets `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`. `MCP_CREDENTIAL_KEY` must also be set: it seals
   Google's tokens.
6. In Talorys, open **Settings → Integrations → Google Calendar → Connect
   Google**, allow both permissions, and choose a setting for each calendar.

## Privacy

- Talorys asks Google only for the list of calendars and their events. It can't
  see Gmail, Drive, contacts or anything else in the account.
- Events are read when the agent needs them and are not stored in Talorys. What
  the agent reads becomes part of that conversation, like any tool result.
- Event titles, places and descriptions are written by whoever created the
  event, possibly a stranger who sent an invite. They are handed to the model as
  untrusted data, inside a data block, with control characters removed, and the
  model is told never to follow instructions in them.
- The activity log records connecting, disconnecting, setting changes and each
  approved change, never event contents.

## Security model

- **Owner only.** Connecting, opening calendars and disconnecting are done in
  the app with an owner session. Access tokens (remote access, n8n) can't manage
  the connection, and no tool lets the agent connect an account or open a
  calendar to itself.
- **Recent password.** Connecting an account and opening a calendar to the
  agent need the password typed in the last minutes. Hiding a calendar never
  does.
- **OAuth with PKCE and a single-use state.** The state is stored hashed, the
  PKCE verifier sealed, and both expire in 10 minutes. The callback page
  forwards Google's answer with the owner's session; a state can't be reused.
  If Google grants fewer permissions than asked, nothing is saved and, unless
  an account is already connected (revoking would end its grant too), the
  access is given back at once.
- **Sealed tokens.** The refresh and access tokens are encrypted with
  AES-256-GCM using `MCP_CREDENTIAL_KEY` and are never in backups, exports or
  API responses. After restoring a backup, connect again.
- **Narrow network use.** Requests go only to Google's fixed OAuth and Calendar
  addresses, never follow redirects, time out after 10 seconds and read at most
  1 MB.
- **Alert.** Connecting an account raises a security alert, so a connection you
  didn't make doesn't go unnoticed.
- **Disconnecting** deletes the tokens and calendar settings and revokes the
  access at Google.

If you suspect misuse, disconnect in Talorys and also remove Talorys at
<https://myaccount.google.com/connections>, then change your Talorys password.

## Troubleshooting

| Message | What to do |
| --- | --- |
| Google Calendar isn't set up | Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `MCP_CREDENTIAL_KEY` to the Worker. |
| `redirect_uri_mismatch` on Google's page | The authorized redirect URI must be exactly your Talorys address followed by `/settings/google-calendar`. |
| Allow both permissions | On Google's page, tick both boxes, then connect again. |
| Google access was revoked or expired | Connect again. If it happens every week, the app is still in **Testing**: publish it. |
| A calendar is missing | Press **Update list** after sharing or creating it in Google. |
