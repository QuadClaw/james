/**
 * content.js — KE Award Checker
 * world: "ISOLATED" (기본) — chrome.runtime 메시지 사용
 *
 * 역할:
 *  1. background.js로부터 'search' 메시지 수신
 *  2. DOM 조작으로 대한항공 검색 실행
 *  3. content-main.js(MAIN world)로부터 window.postMessage 수신
 *  4. 결과를 background.js에 전달
 */

(function () {
  'use strict';

  const LOG_PREFIX = '[KE Award Checker]';

  // ── MAIN world 메시지 수신 ────────────────────────────
  // content-main.js가 window.postMessage로 보내는 API 캡처/결과 수신
  window.addEventListener('message', (event) => {
    // 동일 origin만 처리
    if (event.source !== window) return;

    const { type, payload } = event.data || {};

    if (type === 'KE_API_CAPTURE') {
      console.log(LOG_PREFIX, 'API capture received:', payload.url);
      // 디버깅용 — chrome.storage에 저장
      chrome.storage.local.set({
        lastApiCapture: {
          url: payload.url,
          data: payload.data,
          timestamp: payload.timestamp,
        },
      });
    }

    if (type === 'KE_SEARCH_RESULTS') {
      console.log(LOG_PREFIX, 'Search results received:', payload.length, 'items');
      // background.js에 결과 전달
      chrome.runtime.sendMessage({
        action: 'searchResults',
        results: payload,
      });
    }
  });

  // ── background.js 메시지 수신 ────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'search') {
      handleSearch(message.params, sendResponse);
      return true; // async
    }

    if (message.action === 'ping') {
      sendResponse({ status: 'ok', url: window.location.href });
      return false;
    }
  });

  // ── 검색 실행 ────────────────────────────────────────
  async function handleSearch(params, sendResponse) {
    const { origin, destination, departDate, returnDate, cabin } = params;

    console.log(LOG_PREFIX, 'Search requested:', params);

    // 현재 페이지가 마일리지 특가 페이지인지 확인
    if (!window.location.href.includes('best-award') &&
        !window.location.href.includes('award')) {
      // 올바른 페이지로 이동
      window.location.href =
        'https://www.koreanair.com/booking/best-award#/search';
      // 페이지 이동 후 content script가 재로드됨 — 결과는 postMessage로 전달됨
      sendResponse({ status: 'navigating' });
      return;
    }

    // SPA 로딩 대기 후 폼 조작 시도
    await waitForPageReady();

    // 방법 1: DOM 폼 조작
    const formFilled = await fillSearchForm(params);

    if (formFilled) {
      console.log(LOG_PREFIX, 'Form filled, waiting for results...');
      // 결과는 content-main.js의 API 인터셉트로 받음
      sendResponse({ status: 'searching' });
    } else {
      // 방법 2: URL 파라미터 방식 fallback
      console.log(LOG_PREFIX, 'Form fill failed, trying URL navigation...');
      navigateWithParams(params);
      sendResponse({ status: 'navigating' });
    }
  }

  // ── SPA 로딩 대기 ────────────────────────────────────
  function waitForPageReady(timeout = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        // React/Angular/Vue SPA가 마운트됐는지 확인
        // ⚠️ TODO: 실제 대한항공 SPA 진입점 셀렉터로 업데이트
        const appRoot =
          document.querySelector('[class*="booking"]') ||
          document.querySelector('[class*="award"]') ||
          document.querySelector('[class*="search"]') ||
          document.querySelector('app-root') ||
          document.querySelector('#app') ||
          document.querySelector('#root');

        if (appRoot || Date.now() - start > timeout) {
          resolve(!!appRoot);
        } else {
          setTimeout(check, 300);
        }
      };
      check();
    });
  }

  // ── DOM 폼 조작 ──────────────────────────────────────
  /**
   * ⚠️ TODO: 대한항공 실제 폼 셀렉터에 맞게 업데이트 필요
   *
   * 현재는 예상 셀렉터 기반 placeholder.
   * 실제 셀렉터 파악 방법:
   *   1. koreanair.com/booking/best-award 접속
   *   2. DevTools > Elements 탭에서 검색 폼 구조 확인
   *   3. 아래 SELECTORS 객체 업데이트
   */
  const SELECTORS = {
    // 출발지 입력
    origin: [
      'input[placeholder*="출발"]',
      'input[name*="origin"]',
      'input[id*="origin"]',
      '[class*="departure"] input',
      '[class*="origin"] input',
    ],
    // 도착지 입력
    destination: [
      'input[placeholder*="도착"]',
      'input[name*="destination"]',
      'input[id*="destination"]',
      '[class*="arrival"] input',
      '[class*="destination"] input',
    ],
    // 날짜 입력
    departDate: [
      'input[type="date"]',
      'input[placeholder*="출발일"]',
      '[class*="depart"] input',
      '[class*="date"] input:first-of-type',
    ],
    // 검색 버튼
    searchButton: [
      'button[type="submit"]',
      'button[class*="search"]',
      'button[class*="btn-search"]',
      '[class*="search-btn"]',
      'button:contains("검색")',
    ],
  };

  async function fillSearchForm(params) {
    try {
      // 출발지 설정
      const originInput = findElement(SELECTORS.origin);
      if (!originInput) {
        console.log(LOG_PREFIX, 'Origin input not found');
        return false;
      }

      setInputValue(originInput, params.origin);
      await sleep(500);

      // 자동완성 선택 시도
      const originOption = await waitForAutoComplete(params.origin, 2000);
      if (originOption) originOption.click();
      await sleep(300);

      // 도착지 설정
      const destInput = findElement(SELECTORS.destination);
      if (!destInput) return false;

      setInputValue(destInput, params.destination);
      await sleep(500);

      const destOption = await waitForAutoComplete(params.destination, 2000);
      if (destOption) destOption.click();
      await sleep(300);

      // 날짜 설정
      const dateInput = findElement(SELECTORS.departDate);
      if (dateInput) {
        setInputValue(dateInput, params.departDate);
        await sleep(300);
      }

      // 검색 버튼 클릭
      const searchButton = findElement(SELECTORS.searchButton);
      if (searchButton) {
        searchButton.click();
        return true;
      }

      return false;
    } catch (e) {
      console.error(LOG_PREFIX, 'fillSearchForm error:', e);
      return false;
    }
  }

  // ── URL 파라미터 방식 (fallback) ────────────────────
  /**
   * ⚠️ TODO: 대한항공 실제 URL 파라미터 구조 확인 후 업데이트
   * 현재는 예상 파라미터 구조
   */
  function navigateWithParams(params) {
    const { origin, destination, departDate, returnDate, cabin } = params;

    // 예상 URL 구조 (실제 확인 필요)
    const url = new URL('https://www.koreanair.com/booking/best-award');
    url.hash =
      `/search?origin=${origin}&destination=${destination}` +
      `&departDate=${departDate}&returnDate=${returnDate}` +
      `&cabin=${cabin}&tripType=OW`;

    console.log(LOG_PREFIX, 'Navigating to:', url.href);
    window.location.href = url.href;
  }

  // ── 유틸 ─────────────────────────────────────────────
  function findElement(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (e) {
        // 잘못된 셀렉터 무시
      }
    }
    return null;
  }

  function setInputValue(input, value) {
    // React controlled input을 위한 native value setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }

    // 이벤트 dispatch (React/Vue 등 프레임워크 감지용)
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  function waitForAutoComplete(text, timeout) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        // ⚠️ TODO: 실제 자동완성 드롭다운 셀렉터 업데이트 필요
        const options = document.querySelectorAll(
          '[class*="autocomplete"] li, [class*="dropdown"] li, [role="option"]'
        );
        for (const opt of options) {
          if (
            opt.textContent.toUpperCase().includes(text.toUpperCase())
          ) {
            return resolve(opt);
          }
        }
        if (Date.now() - start > timeout) {
          resolve(null);
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  console.log(LOG_PREFIX, 'content.js loaded (ISOLATED world)');
})();
