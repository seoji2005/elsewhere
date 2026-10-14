export interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function localStorageAdapter(): Storage {
  return { getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value) };
}
