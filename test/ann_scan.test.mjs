import test from 'node:test';
import assert from 'node:assert/strict';
import { scanTitle, scanAnnouncements } from '../src/ann_scan.js';

test('ann_scan: high 级词命中（立案/退市/冻结）', () => {
  assert.equal(scanTitle('关于公司及实际控制人被立案调查的公告').level, 'high');
  assert.deepEqual(scanTitle('关于公司及实际控制人被立案调查的公告').words, ['立案']);
  assert.equal(scanTitle('公司股票可能被实施退市风险警示').level, 'high');
  assert.equal(scanTitle('控股股东所持股份被司法冻结').level, 'high');
});

test('ann_scan: mid 级词命中（减持/质押/问询/预亏）', () => {
  const r = scanTitle('控股股东计划减持不超过2%股份');
  assert.equal(r.level, 'mid');
  assert.deepEqual(r.words, ['减持']);
  assert.equal(scanTitle('关于对上海证券交易所问询函的回复公告').level, 'mid');
  assert.equal(scanTitle('2026年度业绩预亏公告').level, 'mid');
});

test('ann_scan: 异常波动公告整体跳过（连板票人人都有，非风险）', () => {
  const r = scanTitle('股票交易异常波动公告');
  assert.equal(r.level, null);
  assert.equal(r.skipReason, '股票交易异常波动');
});

test('ann_scan: 澄清豁免——mid 命中+澄清 → low；high 不降级', () => {
  assert.equal(scanTitle('关于对问询函的澄清公告').level, 'low');
  assert.equal(scanTitle('关于立案调查的澄清公告').level, 'high', '澄清不了立案');
});

test('ann_scan: scanAnnouncements 汇总——按 high>mid 排序、跳过异常波动不计 scanned', () => {
  const r = scanAnnouncements([
    { code: '600001', name: '甲', announcements: [{ title: '关于控股股东被立案调查的公告' }, { title: '股票交易异常波动公告' }] },
    { code: '600002', name: '乙', announcements: [{ title: '关于部分董监高计划减持的公告' }] },
    { code: '600003', name: '丙', announcements: [{ title: '关于募集资金专户开立的公告' }] },
  ]);
  assert.equal(r.scanned, 3); // 异常波动跳过不计；募集资金公告无风险但计入扫描总数
  assert.equal(r.flagged.length, 2);
  assert.equal(r.flagged[0].level, 'high');
  assert.equal(r.flagged[0].code, '600001');
  assert.equal(r.flagged[1].level, 'mid');
  assert.equal(r.ok, 1); // 扫描过且无风险 = 募集资金公告
});
