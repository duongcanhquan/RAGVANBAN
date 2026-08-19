const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  publicUrlForKey,
  objectKeyForFile,
  r2AccountId,
  isR2Configured,
  hasR2Credentials,
} = require('../src/services/r2');

const KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_BASE_URL',
];

const snapshot = {};

beforeEach(() => {
  for (const k of KEYS) snapshot[k] = process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

test('publicUrlForKey nối base + key', () => {
  process.env.R2_PUBLIC_BASE_URL = 'https://pub-abc.r2.dev';
  assert.equal(publicUrlForKey('van-ban/a.pdf'), 'https://pub-abc.r2.dev/van-ban/a.pdf');
});

test('publicUrlForKey bỏ slash cuối và encode segment', () => {
  process.env.R2_PUBLIC_BASE_URL = 'https://files.example.edu.vn/';
  assert.equal(
    publicUrlForKey('van-ban/2026-08-19/a b.pdf'),
    'https://files.example.edu.vn/van-ban/2026-08-19/a%20b.pdf'
  );
});

test('objectKeyForFile nằm thư mục theo ngày', () => {
  const key = objectKeyForFile('ND-123.pdf');
  assert.match(key, /^van-ban\/\d{4}-\d{2}-\d{2}\/\d+-ND-123\.pdf$/);
});

test('r2AccountId nhận ID thuần hoặc S3 endpoint', () => {
  process.env.R2_ACCOUNT_ID = '  abcdef0123456789abcdef0123456789  ';
  assert.equal(r2AccountId(), 'abcdef0123456789abcdef0123456789');
  process.env.R2_ACCOUNT_ID =
    'https://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com';
  assert.equal(r2AccountId(), 'abcdef0123456789abcdef0123456789');
});

test('isR2Configured cần đủ key + URL công khai', () => {
  process.env.R2_ACCOUNT_ID = 'abcdef0123456789abcdef0123456789';
  process.env.R2_ACCESS_KEY_ID = 'aki';
  process.env.R2_SECRET_ACCESS_KEY = 'secret';
  process.env.R2_BUCKET = 'van-ban-goc';
  delete process.env.R2_PUBLIC_BASE_URL;
  assert.equal(hasR2Credentials(), true);
  assert.equal(isR2Configured(), false);
  process.env.R2_PUBLIC_BASE_URL = 'https://pub-abc.r2.dev';
  assert.equal(isR2Configured(), true);
});
