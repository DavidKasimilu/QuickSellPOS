import { globalState } from './state.js';

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
  '#pos': {
    title: 'Cashier Terminal',
    loader: () => import('./views/pos.js'),
    navKey: 'pos',
  },
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
    title: 'Product Catalog',
    loader: () => import('./views/products.js'),
    navKey: 'products',
  },
  '#inventory': {
    title: 'Inventory & Stock',
    loader: () => import('./views/inventory.js'),
    navKey: 'inventory',
  },
  '#customers': {
    title: 'Customers & Debtors',
    loader: () => import('./views/customers.js'),
    navKey: 'customers',
  },
  '#promotions': {
    title: 'Discounts & Pricing Plans',
    loader: () => import('./views/promotions.js'),
    navKey: 'promotions',
  },
  '#employees': {
    title: 'Employees & Access Rights',
    loader: () => import('./views/employees.js'),
    navKey: 'employees',
  },
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

  // 1. Resolve & Update Dynamic View Title
  const activeTab = queryParams.get('tab') || 'sales-summary';
  let viewTitle = targetRoute.title;
  if (cleanHash === '#sales-summary' && salesTabTitles[activeTab]) {
    viewTitle = `Sales | ${salesTabTitles[activeTab]}`;
  }

  if (titleEl) {
    titleEl.textContent = viewTitle;
  }

  // 2. Highlight Active Rail Links & Subnav Items
  document.querySelectorAll('.sidebar-nav .nav-icon-link, .nav-icon-link, .subnav-item, .subnav-subitem').forEach((link) => {
    const href = link.getAttribute('href');
    const navKey = link.dataset.nav || link.dataset.menuTrigger;

    if (href === fullHash || (cleanHash === '#sales-summary' && href === fullHash)) {
      link.classList.add('active');
    } else if (navKey === targetRoute.navKey && !queryStr) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // 3. Execute Teardown Cleanup of Previous View (Channels, Timers, Observers)
  if (typeof currentCleanup === 'function') {
    try {
      await currentCleanup();
    } catch (err) {
      console.warn('Error during route teardown:', err);
    }
    currentCleanup = null;
  }

  if (!viewport) return;

  // 4. Temporary Loading Indicator
  viewport.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; height:300px; color:var(--text-muted); font-size:0.875rem;">
      <span>Loading view interface...</span>
    </div>
  `;

  // 5. Dynamic Module Loading & Mounting
  try {
    const module = await targetRoute.loader();
    viewport.innerHTML = '';
    
    if (typeof module.mount === 'function') {
      currentCleanup = await module.mount(viewport, activeTab, queryParams);
    } else if (typeof module.render === 'function') {
      currentCleanup = await module.render(viewport, activeTab, queryParams);
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