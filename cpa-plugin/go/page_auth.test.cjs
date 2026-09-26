const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
const start = html.indexOf('    function managementKey() {');
const end = html.indexOf('    async function api(', start);
assert.ok(start >= 0 && end > start, 'managementKey() must exist in embedded HTML');
const source = html.slice(start, end) + '\nmanagementKey();';
const host = 'panel.example.test';
const agent = 'test-agent';

function encode(value, version) {
  const salt = version === 'v2'
    ? `cli-proxy-api-webui::secure-storage|v2|${host}`
    : `cli-proxy-api-webui::secure-storage|${host}|${agent}`;
  const data = Buffer.from(JSON.stringify(value));
  const key = Buffer.from(salt);
  const out = Buffer.from(data.map((byte, index) => byte ^ key[index % key.length]));
  return `enc::${version}::${out.toString('base64')}`;
}
function readKey(entries) {
  return vm.runInNewContext(source, {
    localStorage: {getItem: (name) => entries[name] || null},
    location: {host}, navigator: {userAgent: agent},
    TextEncoder, TextDecoder, atob,
  });
}

test('CPAMP v2 persisted Zustand state beats stale legacy credentials', () => {
  assert.equal(readKey({
    'authToken': 'stale', 'managementKey': encode('also-stale', 'v1'),
    'cli-proxy-auth': encode({state: {managementKey: 'current'}, version: 0}, 'v2'),
  }), 'current');
});
test('v1 still works if current state is absent', () => {
  assert.equal(readKey({'managementKey': encode('legacy', 'v1')}), 'legacy');
});
test('plain stored object remains compatible', () => {
  assert.equal(readKey({'cli-proxy-auth': JSON.stringify({state: {managementKey: 'plain'}})}), 'plain');
});
test('unknown or malformed encrypted values never become bearer keys', () => {
  for (const raw of ['enc::v3::AAAA', 'enc::v2::not-base64!', 'enc::v2::', encode('bad', 'v2').slice(0, -3)]) {
    assert.equal(readKey({'cli-proxy-auth': raw}), '', raw);
  }
});
test('no remembered key fails closed even when a stale legacy key remains', () => {
  assert.equal(readKey({
    'cli-proxy-auth': encode({state: {rememberPassword: false}, version: 0}, 'v2'),
    'managementKey': 'stale',
  }), '');
});
