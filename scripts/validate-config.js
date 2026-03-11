#!/usr/bin/env node
/**
 * validate-config.js — Run before dev/build to catch config drift.
 * Exits 0 if clean, 1 if problems found.
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

let errors = 0

function check(file, pattern, msg) {
  const content = readFileSync(resolve(root, file), 'utf-8')
  if (!pattern.test(content)) {
    console.error(`  FAIL: ${file} — ${msg}`)
    errors++
  }
}

console.log('[validate-config] Checking networking consistency...')

// All connection URLs must use 127.0.0.1, never bare localhost
const files = [
  'vite.config.ts',
  'shared/defaults.ts',
]

for (const f of files) {
  const content = readFileSync(resolve(root, f), 'utf-8')
  // Check for bare localhost in URLs (ws://, http://) — should be 127.0.0.1
  const localhostUrls = content.match(/(ws|http):\/\/localhost/g)
  if (localhostUrls) {
    console.error(`  FAIL: ${f} — uses 'localhost' in URL. Use 127.0.0.1 or DEFAULTS.HOST`)
    errors++
  }
}

// Verify DEFAULTS.HOST exists
check('shared/defaults.ts', /HOST:\s*'127\.0\.0\.1'/, 'Missing HOST constant set to 127.0.0.1')

if (errors === 0) {
  console.log('  All checks passed.')
} else {
  console.error(`\n  ${errors} config error(s) found. Fix before running.`)
  process.exit(1)
}
