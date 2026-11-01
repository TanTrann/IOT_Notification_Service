import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createUserAuth } from '../src/middlewares/userAuth.js';

function run(middleware, headers, access) {
  return new Promise((resolve) => {
    const req = { headers };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ req, status: this.statusCode, body, nextCalled: false }); },
    };
    middleware(req, res, () => resolve({ req, status: null, body: null, nextCalled: true }));
  });
}

const OK = { status: 'ok', userId: 'u1', email: 'a@x', exp: 2000000000, devices: [], deviceIds: new Set() };
const resolverReturning = (value) => async () => value;

test('thiếu Authorization → 401', async () => {
  const r = await run(createUserAuth(resolverReturning(OK)), {});
  assert.equal(r.status, 401);
  assert.equal(r.nextCalled, false);
});

test('Authorization không phải Bearer → 401', async () => {
  const r = await run(createUserAuth(resolverReturning(OK)), { authorization: 'Basic abc' });
  assert.equal(r.status, 401);
});

test('Phong báo token không hợp lệ → 401', async () => {
  const r = await run(createUserAuth(resolverReturning({ status: 'unauthorized' })), { authorization: 'Bearer t' });
  assert.equal(r.status, 401);
});

test('không gọi được Phong → 503', async () => {
  const r = await run(createUserAuth(resolverReturning({ status: 'unavailable' })), { authorization: 'Bearer t' });
  assert.equal(r.status, 503);
  assert.equal(r.body.message, 'Không xác thực được với server Phong');
});

test('token hợp lệ → next(), gắn req.user và req.jwt', async () => {
  let seen;
  const r = await run(createUserAuth(async (jwt) => { seen = jwt; return OK; }), { authorization: 'Bearer tok123' });
  assert.equal(r.nextCalled, true);
  assert.equal(seen, 'tok123');
  assert.equal(r.req.jwt, 'tok123');
  assert.equal(r.req.user.userId, 'u1');
  assert.equal(r.req.user.status, undefined);
});
