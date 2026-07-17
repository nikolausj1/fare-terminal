// Small shared response helpers for app/api/** route handlers: consistent
// JSON error shape ({ error: { code, message } }), and cache-header
// wrappers. Keeps every route handler thin per PRD §24.

import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

export function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function formatZodError(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

export function badRequest(message: string, zodError?: ZodError): NextResponse {
  return errorResponse(400, 'BAD_REQUEST', zodError ? `${message}: ${formatZodError(zodError)}` : message);
}

export function notFound(message = 'Not found'): NextResponse {
  return errorResponse(404, 'NOT_FOUND', message);
}

/** JSON 200 with a Cache-Control header — most GET routes are safe to cache
 * at the CDN/shared-cache layer for a short window since the underlying
 * data only changes when the pipeline (or a refresh) runs. */
export function ok(data: unknown, cacheControl?: string): NextResponse {
  return NextResponse.json(data, cacheControl ? { headers: { 'Cache-Control': cacheControl } } : undefined);
}

/** JSON 200 that must never be cached (mutating/rate-limited endpoints like
 * refresh). */
export function okNoStore(data: unknown): NextResponse {
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
