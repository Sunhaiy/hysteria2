'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseInventory,
  runtimeTarget,
  verifyCoverage,
} = require('./verify-runtime-agent-inventory');

const vlessNode = {
  id: 'node_us_reality',
  protocol: 'VLESS_REALITY',
  trafficApiBaseUrl: 'http://10.0.0.8:9010/',
  trafficApiSecret: 'traffic-secret',
  controlApiBaseUrl: null,
  controlApiSecret: null,
};

test('uses the VLESS traffic Agent for runtime control', () => {
  assert.deepEqual(runtimeTarget(vlessNode), {
    baseUrl: 'http://10.0.0.8:9010',
    secret: 'traffic-secret',
    service: 'xray',
  });
});

test('uses the explicit Hysteria2 runtime Agent', () => {
  assert.deepEqual(
    runtimeTarget({
      ...vlessNode,
      id: 'node_us_hysteria2',
      protocol: 'HYSTERIA2',
      controlApiBaseUrl: 'http://10.0.0.8:9010/',
      controlApiSecret: 'control-secret',
    }),
    {
      baseUrl: 'http://10.0.0.8:9010',
      secret: 'control-secret',
      service: 'hysteria2',
    },
  );
});

test('requires an exact inventory row for every managed node', () => {
  const entries = parseInventory(
    'node_us_reality|http://10.0.0.8:9010|traffic-secret|xray|active\n',
  );
  assert.equal(verifyCoverage([vlessNode], entries), 1);
  assert.throws(
    () => verifyCoverage([{ ...vlessNode, id: 'node_missing' }], entries),
    /missing node node_missing/,
  );
});

test('rejects mismatched secrets and stale inventory rows', () => {
  const wrongSecret = parseInventory(
    'node_us_reality|http://10.0.0.8:9010|wrong|xray|active\n',
  );
  assert.throws(
    () => verifyCoverage([vlessNode], wrongSecret),
    /secret does not match/,
  );
  const stale = parseInventory(
    'node_old|http://10.0.0.9:9010|secret|xray|inactive\n',
  );
  assert.throws(() => verifyCoverage([], stale), /unknown node node_old/);
});
