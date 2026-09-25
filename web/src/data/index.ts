import type { AppConfig } from '../config';
import { ApiDataSource } from './api/ApiDataSource';
import { DemoDataSource } from './demo/DemoDataSource';
import type { DataSource } from './source';

export function createDataSource(config: AppConfig): DataSource {
  return config.source === 'api' ? new ApiDataSource(config.apiUrl) : new DemoDataSource();
}

export type { BreakdownParams, DataSource, Range } from './source';
