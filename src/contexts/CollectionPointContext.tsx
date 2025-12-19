"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useLocale } from "next-intl";

interface TranslationCache {
  en?: string;
  [locale: string]: string | undefined;
}

interface CollectionPoint {
  id: string;
  code: string;
  name: string;
  nameTranslations?: TranslationCache | null;
}

interface CollectionPointContextType {
  collectionPoints: CollectionPoint[];
  currentCollectionPoint: CollectionPoint | null;
  setCurrentCollectionPoint: (cp: CollectionPoint | null) => void;
  loading: boolean;
  refetch: () => Promise<void>;
  getTranslatedName: (cp: CollectionPoint | null) => string;
}

const CollectionPointContext = createContext<CollectionPointContextType | null>(
  null
);

const STORAGE_KEY = "tyre-flow-current-cp";

export function CollectionPointProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>(
    []
  );
  const [currentCollectionPoint, setCurrentCollectionPointState] =
    useState<CollectionPoint | null>(null);
  const [loading, setLoading] = useState(true);
  
  // 获取翻译后的收集点名称
  const getTranslatedName = useCallback((cp: CollectionPoint | null): string => {
    if (!cp) return '';
    if (locale === 'zh') return cp.name;
    return cp.nameTranslations?.[locale] || cp.name;
  }, [locale]);

  // 当收集点列表加载完成后，设置默认收集点
  useEffect(() => {
    if (collectionPoints.length === 0) return;

    const savedCpId = localStorage.getItem(STORAGE_KEY);
    
    // 检查保存的收集点是否在当前用户的收集点列表中
    const savedCp = savedCpId 
      ? collectionPoints.find((cp) => cp.id === savedCpId) 
      : null;
    
    if (savedCp) {
      // 保存的收集点有效，使用它
      setCurrentCollectionPointState(savedCp);
    } else {
      // 保存的收集点无效或不存在，使用用户的第一个收集点
      setCurrentCollectionPointState(collectionPoints[0]);
      localStorage.setItem(STORAGE_KEY, collectionPoints[0].id);
    }
  }, [collectionPoints]);

  // 设置当前收集点并保存到 localStorage
  const setCurrentCollectionPoint = useCallback(
    (cp: CollectionPoint | null) => {
      setCurrentCollectionPointState(cp);
      if (cp) {
        localStorage.setItem(STORAGE_KEY, cp.id);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    },
    []
  );

  // 获取收集点列表
  const fetchCollectionPoints = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/collection-points?all=true");
      const result = await response.json();
      if (response.ok) {
        setCollectionPoints(result.data);
      }
    } catch {
      // ignore errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCollectionPoints();
  }, [fetchCollectionPoints]);

  return (
    <CollectionPointContext.Provider
      value={{
        collectionPoints,
        currentCollectionPoint,
        setCurrentCollectionPoint,
        loading,
        refetch: fetchCollectionPoints,
        getTranslatedName,
      }}
    >
      {children}
    </CollectionPointContext.Provider>
  );
}

export function useCollectionPoint() {
  const context = useContext(CollectionPointContext);
  if (!context) {
    throw new Error(
      "useCollectionPoint must be used within a CollectionPointProvider"
    );
  }
  return context;
}
