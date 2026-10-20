import { globalState } from '../state.js';

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

// Scans target container and removes elements the current user lacks privileges to view
export function applyUIPermissions(container = document) {
  const restrictedElements = container.querySelectorAll('[data-role]');
  
  restrictedElements.forEach((el) => {
    const rolesRequired = el
      .getAttribute('data-role')
      .split(',')
      .map((r) => r.trim());

    if (!rolesRequired.includes(globalState.role)) {
      el.remove();
    }
  });
}