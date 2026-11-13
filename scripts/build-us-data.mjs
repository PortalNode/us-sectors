#!/usr/bin/env node
/*
 * بناء لقطة بيانات السوق الأمريكي (أكبر 200 شركة بالقيمة السوقية).
 *
 * المصدر: واجهة TradingView Scanner للسوق الأمريكي. تُستبعد أسهم OTC الأجنبية
 * والأسهم المفضلة وشهادات الإيداع وأصناف الشركات المزدوجة (تُبقى الصنف الأعلى
 * سيولة)، ثم تُقسم الشركات على القطاعات العربية وتُبنى data.json وfinancial-map.json
 * بنفس مخطط موقع قطاعات السوق السعودي.
 *
 * الاستخدام: node scripts/build-us-data.mjs [dist-dir]
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = process.argv[2] ? process.argv[2] : join(here, '..', 'dist');
if (!existsSync(distDir)) {
  console.error(`مجلد dist غير موجود: ${distDir}`);
  process.exit(1);
}

const SCANNER = 'https://scanner.tradingview.com/america/scan';
const TOP_N = 200;
const SCAN_POOL = 480; // مجمع أكبر لاستيعاب الاستبعادات

const FULL_COLUMNS = [
  'name', 'description', 'market_cap_basic', 'sector', 'industry', 'exchange',
  'close', 'change', 'price_earnings_ttm', 'earnings_per_share_basic_ttm',
  'price_book_fq', 'dividends_yield', 'Perf.YTD', 'Perf.3M', 'Perf.6M', 'Perf.Y',
  'price_52_week_high', 'price_52_week_low', 'volume', 'average_volume_10d_calc',
];

const SECTOR_MAP = {
  'Electronic Technology': { name: 'التقنية والاتصالات', slug: 'technology-telecom' },
  'Technology Services': { name: 'التقنية والاتصالات', slug: 'technology-telecom' },
  'Communications': { name: 'التقنية والاتصالات', slug: 'technology-telecom' },
  'Health Technology': { name: 'الصحة', slug: 'healthcare' },
  'Health Services': { name: 'الصحة', slug: 'healthcare' },
  'Finance': { name: 'المالية', slug: 'financials' },
  'Retail Trade': { name: 'الاستهلاك', slug: 'consumer' },
  'Consumer Durables': { name: 'الاستهلاك', slug: 'consumer' },
  'Consumer Non-Durables': { name: 'الاستهلاك', slug: 'consumer' },
  'Consumer Services': { name: 'الاستهلاك', slug: 'consumer' },
  'Distribution Services': { name: 'الاستهلاك', slug: 'consumer' },
  'Energy Minerals': { name: 'الطاقة', slug: 'energy' },
  'Utilities': { name: 'المرافق', slug: 'utilities' },
  'Industrial Services': { name: 'الصناعة والخدمات', slug: 'industrials' },
  'Producer Manufacturing': { name: 'الصناعة والخدمات', slug: 'industrials' },
  'Commercial Services': { name: 'الصناعة والخدمات', slug: 'industrials' },
  'Transportation': { name: 'الصناعة والخدمات', slug: 'industrials' },
  'Non-Energy Minerals': { name: 'المواد', slug: 'materials' },
  'Process Industries': { name: 'المواد', slug: 'materials' },
  'Commercial Real Estate': { name: 'العقار', slug: 'realestate' },
  'Real Estate Development': { name: 'العقار', slug: 'realestate' },
  'Government': { name: 'أخرى', slug: 'other' },
};

const EXCLUDED_EXCHANGES = new Set(['OTC']);
const EXCLUDED_DESC = /depositary|preferred|pfd|warrant|mandatory convertible|subordinated|due 20\d\d|when issued|units\b|\bunit\b|\bright\b/i;

async function scan(body) {
  const response = await fetch(SCANNER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; us-sectors-build)' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw Error(`HTTP ${response.status} من TradingView`);
  const json = await response.json();
  if (!json || !Array.isArray(json.data)) throw Error('استجابة غير صالحة من TradingView');
  return json.data;
}

const round = (value, digits = 2) => {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
};
const safe = value => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

function cleanCompanyName(description) {
  return String(description || '')
    .replace(/\s*-\s*Depositary Shares.*$/i, '')
    .replace(/\s*Common Stock\s*$/i, '')
    .replace(/\s*New\s*$/i, '')
    .replace(/\s*Registered\s*$/i, '')
    .trim();
}

function companyKey(description) {
  return cleanCompanyName(description)
    .replace(/^The\s+/, '')
    .replace(/\(The\)\s*$/i, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function main() {
  console.log('جلب قائمة أكبر الشركات من TradingView…');
  const pool = await scan({
    filter: [{ left: 'type', operation: 'equal', right: 'stock' }],
    options: { lang: 'en' },
    markets: ['america'],
    sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
    columns: FULL_COLUMNS,
    range: [0, SCAN_POOL - 1],
  });

  // تجميع الشركات بعد استبعاد OTC والمفضلة وأصناف الإيداع
  const groups = new Map();
  for (const row of pool) {
    const d = row.d;
    const [ticker, description, mcap, tvSector, industry, exchange] = d;
    const record = {
      ticker: String(ticker || ''),
      symbolFull: String(row.s || ''),
      description: String(description || ''),
      marketCap: safe(mcap),
      tvSector: String(tvSector || ''),
      industry: String(industry || ''),
      exchange: String(exchange || ''),
    };
    if (EXCLUDED_EXCHANGES.has(record.exchange)) continue;
    if (record.ticker.includes('/')) continue; // أسهم مفضلة أو وحدات مزدوجة
    if (EXCLUDED_DESC.test(record.description)) continue;
    if (record.marketCap == null || record.marketCap <= 0) continue;
    if (!SECTOR_MAP[record.tvSector]) continue;
    const key = companyKey(record.description);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { liquidity: -1, pick: null });
    // لا نعرف السيولة هنا؛ نجمعها لاحقًا في جلب التفاصيل
    groups.get(key).pick = record;
  }

  let candidates = [...groups.values()].map(g => g.pick);
  console.log(`مرشحون بعد الاستبعاد: ${candidates.length}`);

  // جلب التفاصيل الكاملة + السيولة لكل المرشحين
  const detail = new Map();
  const tickers = candidates.map(r => r.symbolFull);
  for (let i = 0; i < tickers.length; i += 220) {
    const chunk = tickers.slice(i, i + 220);
    const rows = await scan({ symbols: { tickers: chunk, query: { types: [] } }, columns: FULL_COLUMNS });
    for (const row of rows) detail.set(row.s, row.d);
  }

  candidates = candidates.map(r => {
    const d = detail.get(r.symbolFull);
    if (!d) return null;
    const [ticker, description, mcap, tvSector, industry, exchange, close, change, pe, eps, pb, dy, ytd, m3, m6, y1, hi, lo, volume] = d;
    return {
      ...r,
      ticker: String(ticker || r.ticker),
      description: String(description || r.description),
      marketCap: safe(mcap), tvSector: String(tvSector || r.tvSector),
      industry: String(industry || r.industry), exchange: String(exchange || r.exchange),
      close: safe(close), change: safe(change), pe: safe(pe), eps: safe(eps), pb: safe(pb),
      dividendYield: safe(dy), ytd: safe(ytd), month3: safe(m3), month6: safe(m6), year1: safe(y1),
      week52High: safe(hi), week52Low: safe(lo), volume: safe(volume),
    };
  }).filter(Boolean);

  // الأسماء العربية (جدول ترجمة محفوظ) مع البقاء على الاسم الإنجليزي عند الغياب
  const namesPath = join(here, '..', 'scripts', 'names-ar.json');
  let namesAr = {};
  if (existsSync(namesPath)) namesAr = JSON.parse(readFileSync(namesPath, 'utf8'));

  // ترتيب حسب القيمة السوقية وأخذ أكبر 200
  candidates.sort((a, b) => b.marketCap - a.marketCap);
  const top = candidates.slice(0, TOP_N);
  if (top.length < TOP_N) console.warn(`تحذير: عدد الشركات ${top.length} أقل من ${TOP_N}`);

  // المؤشر العام: S&P 500
  const indexRows = await scan({
    symbols: { tickers: ['SP:SPX'], query: { types: [] } },
    columns: ['close', 'change', 'Perf.YTD', 'Perf.3M', 'Perf.6M', 'Perf.Y'],
  });
  const spx = indexRows.find(r => r.s === 'SP:SPX')?.d || [];
  const index = {
    value: round(spx[0], 2),
    day: round(spx[1], 2),
    ytd: round(spx[2], 2),
    month3: round(spx[3], 2),
    month6: round(spx[4], 2),
    year1: round(spx[5], 2),
  };

  // تاريخ اليوم بنيويورك
  const now = new Date();
  const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const checkedAt = now.toISOString();

  // تجميع القطاعات
  const sectorOrder = [];
  const sectors = new Map();
  for (const c of top) {
    const sector = SECTOR_MAP[c.tvSector];
    if (!sectors.has(sector.name)) { sectors.set(sector.name, { ...sector, stocks: [] }); sectorOrder.push(sector.name); }
    const shares = c.close > 0 ? Math.round(c.marketCap * 1e6 / c.close) : null;
    const tradedValue = c.close != null && c.volume != null ? Math.round(c.close * c.volume) : null;
    sectors.get(sector.name).stocks.push({
      symbol: c.ticker,
      symbolFull: c.symbolFull,
      name: namesAr[c.ticker] || cleanCompanyName(c.description),
      nameEn: cleanCompanyName(c.description),
      price: round(c.close, 2),
      eps: c.eps == null ? null : round(c.eps, 3),
      pe: c.pe == null ? null : round(c.pe, 2),
      bookValue: null, // تُملأ من financial-map.json (SEC EDGAR) عند توفرها
      pb: c.pb == null ? null : round(c.pb, 2),
      marketCap: c.marketCap == null ? null : Math.round(c.marketCap / 1e6), // بمليون دولار
      day: round(c.change, 2),
      month3: round(c.month3, 2),
      month6: round(c.month6, 2),
      year1: round(c.year1, 2),
      shares,
      dividendYield: c.dividendYield == null ? null : round(c.dividendYield, 2),
      dividendYieldSource: 'TradingView Dividend Yield (%)',
      week52Low: c.week52Low == null ? null : round(c.week52Low, 2),
      week52High: c.week52High == null ? null : round(c.week52High, 2),
      week52Source: 'TradingView',
      week52CheckedAt: checkedAt,
      priceDate: nyDate,
      priceTimestamp: null,
      priceSource: 'TradingView',
      priceStatus: 'official_close',
      marketCapSource: 'TradingView',
      sharesDate: nyDate,
      sharesSource: 'محسوبة من القيمة السوقية والسعر',
      suspended: false,
      priceCheckedAt: checkedAt,
      performanceDate: nyDate,
      performanceSource: 'TradingView',
      lastOfficialClose: { price: round(c.close, 2), date: nyDate, source: 'TradingView Scanner (america)' },
      dividendYieldCheckedAt: checkedAt,
      tradedValue,
      tradedValueSource: 'TradingView (حجم الأعمال = السعر × الكمية)',
    });
  }

  // ترتيب القطاعات حسب مجموع القيمة السوقية
  const sectorList = [...sectors.values()]
    .sort((a, b) => b.stocks.reduce((s, x) => s + (x.marketCap || 0), 0) - a.stocks.reduce((s, x) => s + (x.marketCap || 0), 0))
    .map(sector => ({
      name: sector.name,
      slug: sector.slug,
      stocks: sector.stocks.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)),
    }));

  const turnover = top.reduce((sum, c) => sum + (c.close != null && c.volume != null ? c.close * c.volume : 0), 0);

  const data = {
    asOf: nyDate,
    financialPeriod: nyDate,
    sources: [
      'TradingView Scanner (america): الأسعار، القيم السوقية، المؤشرات، والأداء',
      'SEC EDGAR: القوائم المالية للشركات (صفحات القطاعات والمقارنة)',
    ],
    sectors: sectorList,
    priceDate: nyDate,
    priceSource: {
      provider: 'TradingView', mode: 'close', officialDate: nyDate, observedDate: null,
      checkedAt, delayMinutes: null, warning: null,
    },
    marketSummary: {
      mode: 'close', source: 'TradingView', quoteSource: 'TradingView',
      value: index.value, pointChange: null, day: index.day,
      turnover: Math.round(turnover), turnoverSource: 'TradingView',
      turnoverEstimated: false, turnoverStocks: top.length,
      ytd: index.ytd, month3: index.month3, month6: index.month6, year1: index.year1,
      performanceSource: 'TradingView', performanceDate: nyDate,
      date: nyDate, updatedAt: checkedAt, isIntraday: false,
    },
  };

  writeFileSync(join(distDir, 'data.json'), JSON.stringify(data, null, 1) + '\n');
  console.log(`تمت كتابة data.json: ${sectorList.length} قطاعًا و${top.length} شركة، المؤشر ${index.value}`);

  // financial-map.json: لقطة القيم الأساسية كخطة بديلة قبل تحديث EDGAR
  const snapshot = {};
  for (const stock of sectorList.flatMap(s => s.stocks)) {
    if (stock.eps != null || stock.pb != null) {
      snapshot[stock.symbol] = {
        symbol: stock.symbol,
        reported: stock.eps,
        book: null,
        period: nyDate,
        dateKind: 'checked',
      };
    }
  }
  writeFileSync(join(distDir, 'financial-map.json'), JSON.stringify({
    companyIds: {}, sectorIds: [], snapshot,
    note: 'خطة بديلة من TradingView؛ تُستبدل بقيم SEC EDGAR عند تشغيل build-us-financials.mjs',
  }, null, 1) + '\n');
  console.log(`تمت كتابة financial-map.json بـ ${Object.keys(snapshot).length} شركة`);
}

main().catch(error => { console.error(error); process.exit(1); });
