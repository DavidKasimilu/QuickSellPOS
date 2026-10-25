import { globalState } from './state.js';

const routes = {
  '#pos': {
    title: 'Cashier Terminal',
    loader: () => import('./views/pos.js'),
  },
  '#dashboard': {
    title: 'Dashboard',
    loader: () => import('./views/dashboard.js'),
  },
  '#sales-summary': {
    title: 'Sales & Receipts',
    loader: () => import('./views/salesReports.js'),
  },
  '#products': {
    title: 'Product Catalog',
    loader: () => import('./views/products.js'),
  },
  '#inventory': {
    title: 'Inventory & Stock',
    loader: () => import('./views/inventory.js'),
  },
  '#customers': {
    title: 'Customers & Debtors',
    loader: () => import('./views/customers.js'),
  },
  '#promotions': {
    title: 'Discounts & Pricing Plans',
    loader: () => import('./views/promotions.js'),
  },
  '#employees': {
    title: 'Employees & Access Rights',
    loader: () => import('./views/employees.js'),
  },
  '#settings': {
    title: 'Store Settings & Registers',
    loader: () => import('./views/settings.js'),
  },
};

let currentCleanup = null;

export async function navigate() {
  const fullHash = window.location.hash || '#pos';
  const cleanHash = fullHash.split('?')[0]; // Strip search query parameters if present
  const targetRoute = routes[cleanHash] || routes['#dashboard'];
  const viewport = document.getElementById('app-viewport');
  const titleEl = document.getElementById('current-view-title');

  if (titleEl) {
    titleEl.textContent = targetRoute.title;
  }

  // Update sidebar active link state
  document.querySelectorAll('.sidebar-nav .nav-icon-link, .nav-link').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === cleanHash || href === fullHash) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Execute previous view's teardown cleanup function to clear real-time channels & DOM timers
  if (typeof currentCleanup === 'function') {
    try {
      await currentCleanup();
    } catch (err) {
      console.warn('Error during route teardown:', err);
    }
    currentCleanup = null;
  }

  if (!viewport) return;

  // Render temporary loader in the viewport
  viewport.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; height:300px; color:var(--text-muted); font-size:0.875rem;">
      <span>Loading view interface...</span>
    </div>
  `;

  try {
    const module = await targetRoute.loader();
    viewport.innerHTML = '';
    
    // Mount view and capture cleanup handler
    currentCleanup = await module.mount(viewport);

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