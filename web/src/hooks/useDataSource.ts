import { createContext, useContext } from 'react';
import type { DataSource } from '../data/source';

export const DataSourceContext = createContext<DataSource | null>(null);

export function useDataSource(): DataSource {
  const ds = useContext(DataSourceContext);
  if (!ds) throw new Error('DataSourceContext is missing');
  return ds;
}
