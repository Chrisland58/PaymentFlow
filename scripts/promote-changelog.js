#!/usr/bin/env node
'use strict';

/**
 * Promote [Unreleased] to a versioned section in CHANGELOG.md (#648).
 *
 * Usage:
 *   node scripts/promote-changelog.js <version>
 *   # e.g. node scripts/promote-changelog.js 1.1.0
 *
 * Renames "## [Unreleased]" to "## [1.1.0] - YYYY-MM-DD" and inserts a new
 * empty "## [Unreleased]" section above it, ready for the next cycle.
 */

const fs   = require('fs');
const path = require('path');

const version       = process.argv[2];
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('Usage: node scripts/promote-changelog.js <semver>');
  console.error('Example: node scripts/promote-changelog.js 1.1.0');
  process.exit(1);
}

const today     = new Date().toISOString().slice(0, 10);
const changelog = fs.readFileSync(changelogPath, 'utf8');
const lines     = changelog.split('\n');

const unreleasedIdx = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l));
if (unreleasedIdx === -1) {
  console.error('ERROR: No ## [Unreleased] section found in CHANGELOG.md');
  process.exit(1);
}

// Replace the [Unreleased] line with the versioned heading and insert a new
// empty [Unreleased] section above it.
lines.splice(
  unreleasedIdx,
  1,
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '### Changed',
  '',
  '### Fixed',
  '',
  `## [${version}] - ${today}`,
);

fs.writeFileSync(changelogPath, lines.join('\n'), 'utf8');
console.log(`✓ Promoted [Unreleased] → [${version}] - ${today} in CHANGELOG.md`);
