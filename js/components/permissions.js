import { globalState } from '../state.js';
import { supabase } from '../supabaseClient.js';

let cachedPermissions = null;

// Default matrix fallbacks matching the role_permissions schema
const DEFAULT_PERMISSIONS = {
  admin: { can_void_receipts: true, can_apply_manual_discounts: true, can_view_cost_prices: true, can_adjust_inventory: true },
  manager: { can_void_receipts: true, can_apply_manual_discounts: true, can_view_cost_prices: true, can_adjust_inventory: true },
  cashier: { can_void_receipts: false, can_apply_manual_discounts: false, can_view_cost_prices: false, can_adjust_inventory: false },
  staff: { can_void_receipts: false, can_apply_manual_discounts: false, can_view_cost_prices: false, can_adjust_inventory: false },
};

export async function loadRolePermissions() {
  const currentRole = globalState.role || 'cashier';
  const shopId = globalState.activeShopId;

  try {
    let query = supabase.from('role_permissions').select('*').eq('role', currentRole);
    if (shopId) query = query.eq('shop_id', shopId);

    const { data, error } = await query.maybeSingle();
    if (!error && data) {
      cachedPermissions = data;
      return cachedPermissions;
    }
  } catch (err) {
    console.warn('[Permissions] Failed to load remote role matrix, using default fallbacks:', err);
  }

  cachedPermissions = DEFAULT_PERMISSIONS[currentRole] || DEFAULT_PERMISSIONS.cashier;
  return cachedPermissions;
}

export function hasPermission(allowedRoles = ['admin']) {
  if (!globalState.role) return false;
  return allowedRoles.includes(globalState.role);
}

export function isAdmin() {
  return globalState.role === 'admin';
}

export function isManagerOrAbove() {
  return ['admin', 'manager'].includes(globalState.role);
}

// Granular feature action checks
export function canPerformAction(actionKey) {
  if (isAdmin()) return true;
  if (cachedPermissions && actionKey in cachedPermissions) {
    return Boolean(cachedPermissions[actionKey]);
  }
  const role = globalState.role || 'cashier';
  const fallback = DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.cashier;
  return Boolean(fallback[actionKey]);
}

// Scans target container and removes elements the current user lacks privileges to view
export function applyUIPermissions(container = document) {
  const currentRole = globalState.role;

  // 1. Role-based element gating: data-role="admin,manager"
  const restrictedRoles = container.querySelectorAll('[data-role]');
  restrictedRoles.forEach((el) => {
    const rolesRequired = el
      .getAttribute('data-role')
      .split(',')
      .map((r) => r.trim());

    if (!rolesRequired.includes(currentRole)) {
      el.remove();
    }
  });

  // 2. Action-based element gating: data-permission="can_adjust_inventory"
  const restrictedPermissions = container.querySelectorAll('[data-permission]');
  restrictedPermissions.forEach((el) => {
    const permKey = el.getAttribute('data-permission').trim();
    if (!canPerformAction(permKey)) {
      el.remove();
    }
  });
}