#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const uploadsDir = path.join(__dirname, "..", "public", "uploads");

function md5File(filePath) {
  return crypto.createHash("md5").update(fs.readFileSync(filePath)).digest("hex");
}

const dirs = fs.readdirSync(uploadsDir)
  .filter(d => d.startsWith("skate-") && fs.statSync(path.join(uploadsDir, d)).isDirectory());

for (const dir of dirs) {
  const inputPath = path.join(uploadsDir, dir, "input.mp4");
  const hashPath = path.join(uploadsDir, dir, "hash.md5");
  if (!fs.existsSync(inputPath)) continue;
  const hash = md5File(inputPath);
  fs.writeFileSync(hashPath, hash, "utf8");
  console.log(`${dir}: ${hash}`);
}
