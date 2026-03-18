---
name: tavily-search
description: >
  Fast web search using Tavily API. Preferred over DuckDuckGo (no CAPTCHA issues).
  Use when: (1) Need to search the web for current information,
  (2) web_search (Brave) is unavailable,
  (3) DuckDuckGo is CAPTCHA-blocked,
  (4) Need AI-summarized search results.
  Requires: TAVILY_API_KEY environment variable.
  Triggers on: 검색, 찾아봐, 찾아줘, 알아봐, search, look up, find, 뉴스, news, 최신.
---

# Tavily Search

Fast, reliable web search via Tavily REST API. No MCP needed.

## Prerequisites

`TAVILY_API_KEY` must be set in gateway environment variables.

## Quick Search (exec + curl)

```bash
curl -s -X POST "https://api.tavily.com/search" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "'"$TAVILY_API_KEY"'",
    "query": "검색어",
    "max_results": 5,
    "include_answer": true
  }' | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('answer'):
    print('=== 요약 ===')
    print(d['answer'])
    print()
print('=== 결과 ===')
for i, r in enumerate(d.get('results', []), 1):
    print(f'{i}. {r[\"title\"]}')
    print(f'   {r[\"url\"]}')
    print(f'   {r.get(\"content\", \"\")[:200]}')
    print()
"
```

## Helper Script

A wrapper script is available at `scripts/tavily-search.sh`:

```bash
# 기본 검색 (결과 5개)
bash scripts/tavily-search.sh "AI agent 2026"

# 결과 수 지정
bash scripts/tavily-search.sh "OpenClaw multi-agent" 10
```

## API Parameters

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| `query` | (필수) | 검색어 |
| `max_results` | 5 | 결과 수 (1-20) |
| `include_answer` | false | AI 요약 포함 여부 |
| `search_depth` | "basic" | "basic" 또는 "advanced" (더 깊은 검색) |
| `topic` | "general" | "general" 또는 "news" |
| `days` | 3 | topic=news일 때 최근 N일 |
| `include_raw_content` | false | 페이지 전체 텍스트 포함 |

## Usage Patterns

### 뉴스 검색
```bash
curl -s -X POST "https://api.tavily.com/search" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "'"$TAVILY_API_KEY"'",
    "query": "AI news march 2026",
    "topic": "news",
    "days": 7,
    "max_results": 10,
    "include_answer": true
  }'
```

### 심층 검색
```bash
curl -s -X POST "https://api.tavily.com/search" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "'"$TAVILY_API_KEY"'",
    "query": "MCP vs CLI agent tools comparison",
    "search_depth": "advanced",
    "max_results": 10,
    "include_answer": true,
    "include_raw_content": true
  }'
```

### 결과를 파일로 저장 (서브에이전트용)
```bash
curl -s -X POST "https://api.tavily.com/search" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "'"$TAVILY_API_KEY"'",
    "query": "검색어",
    "max_results": 10,
    "include_answer": true
  }' > /tmp/search-results.json
```

## Priority Order

1. Tavily (이 스킬) — 가장 안정적, AI 요약 포함, CAPTCHA 없음
2. web_fetch + DuckDuckGo (web-search-free 스킬) — API 키 불필요, 백업용
3. web_search (Brave) — Brave API 키 있으면 사용

## Tavily vs DuckDuckGo

| | Tavily | DuckDuckGo (web_fetch) |
|---|---|---|
| CAPTCHA | ❌ 없음 | ⚠️ 빈번 |
| AI 요약 | ✅ include_answer | ❌ |
| 속도 | 빠름 | 보통 |
| 비용 | 무료 1000회/월 | 무료 |
| 안정성 | ✅ 높음 | △ 불안정 |
