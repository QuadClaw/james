/**
 * Vercel Serverless Function: /api/market
 * Yahoo Finance API를 통해 시장 데이터를 서버사이드에서 수집
 *
 * GET /api/market?symbols=CL=F,KRW=X,^KS11,^KQ11,^IXIC&range=1mo&interval=1d
 */

const SYMBOL_MAP = {
  'CL=F':  { name: 'WTI 유가',      currency: 'USD' },
  'KRW=X': { name: 'USD/KRW 환율',  currency: 'KRW' },
  '^KS11': { name: '코스피',         currency: 'KRW' },
  '^KQ11': { name: '코스닥',         currency: 'KRW' },
  '^IXIC': { name: '나스닥',         currency: 'USD' },
};

const DEFAULT_SYMBOLS = Object.keys(SYMBOL_MAP);

async function fetchRawYahoo(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MarketDashboard/1.0)',
      'Accept': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Yahoo Finance responded with ${response.status} for symbol ${symbol}`);
  }
  return response.json();
}

function parseHistory(json, interval) {
  const result = json?.chart?.result?.[0];
  if (!result) return { meta: null, history: [] };

  const meta = result.meta;
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const isIntraday = ['1m','5m','15m','30m','60m','1h'].includes(interval);

  const history = timestamps
    .map((ts, i) => {
      const close = closes[i];
      if (close == null) return null;
      const d = new Date(ts * 1000);
      const date = isIntraday ? d.toISOString() : d.toISOString().split('T')[0];
      return { date, close: parseFloat(close.toFixed(4)) };
    })
    .filter(Boolean);

  return { meta, history };
}

async function fetchSymbol(symbol, range, interval) {
  const isIntraday = ['1m','5m','15m','30m','60m','1h'].includes(interval);

  const json = await fetchRawYahoo(symbol, range, interval);
  const { meta, history: rawHistory } = parseHistory(json, interval);

  if (!meta) {
    throw new Error(`No data returned for symbol ${symbol}`);
  }

  let history = rawHistory;
  let lastTradeDate = new Date().toISOString().split('T')[0]; // default: today (UTC)

  // If 1d intraday returns empty history (weekend / after-hours),
  // retry with 5d and extract only the last trading day's data.
  if (range === '1d' && isIntraday && history.length === 0) {
    try {
      const retryJson = await fetchRawYahoo(symbol, '5d', interval);
      const { history: fullHistory } = parseHistory(retryJson, interval);

      if (fullHistory.length > 0) {
        // Determine last trading day from the final entry
        const lastDateStr = fullHistory[fullHistory.length - 1].date.split('T')[0];
        history = fullHistory.filter(h => h.date.startsWith(lastDateStr));
        lastTradeDate = lastDateStr;
      }
    } catch (_retryErr) {
      // Retry failed silently — history stays empty
    }
  }

  const current = meta.regularMarketPrice ?? meta.previousClose ?? null;
  const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? null;

  // previousCloseDate: regularMarketTime에서 하루 전 날짜 추산
  let previousCloseDate = null;
  if (meta.regularMarketTime) {
    const d = new Date((meta.regularMarketTime - 86400) * 1000);
    previousCloseDate = d.toISOString().split('T')[0];
  }

  const change = current != null && previousClose != null
    ? parseFloat((current - previousClose).toFixed(4))
    : null;
  const changePercent = current != null && previousClose != null && previousClose !== 0
    ? parseFloat(((change / previousClose) * 100).toFixed(2))
    : null;

  const info = SYMBOL_MAP[symbol] || { name: symbol, currency: meta.currency || 'USD' };

  const payload = {
    name: info.name,
    current: current != null ? parseFloat(current.toFixed(4)) : null,
    previousClose: previousClose != null ? parseFloat(previousClose.toFixed(4)) : null,
    previousCloseDate,
    change,
    changePercent,
    currency: meta.currency || info.currency,
    history,
  };

  // Attach lastTradeDate only for 1d intraday requests
  if (range === '1d' && isIntraday) {
    payload.lastTradeDate = lastTradeDate;
  }

  return payload;
}

module.exports = async (req, res) => {
  // CORS headers for same-origin usage on Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const symbolsParam = req.query?.symbols;
  const range = req.query?.range || '1mo';
  const interval = req.query?.interval || '1d';

  const symbols = symbolsParam
    ? symbolsParam.split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_SYMBOLS;

  const results = await Promise.allSettled(
    symbols.map(sym => fetchSymbol(sym, range, interval))
  );

  const data = {};
  results.forEach((result, i) => {
    const symbol = symbols[i];
    if (result.status === 'fulfilled') {
      data[symbol] = result.value;
    } else {
      data[symbol] = {
        error: result.reason?.message || 'Failed to fetch data',
      };
    }
  });

  res.status(200).json({
    data,
    updatedAt: new Date().toISOString(),
  });
};
