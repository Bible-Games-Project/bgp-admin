/**
 * The order of the Apps list. Admins set it by dragging the cards; it is stored in
 * `apps.sort_order` (0 for the first card). Apps that were never placed, such as one
 * created after the last drag, have no sort_order and come last, oldest first: that
 * part is done by the query in `listApps`.
 */

/** The list after dropping the card `activeId` where the card `overId` was. */
export function moveApp<T extends { id: string }>(
  apps: T[],
  activeId: string,
  overId: string,
): T[] {
  const from = apps.findIndex((a) => a.id === activeId);
  const to = apps.findIndex((a) => a.id === overId);
  if (from < 0 || to < 0 || from === to) return apps;
  const next = apps.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Each app with the place it now has in the list, as `reorder_apps` stores it. */
export function withListOrder<T extends { id: string }>(apps: T[]): (T & { sort_order: number })[] {
  return apps.map((a, i) => ({ ...a, sort_order: i }));
}
