type MainRefreshListener = (payload?: { reason?: 'push' | 'manual' }) => void;

const listeners = new Set<MainRefreshListener>();
let pending: { reason?: 'push' | 'manual' } | null = null;

export function subscribeMainRefresh(listener: MainRefreshListener) {
  listeners.add(listener);
  if (pending) {
    listener(pending);
    pending = null;
  }
  return () => {
    listeners.delete(listener);
  };
}

export function triggerMainRefresh(payload?: { reason?: 'push' | 'manual' }) {
  if (listeners.size === 0) {
    pending = payload ?? { reason: 'manual' };
    return;
  }
  for (const listener of listeners) {
    listener(payload);
  }
}
