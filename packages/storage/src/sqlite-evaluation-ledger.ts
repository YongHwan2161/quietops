import { DatabaseSync } from "node:sqlite";

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface NewEvaluationRecord {
  readonly evaluationId: string;
  readonly scenario: string;
  readonly candidate: JsonObject;
  readonly parentEvaluationId: string | null;
  readonly createdAt: string;
}

export interface StoredEvaluationRecord extends NewEvaluationRecord {}

export interface NewLedgerEvent {
  readonly eventId: string;
  readonly evaluationId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly payload: JsonObject;
}

export interface StoredLedgerEvent extends NewLedgerEvent {}

export interface NewIdempotencyRecord {
  readonly scope: string;
  readonly key: string;
  readonly request: JsonObject;
  readonly response: JsonObject;
  readonly createdAt: string;
}

export interface CommitLedgerBatch {
  readonly evaluations?: readonly NewEvaluationRecord[];
  readonly events: readonly NewLedgerEvent[];
  readonly idempotency?: NewIdempotencyRecord;
}

export type IdempotencyLookup =
  | { readonly found: false }
  | { readonly found: true; readonly response: JsonObject };

export interface CommitLedgerBatchResult {
  readonly replayed: boolean;
  readonly response?: JsonObject;
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" as const;

  constructor(scope: string, key: string) {
    super(`Idempotency key ${key} was reused in ${scope}.`);
    this.name = "IdempotencyConflictError";
  }
}

interface EvaluationRow {
  readonly evaluation_id: string;
  readonly scenario: string;
  readonly candidate_json: string;
  readonly parent_evaluation_id: string | null;
  readonly created_at: string;
}

interface EventRow {
  readonly event_id: string;
  readonly evaluation_id: string;
  readonly sequence: number;
  readonly event_type: string;
  readonly occurred_at: string;
  readonly payload_json: string;
}

interface IdempotencyRow {
  readonly request_json: string;
  readonly response_json: string;
}

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT;

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

export class SQLiteEvaluationLedger {
  readonly #database: DatabaseSync;
  #closed = false;

  constructor(path = ":memory:") {
    this.#database = new DatabaseSync(path);
    this.#database.exec(SCHEMA);
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
      )
      .run(1, new Date().toISOString());
  }

  commit(batch: CommitLedgerBatch): CommitLedgerBatchResult {
    this.#requireOpen();
    this.#database.exec("BEGIN IMMEDIATE");

    try {
      if (batch.idempotency) {
        const existing = this.#readIdempotency(
          batch.idempotency.scope,
          batch.idempotency.key,
        );

        if (existing) {
          this.#assertSameRequest(batch.idempotency, existing.request_json);
          const response = parseJsonObject(
            existing.response_json,
            "idempotency response",
          );
          this.#database.exec("COMMIT");
          return Object.freeze({
            replayed: true,
            response,
          });
        }
      }

      for (const evaluation of batch.evaluations ?? []) {
        this.#database
          .prepare(
            `INSERT INTO evaluations(
              evaluation_id,
              scenario,
              candidate_json,
              parent_evaluation_id,
              created_at
            ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            evaluation.evaluationId,
            evaluation.scenario,
            JSON.stringify(evaluation.candidate),
            evaluation.parentEvaluationId,
            evaluation.createdAt,
          );
      }

      for (const event of batch.events) {
        this.#database
          .prepare(
            `INSERT INTO evaluation_events(
              event_id,
              evaluation_id,
              sequence,
              event_type,
              occurred_at,
              payload_json
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            event.eventId,
            event.evaluationId,
            event.sequence,
            event.eventType,
            event.occurredAt,
            JSON.stringify(event.payload),
          );
      }

      if (batch.idempotency) {
        this.#database
          .prepare(
            `INSERT INTO idempotency_records(
              scope,
              key,
              request_json,
              response_json,
              created_at
            ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            batch.idempotency.scope,
            batch.idempotency.key,
            canonicalJson(batch.idempotency.request),
            JSON.stringify(batch.idempotency.response),
            batch.idempotency.createdAt,
          );
      }

      this.#database.exec("COMMIT");
      return Object.freeze({
        replayed: false,
        ...(batch.idempotency ? { response: batch.idempotency.response } : {}),
      });
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  findIdempotency(
    scope: string,
    key: string,
    request: JsonObject,
  ): IdempotencyLookup {
    this.#requireOpen();
    const existing = this.#readIdempotency(scope, key);
    if (!existing) return Object.freeze({ found: false });

    this.#assertSameRequest({ scope, key, request }, existing.request_json);
    return Object.freeze({
      found: true,
      response: parseJsonObject(existing.response_json, "idempotency response"),
    });
  }

  getEvaluation(evaluationId: string): StoredEvaluationRecord | undefined {
    this.#requireOpen();
    const row = this.#database
      .prepare(
        `SELECT
          evaluation_id,
          scenario,
          candidate_json,
          parent_evaluation_id,
          created_at
        FROM evaluations
        WHERE evaluation_id = ?`,
      )
      .get(evaluationId) as EvaluationRow | undefined;

    return row ? mapEvaluation(row) : undefined;
  }

  listEvaluations(): readonly StoredEvaluationRecord[] {
    this.#requireOpen();
    const rows = this.#database
      .prepare(
        `SELECT
          evaluation_id,
          scenario,
          candidate_json,
          parent_evaluation_id,
          created_at
        FROM evaluations
        ORDER BY created_at DESC, evaluation_id DESC`,
      )
      .all() as unknown as readonly EvaluationRow[];

    return Object.freeze(rows.map(mapEvaluation));
  }

  listEvents(evaluationId: string): readonly StoredLedgerEvent[] {
    this.#requireOpen();
    const rows = this.#database
      .prepare(
        `SELECT
          event_id,
          evaluation_id,
          sequence,
          event_type,
          occurred_at,
          payload_json
        FROM evaluation_events
        WHERE evaluation_id = ?
        ORDER BY sequence ASC`,
      )
      .all(evaluationId) as unknown as readonly EventRow[];

    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          eventId: row.event_id,
          evaluationId: row.evaluation_id,
          sequence: row.sequence,
          eventType: row.event_type,
          occurredAt: row.occurred_at,
          payload: parseJsonObject(row.payload_json, "event payload"),
        }),
      ),
    );
  }

  checkIntegrity(): string {
    this.#requireOpen();
    const row = this.#database.prepare("PRAGMA integrity_check").get() as
      { readonly integrity_check?: unknown } | undefined;
    const result = row?.integrity_check;
    if (typeof result !== "string") {
      throw new Error("SQLite integrity check returned an invalid result.");
    }
    return result;
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }

  #readIdempotency(scope: string, key: string): IdempotencyRow | undefined {
    return this.#database
      .prepare(
        `SELECT request_json, response_json
         FROM idempotency_records
         WHERE scope = ? AND key = ?`,
      )
      .get(scope, key) as IdempotencyRow | undefined;
  }

  #assertSameRequest(
    record: Pick<NewIdempotencyRecord, "scope" | "key" | "request">,
    storedRequest: string,
  ): void {
    if (canonicalJson(record.request) !== storedRequest) {
      throw new IdempotencyConflictError(record.scope, record.key);
    }
  }

  #requireOpen(): void {
    if (this.#closed) throw new Error("SQLite evaluation ledger is closed.");
  }
}

function mapEvaluation(row: EvaluationRow): StoredEvaluationRecord {
  return Object.freeze({
    evaluationId: row.evaluation_id,
    scenario: row.scenario,
    candidate: parseJsonObject(row.candidate_json, "candidate"),
    parentEvaluationId: row.parent_evaluation_id,
    createdAt: row.created_at,
  });
}

function parseJsonObject(value: string, label: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (!isJsonObject(parsed)) {
    throw new Error(`Stored ${label} is not a JSON object.`);
  }
  return parsed;
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
