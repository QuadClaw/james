/**
 * Vercel Serverless Function: /api/market
 * Yahoo Finance API를 통해 시장 데이터를 서버사이드에서 수집
 * 코스피(^KS11), 코스닥(^KQ11), 한국 개별종목(.KS/.KQ)은 NAVER Finance API 사용
 *
 * GET /api/market?symbols=CL=F,KRW=X,^KS11,^KQ11,^IXIC&range=1mo&interval=1d
 */

const SYMBOL_MAP = {
  'CL=F':  { name: 'WTI 유가',      currency: 'USD' },
  'KRW=X': { name: 'USD/KRW 환율',  currency: 'KRW' },
  '^KS11': { name: '코스피',         currency: 'KRW' },
  '^KQ11': { name: '코스닥',         currency: 'KRW' },
  '^IXIC': { name: '나스닥',         currency: 'USD' },
  '^TNX':  { name: '미국10년국채',   currency: '%'   },
};

const DEFAULT_SYMBOLS = Object.keys(SYMBOL_MAP);

// ─── NAVER 심볼 판별 ─────────────────────────────────────────────────────────

function isNaverSymbol(symbol) {
  if (symbol === '^KS11' || symbol === '^KQ11') return true;
  if (symbol.endsWith('.KS') || symbol.endsWith('.KQ')) return true;
  return false;
}

function getNaverCode(symbol) {
  if (symbol === '^KS11') return { type: 'index', code: 'KOSPI' };
  if (symbol === '^KQ11') return { type: 'index', code: 'KOSDAQ' };
  // 개별종목: 005930.KS → 005930
  const code = symbol.split('.')[0];
  return { type: 'stock', code };
}

function getNaverPageSize(range) {
  switch (range) {
    case '1d':  return 5;    // 최근 5일 (전일 비교용)
    case '1mo': return 30;
    case '3mo': return 90;
    case '1y':  return 365;
    case '10y': return 2500; // 약 10년 영업일
    default:    return 30;
  }
}

// ─── Yahoo 공통 유틸 ─────────────────────────────────────────────────────────

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

// ─── NAVER Finance fetch ─────────────────────────────────────────────────────

async function fetchNaverSymbol(symbol, range, interval) {
  const { type, code } = getNaverCode(symbol);
  const headers = { 'User-Agent': 'Mozilla/5.0' };
  const isIntraday = ['1m','5m','15m','30m','60m','1h'].includes(interval);

  // 1) NAVER에서 현재가 + 등락
  const basicUrl = type === 'index'
    ? `https://m.stock.naver.com/api/index/${code}/basic`
    : `https://m.stock.naver.com/api/stock/${code}/basic`;

  const basicRes = await fetch(basicUrl, { headers });
  if (!basicRes.ok) throw new Error(`NAVER API error: ${basicRes.status} for ${symbol}`);
  const basic = await basicRes.json();

  const current = parseFloat(basic.closePrice.replace(/,/g, ''));
  const changeVal = parseFloat(basic.compareToPreviousClosePrice.replace(/,/g, ''));
  const previousClose = current - changeVal;
  const changePercent = parseFloat(basic.fluctuationsRatio);

  let history = [];
  let lastTradeDate = new Date().toISOString().split('T')[0];

  if (isIntraday) {
    // 1d intraday: NAVER에 5분봉 없음 → Yahoo에서 차트 데이터만 가져옴
    try {
      const yahooJson = await fetchRawYahoo(symbol, range, interval);
      const { history: yahooHistory } = parseHistory(yahooJson, interval);
      history = yahooHistory;

      if (history.length === 0) {
        // 빈 데이터면 5d retry
        const retryJson = await fetchRawYahoo(symbol, '5d', interval);
        const { history: fullHistory } = parseHistory(retryJson, interval);
        if (fullHistory.length > 0) {
          const lastDateStr = fullHistory[fullHistory.length - 1].date.split('T')[0];
          history = fullHistory.filter(h => h.date.startsWith(lastDateStr));
          lastTradeDate = lastDateStr;
        }
      }
    } catch (e) {
      // Yahoo도 실패하면 빈 히스토리로 진행
    }
  } else {
    // 일봉 이상: NAVER price API
    const pageSize = getNaverPageSize(range);
    const priceUrl = type === 'index'
      ? `https://m.stock.naver.com/api/index/${code}/price?pageSize=${pageSize}&page=1`
      : `https://m.stock.naver.com/api/stock/${code}/price?pageSize=${pageSize}&page=1`;

    try {
      const priceRes = await fetch(priceUrl, { headers });
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        // NAVER는 내림차순이므로 reverse
        history = priceData.reverse().map(p => ({
          date: p.localTradedAt,
          close: parseFloat(p.closePrice.replace(/,/g, '')),
        }));
        if (history.length > 0) {
          lastTradeDate = history[history.length - 1].date;
        }
      }
    } catch (e) {
      // 히스토리 실패 시 빈 배열로 진행
    }
  }

  const info = SYMBOL_MAP[symbol] || { name: basic.stockName || symbol, currency: 'KRW' };

  const payload = {
    name: info.name || basic.stockName || symbol,
    current: parseFloat(current.toFixed(4)),
    previousClose: parseFloat(previousClose.toFixed(4)),
    previousCloseDate: null, // NAVER에서 전일 날짜 직접 제공 안 함
    lastMarketDate: lastTradeDate,
    change: parseFloat(changeVal.toFixed(4)),
    changePercent,
    currency: 'KRW',
    history,
  };

  if (range === '1d' && isIntraday) {
    payload.lastTradeDate = lastTradeDate;
  }

  return payload;
}

// ─── Yahoo Finance fetch ─────────────────────────────────────────────────────

async function fetchYahooSymbol(symbol, range, interval) {
  const isIntraday = ['1m','5m','15m','30m','60m','1h'].includes(interval);

  const json = await fetchRawYahoo(symbol, range, interval);
  const { meta, history: rawHistory } = parseHistory(json, interval);

  if (!meta) {
    throw new Error(`No data returned for symbol ${symbol}`);
  }

  let history = rawHistory;
  let lastTradeDate = new Date().toISOString().split('T')[0];

  // If 1d intraday returns empty history (weekend / after-hours),
  // retry with 5d and extract only the last trading day's data.
  if (range === '1d' && isIntraday && history.length === 0) {
    try {
      const retryJson = await fetchRawYahoo(symbol, '5d', interval);
      const { history: fullHistory } = parseHistory(retryJson, interval);

      if (fullHistory.length > 0) {
        const lastDateStr = fullHistory[fullHistory.length - 1].date.split('T')[0];
        history = fullHistory.filter(h => h.date.startsWith(lastDateStr));
        lastTradeDate = lastDateStr;
      }
    } catch (_retryErr) {
      // Retry failed silently — history stays empty
    }
  }

  let current = meta.regularMarketPrice ?? meta.previousClose ?? null;

  // previousClose: 5d 일봉에서 직전 거래일 종가를 직접 가져옴 (Yahoo meta가 부정확할 수 있음)
  let previousClose = null;
  let previousCloseDate = null;
  try {
    const dailyJson = await fetchRawYahoo(symbol, '5d', '1d');
    const { history: dailyHistory } = parseHistory(dailyJson, '1d');

    const validDays = dailyHistory.filter(h => h.close != null);

    // 같은 날짜가 중복되면 마지막 것만 남김 (환율 등 24시간 거래 종목)
    const byDate = new Map();
    for (const day of validDays) {
      const dateKey = day.date.split('T')[0];
      byDate.set(dateKey, day);
    }
    const uniqueDays = [...byDate.values()];

    if (uniqueDays.length >= 2) {
      previousClose = uniqueDays[uniqueDays.length - 2].close;
      previousCloseDate = uniqueDays[uniqueDays.length - 2].date.split('T')[0];
    } else {
      previousClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    }
  } catch (e) {
    previousClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
  }

  // NAVER 보정: 환율은 NAVER에서 현재가를 가져와 보정 (Yahoo FX는 지연될 수 있음)
  if (symbol === 'KRW=X') {
    try {
      const naverRes = await fetch('https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (naverRes.ok) {
        const naver = await naverRes.json();
        const naverPrice = parseFloat(naver.result?.closePrice?.replace(/,/g, ''));
        if (!isNaN(naverPrice) && naverPrice > 0) {
          current = naverPrice;
        }
      }
    } catch (e) {
      // NAVER 실패 시 Yahoo 값 유지
    }
  }

  // lastMarketDate: regularMarketTime 자체의 날짜 (가장 최근 거래일)
  let lastMarketDate = null;
  if (meta.regularMarketTime) {
    const lastD = new Date(meta.regularMarketTime * 1000);
    lastMarketDate = lastD.toISOString().split('T')[0];
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
    lastMarketDate,
    change,
    changePercent,
    currency: meta.currency || info.currency,
    history,
  };

  if (range === '1d' && isIntraday) {
    payload.lastTradeDate = lastTradeDate;
  }

  return payload;
}

// ─── 통합 분기 ───────────────────────────────────────────────────────────────

async function fetchSymbol(symbol, range, interval) {
  if (isNaverSymbol(symbol)) {
    return fetchNaverSymbol(symbol, range, interval);
  }
  return fetchYahooSymbol(symbol, range, interval);
}

// ─── Serverless handler ──────────────────────────────────────────────────────

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
