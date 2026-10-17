import { useCallback, useEffect, useState } from 'react';
import { cachedGet } from './api';

// Loads a cached GET; optional polling for live screens.
export function useData<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (quiet = false) => {
    if (!path) return;
    if (!quiet) setLoading(true);
    try {
      const r = await cachedGet<T>(path);
      setData(r.data); setOffline(r.offline); setUpdatedAt(r.updated_at); setError(null);
    } catch (e: any) {
      if (!quiet) setError(e && e.message ? e.message : 'Could not load data.');
    } finally { if (!quiet) setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => { void load(true); }, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { data, offline, updatedAt, error, loading, reload: () => load() };
}
