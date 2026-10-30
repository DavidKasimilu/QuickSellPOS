import { globalState } from './state.js';

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
    title: 'Sales & Receipts',
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

  // 1. Update Title Header
  if (titleEl) {
    titleEl.textContent = targetRoute.title;
  }

  // 2. Highlight Active Rail Links & Subnav Items
  document.querySelectorAll('.sidebar-nav .nav-icon-link, .nav-icon-link, .subnav-item, .subnav-subitem').forEach((link) => {
    const href = link.getAttribute('href');
    const navKey = link.dataset.nav || link.dataset.menuTrigger;

    if (href === fullHash || href === cleanHash || navKey === targetRoute.navKey) {
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
    
    // Pass queryParams or tab to the view mount function if supported
    const activeTab = queryParams.get('tab') || 'default';
    
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
