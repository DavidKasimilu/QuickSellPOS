import { supabase } from '../supabaseClient.js';

// =========================================================================
// Rights catalogue: every right a role can be given.
//   "<module>.view"    can open the pages of that module
//   "<module>.manage"  can also create / edit / delete (implies view)
//   "can_*"            POS actions (same keys the role_permissions table already used)
//   "*"                everything (Administrator)
// =========================================================================
export const RIGHT_GROUPS = [
  { key: 'dashboard', label: 'Dashboard', hint: 'Sales overview', view: 'dashboard.view' },
  { key: 'sales', label: 'Sales & reports', hint: 'Receipts, refunds, shifts, sales reports', view: 'sales.view' },
  { key: 'products', label: 'Products & catalog', hint: 'Products, categories, modifiers, units', view: 'products.view', manage: 'products.manage' },
  { key: 'inventory', label: 'Inventory & stock', hint: 'Stock, purchase orders, adjustments, suppliers', view: 'inventory.view', manage: 'inventory.manage' },
  { key: 'customers', label: 'Customers & debts', hint: 'Customers, loyalty, debtors, settlements', view: 'customers.view', manage: 'customers.manage' },
  { key: 'discounts', label: 'Discounts & pricing', hint: 'Discount plans, pricing plans, price change', view: 'discounts.view', manage: 'discounts.manage' },
  { key: 'employees', label: 'Employees', hint: 'Employees, other staff, commissions, access logs', view: 'employees.view', manage: 'employees.manage' },
  { key: 'roles', label: 'Roles & permissions', hint: 'Create roles and choose their rights', view: 'roles.view', manage: 'roles.manage' },
  { key: 'settings', label: 'Settings', hint: 'Store settings, taxes, payment types, shops, devices', view: 'settings.view', manage: 'settings.manage' },
];

export const POS_RIGHTS = [
  { key: 'can_void_receipts', label: 'Void and delete receipts' },
  { key: 'can_apply_manual_discounts', label: 'Give manual discounts at the register' },
  { key: 'can_view_cost_prices', label: 'See cost prices and margins' },
  { key: 'can_adjust_inventory', label: 'Adjust stock counts' },
];

export const BACKOFFICE_RIGHT_KEYS = RIGHT_GROUPS.flatMap((g) => [g.view, g.manage].filter(Boolean));
export const POS_RIGHT_KEYS = POS_RIGHTS.map((r) => r.key);

// Which right opens which page
const R = (right, hashes) => Object.fromEntries(hashes.map((h) => [h, right]));
export const ROUTE_RIGHT = {
  ...R('dashboard.view', ['#dashboard']),
  ...R('sales.view', ['#sales-summary', '#shifts']),
  ...R('products.view', ['#products', '#categories', '#modifiers', '#measurements', '#barcode-generator', '#deleted-items']),
  ...R('inventory.view', [
    '#available-inventory', '#purchase-orders', '#goods-received-note', '#purchase-return-note', '#stock-adjustments',
    '#transfer-of-goods', '#inventory-counts', '#productions', '#suppliers', '#supplier-credit-management',
    '#inventory-history-report', '#inventory-expiry-report', '#inventory-valuation-report', '#inventory-summary-report',
    '#backdate-inventory-report', '#supplier-credit-settlements-report',
  ]),
  ...R('customers.view', ['#customers', '#loyalty', '#debtor-management', '#debtor', '#credit-settlements', '#settlement-by-payment-types']),
  ...R('discounts.view', ['#discount-plans', '#pricing-plans', '#price-change']),
  ...R('employees.view', ['#employees', '#other-staff', '#staff-commissions', '#access-logs']),
  ...R('roles.view', ['#access-rights']),
  ...R('settings.view', ['#settings']),
};

// Which right shows a sidebar icon
export const MENU_RIGHT = {
  sales: 'sales.view',
  products: 'products.view',
  inventory: 'inventory.view',
  customers: 'customers.view',
  discounts: 'discounts.view',
  employees: 'employees.view',
  settings: 'settings.view',
};

// Where to send someone whose first page is not allowed
export const FALLBACK_ROUTES = [
  '#dashboard', '#sales-summary', '#products', '#available-inventory', '#customers', '#discount-plans', '#employees', '#settings',
];

// Rights by security tier, used when an employee has no role row yet (same as default_rights() in SQL)
export const TIER_DEFAULT_RIGHTS = {
  admin: ['*'],
  owner: ['*'],
  manager: [
    'dashboard.view', 'sales.view', 'products.manage', 'inventory.manage', 'customers.manage', 'discounts.manage',
    'employees.manage', 'roles.view', 'settings.view',
    'can_void_receipts', 'can_apply_manual_discounts', 'can_view_cost_prices', 'can_adjust_inventory',
  ],
  cashier: [],
  staff: [],
};

// "x.manage" implies "x.view"
export function expandRights(list = []) {
  const out = new Set(list);
  list.forEach((k) => {
    if (typeof k === 'string' && k.endsWith('.manage')) out.add(k.replace(/\.manage$/, '.view'));
  });
  return [...out];
}

export function rightsInclude(list = [], key) {
  return list.includes('*') || expandRights(list).includes(key);
}

export function effectiveRights(tier, accessRole) {
  if (['admin', 'owner'].includes(tier)) return ['*'];
  if (accessRole && Array.isArray(accessRole.rights)) return accessRole.rights;
  return TIER_DEFAULT_RIGHTS[tier] || [];
}

// =========================================================================
// Roles of the signed-in person's company
// =========================================================================
let rolesEnsured = false;

// First system role first (Administrator, Manager, Cashier), then your own roles by name
export async function fetchAccessRoles() {
  if (!rolesEnsured) {
    rolesEnsured = true;
    try { await supabase.rpc('ensure_access_roles'); } catch (e) { /* migration not applied yet */ }
  }
  const { data, error } = await supabase.from('access_roles').select('*').is('deleted_at', null);
  if (error) return { roles: [], error };

  const order = { administrator: 0, manager: 1, cashier: 2 };
  const roles = (data || []).slice().sort((a, b) => {
    const ra = a.is_system ? order[a.role_key] ?? 3 : 10;
    const rb = b.is_system ? order[b.role_key] ?? 3 : 10;
    return ra - rb || String(a.name).localeCompare(String(b.name));
  });
  return { roles, error: null };
}

export function slugify(text) {
  return String(text || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'role';
}
