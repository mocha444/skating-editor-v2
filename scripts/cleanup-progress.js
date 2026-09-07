#!/usr/bin/env node
// Cleans up finished/abandoned job rows (SQLite) older than 7 days, removes
// their log files, and prunes stale upload sessions.
const fs = require("fs");
const path = require("path");
const { getDb, PROGRESS_DIR } = require("./jobs-db.cjs");

const sevenDays = 7 * 24 * 60 * 60 * 1000;
const cutoff = Date.now() - sevenDays;

try {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id FROM jobs WHERE status IN ('done','error') AND (finished IS NULL OR finished < ?)"
  ).all(cutoff);
  const del = db.prepare("DELETE FROM jobs WHERE id = ?");
  let deleted = 0;
  for (const r of rows) {
    del.run(r.id);
    try { fs.unlinkSync(path.join(PROGRESS_DIR, r.id + ".log")); } catch {}
    deleted++;
  }
  console.log(`[cleanup] Deleted ${deleted} old finished/error jobs`);
} catch (e) {
  console.log(`[cleanup] No DB or nothing to clean: ${e.message}`);
}