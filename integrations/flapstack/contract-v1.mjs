import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const contractVersion = 1;
export const diagramTypes = Object.freeze(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);

export class ContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ContractError';
    this.code = code;
  }
}

function requireValue(condition, code = 'receipt/invalid') {
  if (!condition) throw new ContractError(code);
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const digest = (value) => object(value) && typeof value.sha256 === 'string'
  && /^[a-f0-9]{64}$/.test(value.sha256) && count(value.bytes);

// This is a local trust check, not authentication of an untrusted executable.
export function verifyDelivery(stdout, request) {
  requireValue(object(request), 'request/invalid');
  const { exitCode, type, input, output } = request;
  requireValue(diagramTypes.includes(type) && typeof input === 'string' && typeof output === 'string'
    && path.isAbsolute(input) && path.isAbsolute(output) && input !== output, 'request/invalid');
  requireValue(typeof stdout === 'string' && Buffer.byteLength(stdout) <= 1024 * 1024, 'receipt/size');
  let receipt;
  try { receipt = JSON.parse(stdout); } catch { throw new ContractError('receipt/json'); }
  requireValue(object(receipt) && receipt.schemaVersion === 1, 'receipt/version');
  requireValue(receipt.command === 'deliver' && receipt.type === type && receipt.input === input && receipt.output === output, 'receipt/identity');
  requireValue(typeof receipt.ok === 'boolean');
  if (!receipt.ok) {
    requireValue(Number.isInteger(exitCode) && exitCode !== 0 && typeof receipt.stage === 'string');
    requireValue(typeof receipt.error === 'string' && Array.isArray(receipt.diagnostics) && receipt.diagnostics.length > 0);
    requireValue(receipt.diagnostics.every((entry) => object(entry)
      && typeof entry.code === 'string' && entry.code.length > 0
      && ['error', 'warning'].includes(entry.severity) && typeof entry.message === 'string'
      && object(entry.subject) && object(entry.evidence) && Array.isArray(entry.supportedFixes)
      && entry.supportedFixes.every((fix) => typeof fix === 'string')));
    return receipt;
  }
  requireValue(exitCode === 0, 'receipt/exit-status');
  const validation = receipt.validation;
  requireValue(object(validation) && validation.checksPassed === 9 && validation.checkCount === 9
    && validation.compositionProfile === 'showcase' && validation.compositionStatus === 'pass'
    && validation.errors === 0 && validation.warnings === 0, 'receipt/validation');
  requireValue(digest(receipt.specification) && digest(receipt.artifact));
  for (const [file, expected] of [[input, receipt.specification], [output, receipt.artifact]]) {
    let fd;
    try {
      requireValue(fs.lstatSync(file).isFile(), 'artifact/not-regular');
      fd = fs.openSync(file, 'r');
      const stat = fs.fstatSync(fd);
      requireValue(stat.isFile() && stat.size === expected.bytes, 'artifact/size');
      const hash = createHash('sha256');
      const buffer = Buffer.alloc(64 * 1024);
      let bytes = 0;
      while (bytes < expected.bytes) {
        const length = fs.readSync(fd, buffer, 0, Math.min(buffer.length, expected.bytes - bytes), null);
        requireValue(length > 0, 'artifact/changed');
        bytes += length;
        hash.update(buffer.subarray(0, length));
      }
      requireValue(fs.fstatSync(fd).size === expected.bytes && hash.digest('hex') === expected.sha256, 'artifact/digest');
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError('artifact/unreadable');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  return receipt;
}
