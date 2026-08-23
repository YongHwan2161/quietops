import { DatabaseSync } from "node:sqlite";

export const SQLITE_SCHEMA_VERSION = 2 as const;

export interface SQLiteMigrationResult {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly appliedVersions: readonly number[];
}

export interface SQLiteMigrationOptions {
  readonly appliedAt?: string;
  readonly targetVersion?: number;
}

interface SQLiteMigration {
  readonly version: number;
  readonly sql: string;
}

const MIGRATION_1 = `
  CREATE TABLE IF NOT EXISTS evaluations (
    evaluation_id TEXT PRIMARY KEY,
    scenario TEXT NOT NULL,
    candidate_json TEXT NOT NULL,
    parent_evaluation_id TEXT REFERENCES evaluations(evaluation_id),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS evaluation_events (
    event_id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(evaluation_id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    event_type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    UNIQUE (evaluation_id, sequence)
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS one_human_decision_per_evaluation
    ON evaluation_events(evaluation_id)
    WHERE event_type = 'human-decision-recorded';

  CREATE TABLE IF NOT EXISTS idempotency_records (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    request_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scope, key)
  ) STRICT;

  CREATE TRIGGER IF NOT EXISTS evaluations_no_update
  BEFORE UPDATE ON evaluations
  BEGIN
    SELECT RAISE(ABORT, 'evaluations are append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS evaluations_no_delete
  BEFORE DELETE ON evaluations
  BEGIN
    SELECT RAISE(ABORT, 'evaluations are append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS evaluation_events_no_update
  BEFORE UPDATE ON evaluation_events
  BEGIN
    SELECT RAISE(ABORT, 'evaluation events are append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS evaluation_events_no_delete
  BEFORE DELETE ON evaluation_events
  BEGIN
    SELECT RAISE(ABORT, 'evaluation events are append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS idempotency_records_no_update
  BEFORE UPDATE ON idempotency_records
  BEGIN
    SELECT RAISE(ABORT, 'idempotency records are append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS idempotency_records_no_delete
  BEFORE DELETE ON idempotency_records
  BEGIN
    SELECT RAISE(ABORT, 'idempotency records are append-only');
  END;
`;

const MIGRATION_2 = `
  CREATE TABLE IF NOT EXISTS release_runs (
    run_id TEXT PRIMARY KEY CHECK (length(run_id) BETWEEN 1 AND 128),
    repository TEXT NOT NULL CHECK (repository = 'YongHwan2161/quietops'),
    branch TEXT NOT NULL CHECK (branch = 'main'),
    candidate_commit TEXT NOT NULL CHECK (
      length(candidate_commit) = 40
      AND candidate_commit NOT GLOB '*[^0-9a-f]*'
    ),
    trigger_delivery_id TEXT NOT NULL UNIQUE CHECK (
      length(trigger_delivery_id) BETWEEN 1 AND 128
    ),
    policy_profile_json TEXT NOT NULL CHECK (json_valid(policy_profile_json)),
    created_at TEXT NOT NULL CHECK (length(created_at) = 24)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS release_run_events (
    event_id TEXT PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 128),
    run_id TEXT NOT NULL REFERENCES release_runs(run_id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    event_type TEXT NOT NULL CHECK (event_type IN (
      'release-triggered',
      'observation-recorded',
      'wait-scheduled',
      'run-woke',
      'decision-requested',
      'decision-recorded',
      'action-reserved',
      'action-attempted',
      'action-confirmed',
      'action-rejected',
      'action-uncertain',
      'run-completed',
      'run-stopped',
      'run-superseded'
    )),
    occurred_at TEXT NOT NULL CHECK (length(occurred_at) = 24),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    UNIQUE (run_id, sequence)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS release_run_heads (
    run_id TEXT PRIMARY KEY REFERENCES release_runs(run_id),
    state TEXT NOT NULL CHECK (state IN (
      'MONITORING',
      'WAITING',
      'AWAITING_DECISION',
      'RESUMING',
      'COMPLETED',
      'ESCALATED',
      'STOPPED'
    )),
    version INTEGER NOT NULL CHECK (version > 0),
    next_wake_at TEXT,
    active_decision_id TEXT,
    lease_owner TEXT,
    lease_expires_at TEXT,
    updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
    CHECK (
      (state IN ('WAITING', 'AWAITING_DECISION') AND next_wake_at IS NOT NULL)
      OR (state NOT IN ('WAITING', 'AWAITING_DECISION') AND next_wake_at IS NULL)
    ),
    CHECK (
      (state = 'AWAITING_DECISION' AND active_decision_id IS NOT NULL)
      OR (state <> 'AWAITING_DECISION' AND active_decision_id IS NULL)
    ),
    CHECK (
      state NOT IN ('COMPLETED', 'ESCALATED', 'STOPPED')
      OR lease_owner IS NULL
    )
  ) STRICT;

  CREATE TABLE IF NOT EXISTS external_actions (
    action_id TEXT PRIMARY KEY CHECK (length(action_id) BETWEEN 1 AND 128),
    run_id TEXT NOT NULL REFERENCES release_runs(run_id),
    action_type TEXT NOT NULL CHECK (action_type = 'CREATE_GITHUB_INCIDENT'),
    request_fingerprint TEXT NOT NULL CHECK (
      length(request_fingerprint) = 64
      AND request_fingerprint NOT GLOB '*[^0-9a-f]*'
    ),
    status TEXT NOT NULL CHECK (
      status IN ('RESERVED', 'IN_FLIGHT', 'CONFIRMED', 'REJECTED', 'UNCERTAIN')
    ),
    attempt_count INTEGER NOT NULL CHECK (attempt_count IN (0, 1)),
    provider_record_id TEXT,
    provider_url TEXT,
    response_digest TEXT CHECK (
      response_digest IS NULL
      OR (
        length(response_digest) = 64
        AND response_digest NOT GLOB '*[^0-9a-f]*'
      )
    ),
    created_at TEXT NOT NULL CHECK (length(created_at) = 24),
    updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
    UNIQUE (run_id, action_type),
    CHECK (
      (status = 'RESERVED' AND attempt_count = 0)
      OR (status <> 'RESERVED' AND attempt_count = 1)
    ),
    CHECK (
      (status = 'CONFIRMED' AND provider_record_id IS NOT NULL AND provider_url IS NOT NULL AND response_digest IS NOT NULL)
      OR (status <> 'CONFIRMED' AND provider_record_id IS NULL AND provider_url IS NULL)
    ),
    CHECK (
      status NOT IN ('RESERVED', 'IN_FLIGHT') OR response_digest IS NULL
    )
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS one_release_decision_request
    ON release_run_events(run_id)
    WHERE event_type = 'decision-requested';

  CREATE UNIQUE INDEX IF NOT EXISTS one_release_decision_record
    ON release_run_events(run_id)
    WHERE event_type = 'decision-recorded';

  CREATE INDEX IF NOT EXISTS release_run_heads_due
    ON release_run_heads(state, next_wake_at, lease_expires_at, updated_at);

  CREATE TRIGGER IF NOT EXISTS release_runs_no_update
  BEFORE UPDATE ON release_runs
  BEGIN
    SELECT RAISE(ABORT, 'release runs are immutable');
  END;

  CREATE TRIGGER IF NOT EXISTS release_runs_no_delete
  BEFORE DELETE ON release_runs
  BEGIN
    SELECT RAISE(ABORT, 'release runs are immutable');
  END;

  CREATE TRIGGER IF NOT EXISTS release_run_events_no_update
  BEFORE UPDATE ON release_run_events
  BEGIN
    SELECT RAISE(ABORT, 'release run events are append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS release_run_events_no_delete
  BEFORE DELETE ON release_run_events
  BEGIN
    SELECT RAISE(ABORT, 'release run events are append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS release_run_events_contiguous
  BEFORE INSERT ON release_run_events
  WHEN NEW.sequence <> COALESCE(
    (SELECT MAX(sequence) + 1 FROM release_run_events WHERE run_id = NEW.run_id),
    1
  )
  BEGIN
    SELECT RAISE(ABORT, 'release run event sequence must be contiguous');
  END;

  CREATE TRIGGER IF NOT EXISTS external_actions_monotonic
  BEFORE UPDATE ON external_actions
  WHEN
    NEW.action_id <> OLD.action_id
    OR NEW.run_id <> OLD.run_id
    OR NEW.action_type <> OLD.action_type
    OR NEW.request_fingerprint <> OLD.request_fingerprint
    OR NOT (
      (OLD.status = 'RESERVED' AND NEW.status = 'IN_FLIGHT' AND OLD.attempt_count = 0 AND NEW.attempt_count = 1)
      OR (OLD.status = 'IN_FLIGHT' AND NEW.status IN ('CONFIRMED', 'REJECTED', 'UNCERTAIN') AND OLD.attempt_count = 1 AND NEW.attempt_count = 1)
    )
  BEGIN
    SELECT RAISE(ABORT, 'external action transitions are monotonic');
  END;
`;

const MIGRATIONS = Object.freeze([
  Object.freeze({ version: 1, sql: MIGRATION_1 }),
  Object.freeze({ version: 2, sql: MIGRATION_2 }),
] satisfies readonly SQLiteMigration[]);

export function applySQLiteMigrations(
  database: DatabaseSync,
  options: SQLiteMigrationOptions = {},
): SQLiteMigrationResult {
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const rows = database
    .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
    .all() as unknown as readonly { readonly version: number }[];
  const versions = rows.map((row) => row.version);
  validateAppliedVersions(versions);

  const fromVersion = versions.at(-1) ?? 0;
  const targetVersion = options.targetVersion ?? SQLITE_SCHEMA_VERSION;
  if (
    !Number.isSafeInteger(targetVersion) ||
    targetVersion < fromVersion ||
    targetVersion > SQLITE_SCHEMA_VERSION
  ) {
    throw new Error(`Unsupported SQLite migration target ${targetVersion}.`);
  }

  const appliedVersions: number[] = [];
  const appliedAt = options.appliedAt ?? new Date().toISOString();
  for (const migration of MIGRATIONS) {
    if (migration.version <= fromVersion || migration.version > targetVersion) {
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
        )
        .run(migration.version, appliedAt);
      database.exec("COMMIT");
      appliedVersions.push(migration.version);
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return Object.freeze({
    fromVersion,
    toVersion: targetVersion,
    appliedVersions: Object.freeze(appliedVersions),
  });
}

function validateAppliedVersions(versions: readonly number[]): void {
  for (const [index, version] of versions.entries()) {
    if (version !== index + 1) {
      throw new Error("SQLite migration history is non-contiguous.");
    }
  }

  const current = versions.at(-1) ?? 0;
  if (current > SQLITE_SCHEMA_VERSION) {
    throw new Error(
      `SQLite schema version ${current} is newer than supported version ${SQLITE_SCHEMA_VERSION}.`,
    );
  }
}
