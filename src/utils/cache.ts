/**
 * Simple file-based caching backed by JSON files in the cache directory.
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getCacheDir } from './paths.js';
import { sha256 } from './hashing.js';
import { fileExists } from './fs.js';

/**
 * Derive a cache key by hashing one or more string parts.
 * Concatenates all parts with a null separator before hashing.
 */
export function getCacheKey(...parts: string[]): string {
  return sha256(parts.join('\0'));
}

/**
 * Ensure the cache directory exists.
 */
async function ensureCacheDir(): Promise<string> {
  const dir = getCacheDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Resolve the full filesystem path for a given cache key.
 */
function cachePath(key: string): string {
  return join(getCacheDir(), `${key}.json`);
}

/**
 * Read a cached value. Returns `null` if the key does not exist or the
 * cached data cannot be deserialized.
 */
export async function readCache<T>(key: string): Promise<T | null> {
  const path = cachePath(key);

  try {
    if (!(await fileExists(path))) return null;

    const raw = await readFile(path, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    // Validate envelope structure before using
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('data' in parsed) ||
      !('timestamp' in parsed) ||
      typeof (parsed as Record<string, unknown>).timestamp !== 'number'
    ) {
      return null;
    }

    return (parsed as { data: T; timestamp: number }).data;
  } catch {
    return null;
  }
}

/**
 * Write a value to the cache. The value is wrapped in an envelope that
 * records the timestamp for potential TTL support in the future.
 */
export async function writeCache<T>(key: string, data: T): Promise<void> {
  await ensureCacheDir();
  const path = cachePath(key);

  const envelope = {
    data,
    timestamp: Date.now(),
  };

  await writeFile(path, JSON.stringify(envelope, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases used by older modules (e.g. promptRunner)
// ---------------------------------------------------------------------------

/** @deprecated Use getCacheKey instead. */
export const cacheKey = getCacheKey;

/** @deprecated Use readCache<string> instead. */
export async function getCached(key: string): Promise<string | null> {
  return readCache<string>(key);
}

/** @deprecated Use writeCache<string> instead. */
export async function setCached(key: string, value: string): Promise<void> {
  return writeCache(key, value);
}

/**
 * Clear the entire cache directory.
 */
export async function clearCache(): Promise<void> {
  const dir = getCacheDir();

  try {
    if (await fileExists(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
  } catch {
    // Best effort -- ignore errors during cleanup
  }
}
