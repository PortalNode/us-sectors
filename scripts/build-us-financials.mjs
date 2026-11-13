#!/usr/bin/env node
/*
 * بناء ملفات النتائج المالية السنوية للقطاعات من SEC EDGAR.
 *
 * يقرأ dist/data.json (للحصول على الشركات والقطاعات)، ثم يجلب companyfacts
 * لكل شركة من data.sec.gov، ويستخرج القوائم السنوية (10-K / 20-F) لآخر 5 سنوات
 * مالية، ويكتب dist/<slug>-financials.json لكل قطاع ويحدّث dist/financial-map.json
 * (ربحية السهم المخفضة والأساسية والقيمة الدفترية للسهم).
 *
 * تقييد المعدل: SEC يسمح بـ 10 طلبات/دقيقة لكل IP بدون User-Agent مناسب؛
 * نستخدم User-Agent واضحًا وثمّة فاصل قصير بين الطلبات.
 *
 * الاستخدام: SEC_USER_AGENT="name email" node scripts/build-us-financials.mjs [dist-dir] [limit]
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = process.argv[2] ? process.argv[2] : join(here, '..', 'dist');
const limitArg = Number(process.argv[3] ?? 0);
const USER_AGENT = process.env.SEC_USER_AGENT || 'us-sectors-site (contact: admin@example.com)';
if (!existsSync(distDir)) {
  console.error(`مجلد dist غير موجود: ${distDir}`);
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = (value, digits = 2) => (value == null || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(digits)));

// خرائط وسوم XBRL المقبولة لكل بند (us-gaap ثم ifrs-full كبديل)
const TAGS = {
  revenue: { usGaap: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'], ifrs: ['Revenue'] },
  grossIncome: { usGaap: ['GrossProfit'], ifrs: ['GrossProfit'] },
  operatingIncome: { usGaap: ['OperatingIncomeLoss'], ifrs: ['ProfitLossFromOperatingActivities'] },
  netProfit: { usGaap: ['NetIncomeLoss', 'ProfitLoss'], ifrs: ['ProfitLoss'] },
  dilutedEps: { usGaap: ['EarningsPerShareDiluted'], ifrs: ['BasicEarningsOrLossPerShare', 'EarningsPerShareDiluted'] },
  basicEps: { usGaap: ['EarningsPerShareBasic'], ifrs: ['BasicEarningsOrLossPerShare'] },
  assets: { usGaap: ['Assets'], ifrs: ['Assets'] },
  equity: { usGaap: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'], ifrs: ['Equity'] },
};

const YEARS_COUNT = 5;

function extractAnnual(facts, conceptTags, { scale = 1 } = {}) {
  // يعيد خريطة سنة -> قيمة سنوية (يفضّل أحدث ملف)
  const out = new Map();
  for (const namespace of ['us-gaap', 'ifrs-full']) {
    const unitBuckets = facts?.facts?.[namespace] || {};
    for (const tag of conceptTags[namespace === 'us-gaap' ? 'usGaap' : 'ifrs'] || []) {
      const concept = unitBuckets[tag];
      if (!concept) continue;
      for (const [unitKey, units] of Object.entries(concept.units || {})) {
        // نقبل الدولار الأمريكي فقط: المال بوحدة USD وربحية السهم بوحدة USD/shares،
        // حتى لا تختلط التقارير بالدولار الكندي أو عملات أخرى.
        if (unitKey !== 'USD' && !unitKey.endsWith('USD/shares')) continue;
        for (const entry of units) {
          if (!['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A'].includes(entry.form)) continue;
          if (entry.fp && entry.fp !== 'FY') continue;
          // السنة = سنة تاريخ نهاية الفترة المالية (مستقرة حتى مع الشركات ذات السنة المالية غير التقويمية)
          const endYear = Number(String(entry.end || '').slice(0, 4));
          if (!Number.isInteger(endYear) || endYear < 2015) continue;
          const today = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
          const endCompact = Number(String(entry.end || '').replace(/-/g, ''));
          if (endCompact > today) continue; // فترة مستقبلية: تجاهل
          const year = endYear;
          if (entry.val == null || !Number.isFinite(Number(entry.val))) continue;
          // تفضيل أحدث إيداع لكل سنة
          const filed = Number(String(entry.fileddate || entry.accn || '').slice(0, 10).replace(/-/g, '')) || 0;
          const previous = out.get(year);
          if (!previous || filed >= previous.filed) out.set(year, { val: Number(entry.val) * scale, filed });
        }
      }
    }
    if (out.size) break; // أول مساحة اسم نجحت تكفي
  }
  return out;
}

async function fetchCompanyFacts(cik) {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  if (!response.ok) throw Error(`HTTP ${response.status} لـ CIK ${cik}`);
  return response.json();
}

async function main() {
  const dataPath = join(distDir, 'data.json');
  if (!existsSync(dataPath)) { console.error('data.json غير موجود؛ شغّل build-us-data.mjs أولًا.'); process.exit(1); }
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));

  // خريطة ticker -> CIK من ملف SEC الرسمي
  console.log('جلب خريطة الرموز من SEC…');
  const tickersRes = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'user-agent': USER_AGENT } });
  const tickersJson = await tickersRes.json();
  const cikByTicker = new Map(Object.values(tickersJson).map(row => [String(row.ticker).toUpperCase().replace(/[^A-Z0-9]/g, ''), Number(row.cik_str)]));
  // تخصيصات يدوية: شركات انقسم CIK الخاص بها وتبقى القوائم السنوية في الملف القديم
  const CIK_OVERRIDES = { XOM: 34088 }; // ExxonMobil: القوائم السنوية (10-K) في Exxon Mobil Corporation CIK 34088
  Object.assign(cikByTicker, Object.fromEntries(Object.entries(CIK_OVERRIDES).map(([t, cik]) => [t, cik])));

  const companies = data.sectors.flatMap(sector => sector.stocks.map(stock => ({ ...stock, sectorName: sector.name, sectorSlug: sector.slug })));
  const targets = limitArg ? companies.slice(0, limitArg) : companies;
  const financials = new Map(); // symbol -> {years:Map}
  const ciaks = new Map();

  let done = 0, failed = 0;
  for (const company of targets) {
    const cik = cikByTicker.get(String(company.symbol).toUpperCase());
    if (!cik) { failed++; continue; }
    ciaks.set(company.symbol, cik);
    if (limitArg === 0 || done < limitArg) {
      try {
        const facts = await fetchCompanyFacts(cik);
        const extracted = new Map();
        for (const [key, tags] of Object.entries(TAGS)) {
          const isRatioTag = key.includes('Eps');
          const extractedMap = extractAnnual(facts, tags, { scale: isRatioTag ? 1 : 1 });
          extracted.set(key, extractedMap);
        }
        financials.set(company.symbol, extracted);
        done++;
        process.stdout.write(`\rتمت معالجة ${done}/${targets.length}`);
      } catch (error) {
        failed++;
        console.error(`\nفشل ${company.symbol}: ${error.message}`);
      }
      await sleep(150); // احترام معدل SEC
    }
  }
  console.log(`\nمكتمل: ${done}، فاشل: ${failed}`);

  // بناء الملفات لكل قطاع
  const bySector = new Map();
  for (const sector of data.sectors) bySector.set(sector.slug, { name: sector.name, companies: [] });

  const mapSnapshot = {};
  let snapshotCount = 0;

  for (const sector of data.sectors) {
    const sectorCompanies = [];
    for (const stock of sector.stocks) {
      const extracted = financials.get(stock.symbol);
      if (!extracted) continue;
      // السنوات: اتحاد سنوات الإيرادات وصافي الربح، آخر 5 سنوات
      const yearSet = new Set([...extracted.get('revenue').keys(), ...extracted.get('netProfit').keys()]);
      const years = [...yearSet].sort((a, b) => a - b).slice(-YEARS_COUNT);
      if (!years.length) continue;
      const companyYears = years.map(year => {
        const revenue = round(extracted.get('revenue').get(year)?.val / 1e6, 2);
        const grossIncome = round(extracted.get('grossIncome').get(year)?.val / 1e6, 2);
        const operatingIncome = round(extracted.get('operatingIncome').get(year)?.val / 1e6, 2);
        const netProfit = round(extracted.get('netProfit').get(year)?.val / 1e6, 2);
        const assets = round(extracted.get('assets').get(year)?.val / 1e6, 2);
        const equity = round(extracted.get('equity').get(year)?.val / 1e6, 2);
        const dilutedEps = round(extracted.get('dilutedEps').get(year)?.val, 3);
        const basicEps = round(extracted.get('basicEps').get(year)?.val, 3);
        const values = { revenue, grossIncome, operatingIncome, netProfit, assets, equity, dilutedEps, basicEps };
        if (grossIncome != null && revenue != null && revenue !== 0) values.grossMargin = round(grossIncome / revenue, 5);
        if (operatingIncome != null && revenue != null && revenue !== 0) values.operatingMargin = round(operatingIncome / revenue, 5);
        if (netProfit != null && revenue != null && revenue !== 0) values.netMargin = round(netProfit / revenue, 5);
        if (netProfit != null && equity != null && equity !== 0) values.returnOnEquity = round(netProfit / equity, 5);
        return { year, period: 'FY', values };
      });
      const latest = companyYears.at(-1);
      sectorCompanies.push({
        symbol: stock.symbol,
        name: stock.name,
        fullName: `${stock.name} (${stock.symbol}) — الأرقام بالمليون دولار، وربح السهم بالدولار`,
        years: companyYears,
      });
      if (latest?.values.dilutedEps != null || latest?.values.basicEps != null) {
        // القيمة الدفترية للسهم: حقوق المساهمين ÷ عدد الأسهم المخزن في data.json
        // (تُترك null عندما تكون الحقوق صفرًا أو سالبة بعد إعادة شراء الأسهم)
        const bookPerShare = stock.shares > 0 && latest.values.equity != null && latest.values.equity > 0 ? round(latest.values.equity * 1e6 / stock.shares, 2) : null;
        mapSnapshot[stock.symbol] = {
          symbol: stock.symbol,
          diluted: latest.values.dilutedEps ?? null,
          basic: latest.values.basicEps ?? (latest.values.dilutedEps ?? null),
          reported: latest.values.basicEps ?? null,
          book: bookPerShare,
          period: `${latest.year}`,
          dateKind: 'sector',
        };
        snapshotCount++;
      }
    }
    const sectorYears = [...new Set(sectorCompanies.flatMap(c => c.years.map(y => y.year)))].sort((a, b) => a - b);
    const file = {
      schemaVersion: 1,
      sector: sector.name,
      years: sectorYears,
      source: { name: 'SEC EDGAR companyfacts', provider: 'SEC EDGAR', url: 'https://data.sec.gov/api/xbrl/companyfacts/' },
      companies: sectorCompanies.sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    };
    writeFileSync(join(distDir, `${sector.slug}-financials.json`), JSON.stringify(file, null, 1) + '\n');
    console.log(`${sector.slug}-financials.json: ${sectorCompanies.length} شركة، سنوات ${sectorYears[0] ?? '—'}–${sectorYears.at(-1) ?? '—'}`);
  }

  // تحديث financial-map.json مع الحفاظ على الشركات التي لم تُغطَّ
  const mapPath = join(distDir, 'financial-map.json');
  const existingMap = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, 'utf8')) : { companyIds: {}, sectorIds: [], snapshot: {} };
  existingMap.snapshot = { ...existingMap.snapshot, ...mapSnapshot };
  existingMap.source = 'SEC EDGAR';
  existingMap.updatedAt = new Date().toISOString();
  writeFileSync(mapPath, JSON.stringify(existingMap, null, 1) + '\n');
  console.log(`financial-map.json: ${Object.keys(existingMap.snapshot).length} شركة (${snapshotCount} من EDGAR)`);
}

main().catch(error => { console.error(error); process.exit(1); });
