/**
 * Minimal fail-closed validator over the JSON-Schema subset a tool definition
 * declares at registration (`inputSchemaJson`). Supports type / properties /
 * required / items / enum on plain JSON values, and refuses unknown keys —
 * enough to canonicalize tool inputs when no richer authoritative schema
 * object is composed at the route. A route may always override with a full
 * Zod schema (ADR-0013) through the same structural seam; this compiler
 * exists so registration-declared shapes are never trusted without ANY
 * validation.
 */
import type { SchemaLike } from './provider-contract.ts';

export interface JsonSchemaObject {
  readonly type?: string | undefined;
  readonly properties?: Readonly<Record<string, unknown>> | undefined;
  readonly required?: readonly string[] | undefined;
  readonly items?: unknown;
  readonly enum?: readonly unknown[] | undefined;
}

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

function fail(message: string): never {
  throw new SchemaValidationError(message);
}

function checkType(value: unknown, type: string, path: string): void {
  switch (type) {
    case 'string':
      if (typeof value !== 'string') fail(`${path} must be a string`);
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be a number`);
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) fail(`${path} must be an integer`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') fail(`${path} must be a boolean`);
      return;
    case 'array':
      if (!Array.isArray(value)) fail(`${path} must be an array`);
      return;
    case 'object':
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${path} must be an object`);
      }
      return;
    default:
      fail(`${path} declares unsupported type ${type}`);
  }
}

function validateAgainst(value: unknown, schema: JsonSchemaObject, path: string): void {
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    fail(`${path} is not one of the enumerated values`);
  }
  const type = schema.type ?? (schema.properties !== undefined ? 'object' : undefined);
  if (type === undefined) return; // unconstrained leaf
  checkType(value, type, path);
  if (type === 'array' && Array.isArray(value)) {
    const items = (schema.items ?? {}) as JsonSchemaObject;
    for (const [index, item] of value.entries()) validateAgainst(item, items, `${path}[${index}]`);
  }
  if (type === 'object' && value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const declared = Object.keys(schema.properties ?? {});
    for (const key of Object.keys(record)) {
      if (!declared.includes(key)) fail(`${path}.${key} is not a declared input field`);
    }
    for (const key of requiredOf(schema)) {
      if (!(key in record)) fail(`${path}.${key} is required`);
    }
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      if (key in record) validateAgainst(record[key], prop as JsonSchemaObject, `${path}.${key}`);
    }
  }
}

function requiredOf(schema: JsonSchemaObject): readonly string[] {
  return schema.required ?? [];
}

/** Structural `.parse` validator matching the injected-schema seam. */
export function jsonSchemaValidator(schema: JsonSchemaObject): SchemaLike {
  return {
    parse(input: unknown): unknown {
      // Absent optional fields are not injected; null arguments canonicalize
      // to the empty object so cache keys stay stable across call sites.
      const value = input ?? {};
      validateAgainst(value, schema, 'input');
      return value;
    },
  };
}
