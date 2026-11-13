const columns = [
  ['symbol','رمز السهم','symbol'],['name','اسم الشركة','name'],['price','سعر السهم','price'],['day','تغير اليوم','day'],
  ['eps','ربحية السهم','eps'],['pe','مكرر الأرباح','pe'],['bookValue','القيمة الدفترية','bv'],
  ['pb','مكرر القيمة الدفترية','pb'],['dividendYield','عائد التوزيع','yield'],['week52Position','آخر 52 أسبوع','week52'],['marketCap','القيمة السوقية (مليون $)','mcap'],['tradedValue','القيمة المتداولة (مليون $)','tval'],['ytd','الأداء منذ بداية السنة','ytd'],['month3','تغير 3 أشهر','3m'],
  ['month6','تغير 6 أشهر','6m'],['year1','تغير سنة','1y']
];
const numberFormat = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const integerFormat = new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
const epsFormat = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const timeFormat = new Intl.DateTimeFormat('ar',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});
let data, financialMap, activeSector = null, query = '', sortBySector = new Map([['all',{key:'marketCap',dir:-1}]]), epsMode = 'diluted', refreshRunning = false, pricesRefreshRunning = false, priceRefreshError = '';
const financials = new Map();
// Main groups for the two-level sector picker. Sectors not listed fall under «أخرى».
const SECTOR_GROUPS = [
  ['المالية',['المالية']],
  ['الطاقة والمواد والمرافق',['الطاقة','المواد','المرافق']],
  ['الصناعة والخدمات',['الصناعة والخدمات']],
  ['الاستهلاك',['الاستهلاك']],
  ['الصحة',['الصحة']],
  ['العقار',['العقار']],
  ['التقنية والاتصالات',['التقنية والاتصالات']]
];
let sectorGroup = null;
function sectorGroups(){
  const known=new Set(SECTOR_GROUPS.flatMap(group=>group[1]));
  const groups=SECTOR_GROUPS.map(([label,names])=>({label,indexes:names.map(name=>data.sectors.findIndex(sector=>sector.name===name)).filter(index=>index>=0)})).filter(group=>group.indexes.length);
  const rest=data.sectors.map((sector,index)=>known.has(sector.name)?-1:index).filter(index=>index>=0);
  if(rest.length)groups.push({label:'أخرى',indexes:rest});
  return groups;
}
function groupOfSector(index){return sectorGroups().findIndex(group=>group.indexes.includes(index));}
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalized = value => String(value ?? '').normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase().trim();
const numeric = (n, digits=2) => n == null ? '<span class="missing">—</span>' : `<span class="num">${digits===3?epsFormat.format(n):numberFormat.format(n)}</span>`;
const percent = (n, signed=true) => n == null ? '<span class="missing">—</span>' : `<span class="num ${signed?(n>0?'up':n<0?'down':'flat'):'dividend-yield'}">${signed&&n>0?'+':''}${numberFormat.format(n)}%</span>`;
const pe = stock => stock.pe != null ? numeric(stock.pe) : stock.eps != null && stock.eps < 0 ? '<span class="loss">خاسرة</span>' : '<span class="missing">—</span>';
const allStocks = () => data.sectors.flatMap(s => s.stocks);
const safeNumber = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
// الصفحة الرئيسية تتضمن ملخص السوق؛ يبقى ثابت أثناء التمرير كما في النسخة الأصلية.

// The range is displayed high on the left and low on the right, as in the
// reference. Sorting uses the current price's position from low to high.
function range52Position(stock){
  const low=safeNumber(stock.week52Low),high=safeNumber(stock.week52High),price=safeNumber(stock.price);
  if(low==null||high==null||price==null||low<=0||high<low||price<=0)return null;
  if(high===low)return price===low?0.5:price>high?1:0;
  return Math.max(0,Math.min(1,(price-low)/(high-low)));
}
function range52(stock){
  const low=safeNumber(stock.week52Low),high=safeNumber(stock.week52High);
  if(low==null||high==null||low<=0||high<low)return '<span class="missing" title="نطاق آخر 52 أسبوعًا غير متاح">—</span>';
  const price=safeNumber(stock.price),position=range52Position(stock);
  const checked=stock.week52CheckedAt?new Date(stock.week52CheckedAt):null;
  const checkedLabel=checked&&!Number.isNaN(checked.getTime())?new Intl.DateTimeFormat('ar',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(checked):null;
  const title=`أعلى سعر: ${numberFormat.format(high)}، أدنى سعر: ${numberFormat.format(low)}${position==null?'؛ السعر الحالي غير متاح':`، السعر الحالي: ${numberFormat.format(price)}`}${stock.week52Source?`؛ المصدر: ${stock.week52Source}`:''}${checkedLabel?`؛ آخر فحص: ${checkedLabel}`:''}`;
  const marker=position==null?'':`<span class="range52-marker" style="left:${((1-position)*100).toFixed(2)}%"></span>`;
  return `<div class="range52" role="img" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"><div class="range52-track">${marker}</div><div class="range52-labels" aria-hidden="true"><span>${numberFormat.format(high)}</span><span>${numberFormat.format(low)}</span></div></div>`;
}

function periodValid(period){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(period || ''))return false;
  const day=new Date(`${period}T12:00:00`);
  return !Number.isNaN(day.getTime()) && day <= new Date() && day >= new Date('2020-01-01T00:00:00');
}
function today(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
const sourceDate = record=> record.dateKind==='checked' ? `فُحصت بيانات الشركة في ${record.period}` : `آخر تحديث للبيانات ${record.period}`;
const displayDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value||'') ? value.split('-').reverse().join('.') : /^\d{2}\.\d{2}\.\d{4}$/.test(value||'') ? value : null;
const providerLabel = value => value==='TradingView'?'تريدينغ فيو':value==='Yahoo Finance'?'Yahoo Finance':value==='SEC EDGAR'?'SEC EDGAR (ملفات الشركات الرسمية)':value||'مصدر غير محدد';
const snapshotLabel = () => displayDate(data.priceSource?.mode==='close' ? data.priceSource.officialDate || data.priceDate : data.priceSource?.observedDate || data.priceDate) || '—';
const timestamp = value => value ? new Date(value).getTime() : NaN;
const updateTime = value => {if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:timeFormat.format(date)};
const checkedLabel = value => {const date=new Date(value);return !value||Number.isNaN(date.getTime())?null:`${new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)} ${timeFormat.format(date)} بتوقيت نيويورك`};
// جلسة السوق الأمريكية: الاثنين–الجمعة 9:30–16:00 بتوقيت نيويورك.
// هذا تحذير للحداثة، وليس ادعاءً بأن الجلسة مفتوحة الآن.
function isMarketHours(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const part=type=>parts.find(p=>p.type===type)?.value;
  const minutes=Number(part('hour'))*60+Number(part('minute'));
  return !['Sat','Sun'].includes(part('weekday')) && (minutes>9*60+30 || (minutes===9*60+30)) && minutes<16*60;
}
function paintPriceStatus(){
  const source=data?.priceSource||{},messages=[];
  if(source.warning)messages.push(source.warning);
  if(source.unavailableSymbols>0)messages.push(`السعر غير متاح لـ ${source.unavailableSymbols} سهمًا.`);
  const checked=checkedLabel(source.checkedAt);
  messages.push(checked?`آخر فحص لنسخة الأسعار: ${checked}.`:'وقت آخر فحص لنسخة الأسعار غير متاح.');
  if(isMarketHours() && Number.isFinite(timestamp(source.checkedAt)) && Date.now()-timestamp(source.checkedAt)>35*60*1000)messages.push('نسخة الأسعار قديمة: مضى أكثر من 35 دقيقة على آخر فحص خلال ساعات التداول المعتادة.');
  if(priceRefreshError)messages.push(priceRefreshError);
  const node=$('price-status');if(node)node.textContent=messages.join(' ');
}
function paintSnapshot(){
  const date=snapshotLabel();
  for(const id of ['price-date','price-date-note','price-date-footer']){
    const node=$(id);
    if(node) node.textContent=date;
  }
  const mode=$('price-mode');
  const official=data.priceSource?.mode==='close';
  const delay=safeNumber(data.priceSource?.delayMinutes);
  if(mode)mode.textContent=official?(date==='—'?'إغلاق رسمي · آخر إغلاق متاح':'إغلاق رسمي'):`أسعار متأخرة · غير مؤكدة رسميًا${delay!=null&&delay>0?` · تأخير المصدر ${delay} دقيقة`:''}`;
  const source=$('price-source');
  if(source)source.textContent=providerLabel(data.priceSource?.provider);
  paintPriceStatus();
}
function stockPriceLabel(stock){
  const date=displayDate(stock.priceDate);
  const status=stock.priceStatus==='official_close'?'إغلاق رسمي':stock.priceStatus==='unavailable'||stock.price==null?'السعر غير متاح':'سعر متأخر · غير مؤكد رسميًا';
  return `${status} · ${date||'تاريخ السعر غير متاح'} · المصدر: ${providerLabel(stock.priceSource || data.priceSource?.provider)}`;
}
function applyFinancials(){
  for(const stock of allStocks()){
    const fallback=stock._fallback || (stock._fallback={eps:safeNumber(stock.eps),bookValue:safeNumber(stock.bookValue),dividendYield:safeNumber(stock.dividendYield)});
    const record=financials.get(stock.symbol);
    const preferred=record && safeNumber(record[epsMode==='diluted'?'diluted':'basic']);
    const chosen=preferred ?? (record && safeNumber(record.reported)) ?? fallback.eps;
    stock.eps=chosen;
    const price=safeNumber(stock.price);
    stock.pe=stock.eps > 0 && price != null && price > 0 ? price/stock.eps : null;
    stock.bookValue=record?.book == null ? fallback.bookValue : safeNumber(record.book);
    stock.pb=stock.bookValue > 0 && price != null && price > 0 ? price/stock.bookValue : null;
    stock.dividendYield=fallback.dividendYield;
    const fallbackSource=`TradingView${data.financialPeriod?` · ${data.financialPeriod}`:''}`;
    stock._epsSource=record == null ? fallbackSource : `SEC EDGAR · ربحية ${epsMode==='diluted'?'مخفضة':'أساسية'} · ${sourceDate(record)}`;
    stock._bookSource=record?.book == null ? fallbackSource : `SEC EDGAR · ${sourceDate(record)}`;
    stock._hasCurrentEps=record != null;
    stock._epsPeriod=record == null ? null : record.period;
    stock._epsDateKind=record == null ? null : record.dateKind;
  }
  stats();render();
}
function stats(){
  const stocks=allStocks();
  const updated=stocks.filter(s=>s._hasCurrentEps).length;
  const values=[['القطاعات',data.sectors.length],['الشركات',stocks.length],['ربحية من EDGAR',updated],['تاريخ السعر',snapshotLabel()]];
  const statsNode=$('stats');if(statsNode)statsNode.innerHTML=values.map(([label,value])=>`<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong></div>`).join('');
}
function marketDailyChange(summary){
  const day=safeNumber(summary.day),points=safeNumber(summary.pointChange);
  if(day==null)return '—';
  const direction=day>0?'ارتفاع':day<0?'انخفاض':'دون تغيير';
  const arrow=day>0?'▲':day<0?'▼':'';
  const amount=points==null?'—':numberFormat.format(Math.abs(points));
  const rate=numberFormat.format(Math.abs(day));
  const label=`${direction}؛ ${points==null?'التغيير بالنقاط غير متاح':`${amount} نقطة`}؛ ${rate} بالمئة`;
  return `<span class="market-daily-change" role="img" aria-label="${escapeHtml(label)}"><span class="market-direction" aria-hidden="true">${arrow}</span><bdi class="market-points" aria-hidden="true">${amount}</bdi><span class="market-percent" aria-hidden="true"><bdi>${rate}</bdi> %</span></span>`;
}
function paintMarketSummary(){
  const m=data.marketSummary||{};
  const breadth=allStocks().reduce((counts,stock)=>{const change=safeNumber(stock.day);if(change>0)counts.up++;else if(change<0)counts.down++;else if(change===0)counts.flat++;return counts;},{up:0,down:0,flat:0});
  const mode=m.mode || (m.isIntraday?'delayed':null);
  const source=providerLabel(!m.mode&&m.quoteSource?m.quoteSource:m.source);
  const date=displayDate(m.date);
  const daily=marketDailyChange(m);
  const items=[
    {label:'قيمة المؤشر',value:m.value==null?'—':numberFormat.format(m.value)},
    {label:'التغيير اليومي',value:daily,trend:m.day},
    {label:'الشركات المرتفعة',value:integerFormat.format(breadth.up),trend:1},
    {label:'الشركات المنخفضة',value:integerFormat.format(breadth.down),trend:-1},
    {label:'دون تغيير',value:integerFormat.format(breadth.flat),trend:0},
    {label:'القيمة المتداولة',value:m.turnover==null?'—':integerFormat.format(m.turnover),source:m.turnoverSource,estimated:m.turnoverEstimated===true},
    {label:'منذ بداية السنة',value:m.ytd,percent:true},
    {label:'3 أشهر',value:m.month3,percent:true},
    {label:'6 أشهر',value:m.month6,percent:true},
    {label:'سنة',value:m.year1,percent:true}
  ];
  const cards=items.map(item=>{
    const trend=item.trend ?? (item.percent?item.value:null);
    const display=item.percent?(item.value==null?'—':`${item.value>0?'+':''}${numberFormat.format(item.value)}%`):item.value;
    const cls=typeof trend==='number'?(trend>0?'up':trend<0?'down':'flat'):'';
    const estimatedMark=item.estimated&&item.value!=='—'?' <small>(تقديري)</small>':'';
    const itemSource=item.percent?providerLabel(m.performanceSource):item.source?providerLabel(item.source):source;
    const title=item.label.startsWith('الشركات')||item.label==='دون تغيير'?`محسوب من بيانات أسهم الجدول · ${providerLabel(data.priceSource?.provider)} · ${snapshotLabel()}`:`المصدر: ${itemSource} · ${item.percent?'تاريخ بيانات الأداء':'تاريخ المؤشر'}: ${item.percent?m.performanceDate||'غير متاح':date||'غير متاح'}${item.estimated?' · تقدير من أحجام الأسهم المتأخرة ويُستبدل بالقيمة الرسمية عند الإغلاق':''}`;
    return `<div class="market-card" title="${escapeHtml(title)}"><span>${item.label}</span><strong class="${cls}">${display}${estimatedMark}</strong></div>`;
  });
  const group=(label,body,kind)=>`<div class="market-group market-group-${kind}"><span class="market-group-label">${label}</span><div class="market-group-cards">${body}</div></div>`;
  const breadthBar=`<div class="breadth-bar" aria-hidden="true"><i class="breadth-up" style="flex:${breadth.up}"></i><i class="breadth-flat" style="flex:${breadth.flat}"></i><i class="breadth-down" style="flex:${breadth.down}"></i></div>`;
  $('market-stats').innerHTML=group('المؤشر العام',cards[0]+cards[1],'index')+group('اتساع السوق',breadthBar+cards[2]+cards[4]+cards[3],'breadth')+group('القيمة المتداولة (دولار)',cards[5],'turnover')+group('أداء المؤشر',cards.slice(6).join(''),'performance');
  const checked=checkedLabel(m.updatedAt);
  const label=mode==='close'?'إغلاق رسمي':mode==='delayed'?'بيانات متأخرة · غير مؤكدة رسميًا':'بيانات المؤشر';
  $('market-date').textContent=m.date||m.value!=null?`${label} · ${date||(mode==='close'?'آخر إغلاق متاح':'تاريخ غير متاح')} · ${source}${checked?` · آخر فحص ${checked}`:''}`:'بانتظار تحديث المؤشر';
}
function sectorChange(stocks){
  let weighted=0,total=0;
  for(const stock of stocks){const change=safeNumber(stock.day),cap=safeNumber(stock.marketCap);if(change==null||cap==null||cap<=0)continue;weighted+=change*cap;total+=cap;}
  return total?weighted/total:null;
}
function sectorPageFor(name){
  const sector=data?.sectors.find(s=>s.name===name);
  const slug=sector?.slug;
  return slug && slug!=='other' ? `${slug}.html` : null;
}
function nav(){
  const groups=sectorGroups();
  if(activeSector!==null)sectorGroup=groupOfSector(activeSector);
  if(sectorGroup!==null&&!groups[sectorGroup])sectorGroup=null;
  const allActive=activeSector===null&&sectorGroup===null;
  const groupButtons=`<button class="group-button ${allActive?'active':''}" data-sector="all" type="button" aria-pressed="${allActive}" title="جميع القطاعات · ${allStocks().length} شركة"><span>جميع القطاعات</span><span class="count">${allStocks().length}</span></button>`+
    groups.map((group,gi)=>`<button class="group-button ${sectorGroup===gi?'active':''}" data-group="${gi}" type="button" aria-pressed="${sectorGroup===gi}"><span>${escapeHtml(group.label)}</span><span class="count">${group.indexes.reduce((total,index)=>total+data.sectors[index].stocks.length,0)}</span></button>`).join('');
  const chips=sectorGroup===null?'':groups[sectorGroup].indexes.map(i=>{
    const sector=data.sectors[i],change=sectorChange(sector.stocks),changeClass=change==null?'flat':change>0?'up':change<0?'down':'flat',changeText=change==null?'—':`${change>0?'+':''}${numberFormat.format(change)}%`;
    return `<button class="sector-button ${activeSector===i?'active':''}" data-sector="${i}" type="button" aria-pressed="${activeSector===i}" title="${escapeHtml(sector.name)} · ${sector.stocks.length} شركة · تغير مرجح محسوب"><span>${escapeHtml(sector.name)}</span><span class="count">${sector.stocks.length}</span><span class="sector-chip-change ${changeClass}">${changeText}</span></button>`;
  }).join('');
  $('sector-nav').innerHTML=`<div class="sector-groups" role="group" aria-label="مجموعات القطاعات">${groupButtons}</div>${chips?`<div class="sector-chips" role="group" aria-label="قطاعات ${escapeHtml(groups[sectorGroup].label)}">${chips}</div>`:''}`;
}
function row(stock){
  const dividendTitle=stock.dividendYield==null?'عائد التوزيع غير متاح في ملف البيانات':`عائد التوزيع · المصدر: ${stock.dividendYieldSource||'ملف البيانات؛ المصدر غير محدد'}`;
  const priceTitle=stockPriceLabel(stock);
  const performanceTitle=`تاريخ بيانات الأداء: ${stock.performanceDate||'غير متاح'}`;
  const page=sectorPageFor(data?.sectors.find(sector=>sector.stocks.some(s=>s.symbol===stock.symbol))?.name);
  const companyLabel=page?`<a class="company-results-link" href="${page}?symbol=${encodeURIComponent(stock.symbol)}" title="النتائج السنوية لـ ${escapeHtml(stock.name)}">${escapeHtml(stock.name)}</a>`:escapeHtml(stock.name);
  return `<tr><td class="sticky-1"><span class="symbol-badge">${escapeHtml(stock.symbol)}</span></td><td class="sticky-2 company-name">${companyLabel}</td><td title="${escapeHtml(priceTitle)}">${stock.price==null?'<span class="missing">—</span>':`<span class="num price">${numberFormat.format(stock.price)}</span>`}</td><td>${percent(stock.day)}</td><td title="${escapeHtml(stock._epsSource)}">${numeric(stock.eps,2)}</td><td>${pe(stock)}</td><td title="${escapeHtml(stock._bookSource)}">${numeric(stock.bookValue)}</td><td>${numeric(stock.pb)}</td><td title="${escapeHtml(dividendTitle)}">${percent(stock.dividendYield,false)}</td><td>${range52(stock)}</td><td title="${escapeHtml(`القيمة السوقية بمليون دولار · ${priceTitle}`)}">${numeric(stock.marketCap)}</td><td title="${escapeHtml(`القيمة المتداولة بمليون دولار · ${priceTitle}`)}">${stock.tradedValue==null?'<span class="missing">—</span>':`<span class="num">${numberFormat.format(stock.tradedValue/1e6)}</span>`}</td><td title="${escapeHtml(performanceTitle)}">${percent(stock.ytd)}</td><td title="${escapeHtml(performanceTitle)}">${percent(stock.month3)}</td><td title="${escapeHtml(performanceTitle)}">${percent(stock.month6)}</td><td title="${escapeHtml(performanceTitle)}">${percent(stock.year1)}</td></tr>`;
}
function render(){
  nav();
  const selected=activeSector===null
    ? [{index:'all',name:sectorGroup===null?'جميع الشركات':sectorGroups()[sectorGroup]?.label||'جميع الشركات',stocks:sectorGroup===null?allStocks():(sectorGroups()[sectorGroup]?.indexes||[]).flatMap(i=>data.sectors[i].stocks)}]
    : [{index:activeSector,name:data.sectors[activeSector].name,stocks:data.sectors[activeSector].stocks}];
  const filtered=selected.map(group=>({...group,stocks:group.stocks.filter(s=>normalized(s.name).includes(query)||s.nameEn&&normalized(s.nameEn).includes(query)||s.symbol.toLowerCase().includes(query))})).filter(group=>group.stocks.length);
  const count=filtered.reduce((n,group)=>n+group.stocks.length,0);
  $('view-title').textContent=activeSector===null?(sectorGroup===null?'جميع القطاعات':sectorGroups()[sectorGroup]?.label||'جميع القطاعات'):data.sectors[activeSector].name;
  const allSort=sortBySector.get('all');
  $('result-count').textContent=activeSector===null&&sectorGroup!==null?`${count} شركة في مجموعة ${sectorGroups()[sectorGroup]?.label||''}`:activeSector===null?`${count} شركة في جدول واحد${allSort?.key==='marketCap'&&allSort.dir===-1?' · الأكبر قيمة سوقية أولًا':''}`:`${count} شركة في قطاع ${data.sectors[activeSector].name}`;
  $('clear').hidden=!query;
  $('empty').hidden=filtered.length!==0;
  $('sectors').innerHTML=filtered.map(({name,index,stocks})=>{
    const sort=sortBySector.get(index);
    if(sort){stocks=[...stocks].sort((a,b)=>{
      const av=sort.key==='week52Position'?range52Position(a):a[sort.key],bv=sort.key==='week52Position'?range52Position(b):b[sort.key];
      if(av==null) return 1;if(bv==null)return -1;
      return (typeof av==='string'?av.localeCompare(bv,'ar'):av-bv)*sort.dir || a.symbol.localeCompare(b.symbol,'en');
    });}
    const change=sectorChange(index==='all'?allStocks():data.sectors[index].stocks),changeClass=change==null?'':change>0?'up':change<0?'down':'flat',changeText=change==null?'—':`${change>0?'+':''}${numberFormat.format(change)}%`;
    const page=index!=='all'?sectorPageFor(name):null;
    const annualResultsLink=page?`<a class="bank-results-link" href="${page}">النتائج السنوية للقطاع</a>`:'';
    return `<section class="sector-section" id="sector-${index}" aria-labelledby="heading-${index}"><div class="sector-heading"><div class="sector-title-wrap">${index==='all'?'':`<span class="sector-index">${String(index+1).padStart(2,'0')}</span>`}<h3 id="heading-${index}">${escapeHtml(name)}</h3></div><div class="sector-meta">${annualResultsLink}<span class="sector-pill">${stocks.length} ${index==='all'||stocks.length===1?'شركة':'شركات'}</span>${index==='all'?'':`<span class="sector-performance ${changeClass}" title="تغير محسوب مرجح بالقيمة السوقية لجميع شركات القطاع؛ ليس مؤشر قطاع رسميًا">تغير مرجح محسوب <strong>${changeText}</strong></span>`}</div></div><div class="table-wrap" tabindex="0" aria-label="جدول ${escapeHtml(name)}؛ مرر أفقيًا لرؤية كل الأعمدة"><table><colgroup>${columns.map(c=>`<col class="col-${c[2]}">`).join('')}</colgroup><thead><tr>${columns.map(([key,label],ci)=>`<th class="${ci===0?'sticky-1':ci===1?'sticky-2':''}" scope="col"><button type="button" data-sort="${key}" data-index="${index}" class="${sort?.key===key?'sorted':''}" aria-label="ترتيب حسب ${label}">${label}<span class="sort-glyph">${sort?.key===key?(sort.dir===1?'↑':'↓'):'↕'}</span></button></th>`).join('')}</tr></thead><tbody>${stocks.map(row).join('')}</tbody></table></div></section>`;
  }).join('');
}
function updateStatus(message){$('financial-status').textContent=message;}
function paintFinancialStatus(){
  if(!data)return;
  const updated=allStocks().filter(s=>s._hasCurrentEps).length;
  updateStatus(`ربحية ${updated} سهمًا من SEC EDGAR (ملفات الشركات الرسمية)؛ ${allStocks().length-updated} سهمًا تعرض قيمة TradingView.`);
}
function updateMode(mode){
  epsMode=mode;
  $('recurring-mode').classList.toggle('selected',mode==='diluted');
  $('reported-mode').classList.toggle('selected',mode==='basic');
  $('recurring-mode').setAttribute('aria-pressed',String(mode==='diluted'));
  $('reported-mode').setAttribute('aria-pressed',String(mode==='basic'));
  applyFinancials();
  const updated=allStocks().filter(s=>s._hasCurrentEps).length;
  updateStatus(`ربحية ${updated} سهمًا من SEC EDGAR؛ ${allStocks().length-updated} سهمًا تعرض قيمة TradingView. عائد التوزيع محفوظ من ملف الأسعار وفق مصدره.`);
}

/*
 * تحديث مباشر أثناء جلسة السوق.
 *
 * ملف data.json يبقى المرجع الرسمي المنشور، لكن GitHub Actions قد يتأخر.
 * لذلك نستخدم TradingView داخل المتصفح أثناء الجلسة فقط، ونضع الأسعار
 * في الذاكرة مع وسم واضح بأنها متأخرة وغير مؤكدة كإغلاق رسمي. عند انتهاء
 * الجلسة أو إعادة فتح الصفحة يعود الموقع تلقائياً إلى لقطة data.json الرسمية.
 */
const yahooProxies = [
  url => 'https://r.jina.ai/' + url,
  url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
  url => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url)
];
let yahooWorkingProxy = null;
const fetchTimed = (input, options, milliseconds) => Promise.race([
  fetch(input, options),
  new Promise((_, reject) => setTimeout(() => reject(Error('انتهت مهلة الطلب')), milliseconds))
]);
const yahooPayload = text => {
  const value = String(text || '').trim();
  if (value.startsWith('{')) return JSON.parse(value);
  const marker = 'Markdown Content:';
  const start = value.indexOf(marker);
  const payload = start >= 0 ? value.slice(start + marker.length).trim() : value;
  const first = payload.indexOf('{'), last = payload.lastIndexOf('}');
  if (first < 0 || last < first) throw Error('استجابة Yahoo غير صالحة');
  return JSON.parse(payload.slice(first, last + 1));
};
async function fetchYahooJson(url){
  const order = yahooWorkingProxy == null
    ? yahooProxies
    : [yahooProxies[yahooWorkingProxy], ...yahooProxies.filter((_, index) => index !== yahooWorkingProxy)];
  for (const proxy of order) {
    try {
      const response = await fetchTimed(proxy(url), {cache:'no-store'}, 8000);
      if (!response.ok) continue;
      const payload = yahooPayload(await response.text());
      if (payload && (payload.spark || payload.chart)) {
        yahooWorkingProxy = yahooProxies.indexOf(proxy);
        return payload;
      }
    } catch (error) { /* تجربة المسار التالي */ }
  }
  throw Error('تعذر الوصول إلى Yahoo Finance');
}
function yahooQuote(meta){
  const price=Number(meta?.regularMarketPrice), previous=Number(meta?.chartPreviousClose ?? meta?.previousClose);
  if (!(price > 0) || !(previous > 0)) return null;
  const timestamp=Number(meta?.regularMarketTime);
  return {price, previous, timestamp:Number.isFinite(timestamp)&&timestamp>0?timestamp:null,
    currency:meta?.currency||null};
}
async function getYahooLiveQuotes(symbols){
  const unique=[...new Set(symbols.filter(Boolean))], result=new Map();
  for(let i=0;i<unique.length;i+=40){
    const chunk=unique.slice(i,i+40), encoded=chunk.map(encodeURIComponent).join('%2C');
    const url=`https://query2.finance.yahoo.com/v7/finance/spark?symbols=${encoded}&range=1d&interval=1d`;
    try{
      const payload=await fetchYahooJson(url);
      for(const item of payload.spark?.result||[]){
        const quote=yahooQuote(item.response?.[0]?.meta);
        if(quote) result.set(item.symbol,quote);
      }
    }catch(error){ /* الدفعات الأخرى قد تنجح */ }
  }
  return result;
}
function liveDate(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
async function getTradingViewLiveQuotes(symbols){
  const unique=[...new Set(symbols.filter(Boolean))], result=new Map();
  const columns=['close','change','currency','time','update_mode','market_cap_basic','volume'];
  for(let i=0;i<unique.length;i+=300){
    const tickers=unique.slice(i,i+300);
    try{
      const response=await fetchTimed('https://scanner.tradingview.com/america/scan',{
        method:'POST', mode:'cors', cache:'no-store',
        headers:{'Content-Type':'text/plain;charset=UTF-8',Accept:'application/json'},
        body:JSON.stringify({symbols:{tickers,query:{types:[]}},columns}),
      }, 12000);
      if(!response.ok) continue;
      const payload=await response.json();
      for(const row of payload.data||[]){
        const symbol=String(row.s||'');
        const [price,day,currency,barTime,updateMode,marketCap,volume]=row.d||[];
        const observedDate=Number.isFinite(Number(barTime))
          ? new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Number(barTime)*1000)) : null;
        if(!unique.includes(symbol) || !(Number(price)>0) || !Number.isFinite(Number(day)) ||
           (currency && currency!=='USD') || observedDate!==liveDate()) continue;
        result.set(symbol,{price:Number(price),day:Number(day),marketCap:Number(marketCap),
          volume:Number(volume), updateMode: String(updateMode||'delayed'), date:observedDate});
      }
    }catch(error){ /* انتقل إلى Yahoo إذا لم يتوفر TradingView */ }
  }
  return result;
}
async function applyTradingViewLivePrices(snapshot){
  if(!isMarketHours() || !snapshot?.sectors?.length) return false;
  const stocks=snapshot.sectors.flatMap(sector=>sector.stocks);
  const symbols=['SP:SPX',...stocks.map(stock=>stock.symbolFull || stock.symbol)];
  const quotes=await getTradingViewLiveQuotes(symbols);
  const index=quotes.get('SP:SPX');
  let changed=0, turnover=0, turnoverStocks=0;
  const checkedAt=new Date().toISOString(), date=liveDate();
  for(const stock of stocks){
    const quote=quotes.get(stock.symbolFull || stock.symbol);
    if(!quote) continue;
    stock.price=quote.price;
    stock.day=quote.day;
    if(Number.isFinite(quote.marketCap) && quote.marketCap>0) stock.marketCap=Math.round(quote.marketCap/1e6);
    if(Number.isFinite(quote.volume) && Number.isFinite(stock.price)){ stock.tradedValue=Math.round(quote.volume*stock.price); turnover+=stock.tradedValue; turnoverStocks++; }
    stock.priceDate=date;
    stock.priceCheckedAt=checkedAt;
    stock.priceTimestamp=null;
    stock.priceSource='TradingView';
    stock.priceStatus='delayed';
    stock._livePrice=true;
    changed++;
  }
  if(index){
    const previous=Number(snapshot.marketSummary?.value);
    snapshot.marketSummary={...snapshot.marketSummary,
      value:index.price,
      pointChange:Number.isFinite(previous)?index.price-previous:null,
      day:index.day, date, source:'TradingView', mode:'delayed',
      isIntraday:true, updatedAt:checkedAt};
  }
  if(turnoverStocks){
    snapshot.marketSummary={...snapshot.marketSummary, turnover, turnoverSource:'TradingView',
      turnoverEstimated:turnoverStocks<stocks.length, turnoverStocks, turnoverUpdatedAt:checkedAt};
  }
  if(changed || index){
    snapshot.priceSource={...snapshot.priceSource, provider:'TradingView', mode:'delayed',
      observedDate:date, checkedAt, live:true, liveSymbols:changed, liveTurnover:turnover, liveTurnoverStocks:turnoverStocks,
      warning:'الأسعار المتأخرة من TradingView مؤرخة بجلسة اليوم وغير مؤكدة رسميًا كإغلاق؛ سيُستبدل بها الإغلاق الرسمي بعد تحديث المصدر.'};
    snapshot.priceDate=date;
    return true;
  }
  return false;
}
async function applyYahooLivePrices(snapshot){
  if(!isMarketHours() || !snapshot?.sectors?.length) return false;
  const stocks=snapshot.sectors.flatMap(sector=>sector.stocks);
  const symbols=stocks.map(stock=>stock.symbol);
  const quotes=await getYahooLiveQuotes(['^GSPC',...symbols]);
  const index=quotes.get('^GSPC');
  let changed=0;
  const checkedAt=new Date().toISOString(), date=liveDate();
  for(const stock of stocks){
    const quote=quotes.get(stock.symbol);
    if(!quote || (quote.currency && quote.currency!=='USD')) continue;
    stock.price=quote.price;
    stock.day=(quote.price/quote.previous-1)*100;
    if(Number.isFinite(stock.shares) && stock.shares>0) stock.marketCap=Math.round(quote.price*stock.shares/1e6);
    stock.priceDate=date;
    stock.priceCheckedAt=checkedAt;
    stock.priceTimestamp=quote.timestamp ? new Date(quote.timestamp*1000).toISOString() : null;
    stock.priceSource='Yahoo Finance';
    stock.priceStatus='delayed';
    stock._livePrice=true;
    changed++;
  }
  if(index){
    snapshot.marketSummary={...snapshot.marketSummary,
      value:index.price, pointChange:index.price-index.previous,
      day:(index.price/index.previous-1)*100, date, source:'Yahoo Finance',
      mode:'delayed', isIntraday:true, updatedAt:checkedAt};
  }
  if(changed || index){
    snapshot.priceSource={...snapshot.priceSource, provider:'Yahoo Finance', mode:'delayed',
      observedDate:date, checkedAt, live:true, liveSymbols:changed,
      warning:'الأسعار المباشرة من Yahoo Finance متأخرة وغير مؤكدة رسميًا؛ سيُستبدل بها الإغلاق الرسمي بعد تحديث المصدر.'};
    snapshot.priceDate=date;
    return true;
  }
  return false;
}
async function refreshPrices(){
  if(pricesRefreshRunning)return false;
  pricesRefreshRunning=true;
  try{
    const response=await fetch(`data.json?v=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const result=await response.json();
    if(!result||!Array.isArray(result.sectors)||result.sectors.some(sector=>!Array.isArray(sector.stocks)))throw Error('invalid price data');
    const current=timestamp(data?.priceSource?.checkedAt),incoming=timestamp(result.priceSource?.checkedAt);
    if(data && Number.isFinite(current) && (!Number.isFinite(incoming)||incoming<current)){
      priceRefreshError='رُفضت نسخة أسعار أقدم أو بلا وقت فحص صالح؛ احتُفظ بالقيم المعروضة.';
      paintPriceStatus();
      return false;
    }
    const initial=!data;
    data=result;
    priceRefreshError='';
    // لا نستخدم TradingView إلا داخل جلسة السوق. فشل المسار المباشر لا يمنع
    // عرض آخر لقطة موثوقة من data.json ولا يغيّرها.
    if(isMarketHours()){
      try{
        const liveUpdated=await applyTradingViewLivePrices(data);
        if(!liveUpdated){
          try{
            const yahooUpdated=await applyYahooLivePrices(data);
            if(!yahooUpdated) priceRefreshError='تعذر الحصول على أسعار مباشرة من TradingView أو Yahoo؛ احتُفظ بلقطة المصدر المنشورة.';
          }
          catch(error){ priceRefreshError='تعذر تحديث السعر المباشر؛ احتُفظ بلقطة المصدر المنشورة.'; }
        }
      }
      catch(error){ priceRefreshError='تعذر تحديث السعر المباشر؛ احتُفظ بلقطة المصدر المنشورة.'; }
    }
    if(initial)$('empty').querySelector('h3').textContent='لا توجد نتائج مطابقة';
    paintSnapshot();paintMarketSummary();applyFinancials();paintFinancialStatus();
    return true;
  }catch(error){
    priceRefreshError=data?'تعذر تحديث الأسعار؛ احتُفظ بالقيم المعروضة وستُعاد المحاولة تلقائيًا.':'تعذر تحميل الأسعار؛ ستُعاد المحاولة تلقائيًا.';
    paintPriceStatus();
    if(!data){$('result-count').textContent='تعذر تحميل البيانات';$('empty').hidden=false;$('empty').querySelector('h3').textContent='تعذر تحميل البيانات';}
    return false;
  }finally{pricesRefreshRunning=false;}
}
async function loadFinancialMap(){
  try{
    const response=await fetch(`financial-map.json?v=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw Error('map unavailable');
    const map=await response.json();
    if(!map||typeof map!=='object')throw Error('invalid map');
    financialMap=map;
    for(const [symbol,record] of Object.entries(map.snapshot||{}))if(periodValid(record.period)||/^\d{4}$/.test(String(record.period||'')))financials.set(symbol,record);
    if(data){
      applyFinancials();
      paintFinancialStatus();
    }
  }catch(error){updateStatus('تعذر تحميل بيانات الأرباح المحدثة؛ تُعرض القيم المتاحة في ملف الأسعار.');}
}

document.addEventListener('click',event=>{
  const groupButton=event.target.closest('[data-group]');
  if(groupButton){sectorGroup=Number(groupButton.dataset.group);activeSector=null;sortBySector.set('all',{key:'marketCap',dir:-1});render();return;}
  const sectorButton=event.target.closest('[data-sector]');
  if(sectorButton){activeSector=sectorButton.dataset.sector==='all'?null:Number(sectorButton.dataset.sector);if(activeSector===null){sectorGroup=null;sortBySector.set('all',{key:'marketCap',dir:-1});}render();return;}
  const sortButton=event.target.closest('[data-sort]');
  if(sortButton){const index=sortButton.dataset.index==='all'?'all':Number(sortButton.dataset.index),key=sortButton.dataset.sort,current=sortBySector.get(index);sortBySector.set(index,{key,dir:current?.key===key?-current.dir:1});const section=document.getElementById(`sector-${index}`);const scroll=section.querySelector('.table-wrap').scrollLeft;render();document.getElementById(`sector-${index}`).querySelector('.table-wrap').scrollLeft=scroll;}
});
$('search').addEventListener('input',event=>{query=normalized(event.target.value);render();});
$('clear').addEventListener('click',()=>{$('search').value='';query='';render();$('search').focus();});
$('recurring-mode').addEventListener('click',()=>updateMode('diluted'));
$('reported-mode').addEventListener('click',()=>updateMode('basic'));
refreshPrices();
loadFinancialMap();
setInterval(refreshPrices,60*1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshPrices();}});
