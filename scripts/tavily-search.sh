#!/bin/bash
# Tavily Search - 간단 래퍼
# 사용법: ./tavily-search.sh "검색어" [결과수]
QUERY="$1"
MAX="${2:-5}"

curl -s -X POST "https://api.tavily.com/search" \
  -H "Content-Type: application/json" \
  -d "{
    \"api_key\": \"$TAVILY_API_KEY\",
    \"query\": \"$QUERY\",
    \"max_results\": $MAX,
    \"include_answer\": true
  }" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'answer' in d and d['answer']:
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
