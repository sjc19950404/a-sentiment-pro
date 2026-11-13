import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorkflows, classifyApiResponse, DISABLED_BY_DESIGN } from '../src/ci_workflow_state.mjs';

test('classifyWorkflows: 全 active → 无报警', () => {
  const r = classifyWorkflows([{ name: 'test-gate', state: 'active' }, { name: 'daily-sentiment', state: 'active' }]);
  assert.equal(r.total, 2);
  assert.equal(r.unexpected.length, 0);
  assert.equal(r.byDesign.length, 0);
});

test('classifyWorkflows: 有意停用的 push-1009-verify 不报警（白名单）', () => {
  const r = classifyWorkflows([{ name: 'push-1009-verify', state: 'disabled_manually' }]);
  assert.equal(r.unexpected.length, 0);
  assert.equal(r.byDesign.length, 1);
  assert.equal(r.byDesign[0].state, 'disabled_manually');
});

test('classifyWorkflows: 未列入白名单的 disabled_inactivity 必须报警（带 name+state）', () => {
  const r = classifyWorkflows([{ name: 'daily-sentiment', state: 'disabled_inactivity' }]);
  assert.equal(r.unexpected.length, 1);
  assert.equal(r.unexpected[0].name, 'daily-sentiment');
  assert.equal(r.unexpected[0].state, 'disabled_inactivity');
});

test('classifyWorkflows: 传入非数组 → total 0、不抛', () => {
  const r = classifyWorkflows(null);
  assert.equal(r.total, 0);
  assert.equal(r.unexpected.length, 0);
});

test('classifyApiResponse: 200 → ok', () => {
  assert.equal(classifyApiResponse(200, { 'x-ratelimit-remaining': '42' }).code, 'ok');
});

test('classifyApiResponse: 403 + remaining 0 → api_unavailable（不是故障也不是正常）', () => {
  assert.equal(classifyApiResponse(403, { 'x-ratelimit-remaining': '0' }).code, 'api_unavailable');
});

test('classifyApiResponse: 429 + remaining 0 → api_unavailable', () => {
  assert.equal(classifyApiResponse(429, { 'x-ratelimit-remaining': '0' }).code, 'api_unavailable');
});

test('classifyApiResponse: 403 但 remaining>0 → api_error（不是限流，真故障）', () => {
  assert.equal(classifyApiResponse(403, { 'x-ratelimit-remaining': '10' }).code, 'api_error');
});

test('classifyApiResponse: 500 → api_error；401 → api_error', () => {
  assert.equal(classifyApiResponse(500, {}).code, 'api_error');
  assert.equal(classifyApiResponse(401, {}).code, 'api_error');
});

test('白名单冻结：push-1009-verify 必须有明确原因', () => {
  assert.ok(DISABLED_BY_DESIGN['push-1009-verify']);
});
