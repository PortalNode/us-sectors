#!/usr/bin/env node
// اختبار سلامة data.json: مخطط سليم، أسعار موجبة، قطاعات مغطاة، ولا مؤشرات فارغة.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');
const data = JSON.parse(readFileSync(join(distDir, 'data.json'), 'utf8'));

test('data.json basic schema', () => {
  assert.ok(Array.isArray(data.sectors) && data.sectors.length >= 5);
  assert.ok(data.priceDate && /^\d{4}-\d{2}-\d{2}$/.test(data.priceDate));
  assert.ok(data.marketSummary && data.marketSummary.value > 0);
  assert.ok(data.priceSource && data.priceSource.checkedAt);
});

test('exactly 200 companies', () => {
  const count = data.sectors.reduce((n, s) => n + s.stocks.length, 0);
  assert.equal(count, 200);
});

test('each stock has required fields', () => {
  for (const stock of data.sectors.flatMap(s => s.stocks)) {
    assert.ok(stock.symbol && String(stock.symbol).length >= 1, `symbol missing`);
    assert.ok(stock.name && stock.name.length >= 2, `name missing for ${stock.symbol}`);
    assert.ok(stock.price == null || stock.price > 0, `bad price for ${stock.symbol}`);
    assert.ok(stock.marketCap == null || stock.marketCap > 0, `bad marketCap for ${stock.symbol}`);
    assert.ok(stock.symbolFull, `symbolFull missing for ${stock.symbol}`);
  }
});

test('no duplicate tickers', () => {
  const symbols = data.sectors.flatMap(s => s.stocks.map(st => st.symbol));
  assert.equal(new Set(symbols).size, symbols.length);
});

test('traded value present for the session', () => {
  const missing = data.sectors.flatMap(s => s.stocks).filter(st => st.tradedValue == null).length;
  assert.ok(missing <= 20, `tradedValue missing for ${missing} stocks`);
});

test('financial map snapshot exists', () => {
  const map = JSON.parse(readFileSync(join(distDir, 'financial-map.json'), 'utf8'));
  assert.ok(map.snapshot && Object.keys(map.snapshot).length >= 150);
});
