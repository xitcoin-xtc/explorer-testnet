import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNAVAILABLE as NA,
  NOT_APPLICABLE as NAP,
  tokenAmount,
  sharesValue,
  jailedValue,
  unbondingValue,
  estimatedApr,
  textValue,
  websiteLink,
  contactLink,
} from '../src/libs/validatorProfile.ts';
const asset = { base: 'axtc', exponent: '18', symbol: 'XTC' };
test('atomic conversion preserves one axtc, real zero and integers beyond JS precision', () => {
  assert.equal(tokenAmount('1', 'axtc', asset), '0.000000000000000001 XTC');
  assert.equal(tokenAmount('0', 'axtc', asset), '0 XTC');
  assert.equal(
    tokenAmount('5000000005000000000000000', 'axtc', asset),
    '5000000.005 XTC'
  );
  assert.equal(
    tokenAmount('1000000000000000000.12', 'axtc', asset),
    '1.00000000000000000012 XTC'
  );
  assert.equal(
    tokenAmount('1234', 'ucoin', {
      base: 'ucoin',
      exponent: 3,
      symbol: 'COIN',
    }),
    '1.234 COIN'
  );
});
test('missing and malformed amounts never become zero', () => {
  for (const value of [undefined, null, '', 'NaN', '-1', {}, '1e18'])
    assert.equal(tokenAmount(value, 'axtc', asset), NA);
  assert.equal(tokenAmount('1', undefined, asset), NA);
});
test('shares retain their accounting unit and bounded precision', () => {
  assert.equal(sharesValue(undefined), NA);
  assert.equal(sharesValue('0.000000000000000000'), '0 shares');
  assert.equal(sharesValue('123.123456789'), '≈ 123.123457 shares');
  assert.equal(sharesValue('0.000000000000001'), '< 0.000001 shares');
  assert.equal(sharesValue('9.999999999'), '≈ 10 shares');
});
test('bonded and unbonded statuses make unbonding inapplicable', () => {
  for (const status of ['BOND_STATUS_BONDED', 'BOND_STATUS_UNBONDED']) {
    assert.equal(unbondingValue(status, '0', 'height'), NAP);
    assert.equal(unbondingValue(status, '1970-01-01T00:00:00Z', 'time'), NAP);
  }
});
test('active unbonding displays actual height and absolute UTC time', () => {
  const status = 'BOND_STATUS_UNBONDING';
  assert.equal(unbondingValue(status, '123456', 'height'), '123456');
  assert.equal(
    unbondingValue(status, '2026-09-30T12:34:56Z', 'time'),
    '2026-09-30 12:34:56 UTC'
  );
  for (const value of [undefined, '', 'bad', '1970-01-01T00:00:00Z'])
    assert.equal(unbondingValue(status, value, 'time'), NA);
  assert.equal(unbondingValue(status, '0', 'height'), NA);
  assert.equal(unbondingValue(undefined, '0', 'height'), NA);
});
test('jailed is an explicit boolean, not truthiness', () => {
  assert.equal(jailedValue(true), 'Yes');
  assert.equal(jailedValue(false), 'No');
  for (const value of [undefined, null, 'false', 0])
    assert.equal(jailedValue(value), NA);
});
test('APR applies inflation, tax, commission and bonded ratio', () => {
  assert.equal(estimatedApr('0.1', '0.02', '0.1', '200', '1000'), '44.1 %');
  assert.equal(estimatedApr('0', '0.02', '0.1', '200', '1000'), '0 %');
  assert.equal(
    estimatedApr('0.000000001', '0', '0', '200', '1000'),
    '< 0.0001 %'
  );
  for (const values of [
    [undefined, '0', '0', '200', '1000'],
    ['0', '', '0', '200', '1000'],
    ['0', '0', '0', '0', '1000'],
    ['0', '0', '0', '200', '100'],
    ['0', '2', '0', '200', '1000'],
  ])
    assert.equal(estimatedApr(...values), NA);
});
test('official metadata is preserved, absent metadata has no invented fallback', () => {
  assert.equal(textValue(' Official description. '), 'Official description.');
  assert.equal(websiteLink('https://xitcoin.com'), 'https://xitcoin.com');
  assert.equal(
    contactLink('contact@xitcoin.org'),
    'mailto:contact@xitcoin.org'
  );
  for (const value of [null, {}, [], 5, ' '])
    assert.equal(textValue(value), undefined);
});
test('malformed or executable metadata cannot become links', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'https://user:pass@example.org',
    'https://example.org\nx',
  ])
    assert.equal(websiteLink(value), undefined);
  for (const value of [
    'x@y.org?subject=bad',
    'x@y.org\r\nBcc:x@y.org',
    {},
    'not-email',
  ])
    assert.equal(contactLink(value), undefined);
  assert.equal(
    textValue('<script>alert(1)</script>'),
    '<script>alert(1)</script>'
  );
});
