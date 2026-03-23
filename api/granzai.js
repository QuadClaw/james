module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  try {
    // 1. NAVER 모바일 검색으로 매물 정보 스크래핑
    const searchUrl = 'https://m.search.naver.com/search.naver?query=' + encodeURIComponent('서초그랑자이 59 매매 매물');
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });
    const html = await response.text();

    // 2. HTML에서 데이터 추출
    const data = parseNaverSearch(html);

    // 3. 두 번째 검색: 실거래가 정보
    const searchUrl2 = 'https://m.search.naver.com/search.naver?query=' + encodeURIComponent('서초그랑자이 매매');
    const response2 = await fetch(searchUrl2, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });
    const html2 = await response2.text();
    const complexInfo = parseComplexInfo(html2);

    res.json({
      complex: {
        name: '서초그랑자이',
        address: '서울 서초구 서초동 1757',
        totalUnits: '1,446세대',
        buildings: '총 9동',
        area: '59.98㎡ (전용) / 83.85㎡ (공급)',
        pyeong: '25평',
        naverLandUrl: 'https://new.land.naver.com/complexes/126726?ms=37.489144,127.025957,17&a=APT:ABYG:JGC:PRE&e=RETAIL&ad=true',
        ...complexInfo,
      },
      listings: data.listings,
      recentTrades: data.recentTrades,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

function parseNaverSearch(html) {
  const listings = [];
  const recentTrades = [];

  // 패턴 1: "매매가 XX억 (XX향)" 또는 "매매 XX억XXXX (XX향)"
  const pricePattern = /매매[가\s]*(\d+억[\s\d,]*만?(?:원)?)\s*(?:\(([^)]+향)\))?/g;
  let match;
  while ((match = pricePattern.exec(html)) !== null) {
    listings.push({
      price: match[1].trim(),
      direction: match[2] || null,
    });
  }

  // 패턴 2: 블로그 매물에서 추출: "가격 XX억", "호가 XX억"
  const blogPrices = html.match(/(?:가액|호가|매매가|시세)\s*(\d+억[\s\d,]*(?:천)?만?(?:원)?)/g) || [];
  blogPrices.forEach(bp => {
    const priceMatch = bp.match(/(\d+억[\s\d,]*(?:천)?만?(?:원)?)/);
    if (priceMatch) {
      const price = priceMatch[1].trim();
      if (!listings.some(l => l.price === price)) {
        listings.push({ price, direction: null });
      }
    }
  });

  // 패턴 3: 실거래가 데이터 "20XX.XX. XX억XXXX" 패턴
  const tradePattern = /(\d{4})[./년]?\s*(\d{1,2})[./월]?\s*[^<]{0,30}?(\d+억[\s\d,]*만?)/g;
  while ((match = tradePattern.exec(html)) !== null) {
    const year = match[1];
    const month = match[2];
    const price = match[3].trim();
    if (parseInt(year) >= 2024) {
      recentTrades.push({
        date: `${year}.${month.padStart(2, '0')}`,
        price,
      });
    }
  }

  // 중복 제거
  const uniqueListings = [];
  const seenPrices = new Set();
  listings.forEach(l => {
    const key = l.price.replace(/\s/g, '');
    if (!seenPrices.has(key)) {
      seenPrices.add(key);
      uniqueListings.push(l);
    }
  });

  const uniqueTrades = [];
  const seenTrades = new Set();
  recentTrades.forEach(t => {
    const key = t.date + t.price.replace(/\s/g, '');
    if (!seenTrades.has(key)) {
      seenTrades.add(key);
      uniqueTrades.push(t);
    }
  });

  return { listings: uniqueListings, recentTrades: uniqueTrades };
}

function parseComplexInfo(html) {
  const info = {};

  // 최저가/최고가 추출
  const rangeMatch = html.match(/최저가[:\s]*(\d+억[\s\d,]*),?\s*최고가[:\s]*(\d+억[\s\d,]*)/);
  if (rangeMatch) {
    info.priceMin = rangeMatch[1].trim();
    info.priceMax = rangeMatch[2].trim();
  }

  // 최근 매매가
  const recentMatch = html.match(/최근\s*매매가?\s*(\d+억[\s\d,]*만?)/);
  if (recentMatch) {
    info.recentPrice = recentMatch[1].trim();
  }

  return info;
}
