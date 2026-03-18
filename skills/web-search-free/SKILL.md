---
name: web-search-free
description: >
  Web search without API keys using DuckDuckGo HTML + web_fetch.
  Use when: (1) User asks to search/look up/find information on the web,
  (2) User asks "OOO 검색해줘" or "OOO 찾아봐",
  (3) Need current/recent information not in training data,
  (4) web_search fails due to missing Brave API key.
  Triggers on: 검색, 찾아봐, 찾아줘, 알아봐, search, look up, find, google, 뉴스, news, 최신.
---

# Web Search (No API Key)

Search the web using DuckDuckGo HTML endpoint + `web_fetch`. No API key required.

## Workflow

### Step 1: Search via DuckDuckGo

```
web_fetch("https://html.duckduckgo.com/html/?q=<URL-encoded query>")
```

- URL-encode the query (spaces → `+`, Korean OK)
- For recent results, append `&df=d` (past day), `&df=w` (past week), `&df=m` (past month)
- For Korean results, append `&kl=kr-kr`

### Step 2: Extract Links from Results

DuckDuckGo HTML results contain links in this pattern:

```
//duckduckgo.com/l/?uddg=<encoded-real-url>&rut=...
```

Decode the `uddg` parameter to get the actual URLs. Look for:
- Title text in `## [Title](link)` markdown format
- Snippet text below each link
- Domain shown as `[domain.com/path](link)`

### Step 3: Follow Promising Links

Use `web_fetch` on the most relevant URLs from the results:

```
web_fetch(url, maxChars=5000)
```

- Pick 2-3 most relevant links based on title/snippet
- Fetch and read the content
- Follow additional links if needed for deeper info

### Step 4: Synthesize and Answer

Combine information from multiple sources. Always:
- Cite sources with URLs
- Note when information might be outdated
- If results are insufficient, try rephrasing the query

## Tips

- **Korean searches**: Use Korean query + `&kl=kr-kr` for better Korean results
- **English searches**: Use English query for broader/technical results
- **News**: Add "뉴스" or "news" to query, use `&df=w` for recency
- **Rate limiting**: DuckDuckGo may throttle heavy use. Space out requests.
- **Blocked content**: Some sites block bot fetches. Try alternative sources.
- **Fallback**: If DuckDuckGo fails, try `https://lite.duckduckgo.com/lite/?q=<query>`
