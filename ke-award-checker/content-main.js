/**
 * content-main.js — KE Award Checker
 * world: "MAIN" — 페이지의 실제 fetch/XHR 인터셉트
 *
 * ⚠️ 이 스크립트는 MAIN world에서 실행되므로
 *    chrome.runtime, chrome.storage 등 Extension API 사용 불가.
 *    결과는 window.postMessage로 content.js(ISOLATED)에 전달.
 */

(function () {
  'use strict';

  const LOG_PREFIX = '[KE Award Checker]';

  // ── fetch 인터셉트 ──────────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url =
        typeof args[0] === 'string'
          ? args[0]
          : args[0] instanceof Request
          ? args[0].url
          : String(args[0]);

      if (isTargetUrl(url)) {
        const clone = response.clone();
        clone
          .json()
          .then((data) => {
            console.log(LOG_PREFIX, 'fetch intercepted:', url);
            handleApiData(url, data);
          })
          .catch(() => {
            // JSON 파싱 실패 — 무시
          });
      }
    } catch (e) {
      // 인터셉트 자체 오류는 무시 — 원본 응답에 영향 없음
    }

    return response;
  };

  // ── XMLHttpRequest 인터셉트 ─────────────────────────
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._keUrl = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        if (this._keUrl && isTargetUrl(this._keUrl)) {
          const data = JSON.parse(this.responseText);
          console.log(LOG_PREFIX, 'XHR intercepted:', this._keUrl);
          handleApiData(this._keUrl, data);
        }
      } catch (e) {
        // 무시
      }
    });
    return originalXHRSend.apply(this, args);
  };

  // ── URL 필터 ────────────────────────────────────────
  function isTargetUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('award') ||
      lower.includes('availability') ||
      lower.includes('mileage') ||
      lower.includes('calendar-fare-bonus') ||
      lower.includes('calendar') ||
      // 대한항공 실제 API 엔드포인트 후보 (확인 필요)
      lower.includes('/api/') && lower.includes('search')
    );
  }

  // ── API 데이터 처리 ─────────────────────────────────
  function handleApiData(url, data) {
    // 1. 캡처된 원본 데이터를 content.js로 전달 (디버깅 및 분석용)
    window.postMessage(
      {
        type: 'KE_API_CAPTURE',
        payload: { url, data, timestamp: Date.now() },
      },
      '*'
    );

    // 2. 결과 파싱 시도
    const results = tryParseAwardResults(url, data);
    if (results && results.length > 0) {
      window.postMessage(
        {
          type: 'KE_SEARCH_RESULTS',
          payload: results,
        },
        '*'
      );
    }
  }

  // ── 결과 파싱 ───────────────────────────────────────
  /**
   * ⚠️ TODO: 대한항공 실제 API 응답 구조에 맞게 업데이트 필요
   *
   * 현재는 예상 가능한 패턴 기반 heuristic 파싱.
   * 디버깅: DevTools Console에서 "[KE Award Checker] fetch intercepted:" 로그 확인
   *         또는 chrome.storage.local.lastApiCapture 확인
   *
   * 실제 API 구조 파악 방법:
   *   1. 대한항공 마일리지 특가 페이지에서 검색 실행
   *   2. DevTools > Network 탭 > Fetch/XHR 필터
   *   3. "award" 또는 "availability" 관련 요청 찾기
   *   4. Response JSON 구조 확인 후 아래 파싱 로직 업데이트
   */
  function tryParseAwardResults(url, data) {
    if (!data || typeof data !== 'object') return null;

    const results = [];

    // 패턴 A: { dates: [ { date, available, cabinClasses: { C: { miles } } } ] }
    if (Array.isArray(data.dates)) {
      data.dates.forEach((item) => {
        results.push(normalizeItem(item));
      });
      if (results.length > 0) return results;
    }

    // 패턴 B: { data: { availabilities: [ ... ] } }
    const avails =
      data?.data?.availabilities ||
      data?.availabilities ||
      data?.data?.calendar ||
      data?.calendar ||
      data?.result?.dates ||
      data?.results;

    if (Array.isArray(avails)) {
      avails.forEach((item) => {
        results.push(normalizeItem(item));
      });
      if (results.length > 0) return results;
    }

    // 패턴 C: 최상위 배열
    if (Array.isArray(data)) {
      data.forEach((item) => {
        if (item && (item.date || item.departureDate || item.flightDate)) {
          results.push(normalizeItem(item));
        }
      });
      if (results.length > 0) return results;
    }

    return null;
  }

  /**
   * 개별 아이템 정규화
   * ⚠️ 실제 응답 필드명에 맞게 업데이트 필요
   */
  function normalizeItem(item) {
    // 날짜 추출
    const rawDate =
      item.date ||
      item.departureDate ||
      item.flightDate ||
      item.travelDate ||
      '';

    const dateStr = rawDate ? formatDisplayDate(rawDate) : '날짜 불명';

    // 가용 여부 추출
    const available =
      item.available === true ||
      item.isAvailable === true ||
      item.status === 'OPEN' ||
      item.status === 'available' ||
      item.seatAvailable === true ||
      // 캐빈별: C(프레스티지), F(일등석), Y(이코노미)
      item?.cabin?.C?.available === true ||
      item?.cabinClasses?.C?.available === true ||
      false;

    // 마일리지 추출
    const milesRaw =
      item.miles ||
      item.mileage ||
      item.requireMiles ||
      item?.cabin?.C?.miles ||
      item?.cabinClasses?.C?.miles ||
      item?.cabin?.C?.mileage ||
      0;

    const miles = milesRaw
      ? Number(milesRaw).toLocaleString('ko-KR') + ' 마일'
      : '';

    return { date: dateStr, available, miles, raw: item };
  }

  // ── 날짜 포맷 헬퍼 ──────────────────────────────────
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  function formatDisplayDate(raw) {
    try {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return String(raw);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const day = DAY_NAMES[d.getDay()];
      return `${y}-${m}-${dd} (${day})`;
    } catch (e) {
      return String(raw);
    }
  }

  console.log(LOG_PREFIX, 'content-main.js loaded (MAIN world) — fetch/XHR intercepted');
})();
