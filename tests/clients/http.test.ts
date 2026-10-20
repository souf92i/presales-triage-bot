import { describe, expect, it } from 'vitest';
import { requestJson } from '../../src/clients/http.js';

describe('requestJson', () => {
  it('preserves a JSON error body', async () => {
    await expect(requestJson('linear', async () => new Response(JSON.stringify({ errors: [{ message: 'Entity not found: Issue' }] }), { status: 400 }), 'https://api.linear.app/graphql', {})).resolves.toEqual({ status: 400, body: { errors: [{ message: 'Entity not found: Issue' }] } });
  });

  it('returns a null body for empty and non-JSON error responses', async () => {
    await expect(requestJson('linear', async () => new Response(null, { status: 500 }), 'https://api.linear.app/graphql', {})).resolves.toEqual({ status: 500, body: null });
    await expect(requestJson('linear', async () => new Response('not JSON', { status: 502 }), 'https://api.linear.app/graphql', {})).resolves.toEqual({ status: 502, body: null });
  });
});
