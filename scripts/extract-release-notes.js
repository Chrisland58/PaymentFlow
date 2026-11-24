#!/usr/bin/env node
'use strict';

/**
 * Extract the content of a specific version section from CHANGELOG.md (#648).
 *
 * Usage:
 *   node scripts/extract-release-notes.js <version>
 *   # e.g. node scripts/extract-release-notes.js 1.1.0
 *
 * Prints the section body to stdout so it can be used as GitHub Release notes.
 */

const fs   = require('fs');
const path = require('path');

const version       = process.argv[2];
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

if (!version) {
  console.error('Usage: node scripts/extract-release-notes.js <version>');
  process.exit(1);
}

const changelog = fs.readFileSync(changelogPath, 'utf8');
const lines     = changelog.split('\n');

// Find the section header for this version.
const startIdx = lines.findIndex((l) =>
  new RegExp(`^## \\[${version.replace('.', '\\.').replace('.', '\\.')}\\]`).test(l),
);

if (startIdx === -1) {
  console.error(`ERROR: No section found for version [${version}] in CHANGELOG.md`);
  process.exit(1);
}

// Find the next section header (or end of file).
const endIdx = lines.findIndex((l, i) => i > startIdx && /^## \[/.test(l));
const body   = (endIdx === -1 ? lines.slice(startIdx + 1) : lines.slice(startIdx + 1, endIdx))
  .join('\n')
  .trim();

if (!body) {
  console.error(`WARNING: Section [${version}] is empty in CHANGELOG.md`);
  process.exit(0);
}

process.stdout.write(body + '\n');
