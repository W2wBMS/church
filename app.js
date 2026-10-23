// Christian Mission Dunamis — main application controller
// Handles global state, CRUD operations, rendering, and Chart.js visualization

// ---- Rendering helpers -------------------------------------------------------
// esc(): escape untrusted text before it is interpolated into innerHTML. Every
// member name, email, phone, prayer request, chat message, and sermon note is
// user-controlled, so it MUST pass through esc() to prevent stored XSS.
function esc(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// mdInline(): fully escape first, then apply a tiny, safe Markdown subset so the
// AI engine's **bold**/*italic*/`code` render as HTML instead of literal asterisks.
function mdInline(text) {
    return esc(text)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

// renderMarkdown(): block-level rendering for multi-line AI output — paragraphs,
// bullet lists ("- " or "• "), and line breaks. Safe: all text is escaped.
function renderMarkdown(text) {
    const lines = String(text == null ? '' : text).split('\n');
    let html = '';
    let inList = false;
    lines.forEach((line) => {
        const trimmed = line.trim();
        const bullet = trimmed.match(/^[-•]\s+(.*)$/);
        if (bullet) {
            if (!inList) { html += '<ul class="md-list">'; inList = true; }
            html += `<li>${mdInline(bullet[1])}</li>`;
        } else {
            if (inList) { html += '</ul>'; inList = false; }
            if (trimmed.length) html += `<p class="md-p">${mdInline(trimmed)}</p>`;
        }
    });
    if (inList) html += '</ul>';
    return html;
}

function parseCsvRecords(text) {
    const records = [];
    let record = [];
    let field = '';
    let quoted = false;
    let closedQuote = false;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
            if (char === '"' && text[index + 1] === '"') {
                field += '"';
                index++;
            } else if (char === '"') {
                quoted = false;
                closedQuote = true;
            } else {
                field += char;
            }
        } else if (closedQuote && char !== ',' && char !== '\r' && char !== '\n' && !/\s/.test(char)) {
            throw new Error('A quoted field has extra text after its closing quote.');
        } else if (char === '"' && !field.length) {
            quoted = true;
            closedQuote = false;
        } else if (char === '"') {
            throw new Error('A quote appears inside an unquoted CSV field.');
        } else if (char === ',') {
            record.push(field);
            field = '';
            closedQuote = false;
        } else if (char === '\r' || char === '\n') {
            if (char === '\r' && text[index + 1] === '\n') index++;
            record.push(field);
            if (record.some((value) => value.trim())) records.push(record);
            record = [];
            field = '';
            closedQuote = false;
        } else if (!closedQuote) {
            field += char;
        }
    }

    if (quoted) throw new Error('The CSV ends inside a quoted field.');
    record.push(field);
    if (record.some((value) => value.trim())) records.push(record);
    return records;
}

// Initialize Global State
const ChurchApp = {
    memberImportState: null,

    // 1. Centralized Mock Database
    db: {
        branches: [
            { id: 'b1', name: 'Accra Main', location: 'Central Accra, Ghana', code: 'ACC' },
            { id: 'b2', name: 'Kumasi Branch', location: 'Kumasi, Ghana', code: 'KUM' },
            { id: 'b3', name: 'Takoradi Branch', location: 'Takoradi, Ghana', code: 'TAK' }
        ],
        members: [
            { id: 'm1', branchId: 'b1', branchName: 'Accra Main', firstName: 'Kwasi', lastName: 'Mensah', email: 'kwasi.mensah@chritianmissiondunamis.org', phone: '+233501234567', familyId: 'fam_mensah', familyRole: 'Husband', spiritualMilestones: ['Baptized: 2018-04-12', 'Member: 2019-01-01'], volunteer_skills: ['Worship Vocals', 'Keyboard', 'Guitar'], engagement_score: 95, maritalStatus: 'Married', background: 'Led worship at a fellowship for six years; works as a sound technician in Accra.', expectations: 'To grow the worship team and mentor younger musicians.' },
            { id: 'm2', branchId: 'b1', branchName: 'Accra Main', firstName: 'Ama', lastName: 'Mensah', email: 'ama.mensah@chritianmissiondunamis.org', phone: '+233502345678', familyId: 'fam_mensah', familyRole: 'Wife', spiritualMilestones: ['Baptized: 2019-06-20'], volunteer_skills: ['Childcare', 'Greeting'], engagement_score: 88, maritalStatus: 'Married', background: "Teacher; ran a children's holiday programme before joining.", expectations: "To help build up the children's ministry." },
            { id: 'm3', branchId: 'b1', branchName: 'Accra Main', firstName: 'Kofi', lastName: 'Asante', email: 'kofi.asante@email.com', phone: '+233503456789', familyId: 'fam_asante', familyRole: 'Single', spiritualMilestones: ['Member: 2021-03-10'], volunteer_skills: ['Ushering', 'Security', 'First Aid'], engagement_score: 75 },
            { id: 'm4', branchId: 'b1', branchName: 'Accra Main', firstName: 'Abena', lastName: 'Boateng', email: 'abena.b@email.com', phone: '+233504567890', familyId: 'fam_boateng', familyRole: 'Single', spiritualMilestones: ['Baptized: 2022-11-05'], volunteer_skills: ['Ushering', 'Greeting'], engagement_score: 62 },
            { id: 'm5', branchId: 'b2', branchName: 'Kumasi Branch', firstName: 'Yaw', lastName: 'Owusu', email: 'yaw.owusu@email.com', phone: '+233505678901', familyId: 'fam_owusu', familyRole: 'Husband', spiritualMilestones: ['Member: 2015-05-24'], volunteer_skills: ['Sound Engineering', 'Video Editing'], engagement_score: 92 },
            { id: 'm6', branchId: 'b2', branchName: 'Kumasi Branch', firstName: 'Akosua', lastName: 'Owusu', email: 'akosua.owusu@email.com', phone: '+233506789012', familyId: 'fam_owusu', familyRole: 'Wife', spiritualMilestones: ['Member: 2015-05-24'], volunteer_skills: ['Worship Vocals', 'Public Speaking'], engagement_score: 78 },
            { id: 'm7', branchId: 'b2', branchName: 'Kumasi Branch', firstName: 'Mina', lastName: 'Adomako', email: 'mina.adomako@email.com', phone: '+233507890123', familyId: 'fam_adomako', familyRole: 'Single', spiritualMilestones: ['Baptized: 2024-02-14'], volunteer_skills: ['Greeting', 'Social Media'], engagement_score: 41, maritalStatus: 'Single', background: 'Recent graduate, works in customer service. New to church life.', expectations: 'To find community and a small group close to home.' }, // Flagged at risk
            { id: 'm8', branchId: 'b3', branchName: 'Takoradi Branch', firstName: 'Kwame', lastName: 'Agyemang', email: 'kwame.agyemang@email.com', phone: '+233508901234', familyId: 'fam_agyemang', familyRole: 'Single', spiritualMilestones: ['Member: 2023-09-12'], volunteer_skills: ['Graphics', 'Video Editing', 'Website Support'], engagement_score: 84 },
            { id: 'm9', branchId: 'b3', branchName: 'Takoradi Branch', firstName: 'Aba', lastName: 'Karpoe', email: 'aba.karpoe@email.com', phone: '+233509012345', familyId: 'fam_karpoe', familyRole: 'Single', spiritualMilestones: [], volunteer_skills: ['Greeting', 'First Aid'], engagement_score: 35 }, // Flagged at risk
            { id: 'm10', branchId: 'b1', branchName: 'Accra Main', firstName: 'Kodjo', lastName: 'Anane', email: 'kodjo.a@email.com', phone: '+233510123456', familyId: 'fam_anane', familyRole: 'Husband', spiritualMilestones: ['Baptized: 2010-08-15'], volunteer_skills: ['Youth Mentorship', 'Security'], engagement_score: 30 } // Flagged at risk
        ],
        transactions: [],
        collectionSessions: [],
        attendance: [],
        attendanceHeadcounts: [],
        // A few standing orders so the recurring-giving panel demonstrates the
        // feature out of the box. Members here are from the handcrafted core.
        recurringGifts: [
            { id: 'rec_seed_1', memberId: 'm1', memberName: 'Kwasi Mensah', branchId: 'b1', branchName: 'Accra Main', amount: 500, category: 'Tithe', frequency: 'monthly', method: 'Mobile Money', nextDate: '2026-08-01', active: true },
            { id: 'rec_seed_2', memberId: 'm2', memberName: 'Ama Mensah', branchId: 'b1', branchName: 'Accra Main', amount: 150, category: 'Offering', frequency: 'weekly', method: 'Mobile Money', nextDate: '2026-07-20', active: true },
            { id: 'rec_seed_3', memberId: 'm5', memberName: 'Yaw Owusu', branchId: 'b2', branchName: 'Kumasi Branch', amount: 300, category: 'Tithe', frequency: 'monthly', method: 'Bank Transfer', nextDate: '2026-08-05', active: true },
            { id: 'rec_seed_4', memberId: 'm8', memberName: 'Kwame Agyemang', branchId: 'b3', branchName: 'Takoradi Branch', amount: 200, category: 'Project Donation', frequency: 'monthly', method: 'Mobile Money', nextDate: '2026-08-03', active: true }
        ],
        // One campaign per fund category — `raised` is summed from matching
        // transactions, so two campaigns sharing a category would double-count.
        // `raisedOffset` carries the funds banked before this app's transaction
        // window; without it a months-long capital appeal reads as ~0%.
        campaigns: [
            { id: 'camp1', name: "Children's Home Support Fund", goal: 1500000, raisedOffset: 940000, fundCategory: 'Project Donation', branchId: 'b1' },
            { id: 'camp2', name: 'NURU TV Broadcast Equipment', goal: 850000, raisedOffset: 410000, fundCategory: 'Pledge', branchId: 'b1' }
        ],
        followUps: [
            { id: 'fu1', name: 'Peter Njoroge', branchId: 'b1', stage: 'New Guest', owner: 'Pastor Joseph', note: 'First-time guest at 2nd Service, filled a connect card.' },
            { id: 'fu2', name: 'Linda Achieng', branchId: 'b1', stage: 'Contacted', owner: 'Grace Mwangi', note: 'Called; interested in joining a home fellowship.' },
            { id: 'fu3', name: 'Ernest Budu', branchId: 'b2', stage: 'Connected', owner: 'Yaw Owusu', note: 'Joined the Tuesday Kumasi home fellowship.' },
            { id: 'fu4', name: 'Esi Agyeman', branchId: 'b3', stage: 'New Guest', owner: 'Kwame Agyemang', note: 'Walked in at the Takoradi campus.' }
        ],
        groups: [
            { id: 'g1', name: 'Young Adults Fellowship', branchId: 'b1', schedule: 'Tue 6:30 PM', description: '20s–30s community — Bible study, mentorship and fellowship.', memberIds: ['m1', 'm3'] },
            { id: 'g2', name: 'Family Life & Marriage', branchId: 'b1', schedule: 'Wed 5:30 PM', description: 'For couples growing together in faith.', memberIds: ['m2'] },
            { id: 'g3', name: 'Intercessors Fellowship', branchId: 'b1', schedule: 'Fri 6:00 AM', description: 'Corporate prayer for the church, the city and the nation.', memberIds: [] },
            { id: 'g4', name: "Men's Morning Prayer", branchId: 'b2', schedule: 'Sat 6:00 AM', description: 'Prayer, accountability and breakfast.', memberIds: ['m5'] },
            { id: 'g5', name: 'Kumasi Home Fellowship', branchId: 'b2', schedule: 'Tue 6:00 PM', description: 'Midweek fellowship in homes around the campus.', memberIds: [] },
            { id: 'g6', name: 'Women of Grace', branchId: 'b3', schedule: 'Thu 10:00 AM', description: 'Bible study and fellowship.', memberIds: ['m8'] },
            { id: 'g7', name: 'Takoradi Youth Fellowship', branchId: 'b3', schedule: 'Sat 4:00 PM', description: 'Teens and young adults — worship, mentorship and sport.', memberIds: [] }
        ],
        announcements: [
            { id: 'an1', title: 'Baptism Sunday — register now', body: 'Christian Mission Dunamis is holding a baptism service on the last Sunday of the month at the Accra Main campus. Speak to a pastor or reply to register.', audience: 'all', channels: ['sms', 'push'], recipients: 10, sentAt: '2026-07-06T09:00:00Z' }
        ],
        readingPlans: [
            { id: 'rp1', title: '7 Days of Peace', emoji: '🕊️', days: [
                { ref: 'John 14:27', text: 'Peace I leave with you; my peace I give to you.' },
                { ref: 'Philippians 4:6-7', text: 'Do not be anxious about anything, but in everything by prayer... present your requests to God.' },
                { ref: 'Isaiah 26:3', text: 'You keep him in perfect peace whose mind is stayed on you.' },
                { ref: 'Psalm 4:8', text: 'In peace I will both lie down and sleep; for you alone, O Lord, make me dwell in safety.' },
                { ref: 'Matthew 11:28', text: 'Come to me, all who labor and are heavy laden, and I will give you rest.' },
                { ref: 'Colossians 3:15', text: 'Let the peace of Christ rule in your hearts.' },
                { ref: 'Romans 15:13', text: 'May the God of hope fill you with all joy and peace in believing.' }
            ]},
            { id: 'rp2', title: 'Foundations of Faith', emoji: '🌱', days: [
                { ref: 'Hebrews 11:1', text: 'Now faith is the assurance of things hoped for, the conviction of things not seen.' },
                { ref: 'Ephesians 2:8', text: 'For by grace you have been saved through faith.' },
                { ref: 'Romans 10:17', text: 'So faith comes from hearing, and hearing through the word of Christ.' },
                { ref: 'James 2:17', text: 'So also faith by itself, if it does not have works, is dead.' },
                { ref: 'Mark 11:24', text: 'Whatever you ask in prayer, believe that you have received it, and it will be yours.' }
            ]}
        ],
        readingState: {},
        events: [
            { id: 'e1', branchId: 'b1', title: 'Youth Praise Night', description: 'An evening of worship, drama, and networking for young adults.', date: '2026-07-19', time: '18:00', rolesRequired: ['Worship Vocals', 'Keyboard', 'Guitar', 'Sound Engineering', 'Greeting'], volunteersSignedUp: ['m1'] },
            { id: 'e2', branchId: 'b2', title: 'Kumasi Community Outreach', description: 'Food, clothing and medical support for families around the Kumasi campus.', date: '2026-07-25', time: '09:00', rolesRequired: ['Greeting', 'First Aid', 'Security'], volunteersSignedUp: ['m6'] },
            { id: 'e3', branchId: 'b1', title: 'Sunday 2nd Service — Accra Main', description: 'Main Sunday gathering at Accra Main campus.', date: '2026-07-12', time: '10:00', rolesRequired: ['Ushering', 'Greeting', 'Sound Engineering', 'Worship Vocals', 'Security'], volunteersSignedUp: ['m3', 'm4'] }
        ],
        sermons: [
            { id: 's1', title: 'Walking by Faith, Not by Sight', preacher: 'Apostle Joseph Mensah', date: '2026-07-05', branchName: 'Accra Main', thumbnail: 'sermon_faith', duration: '42:15', mediaUrl: 'https://www.w3schools.com/html/mov_bbb.mp4' },
            { id: 's2', title: 'The Heart of a Faithful Steward', preacher: 'Pastor Yaw Owusu', date: '2026-06-28', branchName: 'Kumasi Branch', thumbnail: 'sermon_steward', duration: '38:40', mediaUrl: 'https://www.w3schools.com/html/movie.mp4' }
        ],
        prayerRequests: [
            { id: 'pr1', memberId: 'm1', memberName: 'Kwasi Mensah', branchName: 'Accra Main', text: 'Praying for my family as we plan to travel this week.', category: 'Family', route: 'Family Life & Marriage Ministry', status: 'Approved', timestamp: '2026-07-10T14:30:00Z' },
            { id: 'pr2', memberId: 'm7', memberName: 'Mina Adomako', branchName: 'Kumasi Branch', text: 'I am recovering from surgery and still in moderate pain.', category: 'Healing', route: 'Hospital & Home Care Ministry', status: 'Assigned', timestamp: '2026-07-11T09:15:00Z' }
        ]
    },

    // 2. Active Session Configuration
    session: {
        currentRole: 'hq_admin', // hq_admin, branch_admin, ministry_leader
        currentBranch: 'b1',
        activeTab: 'admin_dashboard', // dashboard, directory, financials, ministry, communications
        mfaVerified: true,
        selectedMemberId: null,
        selectedEventId: 'e3',
    },

    // 3. Application Charts (Chart.js references)
    charts: {},

    // Standalone demo accounts; production authentication is handled by the API.
    DEMO_USERS: [
        { email: 'admin@chritianmissiondunamis.org', password: 'grace', name: 'HQ Administrator', role: 'hq_admin', branchId: 'b1' },
        { email: 'kumasi@chritianmissiondunamis.org', password: 'grace', name: 'Kumasi Campus Admin', role: 'branch_admin', branchId: 'b2' },
        { email: 'worship@chritianmissiondunamis.org', password: 'grace', name: 'Worship Leader', role: 'ministry_leader', branchId: 'b1' },
    ],

    // RBAC: which tabs each role may access. Enforced in renderAll — not just
    // hidden in the nav, so a user cannot reach an admin panel by any route.
    ROLE_TABS: {
        hq_admin: ['admin_dashboard', 'admin_directory', 'admin_financials', 'admin_attendance', 'admin_ministry', 'admin_followups', 'admin_groups', 'admin_communications'],
        branch_admin: ['admin_dashboard', 'admin_directory', 'admin_financials', 'admin_attendance', 'admin_ministry', 'admin_followups', 'admin_groups', 'admin_communications'],
        ministry_leader: ['admin_dashboard', 'admin_attendance', 'admin_ministry', 'admin_followups', 'admin_groups', 'admin_communications']
    },

    // 4. Initialize Data & Render
    init() {
        this.loadDB();
        this.loadTheme();
        this.setupEventHandlers();

        // Auth gate. When the production API is configured, restore the session
        // from the stored token (validated against the server); otherwise use
        // the standalone localStorage demo session.
        if (window.Church2API && Church2API.isEnabled()) {
            this.initApiAuth();
        } else {
            const session = this.loadSession();
            if (session && this.applyUser(session)) {
                this.showApp();
                this.renderAll();
            } else if (!session && this.wantsPreviewEntry()) {
                this.enterPreview();
            } else if (!session) {
                this.showAuthScreen('credentials');
            }
        }

        // Register PWA Service Worker
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js').then((reg) => {
                    console.log('ServiceWorker registration successful with scope: ', reg.scope);
                }).catch((err) => {
                    console.error('ServiceWorker registration failed: ', err);
                });
            });
        }
    },

    // Persistence: Save state
    saveDB() {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem('church2_db', JSON.stringify(this.db));
        } catch (e) {
            // Most likely QuotaExceededError — surface it instead of throwing
            // uncaught mid-action (which would abort the surrounding handler).
            console.error('Could not persist data:', e);
            if (this.toast) this.toast('Local storage is full — recent changes may not be saved.', 'error');
        }
    },

    // Bump whenever the seeded demo dataset itself changes shape or content
    // (campuses, people, currency). A saved DB stamped with an older version is
    // discarded and re-seeded so returning demo visitors don't keep stale data.
    // In API mode this is moot — the server's data replaces it on hydrate.
    // Version 8 removes every preloaded record and retires demo access.
    SEED_VERSION: 8,

    // Persistence: Load state
    loadDB() {
        // Snapshot the pristine seed before a saved DB overwrites it, so
        // ensureSchema can backfill from one source of truth.
        const seed = this.db;
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem('church2_db');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    // Guard against valid-but-wrong JSON (e.g. "null", an array,
                    // a string) that would break ensureSchema/renderers.
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.members)) {
                        throw new Error('Saved DB is not a valid database object');
                    }
                    if (parsed.__seedVersion !== this.SEED_VERSION) {
                        throw new Error('Saved DB predates the current seed');
                    }
                    this.db = parsed;
                    this.ensureSchema(seed);
                    return;
                } catch (e) {
                    console.error("Error parsing saved DB, regenerating:", e);
                    this.db = seed;
                }
            }
        }
        // Fallback: generate and save
        this.db.__seedVersion = this.SEED_VERSION;
        this.clearSeededActivity();
        this.saveDB();
    },

    // Backfill collections added in later versions onto an older saved DB so
    // renderers never hit undefined. Attendance was added in v2. `seed` is the
    // pristine dataset from the class literal.
    ensureSchema(seed) {
        seed = seed || {};
        let changed = false;
        if (this.db.__seedVersion !== this.SEED_VERSION) { this.db.__seedVersion = this.SEED_VERSION; changed = true; }
        if (!Array.isArray(this.db.transactions)) { this.db.transactions = []; changed = true; }
        if (!Array.isArray(this.db.collectionSessions)) { this.db.collectionSessions = []; changed = true; }
        if (!Array.isArray(this.db.attendanceHeadcounts)) { this.db.attendanceHeadcounts = []; changed = true; }
        if (!Array.isArray(this.db.events)) { this.db.events = []; changed = true; }
        if (!Array.isArray(this.db.sermons)) { this.db.sermons = []; changed = true; }
        if (!Array.isArray(this.db.prayerRequests)) { this.db.prayerRequests = []; changed = true; }
        if (!Array.isArray(this.db.recurringGifts)) { this.db.recurringGifts = []; changed = true; }
        // Backfill the rest straight from the pristine seed — one source of
        // truth, so rebranding the dataset never has to be done twice.
        ['branches', 'campaigns', 'followUps', 'groups', 'announcements', 'readingPlans'].forEach((key) => {
            if (!Array.isArray(this.db[key])) {
                this.db[key] = JSON.parse(JSON.stringify(seed[key] || []));
                changed = true;
            }
        });
        if (!this.db.readingState || typeof this.db.readingState !== 'object' || Array.isArray(this.db.readingState)) {
            this.db.readingState = {};
            changed = true;
        }
        if (!Array.isArray(this.db.attendance) || (this.db.members.length > 0 && this.db.attendance.length === 0)) {
            this.generateInitialAttendance();
            changed = true;
        }
        if (changed) this.saveDB();
    },

    // Keep the configured campuses and sign-in shell, but remove every
    // preloaded record. Administrators can add real records from the app.
    clearSeededActivity() {
        this.db.members = [];
        this.db.transactions = [];
        this.db.collectionSessions = [];
        this.db.attendance = [];
        this.db.attendanceHeadcounts = [];
        this.db.recurringGifts = [];
        this.db.campaigns = [];
        this.db.followUps = [];
        this.db.groups = [];
        this.db.announcements = [];
        this.db.events = [];
        this.db.sermons = [];
        this.db.prayerRequests = [];
        this.db.readingPlans = [];
        this.db.readingState = {};
    },

    // The Sundays we hold services on — most recent `count`, oldest first.
    getRecentServiceDates(count) {
        const dates = [];
        const anchor = new Date();
        anchor.setHours(0, 0, 0, 0);
        anchor.setDate(anchor.getDate() - anchor.getDay()); // back to most recent Sunday
        for (let i = 0; i < count; i++) {
            const d = new Date(anchor.getTime() - i * 7 * 24 * 60 * 60 * 1000);
            dates.push(d.toISOString().split('T')[0]);
        }
        return dates.reverse();
    },

    // Theme: Load state
    loadTheme() {
        if (typeof localStorage !== 'undefined') {
            let savedTheme = localStorage.getItem('church2_theme') || 'dark';
            // The old neon theme was retired in favour of the on-brand
            // Midnight theme; migrate anyone still holding the old value so
            // they don't land on a class that no longer has styles.
            if (savedTheme === 'cyber') {
                savedTheme = 'midnight';
                localStorage.setItem('church2_theme', savedTheme);
            }
            document.body.className = savedTheme === 'dark' ? '' : 'theme-' + savedTheme;
            this.syncThemeColor(savedTheme);
            const themeSelect = document.getElementById('interface-theme-select');
            if (themeSelect) themeSelect.value = savedTheme;
        }
    },

    syncThemeColor(theme) {
        const colors = { light: '#f3f6fb', dark: '#080b14', midnight: '#01040f' };
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = colors[theme] || colors.dark;
    },

    // ---- Auth gate (mock login + MFA + RBAC) --------------------------------
    loadSession() {
        if (typeof localStorage === 'undefined') return null;
        try {
            const raw = localStorage.getItem('church2_session');
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    },

    saveSession(user) {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('church2_session', JSON.stringify(user));
        }
    },

    // A client opening a preview link should land in the app, not on a login
    // form. `?preview` (or #preview) does that.
    //
    // Deliberately impossible to reach once a real backend is configured:
    // apiEnabled() means live data behind real credentials, and no URL
    // parameter may ever bypass that. In standalone mode there is nothing to
    // protect — every record on screen is seeded sample data.
    wantsPreviewEntry() {
        if (this.apiEnabled()) return false;
        const q = window.location.search + window.location.hash;
        return /(^|[?&#])preview\b/.test(q);
    },

    // Sign straight in as the HQ administrator, the role that shows the whole
    // product. The auth gate is still there — signing out reveals it.
    enterPreview() {
        const user = this.DEMO_USERS.find((u) => u.role === 'hq_admin');
        if (!user) { this.showAuthScreen('credentials'); return; }
        const { password, ...safe } = user;
        this.saveSession(safe);
        this.applyUser(safe);
        this.showApp();
        this.renderAll();
    },

    applyUser(user) {
        if (!this.ROLE_TABS[user.role]) {
            if (typeof localStorage !== 'undefined') localStorage.removeItem('church2_session');
            if (window.Church2API && Church2API.isEnabled()) Church2API.logout();
            this.session.currentUser = null;
            this.showAuthScreen('credentials');
            return false;
        }
        this.session.currentUser = user;
        this.session.currentRole = user.role;
        this.session.currentBranch = user.role === 'hq_admin' ? 'b1' : user.branchId;
        this.session.mfaVerified = true;
        this.session.activeTab = 'admin_dashboard';
        // Reflect the signed-in role in the simulator dropdown.
        const roleSel = document.getElementById('role-simulator-select');
        if (roleSel) roleSel.value = user.role;
        return true;
    },

    showApp() {
        const auth = document.getElementById('auth-screen');
        const app = document.getElementById('app-container');
        if (auth) auth.style.display = 'none';
        if (app) app.style.display = 'flex';
        this.renderDemoBanner();
    },

    showAuthScreen(step, ctx) {
        const auth = document.getElementById('auth-screen');
        const app = document.getElementById('app-container');
        if (app) app.style.display = 'none';
        if (!auth) return;
        auth.style.display = 'flex';

        if (step === 'mfa') {
            auth.innerHTML = `
                <div class="auth-card">
                    <div class="auth-brand"><span class="auth-logo"><svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15M7.5 9.2h9"/><path d="M5.6 19.4c1.7-2.2 3.8-3.3 6.4-3.3s4.7 1.1 6.4 3.3" opacity="0.85"/></svg></span><span>Christian Mission Dunamis</span></div>
                    <h2 class="auth-title">Two-factor verification</h2>
                    <p class="auth-sub">We texted a 6-digit code to the phone on file for <strong>${esc(ctx.email)}</strong>. Enter it to continue. <span class="auth-hint">(demo code: 123456)</span></p>
                    <form id="mfa-form" class="auth-form">
                        <input type="text" id="mfa-code" class="auth-input" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code" aria-label="6-digit code" required>
                        <p id="auth-error" class="auth-error" role="alert"></p>
                        <button type="submit" class="auth-btn">Verify &amp; sign in</button>
                        <button type="button" class="auth-link" id="mfa-back">← Back to login</button>
                    </form>
                </div>`;
            document.getElementById('mfa-form').onsubmit = (e) => { e.preventDefault(); this.handleMfa(ctx); };
            document.getElementById('mfa-back').onclick = () => this.showAuthScreen('credentials');
            document.getElementById('mfa-code').focus();
            return;
        }

        if (step === 'signup') {
            this.showAuthScreen('credentials');
            const error = document.getElementById('auth-error');
            if (error) error.textContent = 'Member account registration is no longer available.';
            return;
        }

        // credentials step
        auth.innerHTML = `
            <div class="auth-card">
                <div class="auth-brand"><span class="auth-logo"><svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15M7.5 9.2h9"/><path d="M5.6 19.4c1.7-2.2 3.8-3.3 6.4-3.3s4.7 1.1 6.4 3.3" opacity="0.85"/></svg></span><span>Christian Mission Dunamis</span></div>
                <h2 class="auth-title">Sign in to your ministry console</h2>
                <p class="auth-sub">Secure access to your church's data.</p>
                <form id="login-form" class="auth-form">
                    <label class="auth-label" for="login-email">Email</label>
                    <input type="email" id="login-email" class="auth-input" placeholder="you@chritianmissiondunamis.org" autocomplete="username" required>
                    <label class="auth-label" for="login-password">Password</label>
                    <input type="password" id="login-password" class="auth-input" placeholder="••••••••" autocomplete="current-password" required>
                    <p id="auth-error" class="auth-error" role="alert"></p>
                    <button type="submit" class="auth-btn">Continue</button>
                </form>
                ${this.apiEnabled() ? '' : '<p class="auth-demo-notice">Standalone demo mode: accounts are stored only in this browser.</p>'}
            </div>`;
        document.getElementById('login-form').onsubmit = (e) => { e.preventDefault(); this.handleLogin(); };
    },

    // Restore an API-backed session from the stored token (production mode).
    initApiAuth() {
        if (Church2API.getToken()) {
            Church2API.me()
                .then(({ user }) => {
                    if (!this.applyUser(user)) return;
                    this.showApp();
                    this.hydrateThenRender();
                })
                .catch(() => { Church2API.logout(); this.showAuthScreen('credentials'); });
        } else {
            this.showAuthScreen('credentials');
        }
    },

    _finishApiLogin(user) {
        // The JWT is already stored by the API client; never persist the password.
        if (!this.applyUser(user)) return;
        this.showApp();
        this.hydrateThenRender();
        this.toast(`Welcome, ${user.name}. 👋`);
    },

    // ----- Backend data layer -------------------------------------------------
    // In production the app is backend-backed: this.db is hydrated from Postgres
    // on login and every mutation is mirrored to the API. In standalone demo mode
    // (no apiBase configured) all of this is a no-op and the localStorage flow
    // below is used unchanged.
    apiEnabled() { return Boolean(window.Church2API && Church2API.isEnabled()); },

    // Who may change the membership roll. Agreed 17 Aug: adding and removing
    // members is the administrator's job alone — ministry leaders
    // may read the roll but never alter it. Checked at every mutation as well
    // as when drawing the UI, because a hidden button is not a permission.
    isAdmin() {
        return this.session.currentRole === 'hq_admin' || this.session.currentRole === 'branch_admin';
    },

    canManageMinistryItems() {
        return this.isAdmin() || this.session.currentRole === 'ministry_leader';
    },

    // How someone travelled to the service. Motorcycle is labelled for Kenya,
    // where a boda is the everyday equivalent of a bus fare.
    ARRIVAL_MODES: ['Car', 'Motorcycle (boda)', 'Bicycle', 'Walked', 'Other'],

    // Marital status options offered at registration; '' means not disclosed.
    MARITAL_STATUSES: ['Single', 'Married', 'Engaged', 'Widowed', 'Separated', 'Divorced'],

    // The role shown beside a name on the check-in sheet. Members serve under
    // their primary ministry skill; everyone else is simply a member.
    serviceRole(member) {
        const skills = member.volunteer_skills || [];
        return skills.length ? skills[0] : 'Member';
    },

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) throw new Error(`Modal "${modalId}" was not found`);

        this._modalFocusReturn ||= new Map();
        if (!this._modalFocusReturn.has(modalId)) {
            this._modalFocusReturn.set(modalId, document.activeElement);
        }
        if (this._modalOriginalOverflow === undefined) {
            this._modalOriginalOverflow = document.body.style.overflow;
        }

        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        const focusTarget = modal.querySelector(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || modal.querySelector('.modal-card');
        if (focusTarget) {
            if (!focusTarget.hasAttribute('tabindex') && focusTarget.classList.contains('modal-card')) {
                focusTarget.setAttribute('tabindex', '-1');
            }
            requestAnimationFrame(() => focusTarget.focus());
        }
    },

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) throw new Error(`Modal "${modalId}" was not found`);

        if (modalId === 'confirm-modal' && this._confirmResolver) {
            this._confirmResolver();
            return;
        }

        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        const returnFocus = this._modalFocusReturn?.get(modalId);
        this._modalFocusReturn?.delete(modalId);

        const anotherModalOpen = [...document.querySelectorAll('.modal-overlay')]
            .some((overlay) => overlay.style.display !== 'none' && getComputedStyle(overlay).display !== 'none');
        if (!anotherModalOpen) {
            document.body.style.overflow = this._modalOriginalOverflow || '';
            this._modalOriginalOverflow = undefined;
            if (returnFocus?.isConnected) returnFocus.focus();
        }
    },

    closeAnyOpenModal() {
        const openModals = [...document.querySelectorAll('.modal-overlay')]
            .filter((overlay) => overlay.style.display !== 'none' && getComputedStyle(overlay).display !== 'none');
        const modal = openModals[openModals.length - 1];
        if (modal) this.closeModal(modal.id);
    },

    // A promise-based confirm so destructive actions get a real dialog rather
    // than a blocking window.confirm(), which the rest of the app avoids.
    confirmAction({ title, body, confirmLabel = 'Confirm', danger = true }) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirm-modal');
            if (!modal) { resolve(false); return; }
            modal.querySelector('#confirm-title').textContent = title;
            modal.querySelector('#confirm-body').textContent = body;
            const ok = modal.querySelector('#confirm-ok');
            const cancel = modal.querySelector('#confirm-cancel');
            ok.textContent = confirmLabel;
            ok.className = danger ? 'btn btn-danger' : 'btn btn-primary-gradient';
            let settled = false;
            const finish = (answer) => {
                if (settled) return;
                settled = true;
                this._confirmResolver = null;
                ok.onclick = null;
                cancel.onclick = null;
                this.closeModal('confirm-modal');
                resolve(answer);
            };
            this._confirmResolver = () => finish(false);
            ok.onclick = () => finish(true);
            cancel.onclick = () => finish(false);
            this.openModal('confirm-modal');
        });
    },

    // One session per account. When the server rejects our token because the
    // account signed in somewhere else, drop straight back to the login screen
    // and say why — a silent failure would look like the app was broken.
    handleSessionLost(message) {
        if (this._sessionLostHandled) return;
        this._sessionLostHandled = true;
        if (typeof localStorage !== 'undefined') localStorage.removeItem('church2_session');
        this.session.currentUser = null;
        this.showAuthScreen('credentials');
        const err = document.getElementById('auth-error');
        if (err) err.textContent = message || 'Your session ended. Please sign in again.';
        this._sessionLostHandled = false;
    },

    // Standalone mode means every name, gift and attendance mark on screen is
    // seeded sample data. Say so where a client previewing the console cannot
    // miss it — mistaking these figures for the church's own records would be
    // the worst possible first impression.
    renderDemoBanner() {
        const bar = document.getElementById('demo-banner');
        if (!bar) return;
        // The production build does not display a demo-data notice because it
        // ships with no sample records.
        bar.hidden = true;
        return;
        if (this.apiEnabled() || sessionStorage.getItem('church2_demo_notice') === 'hidden') {
            bar.hidden = true;
            return;
        }
        const name = (window.MMC_BRAND && MMC_BRAND.name) || 'this church';
        bar.querySelector('.demo-banner-text').innerHTML =
            `<strong>Sample data.</strong> These members, gifts and attendance records are ` +
            `illustrative — none of ${esc(name)}'s real information is in this preview, and ` +
            `giving is recorded here, not charged.`;
        bar.hidden = false;
        bar.querySelector('.demo-banner-close').onclick = () => {
            sessionStorage.setItem('church2_demo_notice', 'hidden');
            bar.hidden = true;
        };
    },

    // Paint immediately with whatever we have, then refresh from the server.
    // First paint is never blocked on the network; a slow/failed fetch just
    // leaves the current data in place.
    hydrateThenRender() {
        this.renderAll();
        if (!this.apiEnabled()) return;
        this.hydrateFromApi().then(() => this.renderAll()).catch(() => {});
    },

    // Pull the shared dataset into this.db so every existing (synchronous) view
    // reflects Postgres. Scope is enforced server-side; we request the full
    // permitted set with 'global' and let the client's campus filter narrow it,
    // exactly as in standalone mode. A slice is only replaced when its fetch
    // succeeded, so a partial outage degrades gracefully. Never throws.
    async hydrateFromApi() {
        if (!this.apiEnabled()) return;
        const g = 'global';
    const canReadFinancialSchedules = this.isAdmin();
    const grab = (p) => p.then((r) => r).catch((e) => { console.error('Hydrate failed:', e); return undefined; });
        const [members, transactions, collectionSessions, attendance, attendanceHeadcounts, groups, followUps, announcements, prayerRequests, events, campaigns, recurringGifts] = await Promise.all([
            grab(Church2API.members(g)),
            grab(Church2API.transactions(g)),
            grab(Church2API.collectionSessions(g)),
            grab(Church2API.attendance(g)),
            grab(Church2API.attendanceHeadcounts(g)),
            grab(Church2API.groups(g)),
            grab(Church2API.followups(g)),
            grab(Church2API.announcements()),
            grab(Church2API.prayerRequests(g)),
            grab(Church2API.events(g)),
            canReadFinancialSchedules ? grab(Church2API.campaigns(g)) : Promise.resolve(undefined),
            canReadFinancialSchedules ? grab(Church2API.recurringGifts(g)) : Promise.resolve(undefined),
        ]);
        // Successful empty responses are authoritative too; otherwise deleted
        // or not-yet-created records reappear from the browser's saved copy.
        if (Array.isArray(members)) this.db.members = members;
        if (Array.isArray(transactions)) this.db.transactions = transactions;
        if (Array.isArray(collectionSessions)) this.db.collectionSessions = collectionSessions;
        if (Array.isArray(attendance)) this.db.attendance = attendance;
        if (Array.isArray(attendanceHeadcounts)) this.db.attendanceHeadcounts = attendanceHeadcounts;
        if (Array.isArray(groups)) this.db.groups = groups;
        if (Array.isArray(followUps)) this.db.followUps = followUps;
        if (Array.isArray(announcements)) this.db.announcements = announcements;
        if (Array.isArray(prayerRequests)) this.db.prayerRequests = prayerRequests;
        if (Array.isArray(events)) this.db.events = events;
        if (Array.isArray(campaigns)) this.db.campaigns = campaigns;
        if (Array.isArray(recurringGifts)) this.db.recurringGifts = recurringGifts;
    },

    // Fire an API write in the background. The local optimistic update has
    // already rendered, so we only surface failures. `onOk` reconciles any
    // server-assigned id back onto the optimistic record. Never throws.
    apiWrite(promiseFactory, onOk) {
        if (!this.apiEnabled()) return;
        Promise.resolve().then(promiseFactory)
            .then((r) => { if (onOk) try { onOk(r); } catch (e) { console.error(e); } })
            .catch((e) => {
                console.error('Sync failed:', e);
                if (this.toast) this.toast('Saved locally, but not synced to the server.', 'error');
            });
    },

    handleLogin() {
        const email = document.getElementById('login-email').value.trim().toLowerCase();
        const password = document.getElementById('login-password').value;
        const err = document.getElementById('auth-error');

        // Production: authenticate against the real API.
        if (window.Church2API && Church2API.isEnabled()) {
            const submit = document.querySelector('#login-form button[type="submit"]');
            if (submit?.disabled) return;
            if (submit) {
                submit.disabled = true;
                submit.textContent = 'Signing in…';
            }
            Church2API.login(email, password)
                .then((r) => {
                    if (r.mfaRequired) this.showAuthScreen('mfa', { email, ticket: r.ticket });
                    else if (r.token) { Church2API.completePasswordLogin(r); this._finishApiLogin(r.user); }
                })
                .catch((e) => {
                    if (err) {
                        err.textContent = e.name === 'TypeError'
                            ? 'Cannot reach the sign-in server. Check the API address or server connection.'
                            : e.message || 'Sign in failed.';
                    }
                })
                .finally(() => {
                    if (submit?.isConnected) {
                        submit.disabled = false;
                        submit.textContent = 'Continue';
                    }
                });
            return;
        }

        // Demo: match a local account.
        const user = this.DEMO_USERS.find(u => u.email === email && u.password === password);
        if (!user) {
            if (err) err.textContent = 'Invalid email or password. Try a demo account below.';
            return;
        }
        this.showAuthScreen('mfa', { email: user.email });
    },

    handleMfa(ctx) {
        const code = (document.getElementById('mfa-code').value || '').trim();
        const err = document.getElementById('auth-error');
        if (!/^\d{6}$/.test(code)) {
            if (err) err.textContent = 'Enter the 6-digit code.';
            return;
        }

        // Production: verify the code with the API and receive the access token.
        if (window.Church2API && Church2API.isEnabled()) {
            Church2API.verifyMfa(ctx.ticket, code)
                .then((r) => this._finishApiLogin(r.user))
                .catch((e) => { if (err) err.textContent = e.message || 'Incorrect code.'; });
            return;
        }

        // Demo verification accepts the demo code.
        if (code !== '123456') {
            if (err) err.textContent = 'Incorrect code. (demo code: 123456)';
            return;
        }
        const user = this.DEMO_USERS.find(u => u.email === ctx.email);
        const { password, ...safeUser } = user;
        if (!this.applyUser(safeUser)) return;
        this.saveSession(safeUser);
        this.showApp();
        this.renderAll();
        this.toast(`Welcome, ${user.name}. 👋`);
    },

    logout() {
        if (typeof localStorage !== 'undefined') localStorage.removeItem('church2_session');
        if (window.Church2API && Church2API.isEnabled()) Church2API.logout();
        this.session.currentUser = null;
        this.showAuthScreen('credentials');
    },

    // Helper: Generate historical transactions over the last 14 days
    // Ten members makes every chart and average look like a toy. A real MMC
    // campus roll runs into the hundreds, so we grow the handcrafted core (m1–m10,
    // referenced by groups, events and prayer requests) into a congregation of a
    // believable size. Names are drawn from common Kenyan given/family names.
    generateCongregation() {
        const FIRST = ['Alice', 'Benard', 'Brenda', 'Caleb', 'Carolyne', 'Collins', 'Cynthia', 'Daniel',
            'Dennis', 'Dorcas', 'Edwin', 'Elizabeth', 'Emmanuel', 'Eunice', 'Evans', 'Gladys', 'Griffin',
            'Hellen', 'Ian', 'Irene', 'Isaac', 'Jackline', 'James', 'Joan', 'Joseph', 'Josphat', 'Judy',
            'Kevin', 'Lilian', 'Lucy', 'Martin', 'Mercy', 'Moses', 'Naomi', 'Nelson', 'Nancy', 'Patrick',
            'Pauline', 'Purity', 'Rose', 'Ruth', 'Silas', 'Sharon', 'Stephen', 'Susan', 'Timothy',
            'Valentine', 'Victor', 'Winnie', 'Zachary'];
        const LAST = ['Achieng', 'Barasa', 'Cheruiyot', 'Chepkoech', 'Gitonga', 'Kimani', 'Kiplagat',
            'Kirui', 'Koech', 'Langat', 'Maina', 'Makau', 'Mbugua', 'Mburu', 'Mutiso', 'Muthoni',
            'Mwende', 'Nyakundi', 'Njuguna', 'Nyambura', 'Obara', 'Ochieng', 'Odhiambo', 'Okoth',
            'Omondi', 'Ondiek', 'Owuor', 'Rotich', 'Sang', 'Wafula', 'Waweru', 'Wekesa'];
        const SKILLS = ['Ushering', 'Greeting', 'Worship Vocals', 'Keyboard', 'Guitar', 'Drums',
            'Sound Engineering', 'Video Editing', 'Graphics', 'Childcare', 'Youth Mentorship',
            'Intercession', 'First Aid', 'Security', 'Social Media', 'Hospitality', 'Public Speaking'];
        const ROLES = ['Single', 'Husband', 'Wife'];
        const MARITAL = ['Single', 'Married', 'Married', 'Engaged', 'Widowed', ''];
        const BEFORE = [
            'Ran a small shop in the estate before joining.',
            'Teacher at a nearby primary school.',
            'Worked upcountry in farming; moved to the city last year.',
            'Boda operator; joined after a friend invited him.',
            'Tailor with her own workshop.',
            'Studied at a technical college; now looking for work.',
            'Served as an usher at a previous church.',
            'Nurse at a clinic in the neighbourhood.',
            '',
        ];
        const HOPES = [
            'To grow in the word and find a home group.',
            'To serve somewhere practical.',
            'To bring the whole family into church life.',
            'To be discipled and eventually lead.',
            'Prayer support through a difficult season.',
            'To use their skills for the media team.',
            '',
        ];

        // Weighted so the CBD mother church carries most of the roll.
        const spread = [
            { branchId: 'b1', count: 78 },
            { branchId: 'b2', count: 41 },
            { branchId: 'b3', count: 27 }
        ];
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
        let n = this.db.members.length;

        spread.forEach(({ branchId, count }) => {
            const branch = this.db.branches.find(b => b.id === branchId);
            for (let i = 0; i < count; i++) {
                n += 1;
                const firstName = pick(FIRST);
                const lastName = pick(LAST);
                const skills = [...new Set([pick(SKILLS), pick(SKILLS)])];
                // Engagement clusters high — most of a congregation is engaged —
                // with a genuine tail so the at-risk analytics have real subjects.
                const roll = Math.random();
                const engagement = roll < 0.12 ? 20 + Math.floor(Math.random() * 25)
                    : roll < 0.35 ? 45 + Math.floor(Math.random() * 25)
                    : 70 + Math.floor(Math.random() * 30);
                this.db.members.push({
                    id: `m${n}`,
                    branchId,
                    branchName: branch ? branch.name : '',
                    firstName,
                    lastName,
                    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${n}@email.com`,
                    phone: `+2547${String(10000000 + Math.floor(Math.random() * 89999999))}`,
                    familyId: `fam_${lastName.toLowerCase()}_${n}`,
                    familyRole: pick(ROLES),
                    spiritualMilestones: Math.random() < 0.6
                        ? [`Member: ${2012 + Math.floor(Math.random() * 13)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`]
                        : [],
                    volunteer_skills: skills,
                    engagement_score: engagement,
                    maritalStatus: pick(MARITAL),
                    background: pick(BEFORE),
                    expectations: pick(HOPES)
                });
            }
        });

        // Enrol roughly half of each campus into that campus's groups. Groups
        // seeded with two or three named members look empty next to an 83-person
        // campus roll, which misreads as "nobody uses this feature".
        this.db.branches.forEach((branch) => {
            const groups = this.db.groups.filter(g => g.branchId === branch.id);
            if (!groups.length) return;
            const pool = this.db.members.filter(m => m.branchId === branch.id);
            pool.forEach((m, i) => {
                if (Math.random() > 0.5) return;
                const g = groups[i % groups.length];
                if (!g.memberIds.includes(m.id)) g.memberIds.push(m.id);
            });
        });
    },

    generateInitialTransactions() {
        // Amount bands are in Kenyan Shillings and differ by category — a tithe
        // is a far larger cheque than a Sunday offering, and flattening them
        // would make the giving analytics meaningless.
        const bands = {
            'Tithe': [2000, 25000],
            'Offering': [100, 2000],
            'Pledge': [1000, 15000],
            'Project Donation': [500, 10000]
        };
        const categories = Object.keys(bands);
        // Weighted to reflect Kenyan giving: M-Pesa carries the clear majority.
        const methods = ['M-Pesa', 'M-Pesa', 'M-Pesa', 'M-Pesa', 'Bank Transfer', 'Cash', 'Card'];
        const now = new Date();

        // Roughly one gift per member over the fortnight, so the giving totals
        // stay proportional to the size of the congregation.
        const txCount = Math.max(40, Math.round(this.db.members.length * 1.4));
        for (let i = 0; i < txCount; i++) {
            const memberIndex = Math.floor(Math.random() * this.db.members.length);
            const member = this.db.members[memberIndex];
            const category = categories[Math.floor(Math.random() * categories.length)];
            const [lo, hi] = bands[category];
            // Round to the nearest 50 shillings — real giving lands on round numbers.
            const amount = Math.round((Math.random() * (hi - lo) + lo) / 50) * 50;
            const method = methods[Math.floor(Math.random() * methods.length)];
            
            // Random date in the last 14 days
            const daysAgo = Math.floor(Math.random() * 14);
            const txDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
            
            this.db.transactions.push({
                id: `t_${i}`,
                branchId: member.branchId,
                branchName: member.branchName,
                memberId: member.id,
                memberName: `${member.firstName} ${member.lastName}`,
                amount: amount,
                category: category,
                date: txDate.toISOString().split('T')[0],
                paymentMethod: method,
                receiptNumber: `REC-2026-${10000 + i}`
            });
        }
        
        // Sort transactions by date descending
        this.db.transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    // Helper: Seed real attendance records over the last 8 Sundays. These records
    // are the single source of truth for all attendance analytics — the dashboard
    // and AI briefing read them, never a random number.
    generateInitialAttendance() {
        this.db.attendance = [];
        const services = this.getRecentServiceDates(8); // oldest -> newest
        // Members deliberately given a recent absence streak so at-risk detection
        // has something real to surface.
        const streakIds = ['m7', 'm9', 'm10'];

        this.db.members.forEach(member => {
            const base = Math.min(0.95, Math.max(0.35, (member.engagement_score || 60) / 100));
            services.forEach((date, idx) => {
                const isRecent = idx >= services.length - 3; // last 3 services
                let present;
                if (streakIds.includes(member.id) && isRecent) {
                    present = false; // guaranteed 3-service absence streak
                } else {
                    present = Math.random() < base;
                }
                const ARRIVALS = ['Car', 'Motorcycle (boda)', 'Bicycle', 'Walked', 'Walked', 'Other'];
                this.db.attendance.push({
                    id: `att_${member.id}_${date}`,
                    memberId: member.id,
                    branchId: member.branchId,
                    date,
                    present,
                    arrivalMode: present ? ARRIVALS[Math.floor(Math.random() * ARRIVALS.length)] : ''
                });
            });
        });
    },

    // 5. Setup Action Listeners
    setupEventHandlers() {
        // Interface Theme Switcher
        const themeSelectEl = document.getElementById('interface-theme-select');
        if (themeSelectEl) {
            themeSelectEl.addEventListener('change', (e) => {
                const theme = e.target.value;
                document.body.className = theme === 'dark' ? '' : 'theme-' + theme;
                this.syncThemeColor(theme);
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('church2_theme', theme);
                }
                // Chart.js paints to a canvas and can't inherit the new CSS
                // tokens, so the charts need recolouring. Do it in place rather
                // than via renderAll(): a full re-render destroys and rebuilds
                // every chart, and the rebuild animates up from zero, so the
                // canvas is visibly blank for a beat on every theme switch.
                this.applyChartTheme();
            });
        }

        // Role Selector Change
        document.getElementById('role-simulator-select').addEventListener('change', (e) => {
            this.session.currentRole = e.target.value;
            this.session.activeTab = 'admin_dashboard';
            this.renderAll();
        });

        // Branch Switcher Change
        document.getElementById('global-branch-select').addEventListener('change', (e) => {
            this.session.currentBranch = e.target.value;
            this.renderAll();
        });

        // Sidebar Navigation links
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                navLinks.forEach(n => n.classList.remove('active'));
                link.classList.add('active');
                this.session.activeTab = link.dataset.tab;
                this.renderAll();
            });
        });

        // Search Bar Event
        document.getElementById('member-search-input').addEventListener('input', () => {
            this.renderMemberDirectory();
        });
        document.getElementById('member-branch-filter').addEventListener('change', () => {
            this.renderMemberDirectory();
        });
        document.getElementById('member-branch-select').addEventListener('change', (event) => {
            if (this.memberImportState?.running) {
                event.target.value = this.memberImportState.branchId;
                return;
            }
            this.renderMemberGroupOptions();
            this.resetMemberImport();
        });
        document.getElementById('member-csv-file').addEventListener('change', (event) => {
            this.handleMemberCsvSelected(event.target.files?.[0]);
        });
        document.getElementById('member-csv-template').addEventListener('click', () => this.downloadMemberCsvTemplate());
        document.getElementById('member-import-cancel').addEventListener('click', () => this.resetMemberImport());
        document.getElementById('member-import-submit').addEventListener('click', () => this.importMembersFromCsv());
        document.getElementById('member-account-role').addEventListener('change', (event) => {
            const enabled = Boolean(event.target.value);
            document.getElementById('member-account-fields').hidden = !enabled;
            document.getElementById('member-account-password').required = enabled;
            event.target.setAttribute('aria-expanded', String(enabled));
        });

        // Add Member Form Submit
        document.getElementById('add-member-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleCreateMember();
        });

        // Record Transaction Form Submit
        document.getElementById('record-tx-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRecordTransaction();
        });
        document.getElementById('collection-session-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleCreateCollectionSession();
        });
        ['collection-offering', 'collection-tithe', 'collection-other'].forEach((id) => {
            document.getElementById(id).addEventListener('input', () => this.updateCollectionTotal());
        });
        document.getElementById('attendance-headcount-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSaveAttendanceHeadcount();
        });

        // AI Sermon Repurpose Submit
        document.getElementById('ai-repurpose-btn').addEventListener('click', () => {
            this.handleSermonRepurpose();
        });

        // Sign out
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
    },

    // 6. Master Render Coordinator
    // Live theme tokens for canvas-drawn charts, which can't inherit CSS.
    chartTheme() {
        const css = getComputedStyle(document.body);
        const read = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
        const light = document.body.classList.contains('theme-light');
        return {
            tick: read('--text-secondary', '#9ca3af'),
            grid: light ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255,255,255,0.05)',
            surface: light ? '#ffffff' : '#0b1220',
            legend: read('--text-primary', '#f3f4f6')
        };
    },

    // Recolour the live charts for the current theme without rebuilding them.
    // `update('none')` skips the entry animation, so there is no blank frame.
    applyChartTheme() {
        const ct = this.chartTheme();

        const giving = this.charts.giving;
        if (giving) {
            const sc = giving.options.scales;
            sc.y.ticks.color = ct.tick;
            sc.y.grid.color = ct.grid;
            sc.x.ticks.color = ct.tick;
            giving.update('none');
        }

        const categories = this.charts.categories;
        if (categories) {
            categories.data.datasets[0].borderColor = ct.surface;
            categories.options.plugins.legend.labels.color = ct.legend;
            categories.update('none');
        }

        const attendance = this.charts.attendance;
        if (attendance) {
            const sc = attendance.options.scales;
            sc.y.ticks.color = ct.tick;
            sc.y.grid.color = ct.grid;
            sc.x.ticks.color = ct.tick;
            attendance.update('none');
        }
    },

    // Fill every campus <select> from db.branches so the campus list lives in
    // exactly one place. Selects keep any leading "all"/"global" option and
    // their current value where it is still valid.
    populateCampusSelects() {
        document.querySelectorAll('select[data-campus-select]').forEach((sel) => {
            const previous = sel.value;
            const keep = [...sel.options].filter(o => o.value === 'all' || o.value === 'global');
            sel.innerHTML = '';
            keep.forEach(o => sel.appendChild(o));
            this.db.branches.forEach((b) => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.name;
                sel.appendChild(opt);
            });
            if (previous && [...sel.options].some(o => o.value === previous)) sel.value = previous;
        });

        // Member pickers list the people actually on the books, scoped to the
        // campus in view so a branch admin can't record giving for another campus.
        const scope = this.session.currentBranch;
        const inScope = this.db.members.filter(m => scope === 'global' || m.branchId === scope);
        document.querySelectorAll('select[data-member-select]').forEach((sel) => {
            const previous = sel.value;
            const keep = [...sel.options].filter(o => o.value === 'anonymous');
            sel.innerHTML = '';
            keep.forEach(o => sel.appendChild(o));
            inScope.forEach((m) => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = `${m.firstName} ${m.lastName}`;
                sel.appendChild(opt);
            });
            if (previous && [...sel.options].some(o => o.value === previous)) sel.value = previous;
        });
    },

    renderAll() {
        this.populateCampusSelects();
        const role = this.session.currentRole;
        const branchId = this.session.currentBranch;

        // RBAC enforcement: if the current role isn't permitted the active tab,
        // redirect to that role's default landing tab. This is real access
        // control — not merely hiding nav links — so no route reaches a panel
        // the role can't see.
        const allowed = this.ROLE_TABS[role];
        if (!allowed) {
            this.logout();
            return;
        }
        if (!allowed.includes(this.session.activeTab)) {
            this.session.activeTab = 'admin_dashboard';
        }
        const activeTab = this.session.activeTab;

        // Sync header displays. "global" is a valid selection (All Branches) that
        // has no matching branch record, so fall back to a friendly label instead
        // of dereferencing undefined and aborting the entire render.
        const branchObj = this.db.branches.find(b => b.id === branchId);
        const branchLabel = branchObj ? branchObj.name : (branchId === 'global' ? 'All Branches' : 'Unknown Campus');
        document.getElementById('active-branch-indicator').innerText = branchLabel;
        document.getElementById('active-role-indicator').innerText = role.toUpperCase().replace('_', ' ');

        // The "Simulated Role" preview control is a super-admin-only affordance.
        // Hiding it for other signed-in users closes an escalation path: a member
        // must not be able to switch themselves into an admin role.
        const roleSimWrap = document.getElementById('role-simulator-select')?.closest('div');
        if (roleSimWrap) {
            const isSuperAdmin = !this.session.currentUser || this.session.currentUser.role === 'hq_admin';
            roleSimWrap.style.display = isSuperAdmin ? '' : 'none';
        }

        // Branch scope: HQ admin roams all campuses; every other role is locked
        // to the campus they actually administer (from their signed-in account),
        // not a hardcoded default.
        const branchSelect = document.getElementById('global-branch-select');
        if (role === 'hq_admin') {
            branchSelect.removeAttribute('disabled');
            // Keep the control showing the scope actually in force. The options
            // are rebuilt from the database on every render, which resets the
            // element to its first option ("All Branches") — so without this the
            // selector claimed a global view while the data was one campus.
            if (branchSelect.value !== this.session.currentBranch) {
                branchSelect.value = this.session.currentBranch;
            }
        } else {
            const homeBranch = (this.session.currentUser && this.session.currentUser.branchId) || 'b1';
            this.session.currentBranch = homeBranch;
            branchSelect.value = homeBranch;
            branchSelect.setAttribute('disabled', 'true');
        }

        // Adding members is the administrator's job (agreed 17 Aug), so the
        // enlist form is not offered to anyone else. handleCreateMember()
        // re-checks — this only removes the temptation.
        const addCard = document.getElementById('member-add-card');
        if (addCard) addCard.style.display = this.isAdmin() ? '' : 'none';
        const importCard = document.getElementById('member-import-card');
        if (importCard) importCard.style.display = this.isAdmin() ? '' : 'none';
        const branchAdminRole = document.querySelector('#member-account-role option[value="branch_admin"]');
        if (branchAdminRole) branchAdminRole.disabled = role !== 'hq_admin';

        // Sidebar link visibility is driven entirely by ROLE_TABS — the single
        // source of truth — so the nav can never show a link the RBAC check at
        // the top of renderAll would immediately bounce.
        const allowedTabs = this.ROLE_TABS[role];
        document.querySelectorAll('.nav-link').forEach(link => {
            const tab = link.dataset.tab;
            link.style.display = allowedTabs.includes(tab) ? 'flex' : 'none';
            link.classList.toggle('active', tab === activeTab);
        });

        // Render main view panels
        const panels = ['admin_dashboard', 'admin_directory', 'admin_financials', 'admin_attendance', 'admin_ministry', 'admin_followups', 'admin_groups', 'admin_communications'];
        panels.forEach(p => {
            const panelEl = document.getElementById(p);
            if (panelEl) {
                panelEl.style.display = (p === activeTab) ? 'block' : 'none';
            }
        });

        // Only the active panel re-renders, so a panel the current role may not
        // open keeps whatever markup it had when someone else was signed in —
        // including admin-only controls such as Remove. They are inert (every
        // mutation re-checks permission) but leaving them in the document is
        // the sort of thing that quietly becomes a real hole later, so clear
        // out the dynamic content of anything this role cannot reach.
        const PANEL_CONTENT = {
            admin_directory: ['member-directory-tbody'],
            admin_financials: ['financials-tbody', 'contribution-summary', 'giving-insights'],
            admin_attendance: ['attendance-tbody', 'attendance-arrival', 'attendance-summary'],
            admin_ministry: ['rota-required-roles', 'prayer-requests-list'],
            admin_followups: ['followup-board'],
            admin_groups: ['groups-grid'],
            admin_communications: ['broadcast-log'],
        };
        Object.entries(PANEL_CONTENT).forEach(([tab, ids]) => {
            if (allowedTabs.includes(tab)) return;
            ids.forEach((id) => {
                const node = document.getElementById(id);
                if (node) node.innerHTML = '';
            });
        });

        // Trigger individual panel renders
        if (activeTab === 'admin_dashboard') {
            this.renderDashboard();
        } else if (activeTab === 'admin_directory') {
            this.renderMemberDirectory();
        } else if (activeTab === 'admin_financials') {
            this.renderFinancials();
        } else if (activeTab === 'admin_attendance') {
            this.renderAttendance();
        } else if (activeTab === 'admin_ministry') {
            this.renderMinistry();
        } else if (activeTab === 'admin_followups') {
            this.renderFollowUps();
        } else if (activeTab === 'admin_groups') {
            this.renderGroups();
        } else if (activeTab === 'admin_communications') {
            this.renderCommunications();
        }
    },

    // 7. Panel: Dashboard View Rendering
    renderDashboard() {
        const branchId = this.session.currentBranch;
        const role = this.session.currentRole;

        // Filter transactions/attendance for calculations. Scope to a single campus
        // unless "All Branches (Global)" is selected, in which case aggregate everything.
        let branchTx = this.db.transactions;
        let branchMembers = this.db.members;
        let branchAttendance = this.db.attendance || [];

        if (branchId && branchId !== 'global') {
            branchTx = this.db.transactions.filter(t => t.branchId === branchId);
            branchMembers = this.db.members.filter(m => m.branchId === branchId);
            branchAttendance = branchAttendance.filter(a => a.branchId === branchId);
        }

        // Compute AI Snapshot Metrics — all derived from real records, no randomness
        const snapshot = window.AIEngine.generateWeeklySnapshot(
            this.db.branches,
            branchMembers,
            branchTx,
            this.db.events,
            branchAttendance
        );

        // Update dashboard counters
        document.getElementById('dash-giving-total').innerText = money(snapshot.thisWeekGiving);
        document.getElementById('dash-giving-change').innerText = snapshot.givingDiffPercent;
        document.getElementById('dash-giving-change').className = snapshot.givingDiffPercent.startsWith('-') ? 'changedown' : 'changeup';

        document.getElementById('dash-attendance-total').innerText = snapshot.avgAttendance;
        document.getElementById('dash-attendance-change').innerText = snapshot.attendanceDiffPercent;
        document.getElementById('dash-attendance-change').className = snapshot.attendanceDiffPercent.startsWith('-') ? 'changedown' : 'changeup';

        document.getElementById('dash-members-total').innerText = branchMembers.length;
        // Label the scope honestly — "Across campuses" is wrong when a single
        // campus is selected, and the count would look like a church-wide total.
        const scopeLabel = document.getElementById('dash-members-scope');
        if (scopeLabel) {
            const b = this.db.branches.find(x => x.id === this.session.currentBranch);
            scopeLabel.innerText = b ? `At ${b.name}` : 'Across all campuses';
        }

        // Render AI Ministry Health Executive Briefing card
        const aiSnapshotCard = document.getElementById('ai-snapshot-content');
        if (aiSnapshotCard) {
            aiSnapshotCard.innerHTML = `
                <div class="ai-header-badge">
                    <svg class="badge-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/><path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/></svg> AI-GENERATED MONDAY BRIEFING
                </div>
                <p class="ai-report-title">Weekly Ministry Health Report</p>
                <div class="weekly-bulletin-ai md-body">${renderMarkdown(snapshot.bulletSummary)}</div>
                <div class="ai-exec-context md-body">
                    <strong>Executive Context:</strong> ${renderMarkdown(snapshot.executiveSnapshot)}
                </div>
                <div class="at-risk-container">
                    <span class="at-risk-heading"><svg class="inline-ico warn-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17.2v.1"/></svg> CRITICAL CARE ALERTS (At-Risk Members)</span>
                    <ul class="at-risk-list">
                        ${snapshot.atRisk.length ? snapshot.atRisk.map(m => `<li>${esc(m)}</li>`).join('') : '<li class="muted-italic">No at-risk members this week — great job! 🎉</li>'}
                    </ul>
                </div>
            `;
        }

        // Render charts inside dashboard
        this.renderDashboardCharts(branchTx);
    },

    renderDashboardCharts(transactions) {
        // Chart.js is loaded from a CDN and may be unavailable (offline, blocked,
        // or the PWA running without a network). Degrade gracefully instead of
        // throwing "Chart is not defined" and aborting the rest of init().
        if (typeof Chart === 'undefined') {
            document.querySelectorAll('.chart-container-wrapper').forEach((wrap) => {
                if (!wrap.querySelector('.chart-fallback')) {
                    const note = document.createElement('div');
                    note.className = 'chart-fallback';
                    note.textContent = 'Charts are unavailable offline. Reconnect to view visual analytics.';
                    wrap.appendChild(note);
                }
            });
            return;
        }

        // Destroy existing charts to avoid redraw issues
        if (this.charts.giving) this.charts.giving.destroy();
        if (this.charts.categories) this.charts.categories.destroy();

        // 1. Giving trend chart (Past 7 days)
        const ctxGiving = document.getElementById('giving-trend-chart')?.getContext('2d');
        if (ctxGiving) {
            // Group transactions by date
            const dateLabels = [];
            const amounts = [];
            const now = new Date();

            for (let i = 6; i >= 0; i--) {
                const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
                const dateStr = d.toISOString().split('T')[0];
                dateLabels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
                
                const daySum = transactions
                    .filter(t => t.date === dateStr)
                    .reduce((sum, t) => sum + parseFloat(t.amount), 0);
                amounts.push(daySum);
            }

            const ct = this.chartTheme();
            this.charts.giving = new Chart(ctxGiving, {
                type: 'line',
                data: {
                    labels: dateLabels,
                    datasets: [{
                        label: `Daily Giving (${MMC_BRAND.currency.symbol})`,
                        data: amounts,
                        borderColor: MMC_BRAND.palette.royalLight,
                        backgroundColor: 'rgba(59, 130, 246, 0.14)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 3,
                        pointBackgroundColor: MMC_BRAND.palette.gold,
                        pointBorderColor: '#fff',
                        pointRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            // Anchor at zero: a floating baseline visually
                            // exaggerates ordinary week-to-week variation.
                            beginAtZero: true,
                            grid: { color: ct.grid },
                            ticks: { color: ct.tick, callback: (v) => MMC_BRAND.moneyShort(v) }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: ct.tick }
                        }
                    }
                }
            });
        }

        // 2. Fund allocation breakdown chart (Doughnut)
        const ctxCategories = document.getElementById('category-pie-chart')?.getContext('2d');
        if (ctxCategories) {
            const categories = ['Tithe', 'Offering', 'Pledge', 'Project Donation'];
            const categorySums = categories.map(cat => 
                transactions
                    .filter(t => t.category === cat)
                    .reduce((sum, t) => sum + parseFloat(t.amount), 0)
            );

            const ctc = this.chartTheme();
            this.charts.categories = new Chart(ctxCategories, {
                type: 'doughnut',
                data: {
                    labels: categories,
                    datasets: [{
                        data: categorySums,
                        // Royal-and-gold brand ramp rather than a generic
                        // rainbow, so the chart reads as MMC at a glance.
                        backgroundColor: [
                            'rgba(29, 78, 216, 0.90)',   // Tithe — royal
                            'rgba(240, 180, 41, 0.90)',  // Offering — gold
                            'rgba(96, 165, 250, 0.90)',  // Pledge — light royal
                            'rgba(200, 137, 15, 0.90)'   // Project — deep gold
                        ],
                        borderColor: ctc.surface,
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: { color: ctc.legend, font: { size: 11 } }
                        }
                    }
                }
            });
        }
    },

    // Panel: Attendance & Check-In
    renderAttendance() {
        const branchId = this.session.currentBranch;
        this.renderAttendanceHeadcounts(branchId);
        const inScope = (m) => (!branchId || branchId === 'global') ? true : m.branchId === branchId;
        const members = this.db.members.filter(inScope);
        const attendance = (this.db.attendance || []).filter(a => members.some(m => m.id === a.memberId));

        // Service dropdown (most recent first)
        const serviceDates = [...new Set((this.db.attendance || []).map(a => a.date))].sort().reverse();
        if (!this.session.selectedServiceDate || !serviceDates.includes(this.session.selectedServiceDate)) {
            this.session.selectedServiceDate = serviceDates[0] || null;
        }
        const select = document.getElementById('attendance-service-select');
        if (select) {
            select.innerHTML = serviceDates.map((d, i) =>
                `<option value="${esc(d)}"${d === this.session.selectedServiceDate ? ' selected' : ''}>${esc(this.formatServiceLabel(d))}${i === 0 ? ' (latest)' : ''}</option>`
            ).join('');
            select.onchange = (e) => { this.session.selectedServiceDate = e.target.value; this.renderAttendance(); };
        }

        const serviceDate = this.session.selectedServiceDate;
        const recordFor = (memberId) => (this.db.attendance || []).find(a => a.memberId === memberId && a.date === serviceDate);

        // Headcount for the selected service (in scope)
        const presentCount = members.filter(m => (recordFor(m.id) || {}).present).length;
        const headEl = document.getElementById('attendance-headcount');
        if (headEl) {
            const pct = members.length ? Math.round((presentCount / members.length) * 100) : 0;
            headEl.innerHTML = `<strong>${presentCount}</strong> of <strong>${members.length}</strong> present
                <span class="attendance-pct">${pct}%</span>
                <span class="attendance-when">· ${esc(this.formatServiceLabel(serviceDate) || 'no service selected')}</span>`;
        }

        // Roster rows. A register of a hundred-plus people is worked through in a
        // hurry at the door, so: search to jump to a name, the role beside it so
        // an usher recognises who they are looking at, the whole row as the
        // check-in target, and travel recorded in the same pass.
        const filter = (this.session.attendanceFilter || '').trim().toLowerCase();
        const visible = filter
            ? members.filter((m) =>
                `${m.firstName} ${m.lastName}`.toLowerCase().includes(filter) ||
                this.serviceRole(m).toLowerCase().includes(filter))
            : members;

        const tbody = document.getElementById('attendance-tbody');
        if (tbody) {
            tbody.innerHTML = visible.map(m => {
                const rec = recordFor(m.id) || {};
                const present = !!rec.present;
                const arrival = rec.arrivalMode || '';
                const name = `${m.firstName} ${m.lastName}`;
                const options = ['<option value="">How did they travel?</option>']
                    .concat(this.ARRIVAL_MODES.map((mode) =>
                        `<option value="${esc(mode)}"${mode === arrival ? ' selected' : ''}>${esc(mode)}</option>`))
                    .join('');
                return `<tr class="${present ? 'is-present' : ''}" onclick="ChurchApp.toggleAttendance('${esc(m.id)}')">
                    <td>
                        <div class="member-profile-cell">
                            <div class="member-avatar">${esc((m.firstName[0] || '') + (m.lastName[0] || ''))}</div>
                            <span class="member-name">${esc(name)}</span>
                        </div>
                    </td>
                    <td><span class="role-pill">${esc(this.serviceRole(m))}</span></td>
                    <td><span class="branch-pill badge-${esc(m.branchId)}">${esc(m.branchName)}</span></td>
                    <td>
                        <select class="select-custom arrival-select" ${present ? '' : 'disabled'}
                            aria-label="How ${esc(name)} arrived"
                            onclick="event.stopPropagation()"
                            onchange="event.stopPropagation(); ChurchApp.setArrivalMode('${esc(m.id)}', this.value)">
                            ${options}
                        </select>
                    </td>
                    <td style="text-align:right;">
                        <button class="attendance-toggle ${present ? 'on' : ''}" role="switch" aria-checked="${present}"
                            aria-label="Mark ${esc(name)} ${present ? 'absent' : 'present'}"
                            onclick="event.stopPropagation(); ChurchApp.toggleAttendance('${esc(m.id)}')">
                            <span class="attendance-toggle-knob"></span>
                        </button>
                    </td>
                    <td>${rec.id && this.canManageMinistryItems() ? `<button type="button" class="action-btn-sm action-btn-danger" onclick="event.stopPropagation(); ChurchApp.removeAttendance('${esc(m.id)}', '${esc(serviceDate)}')" aria-label="Remove ${esc(name)}'s attendance record">Remove</button>` : ''}</td>
                </tr>`;
            }).join('') || `<tr><td colspan="6" class="muted-italic" style="text-align:center; padding:24px;">${
                filter ? 'Nobody on this register matches that search.' : 'No members in this scope.'
            }</td></tr>`;
        }

        // Search and bulk controls. Re-bound each render because the panel's
        // markup is static but its handlers depend on the current scope.
        const search = document.getElementById('attendance-search');
        if (search) {
            search.value = this.session.attendanceFilter || '';
            search.oninput = (e) => {
                this.session.attendanceFilter = e.target.value;
                this.renderAttendance();
            };
        }
        const allPresent = document.getElementById('attendance-all-present');
        if (allPresent) allPresent.onclick = () => this.setAllAttendance(visible, true);
        const allAbsent = document.getElementById('attendance-all-absent');
        if (allAbsent) allAbsent.onclick = () => this.setAllAttendance(visible, false);

        // Trend + summary
        this.renderAttendanceChart(attendance, serviceDates);
        this.renderAttendanceSummary(members, attendance);
        this.renderArrivalSummary(members, serviceDate);
    },

    renderAttendanceHeadcounts(branchId) {
        const campusSelect = document.getElementById('attendance-headcount-branch');
        const dateInput = document.getElementById('attendance-headcount-date');
        const form = document.getElementById('attendance-headcount-form');
        const canEdit = this.isAdmin();
        if (form) form.hidden = !canEdit;
        if (campusSelect) {
            const isGlobal = branchId === 'all' || branchId === 'global';
            const selectedBranch = isGlobal ? '' : branchId;
            campusSelect.innerHTML = `${isGlobal ? '<option value="">Select campus</option>' : ''}${this.db.branches.map((branch) =>
                `<option value="${esc(branch.id)}"${branch.id === selectedBranch ? ' selected' : ''}>${esc(branch.name)}</option>`
            ).join('')}`;
            campusSelect.disabled = this.session.currentRole !== 'hq_admin';
        }
        if (dateInput && !dateInput.value) {
            const today = new Date();
            dateInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        }

        const inScope = (record) => !branchId || branchId === 'all' || branchId === 'global' || record.branchId === branchId;
        const records = (this.db.attendanceHeadcounts || []).filter(inScope)
            .sort((a, b) => b.date.localeCompare(a.date) || a.branchName.localeCompare(b.branchName));
        const tbody = document.getElementById('attendance-headcounts-tbody');
        if (tbody) {
            tbody.innerHTML = records.map((record) => `<tr>
                <td>${esc(record.date)}</td>
                <td><span class="branch-pill badge-${esc(record.branchId)}">${esc(record.branchName)}</span></td>
                <td class="num attendance-recorded-count">${Number(record.totalPresent).toLocaleString()}</td>
                <td>${canEdit ? `<button type="button" class="action-btn-sm action-btn-danger" onclick="ChurchApp.removeAttendanceHeadcount('${esc(record.id)}')" aria-label="Remove attendance total for ${esc(record.date)} at ${esc(record.branchName)}">Remove</button>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="attendance-empty-state">No attendance totals recorded yet.</td></tr>';
        }
    },

    async removeAttendance(memberId, date) {
        if (!this.canManageMinistryItems()) {
            this.toast('You do not have permission to remove attendance records.', 'error');
            return;
        }
        const member = this.db.members.find((item) => item.id === memberId);
        const name = member ? `${member.firstName} ${member.lastName}` : 'This member';
        const confirmed = await this.confirmAction({
            title: `Remove ${name}'s attendance record?`,
            body: `The check-in record for ${this.formatServiceLabel(date)} will be permanently removed.`,
            confirmLabel: 'Remove attendance',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.removeAttendance(memberId, date);
            this.db.attendance = (this.db.attendance || []).filter((record) => record.memberId !== memberId || record.date !== date);
            this.saveDB();
            this.renderAttendance();
            this.toast(`${name}'s attendance record was removed.`);
        } catch (error) {
            console.error('Attendance record removal failed:', error);
            this.toast(`Could not remove the attendance record: ${error.message}`, 'error');
        }
    },

    async removeAttendanceHeadcount(id) {
        if (!this.isAdmin()) {
            this.toast('Only an administrator can remove attendance totals.', 'error');
            return;
        }
        const record = (this.db.attendanceHeadcounts || []).find((item) => item.id === id);
        if (!record) return;
        const confirmed = await this.confirmAction({
            title: `Remove attendance total for ${record.date}?`,
            body: `The total of ${Number(record.totalPresent).toLocaleString()} at ${record.branchName} will be permanently removed.`,
            confirmLabel: 'Remove total',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.removeAttendanceHeadcount(id);
            this.db.attendanceHeadcounts = this.db.attendanceHeadcounts.filter((item) => item.id !== id);
            this.saveDB();
            this.renderAttendanceHeadcounts(this.session.currentBranch);
            this.toast('Attendance total removed.');
        } catch (error) {
            console.error('Attendance total removal failed:', error);
            this.toast(`Could not remove the attendance total: ${error.message}`, 'error');
        }
    },

    async handleSaveAttendanceHeadcount() {
        if (!this.isAdmin()) {
            this.toast('Only an administrator can record the service headcount.', 'error');
            return;
        }
        const form = document.getElementById('attendance-headcount-form');
        const submitButton = form.querySelector('[type="submit"]');
        const date = document.getElementById('attendance-headcount-date').value;
        const branchId = document.getElementById('attendance-headcount-branch').value;
        const totalPresent = Number(document.getElementById('attendance-headcount-total').value);
        const branch = this.db.branches.find((item) => item.id === branchId);
        if (!date || !branch || !Number.isSafeInteger(totalPresent) || totalPresent < 0 || totalPresent > 1000000) {
            this.toast('Choose a service date and campus, then enter a whole-number headcount from 0 to 1,000,000.', 'error');
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Saving…';
        try {
            const details = { date, branchId, totalPresent };
            const saved = this.apiEnabled()
                ? await Church2API.setAttendanceHeadcount(details)
                : { id: `ah_${branchId}_${date}`, ...details, branchName: branch.name };
            this.db.attendanceHeadcounts = this.db.attendanceHeadcounts || [];
            const existingIndex = this.db.attendanceHeadcounts.findIndex((record) => record.branchId === saved.branchId && record.date === saved.date);
            if (existingIndex >= 0) this.db.attendanceHeadcounts.splice(existingIndex, 1, saved);
            else this.db.attendanceHeadcounts.push(saved);
            this.saveDB();
            document.getElementById('attendance-headcount-total').value = '';
            this.renderAttendanceHeadcounts(this.session.currentBranch);
            this.toast(`Attendance total saved: ${saved.totalPresent.toLocaleString()} present at ${saved.branchName}.`);
        } catch (error) {
            console.error('Attendance headcount save failed:', error);
            this.toast(`Could not save the attendance total: ${error.message}`, 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Save attendance total';
        }
    },

    // How the congregation travelled to the selected service. Useful for
    // planning parking, boda bays and walking-distance outreach.
    renderArrivalSummary(members, serviceDate) {
        const el = document.getElementById('attendance-arrival');
        if (!el) return;
        const records = (this.db.attendance || []).filter(
            (a) => a.date === serviceDate && a.present && members.some((m) => m.id === a.memberId)
        );
        if (!records.length) {
            el.innerHTML = '<h4>How they arrived</h4><p class="muted-italic" style="font-size:0.78rem;">Nobody checked in yet for this service.</p>';
            return;
        }
        const counts = {};
        this.ARRIVAL_MODES.forEach((m) => { counts[m] = 0; });
        let unrecorded = 0;
        records.forEach((r) => {
            if (r.arrivalMode && counts[r.arrivalMode] !== undefined) counts[r.arrivalMode] += 1;
            else unrecorded += 1;
        });
        const max = Math.max(1, ...Object.values(counts), unrecorded);
        const row = (label, n) => `<div class="arrival-row">
            <span class="arrival-label">${esc(label)}</span>
            <span class="arrival-bar"><span style="width:${Math.round((n / max) * 100)}%"></span></span>
            <span class="arrival-count">${n}</span>
        </div>`;
        el.innerHTML = '<h4>How they arrived</h4>'
            + this.ARRIVAL_MODES.map((m) => row(m, counts[m])).join('')
            + (unrecorded ? row('Not recorded', unrecorded) : '');
    },

    // Mark everyone currently listed. Operates on the filtered view, so a
    // search for "Ushering" followed by "Mark all present" checks in the ushers
    // and nobody else.
    setAllAttendance(members, present) {
        const serviceDate = this.session.selectedServiceDate;
        if (!serviceDate || !members.length) return;
        this.db.attendance = this.db.attendance || [];
        members.forEach((m) => {
            const rec = this.db.attendance.find((a) => a.memberId === m.id && a.date === serviceDate);
            if (rec) {
                rec.present = present;
                if (!present) rec.arrivalMode = '';
            } else {
                this.db.attendance.push({
                    id: `att_${m.id}_${serviceDate}`, memberId: m.id, branchId: m.branchId,
                    date: serviceDate, present: true, arrivalMode: '',
                });
            }
            this.apiWrite(() => Church2API.setAttendance({ memberId: m.id, date: serviceDate, present }));
        });
        this.saveDB();
        this.toast(`${members.length} ${members.length === 1 ? 'person' : 'people'} marked ${present ? 'present' : 'absent'}.`);
        this.renderAttendance();
    },

    // Record how somebody travelled. Only meaningful for someone present, which
    // is why the control is disabled until they are checked in.
    setArrivalMode(memberId, mode) {
        const serviceDate = this.session.selectedServiceDate;
        if (!serviceDate) return;
        const rec = (this.db.attendance || []).find((a) => a.memberId === memberId && a.date === serviceDate);
        if (!rec || !rec.present) return;
        rec.arrivalMode = mode;
        this.saveDB();
        this.apiWrite(() => Church2API.setAttendance({
            memberId, date: serviceDate, present: true, arrivalMode: mode,
        }));
        this.renderArrivalSummary(
            this.db.members.filter((m) => {
                const b = this.session.currentBranch;
                return !b || b === 'global' || m.branchId === b;
            }),
            serviceDate
        );
    },

    formatServiceLabel(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    },

    toggleAttendance(memberId) {
        const serviceDate = this.session.selectedServiceDate;
        if (!serviceDate) return;
        this.db.attendance = this.db.attendance || [];
        let rec = this.db.attendance.find(a => a.memberId === memberId && a.date === serviceDate);
        const member = this.db.members.find(m => m.id === memberId);
        if (rec) {
            rec.present = !rec.present;
            // A travel note on someone marked absent is stale data, not history.
            if (!rec.present) rec.arrivalMode = '';
        } else if (member) {
            this.db.attendance.push({ id: `att_${memberId}_${serviceDate}`, memberId, branchId: member.branchId, date: serviceDate, present: true, arrivalMode: '' });
        }
        this.saveDB();
        this.apiWrite(() => Church2API.setAttendance({ memberId, date: serviceDate, present: rec ? rec.present : true }));
        this.renderAttendance();
    },

    renderAttendanceChart(attendance, serviceDatesDesc) {
        const wrap = document.getElementById('attendance-trend-chart')?.parentElement;
        if (typeof Chart === 'undefined') {
            if (wrap && !wrap.querySelector('.chart-fallback')) {
                const n = document.createElement('div');
                n.className = 'chart-fallback';
                n.textContent = 'Attendance chart is unavailable offline.';
                wrap.appendChild(n);
            }
            return;
        }
        const ctx = document.getElementById('attendance-trend-chart')?.getContext('2d');
        if (!ctx) return;
        if (this.charts.attendance) this.charts.attendance.destroy();

        const dates = [...serviceDatesDesc].sort(); // ascending
        const counts = dates.map(d => attendance.filter(a => a.date === d && a.present).length);
        const labels = dates.map(d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

        const cta = this.chartTheme();
        this.charts.attendance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Present',
                    data: counts,
                    backgroundColor: 'rgba(16, 185, 129, 0.55)',
                    borderColor: '#10b981',
                    borderWidth: 1.5,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { color: cta.tick, precision: 0 }, grid: { color: cta.grid } },
                    x: { ticks: { color: cta.tick }, grid: { display: false } }
                }
            }
        });
    },

    renderAttendanceSummary(members, attendance) {
        const el = document.getElementById('attendance-summary');
        if (!el) return;
        // At-risk = 3+ consecutive most-recent absences
        const byMember = {};
        attendance.forEach(a => (byMember[a.memberId] = byMember[a.memberId] || []).push(a));
        const atRisk = members.filter(m => {
            const recs = (byMember[m.id] || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
            let streak = 0;
            for (const r of recs) { if (!r.present) streak++; else break; }
            return streak >= 3;
        });
        el.innerHTML = `
            <div class="attendance-summary-row">
                <span><svg class="inline-ico warn-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17.2v.1"/></svg> At-risk (3+ absences)</span>
                <strong>${atRisk.length}</strong>
            </div>
            ${atRisk.length ? `<ul class="at-risk-list" style="margin-top:8px;">
                ${atRisk.slice(0, 5).map(m => `<li>${esc(m.firstName)} ${esc(m.lastName)}</li>`).join('')}
            </ul>` : '<p class="muted-italic" style="margin-top:8px;">No members in an absence streak — healthy engagement. 🎉</p>'}`;
    },

    // Panel: Follow-Ups / Assimilation Pipeline (kanban)
    FOLLOWUP_STAGES: ['New Guest', 'Contacted', 'Connected', 'Member'],

    renderFollowUps() {
        const branchId = this.session.currentBranch;
        const inScope = (m) => (!branchId || branchId === 'global') ? true : m.branchId === branchId;
        const search = (this.session.followUpSearch || '').trim().toLocaleLowerCase();
        const items = (this.db.followUps || []).filter(inScope).filter((item) =>
            !search || `${item.name || ''} ${item.owner || ''} ${item.note || ''}`.toLocaleLowerCase().includes(search)
        );
        const board = document.getElementById('followup-board');
        if (!board) return;

        const stageMeta = {
            'New Guest': { icon: '<circle cx="8" cy="6" r="3"/><path d="M2.5 17c.5-3.4 2.3-5.2 5.5-5.2s5 1.8 5.5 5.2M15 5v6M12 8h6"/>', tone: 'guest' },
            'Contacted': { icon: '<path d="M5 2.8h3l1.5 4-2 1.5a13 13 0 0 0 4.2 4.2l1.5-2 4 1.5v3c0 1-.8 1.8-1.8 1.8A13.8 13.8 0 0 1 3.2 4.6C3.2 3.6 4 2.8 5 2.8Z"/>', tone: 'contacted' },
            'Connected': { icon: '<circle cx="6" cy="10" r="3"/><circle cx="14" cy="6" r="3"/><circle cx="14" cy="14" r="3"/><path d="m8.5 8.5 3-1.5m-3 4.5 3 1.5"/>', tone: 'connected' },
            'Member': { icon: '<path d="m10 2.5 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.7 5.2-.8z"/>', tone: 'member' }
        };

        board.innerHTML = this.FOLLOWUP_STAGES.map((stage, sIdx) => {
            const inStage = items.filter(i => i.stage === stage);
            const cards = inStage.map(i => {
                const canBack = sIdx > 0;
                const canFwd = sIdx < this.FOLLOWUP_STAGES.length - 1;
                const campus = this.db.branches.find(b => b.id === i.branchId);
                const actions = `${canBack ? `<button type="button" class="followup-move followup-move-back" aria-label="Move ${esc(i.name)} back to ${esc(this.FOLLOWUP_STAGES[sIdx - 1])}" onclick="ChurchApp.moveFollowUp('${esc(i.id)}', -1)">
                            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10H4m0 0 5-5m-5 5 5 5"/></svg>
                        </button>` : ''}
                        ${canFwd ? `<button type="button" class="followup-move fwd" aria-label="Move ${esc(i.name)} to ${esc(this.FOLLOWUP_STAGES[sIdx + 1])}" onclick="ChurchApp.moveFollowUp('${esc(i.id)}', 1)">
                            <span>Move to ${esc(this.FOLLOWUP_STAGES[sIdx + 1])}</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m0 0-5-5m5 5-5 5"/></svg>
                        </button>` : '<span class="followup-complete">Membership reached</span>'}
                        ${this.canManageMinistryItems() ? `<button type="button" class="followup-remove" aria-label="Remove ${esc(i.name)} from follow-ups" onclick="ChurchApp.removeFollowUp('${esc(i.id)}')">
                            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12m-10 0 .7 11h4.6L12 5M8 5V3h4v2m-3 3v5m2-5v5"/></svg>
                        </button>` : ''}`;
                return `<div class="followup-card">
                    <div class="followup-card-top">
                        <strong>${esc(i.name)}</strong>
                        ${branchId === 'global' && campus ? `<span class="branch-pill badge-${esc(i.branchId)}">${esc(campus.name)}</span>` : ''}
                    </div>
                    ${i.owner ? `<div class="followup-owner"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="6" r="3"/><path d="M2.5 17c.5-3.4 2.3-5.2 5.5-5.2s5 1.8 5.5 5.2"/></svg><span>${esc(i.owner)}</span></div>` : ''}
                    ${i.note ? `<p class="followup-note">${esc(i.note)}</p>` : ''}
                    <div class="followup-actions">${actions}</div>
                </div>`;
            }).join('') || `<p class="followup-empty">${search
                ? 'No matching people in this stage.'
                : stage === 'New Guest' && items.length === 0
                    ? 'No guest follow-ups yet. Add the first one above.'
                    : `No people in ${esc(stage.toLowerCase())} yet.`}</p>`;

            return `<div class="followup-col tone-${stageMeta[stage].tone}">
                <div class="followup-col-head">
                    <h4><svg viewBox="0 0 20 20" aria-hidden="true">${stageMeta[stage].icon}</svg>${esc(stage)}</h4>
                    <span class="followup-count" aria-label="${inStage.length} ${inStage.length === 1 ? 'person' : 'people'}">${inStage.length}</span>
                </div>
                <div class="followup-col-body">${cards}</div>
            </div>`;
        }).join('');

        const campusSelect = document.getElementById('followup-branch');
        const addForm = document.getElementById('add-followup-form');
        const isHq = this.session.currentRole === 'hq_admin';
        if (campusSelect) {
            const selectedBranch = branchId === 'global' ? '' : branchId;
            campusSelect.innerHTML = `${branchId === 'global' ? '<option value="">Choose a campus</option>' : ''}${this.db.branches.map((branch) =>
                `<option value="${esc(branch.id)}"${branch.id === selectedBranch ? ' selected' : ''}>${esc(branch.name)}</option>`
            ).join('')}`;
            campusSelect.disabled = !isHq;
        }
        if (addForm) addForm.hidden = this.session.currentRole === 'member';

        const searchInput = document.getElementById('followup-search');
        if (searchInput) {
            searchInput.value = this.session.followUpSearch || '';
            searchInput.oninput = (event) => {
                this.session.followUpSearch = event.target.value;
                const cursor = event.target.selectionStart;
                this.renderFollowUps();
                const refreshedSearch = document.getElementById('followup-search');
                refreshedSearch?.focus();
                refreshedSearch?.setSelectionRange(cursor, cursor);
            };
        }
        const results = document.getElementById('followup-results-count');
        if (results) {
            const total = (this.db.followUps || []).filter(inScope).length;
            results.textContent = search
                ? `${items.length} of ${total} follow-ups`
                : `${total} ${total === 1 ? 'follow-up' : 'follow-ups'}`;
        }

        const form = document.getElementById('add-followup-form');
        if (form) {
            form.onsubmit = (e) => {
                e.preventDefault();
                const name = document.getElementById('followup-name').value.trim();
                const owner = document.getElementById('followup-owner').value.trim();
                if (!name) return;
                const targetBranch = isHq ? campusSelect.value : branchId;
                if (!targetBranch) {
                    this.toast('Choose a campus before adding the follow-up.', 'error');
                    campusSelect.focus();
                    return;
                }
                const item = {
                    id: `fu_${Date.now()}`,
                    name, owner: owner || 'Unassigned',
                    branchId: targetBranch,
                    stage: 'New Guest',
                    note: ''
                };
                this.db.followUps.unshift(item);
                this.saveDB();
                this.apiWrite(() => Church2API.createFollowup({ name, owner: item.owner, branchId: targetBranch }), (srv) => { if (srv && srv.id) item.id = srv.id; });
                form.reset();
                this.session.followUpSearch = '';
                this.renderFollowUps();
                this.toast(`${name} added to the assimilation pipeline.`);
            };
        }
    },

    moveFollowUp(id, dir) {
        const item = (this.db.followUps || []).find(i => i.id === id);
        if (!item) return;
        const idx = this.FOLLOWUP_STAGES.indexOf(item.stage);
        const next = idx + dir;
        if (next < 0 || next >= this.FOLLOWUP_STAGES.length) return;
        item.stage = this.FOLLOWUP_STAGES[next];
        this.saveDB();
        this.apiWrite(() => Church2API.moveFollowup(item.id, item.stage));
        this.renderFollowUps();
        if (item.stage === 'Member') this.toast(`🎉 ${item.name} is now a committed member!`);
    },

    async removeFollowUp(id) {
        if (!this.canManageMinistryItems()) {
            this.toast('You do not have permission to remove guest follow-ups.', 'error');
            return;
        }
        const item = (this.db.followUps || []).find((followUp) => followUp.id === id);
        if (!item) return;
        const confirmed = await this.confirmAction({
            title: `Remove ${item.name}?`,
            body: 'This guest follow-up and its place in the pipeline will be permanently removed.',
            confirmLabel: 'Remove follow-up',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.removeFollowup(id);
            this.db.followUps = this.db.followUps.filter((followUp) => followUp.id !== id);
            this.saveDB();
            this.renderFollowUps();
            this.toast(`${item.name} removed from follow-ups.`);
        } catch (error) {
            console.error('Follow-up removal failed:', error);
            this.toast(`Could not remove ${item.name}: ${error.message}`, 'error');
        }
    },

    // Panel: Small Groups (admin)
    renderGroups() {
        const branchId = this.session.currentBranch;
        const inScope = (g) => (!branchId || branchId === 'global') ? true : g.branchId === branchId;
        const groups = (this.db.groups || []).filter(inScope);
        const grid = document.getElementById('groups-grid');
        if (grid) {
            grid.innerHTML = groups.map(g => {
                const campus = (this.db.branches.find(b => b.id === g.branchId) || {}).name || '';
                const count = (g.memberIds || []).length;
                const roster = (g.memberIds || []).map(id => {
                    const m = this.db.members.find(mm => mm.id === id);
                    return m ? `<span class="group-member-pill">${esc(m.firstName)} ${esc(m.lastName)}${this.canManageMinistryItems() ? ` <button type="button" class="remove-vol-btn" aria-label="Remove ${esc(m.firstName)} ${esc(m.lastName)} from ${esc(g.name)}" onclick="ChurchApp.removeGroupMember('${esc(g.id)}', '${esc(m.id)}')">×</button>` : ''}</span>` : null;
                }).filter(Boolean);
                return `<div class="group-card">
                    <div class="group-card-head">
                        <h4>${esc(g.name)}</h4>
                        <div class="group-card-controls">
                            <span class="group-count"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.2" cy="9" r="3"/><circle cx="16.6" cy="10" r="2.3"/><path d="M2.6 19c0-3 2.4-4.9 5.6-4.9 1.6 0 3 .5 4 1.3"/><path d="M14.6 14.7c2.6.2 4.8 1.9 4.8 4.6"/></svg> ${count}</span>
                            ${this.canManageMinistryItems() ? `<button type="button" class="action-btn-sm action-btn-danger" onclick="ChurchApp.removeGroup('${esc(g.id)}')" aria-label="Remove ${esc(g.name)} group">Remove</button>` : ''}
                        </div>
                    </div>
                    <div class="group-meta">
                        <span class="branch-pill badge-${esc(g.branchId)}">${esc(campus)}</span>
                        <span class="group-schedule"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.4"/><path d="M3.5 9.5h17M8 3.4v3.2M16 3.4v3.2"/></svg> ${esc(g.schedule || 'TBD')}</span>
                    </div>
                    ${g.description ? `<p class="group-desc">${esc(g.description)}</p>` : ''}
                    <div class="group-roster">${roster.length ? roster.join('') : '<span class="muted-italic">No members yet</span>'}</div>
                </div>`;
            }).join('') || '<p class="muted-italic" style="margin-top:12px;">No groups for this campus yet.</p>';
        }

        const form = document.getElementById('add-group-form');
        if (form) {
            form.onsubmit = (e) => {
                e.preventDefault();
                const name = document.getElementById('group-name').value.trim();
                if (!name) return;
                const group = {
                    id: `g_${Date.now()}`,
                    name,
                    branchId: document.getElementById('group-branch').value,
                    schedule: document.getElementById('group-schedule').value.trim(),
                    description: document.getElementById('group-desc').value.trim(),
                    memberIds: []
                };
                this.db.groups.unshift(group);
                this.saveDB();
                this.apiWrite(() => Church2API.createGroup({ name, branchId: group.branchId, schedule: group.schedule, description: group.description }), (srv) => { if (srv && srv.id) group.id = srv.id; });
                form.reset();
                this.renderGroups();
                this.toast(`Group "${name}" created.`);
            };
        }
    },

    async removeGroupMember(groupId, memberId) {
        if (!this.canManageMinistryItems()) {
            this.toast('You do not have permission to change group membership.', 'error');
            return;
        }
        const group = (this.db.groups || []).find((item) => item.id === groupId);
        const member = this.db.members.find((item) => item.id === memberId);
        if (!group || !member || !(group.memberIds || []).includes(memberId)) return;
        const confirmed = await this.confirmAction({
            title: `Remove ${member.firstName} ${member.lastName} from ${group.name}?`,
            body: 'The member profile will remain in the directory; only this group assignment will be removed.',
            confirmLabel: 'Remove from group',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.removeGroupMember(groupId, memberId);
            group.memberIds = group.memberIds.filter((id) => id !== memberId);
            this.saveDB();
            this.renderGroups();
            this.toast(`${member.firstName} was removed from ${group.name}.`);
        } catch (error) {
            console.error('Group membership removal failed:', error);
            this.toast(`Could not remove ${member.firstName} from ${group.name}: ${error.message}`, 'error');
        }
    },

    // 8. Panel: Member Directory View Rendering
    renderMemberDirectory() {
        this.renderMemberGroupOptions();
        const query = document.getElementById('member-search-input').value.toLowerCase();
        const branchFilter = document.getElementById('member-branch-filter').value;
        const tbody = document.getElementById('member-directory-tbody');
        tbody.innerHTML = '';

        // Respect the active campus scope: a campus-locked admin can only ever see
        // their own members, regardless of the in-panel filter.
        const scope = this.session.currentBranch;
        const scoped = (scope && scope !== 'global') ? scope : null;

        const filteredMembers = this.db.members.filter(member => {
            if (scoped && member.branchId !== scoped) return false;
            const fullName = `${member.firstName} ${member.lastName}`.toLowerCase();
            const matchesQuery = fullName.includes(query) || member.email.toLowerCase().includes(query) || member.phone.includes(query);
            const matchesBranch = (branchFilter === 'all') || (member.branchId === branchFilter);
            return matchesQuery && matchesBranch;
        });

        filteredMembers.forEach(m => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div class="member-profile-cell">
                        <div class="member-avatar">${esc((m.firstName[0] || '') + (m.lastName[0] || ''))}</div>
                        <div>
                            <span class="member-name">${esc(m.firstName)} ${esc(m.lastName)}</span>
                            <span class="member-id">ID: ${esc(m.id)}</span>
                        </div>
                    </div>
                </td>
                <td><span class="branch-pill badge-${esc(m.branchId)}">${esc(m.branchName)}</span></td>
                <td>
                    <div class="member-email">${esc(m.email)}</div>
                    <div class="member-phone">${esc(m.phone)}</div>
                </td>
                <td>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        ${(m.volunteer_skills || []).map(s => `<span class="skill-tag">${esc(s)}</span>`).join('') || '<span class="muted-italic">—</span>'}
                    </div>
                </td>
                <td>
                    <div class="score-indicator-bar">
                        <div class="score-progress" style="width: ${m.engagement_score}%; background: ${m.engagement_score > 75 ? '#10b981' : (m.engagement_score > 50 ? '#f59e0b' : '#ef4444')};"></div>
                        <span class="score-text">${m.engagement_score}%</span>
                    </div>
                </td>
                <td>
                    <button class="action-btn-sm" onclick="ChurchApp.viewMemberDetails('${m.id}')">View Profile</button>
                    ${this.isAdmin() ? `<button class="action-btn-sm action-btn-danger"
                        onclick="ChurchApp.removeMember('${esc(m.id)}')"
                        aria-label="Remove ${esc(m.firstName)} ${esc(m.lastName)} from the roll">Remove</button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (filteredMembers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 30px;">No members found matching the criteria.</td></tr>`;
        }
    },

    renderMemberGroupOptions() {
        const container = document.getElementById('member-group-options');
        const branchSelect = document.getElementById('member-branch-select');
        if (!container || !branchSelect) return;
        const branchId = branchSelect.value;
        const groups = (this.db.groups || []).filter((group) => group.branchId === branchId);
        container.innerHTML = groups.length
            ? groups.map((group) => `<label class="member-group-option">
                <input type="checkbox" name="member-groups" value="${esc(group.id)}">
                <span>${esc(group.name)}</span>
            </label>`).join('')
            : '<p class="member-group-empty">No groups exist at this campus yet.</p>';
    },

    resetMemberImport() {
        this.memberImportState = null;
        const fileInput = document.getElementById('member-csv-file');
        const review = document.getElementById('member-import-review');
        const submit = document.getElementById('member-import-submit');
        if (fileInput) fileInput.value = '';
        if (fileInput) fileInput.disabled = false;
        const cancel = document.getElementById('member-import-cancel');
        if (cancel) cancel.disabled = false;
        if (review) review.hidden = true;
        if (submit) {
            submit.disabled = true;
            submit.textContent = 'Import valid members';
        }
    },

    downloadMemberCsvTemplate() {
        const csv = [
            'first_name,last_name,email,phone,volunteer_skills,groups,marital_status,background,expectations',
        ].join('\r\n');
        const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'church-members-template.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    async handleMemberCsvSelected(file) {
        this.resetMemberImport();
        if (!file) return;
        const review = document.getElementById('member-import-review');
        const summary = document.getElementById('member-import-summary');
        review.hidden = false;
        if (!this.isAdmin()) {
            summary.textContent = 'Only an administrator can import members.';
            return;
        }
        if (!file.name.toLowerCase().endsWith('.csv') || file.size > 5 * 1024 * 1024) {
            summary.textContent = file.size > 5 * 1024 * 1024
                ? 'This file is larger than 5 MB. Split it into smaller CSV files and try again.'
                : 'Choose a .csv file to import.';
            return;
        }

        try {
            const records = parseCsvRecords((await file.text()).replace(/^\uFEFF/, ''));
            if (records.length < 2) throw new Error('The CSV must include a header and at least one member row.');
            if (records.length - 1 > 500) throw new Error('This file contains more than 500 member rows. Split it into smaller CSV files.');

            const normalizeHeader = (header) => header.toLowerCase().replace(/[^a-z0-9]/g, '');
            const aliases = {
                firstName: ['firstname', 'givenname', 'forename'],
                lastName: ['lastname', 'surname', 'familyname'],
                fullName: ['fullname', 'name'],
                email: ['email', 'emailaddress'],
                phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'mobilephone'],
                volunteer_skills: ['volunteerskills', 'volunteeringskills', 'skills'],
                groups: ['groups', 'group', 'groupnames', 'campusgroups'],
                maritalStatus: ['maritalstatus'],
                background: ['background', 'beforejoining'],
                expectations: ['expectations'],
            };
            const headers = records[0].map(normalizeHeader);
            const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [
                key,
                headers.findIndex((header) => names.includes(header)),
            ]));
            if ((columns.firstName < 0 || columns.lastName < 0) && columns.fullName < 0) {
                throw new Error('Add first_name and last_name columns, or a single full_name column.');
            }

            const selectedBranch = document.getElementById('member-branch-select').value;
            const existingEmails = new Set(this.db.members
                .filter((member) => member.branchId === selectedBranch && member.email)
                .map((member) => member.email.trim().toLowerCase()));
            const seenEmails = new Set();
            const rows = records.slice(1).map((record, index) => {
                const cell = (column) => column >= 0 ? String(record[column] || '').trim() : '';
                let firstName = cell(columns.firstName);
                let lastName = cell(columns.lastName);
                if ((!firstName || !lastName) && columns.fullName >= 0) {
                    const nameParts = cell(columns.fullName).split(/\s+/).filter(Boolean);
                    firstName = firstName || nameParts.shift() || '';
                    lastName = lastName || nameParts.join(' ');
                }
                const email = cell(columns.email);
                const phone = cell(columns.phone);
                const skillsText = cell(columns.volunteer_skills);
                const groupNames = cell(columns.groups).split(/[;|]/).map((name) => name.trim()).filter(Boolean);
                const campusGroups = this.db.groups.filter((group) => group.branchId === selectedBranch);
                const groupIds = [];
                let groupError = '';
                groupNames.forEach((name) => {
                    const matches = campusGroups.filter((group) => group.name.trim().toLowerCase() === name.toLowerCase());
                    if (matches.length !== 1) {
                        groupError = matches.length
                            ? `More than one campus group is named "${name}"`
                            : `Campus group "${name}" was not found`;
                    } else if (!groupIds.includes(matches[0].id)) {
                        groupIds.push(matches[0].id);
                    }
                });
                const member = {
                    rowNumber: index + 2,
                    firstName,
                    lastName,
                    email,
                    phone,
                    volunteer_skills: skillsText ? skillsText.split(/[;|]/).map((skill) => skill.trim()).filter(Boolean) : [],
                    groupNames,
                    groupIds,
                    maritalStatus: cell(columns.maritalStatus),
                    background: cell(columns.background),
                    expectations: cell(columns.expectations),
                };
                const extraCells = record.slice(records[0].length).some((value) => value.trim());
                let error = '';
                if (extraCells) error = 'This row has values without matching column headers';
                else if (!firstName || !lastName) error = 'First and last name are required';
                else if (firstName.length > 100 || lastName.length > 100) error = 'Names must be 100 characters or fewer';
                else if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) error = 'Enter a valid email address';
                else if (phone.length > 40) error = 'Phone number must be 40 characters or fewer';
                else if (member.volunteer_skills.length > 30 || member.volunteer_skills.some((skill) => skill.length > 80)) error = 'Each row may contain up to 30 skills of 80 characters or fewer';
                else if (member.maritalStatus.length > 80 || member.background.length > 5000 || member.expectations.length > 5000) error = 'A member detail exceeds its allowed length';
                else if (groupError) error = groupError;
                else if (email && existingEmails.has(email.toLowerCase())) error = 'This email already belongs to a member at the selected campus';
                else if (email && seenEmails.has(email.toLowerCase())) error = 'This email appears more than once in the CSV';
                if (email && !error) seenEmails.add(email.toLowerCase());
                return { ...member, error };
            });

            this.memberImportState = { fileName: file.name, branchId: selectedBranch, rows, running: false, imported: false };
            this.renderMemberImportPreview();
        } catch (error) {
            console.error('Member CSV preview failed:', error);
            summary.textContent = error.message || 'Could not read this CSV file.';
        }
    },

    renderMemberImportPreview() {
        const state = this.memberImportState;
        if (!state) return;
        const review = document.getElementById('member-import-review');
        const summary = document.getElementById('member-import-summary');
        const preview = document.getElementById('member-import-preview');
        const submit = document.getElementById('member-import-submit');
        const fileInput = document.getElementById('member-csv-file');
        const cancel = document.getElementById('member-import-cancel');
        const validRows = state.rows.filter((row) => !row.error);
        const errorCount = state.rows.length - validRows.length;
        summary.textContent = state.imported
            ? `Imported ${state.importedCount} member${state.importedCount === 1 ? '' : 's'} from ${state.fileName}. ${errorCount} row${errorCount === 1 ? '' : 's'} skipped.`
            : `${state.fileName}: ${validRows.length} ready to import, ${errorCount} need attention. Duplicate emails at this campus are skipped.`;
        preview.innerHTML = state.rows.map((row) => `
            <tr>
                <td>${row.rowNumber}</td>
                <td>${esc(`${row.firstName} ${row.lastName}`.trim() || '—')}</td>
                <td>${esc(row.email || '—')}</td>
                <td>${esc(row.phone || '—')}</td>
                <td>${esc(row.groupNames.join(', ') || '—')}</td>
                <td class="${row.error ? 'member-import-row-error' : 'member-import-row-ready'}">${esc(row.error || (state.imported ? 'Imported' : 'Ready'))}</td>
            </tr>`).join('');
        review.hidden = false;
        fileInput.disabled = state.running;
        cancel.disabled = state.running;
        submit.disabled = state.running || state.imported || validRows.length === 0
            || !state.branchId || state.branchId !== document.getElementById('member-branch-select').value;
        submit.textContent = state.running ? 'Importing…' : 'Import valid members';
    },

    async importMembersFromCsv() {
        const state = this.memberImportState;
        if (!state || state.running || state.imported) return;
        if (!this.isAdmin()) {
            this.toast('Only an administrator can import members.', 'error');
            return;
        }
        if (state.branchId !== document.getElementById('member-branch-select').value) {
            this.toast('The selected campus changed. Choose the CSV again to review it for that campus.', 'error');
            return;
        }
        const validRows = state.rows.filter((row) => !row.error);
        if (!validRows.length) return;
        state.running = true;
        this.renderMemberImportPreview();
        try {
            let importedMembers;
            let serverErrors = [];
            if (this.apiEnabled()) {
                const result = await Church2API.importMembers({
                    branchId: state.branchId,
                    members: validRows.map(({ error, ...member }) => member),
                });
                importedMembers = result.members || [];
                serverErrors = result.errors || [];
            } else {
                const branch = this.db.branches.find((item) => item.id === state.branchId);
                importedMembers = validRows.map((member, index) => ({
                    id: `m_import_${Date.now()}_${index}`,
                    importRowNumber: member.rowNumber,
                    branchId: state.branchId,
                    branchName: branch?.name || '',
                    firstName: member.firstName,
                    lastName: member.lastName,
                    email: member.email,
                    phone: member.phone,
                    volunteer_skills: member.volunteer_skills,
                    maritalStatus: member.maritalStatus,
                    background: member.background,
                    expectations: member.expectations,
                    engagement_score: 60,
                }));
            }
            const serverErrorByRow = new Map(serverErrors.map((item) => [item.row, item.message]));
            state.rows.forEach((row) => {
                if (!row.error && serverErrorByRow.has(row.rowNumber)) row.error = serverErrorByRow.get(row.rowNumber);
            });
            importedMembers.forEach((imported) => {
                const { importRowNumber, ...member } = imported;
                const sourceRow = state.rows.find((row) => row.rowNumber === importRowNumber);
                this.db.members.push(member);
                (sourceRow?.groupIds || []).forEach((groupId) => {
                    const group = this.db.groups.find((item) => item.id === groupId);
                    if (group) {
                        group.memberIds = group.memberIds || [];
                        if (!group.memberIds.includes(member.id)) group.memberIds.push(member.id);
                    }
                });
            });
            this.saveDB();
            state.running = false;
            state.imported = true;
            state.importedCount = importedMembers.length;
            this.renderMemberImportPreview();
            this.renderMemberDirectory();
            this.toast(`${importedMembers.length} member${importedMembers.length === 1 ? '' : 's'} imported${serverErrors.length ? `; ${serverErrors.length} row${serverErrors.length === 1 ? '' : 's'} skipped` : ''}.`);
        } catch (error) {
            console.error('Member CSV import failed:', error);
            state.running = false;
            this.renderMemberImportPreview();
            this.toast(`Could not import members: ${error.message}`, 'error');
        }
    },

    async removeGroup(groupId) {
        if (!this.canManageMinistryItems()) {
            this.toast('You do not have permission to remove groups.', 'error');
            return;
        }
        const group = (this.db.groups || []).find((item) => item.id === groupId);
        if (!group) return;
        const confirmed = await this.confirmAction({
            title: `Remove ${group.name}?`,
            body: 'The group will be deleted and its member assignments cleared. Member profiles will remain.',
            confirmLabel: 'Remove group',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.removeGroup(groupId);
            this.db.groups = this.db.groups.filter((item) => item.id !== groupId);
            this.saveDB();
            this.renderGroups();
            this.renderMemberGroupOptions();
            this.toast(`${group.name} group removed.`);
        } catch (error) {
            console.error('Group removal failed:', error);
            this.toast(`Could not remove ${group.name}: ${error.message}`, 'error');
        }
    },

    // 9. Panel: Member Details Modal Manager
    viewMemberDetails(memberId) {
        const member = this.db.members.find(m => m.id === memberId);
        if (!member) return;

        this.session.selectedMemberId = memberId;
        const modal = document.getElementById('member-detail-modal');
        
        // Find family members
        const familyList = this.db.members.filter(m => m.familyId === member.familyId && m.id !== member.id);

        // Fetch giving transactions for member
        const donations = this.db.transactions.filter(t => t.memberId === memberId);

        modal.innerHTML = `
            <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="member-modal-title">
                <div class="modal-header">
                    <h3 id="member-modal-title">Member Profile: ${esc(member.firstName)} ${esc(member.lastName)}</h3>
                    <button class="modal-close" aria-label="Close member profile" onclick="ChurchApp.closeModal('member-detail-modal')">×</button>
                </div>
                <div class="modal-body scroll-y">
                    <div class="member-detail-grid">
                        <div>
                            <h4>Contact Information</h4>
                            <p><strong>Email:</strong> ${esc(member.email)}</p>
                            <p><strong>Phone:</strong> ${esc(member.phone)}</p>
                            <p><strong>Primary Branch:</strong> ${esc(member.branchName)}</p>
                            <p><strong>Engagement Rating:</strong> ${esc(member.engagement_score)}%</p>
                        </div>
                        <div>
                            <h4>Family Connections</h4>
                            <p><strong>Family Unit ID:</strong> ${esc(member.familyId || 'None Linked')}</p>
                            <p><strong>Family Role:</strong> ${esc(member.familyRole || 'N/A')}</p>
                            <p><strong>Marital Status:</strong> ${esc(member.maritalStatus || 'Not stated')}</p>
                            <ul class="family-linked-list">
                                ${familyList.length > 0 ? familyList.map(f => `<li>${esc(f.firstName)} ${esc(f.lastName)} (${esc(f.familyRole)})</li>`).join('') : '<li class="muted-italic">No other family members linked.</li>'}
                            </ul>
                        </div>
                    </div>

                    <div class="profile-narrative">
                        <div>
                            <h5>Before Joining</h5>
                            ${member.background
                                ? `<p>${esc(member.background)}</p>`
                                : '<p class="empty">Not recorded at registration.</p>'}
                        </div>
                        <div>
                            <h5>Expectations</h5>
                            ${member.expectations
                                ? `<p>${esc(member.expectations)}</p>`
                                : '<p class="empty">Not recorded at registration.</p>'}
                        </div>
                    </div>

                    <div class="milestones-section">
                        <h4>Spiritual Milestones</h4>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                            ${(member.spiritualMilestones || []).length > 0 ? member.spiritualMilestones.map((milestone, index) => `<span class="milestone-pill">✨ ${esc(milestone)}${this.isAdmin() ? ` <button type="button" class="remove-vol-btn" aria-label="Remove milestone ${esc(milestone)}" onclick="ChurchApp.removeSpiritualMilestone('${esc(member.id)}', ${index})">×</button>` : ''}</span>`).join('') : '<span class="muted-italic">No spiritual milestones logged.</span>'}
                        </div>
                        ${this.isAdmin() ? `<div style="margin-top: 12px; display: flex; gap: 8px;">
                            <input type="text" id="new-milestone-input" placeholder="e.g. Confirmed: 2026-07-11" class="form-control" style="width: auto; flex-grow: 1;" aria-label="New spiritual milestone">
                            <button class="btn btn-primary-gradient" onclick="ChurchApp.addSpiritualMilestone()">Add Milestone</button>
                        </div>` : ''}
                    </div>

                    <div style="margin-top: 20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <h4>Recent Giving Ledger</h4>
                            <button class="btn btn-secondary btn-sm" onclick="ChurchApp.viewGivingStatement('${esc(member.id)}')">📄 Giving Statement</button>
                        </div>
                        <table class="financial-table" style="margin-top: 8px;">
                            <thead>
                                <tr>
                                    <th>Receipt</th>
                                    <th>Date</th>
                                    <th>Category</th>
                                    <th>Amount</th>
                                    <th>Method</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${donations.map(d => `
                                    <tr>
                                        <td><a href="#" onclick="ChurchApp.viewReceipt('${esc(d.id)}'); return false;">${esc(d.receiptNumber)}</a></td>
                                        <td>${esc(d.date)}</td>
                                        <td>${esc(d.category)}</td>
                                        <td style="color: #10b981; font-weight: bold; text-align: right;">${money(parseFloat(d.amount))}</td>
                                        <td>${esc(d.paymentMethod)}</td>
                                    </tr>
                                `).join('')}
                                ${donations.length === 0 ? '<tr><td colspan="5" style="text-align:center;" class="muted-italic">No transaction history found.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        this.openModal('member-detail-modal');
    },

    async addSpiritualMilestone() {
        if (!this.isAdmin()) {
            this.toast('Only an administrator can update spiritual milestones.', 'error');
            return;
        }
        const input = document.getElementById('new-milestone-input');
        if (!input || !input.value.trim()) return;

        const milestone = input.value.trim();
        const member = this.db.members.find(m => m.id === this.session.selectedMemberId);
        if (!member) return;
        try {
            const spiritualMilestones = [...(member.spiritualMilestones || []), milestone];
            const saved = this.apiEnabled()
                ? await Church2API.updateMemberMilestones(member.id, spiritualMilestones)
                : { spiritualMilestones };
            member.spiritualMilestones = saved.spiritualMilestones;
            member.engagement_score = Math.min((Number(member.engagement_score) || 0) + 5, 100);
            this.saveDB();
            this.viewMemberDetails(member.id);
            this.renderMemberDirectory();
            this.toast('Spiritual milestone added.');
        } catch (error) {
            console.error('Spiritual milestone save failed:', error);
            this.toast(`Could not save this milestone: ${error.message}`, 'error');
        }
    },

    async removeSpiritualMilestone(memberId, index) {
        if (!this.isAdmin()) {
            this.toast('Only an administrator can remove spiritual milestones.', 'error');
            return;
        }
        const member = this.db.members.find((item) => item.id === memberId);
        const milestones = member?.spiritualMilestones || [];
        if (!member || !Number.isInteger(index) || index < 0 || index >= milestones.length) return;
        const milestone = milestones[index];
        const confirmed = await this.confirmAction({
            title: 'Remove this spiritual milestone?',
            body: `"${milestone}" will be permanently removed from ${member.firstName} ${member.lastName}'s profile.`,
            confirmLabel: 'Remove milestone',
        });
        if (!confirmed) return;
        try {
            const spiritualMilestones = milestones.filter((_, itemIndex) => itemIndex !== index);
            const saved = this.apiEnabled()
                ? await Church2API.updateMemberMilestones(member.id, spiritualMilestones)
                : { spiritualMilestones };
            member.spiritualMilestones = saved.spiritualMilestones;
            this.saveDB();
            this.viewMemberDetails(member.id);
            this.renderMemberDirectory();
            this.toast('Spiritual milestone removed.');
        } catch (error) {
            console.error('Spiritual milestone removal failed:', error);
            this.toast(`Could not remove this milestone: ${error.message}`, 'error');
        }
    },

    // Remove someone from the roll. Administrators only, confirmed first, and
    // their attendance history goes with them so no orphan records are left
    // pointing at a member who no longer exists.
    async removeMember(memberId) {
        if (!this.isAdmin()) {
            this.toast('Only an administrator can remove members.', 'error');
            return;
        }
        const member = this.db.members.find((m) => m.id === memberId);
        if (!member) return;
        const name = `${member.firstName} ${member.lastName}`;

        const confirmed = await this.confirmAction({
            title: `Remove ${name}?`,
            body: `${name} will be taken off the membership roll along with their `
                + `attendance history. Giving already recorded is kept for the financial `
                + `record. This cannot be undone.`,
            confirmLabel: 'Remove member',
        });
        if (!confirmed) return;

        try {
            if (this.apiEnabled()) await Church2API.removeMember(memberId);
            this.db.members = this.db.members.filter((m) => m.id !== memberId);
            this.db.attendance = (this.db.attendance || []).filter((a) => a.memberId !== memberId);
            (this.db.groups || []).forEach((g) => {
                g.memberIds = (g.memberIds || []).filter((id) => id !== memberId);
            });
            (this.db.events || []).forEach((event) => {
                event.volunteersSignedUp = (event.volunteersSignedUp || []).filter((id) => id !== memberId);
            });
            this.saveDB();
            this.toast(`${name} removed from the roll.`);
            this.renderAll();
        } catch (error) {
            console.error('Member removal failed:', error);
            this.toast(`Could not remove ${name}: ${error.message}`, 'error');
        }
    },

    async handleCreateMember() {
        // Enforced here as well as in the UI: hiding the form is presentation,
        // this is the rule.
        if (!this.isAdmin()) {
            this.toast('Only an administrator can add members.', 'error');
            return;
        }
        const firstName = document.getElementById('member-first-name').value.trim();
        const lastName = document.getElementById('member-last-name').value.trim();
        const email = document.getElementById('member-email').value.trim();
        const phone = document.getElementById('member-phone').value.trim();
        const branchId = document.getElementById('member-branch-select').value;
        const skillsText = document.getElementById('member-skills').value.trim();
        const maritalStatus = document.getElementById('member-marital-status').value;
        const background = document.getElementById('member-background').value.trim();
        const expectations = document.getElementById('member-expectations').value.trim();
        const accountRole = document.getElementById('member-account-role').value;
        const createAccount = Boolean(accountRole);
        const accountPassword = document.getElementById('member-account-password').value;
        const groupIds = [...document.querySelectorAll('#member-group-options input[name="member-groups"]:checked')]
            .map((input) => input.value);

        const branchObj = this.db.branches.find(b => b.id === branchId);
        if (!branchObj) {
            this.toast('Choose a valid campus before adding the member.', 'error');
            return;
        }
        if (createAccount && (!this.apiEnabled() || !email || accountPassword.length < 12)) {
            this.toast(this.apiEnabled()
                ? 'A valid email and temporary password of at least 12 characters are required for system access.'
                : 'System accounts can only be created while connected to the server.', 'error');
            return;
        }
        if (createAccount && accountRole === 'branch_admin' && this.session.currentRole !== 'hq_admin') {
            this.toast('Only an HQ administrator can assign the branch administrator role.', 'error');
            return;
        }
        const skillsArray = skillsText ? skillsText.split(',').map(s => s.trim()) : [];

        const form = document.getElementById('add-member-form');
        const submitButton = form.querySelector('[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = 'Adding member…';
        try {
            const details = {
                firstName, lastName, email, phone, volunteer_skills: skillsArray, branchId,
                maritalStatus, background, expectations, groupIds,
                account: createAccount ? { role: accountRole, password: accountPassword } : null,
            };
            const saved = this.apiEnabled()
                ? await Church2API.createMember(details)
                : null;
            const newMember = saved || {
                id: `m_${Date.now()}`,
                branchId,
                branchName: branchObj.name,
                firstName,
                lastName,
                email,
                phone,
                familyId: `fam_${lastName.toLowerCase()}_${Math.floor(Math.random() * 1000)}`,
                familyRole: 'Single',
                spiritualMilestones: ['Registered: ' + new Date().toISOString().split('T')[0]],
                volunteer_skills: skillsArray,
                engagement_score: 50,
                maritalStatus,
                background,
                expectations,
            };
            this.db.members.push(newMember);
            groupIds.forEach((groupId) => {
                const group = this.db.groups.find((item) => item.id === groupId);
                if (group && !group.memberIds.includes(newMember.id)) group.memberIds.push(newMember.id);
            });
            this.saveDB();
            form.reset();
            document.getElementById('member-account-fields').hidden = true;
            document.getElementById('member-account-password').required = false;
            document.getElementById('member-account-role').setAttribute('aria-expanded', 'false');
            this.toast(createAccount
                ? `${firstName} ${lastName} added with ${accountRole.replace('_', ' ')} system access. Share the temporary password securely.`
                : `${firstName} ${lastName} enrolled in ${branchObj.name}.`);
            this.renderMemberDirectory();
            this.renderGroups();
        } catch (error) {
            console.error('Member creation failed:', error);
            this.toast(`Could not add ${firstName} ${lastName}: ${error.message}`, 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Add Member to Registry';
        }
    },

    // 10. Panel: Financials Ledger Rendering
    renderFinancials() {
        const branchId = this.session.currentBranch;
        this.renderCollectionSessions(branchId);
        const tbody = document.getElementById('financials-tbody');
        tbody.innerHTML = '';

        let filteredTx = this.db.transactions;
        if (branchId !== 'all' && branchId !== 'global') {
            filteredTx = this.db.transactions.filter(t => t.branchId === branchId);
        }

        // Render rows
        filteredTx.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="receipt-no" style="font-family: monospace; font-weight: bold; color: var(--text-accent);">${esc(t.receiptNumber)}</span></td>
                <td><span class="branch-pill badge-${esc(t.branchId)}">${esc(t.branchName)}</span></td>
                <td>${esc(t.memberName || 'Anonymous')}</td>
                <td><span class="category-pill category-${esc((t.category || '').toLowerCase().replace(' ', ''))}">${esc(t.category)}</span></td>
                <td class="amount-cell" style="color: var(--success-green); font-weight: bold; text-align: right;">${money(parseFloat(t.amount))}</td>
                <td>${esc(t.date)}</td>
                <td>${esc(t.paymentMethod)}</td>
                <td>
                    <button class="action-btn-sm" onclick="ChurchApp.viewReceipt('${esc(t.id)}')">Receipt</button>
                    ${this.isAdmin() ? `<button type="button" class="action-btn-sm action-btn-danger" onclick="ChurchApp.removeTransaction('${esc(t.id)}')" aria-label="Remove receipt ${esc(t.receiptNumber)}">Remove</button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (filteredTx.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 30px;">No transactions logged.</td></tr>`;
        }

        // Bind quick export buttons
        document.getElementById('export-csv-btn').onclick = () => this.exportFinancialCSV(filteredTx);

        // Campaign progress + recurring-gift insights strip
        this.renderContributionSummary(branchId);
        this.renderGivingInsights(branchId);
    },

    renderCollectionSessions(branchId) {
        const branchSelect = document.getElementById('collection-branch');
        if (branchSelect) {
            const isGlobal = branchId === 'all' || branchId === 'global';
            const selectedBranch = isGlobal ? '' : branchId;
            branchSelect.innerHTML = `${isGlobal ? '<option value="">Select campus</option>' : ''}${this.db.branches.map((branch) =>
                `<option value="${esc(branch.id)}"${branch.id === selectedBranch ? ' selected' : ''}>${esc(branch.name)}</option>`
            ).join('')}`;
            branchSelect.disabled = !this.isAdmin();
        }
        const dateInput = document.getElementById('collection-session-date');
        if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
        this.updateCollectionTotal();

        const inScope = (session) => !branchId || branchId === 'all' || branchId === 'global' || session.branchId === branchId;
        const sessions = (this.db.collectionSessions || []).filter(inScope);
        const grouped = new Map();
        sessions.forEach((session) => {
            const key = `${session.date}:${session.branchId}`;
            const group = grouped.get(key) || {
                date: session.date,
                branchId: session.branchId,
                branchName: session.branchName || this.db.branches.find((branch) => branch.id === session.branchId)?.name || '',
                sessions: [],
                sessionCount: 0,
                offeringAmount: 0,
                titheAmount: 0,
                otherAmount: 0,
                totalAmount: 0,
            };
            group.sessions.push(session);
            group.sessionCount += 1;
            group.offeringAmount += Number(session.offeringAmount) || 0;
            group.titheAmount += Number(session.titheAmount) || 0;
            group.otherAmount += Number(session.otherAmount) || 0;
            group.totalAmount += Number(session.totalAmount) || 0;
            grouped.set(key, group);
        });

        const rows = [...grouped.values()]
            .sort((a, b) => b.date.localeCompare(a.date) || a.branchName.localeCompare(b.branchName))
            .map((group) => `<tr>
                <td><strong>${esc(group.date)}</strong><span class="collection-session-names">${group.sessions.map((session) => esc(session.sessionName)).join(', ')}</span></td>
                <td><span class="branch-pill badge-${esc(group.branchId)}">${esc(group.branchName)}</span></td>
                <td class="num">${group.sessionCount}</td>
                <td class="num amount-cell">${money(group.offeringAmount)}</td>
                <td class="num amount-cell">${money(group.titheAmount)}</td>
                <td class="num amount-cell">${money(group.otherAmount)}</td>
                <td class="num collection-day-total">${money(group.totalAmount)}</td>
                <td>${this.isAdmin() ? group.sessions.map((session) => `<button type="button" class="action-btn-sm action-btn-danger" onclick="ChurchApp.removeCollectionSession('${esc(session.id)}')" aria-label="Remove ${esc(session.sessionName)} collection session">Remove ${esc(session.sessionName)}</button>`).join(' ') : ''}</td>
            </tr>`).join('');
        document.getElementById('collection-sessions-tbody').innerHTML = rows
            || '<tr><td colspan="8" class="collection-empty">No collection sessions recorded for this campus yet.</td></tr>';
    },

    async removeCollectionSession(id) {
        if (!this.isAdmin()) {
            this.toast('Only an administrator can remove collection sessions.', 'error');
            return;
        }
        const session = (this.db.collectionSessions || []).find((item) => item.id === id);
        if (!session) return;
        const confirmed = await this.confirmAction({
            title: `Remove ${session.sessionName}?`,
            body: `The ${session.date} collection session totaling ${money(Number(session.totalAmount))} will be permanently removed.`,
            confirmLabel: 'Remove session',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.removeCollectionSession(id);
            this.db.collectionSessions = this.db.collectionSessions.filter((item) => item.id !== id);
            this.saveDB();
            this.renderCollectionSessions(this.session.currentBranch);
            this.toast(`${session.sessionName} was removed.`);
        } catch (error) {
            console.error('Collection session removal failed:', error);
            this.toast(`Could not remove this collection session: ${error.message}`, 'error');
        }
    },

    updateCollectionTotal() {
        const amount = (id) => Number(document.getElementById(id).value) || 0;
        const total = Math.round((amount('collection-offering') + amount('collection-tithe') + amount('collection-other')) * 100) / 100;
        document.getElementById('collection-total').textContent = money(total);
    },

    async handleCreateCollectionSession() {
        if (!this.isAdmin()) {
            this.toast('Only an administrator can record a collection session.', 'error');
            return;
        }
        const form = document.getElementById('collection-session-form');
        const submitButton = form.querySelector('[type="submit"]');
        const sessionName = document.getElementById('collection-session-name').value.trim();
        const date = document.getElementById('collection-session-date').value;
        const branchId = document.getElementById('collection-branch').value;
        const offeringAmount = Number(document.getElementById('collection-offering').value);
        const titheAmount = Number(document.getElementById('collection-tithe').value);
        const otherAmount = Number(document.getElementById('collection-other').value);
        const totalAmount = Math.round((offeringAmount + titheAmount + otherAmount) * 100) / 100;
        const branch = this.db.branches.find((item) => item.id === branchId);

        if (!sessionName || !date || !branch || [offeringAmount, titheAmount, otherAmount].some((amount) => !Number.isFinite(amount) || amount < 0) || totalAmount <= 0) {
            this.toast('Enter a session name, date, campus, and at least one collection amount.', 'error');
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Saving session…';
        try {
            const details = { sessionName, date, branchId, offeringAmount, titheAmount, otherAmount };
            const saved = this.apiEnabled()
                ? await Church2API.createCollectionSession(details)
                : { id: `cs_${Date.now()}`, ...details, branchName: branch.name, totalAmount };
            this.db.collectionSessions.unshift(saved);
            this.saveDB();
            form.reset();
            document.getElementById('collection-session-date').value = new Date().toISOString().split('T')[0];
            this.updateCollectionTotal();
            this.renderCollectionSessions(this.session.currentBranch);
            this.toast(`Collection session saved. Total received: ${money(saved.totalAmount)}.`);
        } catch (error) {
            console.error('Collection session save failed:', error);
            this.toast(`Could not save this collection session: ${error.message}`, 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Save collection session';
        }
    },

    // Contributions, standing on their own.
    //
    // Agreed 17 Aug 2026: money is not tied to projects, attendance or
    // individual activities. This panel therefore reads nothing but the
    // transaction ledger — no campaign, no register, no event — and answers the
    // two questions the administrator actually asked for: what has each person
    // given, and what is the total.
    renderContributionSummary(branchId) {
        const el = document.getElementById('contribution-summary');
        if (!el) return;
        const inScope = (bId) => (!branchId || branchId === 'global') ? true : bId === branchId;

        const gifts = (this.db.transactions || []).filter((t) => inScope(t.branchId));
        const total = gifts.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

        // Individual totals, largest first.
        const byGiver = new Map();
        gifts.forEach((t) => {
            const key = t.memberId || 'anonymous';
            const entry = byGiver.get(key) || { name: t.memberName || 'Anonymous', total: 0, count: 0 };
            entry.total += parseFloat(t.amount) || 0;
            entry.count += 1;
            byGiver.set(key, entry);
        });
        const givers = [...byGiver.values()].sort((a, b) => b.total - a.total);
        const shown = this.session.showAllGivers ? givers : givers.slice(0, 8);

        const rows = shown.map((g) => `<tr>
            <td>${esc(g.name)}</td>
            <td class="num">${g.count}</td>
            <td class="num amount-cell">${money(g.total)}</td>
        </tr>`).join('') || '<tr><td colspan="3" class="muted-italic" style="text-align:center;">No contributions recorded in this scope.</td></tr>';

        const moreBtn = givers.length > 8
            ? `<button type="button" class="btn btn-secondary btn-sm" id="toggle-all-givers">${
                  this.session.showAllGivers ? 'Show top 8 only' : `Show all ${givers.length} givers`
              }</button>`
            : '';

        el.innerHTML = `
            <div class="card-glass contribution-totals">
                <span class="contribution-eyebrow">Total from individual gifts</span>
                <div class="contribution-total">${money(total)}</div>
                <p class="contribution-meta">${gifts.length} individual receipt${gifts.length === 1 ? '' : 's'}
                   from ${givers.length} ${givers.length === 1 ? 'giver' : 'givers'}<br>Service collection totals are shown above.</p>
            </div>
            <div class="card-glass contribution-people">
                <div class="contribution-head">
                    <h3>Individual Contributions</h3>
                    ${moreBtn}
                </div>
                <div class="table-responsive">
                    <table class="financial-table">
                        <thead><tr><th>Member</th><th class="num">Gifts</th><th class="num">Total given</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>`;

        const toggle = document.getElementById('toggle-all-givers');
        if (toggle) toggle.onclick = () => {
            this.session.showAllGivers = !this.session.showAllGivers;
            this.renderContributionSummary(branchId);
        };
    },

    renderGivingInsights(branchId) {
        const el = document.getElementById('giving-insights');
        if (!el) return;
        const inScope = (bId) => (!branchId || branchId === 'global') ? true : bId === branchId;

        // Standing orders are money, not a project, so they belong here. Pledge
        // campaigns used to sit alongside them, deriving "raised" by summing
        // transactions in a matching fund — exactly the money-to-project link
        // the 17 Aug meeting asked us to break. The campaign records remain in
        // the database untouched, pending Thursday's decision on where (and
        // whether) project fundraising should live.
        const recurringItems = (this.db.recurringGifts || []).filter((r) => inScope(r.branchId));
        const recurring = recurringItems.filter((r) => r.active);
        const recurringTotal = recurring.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
        el.innerHTML = `<div class="card-glass campaign-card">
            <span class="campaign-eyebrow"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a8 8 0 0 1 13.5-3.5L20 8"/><path d="M20 4v4h-4"/><path d="M20 15a8 8 0 0 1-13.5 3.5L4 16"/><path d="M4 20v-4h4"/></svg> Recurring Giving</span>
            <h4>${recurring.length} active schedule${recurring.length === 1 ? '' : 's'}</h4>
            <div class="campaign-figures"><strong>${window.money(recurringTotal)}</strong> committed per cycle</div>
            ${recurringItems.length ? `<ul class="recurring-list">${recurringItems.map((r) =>
                `<li><span>${esc(r.memberName)} — ${window.money(parseFloat(r.amount))} ${esc(r.frequency)} (${esc(r.category)})${r.active ? '' : ' · Paused'}</span>${this.isAdmin() ? `<button type="button" class="action-btn-sm action-btn-danger" onclick="ChurchApp.removeRecurringGift('${esc(r.id)}')" aria-label="Remove recurring gift for ${esc(r.memberName)}">Remove</button>` : ''}</li>`).join('')}</ul>` : ''}
        </div>`;
    },

    async removeRecurringGift(id) {
        if (!this.isAdmin()) {
            this.toast('Only an administrator can remove recurring gifts.', 'error');
            return;
        }
        const gift = (this.db.recurringGifts || []).find((item) => item.id === id);
        if (!gift) return;
        const confirmed = await this.confirmAction({
            title: `Remove ${gift.memberName}'s recurring gift?`,
            body: `The ${money(Number(gift.amount))} ${gift.frequency} giving schedule will be permanently removed.`,
            confirmLabel: 'Remove schedule',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.removeRecurringGift(id);
            this.db.recurringGifts = this.db.recurringGifts.filter((item) => item.id !== id);
            this.saveDB();
            this.renderGivingInsights(this.session.currentBranch);
            this.toast('Recurring gift schedule removed.');
        } catch (error) {
            console.error('Recurring gift removal failed:', error);
            this.toast(`Could not remove this recurring gift: ${error.message}`, 'error');
        }
    },

    // Printable, tax-ready annual giving statement for one member.
    viewGivingStatement(memberId) {
        const member = this.db.members.find(m => m.id === memberId);
        if (!member) return;
        const year = new Date().getFullYear();
        const gifts = this.db.transactions
            .filter(t => t.memberId === memberId && new Date(t.date).getFullYear() === year)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        const total = gifts.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
        const money = (n) => window.money(n);

        const byFund = {};
        gifts.forEach(t => { byFund[t.category] = (byFund[t.category] || 0) + (parseFloat(t.amount) || 0); });

        const modal = document.getElementById('receipt-modal');
        modal.innerHTML = `
            <div class="modal-card statement-card" role="dialog" aria-modal="true" aria-labelledby="statement-title">
                <div class="modal-header">
                    <h3 id="statement-title">${year} Annual Giving Statement</h3>
                    <button class="modal-close" aria-label="Close statement" onclick="ChurchApp.closeModal('receipt-modal')">×</button>
                </div>
                <div class="modal-body receipt-print-area scroll-y">
                    <div class="receipt-header">
                        <h2>${esc(MMC_BRAND.name.toUpperCase())}</h2>
                        <p>${esc(member.branchName)}</p>
                        <p style="font-size: 0.75rem; color:#9ca3af;">Branch Code: ${esc((member.branchId || '').toUpperCase())}</p>
                    </div>
                    <p style="margin-top:10px;"><strong>${esc(member.firstName)} ${esc(member.lastName)}</strong><br>
                    <span style="color:var(--text-secondary); font-size:0.8rem;">${esc(member.email)}</span></p>
                    <p style="font-size:0.75rem; color:var(--text-secondary); margin-top:8px;">
                        Tax-deductible contributions for the ${year} calendar year. No goods or services were provided in exchange for these gifts.
                    </p>
                    <hr style="border:0; border-top:1px dashed rgba(150,150,150,0.4); margin:14px 0;">
                    <table class="financial-table">
                        <thead><tr><th>Date</th><th>Fund</th><th>Method</th><th style="text-align:right;">Amount</th></tr></thead>
                        <tbody>
                            ${gifts.map(t => `<tr>
                                <td>${esc(t.date)}</td>
                                <td>${esc(t.category)}</td>
                                <td>${esc(t.paymentMethod)}</td>
                                <td style="text-align:right;">${money(parseFloat(t.amount))}</td>
                            </tr>`).join('') || `<tr><td colspan="4" class="muted-italic" style="text-align:center;">No ${year} contributions on record.</td></tr>`}
                        </tbody>
                    </table>
                    <div class="statement-by-fund">
                        ${Object.keys(byFund).map(f => `<span class="statement-fund-pill">${esc(f)}: ${money(byFund[f])}</span>`).join('')}
                    </div>
                    <div class="receipt-row total-row" style="margin-top:14px;">
                        <span style="font-size:1.05rem;">TOTAL ${year} CONTRIBUTIONS</span>
                        <strong style="color:#10b981; font-size:1.35rem;">${money(total)}</strong>
                    </div>
                    <p style="font-size:0.7rem; color:var(--text-secondary); margin-top:14px;">${esc(MMC_BRAND.name)} is a registered place of worship. Retain this statement for your records.</p>
                </div>
                <div style="display:flex; gap:8px; margin-top:15px; justify-content:flex-end;">
                    <button class="btn btn-secondary" onclick="window.print()">Print / Save PDF</button>
                    <button class="btn btn-primary-gradient" onclick="ChurchApp.closeModal('receipt-modal')">Close</button>
                </div>
            </div>
        `;
        this.openModal('receipt-modal');
    },

    handleRecordTransaction() {
        const memberSelect = document.getElementById('tx-member-select');
        const memberId = memberSelect.value;
        const category = document.getElementById('tx-category-select').value;
        const amount = parseFloat(document.getElementById('tx-amount-input').value);
        const method = document.getElementById('tx-method-select').value;
        const date = document.getElementById('tx-date-input').value || new Date().toISOString().split('T')[0];

        if (isNaN(amount) || amount <= 0) { this.toast('Enter a valid contribution amount greater than ₵0.', 'error'); return; }

        let memberName = 'Anonymous';
        // When "All Branches (Global)" is active there is no single campus to file
        // an anonymous gift under, so default to the HQ campus (b1).
        let branchId = (this.session.currentBranch === 'all' || this.session.currentBranch === 'global')
            ? 'b1' : this.session.currentBranch;

        if (memberId !== 'anonymous') {
            const memberObj = this.db.members.find(m => m.id === memberId);
            if (memberObj) {
                memberName = `${memberObj.firstName} ${memberObj.lastName}`;
                branchId = memberObj.branchId;
                
                // Boost engagement score for giving
                memberObj.engagement_score = Math.min(memberObj.engagement_score + 4, 100);
            }
        }

        const branchObj = this.db.branches.find(b => b.id === branchId);

        const newTx = {
            id: `t_${Date.now()}`,
            branchId,
            branchName: branchObj.name,
            memberId: memberId === 'anonymous' ? null : memberId,
            memberName,
            amount,
            category,
            date,
            paymentMethod: method,
            receiptNumber: `REC-2026-${Math.floor(Math.random() * 90000) + 10000}`
        };

        this.db.transactions.unshift(newTx);
        this.saveDB();
        this.apiWrite(
            () => Church2API.recordTransaction({ memberId, amount, category, paymentMethod: method, date, memberName, branchId }),
            (srv) => { if (srv && srv.id) { newTx.id = srv.id; if (srv.receiptNumber) newTx.receiptNumber = srv.receiptNumber; } }
        );
        document.getElementById('record-tx-form').reset();
        
        // Reset defaults
        document.getElementById('tx-date-input').value = new Date().toISOString().split('T')[0];

        this.toast(`Logged ${money(amount)} from ${memberName}. Receipt ${newTx.receiptNumber}.`);
        
        this.renderAll();
    },

    viewReceipt(txId) {
        const tx = this.db.transactions.find(t => t.id === txId);
        if (!tx) return;

        const modal = document.getElementById('receipt-modal');
        modal.innerHTML = `
            <div class="modal-card receipt-card" role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title">
                <div class="receipt-seal">
                    <span>Approved<br>HQ System</span>
                </div>
                <div class="modal-header">
                    <h3 id="receipt-modal-title">STEWARDSHIP RECEIPT</h3>
                    <button class="modal-close" aria-label="Close receipt" onclick="ChurchApp.closeModal('receipt-modal')">×</button>
                </div>
                <div class="modal-body receipt-print-area">
                    <div class="receipt-header">
                        <h2>${esc(MMC_BRAND.name.toUpperCase())}</h2>
                        <p>${esc(tx.branchName)}</p>
                        <p style="font-size: 0.75rem; color:#9ca3af;">Branch Code: ${esc((tx.branchId || '').toUpperCase())}</p>
                    </div>
                    <hr style="border: 0; border-top: 1px dashed rgba(255,255,255,0.15); margin: 15px 0;">
                    <div class="receipt-row">
                        <span>Receipt Number:</span>
                        <strong>${esc(tx.receiptNumber)}</strong>
                    </div>
                    <div class="receipt-row">
                        <span>Date Filed:</span>
                        <strong>${esc(tx.date)}</strong>
                    </div>
                    <div class="receipt-row">
                        <span>Donation Contributor:</span>
                        <strong>${esc(tx.memberName || 'Anonymous Partner')}</strong>
                    </div>
                    <div class="receipt-row">
                        <span>Giving Allocation:</span>
                        <strong class="category-pill">${esc(tx.category)}</strong>
                    </div>
                    <hr style="border: 0; border-top: 1px dashed rgba(255,255,255,0.15); margin: 15px 0;">
                    <div class="receipt-row total-row">
                        <span style="font-size: 1.1rem;">TOTAL AMOUNT RECEIVED:</span>
                        <strong style="color: #10b981; font-size: 1.4rem;">${money(parseFloat(tx.amount))}</strong>
                    </div>
                    
                    <div class="simulated-barcode">
                        <div class="thick"></div>
                        <div class="thin"></div>
                        <div class="space"></div>
                        <div class="thick"></div>
                        <div class="thick"></div>
                        <div class="thin"></div>
                        <div class="space"></div>
                        <div class="thin"></div>
                        <div class="thick"></div>
                        <div class="thin"></div>
                        <div class="space"></div>
                        <div class="thick"></div>
                        <div class="thin"></div>
                    </div>

                    <div class="receipt-footer">
                        <p>Thank you for your generous stewardship.</p>
                        <p style="font-size:0.7rem; color:#9ca3af; margin-top:8px;">Signed electronically by the ${esc(MMC_BRAND.shortName)} HQ admin system</p>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; margin-top: 15px; justify-content: flex-end;">
                    <button class="btn btn-secondary" onclick="window.print()">Print Receipt</button>
                    <button class="btn btn-primary-gradient" onclick="ChurchApp.closeModal('receipt-modal')">Close</button>
                </div>
            </div>
        `;
        this.openModal('receipt-modal');
    },

    async removeTransaction(id) {
        if (!this.isAdmin()) {
            this.toast('Only an administrator can remove financial transactions.', 'error');
            return;
        }
        const transaction = this.db.transactions.find((item) => item.id === id);
        if (!transaction) return;
        const confirmed = await this.confirmAction({
            title: `Remove receipt ${transaction.receiptNumber}?`,
            body: `${money(Number(transaction.amount))} from ${transaction.memberName || 'Anonymous'} will be permanently removed from the financial ledger.`,
            confirmLabel: 'Remove transaction',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.removeTransaction(id);
            this.db.transactions = this.db.transactions.filter((item) => item.id !== id);
            this.saveDB();
            this.renderFinancials();
            this.toast(`Receipt ${transaction.receiptNumber} was removed.`);
        } catch (error) {
            console.error('Transaction removal failed:', error);
            this.toast(`Could not remove receipt ${transaction.receiptNumber}: ${error.message}`, 'error');
        }
    },

    exportFinancialCSV(transactions) {
        // Escape a CSV cell: double embedded quotes, and neutralize leading
        // =/+/-/@ so spreadsheet apps can't execute a value as a formula.
        const csvCell = (value) => {
            let s = String(value == null ? '' : value);
            if (/^[=+\-@]/.test(s)) s = "'" + s;
            return `"${s.replace(/"/g, '""')}"`;
        };

        const rows = [
            ['Receipt Number', 'Branch', 'Member Name', 'Category', 'Amount', 'Date', 'Payment Method'],
            ...transactions.map(t => [
                t.receiptNumber,
                t.branchName,
                t.memberName || 'Anonymous',
                t.category,
                parseFloat(t.amount).toFixed(2),
                t.date,
                t.paymentMethod
            ])
        ];

        const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');

        // Use a Blob URL so commas/quotes survive without URI-encoding quirks.
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `church2_financial_export_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    // 10. Panel: Ministry & Rota Rendering
    renderMinistry() {
        const selectEvent = document.getElementById('rota-event-select');

        // Scope events to the active campus so a campus admin only rosters their
        // own events (and can't assign another campus's members).
        const scope = this.session.currentBranch;
        const events = this.db.events.filter(e => !scope || scope === 'global' || e.branchId === scope);

        // Keep the selected event valid within the current scope.
        let activeEventId = this.session.selectedEventId;
        if (!events.some(e => e.id === activeEventId)) {
            activeEventId = events.length ? events[0].id : null;
            this.session.selectedEventId = activeEventId;
        }

        // Sync dropdown list
        selectEvent.innerHTML = '';
        events.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.text = `${e.title} (${e.date})`;
            selectEvent.appendChild(opt);
        });
        selectEvent.value = activeEventId;
        const removeEventButton = document.getElementById('remove-rota-event');
        if (removeEventButton) {
            removeEventButton.hidden = !activeEventId || !this.canManageMinistryItems();
            removeEventButton.onclick = () => this.removeEvent(activeEventId);
        }

        const requiredRolesEmpty = document.getElementById('rota-required-roles');
        if (!activeEventId) {
            if (requiredRolesEmpty) requiredRolesEmpty.innerHTML = '<p class="muted-italic">No events scheduled for this campus yet.</p>';
            selectEvent.onchange = null;
            return;
        }

        // Render Rota details
        const event = this.db.events.find(e => e.id === activeEventId);
        if (!event) return;

        // Render list of required roles
        const requiredRolesContainer = document.getElementById('rota-required-roles');
        requiredRolesContainer.innerHTML = '';

        event.rolesRequired.forEach(role => {
            // Find signed up members for this role
            const signup = event.volunteersSignedUp.find(mId => {
                const member = this.db.members.find(m => m.id === mId);
                return member && member.volunteer_skills.includes(role);
            });
            const volunteerObj = signup ? this.db.members.find(m => m.id === signup) : null;

            const div = document.createElement('div');
            div.className = 'rota-role-card';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="color: var(--text-accent); font-size: 0.95rem;">${esc(role)}</strong>
                        <p class="rota-status ${volunteerObj ? 'is-assigned' : 'is-unassigned'}">Status: ${volunteerObj ? '✅ Roster Assigned' : '⚠️ Unassigned'}</p>
                    </div>
                    <div>
                        ${volunteerObj ? `
                            <div class="volunteer-pill">
                                <span>${esc(volunteerObj.firstName)} ${esc(volunteerObj.lastName)}</span>
                                <button aria-label="Remove ${esc(volunteerObj.firstName)} ${esc(volunteerObj.lastName)} from ${esc(role)}" onclick="ChurchApp.removeVolunteerFromRole('${esc(event.id)}', '${esc(volunteerObj.id)}')" class="remove-vol-btn">×</button>
                            </div>
                        ` : `
                            <button class="action-btn-sm" onclick="ChurchApp.showMatchAI('${esc(event.id)}', '${esc(role).replace(/'/g, "\\'")}')"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l1.4 4 4 1.4-4 1.4L12 15l-1.4-4.2L6.6 9.4l4-1.4z"/></svg> AI Match</button>
                        `}
                    </div>
                </div>
            `;
            requiredRolesContainer.appendChild(div);
        });

        // Event listener to change event rota
        selectEvent.onchange = (e) => {
            this.session.selectedEventId = e.target.value;
            this.renderMinistry();
        };
    },

    async removeVolunteerFromRole(eventId, volunteerId) {
        if (!this.canManageMinistryItems()) {
            this.toast('You do not have permission to change event rosters.', 'error');
            return;
        }
        const event = (this.db.events || []).find((item) => item.id === eventId);
        const volunteer = this.db.members.find((item) => item.id === volunteerId);
        if (!event || !volunteer) return;
        const confirmed = await this.confirmAction({
            title: `Remove ${volunteer.firstName} ${volunteer.lastName} from the event roster?`,
            body: `The volunteer assignment for ${event.title} will be removed. The member profile will remain.`,
            confirmLabel: 'Remove assignment',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.removeEventVolunteer(eventId, volunteerId);
            event.volunteersSignedUp = event.volunteersSignedUp.filter((id) => id !== volunteerId);
            this.saveDB();
            this.renderMinistry();
            this.toast(`${volunteer.firstName} was removed from the event roster.`);
        } catch (error) {
            console.error('Event roster removal failed:', error);
            this.toast(`Could not remove ${volunteer.firstName} from this event: ${error.message}`, 'error');
        }
    },

    async removeEvent(eventId) {
        if (!this.canManageMinistryItems()) {
            this.toast('You do not have permission to remove events.', 'error');
            return;
        }
        const event = (this.db.events || []).find((item) => item.id === eventId);
        if (!event) return;
        const confirmed = await this.confirmAction({
            title: `Remove ${event.title}?`,
            body: 'The event and its volunteer rota will be permanently removed.',
            confirmLabel: 'Remove event',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.removeEvent(eventId);
            this.db.events = this.db.events.filter((item) => item.id !== eventId);
            if (this.session.selectedEventId === eventId) this.session.selectedEventId = null;
            this.saveDB();
            this.renderMinistry();
            this.toast(`${event.title} was removed.`);
        } catch (error) {
            console.error('Event removal failed:', error);
            this.toast(`Could not remove ${event.title}: ${error.message}`, 'error');
        }
    },

    showMatchAI(eventId, role) {
        const event = this.db.events.find(e => e.id === eventId);
        // Only suggest volunteers from the event's own campus.
        const pool = event ? this.db.members.filter(m => m.branchId === event.branchId) : this.db.members;
        const matches = window.AIEngine.matchVolunteersForEvent([role], pool);
        
        const modal = document.getElementById('ai-matcher-modal');
        modal.innerHTML = `
            <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="matcher-modal-title">
                <div class="modal-header">
                    <h3 id="matcher-modal-title">AI Volunteer Matching System</h3>
                    <button class="modal-close" aria-label="Close volunteer matcher" onclick="ChurchApp.closeModal('ai-matcher-modal')">×</button>
                </div>
                <div class="modal-body">
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px;">Searching database for members with skill: <strong style="color:var(--text-accent);">${esc(role)}</strong> and solid engagement scoring index.</p>
                    <div class="matches-list">
                        ${matches.map(m => `
                            <div class="match-item">
                                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                                    <div>
                                        <strong>${esc(m.member.firstName)} ${esc(m.member.lastName)}</strong>
                                        <p style="font-size:0.75rem; color:var(--text-secondary);">Branch: ${esc(m.member.branchName)} | Engagement: ${esc(m.member.engagement_score)}%</p>
                                    </div>
                                    <div style="text-align:right;">
                                        <span class="match-percentage">${esc(m.score)}% Match</span>
                                        <button class="btn btn-primary-gradient btn-sm" style="margin-top:6px;" onclick="ChurchApp.assignVolunteerRole('${esc(event.id)}', '${esc(m.member.id)}')">Assign Role</button>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                        ${matches.length === 0 ? '<p class="muted-italic" style="text-align:center;">No matching volunteers found in DB.</p>' : ''}
                    </div>
                </div>
            </div>
        `;
        this.openModal('ai-matcher-modal');
    },

    assignVolunteerRole(eventId, volunteerId) {
        const event = this.db.events.find(e => e.id === eventId);
        if (event) {
            if (!event.volunteersSignedUp.includes(volunteerId)) {
                event.volunteersSignedUp.push(volunteerId);
            }
            this.saveDB();
            this.closeModal('ai-matcher-modal');
            this.renderMinistry();
        }
    },

    // 11. Panel: Communications Dashboard Rendering
    renderCommunications() {
        const listContainer = document.getElementById('prayer-requests-list');
        listContainer.innerHTML = '';

        // Prayer requests are sensitive pastoral content — scope them to the
        // active campus so a campus admin never sees another campus's requests.
        const scope = this.session.currentBranch;
        const scopeName = (scope && scope !== 'global')
            ? (this.db.branches.find(b => b.id === scope) || {}).name : null;
        const prayers = this.db.prayerRequests.filter(pr => !scopeName || pr.branchName === scopeName);

        prayers.forEach(pr => {
            const branchId = (this.db.branches.find(b => b.name === pr.branchName) || {}).id || 'b1';
            const card = document.createElement('div');
            card.className = 'prayer-request-card';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                    <div>
                        <strong class="prayer-member">${esc(pr.memberName)}</strong>
                        <span class="branch-pill badge-${esc(branchId)}" style="font-size: 0.7rem; margin-left: 8px;">${esc(pr.branchName)}</span>
                    </div>
                    <span class="category-pill prayer-category"><svg class="inline-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 13.5l-7 7a2 2 0 0 1-2.8 0l-6.2-6.2a2 2 0 0 1-.5-1.9l1.4-5.6a2 2 0 0 1 1.5-1.5l5.6-1.4a2 2 0 0 1 1.9.5l6.2 6.2a2 2 0 0 1-.1 2.9z"/><circle cx="9" cy="9" r="1.3"/></svg> ${esc(pr.category)}</span>
                </div>
                <p class="prayer-text">"${esc(pr.text)}"</p>
                <div class="prayer-actions">
                    <span>Routed to: <strong>${esc(pr.route)}</strong></span>
                    ${this.canManageMinistryItems() ? `<div>
                        <button class="action-btn-sm btn-approve" onclick="ChurchApp.approvePrayer('${esc(pr.id)}')">Approve &amp; remove</button>
                        <button class="action-btn-sm btn-dismiss" onclick="ChurchApp.deletePrayer('${esc(pr.id)}')">Remove</button>
                    </div>` : ''}
                </div>
            `;
            listContainer.appendChild(card);
        });

        if (prayers.length === 0) {
            listContainer.innerHTML = `<div class="empty-state">🙏<span>Inbox zero — no pending prayer requests.</span></div>`;
        }

        this.renderBroadcasts();
    },

    renderBroadcasts() {
        const log = document.getElementById('broadcast-log');
        if (log) {
            const items = (this.db.announcements || []);
            log.innerHTML = items.map(a => {
                const audience = a.audience === 'all' ? 'All Campuses' : ((this.db.branches.find(b => b.id === a.audience) || {}).name || a.audience);
                const when = a.sentAt ? new Date(a.sentAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
                return `<div class="broadcast-item">
                    <div class="broadcast-item-head">
                        <strong>${esc(a.title)}</strong>
                        <span class="broadcast-when">${esc(when)}</span>
                    </div>
                    <p class="broadcast-body">${esc(a.body)}</p>
                    <div class="broadcast-tags">
                        <span class="broadcast-audience-pill">👥 ${esc(audience)}</span>
                        ${(a.channels || []).map(c => `<span class="broadcast-channel-pill">${c === 'email' ? '📧' : c === 'sms' ? '💬' : '🔔'} ${esc(c)}</span>`).join('')}
                        <span class="broadcast-reach">Delivered to ${esc(a.recipients)} members</span>
                        ${this.isAdmin() && (this.session.currentRole === 'hq_admin' || a.audience === this.session.currentBranch)
                            ? `<button type="button" class="action-btn-sm action-btn-danger" onclick="ChurchApp.removeAnnouncement('${esc(a.id)}')" aria-label="Remove ${esc(a.title)} from broadcast history">Remove from history</button>`
                            : ''}
                    </div>
                </div>`;
            }).join('') || '<p class="muted-italic" style="font-size:0.8rem;">No broadcasts sent yet.</p>';
        }

        const form = document.getElementById('broadcast-form');
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const title = document.getElementById('broadcast-title').value.trim();
                const body = document.getElementById('broadcast-body').value.trim();
                const audience = document.getElementById('broadcast-audience').value;
                const channels = [...document.querySelectorAll('.broadcast-channel:checked')].map(c => c.value);
                if (!title || !body) return;
                if (channels.length === 0) { this.toast('Pick at least one channel.', 'error'); return; }

                const recipients = audience === 'all'
                    ? this.db.members.length
                    : this.db.members.filter(m => m.branchId === audience).length;

                try {
                    const announcement = this.apiEnabled()
                        ? await Church2API.sendAnnouncement({ title, body, audience, channels })
                        : {
                            id: `an_${Date.now()}`,
                            title, body, audience, channels, recipients,
                            sentAt: new Date().toISOString()
                        };
                    this.db.announcements = this.db.announcements || [];
                    this.db.announcements.unshift(announcement);
                    this.saveDB();
                    form.reset();
                    document.querySelectorAll('.broadcast-channel').forEach(c => { c.checked = (c.value !== 'push'); });
                    this.renderBroadcasts();
                    this.toast(`📣 Broadcast sent to ${announcement.recipients} members via ${channels.join(', ')}.`);
                } catch (error) {
                    console.error('Broadcast save failed:', error);
                    this.toast(`Could not save this broadcast: ${error.message}`, 'error');
                }
            };
        }
    },

    approvePrayer(prId) {
        return this.deletePrayer(prId, true);
    },

    async deletePrayer(prId, approved = false) {
        if (!this.canManageMinistryItems()) {
            this.toast('You do not have permission to remove prayer requests.', 'error');
            return;
        }
        const prayer = (this.db.prayerRequests || []).find((item) => item.id === prId);
        if (!prayer) return;
        const confirmed = await this.confirmAction({
            title: `${approved ? 'Approve and remove' : 'Remove'} this prayer request?`,
            body: 'This request will be permanently removed from the active prayer inbox.',
            confirmLabel: approved ? 'Approve and remove' : 'Remove request',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.dismissPrayer(prId);
            this.db.prayerRequests = this.db.prayerRequests.filter((item) => item.id !== prId);
            this.saveDB();
            this.renderCommunications();
            this.toast(approved ? 'Prayer request approved and removed from the inbox.' : 'Prayer request removed.');
        } catch (error) {
            console.error('Prayer request removal failed:', error);
            this.toast(`Could not remove the prayer request: ${error.message}`, 'error');
        }
    },

    async removeAnnouncement(id) {
        if (!this.isAdmin()) {
            this.toast('Only an administrator can remove broadcasts from history.', 'error');
            return;
        }
        const announcement = (this.db.announcements || []).find((item) => item.id === id);
        if (!announcement) return;
        if (this.session.currentRole !== 'hq_admin' && announcement.audience !== this.session.currentBranch) {
            this.toast('You may only remove broadcasts sent to your campus.', 'error');
            return;
        }
        const confirmed = await this.confirmAction({
            title: `Remove "${announcement.title}" from history?`,
            body: 'This removes the broadcast record from the console. Messages already sent cannot be recalled.',
            confirmLabel: 'Remove from history',
        });
        if (!confirmed) return;
        try {
            if (this.apiEnabled()) await Church2API.removeAnnouncement(id);
            this.db.announcements = this.db.announcements.filter((item) => item.id !== id);
            this.saveDB();
            this.renderBroadcasts();
            this.toast('Broadcast removed from history.');
        } catch (error) {
            console.error('Broadcast removal failed:', error);
            this.toast(`Could not remove this broadcast: ${error.message}`, 'error');
        }
    },

    handleSermonRepurpose() {
        const title = document.getElementById('sermon-title-input').value.trim();
        const text = document.getElementById('sermon-notes-input').value.trim();

        if (!text) {
            this.toast('Please paste some sermon notes or transcript text first.', 'error');
            return;
        }

        const result = window.AIEngine.repurposeSermon(title, text);
        const resultsContainer = document.getElementById('ai-repurpose-results');
        
        resultsContainer.innerHTML = `
            <div class="repurposed-card animate-fade-in">
                <div class="ai-header-badge"><svg class="badge-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/><path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/></svg> AI REPURPOSED SERMON KIT</div>
                <h4 class="kit-title">${esc(result.title)}</h4>
                <hr class="kit-divider">

                <h5 class="kit-subhead">3-Day Devotional Study Guide</h5>
                <div class="kit-devotional md-body">
                    ${renderMarkdown(result.devotional.day1)}
                    ${renderMarkdown(result.devotional.day2)}
                    ${renderMarkdown(result.devotional.day3)}
                </div>

                <h5 class="kit-subhead">Social Media Highlights</h5>
                <ul class="kit-list">
                    ${result.socialQuotes.map(q => `<li>${mdInline(q)}</li>`).join('')}
                </ul>

                <h5 class="kit-subhead">Small Group Study Questions</h5>
                <ol class="kit-list">
                    ${result.discussionQuestions.map(q => `<li>${mdInline(q)}</li>`).join('')}
                </ol>
            </div>
        `;
    },

    // Non-blocking toast notification — replaces alert() for friendlier feedback.
    toast(message, type = 'success') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            container.setAttribute('aria-live', 'polite');
            container.setAttribute('role', 'status');
            document.body.appendChild(container);
        }
        const icon = type === 'error' ? '⚠️' : (type === 'info' ? 'ℹ️' : '✅');
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.innerHTML = `<span class="toast-icon">${icon}</span><span>${esc(message)}</span>`;
        container.appendChild(el);
        setTimeout(() => {
            el.classList.add('leaving');
            setTimeout(() => el.remove(), 280);
        }, 3600);
    },


};

// Start application.
//
// DOMContentLoaded, not window.onload: `load` waits for every subresource, so a
// slow webfont request held the whole app hostage — the console booted ~13s
// late even after the stylesheet was moved off the render path. Chart.js is
// loaded with `defer`, which guarantees it has executed by DOMContentLoaded, so
// nothing this needs is still outstanding at this point.
const bootChurchApp = () => {
    // Expose BEFORE init so inline handlers and window.ChurchApp stay valid even
    // if init() throws (e.g. a missing dependency mid-render).
    window.ChurchApp = ChurchApp;

    // Close modals on Escape and on backdrop click — expected dialog behavior.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            ChurchApp.closeAnyOpenModal();
            return;
        }
        if (e.key !== 'Tab') return;

        const openModals = [...document.querySelectorAll('.modal-overlay')]
            .filter((overlay) => overlay.style.display !== 'none' && getComputedStyle(overlay).display !== 'none');
        const modal = openModals[openModals.length - 1];
        if (!modal) return;
        const focusable = [...modal.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )].filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) {
            e.preventDefault();
            modal.querySelector('.modal-card')?.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) ChurchApp.closeModal(overlay.id);
        });
    });

    // The API client calls this when the server rejects our token — most often
    // because the account was signed in somewhere else.
    window.onChurch2SessionLost = (message) => ChurchApp.handleSessionLost(message);

    try {
        ChurchApp.init();
    } catch (err) {
        console.error('Church 2.0 failed to initialize:', err);
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootChurchApp, { once: true });
} else {
    // Script parsed after the document was already ready — boot immediately.
    bootChurchApp();
}
