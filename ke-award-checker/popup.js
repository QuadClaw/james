/**
 * popup.js — KE Award Checker
 * 팝업 UI 제어 및 검색 로직
 */

// ── 상수 ─────────────────────────────────────────────
const AWARD_URL = 'https://www.koreanair.com/booking/best-award#/search';
const STORAGE_KEY_PARAMS  = 'ke_last_params';
const STORAGE_KEY_RESULTS = 'searchResults';
const STORAGE_KEY_TS      = 'searchTimestamp';

// 결과 캐시 유효 시간: 5분
const RESULT_TTL_MS = 5 * 60 * 1000;

// ── DOM 참조 ──────────────────────────────────────────
const originEl           = document.getElementById('origin');
const destinationEl      = document.getElementById('destination');
const departDateEl       = document.getElementById('departDate');
const returnDateEl       = document.getElementById('returnDate');
const cabinEl            = document.getElementById('cabin');
const searchBtn          = document.getElementById('searchBtn');
const resultArea         = document.getElementById('resultArea');
const showOnlyAvailable  = document.getElementById('showOnlyAvailable');
const swapBtn            = document.getElementById('swapBtn');

// ── 초기화 ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 기본 날짜 설정 (오늘 ~ 오늘+30일)
  const today = new Date();
  const plus30 = new Date(today);
  plus30.setDate(today.getDate() + 30);

  departDateEl.value = formatDate(today);
  returnDateEl.value = formatDate(plus30);

  // 저장된 마지막 검색 조건 복원
  await restoreLastParams();

  // 저장된 검색 결과 복원 (5분 이내)
  await restoreResults();

  // 이벤트 바인딩
  searchBtn.addEventListener('click', onSearch);
  swapBtn.addEventListener('click', onSwap);
  showOnlyAvailable.addEventListener('change', onToggleFilter);
});

// ── 마지막 검색 조건 복원 ─────────────────────────────
async function restoreLastParams() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_PARAMS], (data) => {
      const p = data[STORAGE_KEY_PARAMS];
      if (p) {
        if (p.origin)       originEl.value       = p.origin;
        if (p.destination)  destinationEl.value  = p.destination;
        if (p.departDate)   departDateEl.value   = p.departDate;
        if (p.returnDate)   returnDateEl.value   = p.returnDate;
        if (p.cabin)        cabinEl.value        = p.cabin;
      }
      resolve();
    });
  });
}

// ── 저장된 결과 복원 ──────────────────────────────────
async function restoreResults() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_RESULTS, STORAGE_KEY_TS], (data) => {
      const results = data[STORAGE_KEY_RESULTS];
      const ts      = data[STORAGE_KEY_TS];
      if (results && ts && Date.now() - ts < RESULT_TTL_MS) {
        renderResults(results);
      }
      resolve();
    });
  });
}

// ── 검색 실행 ─────────────────────────────────────────
async function onSearch() {
  const origin      = originEl.value;
  const destination = destinationEl.value;
  const departDate  = departDateEl.value;
  const returnDate  = returnDateEl.value;
  const cabin       = cabinEl.value;

  // 유효성 검사
  if (!departDate || !returnDate) {
    showError('출발일과 종료일을 입력하세요.');
    return;
  }
  if (departDate > returnDate) {
    showError('출발일이 종료일보다 늦을 수 없습니다.');
    return;
  }
  if (origin === destination) {
    showError('출발지와 도착지가 같습니다.');
    return;
  }

  const params = { origin, destination, departDate, returnDate, cabin };

  // 마지막 검색 조건 저장
  chrome.storage.local.set({ [STORAGE_KEY_PARAMS]: params });

  // 로딩 표시
  setLoading(true);

  // background.js에 탭 열기 + 검색 요청
  chrome.runtime.sendMessage(
    {
      action: 'openSearch',
      url: AWARD_URL,
      params,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        showError('백그라운드 연결 오류: ' + chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      // tabId를 받아서 결과 대기 (background가 storage에 저장)
      waitForResults(response?.tabId);
    }
  );
}

// ── 결과 대기 (폴링) ──────────────────────────────────
// background.js가 chrome.storage.local에 결과를 쓰면 이를 감지
function waitForResults(tabId) {
  const startTime = Date.now();
  const TIMEOUT_MS = 60000; // 60초 타임아웃
  const POLL_INTERVAL_MS = 1000;

  // 이전 타임스탬프 기억 (갱신 여부 판단)
  chrome.storage.local.get([STORAGE_KEY_TS], ({ [STORAGE_KEY_TS]: prevTs }) => {
    const poll = setInterval(() => {
      if (Date.now() - startTime > TIMEOUT_MS) {
        clearInterval(poll);
        showError('⏱️ 검색 시간이 초과되었습니다. 대한항공 사이트에서 직접 확인하세요.');
        setLoading(false);
        return;
      }

      chrome.storage.local.get([STORAGE_KEY_RESULTS, STORAGE_KEY_TS], (data) => {
        const ts = data[STORAGE_KEY_TS];
        // 이전보다 최신 타임스탬프 → 새 결과
        if (ts && ts !== prevTs) {
          clearInterval(poll);
          setLoading(false);
          const results = data[STORAGE_KEY_RESULTS];
          if (results) {
            renderResults(results);
          } else {
            showError('결과를 불러오지 못했습니다.');
          }
        }
      });
    }, POLL_INTERVAL_MS);
  });
}

// ── 결과 렌더링 ───────────────────────────────────────
let _lastResults = [];

function renderResults(results) {
  _lastResults = results;
  applyFilter();
}

function applyFilter() {
  const onlyAvail = showOnlyAvailable.checked;
  const filtered = onlyAvail
    ? _lastResults.filter((r) => r.available)
    : _lastResults;

  resultArea.innerHTML = '';

  if (filtered.length === 0) {
    resultArea.innerHTML = onlyAvail
      ? '<div class="result-placeholder">가능한 날짜가 없습니다 ❌</div>'
      : '<div class="result-placeholder">검색 결과가 없습니다</div>';
    return;
  }

  const availCount = _lastResults.filter((r) => r.available).length;
  const summary = document.createElement('div');
  summary.className = 'result-summary';
  summary.textContent = `총 ${_lastResults.length}일 중 ${availCount}일 가능`;
  resultArea.appendChild(summary);

  filtered.forEach((item) => {
    const el = document.createElement('div');
    el.className = `result-item ${item.available ? 'available' : 'unavailable'}`;
    el.innerHTML = `
      <span class="date">${item.date}</span>
      <span class="status">${item.available ? '✅ 가능' : '❌ 불가'}</span>
      <span class="miles">${item.miles || (item.available ? '—' : '')}</span>
    `;
    resultArea.appendChild(el);
  });
}

// ── 필터 토글 ─────────────────────────────────────────
function onToggleFilter() {
  if (_lastResults.length > 0) {
    applyFilter();
  }
}

// ── 출발/도착 교환 ────────────────────────────────────
function onSwap() {
  const tmp = originEl.value;
  originEl.value = destinationEl.value;
  destinationEl.value = tmp;
}

// ── UI 헬퍼 ──────────────────────────────────────────
function setLoading(on) {
  searchBtn.disabled = on;
  if (on) {
    resultArea.innerHTML = '<div class="loading">검색 중...</div>';
  }
}

function showError(msg) {
  resultArea.innerHTML = `<div class="result-error">${msg}</div>`;
}

// ── 날짜 포맷 (YYYY-MM-DD) ────────────────────────────
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ── background로부터 실시간 메시지 수신 ──────────────
// (background가 storage 저장 없이 직접 relay할 경우 대비)
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'searchResults') {
    setLoading(false);
    renderResults(message.results);
  }
  if (message.action === 'searchError') {
    setLoading(false);
    showError(message.error || '검색 중 오류가 발생했습니다.');
  }
});
