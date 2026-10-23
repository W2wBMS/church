/**
 * Christian Mission Dunamis — brand configuration.
 *
 * This is the SINGLE place to change org identity, palette, currency and
 * campuses. Nothing else in the app hardcodes the client's name or colours;
 * the CSS reads the same palette from the tokens in styles.css :root.
 *
 * PALETTE NOTE: the hex values below are a considered match for CMD's
 * royal-blue-and-gold identity, set from public brand material. If the church
 * supplies exact brand hex codes, change them here and in the matching
 * `--mmc-*` tokens at the top of styles.css — nothing else needs to move.
 */
(function () {
    const Brand = {
        // ---- Identity -------------------------------------------------------
        name: 'Christian Mission Dunamis',
        shortName: 'CMD',
        tagline: 'DUNAMIS, POWER!',
        established: 2000,
        website: 'https://christianmissiondunamis.org',

        // ---- Palette (mirrors the --mmc-* tokens in styles.css) -------------
        palette: {
            royal: '#1d4ed8',
            royalLight: '#3b82f6',
            gold: '#f0b429',
            goldDeep: '#c8890f',
            success: '#10b981',
            danger: '#ef4444'
        },

        // ---- Money ----------------------------------------------------------
        // Ghana Cedis. Rendered as "₵ 12,500" — no decimals for whole
        // cedis, which is how Ghanaian churches actually report giving.
        currency: { code: 'GHS', symbol: '₵', locale: 'en-GH' },

        /** Format an amount as Ghana Cedis. */
        money(amount, opts) {
            const n = Number(amount) || 0;
            const decimals = (opts && opts.decimals !== undefined)
                ? opts.decimals
                : (Number.isInteger(n) ? 0 : 2);
            return `${this.currency.symbol} ${n.toLocaleString('en-GH', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            })}`;
        },

        /** Compact form for chart axes and tight stat cards: "₵ 1.2M". */
        moneyShort(amount) {
            const n = Number(amount) || 0;
            if (Math.abs(n) >= 1e6) return `${this.currency.symbol} ${(n / 1e6).toFixed(1)}M`;
            if (Math.abs(n) >= 1e3) return `${this.currency.symbol} ${(n / 1e3).toFixed(0)}K`;
            return `${this.currency.symbol} ${n}`;
        },

        // ---- Giving channels ------------------------------------------------
        // Bank Transfer and Mobile Money are the dominant giving rails in Ghana.
        // Update bank details and mobile money numbers when available.
        giving: {
            methods: ['Bank Transfer', 'Mobile Money', 'Cash', 'Card'],
            defaultMethod: 'Mobile Money',
            mobileMoney: { provider: 'MTN', number: '+233XXXXXXXXX', accountName: 'CMD', shortCodeConfirmed: false },
            // Mobile money and bank transfer charges should be verified with your
            // financial institution; card is the only rail with a percentage fee.
            fees: { mobileMoneyFlat: 0, cardPercent: 0.029, cardFlat: 0 }
        },

        // ---- Campuses -------------------------------------------------------
        // CMD branch locations. `id` values stay b1/b2/b3 so existing saved data
        // and the seeded database keep working.
        campuses: [
            { id: 'b1', name: 'Accra Main', code: 'ACC', hq: true,
              location: 'Accra, Ghana' },
            { id: 'b2', name: 'Kumasi Branch', code: 'KUM', hq: false,
              location: 'Kumasi, Ghana' },
            { id: 'b3', name: 'Takoradi Branch', code: 'TAK', hq: false,
              location: 'Takoradi, Ghana' }
        ],

        /** Campus display name for an id, with a safe fallback. */
        campusName(id) {
            const c = this.campuses.find((x) => x.id === id);
            return c ? c.name : '';
        },

        // ---- Service pattern -------------------------------------------------
        services: ['1st Service (7:00 AM)', '2nd Service (10:00 AM)', 'Midweek Service (Wed 5:30 PM)'],

        // ---- Ministries ------------------------------------------------------
        ministries: [
            'Worship & Music', 'Ushering', 'Intercession', 'Youth', 'Children',
            'Media & NURU TV', 'Outreach & Evangelism', 'Hospital & Home Care',
            'Family Life & Marriage', 'Children\'s Home'
        ]
    };

    window.CMD_BRAND = Brand;
    window.MMC_BRAND = Brand; // Legacy alias for compatibility
    // Short alias used throughout the app for money formatting.
    window.money = (amount, opts) => Brand.money(amount, opts);
})();
