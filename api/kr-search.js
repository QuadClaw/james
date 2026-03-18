// KRX 종목 + NAVER ETF 리스트 캐시
let cachedStocks = null;
let cacheTime = 0;
const CACHE_TTL = 3600000; // 1시간

async function fetchAllStocks() {
  const now = Date.now();
  if (cachedStocks && (now - cacheTime) < CACHE_TTL) return cachedStocks;

  // 1) KRX 주식 리스트
  const krxPromise = fetch('https://kind.krx.co.kr/corpgeneral/corpList.do?method=download', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  }).then(async r => {
    const buf = await r.arrayBuffer();
    const text = new TextDecoder('euc-kr').decode(buf);
    const rows = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(text)) !== null) {
      const tds = [];
      const tdStr = rowMatch[1];
      const localTdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch;
      while ((tdMatch = localTdRegex.exec(tdStr)) !== null) {
        tds.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      if (tds.length >= 2) rows.push(tds);
    }
    return rows.map(r => {
      const name = r[0] || '';
      const market = r[1] || '';
      const code = r[2] || '';
      if (!name || !code) return null;
      const suffix = market.includes('코스닥') ? '.KQ' : '.KS';
      return { symbol: code + suffix, name, code, market: market.includes('코스닥') ? 'KOSDAQ' : 'KOSPI', type: 'EQUITY' };
    }).filter(Boolean);
  }).catch(() => []);

  // 2) NAVER ETF 리스트 (EUC-KR 인코딩)
  const etfPromise = fetch('https://finance.naver.com/api/sise/etfItemList.nhn', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  }).then(async r => {
    const buf = await r.arrayBuffer();
    const text = new TextDecoder('euc-kr').decode(buf);
    const data = JSON.parse(text);
    const items = data?.result?.etfItemList || [];
    return items.map(i => ({
      symbol: i.itemcode + '.KS',
      name: i.itemname || '',
      code: i.itemcode || '',
      market: 'KOSPI',
      type: 'ETF',
    }));
  }).catch(() => []);

  const [stocks, etfs] = await Promise.all([krxPromise, etfPromise]);
  cachedStocks = [...stocks, ...etfs];
  cacheTime = now;
  return cachedStocks;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const q = (req.query?.q || '').trim().toLowerCase();
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter q' });
  }

  try {
    const allStocks = await fetchAllStocks();

    // 한글/영문/코드 검색
    const results = allStocks
      .filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.symbol.toLowerCase().includes(q)
      )
      .slice(0, 15)
      .map(s => ({
        symbol: s.symbol,
        name: s.name,
        exchange: s.market,
        type: s.type
      }));

    res.status(200).json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stock list', message: err.message });
  }
};
