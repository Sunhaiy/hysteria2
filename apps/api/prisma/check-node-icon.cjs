// Local database smoke test: all fixture writes are rolled back.
require('dotenv').config({ quiet: true });
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { validate } = require('class-validator');
const { UpdateNodeDto } = require('../src/contracts/http.dto');
const { NodeControlService } = require('../src/domain/node-control.service');
const { SecretCipherService } = require('../src/security/secret-cipher.service');
assert.equal(new URL(process.env.DATABASE_URL).hostname, '127.0.0.1');
const p = new PrismaClient();
const rollback = new Error('ROLLBACK_NODE_ICON_FIXTURE');
async function main() {
  for (const icon of ['🇺🇸', '⚡', '']) {
    assert.equal((await validate(Object.assign(new UpdateNodeDto(), { icon }))).length, 0);
  }
  for (const icon of ['a\nb', 'x'.repeat(33)]) {
    assert.ok((await validate(Object.assign(new UpdateNodeDto(), { icon }))).length > 0);
  }
  try {
    await p.$transaction(async tx => {
      const cipher = new SecretCipherService();
      cipher.onModuleInit();
      const service = new NodeControlService(tx, cipher);
      const node = await service.createNode({ label: `icon-test-${Date.now()}`, icon: ' 🇺🇸 ', hostname: 'node-icon-test.invalid', port: 59620, allowInsecureTls: false, trafficApiBaseUrl: 'http://127.0.0.1:1', trafficApiSecret: 'fixture-only', active: false, speedUpMbps: 0, speedDownMbps: 0 });
      assert.equal(node.icon, '🇺🇸');
      assert.equal((await service.patchNode(node.id, { speedUpMbps: 10 })).icon, '🇺🇸');
      assert.equal((await service.patchNode(node.id, { icon: '⚡' })).icon, '⚡');
      assert.equal((await service.patchNode(node.id, { icon: '' })).icon, null);
      assert.equal((await tx.node.findUniqueOrThrow({ where: { id: node.id } })).label, node.label);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  console.log('PASS icon validation, persistence, omitted update, replacement, clearing; fixture rolled back');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => p.$disconnect());
