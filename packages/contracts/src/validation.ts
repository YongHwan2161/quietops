export type ValidationIssueCode =
  "invalid_format" | "invalid_type" | "invalid_value" | "unknown_key";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly message: string;
  readonly path: string;
}

export class ContractValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[]) {
    super(message);
    this.name = "ContractValidationError";
    this.issues = Object.freeze([...issues]);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseVocabularyValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value === "string" && values.includes(value)) {
    return value;
  }

  throw new ContractValidationError(`Invalid ${label}.`, [
    {
      code: typeof value === "string" ? "invalid_value" : "invalid_type",
      message: `Expected one of: ${values.join(", ")}.`,
      path: "$",
    },
  ]);
}
