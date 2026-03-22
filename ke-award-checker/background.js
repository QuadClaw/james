/**
 * background.js — KE Award Checker Service Worker
 *
 * 역할:
 *  1. 팝업으로부터 'openSearch' 메시지 수신 → 대한항공 탭 열기
 *  2. 탭 로딩 완료 후 content.js에 검색 파라미터 전달
 *  3. content.js로부터 'searchResults' 메시지 수신 → storage 저장 + 팝업에 relay
 */

'use strict';

const LOG_PREFIX = '[KE Award Checker BG]';

// ── 메시지 리스너 ──────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── 검색 탭 열기 ──────────────────────────────────
  if (message.action === 'openSearch') {
    handleOpenSearch(message, sendResponse);
    return true; // async
  }

  // ── content.js → storage 저장 + 팝업 relay ────────
  if (message.action === 'searchResults') {
    handleSearchResults(message.results);
    sendResponse({ ok: true });
    return false;
  }

  // ── 오류 전달 ──────────────────────────────────────
  if (message.action === 'searchError') {
    handleSearchError(message.error);
    sendResponse({ ok: true });
    return false;
  }

});

// ── 검색 탭 열기 로직 ─────────────────────────────────
async function handleOpenSearch(message, sendResponse) {
  const { url, params } = message;

  // 이미 열려 있는 koreanair.com 탭 재사용 (중복 탭 방지)
  const existingTabs = await chrome.tabs.query({
    url: 'https://www.koreanair.com/*',
  });

  let tab;
  if (existingTabs.length > 0) {
    // 기존 탭 재사용 — URL만 업데이트
    tab = existingTabs[0];
    await chrome.tabs.update(tab.id, { url, active: false });
    console.log(LOG_PREFIX, 'Reusing existing KE tab:', tab.id);
  } else {
    // 새 탭 생성 (백그라운드)
    tab = await chrome.tabs.create({ url, active: false });
    console.log(LOG_PREFIX, 'Created new KE tab:', tab.id);
  }

  sendResponse({ tabId: tab.id });

  // 탭 로딩 완료 대기 → content.js에 검색 파라미터 전달
  waitForTabComplete(tab.id, params);
}

// ── 탭 로딩 완료 대기 ─────────────────────────────────
function waitForTabComplete(tabId, params) {
  const listener = async (updatedTabId, info) => {
    if (updatedTabId !== tabId) return;
    if (info.status !== 'complete') return;

    chrome.tabs.onUpdated.removeListener(listener);
    console.log(LOG_PREFIX, 'Tab complete, sending search params to content.js');

    // content.js가 로드될 시간을 잠깐 대기
    await sleep(500);

    // content.js에 검색 파라미터 전달
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'search',
        params,
      });
      console.log(LOG_PREFIX, 'Search params sent to content.js');
    } catch (e) {
      // content.js가 아직 준비 안 됐을 경우 재시도
      console.log(LOG_PREFIX, 'Retrying message to content.js...', e.message);
      await sleep(1500);
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'search',
          params,
        });
      } catch (e2) {
        console.error(LOG_PREFIX, 'Failed to send to content.js:', e2.message);
        // 팝업에 에러 알림
        relayErrorToPopup('content.js 연결 실패. 대한항공 탭이 완전히 로드됐는지 확인하세요.');
      }
    }
  };

  chrome.tabs.onUpdated.addListener(listener);

  // 30초 후 리스너 자동 정리 (메모리 누수 방지)
  setTimeout(() => {
    chrome.tabs.onUpdated.removeListener(listener);
  }, 30000);
}

// ── 검색 결과 처리 ────────────────────────────────────
function handleSearchResults(results) {
  console.log(LOG_PREFIX, 'Search results received:', results?.length, 'items');

  // storage에 저장 (팝업 폴링용)
  chrome.storage.local.set({
    searchResults: results,
    searchTimestamp: Date.now(),
  });

  // 열려있는 팝업에 직접 relay (빠른 응답용)
  relayToPopup({ action: 'searchResults', results });
}

// ── 에러 처리 ─────────────────────────────────────────
function handleSearchError(error) {
  console.error(LOG_PREFIX, 'Search error:', error);
  relayErrorToPopup(error);
}

function relayErrorToPopup(error) {
  relayToPopup({ action: 'searchError', error });
}

// ── 팝업에 메시지 relay ───────────────────────────────
async function relayToPopup(message) {
  try {
    // 팝업이 열려있을 때만 전달됨 (닫혀있으면 무시)
    await chrome.runtime.sendMessage(message);
  } catch (e) {
    // 팝업 닫혀있으면 에러 발생 — 무시
  }
}

// ── 유틸 ─────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 설치/업데이트 시 초기화 ──────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  console.log(LOG_PREFIX, 'Installed/Updated:', details.reason);
  // 저장된 데이터 초기화 (버전 업데이트 시)
  if (details.reason === 'update') {
    chrome.storage.local.remove(['searchResults', 'searchTimestamp', 'lastApiCapture']);
  }
});

console.log(LOG_PREFIX, 'Service worker started');
