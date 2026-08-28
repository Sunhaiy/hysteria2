#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { createDecipheriv } = require('node:crypto');
const path = require('node:path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

const encryptedSecretPrefix = 'enc:v1:';

function normalizedUrl(value) {
  return value.trim().replace(/\/+$/, '');
}

function createSecretDecryptor(encodedKey) {
  const trimmedKey = encodedKey?.trim();
  const key = trimmedKey ? Buffer.from(trimmedKey, 'base64') : null;
  if (key && key.length !== 32) {
    throw new Error('SETTINGS_ENCRYPTION_KEY must be 32 bytes in base64');
  }
  return (value) => {
    if (!value || !value.startsWith(encryptedSecretPrefix)) return value;
    if (!key) {
      throw new Error(
        'SETTINGS_ENCRYPTION_KEY is required to verify encrypted Agent secrets',
      );
    }
    const [, , ivValue, tagValue, encryptedValue] = value.split(':');
    if (!ivValue || !tagValue || !encryptedValue) {
      throw new Error('Encrypted Agent secret has an invalid format');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  };
}

function parseInventory(contents) {
  const entries = new Map();
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split('|');
    if (fields.length !== 5) {
      throw new Error(`Inventory line ${index + 1} must contain five fields`);
    }
    const [nodeId, baseUrl, secret, service, expectedStatus] = fields.map(
      (field) => field.trim(),
    );
    if (!/^[A-Za-z0-9_-]+$/.test(nodeId)) {
      throw new Error(`Inventory line ${index + 1} has an invalid node ID`);
    }
    if (!baseUrl || !secret) {
      throw new Error(
        `Inventory line ${index + 1} is missing its URL or secret`,
      );
    }
    if (service !== 'xray' && service !== 'hysteria2') {
      throw new Error(`Inventory line ${index + 1} has an invalid service`);
    }
    if (expectedStatus !== 'active' && expectedStatus !== 'inactive') {
      throw new Error(
        `Inventory line ${index + 1} has an invalid expected status`,
      );
    }
    if (entries.has(nodeId)) {
      throw new Error(`Inventory contains duplicate node ID ${nodeId}`);
    }
    entries.set(nodeId, {
      baseUrl: normalizedUrl(baseUrl),
      secret,
      service,
      expectedStatus,
    });
  }
  return entries;
}

function runtimeTarget(node, decryptSecret = (value) => value) {
  if (node.retiredAt) return null;
  const controlUrl = node.controlApiBaseUrl?.trim() ?? '';
  const storedControlSecret = node.controlApiSecret?.trim() ?? '';
  if (Boolean(controlUrl) !== Boolean(storedControlSecret)) {
    throw new Error(`Node ${node.id} has incomplete runtime Agent credentials`);
  }
  if (controlUrl && storedControlSecret) {
    return {
      baseUrl: normalizedUrl(controlUrl),
      secret: decryptSecret(storedControlSecret),
      service: node.protocol === 'VLESS_REALITY' ? 'xray' : 'hysteria2',
    };
  }
  if (node.protocol === 'VLESS_REALITY') {
    const trafficUrl = node.trafficApiBaseUrl?.trim() ?? '';
    const storedTrafficSecret = node.trafficApiSecret?.trim() ?? '';
    if (!trafficUrl || !storedTrafficSecret) {
      throw new Error(`VLESS node ${node.id} is missing its Agent credentials`);
    }
    return {
      baseUrl: normalizedUrl(trafficUrl),
      secret: decryptSecret(storedTrafficSecret),
      service: 'xray',
    };
  }
  return null;
}

function verifyCoverage(nodes, entries, decryptSecret) {
  const managedNodeIds = new Set();
  for (const node of nodes) {
    const target = runtimeTarget(node, decryptSecret);
    if (!target) continue;
    managedNodeIds.add(node.id);
    const entry = entries.get(node.id);
    if (!entry) {
      throw new Error(`Runtime Agent inventory is missing node ${node.id}`);
    }
    if (entry.baseUrl !== target.baseUrl) {
      throw new Error(`Runtime Agent URL does not match node ${node.id}`);
    }
    if (entry.secret !== target.secret) {
      throw new Error(`Runtime Agent secret does not match node ${node.id}`);
    }
    if (entry.service !== target.service) {
      throw new Error(`Runtime Agent service does not match node ${node.id}`);
    }
    if (target.baseUrl.startsWith('mock://')) {
      throw new Error(`Production node ${node.id} uses a mock runtime Agent`);
    }
  }
  for (const nodeId of entries.keys()) {
    if (!managedNodeIds.has(nodeId)) {
      throw new Error(`Runtime Agent inventory has unknown node ${nodeId}`);
    }
  }
  return managedNodeIds.size;
}

async function main() {
  const inventoryPath = process.argv[2];
  if (!inventoryPath) {
    throw new Error(
      'Usage: verify-runtime-agent-inventory.js <inventory-file>',
    );
  }
  const resolvedPath = path.resolve(inventoryPath);
  const stat = fs.statSync(resolvedPath);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('Runtime Agent inventory permissions must be 0600');
  }

  dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
  const entries = parseInventory(fs.readFileSync(resolvedPath, 'utf8'));
  const decryptSecret = createSecretDecryptor(
    process.env.SETTINGS_ENCRYPTION_KEY,
  );
  const prisma = new PrismaClient();
  try {
    const nodes = await prisma.node.findMany({
      where: { retiredAt: null },
      select: {
        id: true,
        retiredAt: true,
        protocol: true,
        trafficApiBaseUrl: true,
        trafficApiSecret: true,
        controlApiBaseUrl: true,
        controlApiSecret: true,
      },
    });
    const count = verifyCoverage(nodes, entries, decryptSecret);
    process.stdout.write(
      `Runtime Agent inventory covers all ${count} managed node(s).\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createSecretDecryptor,
  normalizedUrl,
  parseInventory,
  runtimeTarget,
  verifyCoverage,
};
