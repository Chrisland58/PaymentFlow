#!/usr/bin/env node
'use strict';

/**
 * Validate CHANGELOG.md format — issue #648
 *
 * Enforces the Keep a Changelog (https://keepachangelog.com) format:
 *   - File must start with a level-1 heading "# Changelog"
 *   - At least one versioned section `## [x.y.z]` or `## [Unreleased]` present
 *   - Version sections use one of the standard subsection headings:
 *     Added, Changed, Deprecated, Removed, Fixed, Security, Documentation
 *   - No bare commit messages used as changelog entries (heuristic)
 *
 * Run:
 *   node scripts/validate-changelog.js
 *
 * Used by .github/workflows/changelog.yml on every PR.
 */

const fs   = require('fs');
const path = require('path');

const CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');

const VALID_SUBSECTIONS = new Set([
  'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security', 'Documentation',
]);

// A version section header: ## [Unreleased] or ## [1.2.3] - YYYY-MM-DD
const VERSION_HEADER_RE = /^## \[(?:Unreleased|\d+\.\d+\.\d+[^\]]*)\]/;
// A subsection header: ### Added / ### Fixed / etc.
const SUBSECTION_RE     = /^### (.+)$/;
// Bare commit-message heuristic: lines that look like raw git log entries.
const BARE_COMMIT_RE    = /^- [a-f0-9]{7,40} /;

function validate() {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    console.error('ERROR: CHANGELOG.md not found at', CHANGELOG_PATH);
    process.exit(1);
  }

  const content = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const lines   = content.split('\n');
  const errors  = [];

  // 1. Must start with # Changelog
  const firstHeading = lines.find((l) => l.startsWith('#'));
  if (!firstHeading || !/^# Changelog/i.test(firstHeading)) {
    errors.push('CHANGELOG.md must start with a level-1 heading "# Changelog"');
  }

  // 2. Must have at least one version section.
  const versionLines = lines.filter((l) => VERSION_HEADER_RE.test(l));
  if (versionLines.length === 0) {
    errors.push(
      'CHANGELOG.md must contain at least one version section ' +
      '(e.g. ## [Unreleased] or ## [1.0.0] - 2026-01-01)',
    );
  }

  // 3. All ### subsections must use standard Keep a Changelog headings.
  lines.forEach((line, idx) => {
    const m = SUBSECTION_RE.exec(line);
    if (!m) return;
    const heading = m[1].trim();
    if (!VALID_SUBSECTIONS.has(heading)) {
      errors.push(
        `Line ${idx + 1}: non-standard subsection heading "### ${heading}". ` +
        `Allowed: ${[...VALID_SUBSECTIONS].join(', ')}`,
      );
    }
  });

  // 4. No bare commit-hash entries.
  lines.forEach((line, idx) => {
    if (BARE_COMMIT_RE.test(line)) {
      errors.push(
        `Line ${idx + 1}: looks like a raw git commit entry ("${line.slice(0, 60)}…"). ` +
        'Write a human-readable changelog entry instead.',
      );
    }
  });

  if (errors.length > 0) {
    console.error('CHANGELOG.md validation failed:\n');
    errors.forEach((e) => console.error('  ✗', e));
    console.error(
      '\nSee CONTRIBUTING.md § Changelog Process for the expected format.',
    );
    process.exit(1);
  }

  console.log('✓ CHANGELOG.md format is valid');
  console.log(`  ${versionLines.length} version section(s) found`);
}

validate();
