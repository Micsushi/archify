import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const writerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/write-deterministic-zip.mjs');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-zip-mode-'));
  const cli = path.join(root, 'archify', 'bin', 'archify.mjs');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, '#!/usr/bin/env node\n');
  fs.chmodSync(cli, 0o755);
  return { root, cli, archive: path.join(root, 'archify.zip') };
}

function runWriter(root, archive) {
  return spawnSync(process.execPath, [writerPath, root, archive], {
    encoding: 'utf8',
  });
}

function archiveMode(archive, expectedName) {
  const bytes = fs.readFileSync(archive);
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === expectedName) {
      return (bytes.readUInt32LE(offset + 38) >>> 16) & 0o7777;
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  return null;
}

test('deterministic ZIP mode handling is portable or fails closed on native Windows', () => {
  const { root, archive } = createFixture();
  const expectedName = 'archify/bin/archify.mjs';
  try {
    if (process.platform === 'win32') {
      const trusted = Buffer.from('trusted archive bytes');
      fs.writeFileSync(archive, trusted);
      const result = runWriter(path.join(root, 'archify'), archive);
      assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /POSIX.*mode|native Windows/i);
      assert.deepEqual(fs.readFileSync(archive), trusted);
    } else {
      const result = runWriter(path.join(root, 'archify'), archive);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(archiveMode(archive, expectedName), 0o755);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
