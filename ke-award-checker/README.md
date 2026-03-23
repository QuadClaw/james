# KE Award Checker

대한항공 마일리지 특가 프레스티지 좌석 조회 Chrome Extension.

## 설치 방법
1. Chrome에서 `chrome://extensions` 열기
2. "개발자 모드" ON
3. "압축해제된 확장 프로그램을 로드합니다" 클릭
4. 이 폴더 선택

## 사용 방법
1. 대한항공(koreanair.com)에 SKYPASS 계정으로 로그인
2. 확장 프로그램 아이콘 클릭
3. 출발지, 도착지, 날짜 범위, 좌석등급 설정
4. "검색하기" 클릭
5. 결과 확인

## 주의사항
- 대한항공 로그인 상태에서만 동작합니다
- 대한항공 웹사이트 구조 변경 시 업데이트가 필요할 수 있습니다
- ⚠️ `content.js`의 DOM 셀렉터와 `content-main.js`의 파싱 로직은 실제 대한항공 페이지 구조에 맞게 조정 필요

## 파일 구조

```
ke-award-checker/
├── manifest.json       — Chrome Extension 설정 (MV3)
├── popup.html          — 팝업 UI
├── popup.js            — 팝업 로직 (검색 요청, 결과 표시)
├── popup.css           — 다크 테마 스타일
├── content-main.js     — MAIN world: fetch/XHR 인터셉트
├── content.js          — ISOLATED world: chrome.runtime 메시지 처리
├── background.js       — Service Worker: 탭 관리, 메시지 중계
├── icons/              — 아이콘 (placeholder, 교체 필요)
└── README.md
```

## 아키텍처

```
팝업(popup.js)
  │ chrome.runtime.sendMessage('openSearch')
  ▼
background.js (Service Worker)
  │ chrome.tabs.create(koreanair.com)
  │ chrome.tabs.sendMessage('search', params)
  ▼
content.js (ISOLATED world)   ←──── window.postMessage ────  content-main.js (MAIN world)
  │ DOM 폼 조작 / URL 이동                                      │ fetch/XHR 인터셉트
  │                                                             │ API 응답 파싱
  │ chrome.runtime.sendMessage('searchResults')                 │
  ▼
background.js
  │ chrome.storage.local.set(results)
  │ chrome.runtime.sendMessage(popup)   ← popup이 열려있으면 직접 전달
  ▼
popup.js
  결과 렌더링
```

## 개발 메모

### API 인터셉트 방식
- `content-main.js`가 `window.fetch` / `XMLHttpRequest.prototype.send` 를 후킹
- 대한항공 SPA의 내부 API 호출을 캡처하여 결과 파싱
- DOM 파싱보다 안정적 (UI 변경에 덜 민감)

### 디버깅
캡처된 API 구조 확인:
```javascript
// Chrome DevTools > Console (koreanair.com 탭에서)
chrome.storage.local.get('lastApiCapture', console.log);
```

또는 DevTools > Application > Storage > Local Storage > `chrome-extension://...`

### DOM 셀렉터 업데이트 방법
1. `koreanair.com/booking/calendar-fare-bonus` 접속
2. DevTools > Network > Fetch/XHR 필터
3. `award` 또는 `availability` 관련 요청 확인
4. `content-main.js`의 `tryParseAwardResults()` 함수에서 실제 필드명으로 업데이트
5. `content.js`의 `SELECTORS` 객체에서 실제 폼 셀렉터로 업데이트

### 날짜 범위 검색
- 대한항공 API가 한 번에 월별 캘린더를 반환하면 → 한 번 요청으로 여러 날짜 확인 가능
- 날짜별 개별 요청이 필요한 경우 → `popup.js`에서 순차 검색 로직 추가 필요 (throttling 고려)

## 버전 히스토리
- `1.0.0` — 초기 구현 (placeholder DOM 셀렉터, API 인터셉트 기반)
