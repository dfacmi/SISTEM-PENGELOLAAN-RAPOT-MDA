const memoryLocal = new Map<string, string>();
const memorySession = new Map<string, string>();

function readFromStorage(
  kind: 'local' | 'session',
  memory: Map<string, string>,
  key: string
): string | null {
  try {
    if (typeof window !== 'undefined') {
      const store = kind === 'local' ? window.localStorage : window.sessionStorage;
      const val = store.getItem(key);
      if (val !== null) {
        memory.set(key, val);
        return val;
      }
    }
  } catch {
    // Storage blocked by sandboxed iframe or browser privacy mode — fall back to memory
  }
  return memory.get(key) ?? null;
}

function writeToStorage(
  kind: 'local' | 'session',
  memory: Map<string, string>,
  key: string,
  value: string
): void {
  memory.set(key, value);
  try {
    if (typeof window !== 'undefined') {
      const store = kind === 'local' ? window.localStorage : window.sessionStorage;
      store.setItem(key, value);
    }
  } catch {
    // Keep value in in-memory fallback map when Web Storage is restricted
  }
}

function removeFromStorage(
  kind: 'local' | 'session',
  memory: Map<string, string>,
  key: string
): void {
  memory.delete(key);
  try {
    if (typeof window !== 'undefined') {
      const store = kind === 'local' ? window.localStorage : window.sessionStorage;
      store.removeItem(key);
    }
  } catch {
    // Ignore storage removal failure in sandboxed iframes
  }
}

export const safeLocalStorage = {
  getItem: (key: string): string | null => readFromStorage('local', memoryLocal, key),
  setItem: (key: string, value: string): void =>
    writeToStorage('local', memoryLocal, key, value),
  removeItem: (key: string): void => removeFromStorage('local', memoryLocal, key),
};

export const safeSessionStorage = {
  getItem: (key: string): string | null => readFromStorage('session', memorySession, key),
  setItem: (key: string, value: string): void =>
    writeToStorage('session', memorySession, key, value),
  removeItem: (key: string): void => removeFromStorage('session', memorySession, key),
};
