'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function durable(file, text, flag = 'wx') {
  const fd = fs.openSync(file, flag);
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function physical(root, file) {
  const relative = path.relative(root, file);
  assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'PATH_OUTSIDE_SANDBOX');
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    assert.ok(!fs.lstatSync(current).isSymbolicLink(), 'LINK_REJECTED');
    assert.equal(path.resolve(fs.realpathSync(current)).toLowerCase(), path.resolve(current).toLowerCase(), 'REPARSE_POINT_REJECTED');
  }
  return file;
}
function sandbox(root) {
  const approved = path.resolve(os.tmpdir(), 'opencode');
  root = path.resolve(root);
  assert.equal(path.dirname(root).toLowerCase(), approved.toLowerCase(), 'ISOLATED_TEMP_ROOT_REQUIRED');
  assert.ok(path.basename(root).startsWith('cat-recovery-phase2-'), 'ISOLATED_TEMP_ROOT_REQUIRED');
  assert.ok(!fs.lstatSync(root).isSymbolicLink(), 'LINK_REJECTED');
  assert.equal(path.resolve(fs.realpathSync(root)).toLowerCase(), root.toLowerCase(), 'REPARSE_POINT_REJECTED');
  assert.equal(json(physical(root, path.join(root, 'sandbox.json'))).isolated, true, 'SANDBOX_MARKER_REQUIRED');
  return root;
}

// Deliberately restricted to a fresh, private test generation directory, NEVER a Dropbox output.
// Deployment to operational roots requires a reviewed custody/delivery mechanism, not removing this guard.
function prepare(root, binding, fault = () => {}) {
  root = sandbox(root);
  assert.match(binding.requestId, /^[0-9a-f-]{36}$/i);
  assert.match(binding.reservationId, /^[1-9][0-9]*$/);
  assert.match(binding.sourceSha256, /^[0-9a-f]{64}$/);
  assert.ok(Array.isArray(binding.expected) && binding.expected.length > 0 && binding.expected.length <= 10000);
  const seen = new Set();
  for (const entry of binding.expected) {
    assert.match(entry.folio, /^[1-9][0-9]*$/);
    assert.ok(typeof entry.name === 'string' && entry.name === path.basename(entry.name) && !/[\\/:*?"<>|\x00-\x1f]/.test(entry.name)
      && !/[. ]$/.test(entry.name) && /\.pdf$/i.test(entry.name), 'INVALID_PDF_NAME');
    assert.ok(!seen.has(entry.name.toLowerCase()), 'DUPLICATE_FILENAME'); seen.add(entry.name.toLowerCase());
  }
  assert.equal(new Set(binding.expected.map(e => e.folio)).size, binding.expected.length, 'DUPLICATE_FOLIO');
  const custody = json(physical(root, path.join(root, 'custody.json')));
  assert.equal(custody.state, 'ISOLATED_UNRELEASED', 'DELIVERY_OR_CUSTODY_UNPROVEN');
  assert.equal(custody.reservationId, binding.reservationId, 'CUSTODY_RESERVATION_MISMATCH');
  assert.equal(custody.sourceSha256, binding.sourceSha256, 'SOURCE_CHANGED');
  assert.deepEqual(custody.expected, binding.expected, 'INVENTORY_IDENTITY_CHANGED');
  const lock = path.join(root, 'quarantine.lock');
  // An interrupted process leaves its lock and journal. Never take over a live process.
  if (fs.existsSync(lock)) {
    const owner = json(physical(root, path.join(lock, 'owner.json')));
    assert.equal(owner.requestId, binding.requestId, 'ANOTHER_RECOVERY_OWNS_LOCK');
    let alive = true; try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
    assert.equal(alive, false, 'COORDINATOR_STILL_RUNNING');
    fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock);
  }
  fs.mkdirSync(lock); durable(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, requestId: binding.requestId }));
  try {
    const output = physical(root, path.join(root, 'output'));
    const folder = path.join(root, `quarantine-${binding.requestId}`);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
    physical(root, folder);
    const plan = path.join(folder, 'binding.json');
    if (!fs.existsSync(plan)) durable(plan, JSON.stringify(binding));
    assert.deepEqual(json(physical(root, plan)), binding, 'RECOVERY_BINDING_CHANGED');
    const journal = path.join(folder, 'movements.jsonl');
    if (!fs.existsSync(journal)) durable(journal, '');
    const records = fs.readFileSync(physical(root, journal), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    const append = event => durable(journal, `${JSON.stringify(event)}\n`, 'a');
    const planned = new Map(records.filter(r => r.stage === 'INTENT').map(r => [r.name, r]));
    for (const name of fs.readdirSync(output)) assert.ok(seen.has(name.toLowerCase()), 'UNATTRIBUTED_OUTPUT_FILE');
    const files = [];
    for (const entry of binding.expected) {
      const source = path.join(output, entry.name), destination = path.join(folder, entry.name);
      let intent = planned.get(entry.name);
      if (!intent && !fs.existsSync(source)) continue; // Proven absent in this private, unreleased generation.
      if (!intent) {
        assert.equal(fs.existsSync(destination), false, 'QUARANTINE_DESTINATION_EXISTS');
        const stat = fs.lstatSync(physical(root, source)); assert.ok(stat.isFile() && stat.size > 0 && stat.nlink === 1, 'INVALID_OR_LINKED_PDF_FILE');
        intent = { stage: 'INTENT', name: entry.name, folio: entry.folio, source, destination, size: stat.size, sha256: digest(fs.readFileSync(source)) };
        append(intent);
      }
      assert.equal(intent.source, source); assert.equal(intent.destination, destination); assert.equal(intent.folio, entry.folio);
      if (!fs.existsSync(destination)) {
        assert.ok(fs.existsSync(source), 'SOURCE_AND_QUARANTINE_MISSING');
        physical(root, source);
        assert.equal(digest(fs.readFileSync(source)), intent.sha256, 'SOURCE_CHANGED');
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
        const fd = fs.openSync(destination, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
      physical(root, destination);
      assert.equal(fs.lstatSync(destination).nlink,1,'LINKED_QUARANTINE_FILE');
      assert.equal(fs.statSync(destination).size, intent.size, 'QUARANTINE_SIZE_MISMATCH');
      assert.equal(digest(fs.readFileSync(destination)), intent.sha256, 'QUARANTINE_HASH_MISMATCH');
      append({ stage: 'COPY_VERIFIED', name: entry.name, sha256: intent.sha256 }); fault('after-copy', entry);
      if (fs.existsSync(source)) {
        physical(root, source); assert.equal(fs.lstatSync(source).nlink,1,'LINKED_SOURCE_FILE');
        assert.equal(digest(fs.readFileSync(source)), intent.sha256, 'SOURCE_CHANGED');
        fs.unlinkSync(source); // Completes a journaled move only after exclusive copy + hash verification; never deletes evidence.
      }
      fault('after-move', entry); append({ stage: 'MOVED', name: entry.name, sha256: intent.sha256 });
      files.push({ name: entry.name, folio: entry.folio, originalPath: source, quarantinePath: destination, size: intent.size, sha256: intent.sha256 });
    }
    assert.deepEqual(fs.readdirSync(output), [], 'QUARANTINE_INCOMPLETE');
    const manifest = { version: 'CAT_QUARANTINE_V1', requestId: binding.requestId, reservationId: binding.reservationId,
      sourceSha256: binding.sourceSha256, custody: 'ISOLATED_UNRELEASED', outputClear: true, complete: true, files };
    const text = JSON.stringify(manifest), target = path.join(folder, 'manifest.json');
    if (fs.existsSync(target)) assert.equal(fs.readFileSync(physical(root, target), 'utf8'), text, 'COMPLETED_MANIFEST_CHANGED');
    else durable(target, text);
    fault('after-manifest');
    return { manifest, text, sha256: digest(text), folder };
  } finally { fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); }
}

module.exports = { prepare, digest };
