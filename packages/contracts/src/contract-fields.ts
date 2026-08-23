import {
  ContractValidationError,
  isRecord,
  type ValidationIssue,
} from "./validation.js";

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  throw new ContractValidationError(`Invalid ${label}.`, [
    {
      code: "invalid_type",
      message: "Expected an object.",
      path: "$",
    },
  ]);
}

export function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  issues: ValidationIssue[],
  path = "$",
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      issues.push({
        code: "unknown_key",
        message: "Unknown fields are not accepted.",
        path: `${path}.${key}`,
      });
    }
  }
}

export function readString(
  value: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
  options: {
    readonly path?: string;
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly pattern?: RegExp;
  } = {},
): string | undefined {
  const field = value[key];
  const path = `${options.path ?? "$"}.${key}`;

  if (typeof field !== "string") {
    issues.push({
      code: "invalid_type",
      message: "Expected a string.",
      path,
    });
    return undefined;
  }

  const minLength = options.minLength ?? 0;
  const maxLength = options.maxLength ?? Number.POSITIVE_INFINITY;
  if (
    field.length < minLength ||
    field.length > maxLength ||
    (options.pattern !== undefined && !options.pattern.test(field))
  ) {
    issues.push({
      code: "invalid_format",
      message: "String does not match the bounded contract.",
      path,
    });
    return undefined;
  }

  return field;
}

export function readInteger(
  value: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
  options: {
    readonly path?: string;
    readonly minimum?: number;
    readonly maximum?: number;
  } = {},
): number | undefined {
  const field = value[key];
  const path = `${options.path ?? "$"}.${key}`;

  if (typeof field !== "number" || !Number.isSafeInteger(field)) {
    issues.push({
      code: "invalid_type",
      message: "Expected a safe integer.",
      path,
    });
    return undefined;
  }

  if (
    field < (options.minimum ?? Number.MIN_SAFE_INTEGER) ||
    field > (options.maximum ?? Number.MAX_SAFE_INTEGER)
  ) {
    issues.push({
      code: "invalid_value",
      message: "Integer is outside the allowed range.",
      path,
    });
    return undefined;
  }

  return field;
}

export function readBoolean(
  value: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
  path = "$",
): boolean | undefined {
  const field = value[key];
  if (typeof field !== "boolean") {
    issues.push({
      code: "invalid_type",
      message: "Expected a boolean.",
      path: `${path}.${key}`,
    });
    return undefined;
  }

  return field;
}

export function readUtcTimestamp(
  value: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
  path = "$",
): string | undefined {
  const timestamp = readString(value, key, issues, {
    path,
    minLength: 24,
    maxLength: 24,
    pattern: UTC_TIMESTAMP_PATTERN,
  });

  if (timestamp !== undefined) {
    try {
      if (new Date(timestamp).toISOString() !== timestamp) {
        throw new Error("non-canonical timestamp");
      }
    } catch {
      issues.push({
        code: "invalid_format",
        message: "Expected a canonical UTC ISO timestamp.",
        path: `${path}.${key}`,
      });
      return undefined;
    }
  }

  return timestamp;
}

export function finishContract<T>(
  label: string,
  issues: readonly ValidationIssue[],
  result: T,
): T {
  if (issues.length > 0) {
    throw new ContractValidationError(`Invalid ${label}.`, issues);
  }

  return deepFreeze(result);
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}
