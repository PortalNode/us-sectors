// صفحة نتائج قطاع عامة للسوق الأمريكي. تستقبل إعدادات القطاع من data-* على <body>.
import { escapeHtml, validateDataset, renderAnnualTable } from './us-sector-metrics.mjs?v=us-20261113';
import { renderSectorCharts, fitSectorCharts, getChartOptions } from './us-sector-charts.mjs?v=us-20261113';

const config = {
  id: document.body.dataset.sectorId,
  sector: document.body.dataset.sectorName,
  slug: document.body.dataset.sectorSlug
};
const $ = id => document.getElementById(`${config.id}-${id}`);
let dataset, activeCompany, activeYears = [], selectedChartKey = 'netProfit';
function drawSelectedChart() {
  if (!dataset || !activeCompany) return;
  const option = getChartOptions(activeCompany, activeYears).find(item => item.key === selectedChartKey);
  $('charts-context').textContent = `${activeCompany.name} · ${activeYears[0]}–${activeYears.at(-1)} · من ملفات SEC EDGAR المحفوظة`;
  $('chart-selection-status').textContent = option?.available
    ? `مقارنة ${option.label} للأعوام ${activeYears[0]}–${activeYears.at(-1)}. يمكنك اختيار أي بند آخر من القائمة.`
    : 'هذا البند غير متاح لبعض السنوات؛ تظهر السنوات بعلامة «—» دون أرقام افتراضية.';
  $('charts-grid').innerHTML = renderSectorCharts(activeCompany, activeYears, selectedChartKey);
  fitSectorCharts($('charts-grid'), activeCompany, activeYears);
}
function populateChartOptions(company) {
  const grouped = new Map();
  for (const option of getChartOptions(company, activeYears)) {
    if (!grouped.has(option.group)) grouped.set(option.group, []);
    grouped.get(option.group).push(option);
  }
  $('chart-metric').innerHTML = [...grouped].map(([group, options]) => `<optgroup label="${escapeHtml(group)}">${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === selectedChartKey ? ' selected' : ''}>${escapeHtml(option.label + (option.available ? '' : ' (غير متاح حاليًا)'))}</option>`).join('')}</optgroup>`).join('');
  if ($('chart-metric').value !== selectedChartKey) selectedChartKey = $('chart-metric').value;
}
function selectCompany(symbol, replaceHistory = false) {
  const company = dataset.companies.find(item => item.symbol === symbol) || dataset.companies[0];
  $('nav').innerHTML = dataset.companies.map(item => `<button type="button" class="bank-tab" data-company="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === company.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  $('title').innerHTML = `${escapeHtml(company.name)} <span class="symbol-badge">${escapeHtml(company.symbol)}</span>`;
  $('subtitle').textContent = `${company.fullName || company.name} · قطاع ${config.sector} · نتائج سنوية فقط`;
  document.querySelector('.bank-period bdi')?.replaceChildren(document.createTextNode(`${dataset.years[0]}–${dataset.years.at(-1)}`));
  const availableYears = company.years.map(record => record.year).sort((a, b) => a - b);
  activeYears = availableYears;
  $('table-wrap').innerHTML = renderAnnualTable(company, availableYears);
  $('table-wrap').scrollLeft = 0;
  $('panel').hidden = false;
  activeCompany = company;
  populateChartOptions(company);
  drawSelectedChart();
  document.title = `${company.name} | نتائج قطاع ${config.sector} | السوق الأمريكي`;
  const url = new URL(window.location.href); url.searchParams.set('symbol', company.symbol);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (replaceHistory) window.history.replaceState({ symbol: company.symbol }, '', next);
  else if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.pushState({ symbol: company.symbol }, '', next);
}
async function load() {
  try {
    const response = await fetch(`${config.slug}-financials.json?v=us-20261113`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = validateDataset(await response.json());
    $('import-info').textContent = `المصدر المحفوظ: ${dataset.source?.name || 'SEC EDGAR'} · بيانات سنوية فقط.`;
    selectCompany(new URLSearchParams(window.location.search).get('symbol'), true);
    $('load-status').textContent = `المصدر: SEC EDGAR (ملفات الشركات الرسمية) · السنوات المتاحة ${dataset.years[0]}–${dataset.years.at(-1)} · نسب التغير محسوبة من القيم السنوية المخزنة`;
  } catch (error) {
    $('load-status').textContent = `تعذر تحميل ملف نتائج قطاع ${config.sector}. أعد تحميل الصفحة؛ لم تُستبدل البيانات بأرقام افتراضية.`;
    console.error('Sector annual data could not be loaded:', error);
  }
}
$('nav').addEventListener('click', event => { const button = event.target.closest('[data-company]'); if (button && dataset) selectCompany(button.dataset.company); });
$('chart-metric').addEventListener('change', () => { selectedChartKey = $('chart-metric').value; drawSelectedChart(); });
window.addEventListener('popstate', () => { if (dataset) selectCompany(new URLSearchParams(window.location.search).get('symbol'), true); });
const resizeCharts = () => { if (dataset && activeCompany) fitSectorCharts($('charts-grid'), activeCompany, activeYears); };
if (typeof ResizeObserver === 'function') { const observer = new ResizeObserver(resizeCharts); observer.observe($('charts-grid')); } else window.addEventListener('resize', resizeCharts);
load();
