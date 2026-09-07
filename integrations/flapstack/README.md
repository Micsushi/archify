# Flapstack delivery contract v1

Archify generates validated HTML diagrams from authored JSON. This integration
does not add a database, task tracker, live topology discovery, or a Flapstack
runtime dependency. Flapstack code is not changed by this adapter.

Use a pinned Archify checkout and Node.js 18 or newer. The repository's CI tests
Node 18, 20, 22, and 24. The adapter has no npm dependencies and lives outside the
downloadable skill ZIP; vendor this directory with its MIT license or import it
from your pinned checkout. Run `node --test archify/test/flapstack-contract.test.mjs`
from the repository root to check compatibility.

## Invocation

Use the Node executable and an argument array, never interpolate paths into a
shell command. Resolve trusted input and output paths before invoking the CLI:

```js
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { verifyDelivery } from './contract-v1.mjs';

const input = path.resolve('diagram.architecture.json');
const output = path.resolve('diagram.html');
const type = 'architecture';
const result = spawnSync(process.execPath, [
  path.resolve('archify/bin/archify.mjs'),
  'deliver', type, input, output, '--quality', 'showcase', '--json',
], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (result.error || result.signal) throw new Error('Archify process failed');
const receipt = verifyDelivery(result.stdout, {
  exitCode: result.status, type, input, output,
});
if (!receipt.ok) {
  // Display diagnostics as text. Do not automatically execute suggested fixes.
  throw new Error(receipt.error);
}
// Only now offer the validated artifact to the user.
```

Run synchronous work in a background worker, not a UI event loop. A production
host should use asynchronous process orchestration with bounded output, its own
concurrency limit, cancellation, and process-tree cleanup appropriate to its OS.
After timeout or termination, outcome is unknown: an existing child may still
finish delivery. Reconcile output before retrying; do not blindly overwrite it.

## Accepted receipt

`verifyDelivery(stdout, request)` returns the parsed receipt or throws
`ContractError` with a stable `code`. It requires one JSON value within 1 MiB,
`schemaVersion: 1`, `command: "deliver"`, and exact request type/path identity.
Supported types are architecture, workflow, sequence, dataflow, and lifecycle.

Success requires exit status zero, all nine checks passing at showcase quality,
zero errors and warnings, and SHA-256/byte-count matches for both current input
and delivered output. A missing file, a final-path symlink, changed bytes, or a
contradictory receipt fails closed. Hashing uses a fixed-size buffer.

A failure receipt requires a nonzero exit status, a stage, an error, and structured
diagnostics (`code`, `severity`, `message`, `subject`, `evidence`, `supportedFixes`).
Failure returns `ok: false`; it is not successful delivery. Malformed CLI usage
may produce plain stderr instead and therefore cannot pass receipt verification.

Error code families are `request/invalid`, `receipt/*`, and `artifact/*`. Treat
unknown codes as failures. Optional/additive receipt fields are preserved.

## Safety, privacy, and recovery

The executable, input directories, and output directories must be trusted. This
verifier is not authentication, a sandbox, or protection against concurrent
malicious filesystem changes. Reserve a unique workspace per job and prohibit
concurrent edits until verification finishes. Do not let a user choose arbitrary
filesystem paths. Do not assume a hash proves authored topology is live evidence.

Archify stages delivery and preserves an existing output on validation failure.
Keep independent backups/version history for successful overwrites. The host owns
retention, access control, quotas, job identifiers, and recovery policy. Do not
log full specs or diagnostics by default: paths and authored content can be
sensitive. Remote brand assets may require network access; disabling update
checks is not a network sandbox. Apply host network controls where privacy
requires offline execution and use local/bundled marks.

Serve HTML only through a deliberately isolated viewer. Receipt validation is
not a replacement for the host's content isolation and URL policy.

## Compatibility and migration

Contract v1 targets the delivery receipt in Archify 2.16.0. Pin the repository
revision in your dependency configuration, run these tests before upgrading, and
retain the previous revision for rollback. A different receipt schema version,
check count, or quality profile is rejected until explicitly reviewed. Do not
silently downgrade showcase quality or skip digest checks after an upgrade.
Workflow source-schema migration remains the CLI's existing migration workflow;
it is independent of this receipt contract. No persisted host data is migrated
by this adapter.

## Local verification

From the repository root, run the focused host boundary and renderer checks:

```sh
node --test archify/test/flapstack-contract.test.mjs archify/test/delivery-contract.test.mjs archify/test/render-output-checks.test.mjs
```

For the complete repository gate, run `npm ci --prefix archify`, then
`npm test --prefix archify`. Keep the checkout's LF line endings. Canonical ZIP
builds require Node 22 and the existing Bash build script. The wider suite also
uses `unzip`, Unix signal/permission behavior, symlink creation, and temporary Git
repositories. Missing Windows symlink privileges or local Git identity policies
can block those tests; do not disable access controls or Git hooks to obtain a
green result. Report unavailable platform coverage separately from the focused
delivery result. A passing focused gate does not certify the entire repository.
