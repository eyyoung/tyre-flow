/**
 * 权限控制配置
 *
 * 采用简易 RBAC 模式：
 * - 使用常量定义所有权限点，便于维护和自动补全
 * - 为每个角色配置允许的权限
 */

// ============================================================
// 权限常量定义
// ============================================================

/**
 * 菜单权限常量
 */
export const MENU = {
  DASHBOARD: 'menu:dashboard',
  USERS: 'menu:users',
  COLLECTION_POINTS: 'menu:collection-points',
  STORES: 'menu:stores',
  STORES_IMPORT: 'menu:stores:import',
  STORES_CLEANUP: 'menu:stores:cleanup',
  STORES_TRANSLATE: 'menu:stores:translate',
  VEHICLES: 'menu:vehicles',
  VEHICLES_IMPORT: 'menu:vehicles:import',
  VEHICLES_TRANSLATE: 'menu:vehicles:translate',
  LEDGERS_COLLECTION: 'menu:ledgers:collection',
  LEDGERS_DRIVER: 'menu:ledgers:driver',
  LEDGERS_TRANSFER: 'menu:ledgers:transfer',
  LEDGERS_DRIVER_ANALYSIS: 'menu:ledgers:driver-analysis',
  FACTORIES: 'menu:factories',
  SETTINGS: 'menu:settings',
} as const;

/**
 * 门店操作权限常量
 */
export const STORE = {
  CREATE: 'store:create',
  EDIT: 'store:edit',
  DELETE: 'store:delete',
} as const;

/**
 * 车辆操作权限常量
 */
export const VEHICLE = {
  CREATE: 'vehicle:create',
  EDIT: 'vehicle:edit',
  DELETE: 'vehicle:delete',
} as const;

/**
 * 收集点操作权限常量
 */
export const COLLECTION_POINT = {
  CREATE: 'collection-point:create',
  EDIT: 'collection-point:edit',
  DELETE: 'collection-point:delete',
} as const;

/**
 * 台账任务权限常量
 */
export const LEDGER_TASK = {
  CREATE: 'ledger-task:create',
  DELETE: 'ledger-task:delete',
} as const;

/**
 * 转移任务权限常量
 */
export const TRANSFER_TASK = {
  CREATE: 'transfer-task:create',
  DELETE: 'transfer-task:delete',
} as const;

/**
 * 工厂操作权限常量
 */
export const FACTORY = {
  CREATE: 'factory:create',
  EDIT: 'factory:edit',
  DELETE: 'factory:delete',
} as const;

/**
 * 统一权限常量导出（可选，方便一次性导入所有权限）
 */
export const P = {
  MENU,
  STORE,
  VEHICLE,
  COLLECTION_POINT,
  LEDGER_TASK,
  TRANSFER_TASK,
  FACTORY,
} as const;

// ============================================================
// 类型定义
// ============================================================

/**
 * 从常量对象中提取权限字符串类型
 */
type MenuPermission = (typeof MENU)[keyof typeof MENU];
type StorePermission = (typeof STORE)[keyof typeof STORE];
type VehiclePermission = (typeof VEHICLE)[keyof typeof VEHICLE];
type CollectionPointPermission = (typeof COLLECTION_POINT)[keyof typeof COLLECTION_POINT];
type LedgerTaskPermission = (typeof LEDGER_TASK)[keyof typeof LEDGER_TASK];
type TransferTaskPermission = (typeof TRANSFER_TASK)[keyof typeof TRANSFER_TASK];
type FactoryPermission = (typeof FACTORY)[keyof typeof FACTORY];

/**
 * 所有权限类型的联合类型
 */
export type Permission =
  | MenuPermission
  | StorePermission
  | VehiclePermission
  | CollectionPointPermission
  | LedgerTaskPermission
  | TransferTaskPermission
  | FactoryPermission;

// ============================================================
// 角色权限配置
// ============================================================

/**
 * 角色-权限映射配置
 */
export const rolePermissions: Record<string, Permission[]> = {
  // 超级管理员 - 拥有所有权限
  ADMIN: [
    // 菜单权限
    MENU.DASHBOARD,
    MENU.USERS,
    MENU.COLLECTION_POINTS,
    MENU.STORES,
    MENU.STORES_IMPORT,
    MENU.STORES_CLEANUP,
    MENU.STORES_TRANSLATE,
    MENU.VEHICLES,
    MENU.VEHICLES_IMPORT,
    MENU.VEHICLES_TRANSLATE,
    MENU.LEDGERS_COLLECTION,
    MENU.LEDGERS_DRIVER,
    MENU.LEDGERS_TRANSFER,
    MENU.LEDGERS_DRIVER_ANALYSIS,
    MENU.FACTORIES,
    MENU.SETTINGS,
    // 操作权限
    STORE.CREATE,
    STORE.EDIT,
    STORE.DELETE,
    VEHICLE.CREATE,
    VEHICLE.EDIT,
    VEHICLE.DELETE,
    COLLECTION_POINT.CREATE,
    COLLECTION_POINT.EDIT,
    COLLECTION_POINT.DELETE,
    LEDGER_TASK.CREATE,
    LEDGER_TASK.DELETE,
    TRANSFER_TASK.CREATE,
    TRANSFER_TASK.DELETE,
    FACTORY.CREATE,
    FACTORY.EDIT,
    FACTORY.DELETE,
  ],

  // 收集点审核员 - 只能查看门店列表和台账对账
  USER: [
    // 菜单权限 - 仅查看
    MENU.DASHBOARD,
    MENU.STORES, // 门店列表（只读）
    MENU.LEDGERS_COLLECTION, // 收集台账（只读）
    MENU.LEDGERS_DRIVER, // 司机台账（只读）
    MENU.LEDGERS_TRANSFER, // 转移台账（只读）
    // 无操作权限
  ],
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 检查角色是否拥有指定权限
 */
export function hasPermission(role: string | undefined, permission: Permission): boolean {
  if (!role) return false;
  return rolePermissions[role]?.includes(permission) ?? false;
}

/**
 * 检查角色是否拥有任意一个权限
 */
export function hasAnyPermission(role: string | undefined, permissions: Permission[]): boolean {
  if (!role) return false;
  return permissions.some((p) => hasPermission(role, p));
}

/**
 * 检查角色是否拥有所有权限
 */
export function hasAllPermissions(role: string | undefined, permissions: Permission[]): boolean {
  if (!role) return false;
  return permissions.every((p) => hasPermission(role, p));
}

/**
 * 获取角色的所有权限
 */
export function getRolePermissions(role: string | undefined): Permission[] {
  if (!role) return [];
  return rolePermissions[role] ?? [];
}

