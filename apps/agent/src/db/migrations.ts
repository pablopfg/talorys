import type { Database } from "./database";

/**
 * Versioned, append-only schema migrations for Talorys data.
 *
 * Rules:
 *  - Never edit or reorder an existing migration; add a new one.
 *  - Migrations must be non-destructive (no DROP of owner data).
 *  - All tables are prefixed `tal_` so they never collide with the
 *    Agents SDK's internal `cf_agents_*` tables.
 */
export interface Migration {
  version: number;
  name: string;
  statements: string[];
  /** Conditional data migration, in the same transaction as the schema version. */
  after?: (db: Database) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS tal_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tal_conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT,
        summary_upto TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tal_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES tal_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        tools TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'complete',
        error TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS tal_messages_conv ON tal_messages(conversation_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS tal_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tal_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tal_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        due_at TEXT,
        project_id TEXT REFERENCES tal_projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS tal_tasks_status_due ON tal_tasks(status, due_at)`,
      `CREATE TABLE IF NOT EXISTS tal_notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        project_id TEXT REFERENCES tal_projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tal_automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        schedule TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'scheduled',
        schedule_id TEXT,
        next_run TEXT,
        last_run TEXT,
        last_result TEXT,
        last_error TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tal_automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        automation_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS tal_runs_started ON tal_automation_runs(started_at)`,
      `CREATE TABLE IF NOT EXISTS tal_notifications (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        automation_id TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tal_activity (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tal_sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        user_agent TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE IF NOT EXISTS tal_login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client TEXT NOT NULL,
        success INTEGER NOT NULL,
        at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS tal_login_attempts_at ON tal_login_attempts(at)`,
      `CREATE TABLE IF NOT EXISTS tal_usage_daily (
        day TEXT PRIMARY KEY,
        ai_requests INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        scheduled_ai_runs INTEGER NOT NULL DEFAULT 0,
        ai_errors INTEGER NOT NULL DEFAULT 0
      )`,
      // Full-text indexes (external content, kept in sync by triggers).
      `CREATE VIRTUAL TABLE IF NOT EXISTS tal_memories_fts USING fts5(content, content='tal_memories', content_rowid='rowid')`,
      `CREATE TRIGGER IF NOT EXISTS tal_memories_ai AFTER INSERT ON tal_memories BEGIN
        INSERT INTO tal_memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END`,
      `CREATE TRIGGER IF NOT EXISTS tal_memories_ad AFTER DELETE ON tal_memories BEGIN
        INSERT INTO tal_memories_fts(tal_memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END`,
      `CREATE TRIGGER IF NOT EXISTS tal_memories_au AFTER UPDATE ON tal_memories BEGIN
        INSERT INTO tal_memories_fts(tal_memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO tal_memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS tal_notes_fts USING fts5(title, content, content='tal_notes', content_rowid='rowid')`,
      `CREATE TRIGGER IF NOT EXISTS tal_notes_ai AFTER INSERT ON tal_notes BEGIN
        INSERT INTO tal_notes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END`,
      `CREATE TRIGGER IF NOT EXISTS tal_notes_ad AFTER DELETE ON tal_notes BEGIN
        INSERT INTO tal_notes_fts(tal_notes_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
      END`,
      `CREATE TRIGGER IF NOT EXISTS tal_notes_au AFTER UPDATE ON tal_notes BEGIN
        INSERT INTO tal_notes_fts(tal_notes_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
        INSERT INTO tal_notes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END`,
    ],
  },
  {
    version: 2,
    name: "pending destructive actions",
    statements: [
      `CREATE TABLE IF NOT EXISTS tal_pending_actions (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES tal_conversations(id) ON DELETE CASCADE,
        tool TEXT NOT NULL,
        target_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','cancelled','failed')),
        error TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT
      )`,
    ],
  },
  {
    version: 3,
    name: "message provenance",
    statements: [`ALTER TABLE tal_messages ADD COLUMN source TEXT NOT NULL DEFAULT 'chat'`],
  },
  {
    version: 4,
    name: "memory history",
    statements: [
      // Lifecycle columns. Existing memories stay current ("active") with no relationships.
      `ALTER TABLE tal_memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
      `ALTER TABLE tal_memories ADD COLUMN superseded_by TEXT`,
      `ALTER TABLE tal_memories ADD COLUMN valid_from TEXT`,
      `ALTER TABLE tal_memories ADD COLUMN valid_until TEXT`,
      `CREATE INDEX IF NOT EXISTS tal_memories_status ON tal_memories(status, updated_at)`,
      `CREATE INDEX IF NOT EXISTS tal_memories_superseded_by ON tal_memories(superseded_by)`,
      `CREATE TABLE IF NOT EXISTS tal_memory_reviews (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        other_id TEXT NOT NULL,
        relationship TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS tal_memory_reviews_memory ON tal_memory_reviews(memory_id)`,
      `CREATE INDEX IF NOT EXISTS tal_memory_reviews_other ON tal_memory_reviews(other_id)`,
    ],
  },
  {
    version: 5,
    name: "approval target versions",
    statements: [
      `ALTER TABLE tal_pending_actions ADD COLUMN target_version TEXT`,
      `ALTER TABLE tal_pending_actions ADD COLUMN payload TEXT`,
      `ALTER TABLE tal_pending_actions ADD COLUMN preview TEXT`,
    ],
  },
  {
    version: 6,
    name: "web push subscriptions",
    statements: [
      // Device-specific secrets: never exported in backups.
      `CREATE TABLE IF NOT EXISTS tal_push_subscriptions (
        id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        origin TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_success_at TEXT,
        failures INTEGER NOT NULL DEFAULT 0
      )`,
    ],
  },
  {
    version: 7,
    name: "token provenance and model consumption",
    statements: [
      `CREATE TABLE tal_model_usage_daily (
        day TEXT NOT NULL,
        model TEXT NOT NULL,
        billable INTEGER NOT NULL,
        input_tokens_reported INTEGER NOT NULL DEFAULT 0,
        output_tokens_reported INTEGER NOT NULL DEFAULT 0,
        input_tokens_estimated INTEGER NOT NULL DEFAULT 0,
        output_tokens_estimated INTEGER NOT NULL DEFAULT 0,
        embedding_requests INTEGER NOT NULL DEFAULT 0,
        neurons_estimate REAL NOT NULL DEFAULT 0,
        cost_usd_estimate REAL NOT NULL DEFAULT 0,
        priced_calls INTEGER NOT NULL DEFAULT 0,
        unpriced_calls INTEGER NOT NULL DEFAULT 0,
        mock_calls INTEGER NOT NULL DEFAULT 0,
        -- Written only below: pre-provenance embedding estimates. Never priced.
        input_tokens_legacy INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, model, billable)
      )`,
    ],
    after: (db) => {
      // Semantic tables are lazy. Old embedding estimates join legacy chat tokens: unknown model
      // and provenance, so neither current "est." tokens nor unpriced calls.
      if (db.one(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tal_semantic_usage'`)) {
        db.run(
          `INSERT INTO tal_model_usage_daily (day, model, billable, input_tokens_legacy, embedding_requests)
           SELECT day, '(legacy embeddings)', 1, embedded_tokens_estimate, embedding_requests
           FROM tal_semantic_usage`,
        );
      }
      // Existing tal_usage_daily token columns stay untouched: provenance/model are unknown.
    },
  },
  {
    version: 8,
    name: "remote access tokens",
    statements: [
      // Credentials: only HMAC(SESSION_SECRET, token) is stored, and backups never export them.
      `CREATE TABLE tal_remote_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        hint TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('read','write')),
        created_at TEXT NOT NULL,
        last_used_at TEXT
      )`,
      `CREATE TABLE tal_remote_auth_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client TEXT NOT NULL,
        at INTEGER NOT NULL
      )`,
      `CREATE INDEX tal_remote_auth_failures_at ON tal_remote_auth_failures(at)`,
    ],
  },
  {
    version: 9,
    name: "daily remote auth failure counter",
    statements: [
      // One row per day, so a flood of rejected tokens never grows the activity log.
      `CREATE TABLE tal_remote_auth_failure_days (
        day TEXT PRIMARY KEY,
        failures INTEGER NOT NULL DEFAULT 0
      )`,
    ],
  },
  {
    version: 10,
    name: "daily remote write counter",
    statements: [
      // Per-token per day, so a busy write token never grows the activity log unbounded.
      `CREATE TABLE tal_remote_write_days (
        day TEXT NOT NULL,
        token_id TEXT NOT NULL,
        writes INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, token_id)
      )`,
    ],
  },
  {
    version: 11,
    name: "task plan drafts",
    statements: [
      // Plans the agent proposed in chat. Tasks are created only when the owner confirms one.
      // Drafts are conversation-bound and never exported in backups, like pending actions.
      `CREATE TABLE tal_task_plan_drafts (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES tal_conversations(id) ON DELETE CASCADE,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
        revision INTEGER NOT NULL DEFAULT 1,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        confirmed_at TEXT
      )`,
      `CREATE INDEX tal_task_plan_drafts_created ON tal_task_plan_drafts(created_at)`,
    ],
  },
  {
    version: 12,
    name: "remote mcp servers",
    statements: [
      // Remote MCP servers the owner connected. `credential` is AES-GCM ciphertext (src/mcp/credentials.ts),
      // never plaintext: a bearer token, or the OAuth record (tokens, client, PKCE verifier, pending state).
      // `slug` names the server's tools and never changes after creation.
      `CREATE TABLE tal_mcp_servers (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none','bearer','oauth')),
        credential TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','auth_required','disconnected','error')),
        last_error TEXT,
        -- A pending OAuth sign-in the owner opens from Settings (not secret: the callback also needs the owner's session).
        authorize_url TEXT,
        authorize_expires TEXT,
        discovered_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      // The last discovered catalog. A tool reaches the model only while enabled and while its
      // definition still matches the one the owner reviewed (`reviewed_hash`).
      `CREATE TABLE tal_mcp_tools (
        server_id TEXT NOT NULL REFERENCES tal_mcp_servers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        exposed_name TEXT NOT NULL UNIQUE,
        title TEXT,
        description TEXT NOT NULL DEFAULT '',
        input_schema TEXT NOT NULL,
        annotations TEXT,
        schema_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','removed','invalid')),
        invalid_reason TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        policy TEXT NOT NULL DEFAULT 'approve' CHECK (policy IN ('approve','auto')),
        reviewed_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (server_id, name)
      )`,
      // What an approved external call returned, so the model can see it in later turns.
      `ALTER TABLE tal_pending_actions ADD COLUMN result TEXT`,
    ],
  },
  {
    version: 13,
    name: "mcp tools in scheduled automations",
    statements: [
      // The owner's opt-in to offer an `auto` tool to scheduled automations as well as chat.
      `ALTER TABLE tal_mcp_tools ADD COLUMN scheduled INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 14,
    name: "password confirmation and token expiry",
    statements: [
      // When the owner last typed the password in this session; null asks for it before a sensitive action.
      `ALTER TABLE tal_sessions ADD COLUMN confirmed_at TEXT`,
      `ALTER TABLE tal_remote_tokens ADD COLUMN expires_at TEXT`,
      // Tokens from before expiry existed get the full lifetime from today, so none stops working at upgrade.
      `UPDATE tal_remote_tokens SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days') WHERE expires_at IS NULL`,
    ],
  },
  {
    version: 15,
    name: "session presence",
    statements: [
      // When an open tab last answered (heartbeat or any request); last_seen_at stays the owner's last use.
      `ALTER TABLE tal_sessions ADD COLUMN last_presence_at TEXT`,
    ],
  },
  {
    version: 16,
    name: "chat voice input",
    statements: [
      // Audio seconds transcribed per day, capped by TRANSCRIPTION_LIMITS.maxSecondsPerDay.
      `ALTER TABLE tal_usage_daily ADD COLUMN transcription_seconds INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 17,
    name: "sign-in activity",
    statements: [
      // One row per sign-in event; repeated failures from one network fold into one row (count).
      `CREATE TABLE IF NOT EXISTS tal_auth_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        last_at INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        kind TEXT NOT NULL,
        reason TEXT,
        ip TEXT,
        network TEXT,
        country TEXT,
        region TEXT,
        city TEXT,
        asn INTEGER,
        as_org TEXT,
        colo TEXT,
        host TEXT,
        user_agent TEXT,
        known_device INTEGER,
        session TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS tal_auth_events_at ON tal_auth_events(at)`,
      `CREATE INDEX IF NOT EXISTS tal_auth_events_network ON tal_auth_events(network, last_at)`,
      // What is left once the detailed rows expire: counts per day, country and kind, no IP.
      `CREATE TABLE IF NOT EXISTS tal_auth_daily (
        day TEXT NOT NULL,
        country TEXT NOT NULL,
        kind TEXT NOT NULL,
        n INTEGER NOT NULL,
        PRIMARY KEY (day, country, kind)
      )`,
      // Browsers that completed a sign-in; only HMAC(SESSION_SECRET, device cookie) is stored.
      `CREATE TABLE IF NOT EXISTS tal_known_devices (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: 18,
    name: "two-step sign-in",
    statements: [
      // A sign-in waiting for the second step. Only HMAC(SESSION_SECRET, challenge cookie) is stored.
      `CREATE TABLE IF NOT EXISTS tal_mfa_challenges (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        login_attempt INTEGER,
        weak_password INTEGER NOT NULL DEFAULT 0,
        user_agent TEXT NOT NULL DEFAULT ''
      )`,
    ],
  },
  {
    version: 19,
    name: "alert center",
    statements: [
      // Notifications written before the alert center were all sent to every push device: normal.
      `ALTER TABLE tal_notifications ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'`,
      `ALTER TABLE tal_notifications ADD COLUMN category TEXT NOT NULL DEFAULT 'system'`,
      // The same key within its cooldown is not raised again (e.g. one "task overdue" per day).
      `ALTER TABLE tal_notifications ADD COLUMN dedupe_key TEXT`,
      `CREATE INDEX IF NOT EXISTS tal_notifications_dedupe ON tal_notifications(dedupe_key, created_at)`,
      // One row per alert and channel: what was sent, held back or failed. Metadata only, no body.
      `CREATE TABLE IF NOT EXISTS tal_alert_deliveries (
        id TEXT PRIMARY KEY,
        notification_id TEXT NOT NULL,
        title TEXT NOT NULL,
        channel TEXT NOT NULL,
        priority TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        reached INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS tal_alert_deliveries_channel ON tal_alert_deliveries(channel, status, created_at)`,
      `CREATE INDEX IF NOT EXISTS tal_alert_deliveries_created ON tal_alert_deliveries(created_at)`,
    ],
  },
  {
    version: 20,
    name: "insistent alerts",
    statements: [
      // A high or critical alert is sent again until the owner confirms it (ESCALATION).
      `ALTER TABLE tal_notifications ADD COLUMN escalation TEXT`,
      `ALTER TABLE tal_notifications ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE tal_notifications ADD COLUMN next_attempt_at TEXT`,
      `CREATE INDEX IF NOT EXISTS tal_notifications_escalation ON tal_notifications(escalation, next_attempt_at)`,
      // The priority of the alerts an automation raises; existing ones stay normal.
      `ALTER TABLE tal_automations ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'`,
    ],
  },
  {
    version: 21,
    name: "learned alert priority",
    statements: [
      // The profile an alert belongs to, why it got its priority, and the one behaviour signal it gave.
      `ALTER TABLE tal_notifications ADD COLUMN profile TEXT`,
      `ALTER TABLE tal_notifications ADD COLUMN priority_reason TEXT`,
      `ALTER TABLE tal_notifications ADD COLUMN signal TEXT`,
      `CREATE INDEX IF NOT EXISTS tal_notifications_profile ON tal_notifications(profile, created_at)`,
      `CREATE TABLE IF NOT EXISTS tal_alert_profiles (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        label TEXT,
        shift INTEGER NOT NULL DEFAULT 0,
        pinned TEXT,
        score REAL NOT NULL DEFAULT 0,
        samples INTEGER NOT NULL DEFAULT 0,
        changed_at TEXT,
        last_change INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      // The owner's corrections, newest kept; the agent reads the latest reminder ones.
      `CREATE TABLE IF NOT EXISTS tal_alert_corrections (
        id TEXT PRIMARY KEY,
        notification_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        category TEXT NOT NULL,
        text TEXT NOT NULL,
        from_priority TEXT NOT NULL,
        to_priority TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 22,
    name: "push device last seen",
    statements: [
      // When each push device last opened Talorys signed in; devices away PUSH_INACTIVE_DAYS are removed.
      `ALTER TABLE tal_push_subscriptions ADD COLUMN last_seen_at TEXT`,
      // Devices from before count from the update, so none is removed the moment it lands.
      `UPDATE tal_push_subscriptions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE last_seen_at IS NULL`,
    ],
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/**
 * Applies pending migrations. Each migration runs in its own transaction
 * together with the version bump, so a failure leaves the previous version intact.
 */
export function migrate(db: Database, migrations: Migration[] = MIGRATIONS): number {
  db.run(`CREATE TABLE IF NOT EXISTS tal_schema (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const current = db.one<{ version: number }>(`SELECT version FROM tal_schema WHERE id = 1`)?.version ?? 0;
  let version = current;
  for (const m of migrations) {
    if (m.version <= version) continue;
    db.transaction(() => {
      for (const statement of m.statements) db.run(statement);
      m.after?.(db);
      db.run(
        `INSERT INTO tal_schema (id, version, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at`,
        m.version,
        new Date().toISOString(),
      );
    });
    version = m.version;
  }
  return version;
}

export function schemaVersion(db: Database): number {
  return db.one<{ version: number }>(`SELECT version FROM tal_schema WHERE id = 1`)?.version ?? 0;
}
