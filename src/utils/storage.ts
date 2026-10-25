import { useState, useEffect, useCallback } from 'react';
import { LocationItem } from '../types';

export function useStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return initialValue;
    }
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Persist after state settles, so functional updates always see the latest value
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue] as const;
}

/** Same saved place: same id, or same coordinates and title. */
export const isSameLocation = (a: LocationItem, b: LocationItem) =>
  a.id === b.id || (a.lat === b.lat && a.lng === b.lng && a.title === b.title);

export const findFavorite = (favorites: LocationItem[], item: LocationItem) =>
  favorites.find((f) => isSameLocation(f, item));

export function useHistory() {
  const [history, setHistory] = useStorage<LocationItem[]>('maps2waze_history', []);

  const addHistory = useCallback((item: Omit<LocationItem, 'id' | 'timestamp'>) => {
    const newItem: LocationItem = {
      ...item,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    setHistory((prev) => [newItem, ...prev].slice(0, 50)); // Keep last 50
  }, [setHistory]);

  const removeHistoryItem = useCallback((id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  }, [setHistory]);

  const clearHistory = useCallback(() => setHistory([]), [setHistory]);

  return { history, addHistory, removeHistoryItem, clearHistory };
}

export function useFavorites() {
  const [favorites, setFavorites] = useStorage<LocationItem[]>('maps2waze_favorites', []);

  const addFavorite = useCallback((item: LocationItem | Omit<LocationItem, 'id' | 'timestamp'>) => {
    const fullItem: LocationItem = 'id' in item ? item : {
      ...item,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    setFavorites((prev) => (findFavorite(prev, fullItem) ? prev : [fullItem, ...prev]));
  }, [setFavorites]);

  const removeFavorite = useCallback((id: string) => {
    setFavorites((prev) => prev.filter(f => f.id !== id));
  }, [setFavorites]);

  return { favorites, addFavorite, removeFavorite };
}
