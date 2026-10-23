// Church 2.0 — API client for the production backend.
//
// When window.CHURCH2_CONFIG.apiBase is set, this talks to the real API
// (auth + shared Postgres data). When it's empty, isEnabled() returns false and
// the app runs in standalone localStorage demo mode. All calls are gated on
// isEnabled() so the static demo keeps working with no backend.
(function () {
  'use strict';

  const TOKEN_KEY = 'church2_token';

  const base = () => (window.CHURCH2_CONFIG && window.CHURCH2_CONFIG.apiBase) || '';
  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base() + '/api' + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      let message = (data && data.error) || `Request failed (${res.status})`;
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const waitMinutes = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.ceil(retryAfter / 60)
          : null;
        message = waitMinutes
          ? `Too many sign-in attempts. Please try again in about ${waitMinutes} ${waitMinutes === 1 ? 'minute' : 'minutes'}.`
          : 'Too many sign-in attempts. Please wait before trying again.';
      }
      const err = new Error(message);
      err.status = res.status;
      err.code = data && data.code;
      // One session per account: when another sign-in supersedes this one the
      // server rejects the token. Drop it and let the app return to the login
      // screen rather than retrying with a credential that can never work.
      if (res.status === 401) {
        setToken(null);
        if (typeof window.onChurch2SessionLost === 'function') {
          window.onChurch2SessionLost(err.message);
        }
      }
      throw err;
    }
    return data;
  }

  const scoped = (path, branch) => {
    if (!branch || branch === 'global') return path;
    return path + (path.includes('?') ? '&' : '?') + 'branch=' + encodeURIComponent(branch);
  };

  window.Church2API = {
    isEnabled: () => Boolean(base()),
    getToken,
    logout: () => setToken(null),

    // ---- Auth ----
    async login(email, password) {
      return request('POST', '/auth/login', { email, password }); // -> {mfaRequired,ticket} | {token,user}
    },
    async signup(details) {
      const r = await request('POST', '/auth/signup', details);
      if (r.token) setToken(r.token);
      return r;
    },
    async verifyMfa(ticket, code) {
      const r = await request('POST', '/auth/mfa', { ticket, code });
      if (r.token) setToken(r.token);
      return r; // {token,user}
    },
    async completePasswordLogin(r) {
      if (r && r.token) setToken(r.token);
      return r;
    },
    async me() { return request('GET', '/auth/me'); },

    // ---- Resources (branch = active campus scope, or 'global') ----
    members: (branch, search) => request('GET', scoped('/members' + (search ? `?search=${encodeURIComponent(search)}` : ''), branch)),
    createMember: (m) => request('POST', '/members', m),
    importMembers: (data) => request('POST', '/members/import', data),
    updateMemberMilestones: (id, spiritualMilestones) => request('PATCH', `/members/${encodeURIComponent(id)}/milestones`, { spiritualMilestones }),
    removeMember: (id) => request('DELETE', `/members/${encodeURIComponent(id)}`),
    transactions: (branch) => request('GET', scoped('/transactions', branch)),
    recordTransaction: (t) => request('POST', '/transactions', t),
    removeTransaction: (id) => request('DELETE', `/transactions/${encodeURIComponent(id)}`),
    collectionSessions: (branch) => request('GET', scoped('/collection-sessions', branch)),
    createCollectionSession: (session) => request('POST', '/collection-sessions', session),
    removeCollectionSession: (id) => request('DELETE', `/collection-sessions/${encodeURIComponent(id)}`),
    attendance: (branch) => request('GET', scoped('/attendance', branch)),
    setAttendance: (a) => request('PUT', '/attendance', a),
    removeAttendance: (memberId, date) => request('DELETE', `/attendance/${encodeURIComponent(memberId)}/${encodeURIComponent(date)}`),
    attendanceHeadcounts: (branch) => request('GET', scoped('/attendance/headcounts', branch)),
    setAttendanceHeadcount: (headcount) => request('PUT', '/attendance/headcount', headcount),
    removeAttendanceHeadcount: (id) => request('DELETE', `/attendance/headcounts/${encodeURIComponent(id)}`),
    dashboardSummary: (branch) => request('GET', scoped('/dashboard/summary', branch)),
    groups: (branch) => request('GET', scoped('/groups', branch)),
    createGroup: (g) => request('POST', '/groups', g),
    removeGroup: (id) => request('DELETE', `/groups/${encodeURIComponent(id)}`),
    removeGroupMember: (id, memberId) => request('DELETE', `/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`),
    toggleGroupMember: (id, memberId) => request('POST', `/groups/${id}/toggle-member`, { memberId }),
    followups: (branch) => request('GET', scoped('/followups', branch)),
    createFollowup: (f) => request('POST', '/followups', f),
    moveFollowup: (id, stage) => request('PATCH', `/followups/${id}`, { stage }),
    removeFollowup: (id) => request('DELETE', `/followups/${encodeURIComponent(id)}`),
    announcements: () => request('GET', '/announcements'),
    sendAnnouncement: (a) => request('POST', '/announcements', a),
    removeAnnouncement: (id) => request('DELETE', `/announcements/${encodeURIComponent(id)}`),
    prayerRequests: (branch) => request('GET', scoped('/prayer-requests', branch)),
    submitPrayer: (p) => request('POST', '/prayer-requests', p),
    dismissPrayer: (id) => request('DELETE', `/prayer-requests/${id}`),
    events: (branch) => request('GET', scoped('/events', branch)),
    createEvent: (event) => request('POST', '/events', event),
    updateEvent: (id, event) => request('PATCH', `/events/${encodeURIComponent(id)}`, event),
    removeEvent: (id) => request('DELETE', `/events/${encodeURIComponent(id)}`),
    eventRsvp: (id) => request('POST', `/events/${encodeURIComponent(id)}/rsvp`, {}),
    volunteerForEvent: (id, role) => request('POST', `/events/${encodeURIComponent(id)}/volunteer`, { role }),
    removeEventVolunteer: (id, memberId) => request('DELETE', `/events/${encodeURIComponent(id)}/volunteer/${encodeURIComponent(memberId)}`),
    campaigns: (branch) => request('GET', scoped('/campaigns', branch)),
    createCampaign: (campaign) => request('POST', '/campaigns', campaign),
    updateCampaign: (id, campaign) => request('PATCH', `/campaigns/${encodeURIComponent(id)}`, campaign),
    removeCampaign: (id) => request('DELETE', `/campaigns/${encodeURIComponent(id)}`),
    recurringGifts: (branch) => request('GET', scoped('/recurring-gifts', branch)),
    createRecurringGift: (gift) => request('POST', '/recurring-gifts', gift),
    updateRecurringGift: (id, gift) => request('PATCH', `/recurring-gifts/${encodeURIComponent(id)}`, gift),
    removeRecurringGift: (id) => request('DELETE', `/recurring-gifts/${encodeURIComponent(id)}`),
  };
})();
