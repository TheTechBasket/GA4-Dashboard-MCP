/**
 * reportCache.js
 * Disk-based cache for historical analytics data (cards + reports).
 * 
 * - Cache files stored in .cache/reports/{namespace}/
 * - Configurable TTL per namespace
 * - Auto-cleanup of files older than MAX_AGE_DAYS (default 7)
 * - Atomic writes via temp file + rename
 * - In-memory hit tracking per request cycle
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const CACHE_ROOT = path.join(__dirname, "..", ".cache", "reports");
const MAX_AGE_DAYS = 7; // cleanup files older than this
const TTL_DEFAULTS = {
  card: 60 * 60 * 1000,     // 1 hour for analytics cards
  report: 60 * 60 * 1000,   // 1 hour for aggregate reports
  spike: 2 * 60 * 1000,     // 2 minutes — spikes are near-realtime, can't cache like reports
};

/**
 * Ensure cache directory exists for a given namespace
 */
async function ensureDir(namespace) {
  const dir = path.join(CACHE_ROOT, namespace);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Generate a safe filename from a cache key
 */
function safeFilename(key) {
  return key.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 200) + ".json";
}

/**
 * Get a cached value. Returns null if miss or expired.
 */
async function cacheGet(namespace, key) {
  try {
    const dir = path.join(CACHE_ROOT, namespace);
    const file = path.join(dir, safeFilename(key));
    const stat = await fsp.stat(file);
    const age = Date.now() - stat.mtimeMs;
    const ttl = TTL_DEFAULTS[namespace] || 60 * 60 * 1000;

    if (age > ttl) {
      // Expired — delete it
      await fsp.unlink(file).catch(() => {});
      return null;
    }

    const raw = await fsp.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    // Unwrap the { cachedAt, data } envelope stored by cacheSet
    // Check for both envelope keys to avoid stripping a payload that
    // happens to have a truthy `data` field
    if (parsed && typeof parsed === "object" && "cachedAt" in parsed && "data" in parsed) {
      return parsed.data;
    }
    return parsed;
  } catch {
    return null; // miss or error
  }
}

/**
 * Set a cached value. Uses atomic write (temp file + rename).
 */
async function cacheSet(namespace, key, value) {
  try {
    const dir = await ensureDir(namespace);
    const file = path.join(dir, safeFilename(key));
    const tmp = file + ".tmp." + process.pid;

    const payload = JSON.stringify({
      cachedAt: new Date().toISOString(),
      data: value,
    });

    // Atomic write: write to tmp, then rename
    await fsp.writeFile(tmp, payload, "utf8");
    await fsp.rename(tmp, file);
    return true;
  } catch (err) {
    console.warn(`[cache] write error (${namespace}/${key}): ${err.message}`);
    return false;
  }
}

/**
 * Delete a specific cache entry
 */
async function cacheDel(namespace, key) {
  try {
    const dir = path.join(CACHE_ROOT, namespace);
    const file = path.join(dir, safeFilename(key));
    await fsp.unlink(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up all cached files older than MAX_AGE_DAYS
 * Also removes empty namespace directories
 */
async function cacheCleanup() {
  let cleaned = 0;
  try {
    const rootExists = await fsp.stat(CACHE_ROOT).catch(() => null);
    if (!rootExists) return 0;

    const namespaces = await fsp.readdir(CACHE_ROOT);
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    for (const ns of namespaces) {
      const nsDir = path.join(CACHE_ROOT, ns);
      const stat = await fsp.stat(nsDir).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;

      const files = await fsp.readdir(nsDir);
      let anyRemaining = false;

      for (const file of files) {
        const filePath = path.join(nsDir, file);
        try {
          const fileStat = await fsp.stat(filePath);
          if (fileStat.isFile() && fileStat.mtimeMs < cutoff) {
            await fsp.unlink(filePath);
            cleaned++;
          } else {
            anyRemaining = true;
          }
        } catch { /* skip unreadable */ }
      }

      // Remove empty namespace dirs
      if (!anyRemaining) {
        await fsp.rmdir(nsDir).catch(() => {});
      }
    }
  } catch (err) {
    console.warn(`[cache] cleanup error: ${err.message}`);
  }

  if (cleaned > 0) {
    console.log(`[cache] Cleaned up ${cleaned} expired file(s) from ${CACHE_ROOT}`);
  }
  return cleaned;
}

module.exports = {
  cacheGet,
  cacheSet,
  cacheDel,
  cacheCleanup,
  CACHE_ROOT,
  MAX_AGE_DAYS,
};
