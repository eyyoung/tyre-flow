'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  Permission,
} from '@/lib/permissions';

interface User {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  role: 'ADMIN' | 'USER';
  status: 'ACTIVE' | 'DISABLED';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /**
   * 检查当前用户是否拥有指定权限
   */
  can: (permission: Permission) => boolean;
  /**
   * 检查当前用户是否拥有任意一个权限
   */
  canAny: (permissions: Permission[]) => boolean;
  /**
   * 检查当前用户是否拥有所有权限
   */
  canAll: (permissions: Permission[]) => boolean;
  /**
   * 是否为管理员
   */
  isAdmin: boolean;
  /**
   * 重新获取用户信息
   */
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me');
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const can = useCallback(
    (permission: Permission) => hasPermission(user?.role, permission),
    [user?.role]
  );

  const canAny = useCallback(
    (permissions: Permission[]) => hasAnyPermission(user?.role, permissions),
    [user?.role]
  );

  const canAll = useCallback(
    (permissions: Permission[]) => hasAllPermissions(user?.role, permissions),
    [user?.role]
  );

  const isAdmin = user?.role === 'ADMIN';

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        can,
        canAny,
        canAll,
        isAdmin,
        refetch: fetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

