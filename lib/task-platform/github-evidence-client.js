const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';

function githubHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    'x-github-api-version': '2022-11-28',
  };
}

async function fetchGitHubJson({ apiBaseUrl = DEFAULT_GITHUB_API_BASE_URL, fetchImpl, token, route }) {
  const response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}${route}`, {
    headers: githubHeaders(token),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    throw new Error(`GitHub evidence request failed (${response.status}) ${route}: ${body.message || text}`);
  }
  return body;
}

function pageRoute(route, page, perPage) {
  return `${route}${route.includes('?') ? '&' : '?'}per_page=${perPage}&page=${page}`;
}

function arrayEntries(body) {
  return Array.isArray(body) ? body : [];
}

async function fetchGitHubPages({
  apiBaseUrl = DEFAULT_GITHUB_API_BASE_URL,
  fetchImpl,
  token,
  route,
  entries = arrayEntries,
  perPage = 100,
  maxPages = 10,
}) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await fetchGitHubJson({
      apiBaseUrl,
      fetchImpl,
      token,
      route: pageRoute(route, page, perPage),
    });
    const pageItems = entries(body);
    if (!Array.isArray(pageItems)) throw new Error(`GitHub evidence page ${route} did not return an array`);
    items.push(...pageItems);
    if (pageItems.length < perPage) return items;
  }
  throw new Error(`GitHub evidence pagination exceeded ${maxPages} pages for ${route}`);
}

module.exports = {
  DEFAULT_GITHUB_API_BASE_URL,
  fetchGitHubJson,
  fetchGitHubPages,
};
