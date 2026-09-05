#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const DATA_ROOT = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const PROGRESS_DIR = path.join(DATA_ROOT, "progress");

try {
  const files = fs.readdirSync(PROGRESS_DIR);
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const f of files) {
    const fp = path.join(PROGRESS_DIR, f);
    const stat = fs.statSync(fp);
    if (now - stat.mtimeMs > sevenDays) {
      fs.unlinkSync(fp);
      deleted++;
    }
  }
  console.log(`[cleanup] Deleted ${deleted} progress files older than 7 days`);
} catch (e) {
  console.log(`[cleanup] No progress dir or nothing to clean: ${e.message}`);
}
