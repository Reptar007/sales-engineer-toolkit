const LINEAR_GQL = 'https://api.linear.app/graphql';
const REQUEST_TIMEOUT_MS = 10_000;

function linearApiKey() {
  const key = process.env.LINEAR_API_KEY?.trim();
  if (!key) {
    const err = new Error('Linear is not configured');
    err.statusCode = 503;
    throw err;
  }
  return key;
}

/**
 * POST a GraphQL request to Linear with the shared API key.
 * Throws on network failure, non-2xx, or GraphQL errors. Never logs the key.
 * @param {string} query
 * @param {Record<string, unknown>} [variables]
 * @returns {Promise<unknown>} GraphQL `data` payload
 */
export async function linearGraphQL(query, variables = {}) {
  const apiKey = linearApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(LINEAR_GQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.error('Linear GraphQL: request timed out after', REQUEST_TIMEOUT_MS, 'ms');
      const e = new Error('Linear request timed out');
      e.statusCode = 504;
      throw e;
    }
    console.error('Linear GraphQL: network error:', err.message);
    throw err;
  }
  clearTimeout(timer);

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = body?.errors?.[0]?.message || `Linear HTTP ${res.status}`;
    console.error('Linear GraphQL: HTTP', res.status, message);
    const e = new Error(message);
    e.statusCode = res.status;
    throw e;
  }
  if (body.errors?.length) {
    const message = body.errors[0].message || 'Linear GraphQL error';
    console.error('Linear GraphQL: error:', message);
    throw new Error(message);
  }
  return body.data;
}

const RESOLVE_BY_EMAIL = `
  query ResolveLinearUserByEmail($email: String!) {
    users(filter: { email: { eq: $email } }, first: 1) {
      nodes { id email name }
    }
  }
`;

/**
 * Look up a Linear user by their email address.
 * @param {string} email
 * @returns {Promise<{id: string, email: string, name: string} | null>}
 */
export async function resolveLinearUserByEmail(email) {
  if (!email?.trim()) return null;
  const data = await linearGraphQL(RESOLVE_BY_EMAIL, { email: email.trim() });
  return data?.users?.nodes?.[0] ?? null;
}

const RESOLVE_BY_ID = `
  query ResolveLinearUserById($id: ID!) {
    users(filter: { id: { eq: $id } }, first: 1) {
      nodes { id email name }
    }
  }
`;

/**
 * Look up a Linear user by their UUID. Useful for validating a user-supplied id.
 * @param {string} id
 * @returns {Promise<{id: string, email: string, name: string} | null>}
 */
export async function resolveLinearUserById(id) {
  if (!id?.trim()) return null;
  const data = await linearGraphQL(RESOLVE_BY_ID, { id: id.trim() });
  return data?.users?.nodes?.[0] ?? null;
}
