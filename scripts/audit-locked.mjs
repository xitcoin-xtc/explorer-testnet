#!/usr/bin/env node
// Audit the locked dependencies. Every advisory fails the build unless it is listed below with a reason and a review date.
// An entry is allowed only when no patched version exists; it expires, so it is looked at again.
import { spawnSync } from 'node:child_process';

const ACCEPTED = {
  1240992: {
    module: 'braces',
    reason: 'No patched version is published (affects <=3.0.3, the latest). Build-time only: file globbing inside unplugin-auto-import and unplugin-vue-components; not part of the browser bundle.',
    reviewBy: '2026-12-31',
  },
};

const run = spawnSync('yarn', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const advisories = new Map();
for (const line of run.stdout.split('\n')) {
  if (!line.trim()) continue;
  let entry;
  try { entry = JSON.parse(line); } catch { continue; }
  if (entry.type === 'auditAdvisory') advisories.set(entry.data.advisory.id, entry.data.advisory);
}
if (run.status !== 0 && advisories.size === 0) {
  console.error('yarn audit failed without a readable report:\n' + (run.stderr || run.stdout).slice(0, 2000));
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const blocking = [];
for (const [id, a] of advisories) {
  const ok = ACCEPTED[id];
  if (ok && ok.module === a.module_name && today <= ok.reviewBy) {
    console.log(`accepted until ${ok.reviewBy}: ${a.module_name} (${a.severity}) ${a.url}`);
    continue;
  }
  blocking.push(`${a.severity}: ${a.module_name} ${a.vulnerable_versions} -> ${a.patched_versions} ${a.url}`);
}
for (const id of Object.keys(ACCEPTED)) {
  if (!advisories.has(Number(id))) console.log(`note: accepted advisory ${id} is no longer reported; remove it from this file`);
}
if (blocking.length) {
  console.error(`${blocking.length} advisory(ies) to fix:\n` + blocking.join('\n'));
  process.exit(1);
}
console.log(`audit passed: ${advisories.size} advisory(ies) reported, all accepted with a reason`);
