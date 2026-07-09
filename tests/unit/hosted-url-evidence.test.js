const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hostedUrlFailure,
  isLocalOrPrivateUrl,
  isPlaceholderHostedUrl,
} = require('../../lib/task-platform/hosted-url-evidence');

test('hosted URL evidence rejects malformed, local, private, and placeholder URLs', () => {
  assert.equal(hostedUrlFailure('url', 'not-a-url'), 'url must be a valid http(s) URL');
  assert.equal(hostedUrlFailure('url', 'http://127.0.0.1:13000'), 'url must be hosted and non-local');
  assert.equal(hostedUrlFailure('url', 'http://10.0.0.5'), 'url must be hosted and non-local');
  assert.equal(hostedUrlFailure('url', 'http://[fd00::1]'), 'url must be hosted and non-local');
  assert.equal(hostedUrlFailure('url', 'http://[fe80::1]'), 'url must be hosted and non-local');
  assert.equal(hostedUrlFailure('url', 'http://[::]'), 'url must be hosted and non-local');
  assert.equal(hostedUrlFailure('url', 'https://factory.example.test'), 'url must not use placeholder or reserved domains');
  assert.equal(hostedUrlFailure('url', 'https://api.example.com'), 'url must not use placeholder or reserved domains');
  assert.equal(hostedUrlFailure('url', 'https://factory-staging.openclaw.app'), null);
  assert.equal(hostedUrlFailure('url', 'https://[2001:4860:4860::8888]'), null);
});

test('hosted URL evidence exposes specific URL classifiers', () => {
  assert.equal(isLocalOrPrivateUrl('https://factory-staging.openclaw.app'), false);
  assert.equal(isLocalOrPrivateUrl('http://192.168.1.10'), true);
  assert.equal(isLocalOrPrivateUrl('http://[::1]'), true);
  assert.equal(isLocalOrPrivateUrl('http://[fd12:3456::1]'), true);
  assert.equal(isLocalOrPrivateUrl('https://[2001:4860:4860::8888]'), false);
  assert.equal(isPlaceholderHostedUrl('https://factory-staging.engineering-team.io'), false);
  assert.equal(isPlaceholderHostedUrl('https://service.invalid'), true);
});
