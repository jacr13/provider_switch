'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDeepseekRate } = require('../src/deepseek-rate');

test('UTC peak window boundaries', () => {
  for (const [time, expected] of [
    ['00:59:59', 'off-peak'], ['01:00:00', 'peak'], ['03:59:59', 'peak'],
    ['04:00:00', 'off-peak'], ['05:59:59', 'off-peak'], ['06:00:00', 'peak'],
    ['09:59:59', 'peak'], ['10:00:00', 'off-peak'],
  ]) assert.equal(getDeepseekRate(new Date(`2026-10-14T${time}Z`)), expected, time);
});

test('holidays and weekends override peak windows', () => {
  for (const date of ['01-01', '02-16', '02-23', '04-06', '05-05', '06-19', '09-25', '10-01', '10-07', '10-10', '10-11']) {
    assert.equal(getDeepseekRate(new Date(`2026-${date}T02:00:00Z`)), 'off-peak', date);
  }
  assert.equal(getDeepseekRate(new Date('2026-10-08T02:00:00Z')), 'peak');
});

test('uses UTC regardless of supplied timezone', () => {
  assert.equal(getDeepseekRate(new Date('2026-10-14T03:00:00+02:00')), 'peak');
  assert.equal(getDeepseekRate(new Date('2026-10-14T11:00:00+02:00')), 'peak');
});

test('missing holiday year is unknown only during potential peak windows', () => {
  assert.equal(getDeepseekRate(new Date('2027-01-04T02:00:00Z')), 'unknown');
  assert.equal(getDeepseekRate(new Date('2027-01-04T12:00:00Z')), 'off-peak');
  assert.equal(getDeepseekRate(new Date('2027-01-03T02:00:00Z')), 'off-peak');
});
