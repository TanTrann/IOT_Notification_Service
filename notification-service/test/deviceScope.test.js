import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deviceScope } from '../src/utils/deviceScope.js';

const user = { deviceIds: new Set(['D1', 'D2']) };

test('không truyền deviceId → mọi cây người dùng có quyền', () => {
  assert.deepEqual(deviceScope(user, undefined), { deviceIds: ['D1', 'D2'] });
  assert.deepEqual(deviceScope(user, ''), { deviceIds: ['D1', 'D2'] });
});

test('deviceId thuộc quyền → chỉ cây đó', () => {
  assert.deepEqual(deviceScope(user, 'D2'), { deviceIds: ['D2'] });
});

test('deviceId ngoài quyền → forbidden', () => {
  assert.deepEqual(deviceScope(user, 'D9'), { forbidden: true });
});
