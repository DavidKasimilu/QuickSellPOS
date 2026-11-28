import { globalState } from './state.js';
import { hasRight } from './components/permissions.js';
import { ROUTE_RIGHT, FALLBACK_ROUTES } from './components/rights.js';

const salesTabTitles = {
  'sales-summary': 'Sales Summary',
  'receipts': 'Receipts',
  'refunds': 'Refunds',
  'sales-by-product': 'Sales by Product',
  'sales-by-category': 'Sales by Category',
  'sales-by-discount': 'Sales by Discount',
  'sales-by-payment-type': 'Sales by Payment Type',
  'taxes': 'Taxes',
  'charges': 'Charges',
  'shifts': 'Shifts',
  'product-wise-receipts': 'Product Wise Receipts',
  'sales-by-trends': 'Sales by Trends',
  'deleted-receipts': 'Deleted Receipts',
  'order-type-wise-sales': 'Order Type Wise Sales',
  'product-wise-tax': 'Product Wise Tax',
  'manual-receipts': 'Manual Receipts',
  'sales-by-orders': 'Sales by Orders',
  'product-wise-orders': 'Product Wise Orders',
  'sales-by-modifiers': 'Sales by Modifiers',
  'product-sales-by-other-staff': 'Product Sales by Other Staff',
  'ecommerce-sales': 'Ecommerce Sales',
  'product-wise-deleted-receipts': 'Product Wise Deleted Receipts',
  'refund-and-credit-notes': 'Refund & Credit Notes',
  'deleted-products-in-open-orders': 'Deleted Products in Open Orders'
};

const routes = {
  '#dashboard': {
    title: 'Dashboard',
    loader: () => import('./views/dashboard.js'),
    navKey: 'dashboard',
  },
  '#sales-summary': {
    title: 'Sales Management',
    loader: () => import('./views/salesReports.js'),
    navKey: 'sales',
  },
  '#products': {
    title: 'Products List',
    loader: () => import('./views/products.js'),
    navKey: 'products',
  },
  '#categories': {
    title: 'Categories Management',
    loader: () => import('./views/categories.js'),
    navKey: 'categories',
  },
  '#modifiers': {
    title: 'Modifiers & Add-ons',
    loader: () => import('./views/modifiers.js'),
    navKey: 'modifiers',
  },
  '#measurements': {
    title: 'Units of Measurement',
    loader: () => import('./views/measurements.js'),
    navKey: 'measurements',
  },
  '#barcode-generator': {
    title: 'Barcode Generator',
    loader: () => import('./components/BarcodeGenerator.js'),
    navKey: 'barcode-generator',
  },
  '#deleted-items': {
    title: 'Deleted Items Archive',
    loader: () => import('./views/deletedItems.js'),
    navKey: 'deleted-items',
  },

  // --- INVENTORY MANAGEMENT ROUTES ---
  '#available-inventory': {
    title: 'Available Inventory',
    loader: () => import('./views/inventory.js'),
    navKey: 'available-inventory',
  },
  '#purchase-orders': {
    title: 'Purchase Orders (PO)',
    loader: () => import('./views/purchaseOrders.js'),
    navKey: 'purchase-orders',
  },
  '#goods-received-note': {
    title: 'Goods Received Note (GRN)',
    loader: () => import('./views/goodsReceivedNotes.js'),
    navKey: 'goods-received-note',
  },
  '#purchase-return-note': {
    title: 'Purchase Return Note (PRN)',
    loader: () => import('./views/purchaseReturnNotes.js'),
    navKey: 'purchase-return-note',
  },
  '#stock-adjustments': {
    title: 'Stock Adjustments (SA)',
    loader: () => import('./views/stockAdjustments.js'),
    navKey: 'stock-adjustments',
  },
  '#transfer-of-goods': {
    title: 'Transfer of Goods (TOG)',
    loader: () => import('./views/transferOfGoods.js'),
    navKey: 'transfer-of-goods',
  },
  '#inventory-counts': {
    title: 'Inventory Counts',
    loader: () => import('./views/inventoryCounts.js'),
    navKey: 'inventory-counts',
  },
  '#productions': {
    title: 'Productions',
    loader: () => import('./views/productions.js'),
    navKey: 'productions',
  },
  '#suppliers': {
    title: 'Suppliers',
    loader: () => import('./views/suppliers.js'),
    navKey: 'suppliers',
  },
  '#supplier-credit-management': {
    title: 'Supplier Credit Management',
    loader: () => import('./views/supplierCredit.js'),
    navKey: 'supplier-credit-management',
  },
  '#inventory-history-report': {
    title: 'Inventory History Report',
    loader: () => import('./views/inventoryReports.js'),
    navKey: 'inventory-history-report',
  },
  '#inventory-expiry-report': {
    title: 'Inventory Expiry Report',
    loader: () => import('./views/inventoryReports.js'),
    navKey: 'inventory-expiry-report',
  },
  '#inventory-valuation-report': {
    title: 'Inventory Valuation Report',
    loader: () => import('./views/inventoryReports.js'),
    navKey: 'inventory-valuation-report',
  },
  '#inventory-summary-report': {
    title: 'Inventory Summary Report',
    loader: () => import('./views/inventoryReports.js'),
    navKey: 'inventory-summary-report',
  },
  '#backdate-inventory-report': {
    title: 'Backdate Inventory Report',
    loader: () => import('./views/inventoryReports.js'),
    navKey: 'backdate-inventory-report',
  },
  '#supplier-credit-settlements-report': {
    title: 'Supplier Credit Settlements Report',
    loader: () => import('./views/inventoryReports.js'),
    navKey: 'supplier-credit-settlements-report',
  },

  // --- CUSTOMERS ROUTES ---
  '#customers': {
    title: 'Customers Directory',
    loader: () => import('./views/customers.js'),
    navKey: 'customers',
  },
  '#loyalty': {
    title: 'Loyalty Program',
    loader: () => import('./views/loyalty.js'),
    navKey: 'loyalty',
  },
  '#debtor-management': {
    title: 'Debtor Management',
    loader: () => import('./views/debtorManagement.js'),
    navKey: 'debtor-management',
  },
  '#debtor': {
    title: 'Debtor',
    loader: () => import('./views/debtorManagement.js'),
    navKey: 'debtor',
  },
  '#credit-settlements': {
    title: 'Credit Settlements',
    loader: () => import('./views/creditSettlements.js'),
    navKey: 'credit-settlements',
  },
  '#settlement-by-payment-types': {
    title: 'Settlement by Payment Types',
    loader: () => import('./views/creditSettlements.js'),
    navKey: 'settlement-by-payment-types',
  },

  // --- DISCOUNTS & PRICING ROUTES ---
  '#discount-plans': {
    title: 'Discount Plans',
    loader: () => import('./views/discountPlans.js'),
    navKey: 'discount-plans',
  },
  '#pricing-plans': {
    title: 'Pricing Plans',
    loader: () => import('./views/pricingPlans.js'),
    navKey: 'pricing-plans',
  },
  '#price-change': {
    title: 'Price Change',
    loader: () => import('./views/priceChange.js'),
    navKey: 'price-change',
  },

  // --- EMPLOYEES ROUTES ---
  '#employees': {
    title: 'Employees Management',
    loader: () => import('./views/employees.js'),
    navKey: 'employees',
  },
  '#access-rights': {
    title: 'Access Rights & Roles',
    loader: () => import('./views/accessRights.js'),
    navKey: 'access-rights',
  },
  '#other-staff': {
    title: 'Other Staff',
    loader: () => import('./views/otherStaff.js'),
    navKey: 'other-staff',
  },
  '#staff-commissions': {
    title: 'Staff Commissions',
    loader: () => import('./views/staffCommissions.js'),
    navKey: 'staff-commissions',
  },
  '#access-logs': {
    title: 'Access Logs',
    loader: () => import('./views/accessLogs.js'),
    navKey: 'access-logs',
  },
  '#shifts': {
    title: 'Shift Management',
    loader: () => import('./views/shifts.js'),
    navKey: 'shifts',
  },

  // --- SETTINGS ROUTE ---
  '#settings': {
    title: 'Store Settings & Registers',
    loader: () => import('./views/settings.js'),
    navKey: 'settings',
  },
};

let currentCleanup = null;

export async function navigate() {
  const fullHash = window.location.hash || '#dashboard';
  const [cleanHash, queryStr] = fullHash.split('?');
  const queryParams = new URLSearchParams(queryStr || '');
  
  const targetRoute = routes[cleanHash] || routes['#dashboard'];
  const viewport = document.getElementById('app-viewport');
  const titleEl = document.getElementById('current-view-title');
  const dateControlsEl = document.getElementById('dashboard-date-controls');

  // 1. Toggle Date Controls: Strictly visible only on Dashboard view
  if (dateControlsEl) {
    if (cleanHash === '#dashboard') {
      dateControlsEl.classList.remove('hidden');
      dateControlsEl.style.display = 'flex';
    } else {
      dateControlsEl.classList.add('hidden');
      dateControlsEl.style.display = 'none';
    }
  }

  // 2. Resolve & Update Dynamic View Title
  const activeTab = queryParams.get('tab') || 'sales-summary';
  let viewTitle = targetRoute.title;
  if (cleanHash === '#sales-summary' && salesTabTitles[activeTab]) {
    viewTitle = `Sales | ${salesTabTitles[activeTab]}`;
  }

  if (titleEl) {
    titleEl.textContent = viewTitle;
  }

  // 3. Highlight Active Rail Links & Subnav Items
  document.querySelectorAll('.sidebar-nav .nav-icon-link, .nav-icon-link, .subnav-item, .subnav-subitem').forEach((link) => {
    const href = link.getAttribute('href');
    const navKey = link.dataset.nav || link.dataset.menuTrigger;

    if (href === fullHash || (cleanHash === '#sales-summary' && href === fullHash)) {
      link.classList.add('active');
    } else if (href === cleanHash || navKey === targetRoute.navKey) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // 4. Teardown Cleanup of Previous View
  if (typeof currentCleanup === 'function') {
    try {
      await currentCleanup();
    } catch (err) {
      console.warn('Error during route teardown:', err);
    }
    currentCleanup = null;
  }

  if (!viewport) return;

  // 4b. Rights check: the page needs a right the person's role may not have
  const neededRight = ROUTE_RIGHT[cleanHash] || (routes[cleanHash] ? null : ROUTE_RIGHT['#dashboard']);
  if (globalState.user && neededRight && !hasRight(neededRight)) {
    const fallback = FALLBACK_ROUTES.find((h) => h !== cleanHash && hasRight(ROUTE_RIGHT[h]));
    if (fallback && cleanHash !== fallback && !(cleanHash === '' && fallback === '#dashboard')) {
      window.location.hash = fallback;
      return;
    }
    viewport.innerHTML = `
      <div style="padding:32px; background:#fff; border:1px solid var(--border-subtle); border-radius:8px; max-width:520px;">
        <h3 style="margin-bottom:8px;">No access</h3>
        <p style="color:var(--text-muted); font-size:0.875rem;">Your role does not include the right to open this page. Ask an administrator to update your role.</p>
      </div>
    `;
    return;
  }

  // 5. Temporary Loading Indicator
  viewport.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; height:300px; color:var(--text-muted); font-size:0.875rem;">
      <span>Loading view interface...</span>
    </div>
  `;

  // 6. Dynamic Module Loading & Mounting
  try {
    const module = await targetRoute.loader();
    viewport.innerHTML = '';
    
    if (typeof module.mount === 'function') {
      currentCleanup = await module.mount(viewport, activeTab, queryParams, cleanHash);
    } else if (typeof module.render === 'function') {
      currentCleanup = await module.render(viewport, activeTab, queryParams, cleanHash);
    }

    if (window.lucide) {
      window.lucide.createIcons();
    }
  } catch (err) {
    console.error('Failed to mount view:', err);
    viewport.innerHTML = `
      <div style="padding:24px; background:#fff; border:1px solid var(--border-subtle); border-radius:8px;">
        <h3 style="color:var(--color-danger); margin-bottom:8px;">View Load Error</h3>
        <p style="color:var(--text-muted); font-size:0.875rem;">${err.message}</p>
      </div>
    `;
  }
}

window.addEventListener('hashchange', navigate);