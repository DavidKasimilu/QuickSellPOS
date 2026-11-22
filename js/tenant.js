import { globalState } from './state.js';

// Fail-closed tenant scoping.
// If there is no active shop we filter on an id that matches nothing,
// so a query can NEVER silently fall back to "all rows".
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export function scoped(query) {
  return query.eq('shop_id', globalState.activeShopId || NIL_UUID);
}

export function requireShopId() {
  const id = globalState.activeShopId;
  if (!id) throw new Error('No active store is selected for this account.');
  return id;
}
