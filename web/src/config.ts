export type DataSourceKind = 'demo' | 'api';

export interface AppConfig {
  source: DataSourceKind;
  /** Base URL of the Pulse API (empty = same origin). */
  apiUrl: string;
}

/**
 * Build-time defaults come from Vite env (`VITE_DATA_SOURCE`, `VITE_API_URL`);
 * `?source=api&api=https://pulse.example` overrides them at runtime.
 */
export function loadAppConfig(
  search = typeof location === 'undefined' ? '' : location.search,
): AppConfig {
  const params = new URLSearchParams(search);
  const envSource = import.meta.env.VITE_DATA_SOURCE as string | undefined;
  const source = (params.get('source') ?? envSource) === 'api' ? 'api' : 'demo';
  const apiUrl = (
    params.get('api') ??
    (import.meta.env.VITE_API_URL as string | undefined) ??
    ''
  ).replace(/\/$/, '');
  return { source, apiUrl };
}
