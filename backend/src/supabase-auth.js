const APP_ROLES = new Set(['hq_admin', 'branch_admin', 'ministry_leader', 'member']);

export async function signInWithSupabase({ url, anonKey, email, password, fetchImpl = fetch }) {
  const response = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 400 || response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`Supabase Auth returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  return payload.user && payload.user.id && payload.user.email
    ? payload.user
    : null;
}

export function getSupabaseAppAccess(user) {
  const metadata = user && user.app_metadata;
  const role = metadata && metadata.church_role;
  const branchId = metadata && metadata.church_branch_id;
  if (!APP_ROLES.has(role)) return null;
  if (role !== 'hq_admin' && (typeof branchId !== 'string' || !branchId.trim())) return null;
  return { role, branchId: typeof branchId === 'string' ? branchId.trim() : null };
}
