import type { NextFunction, Request, Response } from 'express';

export function requireJson(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && !req.is('application/json')) {
    res.status(415).json({ success: false, error: 'application/json required' });
    return;
  }
  next();
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function requireString(value: unknown, name: string): string {
  const resolved = readString(value);
  if (!resolved) {
    throw new Error(`${name} is required`);
  }
  return resolved;
}

export function routeError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unknown licensing error';
  res.status(400).json({ success: false, error: message });
}
