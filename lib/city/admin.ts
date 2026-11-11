/**
 * Admin access for test tools (money cheat, …).
 *
 * For now everyone is admin so the tools can be used while developing. Later this is
 * connected to a real admin account: replace `isAdmin` with a check of the logged-in
 * user (e.g. a role from the auth session) – the UI only asks `useIsAdmin()`.
 */
export function isAdmin(): boolean {
  return true;
}

export function useIsAdmin(): boolean {
  return isAdmin();
}

/** Amounts offered by the admin money tool. */
export const ADMIN_MONEY_STEPS = [10_000, 100_000, 1_000_000];
