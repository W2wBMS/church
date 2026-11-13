import test from 'node:test';
import assert from 'node:assert/strict';
import { getSupabaseAppAccess, signInWithSupabase } from '../src/supabase-auth.js';

test('Supabase sign-in sends credentials to the password grant endpoint', async () => {
  let request;
  const user = { id: 'auth-user-id', email: 'person@example.com' };
  const result = await signInWithSupabase({
    url: 'https://project.supabase.co',
    anonKey: 'public-anon-key',
    email: user.email,
    password: 'secret-password',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ user }) };
    },
  });

  assert.equal(result, user);
  assert.equal(request.url, 'https://project.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(request.options.headers.apikey, 'public-anon-key');
  assert.deepEqual(JSON.parse(request.options.body), { email: user.email, password: 'secret-password' });
});

test('Supabase invalid credentials do not expose provider details', async () => {
  const result = await signInWithSupabase({
    url: 'https://project.supabase.co',
    anonKey: 'public-anon-key',
    email: 'person@example.com',
    password: 'wrong-password',
    fetchImpl: async () => ({ ok: false, status: 400 }),
  });

  assert.equal(result, null);
});

test('app access uses trusted app_metadata and requires a campus', () => {
  assert.deepEqual(
    getSupabaseAppAccess({ app_metadata: { church_role: 'branch_admin', church_branch_id: 'b2' } }),
    { role: 'branch_admin', branchId: 'b2' }
  );
  assert.equal(getSupabaseAppAccess({ user_metadata: { church_role: 'hq_admin' } }), null);
  assert.equal(getSupabaseAppAccess({ app_metadata: { church_role: 'branch_admin' } }), null);
  assert.deepEqual(
    getSupabaseAppAccess({ app_metadata: { church_role: 'hq_admin' } }),
    { role: 'hq_admin', branchId: null }
  );
});
