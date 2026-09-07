import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyDelivery, ContractError } from '../../integrations/flapstack/contract-v1.mjs';

const skill = fileURLToPath(new URL('../', import.meta.url));
test('Flapstack v1 rejects invalid caller requests without native exceptions', () => {
  for (const request of [undefined, null, [], {}, { type: 'architecture' },
    { type: 'architecture', input: 42, output: '/' }]) {
    assert.throws(() => verifyDelivery('{}', request), { name: 'ContractError', code: 'request/invalid' });
  }
});

for (const [type, fixture] of [
  ['workflow', 'agent-tool-call.workflow.json'],
  ['sequence', 'cache-miss-request.sequence.json'],
  ['dataflow', 'product-analytics.dataflow.json'],
  ['lifecycle', 'agent-run.lifecycle.json'],
]) {
  test(`Flapstack v1 verifies real ${type} delivery`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-flapstack-'));
    try {
      const input = path.join(root, 'source.json');
      const output = path.join(root, 'diagram.html');
      fs.copyFileSync(path.join(skill, 'examples', fixture), input);
      const result = spawnSync(process.execPath, [path.join(skill, 'bin/archify.mjs'),
        'deliver', type, input, output, '--quality', 'showcase', '--json'],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      assert.ifError(result.error);
      assert.equal(verifyDelivery(result.stdout, { exitCode: result.status, type, input, output }).ok, true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test('Flapstack v1 verifies real delivery and rejects corrupt, stale, or contradictory receipts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-flapstack-'));
  try {
    const input = path.join(root, 'source with spaces.json');
    const output = path.join(root, 'output with spaces.html');
    fs.copyFileSync(path.join(skill, 'examples/web-app.architecture.json'), input);
    const run = () => spawnSync(process.execPath, [path.join(skill, 'bin/archify.mjs'), 'deliver', 'architecture', input, output, '--quality', 'showcase', '--json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const result = run();
    const request = { exitCode: result.status, type: 'architecture', input, output };
    const receipt = verifyDelivery(result.stdout, request);
    assert.equal(receipt.ok, true);
    for (const mutate of [
      (r) => { r.schemaVersion = 2; },
      (r) => { r.type = 'workflow'; },
      (r) => { r.output = input; },
      (r) => { r.validation.warnings = 1; },
      (r) => { r.validation.checkCount = 4; },
      (r) => { r.artifact.sha256 = '0'.repeat(64); },
    ]) {
      const changed = structuredClone(receipt);
      mutate(changed);
      assert.throws(() => verifyDelivery(JSON.stringify(changed), request), ContractError);
    }
    assert.throws(() => verifyDelivery(result.stdout, { ...request, exitCode: null }), /receipt\/exit-status/);
    assert.throws(() => verifyDelivery('noise' + result.stdout, request), /receipt\/json/);
    assert.throws(() => verifyDelivery(' '.repeat(1024 * 1024 + 1), request), /receipt\/size/);
    const trusted = fs.readFileSync(output);
    const corrupt = Buffer.from(trusted);
    corrupt[0] ^= 1;
    fs.writeFileSync(output, corrupt);
    assert.throws(() => verifyDelivery(result.stdout, request), /artifact\/digest/);
    fs.writeFileSync(output, trusted);
    fs.writeFileSync(input, '{invalid');
    assert.throws(() => verifyDelivery(result.stdout, request), ContractError);
    const failed = run();
    assert.equal(verifyDelivery(failed.stdout, { ...request, exitCode: failed.status }).ok, false);
    assert.deepEqual(fs.readFileSync(output), trusted);
    assert.throws(() => verifyDelivery(failed.stdout, { ...request, exitCode: 0 }), ContractError);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
