import { describe, expect, it, vi } from 'vitest';
import { ApiDataSource, ApiError } from '../src/data/api/ApiDataSource';
import { loadAppConfig } from '../src/config';

describe('ApiDataSource', () => {
  it('builds query strings and parses JSON', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ dimension: 'page', total: 0, rows: [] })),
    );
    const api = new ApiDataSource('https://pulse.example', fetchMock as unknown as typeof fetch);
    await api.breakdown('my site', { from: 1, to: 2 }, { dimension: 'page', limit: 10 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://pulse.example/api/sites/my%20site/breakdown?from=1&to=2&dimension=page&limit=10',
    );
    expect(api.exportUrl('s', { from: 1, to: 2 }, 'country')).toBe(
      'https://pulse.example/api/sites/s/export.csv?from=1&to=2&dimension=country',
    );
  });

  it('throws ApiError on HTTP errors', async () => {
    const api = new ApiDataSource(
      '',
      (async () =>
        new Response('nope', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch,
    );
    await expect(api.sites()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('config', () => {
  it('defaults to demo mode and lets the URL switch to the real API', () => {
    expect(loadAppConfig('')).toEqual({ source: 'demo', apiUrl: '' });
    expect(loadAppConfig('?source=api&api=https://pulse.example/')).toEqual({
      source: 'api',
      apiUrl: 'https://pulse.example',
    });
  });
});
