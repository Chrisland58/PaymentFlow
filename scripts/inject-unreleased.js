#!/usr/bin/env node
'use strict';

/**
 * Inject content into the [Unreleased] section of CHANGELOG.md (#648).
 *
 * Usage:
 *   node scripts/inject-unreleased.js <draft-file>
 *
 * Reads <draft-file> (output of conventional-changelog-cli) and replaces the
 * body of the existing ## [Unreleased] section with the new content.
 * If no [Unreleased] section exists, one is inserted after the top-level heading.
 */

const fs   = require('fs');
const path = require('path');

const draftPath     = process.argv[2];
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

if (!draftPath) {
  console.error('Usage: node scripts/inject-unreleased.js <draft-file>');
  process.exit(1);
}

const draft     = fs.readFileSync(draftPath, 'utf8').trim();
const changelog = fs.readFileSync(changelogPath, 'utf8');
const lines     = changelog.split('\n');

// Find the [Unreleased] section start and the next version section start.
const unreleasedIdx = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l));
const nextSectionIdx = lines.findIndex(
  (l, i) => i > unreleasedIdx && /^## \[/.test(l),
);

let result;
if (unreleasedIdx === -1) {
  // No [Unreleased] section — insert after the first # heading.
  const headingIdx = lines.findIndex((l) => /^# /.test(l));
  const insertAt   = headingIdx === -1 ? 0 : headingIdx + 1;
  result = [
    ...lines.slice(0, insertAt + 1),
    '',
    '## [Unreleased]',
    '',
    draft,
    '',
    ...lines.slice(insertAt + 1),
  ].join('\n');
} else {
  // Replace the body of the existing [Unreleased] section.
  const before = lines.slice(0, unreleasedIdx + 1);
  const after  = nextSectionIdx === -1 ? [] : lines.slice(nextSectionIdx);
  result = [
    ...before,
    '',
    draft,
    '',
    ...after,
  ].join('\n');
}

fs.writeFileSync(changelogPath, result, 'utf8');
console.log('✓ [Unreleased] section updated in CHANGELOG.md');
