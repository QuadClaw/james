module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600'); // 5분 캐시

  try {
    const response = await fetch('https://finance.naver.com/sise/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const buf = await response.arrayBuffer();
    const html = new TextDecoder('euc-kr').decode(buf);

    // HTML 태그 제거 후 텍스트 추출
    // 주요 투자자 데이터는 세 세트로 반복됨:
    // 1세트: 코스피, 2세트: 코스닥, 3세트: 전체
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // 각 투자자 유형별로 모든 금액 추출
    function extractAmounts(investorName) {
      const amounts = [];
      const regex = new RegExp(investorName + '[^+-\\d]{0,20}([+-][\\d,]+)\\s*억', 'g');
      let match;
      while ((match = regex.exec(text)) !== null) {
        const val = parseInt(match[1].replace(/,/g, ''), 10);
        amounts.push(val);
      }
      return amounts;
    }

    const institutional = extractAmounts('기관');
    const individual = extractAmounts('개인');
    const foreign = extractAmounts('외국인');

    // 순서: [0]=코스피, [1]=코스닥, [2]=전체 (또는 없을 수 있음)
    const result = {
      kospi: {
        institutional: institutional[0] ?? null, // 억 단위
        individual: individual[0] ?? null,
        foreign: foreign[0] ?? null,
      },
      kosdaq: {
        institutional: institutional[1] ?? null,
        individual: individual[1] ?? null,
        foreign: foreign[1] ?? null,
      },
    };

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch investor data', message: err.message });
  }
};
