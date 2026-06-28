// ─── CONSTANTS ─────────────────────────────────────────────────
const STORAGE_KEY = "bbTimeline_v5";
const ASSIGNEE_KEY = "bbAssignees";

// ─── SUPABASE CONFIGURATION ────────────────────────────────────
// The anon key is intentionally public — it is the credential for the
// shared team workspace.  It is NOT a secret.  The service role key
// must never appear here; it lives only in server-side code.
const SUPABASE_URL = "https://iqenyprolzxzwnbubuar.supabase.co";
const SUPABASE_ANON_KEY =
    "sb_publishable_s7P_E83Hu701PzDJoBE8aw_lDr5ruqS";

let supabaseClient = null;
let useCloudSync = true;

// ─── FAIL-SAFE SYNC UI HOOKS (prevent bootstrap crashes) ────────
// If older builds are missing these functions, provide safe
// fallbacks so sync bootstrap can't break rendering.
// Connection indicator UI removed from header.
// Keep this as a no-op fallback so sync bootstrap can't crash.
window.updateConnectionIndicator = window.updateConnectionIndicator || function () {};
if (typeof window.updateSyncStatus !== 'function') {
    window.updateSyncStatus = function () {
        // No-op (we already show toasts + heartbeat banner).
    };
}
if (typeof window.showOfflineBanner !== 'function') {
    window.showOfflineBanner = function (show) {
        const banner = document.getElementById('offline-banner');
        if (!banner) return;
        if (show) banner.classList.add('show');
        else banner.classList.remove('show');
    };
}

window.addEventListener('error', (ev) => {
    // Keep console visibility for debugging "page not showing".
    console.error('Uncaught error:', ev.error || ev.message);
});
window.addEventListener('unhandledrejection', (ev) => {
    console.error('Unhandled rejection:', ev.reason);
});

try {
    supabaseClient = supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
    );
    console.log("✓ Supabase initialized");

    // Initialize sync managers
    if (window.SyncSystem) {
        window.deviceManager = new window.SyncSystem.DeviceManager();
        window.conflictResolver = new window.SyncSystem.ConflictResolver('merge');
        window.syncQueue = new window.SyncSystem.SyncQueue();
        window.connectionMonitor = new window.SyncSystem.ConnectionMonitor(supabaseClient);
        window.notificationManager = new window.SyncSystem.NotificationManager();

        // Start connection monitoring
        window.connectionMonitor.startHeartbeat((status) => {
            try {
                window.updateConnectionIndicator?.(status);
                if (status.status === 'offline') {
                    window.notificationManager.offlineMode();
                    window.showOfflineBanner?.(true);
                } else if (status.status === 'connected') {
                    window.notificationManager.backOnline();
                    window.showOfflineBanner?.(false);
                }
            } catch (e) {
                console.error('Heartbeat callback failed:', e);
            }
        });

        console.log("✓ Sync system initialized");
    } else {
        console.warn("⚠ sync-config.js not loaded");
    }
} catch (e) {
    console.error("Supabase save failed:", e.message || e);
}

// ─── SYNC STATE ────────────────────────────────────────────────
// FIX: Track the timestamp of the last local write so realtime can
// suppress events that originated from this client (preventing loops).
let lastWriteTime = 0;
let saveDebounceTimer = null;
// FIX: Track deletes explicitly so upsert-only saves don't orphan rows.
let pendingDeleteOps = []; // [{id, type}]
// Periodic sync check as fallback for realtime
let periodicSyncInterval = null;
// Retry tracking for failed saves
let syncRetryCount = 0;
let syncRetryTimer = null;
const MAX_SYNC_RETRIES = 3;
const SYNC_RETRY_DELAY_MS = 2000;
// FIX: Track initial load completion to prevent sync overwrites during bootstrap
let initialLoadComplete = false;
const INITIAL_LOAD_GRACE_PERIOD_MS = 8000; // 8 second grace period after initial load

// Network connectivity monitoring
let isOnline = navigator.onLine;
let lastOnlineCheck = Date.now;

window.addEventListener('online', () => {
    if (!isOnline) {
        console.log('[Network] Connection restored');
        isOnline = true;
        // Trigger a sync when coming back online
        if (typeof useCloudSync !== 'undefined' && useCloudSync && supabaseClient) {
            console.log('[Network] Triggering sync after reconnection');
            if (typeof saveDebounceTimer !== 'undefined') {
                clearTimeout(saveDebounceTimer);
            }
            if (typeof saveToSupabase === 'function') {
                setTimeout(() => saveToSupabase(), 1000);
            }
        }
    }
});

window.addEventListener('offline', () => {
    if (isOnline) {
        console.log('[Network] Connection lost');
        isOnline = false;
        if (typeof setSyncState === 'function' && typeof SyncState !== 'undefined') {
            setSyncState(SyncState.OFFLINE);
        }
    }
});

// ─── ACTIVITY / TEAM DEFINITIONS ───────────────────────────────
const ACTIVITY_TYPES = [
    {
        id: "social",
        label: "Social",
        icon: "📱",
        cls: "type-social",
    },
    { id: "email", label: "Email", icon: "📧", cls: "type-email" },
    { id: "pr", label: "PR", icon: "📰", cls: "type-pr" },
    {
        id: "training",
        label: "Training",
        icon: "🏉",
        cls: "type-training",
    },
    {
        id: "digital",
        label: "Digital",
        icon: "💻",
        cls: "type-digital",
    },
    { id: "print", label: "Print", icon: "🖨️", cls: "type-print" },
    { id: "event", label: "Event", icon: "🎟️", cls: "type-event" },
    {
        id: "photo",
        label: "Photography",
        icon: "📷",
        cls: "type-photo",
    },
    {
        id: "interview",
        label: "Interview",
        icon: "🎙️",
        cls: "type-interview",
    },
    {
        id: "website",
        label: "Website",
        icon: "💻",
        cls: "type-website",
    },
    {
        id: "design",
        label: "Design",
        icon: "🎨",
        cls: "type-design",
    },
    { id: "other", label: "Other", icon: "📌", cls: "type-other" },
];

const TEAM_TYPES = [
    "Men's",
    "Women's",
    "Reserves",
    "Academy",
    "Scholarship",
    "Wheelchair",
    "PD/LDRL",
];

function teamInitials(name) {
    if (!name) return "?";
    return name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 3)
        .toUpperCase();
}

function shieldSVG(name) {
    // Create a dark grey shield icon as fallback
    const initials = teamInitials(name);
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
      <path d="M 50 10 L 10 30 L 10 55 Q 10 75 50 90 Q 90 75 90 55 L 90 30 Z" fill="#808080" stroke="#666" stroke-width="1"/>
      <text x="50" y="55" text-anchor="middle" dominant-baseline="middle" font-size="32" font-weight="bold" fill="#fff" font-family="Arial, sans-serif">${esc(initials)}</text>
    </svg>`;
}

// ═══════════════════════════════════════════════════════════════
// LOGO SYSTEM (FIX: robust fallback chain)
// ═══════════════════════════════════════════════════════════════
const LOGO_CACHE_KEY = "bbLogoCache_v2";
let logoCache = {};
try {
    logoCache = JSON.parse(
        localStorage.getItem(LOGO_CACHE_KEY) || "{}",
    );
} catch (e) {
    logoCache = {};
}
function saveLogoCache() {
    try {
        localStorage.setItem(
            LOGO_CACHE_KEY,
            JSON.stringify(logoCache),
        );
    } catch (e) {}
}

// CORS proxy to bypass Wikipedia image CORS restrictions
// Disabled for now - some Wikipedia URLs work without proxy
const CORS_PROXY = "";

// Helper function to add CORS proxy to Wikipedia URLs
function proxifyUrl(url) {
    if (!url) return url;
    // Only proxy Wikipedia URLs if CORS proxy is enabled
    if (CORS_PROXY && (url.includes('upload.wikimedia.org') || url.includes('wikipedia.org'))) {
        return CORS_PROXY + encodeURIComponent(url);
    }
    return url;
}

// Confirmed working URLs (verified via Wikipedia File API).
// All other clubs are resolved asynchronously by discoverLogoAsync.
const KNOWN_LOGOS = {
    "Bradford Bulls":
        "https://upload.wikimedia.org/wikipedia/en/1/1f/2025_Bradford_Bulls_Logo.png",
    "Leeds Rhinos":
        "https://upload.wikimedia.org/wikipedia/en/6/6f/Leeds_Rhinos_logo.svg",
    "Wigan Warriors":
        "https://upload.wikimedia.org/wikipedia/en/d/d7/Wigan_Warriors_Logo%2C_November_2020.svg",
};

// Lowercase-keyed map for fast, case-insensitive logo lookups
const KNOWN_LOGO_MAP = Object.fromEntries(
    Object.entries(KNOWN_LOGOS).map(([k, v]) => [
        k.toLowerCase().trim(),
        v,
    ]),
);

// Branded fallback used when a team's logo cannot be resolved/loaded
const TEAM_LOGO_FALLBACK =
    "https://bradfordbulls.co.uk/wp-content/themes/bradford-bulls/assets/images/team-placeholder.png";

// FIX: Render a proper SVG shield as the terminal fallback — never blank
function shieldSVG(name) {
    const initials = teamInitials(name);
    return `<svg viewBox="0 0 40 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M20 2 L36 8 L36 24 C36 33 20 42 20 42 C20 42 4 33 4 24 L4 8 Z"
        fill="#c9ced6" stroke="#8e97a3" stroke-width="1.5"/>
      <path d="M20 6 L32 10.5 L32 23 C32 29.6 20 37.2 20 37.2 C20 37.2 8 29.6 8 23 L8 10.5 Z"
        fill="#e8ebf0" opacity="0.92"/>
      <text x="20" y="27.5" text-anchor="middle" font-family="'Bebas Neue',sans-serif"
        font-size="13" fill="#626b76" letter-spacing="0.5">${initials}</text>
    </svg>`;
}

// Robust img fallback: shows shield on error AND triggers async re-discovery
function logoImgWithFallback(url, name) {
    const escaped = esc(name);
    return `<img
      src="${url}"
      alt="${escaped}"
      data-team="${escaped}"
      data-fallback="${TEAM_LOGO_FALLBACK}"
      onload="this.style.display='block';this.nextElementSibling&&(this.nextElementSibling.style.display='none')"
      onerror="if(this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}else{this.style.display='none';var fb=this.nextElementSibling;if(fb){fb.style.display='flex';}}"
    ><div class="logo-shield-wrap" style="display:none">${shieldSVG(name)}</div>`;
}

const logoLookupMemo = new Map();

// Clear memo cache on page load to ensure fresh lookups
logoLookupMemo.clear();

// Clear logo cache to force re-discovery of logos
logoCache = {};
saveLogoCache();

// Normalize team name variations to base team names for logo lookup
function normalizeTeamName(name) {
    if (!name) return name;
    
    const lower = name.toLowerCase().trim();
    
    // Map specific variations to their base team names
    const teamMappings = {
        'hull fc academy': 'hull fc',
        'oldham rlfc womens': 'oldham rlfc',
        'oldham rlfc women\'s': 'oldham rlfc',
        'wakefield trinity u16s': 'wakefield trinity',
        'wakefield trinity u16': 'wakefield trinity',
        'huddersfield giants u16s': 'huddersfield giants',
        'huddersfield giants u16': 'huddersfield giants',
        'manchester swinton lionesses': 'swinton lions',
        'swinton lionesses': 'swinton lions',
        'wigan warriors u16s': 'wigan warriors',
        'wigan warriors u16': 'wigan warriors',
        'leigh leopards academy': 'leigh leopards',
        'st helens academy': 'st helens',
        'warrington wolves womens': 'warrington wolves',
        'warrington wolves women\'s': 'warrington wolves',
    };
    
    // Check if the team name matches any mapping
    for (const [variant, base] of Object.entries(teamMappings)) {
        if (lower === variant) {
            return base;
        }
    }
    
    // Also check if the name contains a pattern like "U16s", "U16", "Academy", "Womens", etc.
    // and strip it to get the base team name
    const suffixPatterns = [
        /\s+(u\d+s?)$/i,           // U16s, U16, U18s, etc.
        /\s+academy$/i,             // Academy
        /\s+womens?$/i,             // Womens, Women's
        /\s+reserves$/i,           // Reserves
        /\s+scholarship$/i,        // Scholarship
        /\s+lionesses$/i,          // Lionesses
    ];
    
    for (const pattern of suffixPatterns) {
        const match = lower.match(pattern);
        if (match) {
            const baseName = lower.replace(pattern, '').trim();
            // Only use this if it's a known team or if we want to try discovery
            // For now, return the original name to avoid false positives
            // But we can add specific mappings for known teams
            if (baseName === 'hull fc' || 
                baseName === 'oldham rlfc' || 
                baseName === 'wakefield trinity' || 
                baseName === 'huddersfield giants' ||
                baseName === 'swinton lions' ||
                baseName === 'manchester swinton' ||
                baseName === 'wigan warriors' ||
                baseName === 'leigh leopards' ||
                baseName === 'st helens' ||
                baseName === 'sheffield eagles' ||
                baseName === 'oulton raidettes' ||
                baseName === 'warrington wolves' ||
                baseName === 'toulouse olympique xiii' ||
                baseName === 'toulouse olympique') {
                return baseName;
            }
        }
    }
    
    return name;
}

function getTeamLogo(name) {
    if (!name) return null;

    // Normalize the team name before lookup
    const normalizedName = normalizeTeamName(name);
    const lower = normalizedName.toLowerCase().trim();

    if (logoLookupMemo.has(lower)) {
        return logoLookupMemo.get(lower);
    }

    // Check KNOWN_LOGOS first (highest priority), then logoCache
    const knownLogo = KNOWN_LOGO_MAP[lower];
    const cachedLogo = logoCache[lower];
    const logo = knownLogo || cachedLogo;

    // Only memoize actual logo URLs, not null or "NOT_FOUND" values
    // This allows re-discovery if async logo lookup finds a logo later
    if (logo && logo !== "NOT_FOUND") {
        logoLookupMemo.set(lower, logo);
    }

    // Only trigger discovery if we don't have a logo and haven't already marked it as NOT_FOUND
    if (!logo && logoCache[lower] !== "NOT_FOUND") {
        discoverLogoAsync(normalizedName);
    }

    return logo && logo !== "NOT_FOUND" ? logo : null;
}
const brokenLogoUrls = new Set();

function handleLogoError(img) {
    const url = img.src;

    brokenLogoUrls.add(url);

    img.style.display = "none";

    const fallback = img.nextElementSibling;

    if (fallback) {
        fallback.style.display = "flex";
    }
}

const pendingDiscovery = new Set();

async function discoverLogoAsync(name) {
    const lower = name.toLowerCase().trim();
    if (pendingDiscovery.has(lower)) return;
    pendingDiscovery.add(lower);

    // ── Strategy 1: Search Wikipedia File namespace directly ──────────
    // This is far more reliable than pageimages (which returns article
    // featured images, not logos).
    const fileQueries = [
        `${name} logo`,
        `${name} RLFC logo`,
        `${name} rugby league logo`,
    ];
    const firstWord = lower.split(" ")[0];

    for (const query of fileQueries) {
        try {
            const searchRes = await fetch(
                `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=5&format=json&origin=*`,
            );
            const searchData = await searchRes.json();
            const files = searchData.query?.search || [];

            for (const file of files) {
                const tl = file.title.toLowerCase();
                if (!tl.includes(firstWord)) continue;
                const isLogoFile =
                    tl.includes("logo") ||
                    tl.includes("badge") ||
                    tl.includes("crest");
                const isPhoto =
                    tl.includes("stadium") ||
                    tl.includes("ground") ||
                    tl.includes("portrait") ||
                    tl.includes("player");
                if (!isLogoFile || isPhoto) continue;

                const imgRes = await fetch(
                    `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(file.title)}&prop=imageinfo&iiprop=url&format=json&origin=*`,
                );
                const imgData = await imgRes.json();
                const pages = Object.values(
                    imgData.query?.pages || {},
                );
                const imageUrl = pages[0]?.imageinfo?.[0]?.url;
                if (imageUrl && !pages[0].missing) {
                    logoCache[lower] = imageUrl;
                    saveLogoCache();
                    logoLookupMemo.delete(lower);
                    updateLogoInDOM(name, imageUrl);
                    pendingDiscovery.delete(lower);
                    return;
                }
            }
        } catch (e) {
            /* network error — silent */
        }
    }

    // ── Strategy 2: Fallback to pageimages API ───────────────────────
    const articleQueries = [
        `${name} rugby league`,
        `${name} RLFC`,
        name,
    ];
    for (const query of articleQueries) {
        try {
            const searchRes = await fetch(
                `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&format=json&origin=*`,
            );
            const searchData = await searchRes.json();
            const titles = searchData[1] || [];
            for (const title of titles) {
                if (!title.toLowerCase().includes(firstWord))
                    continue;
                const imgRes = await fetch(
                    `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&pithumbsize=200&format=json&origin=*`,
                );
                const imgData = await imgRes.json();
                const pages = Object.values(
                    imgData.query?.pages || {},
                );
                const thumb = pages[0]?.thumbnail?.source;
                if (thumb) {
                    const tl = thumb.toLowerCase();
                    const isLogo =
                        tl.includes("logo") ||
                        tl.includes("badge") ||
                        tl.includes("crest") ||
                        tl.includes(".svg");
                    const isPhoto =
                        tl.includes("stadium") ||
                        tl.includes("ground") ||
                        tl.includes("portrait") ||
                        tl.includes("player");
                    if (isLogo && !isPhoto) {
                        logoCache[lower] = thumb;
                        saveLogoCache();
                        logoLookupMemo.delete(lower);
                        updateLogoInDOM(name, thumb);
                        pendingDiscovery.delete(lower);
                        return;
                    }
                }
            }
        } catch (e) {
            /* network error — silent */
        }
    }

    logoCache[lower] = "NOT_FOUND";
    saveLogoCache();
    pendingDiscovery.delete(lower);
}

function updateLogoInDOM(name, url) {
    // Normalize the name for consistent cache key usage
    const normalizedName = normalizeTeamName(name);
    const lower = normalizedName.toLowerCase().trim();
    
    // Invalidate memo so the corrected URL is used on the next render()
    logoLookupMemo.delete(lower);
    
    document
        .querySelectorAll(".fixture-logo-wrap")
        .forEach((wrap) => {
            const card = wrap.closest(".fixture-card");
            const opponent = card
                ?.querySelector(".fixture-opponent")
                ?.textContent?.trim();
            
            if (!opponent) return;
            
            // Normalize the opponent name for comparison
            const normalizedOpponent = normalizeTeamName(opponent).toLowerCase().trim();
            
            // Compare normalized names to handle variations like "Hull FC Academy" vs "Hull FC"
            if (normalizedOpponent !== lower) return;
            
            wrap.innerHTML = logoImgWithFallback(url, opponent);
        });
}

let syncState = SyncState.CONNECTING;
let syncBannerHideTimer = null;

function setSyncState(state) {
    syncState = state;

    const banner = document.getElementById("sync-banner");
    const text = document.getElementById("sync-banner-text");

    if (!banner || !text) return;

    clearTimeout(syncBannerHideTimer);
    syncBannerHideTimer = null;

    banner.classList.add("show");
    banner.classList.remove("connected", "offline");

    switch (state) {
        case SyncState.CONNECTING:
            text.textContent = "Connecting to cloud…";
            break;

        case SyncState.OFFLINE:
            text.textContent = "Offline — changes stored locally";
            banner.classList.add("offline");
            break;

        case SyncState.CONNECTED:
            text.textContent = "✓ Cloud sync active";
            banner.classList.add("connected");
            syncBannerHideTimer = setTimeout(() => {
                if (syncState === SyncState.CONNECTED) {
                    banner.classList.remove(
                        "show",
                        "connected",
                        "offline",
                    );
                }
            }, 2500);
            break;
    }
}

setSyncState(SyncState.CONNECTING);

// ─── SUPABASE RECORD CONVERTER ─────────────────────────────────
// FIX: Centralised converter used by both loadFromSupabase and the
// realtime handler, ensuring consistent mapping in both code paths.
function convertSupabaseRecord(record, itemType) {
    if (!record) return null;
    try {
        switch (itemType) {
            case "fixture":
                return {
                    id: record.id,
                    type: "fixture",
                    date: (record.date || "").split("T")[0],
                    opponent: record.opponent || "",
                    venue: record.venue || "",
                    venueType: record.venue_type || "home",
                    matchType: record.match_type || "League",
                    teamType: record.team_type || "Men's",
                    assignees: [],
                    _deviceId: record._device_id || null,
                    _lastModified: record._last_modified || null,
                };
            case "activity":
                return {
                    id: record.id,
                    type: "activity",
                    date: (record.date || "").split("T")[0],
                    title: record.title || "",
                    actType: record.type || "other",
                    assignees: Array.isArray(record.assignees)
                        ? record.assignees
                        : [],
                    notes: record.notes || "",
                    complete: record.completed || false,
                    fixtureId: record.fixture_id || null,
                    linkedFixtureId: Array.isArray(record.linked_fixture_id)
                        ? record.linked_fixture_id
                        : (record.linked_fixture_id ? [record.linked_fixture_id] : []),
                    clusterOrder: record.cluster_order || 0,
                    _deviceId: record._device_id || null,
                    _lastModified: record._last_modified || null,
                };
            case "milestone":
                return {
                    id: record.id,
                    type: "milestone",
                    date: (record.date || "").split("T")[0],
                    title: record.title || "",
                    style: record.color || "red",
                    notes: record.notes || "",
                    assignees: [],
                    _deviceId: record._device_id || null,
                    _lastModified: record._last_modified || null,
                };
            case "note":
                return {
                    id: record.id,
                    type: "note",
                    date: (record.date || "").split("T")[0],
                    content: record.content || "",
                    assignees: [],
                    _deviceId: record._device_id || null,
                    _lastModified: record._last_modified || null,
                };
            default:
                return null;
        }
    } catch (e) {
        console.error("Supabase save failed:", e.message || e);
    }
}
// ─── AUTH ─────────────────────────────────────────────────────────────────────
// Password is never stored in plain text — only its SHA-256 hash lives here.
// Replace the string below with the hash you generated in Step 2.
const PASSWORD_HASH =
    "a568a40f9f6913d1acc69b86999c55b44913da2740390a87b52cac3d37db5272";

// Session lasts 30 days from last successful login.
const SESSION_KEY = "bbTimeline_auth";
const SESSION_DAYS = 30;

async function sha256(str) {
    const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(str),
    );
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function hasValidSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return false;
        const { expiry } = JSON.parse(raw);
        return Date.now() < expiry;
    } catch (e) {
        return false;
    }
}

function writeSession() {
    const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ expiry }));
}

function initAuth() {
    if (hasValidSession()) {
        dismissAuthGate();
        return;
    }
    document.getElementById("auth-gate").style.display = "flex";
    // Focus the password field automatically
    setTimeout(
        () => document.getElementById("auth-password")?.focus(),
        50,
    );
}

function dismissAuthGate() {
    const gate = document.getElementById("auth-gate");
    if (gate) gate.style.display = "none";
    load();
    setupRealtime();
    startPeriodicSync();
}

async function submitPassword() {
    const input = document.getElementById("auth-password");
    const errorEl = document.getElementById("auth-error");
    const entered = (input.value || "").trim();

    if (!entered) {
        errorEl.textContent = "Please enter the password.";
        return;
    }

    const hash = await sha256(entered);

    if (hash === PASSWORD_HASH) {
        writeSession(); // Saves 30-day session to localStorage
        input.value = "";
        dismissAuthGate();
    } else {
        errorEl.textContent = "Incorrect password.";
        input.value = "";
        input.focus();
        // Brief red border shake for feedback
        input.style.borderColor = "var(--red)";
        input.style.animation = "none";
        setTimeout(() => {
            input.style.borderColor = "var(--line)";
        }, 1200);
    }
}
// ─── LOAD FROM SUPABASE ────────────────────────────────────────
// FIX: Now orders by `date` (the canonical column) instead of
// `kickoff_at` which may not exist on all installs.
async function loadFromSupabase() {
    if (!supabaseClient || !useCloudSync) return null;
    try {
        const [
            fixturesRes,
            activitiesRes,
            milestonesRes,
            notesRes,
            savedAssigneesRes,
        ] = await Promise.all([
            supabaseClient
                .from("fixtures")
                .select("*")
                .order("date", { ascending: true }),
            supabaseClient
                .from("activities")
                .select("*")
                .order("date", { ascending: true }),
            supabaseClient
                .from("milestones")
                .select("*")
                .order("date", { ascending: true }),
            supabaseClient
                .from("notes")
                .select("*")
                .order("date", { ascending: true }),
            supabaseClient.from("saved_assignees").select("name"),
        ]);

        if (fixturesRes.error) throw fixturesRes.error;
        if (activitiesRes.error) throw activitiesRes.error;
        if (milestonesRes.error) throw milestonesRes.error;
        if (notesRes.error) throw notesRes.error;
        if (savedAssigneesRes.error) throw savedAssigneesRes.error;

        const items = [
            ...(fixturesRes.data || []).map((r) =>
                convertSupabaseRecord(r, "fixture"),
            ),
            ...(activitiesRes.data || []).map((r) =>
                convertSupabaseRecord(r, "activity"),
            ),
            ...(milestonesRes.data || []).map((r) =>
                convertSupabaseRecord(r, "milestone"),
            ),
            ...(notesRes.data || []).map((r) =>
                convertSupabaseRecord(r, "note"),
            ),
        ].filter(Boolean);

        const savedAssignees = (savedAssigneesRes.data || []).map(
            (r) => r.name,
        );

        return { items, savedAssignees };
    } catch (e) {
        console.error("loadFromSupabase failed:", e.message || e);
        return null;
    }
}

// ─── SAVE TO SUPABASE ──────────────────────────────────────────
// FIX: Replaced delete-all + re-insert with upsert + explicit deletes.
//   - No more `season_id` FK injection.
//   - `lastWriteTime` stamp prevents the realtime handler from echoing
//     our own saves back as remote changes (self-event suppression).
//   - Pending deletes are processed first to respect FK ordering.
async function saveToSupabase() {
    if (!supabaseClient || !useCloudSync) {
        console.log(`[Sync] Skipping sync - supabaseClient: ${!!supabaseClient}, useCloudSync: ${useCloudSync}`);
        return;
    }

    if (!isOnline) {
        console.log('[Sync] Skipping sync - offline');
        setSyncState(SyncState.OFFLINE);
        return;
    }

    // Ensure device ID is available for proper self-event suppression
    if (!window.deviceManager?.deviceId) {
        console.warn('[Sync] Device ID not available, skipping sync to prevent self-event suppression failure');
        // Retry after a short delay
        setTimeout(() => {
            if (window.deviceManager?.deviceId) {
                console.log('[Sync] Device ID now available, retrying sync');
                saveToSupabase();
            }
        }, 500);
        return;
    }

    const syncStartTime = Date.now();
    lastWriteTime = Date.now();
    console.log(`[Sync] Starting save at ${new Date(syncStartTime).toISOString()}`);

    try {
        // Process explicit deletes first (FK order: activities before fixtures)
        // This ensures we don't violate foreign key constraints when deleting fixtures
        const actDeletes = pendingDeleteOps.filter(
            (d) => d.type === "activity",
        );
        const fixDeletes = pendingDeleteOps.filter(
            (d) => d.type === "fixture",
        );
        const milDeletes = pendingDeleteOps.filter(
            (d) => d.type === "milestone",
        );
        const noteDeletes = pendingDeleteOps.filter(
            (d) => d.type === "note",
        );

        // Process deletes in FK-safe order: activities → fixtures → milestones → notes
        for (const d of [
            ...actDeletes,
            ...fixDeletes,
            ...milDeletes,
            ...noteDeletes,
        ]) {
            const table =
                d.type === "fixture"
                    ? "fixtures"
                    : d.type === "activity"
                      ? "activities"
                      : d.type === "milestone"
                        ? "milestones"
                        : "notes";
            
            // Cascade: if deleting a fixture, unlink all activities that reference it
            if (d.type === "fixture") {
                const { error: unlinkError } = await supabaseClient
                    .from("activities")
                    .update({ fixture_id: null, linked_fixture_id: null })
                    .or(`fixture_id.eq.${d.id},linked_fixture_id.eq.${d.id}`);
                if (unlinkError) {
                    console.error(
                        `Unlink activities for fixture ${d.id} failed:`,
                        JSON.stringify(unlinkError),
                    );
                    // Don't throw - continue with the delete
                }
            }
            
            const { error } = await supabaseClient
                .from(table)
                .delete()
                .eq("id", d.id);
            if (error) {
                console.error(
                    `Delete ${table} ${d.id} failed:`,
                    JSON.stringify(error),
                );
                throw new Error(`Failed to delete ${table} ${d.id}: ${JSON.stringify(error)}`);
            }
        }
        pendingDeleteOps = [];

        // Upsert all surviving items by type
        const fixtures = S.items.filter(
            (i) => i.type === "fixture",
        );
        const activities = S.items.filter(
            (i) => i.type === "activity",
        );
        const milestones = S.items.filter(
            (i) => i.type === "milestone",
        );
        const notes = S.items.filter((i) => i.type === "note");

        if (fixtures.length) {
            const { error } = await supabaseClient
                .from("fixtures")
                .upsert(
                    fixtures.map((f) => ({
                        id: f.id,
                        opponent: f.opponent || "",
                        date: f.date,
                        match_type: f.matchType || "League",
                        team_type: f.teamType || "Men's",
                        venue: f.venue || "",
                        venue_type: f.venueType || "home",
                        _device_id: window.deviceManager?.deviceId || null,
                        _last_modified: f._lastModified || Date.now(),
                    })),
                    { onConflict: "id" },
                );
            if (error) throw new Error(JSON.stringify(error));
        }

        if (activities.length) {
            const { error } = await supabaseClient
                .from("activities")
                .upsert(
                    activities.map((a) => {
                        return {
                            id: a.id,
                            title: a.title || "",
                            type: a.actType || "other",
                            date: a.date,
                            completed: a.complete || false,
                            assignees: a.assignees || [],
                            notes: a.notes || "",
                            fixture_id: a.fixtureId || null,
                            linked_fixture_id:
                                a.linkedFixtureId || [],
                            cluster_order: a.clusterOrder || 0,
                            _device_id: window.deviceManager?.deviceId || null,
                            _last_modified: a._lastModified || Date.now(),
                        };
                    }),
                    { onConflict: "id" },
                );
            if (error) {
                console.error(
                    "Activities upsert error:",
                    JSON.stringify(error),
                );
                throw new Error(JSON.stringify(error));
            }
        }

        if (milestones.length) {
            const { error } = await supabaseClient
                .from("milestones")
                .upsert(
                    milestones.map((m) => ({
                        id: m.id,
                        title: m.title || "",
                        color: m.style || "red",
                        date: m.date,
                        notes: m.notes || "",
                        _device_id: window.deviceManager?.deviceId || null,
                        _last_modified: m._lastModified || Date.now(),
                    })),
                    { onConflict: "id" },
                );
            if (error) {
                console.error(
                    "Milestones error:",
                    JSON.stringify(error),
                );
                throw new Error(JSON.stringify(error));
            }
        }

        if (notes.length) {
            const { error } = await supabaseClient
                .from("notes")
                .upsert(
                    notes.map((n) => ({
                        id: n.id,
                        content: n.content || "",
                        date: n.date,
                        _device_id: window.deviceManager?.deviceId || null,
                        _last_modified: n._lastModified || Date.now(),
                    })),
                    { onConflict: "id" },
                );
            if (error) {
                console.error(
                    "Notes error:",
                    JSON.stringify(error),
                );
                throw new Error(JSON.stringify(error));
            }
        }

        // Sync saved assignees - local state is authoritative
        // Use local savedAssignees as the source of truth, don't merge with remote
        if (S.savedAssignees) {
            // Delete all remote assignees
            const { error: deleteError } = await supabaseClient
                .from("saved_assignees")
                .delete()
                .neq("id", "00000000-0000-0000-0000-000000000000");

            if (deleteError) {
                console.error(
                    "Saved assignees delete error:",
                    JSON.stringify(deleteError),
                );
                throw new Error(`Failed to delete saved assignees: ${JSON.stringify(deleteError)}`);
            }

            // Insert local assignees
            if (S.savedAssignees.length > 0) {
                const { error: insertError } = await supabaseClient
                    .from("saved_assignees")
                    .insert(S.savedAssignees.map((name) => ({ name })));

                if (insertError) {
                    console.error(
                        "Saved assignees insert error:",
                        JSON.stringify(insertError),
                    );
                    throw new Error(`Failed to insert saved assignees: ${JSON.stringify(insertError)}`);
                }
            }
        }

        const syncDuration = Date.now() - syncStartTime;
        console.log(`[Sync] ✓ Completed in ${syncDuration}ms`);
        syncRetryCount = 0; // Reset retry count on success
        if (window.notificationManager) {
            window.notificationManager.syncSuccess();
        }
        showToast("✓ Synced to cloud", "success", 2000);
        updateSyncStatus();
    } catch (e) {
        const syncDuration = Date.now() - syncStartTime;
        console.error(`[Sync] ✗ Failed after ${syncDuration}ms:`, e);
        console.error("[Sync] Error details:", {
            message: e.message,
            stack: e.stack,
            itemsCount: S.items.length,
            hasClient: !!supabaseClient,
            useCloudSync,
            retryCount: syncRetryCount,
        });
        
        // Retry logic for transient failures
        if (syncRetryCount < MAX_SYNC_RETRIES) {
            syncRetryCount++;
            const retryDelay = SYNC_RETRY_DELAY_MS * Math.pow(2, syncRetryCount - 1);
            console.log(`[Sync] Retrying in ${retryDelay}ms (attempt ${syncRetryCount}/${MAX_SYNC_RETRIES})`);
            
            clearTimeout(syncRetryTimer);
            syncRetryTimer = setTimeout(() => {
                console.log(`[Sync] Executing retry ${syncRetryCount}`);
                saveToSupabase();
            }, retryDelay);
            
            showToast(`⚠ Sync failed, retrying... (${syncRetryCount}/${MAX_SYNC_RETRIES})`, "warning", 3000);
        } else {
            console.error("[Sync] Max retries exceeded, giving up");
            syncRetryCount = 0;
            if (window.notificationManager) {
                window.notificationManager.syncFailed(e.message || "Network error");
            }
            showToast("⚠ Cloud save failed — data kept locally", "error", 5000);
        }
    }
}

// ─── REALTIME ─────────────────────────────────────────────────
// FIX: Extracted to a named function so it can be called once at
// bootstrap and easily cleaned up. Incremental state merge instead
// of full reload. Self-event suppression via lastWriteTime.
let realtimeChannel = null;

function setupRealtime() {
    if (!supabaseClient || !useCloudSync) return;

    console.log("Setting up realtime subscription...");

    realtimeChannel = supabaseClient
        .channel("timeline_changes")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "fixtures" },
            (p) => {
                console.log("Realtime event: fixtures", p);
                handleRealtimeEvent(p, "fixture");
            },
        )
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "activities" },
            (p) => {
                console.log("Realtime event: activities", p);
                handleRealtimeEvent(p, "activity");
            },
        )
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "milestones" },
            (p) => {
                console.log("Realtime event: milestones", p);
                handleRealtimeEvent(p, "milestone");
            },
        )
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "notes" },
            (p) => {
                console.log("Realtime event: notes", p);
                handleRealtimeEvent(p, "note");
            },
        )
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "saved_assignees" },
            (p) => {
                console.log("Realtime event: saved_assignees", p);
                handleAssigneesRealtimeEvent(p);
            },
        )
        .subscribe((status, err) => {
            console.log(`[Realtime] Status: ${status}`, err ? `Error: ${err}` : "");
            if (status === "SUBSCRIBED") {
                console.log("✓ Realtime subscription active");
                setSyncState(SyncState.CONNECTED);
            } else if (status === "CHANNEL_ERROR") {
                console.error("✗ Realtime channel error:", err);
                setSyncState(SyncState.ERROR);
                // Attempt to reconnect after 5 seconds
                setTimeout(() => {
                    console.log("[Realtime] Attempting to reconnect...");
                    setupRealtime();
                }, 5000);
            } else if (status === "TIMED_OUT") {
                console.error("✗ Realtime subscription timed out");
                setSyncState(SyncState.ERROR);
                // Attempt to reconnect after 5 seconds
                setTimeout(() => {
                    console.log("[Realtime] Attempting to reconnect after timeout...");
                    setupRealtime();
                }, 5000);
            } else if (status === "CLOSED") {
                console.warn("[Realtime] Connection closed");
                setSyncState(SyncState.OFFLINE);
            }
            updateSyncStatus();
        });
}

// FIX: Incremental state merge on realtime events.
// Self-events (within 1 s of a local write) are discarded to prevent
// the save → realtime → reload → save loop.
// Enhanced: Detects conflicts and resolves using conflict resolver.
// FIX: Only suppress events from THIS device by checking _device_id, not just time window
function handleRealtimeEvent(payload, itemType) {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    // Only suppress events that came from THIS device (check _device_id)
    const remoteDeviceId = newRecord?._device_id || oldRecord?._device_id;
    const myDeviceId = window.deviceManager?.deviceId;
    
    // Suppress if it's from our device AND within the time window
    if (remoteDeviceId === myDeviceId && Date.now() - lastWriteTime < 5000) {
        console.log(`[Realtime] Suppressing self-event from device ${myDeviceId}`);
        return;
    }

    if (eventType === "DELETE") {
        const deletedId = oldRecord && oldRecord.id;
        if (deletedId) {
            S.items = S.items.filter((i) => i.id !== deletedId);
            saveToLocal();
            render();
            showSyncToast("🔄 Remote: item removed");
        }
        return;
    }

    // INSERT or UPDATE
    const converted = convertSupabaseRecord(newRecord, itemType);
    if (!converted) return;

    const idx = S.items.findIndex((i) => i.id === converted.id);
    let finalItem = converted;

    // Check for conflicts if item exists locally
    if (idx >= 0) {
        const localItem = S.items[idx];
        
        // Use conflict resolver if available
        if (window.conflictResolver) {
            const conflict = window.conflictResolver.detectConflict(localItem, converted);
            if (conflict) {
                const resolution = window.conflictResolver.resolve(conflict);
                finalItem = resolution.merged;
                if (window.notificationManager) {
                    window.notificationManager.conflictDetected(conflict);
                }
                showSyncToast("⚠ Conflict resolved (merged)", "warning");
            }
        }
        S.items[idx] = finalItem;
    } else {
        S.items.push(finalItem);
    }

    saveToLocal();
    render();
    if (idx < 0) showSyncToast("🔄 Remote: item added");
    else if (idx >= 0 && !window.conflictResolver) showSyncToast("🔄 Remote: item updated");
}

// Handle saved_assignees realtime events
function handleAssigneesRealtimeEvent(payload) {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    // Only suppress events that came from THIS device (check _device_id)
    const remoteDeviceId = newRecord?._device_id || oldRecord?._device_id;
    const myDeviceId = window.deviceManager?.deviceId;
    
    // Suppress if it's from our device AND within the time window
    if (remoteDeviceId === myDeviceId && Date.now() - lastWriteTime < 5000) {
        console.log(`[Realtime] Suppressing assignees self-event from device ${myDeviceId}`);
        return;
    }

    // For saved_assignees, we reload the full list since it's a simple list
    // This ensures we stay in sync with the complete set of assignees
    loadFromSupabase().then(data => {
        if (data && data.savedAssignees) {
            S.savedAssignees = data.savedAssignees;
            saveToLocal();
            render();
            showSyncToast("🔄 Remote: assignees updated");
        }
    }).catch(e => {
        console.error("Failed to sync assignees:", e);
    });
}

// Periodic sync check as fallback for realtime
async function periodicSyncCheck() {
    if (!supabaseClient || !useCloudSync) return;

    // Skip if initial load is not complete or within grace period
    if (!initialLoadComplete) {
        console.log("[Sync] Skipping periodic sync - initial load not complete");
        return;
    }
    
    // Skip if we recently wrote (to avoid conflicts)
    if (Date.now() - lastWriteTime < 5000) return;

    try {
        const data = await loadFromSupabase();
        if (data && data.items) {
            // Check if there are any differences
            const localIds = new Set(S.items.map(i => i.id));
            const remoteIds = new Set(data.items.map(i => i.id));

            // Check for new or updated items
            let hasChanges = false;
            for (const remoteItem of data.items) {
                const localItem = S.items.find(i => i.id === remoteItem.id);
                if (!localItem) {
                    hasChanges = true;
                    break;
                }
                // Simple comparison - check if key fields differ
                if (JSON.stringify(localItem) !== JSON.stringify(remoteItem)) {
                    hasChanges = true;
                    break;
                }
            }

            // Check for deleted items
            for (const localId of localIds) {
                if (!remoteIds.has(localId)) {
                    hasChanges = true;
                    break;
                }
            }

            if (hasChanges) {
                console.log("Periodic sync detected changes, reloading...");
                S.items = data.items;
                if (data.savedAssignees && data.savedAssignees.length > 0) {
                    S.savedAssignees = data.savedAssignees;
                }
                saveToLocal();
                render();
                showSyncToast("🔄 Synced from cloud", "success", 2000);
            }
        }
    } catch (e) {
        console.error("Periodic sync check failed:", e);
    }
}

// Manual sync trigger for debugging
window.forceSync = async function() {
    console.log("[Sync] Manual sync triggered");
    syncRetryCount = 0;
    clearTimeout(saveDebounceTimer);
    clearTimeout(syncRetryTimer);
    await saveToSupabase();
};

// Get sync status for debugging
window.getSyncStatus = function() {
    return {
        lastWriteTime,
        saveDebounceTimer: !!saveDebounceTimer,
        syncRetryCount,
        syncRetryTimer: !!syncRetryTimer,
        useCloudSync,
        hasClient: !!supabaseClient,
        realtimeChannel: !!realtimeChannel,
        itemsCount: S.items.length,
    };
};

// Start periodic sync check
function startPeriodicSync() {
    if (periodicSyncInterval) clearInterval(periodicSyncInterval);
    // Check every 30 seconds
    periodicSyncInterval = setInterval(periodicSyncCheck, 30000);
    console.log("✓ Periodic sync check started (30s interval)");
}

// Stop periodic sync check
function stopPeriodicSync() {
    if (periodicSyncInterval) {
        clearInterval(periodicSyncInterval);
        periodicSyncInterval = null;
        console.log("✓ Periodic sync check stopped");
    }
}

// ─── STATE ─────────────────────────────────────────────────────
let S = { items: [], savedAssignees: [] };
let currentModal = null;
let dragActivityId = null;
let isDraggingActivity = false;
let dragEndTime = 0;
let disableToggle = false;

// ─── USER FILTER STATE ────────────────────────────────────────────────────
let filterUsers = new Set(); // names of currently-selected assignees

// ─── USER FILTER HELPERS ──────────────────────────────────────────────────

/** Union of savedAssignees + every assignee on any item. */
function getAllAssignees() {
    const set = new Set(S.savedAssignees || []);
    S.items.forEach(item => (item.assignees || []).forEach(a => set.add(a)));
    return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Returns S.items filtered by the active user selection.
 * Fixtures, milestones, and notes are always included so the timeline
 * keeps its structural shape; only standalone/cluster activities are gated.
 */
function getFilteredItems() {
    if (filterUsers.size === 0) return S.items;
    return S.items.filter(item => {
        if (item.type !== 'activity') return true;
        return (item.assignees || []).some(a => filterUsers.has(a));
    });
}

/** Compact label for the trigger button. */
function getUserFilterLabel() {
    if (filterUsers.size === 0) return 'All Activity';
    const users = [...filterUsers];
    // Use first name only to keep the button tight
    const firstName = n => n.split(' ')[0];
    if (users.length === 1) return firstName(users[0]);
    if (users.length === 2) return `${firstName(users[0])} + ${firstName(users[1])}`;
    return `${firstName(users[0])} + ${users.length - 1}`;
}

/** Sync button label and active styling. */
function updateUserFilterLabel() {
    const label = document.getElementById('user-filter-label');
    const btn   = document.getElementById('user-filter-btn');
    if (!label || !btn) return;
    label.textContent = getUserFilterLabel();
    btn.classList.toggle('active', filterUsers.size > 0);
}

// ─── FILTER DROPDOWN OPEN / CLOSE ─────────────────────────────────────────

function toggleUserFilter(e) {
    e.stopPropagation();
    const isMobile = window.innerWidth <= 700;
    const wrap = document.getElementById('user-filter-wrap');
    const row = document.querySelector('.brand-sub-row');

    if (isMobile) {
        if (row.classList.contains('uf-open')) {
            closeUserFilter();
        } else {
            openUserFilter();
        }
    } else {
        if (wrap.classList.contains('uf-open')) {
            closeUserFilter();
        } else {
            openUserFilter();
        }
    }
}

function openUserFilter() {
    const isMobile = window.innerWidth <= 700;
    if (isMobile) {
        document.querySelector('.brand-sub-row')?.classList.add('uf-open');
    } else {
        document.getElementById('user-filter-wrap')?.classList.add('uf-open');
    }
    renderUserFilterDropdown('');
    setTimeout(() => document.getElementById('uf-search')?.focus(), 40);
}

function closeUserFilter() {
    document.getElementById('user-filter-wrap')?.classList.remove('uf-open');
    document.querySelector('.brand-sub-row')?.classList.remove('uf-open');
}

// ─── DROPDOWN RENDERER ────────────────────────────────────────────────────

function renderUserFilterDropdown(query) {
    const dropdown = document.getElementById('user-filter-dropdown');
    if (!dropdown) return;

    const q        = (query || '').trim().toLowerCase();
    const allUsers = getAllAssignees();
    const shown    = q ? allUsers.filter(u => u.toLowerCase().includes(q)) : allUsers;

    const allSelected  = allUsers.length > 0 && allUsers.every(u => filterUsers.has(u));
    const someSelected = !allSelected && allUsers.some(u => filterUsers.has(u));

    // ── Search ────────────────────────────────────────────────────────────
    const searchHtml = `
      <div class="uf-search-wrap">
        <input
          class="uf-search"
          id="uf-search"
          placeholder="Search users…"
          value="${esc(query || '')}"
          oninput="renderUserFilterDropdown(this.value)"
          onkeydown="handleUfKeydown(event)"
          autocomplete="off"
        >
      </div>`;

    // ── Options ───────────────────────────────────────────────────────────
    let optionsHtml = '';
    if (allUsers.length === 0) {
        optionsHtml = '<div class="uf-empty">No team members yet</div>';
    } else {
        const selAllCls = allSelected ? 'checked' : (someSelected ? 'partial' : '');
        optionsHtml += `
          <div class="uf-option uf-select-all" onclick="toggleSelectAllUsers()">
            <div class="uf-checkbox ${selAllCls}"></div>
            <span class="uf-option-name">Select All</span>
          </div>`;

        if (shown.length === 0) {
            optionsHtml += '<div class="uf-empty">No results</div>';
        } else {
            shown.forEach(user => {
                const checked  = filterUsers.has(user);
                const safeName = esc(user);
                // Use data-user attribute to avoid quoting issues in onclick
                optionsHtml += `
                  <div class="uf-option" data-user="${safeName}" onclick="handleUfOptionClick(this)">
                    <div class="uf-checkbox ${checked ? 'checked' : ''}"></div>
                    <span class="uf-option-name">${safeName}</span>
                  </div>`;
            });
        }
    }

    // ── Footer ────────────────────────────────────────────────────────────
    const countText  = filterUsers.size > 0
        ? `${filterUsers.size} of ${allUsers.length} selected`
        : 'None selected';
    const clearBtn   = filterUsers.size > 0
        ? `<button class="uf-clear-btn" onclick="clearUserFilter()">Clear</button>`
        : '';
    const footerHtml = `
      <div class="uf-footer">
        <span class="uf-count">${countText}</span>
        ${clearBtn}
      </div>`;

    dropdown.innerHTML = searchHtml
        + `<div class="uf-options">${optionsHtml}</div>`
        + footerHtml;
}

// ─── FILTER ACTIONS ───────────────────────────────────────────────────────

/** Called from the data-user option divs via onclick. */
function handleUfOptionClick(el) {
    toggleUserSelection(el.dataset.user);
}

function toggleUserSelection(userName) {
    if (!userName) return;
    if (filterUsers.has(userName)) {
        filterUsers.delete(userName);
    } else {
        filterUsers.add(userName);
    }
    updateUserFilterLabel();
    render();
    // Re-render dropdown in place so checkboxes update without closing
    renderUserFilterDropdown(document.getElementById('uf-search')?.value || '');
}

function toggleSelectAllUsers() {
    const allUsers    = getAllAssignees();
    const allSelected = allUsers.every(u => filterUsers.has(u));
    if (allSelected) {
        filterUsers.clear();
    } else {
        allUsers.forEach(u => filterUsers.add(u));
    }
    updateUserFilterLabel();
    render();
    renderUserFilterDropdown(document.getElementById('uf-search')?.value || '');
}

function clearUserFilter() {
    filterUsers.clear();
    updateUserFilterLabel();
    render();
    renderUserFilterDropdown('');
}

function handleUfKeydown(e) {
    if (e.key === 'Escape') { closeUserFilter(); e.stopPropagation(); }
    if (e.key === 'Enter')  { e.stopPropagation(); }   // prevent modal submit
}

// ─── PERSISTENCE ──────────────────────────────────────────────
function saveToLocal() {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                items: S.items,
                savedAssignees: S.savedAssignees || [],
            }),
        );
    } catch (e) {
        console.warn("localStorage write failed:", e);
    }
}

function loadFromLocal() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.items)) {
                S = parsed;
            }
        }
    } catch (e) {
        console.warn(
            "localStorage parse failed, starting fresh:",
            e,
        );
    }

    // Ensure all items have assignees array
    S.items.forEach((i) => {
        if (!i.assignees) i.assignees = [];
    });

    // Migrate from old separate assignee key
    if (
        !Array.isArray(S.savedAssignees) ||
        S.savedAssignees.length === 0
    ) {
        try {
            const a = localStorage.getItem(ASSIGNEE_KEY);
            if (a) S.savedAssignees = JSON.parse(a);
        } catch (e) {
            /* ignore */
        }
    }
    if (!Array.isArray(S.savedAssignees)) S.savedAssignees = [];
}

// FIX: loadFromCloud now:
//   1. Cancels any debounce timer before overwriting state (prevents
//      demo data being pushed to Supabase after cloud data arrives).
//   2. Pushes local state to Supabase when the DB is empty on first run.
//   3. Merges cloud and local data intelligently based on _lastModified timestamps
//      to prevent losing local changes on initial load.
async function loadFromCloud() {
    if (!useCloudSync) {
        loadFromLocal();
        render();
        hideSkeleton();
        return;
    }

    loadFromLocal();
    render();

    try {
        const data = await loadFromSupabase();

        if (data === null) {
            // Network/DB error — keep local data, don't clobber it.
            console.warn("Cloud load failed; using local data.");
            hideSkeleton();
            return;
        }

        if (data.items.length > 0) {
            // Cloud has data — merge intelligently with local data
            clearTimeout(saveDebounceTimer); // Cancel any pending save
            
            // Create a map of local items by ID for quick lookup
            const localItemsMap = new Map();
            S.items.forEach(item => {
                localItemsMap.set(item.id, item);
            });
            
            // Merge items: keep the version with the newer _lastModified timestamp
            const mergedItems = [];
            const processedIds = new Set();
            
            // Process local items first
            for (const localItem of S.items) {
                const cloudItem = data.items.find(ci => ci.id === localItem.id);
                if (!cloudItem) {
                    // Item only exists locally, keep it
                    mergedItems.push(localItem);
                } else {
                    // Item exists in both, compare timestamps
                    const localTime = localItem._lastModified || 0;
                    const cloudTime = cloudItem._lastModified || 0;
                    if (localTime >= cloudTime) {
                        // Local version is newer or same, keep local
                        mergedItems.push(localItem);
                    } else {
                        // Cloud version is newer, use cloud
                        mergedItems.push(cloudItem);
                    }
                    processedIds.add(localItem.id);
                }
            }
            
            // Add cloud items that don't exist locally
            for (const cloudItem of data.items) {
                if (!processedIds.has(cloudItem.id)) {
                    mergedItems.push(cloudItem);
                }
            }
            
            S.items = mergedItems;
            S.savedAssignees = data.savedAssignees.length
                ? data.savedAssignees
                : S.savedAssignees;
            saveToLocal();
            render();
            showToast("✓ Synced from cloud", "success", 2000);
        } else {
            // Cloud is empty (first run) — push local data up.
            console.log(
                "Cloud empty — pushing local data to Supabase.",
            );
            await saveToSupabase();
        }
        
        // Mark initial load as complete and start grace period
        initialLoadComplete = true;
        console.log("[Sync] Initial load complete, starting grace period");
        setTimeout(() => {
            console.log("[Sync] Grace period ended");
        }, INITIAL_LOAD_GRACE_PERIOD_MS);
        
        hideSkeleton();
    } catch (e) {
        console.error("Supabase save failed:", e.message || e);
        hideSkeleton();
    }
}

function hideSkeleton() {
    const skeleton = document.getElementById("skeleton-screen");
    if (skeleton) {
        skeleton.style.opacity = "0";
        skeleton.style.transition = "opacity 0.3s ease";
        setTimeout(() => {
            skeleton.style.display = "none";
        }, 300);
    }
}

// FIX: save() debounces Supabase writes to avoid a write per keypress
// or per drag event.  800 ms is long enough to batch rapid changes
// (e.g. reordering activities) without feeling unresponsive.
function save() {
    saveToLocal();
    if (!useCloudSync) return;
    clearTimeout(saveDebounceTimer);
    console.log(`[Sync] Debouncing save (800ms) at ${new Date().toISOString()}`);
    saveDebounceTimer = setTimeout(() => {
        console.log(`[Sync] Debounce timer fired, executing saveToSupabase`);
        saveToSupabase();
    }, 800);
}

function saveAssignees() {
    save();
}
function load() {
    loadFromCloud();
}

// ─── UTILITY ──────────────────────────────────────────────────
function offsetDate(d, days) {
    const r = new Date(d);
    r.setDate(r.getDate() + days);
    return r;
}
function fmtDate(d) {
    return d.toISOString().split("T")[0];
}
function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID)
        return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
        /[xy]/g,
        (c) => {
            const r = (Math.random() * 16) | 0,
                v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        },
    );
}
function todayStr() {
    return new Date().toISOString().split("T")[0];
}
function daysUntil(ds) {
    return Math.round(
        (new Date(ds + "T12:00:00") -
            new Date(todayStr() + "T12:00:00")) /
            86400000,
    );
}
function esc(s) {
    return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function fmtDisplay(ds) {
    if (!ds) return "";
    return new Date(ds + "T12:00:00").toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "2-digit",
    });
}
function fmtMonth(ds) {
    return new Date(ds + "T12:00:00").toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
    });
}
function findFixtureById(id) {
    return (
        S.items.find((i) => i.type === "fixture" && i.id === id) ||
        null
    );
}
function fixtureDisplayLabel(fixture) {
    return fixture
        ? `${fmtDisplay(fixture.date)} — ${fixture.opponent}`
        : "";
}
function getFixturesForLinking() {
    return S.items
        .filter((i) => i.type === "fixture")
        .sort((a, b) => a.date.localeCompare(b.date));
}
function fixtureLinkTemporalWeight(fixture) {
    const diff = daysUntil(fixture.date);
    if (diff >= 0) return diff;
    return 1000 + Math.abs(diff);
}
function fixtureLinkMetaLabel(fixture) {
    const parts = [];
    if (fixture.teamType) parts.push(fixture.teamType);
    if (fixture.matchType) parts.push(fixture.matchType);
    if (fixture.venueType) {
        parts.push(
            fixture.venueType.charAt(0).toUpperCase() +
                fixture.venueType.slice(1),
        );
    }
    return parts.join(" • ");
}
function renderFixtureLinkResults(fixtures) {
    if (!fixtures.length) {
        return `<div class="autocomplete-item empty">No matches found</div>`;
    }
    let currentMonth = "";
    let html = "";
    fixtures.forEach((fixture) => {
        const monthKey = fixture.date.slice(0, 7);
        if (monthKey !== currentMonth) {
            currentMonth = monthKey;
            html += `<div class="autocomplete-group-label">${esc(fmtMonth(fixture.date))}</div>`;
        }
        html += `<div class="autocomplete-item" onclick="selectLinkedFixture('${fixture.id}')"><div class="fixture-link-option"><div class="fixture-link-option-main">🏉 ${esc(fixtureDisplayLabel(fixture))}</div><div class="fixture-link-option-meta">${esc(fixtureLinkMetaLabel(fixture))}</div></div></div>`;
    });
    return html;
}
function getFixtureLinkMatches(query) {
    const fixtures = getFixturesForLinking();
    const q = (query || "").trim().toLowerCase();
    return fixtures
        .map((fixture) => {
            const label =
                fixtureDisplayLabel(fixture).toLowerCase();
            const opponent = (fixture.opponent || "").toLowerCase();
            const teamType = (fixture.teamType || "").toLowerCase();
            const matchType = (
                fixture.matchType || ""
            ).toLowerCase();
            let score = 0;
            if (!q) {
                score = 1;
            } else {
                if (opponent.startsWith(q)) score += 7;
                if (opponent.includes(q)) score += 4;
                if (label.includes(q)) score += 2;
                if (teamType.includes(q)) score += 1;
                if (matchType.includes(q)) score += 1;
            }
            return {
                fixture,
                score,
                timeWeight: fixtureLinkTemporalWeight(fixture),
            };
        })
        .filter((entry) => entry.score > 0)
        .sort(
            (a, b) =>
                b.score - a.score ||
                a.timeWeight - b.timeWeight ||
                a.fixture.date.localeCompare(b.fixture.date) ||
                (a.fixture.opponent || "").localeCompare(
                    b.fixture.opponent || "",
                ),
        )
        .slice(0, 16)
        .map((entry) => entry.fixture);
}
function renderFixtureLinkSelection() {
    const container = document.getElementById("a-linked-fixture-current");
    if (!container) return;

    const selectedIdsValue =
        document.getElementById("a-linked-fixture-id")?.value || "";
    let selectedIds = [];
    if (selectedIdsValue && selectedIdsValue.trim() !== "") {
        try {
            const parsed = JSON.parse(selectedIdsValue);
            selectedIds = Array.isArray(parsed) ? parsed : [selectedIdsValue];
        } catch (e) {
            // Handle legacy single-value format or malformed JSON
            console.warn("Failed to parse linked fixture IDs:", e, "Value was:", selectedIdsValue);
            selectedIds = [selectedIdsValue];
        }
    }
    const fixtures = selectedIds.map(id => findFixtureById(id)).filter(Boolean);

    // Clear the input text while pills are open.
    const input = document.getElementById("a-linked-fixture-query");
    if (input) input.value = fixtures.length ? "" : input.value;

    container.innerHTML = fixtures
        .map(fixture => `<span class="fixture-link-pill">🏉 ${esc(fixtureDisplayLabel(fixture))}<button class="fixture-link-clear" type="button" onclick="removeLinkedFixture('${fixture.id}')" title="Remove linked match">✕</button></span>`)
        .join("");

    // If no fixtures, hide the pill overlay.
    container.style.display = fixtures.length ? "block" : "none";
}
function selectLinkedFixture(fixtureId) {
    const fixture = findFixtureById(fixtureId);
    const hidden = document.getElementById("a-linked-fixture-id");
    const input = document.getElementById("a-linked-fixture-query");
    if (!hidden || !input) return;
    
    const selectedIdsValue = hidden.value || "";
    const selectedIds = selectedIdsValue ? JSON.parse(selectedIdsValue) : [];
    
    // Add the fixture if not already selected
    if (fixture && !selectedIds.includes(fixture.id)) {
        selectedIds.push(fixture.id);
    }
    
    hidden.value = JSON.stringify(selectedIds);

    // Clear the input text while the pill is open (pill is the selection UI).
    input.value = "";

    renderFixtureLinkSelection();
    hideFixtureLinkSuggestions();
}
function clearLinkedFixtureSelection() {
    const hidden = document.getElementById("a-linked-fixture-id");
    const input = document.getElementById("a-linked-fixture-query");
    if (hidden) hidden.value = "";
    if (input) {
        input.value = "";
        input.focus();
    }
    renderFixtureLinkSelection();
    showFixtureLinkSuggestions("");
}
function removeLinkedFixture(fixtureId) {
    const hidden = document.getElementById("a-linked-fixture-id");
    if (!hidden) return;
    
    const selectedIdsValue = hidden.value || "";
    const selectedIds = selectedIdsValue ? JSON.parse(selectedIdsValue) : [];
    
    // Remove the fixture from the array
    const index = selectedIds.indexOf(fixtureId);
    if (index > -1) {
        selectedIds.splice(index, 1);
    }
    
    hidden.value = selectedIds.length ? JSON.stringify(selectedIds) : "";
    renderFixtureLinkSelection();
}
function showFixtureLinkSuggestions(query) {
    const dropdown = document.getElementById(
        "a-linked-fixture-dropdown",
    );
    if (!dropdown) return;
    const matches = getFixtureLinkMatches(query);
    dropdown.innerHTML = renderFixtureLinkResults(matches);
    dropdown.style.display = "block";
}
function hideFixtureLinkSuggestions() {
    const dropdown = document.getElementById(
        "a-linked-fixture-dropdown",
    );
    if (dropdown) dropdown.style.display = "none";
}
function handleFixtureLinkInput() {
    const input = document.getElementById("a-linked-fixture-query");
    const hidden = document.getElementById("a-linked-fixture-id");
    if (!input || !hidden) return;

    // Keep selection/pill while the user is editing within the field,
    // but clear it once the text no longer matches the selected fixture label.
    const selectedIdsValue = hidden.value || "";
    const selectedIds = selectedIdsValue ? JSON.parse(selectedIdsValue) : [];
    if (selectedIds.length > 0) {
        const fixtures = selectedIds.map(id => findFixtureById(id)).filter(Boolean);
        const selectedLabels = fixtures.map(f => fixtureDisplayLabel(f)).join(", ");
        const typed = (input.value || "".trim());

        // If the user types something that doesn't match the selected fixtures, clear selection
        if (typed && typed !== selectedLabels) {
            hidden.value = "";
        }
    }

    renderFixtureLinkSelection();
    showFixtureLinkSuggestions(input.value);
}
function handleFixtureLinkKeydown(event) {
    const dropdown = document.getElementById(
        "a-linked-fixture-dropdown",
    );
    if (!dropdown) return;
    if (event.key === "Enter") {
        event.preventDefault();
        dropdown
            .querySelector(".autocomplete-item:not(.empty)")
            ?.click();
    } else if (event.key === "Escape") {
        hideFixtureLinkSuggestions();
    }
}

// ─── GROUPS BUILDER ───────────────────────────────────────────
function buildGroups(items, allItems = S.items) {
    const seen = new Set();
    const fixtureActMap = {};
    allItems
        .filter((i) => i.type === "activity" && i.fixtureId)
        .forEach((a) => {
            if (!fixtureActMap[a.fixtureId])
                fixtureActMap[a.fixtureId] = [];
            fixtureActMap[a.fixtureId].push(a);
        });
    const dateMap = {};
    items.forEach((item) => {
        if (seen.has(item.id)) return;
        if (item.type === "fixture") {
            seen.add(item.id);
            const linked = fixtureActMap[item.id] || [];
            linked.forEach((a) => seen.add(a.id));
            if (!dateMap[item.date])
                dateMap[item.date] = {
                    type: "date-group",
                    date: item.date,
                    items: [],
                };
            dateMap[item.date].items.push({
                type: "fixture",
                fixture: item,
                activities: linked.sort((a, b) =>
                    (a.clusterOrder || 0) - (b.clusterOrder || 0),
                ),
            });
        } else if (item.type === "milestone") {
            seen.add(item.id);
            if (!dateMap[item.date])
                dateMap[item.date] = {
                    type: "date-group",
                    date: item.date,
                    items: [],
                };
            dateMap[item.date].items.push({
                type: "milestone",
                item,
            });
        } else if (item.type === "note") {
            seen.add(item.id);
            if (!dateMap[item.date])
                dateMap[item.date] = {
                    type: "date-group",
                    date: item.date,
                    items: [],
                };
            dateMap[item.date].items.push({ type: "note", item });
        } else if (item.type === "activity" && !item.fixtureId) {
            seen.add(item.id);
            if (!dateMap[item.date])
                dateMap[item.date] = {
                    type: "date-group",
                    date: item.date,
                    items: [],
                };
            dateMap[item.date].items.push({
                type: "activity",
                item,
            });
        }
    });
    return Object.values(dateMap).sort((a, b) =>
        a.date.localeCompare(b.date),
    );
}

// ─── RENDER ENGINE ────────────────────────────────────────────
function linkifyText(text) {
    const t = String(text ?? "");

    // Simple URL detection:
    //  - http(s)://...
    //  - www....
    // Stops on whitespace and common HTML delimiters.
    const urlRegex = /(https?:\/\/[^\s<>"']+)|(www\.[^\s<>"']+)/g;

    const NOTES_OPEN = "[[NOTES]]";
    const NOTES_CLOSE = "[[/NOTES]]";

    function linkifyPlain(str) {
        let out = "";
        let lastIndex = 0;

        // Reset regex state because urlRegex is global (/g).
        urlRegex.lastIndex = 0;
        const matches = str.matchAll(urlRegex);
        for (const m of matches) {
            const idx = m.index ?? 0;

            // Append text before match (escaped)
            out += esc(str.slice(lastIndex, idx));

            const raw = m[0];
            const href = raw.startsWith("www.")
                ? "https://" + raw
                : raw;

            const linkText = esc(raw);

            const iconSVG = `
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M14 3h7v7"/>
                    <path d="M10 14L21 3"/>
                    <path d="M21 14v7H3V3h7"/>
                </svg>
            `.trim();

            out += `<a class="note-link" href="${esc(
                href,
            )}" target="_blank" rel="noopener noreferrer">${linkText}<span class="note-link-icon" aria-hidden="true">${iconSVG}</span></a>`;

            lastIndex = idx + raw.length;
        }

        out += esc(str.slice(lastIndex));
        return out;
    }

    // If no markers, behave as before.
    if (!t.includes(NOTES_OPEN) || !t.includes(NOTES_CLOSE)) {
        return linkifyPlain(t);
    }

    // Marker-aware: bold ONLY the user-entered notes segments.
    let out = "";
    let cursor = 0;

    while (cursor < t.length) {
        const openIdx = t.indexOf(NOTES_OPEN, cursor);
        if (openIdx === -1) {
            out += linkifyPlain(t.slice(cursor));
            break;
        }

        // Text before notes segment
        out += linkifyPlain(t.slice(cursor, openIdx));

        const notesStart = openIdx + NOTES_OPEN.length;
        const closeIdx = t.indexOf(NOTES_CLOSE, notesStart);
        if (closeIdx === -1) {
            // Malformed marker; treat remainder as plain
            out += linkifyPlain(t.slice(notesStart));
            break;
        }

        const notesText = t.slice(notesStart, closeIdx);

        // Bold the whole linkified notes chunk (links inside are fine)
        out += `<strong class="notes-bold">${linkifyPlain(
            notesText,
        )}</strong>`;

        cursor = closeIdx + NOTES_CLOSE.length;
    }

    return out;
}

function decorateLinkContainers(root = document) {
    const targets = root.querySelectorAll(
        ".note-card .note-content, .activity-card .activity-meta, .mini-activity .activity-meta, .milestone-card .milestone-date"
    );

    targets.forEach((el) => {
        // If already decorated, skip to avoid nesting links.
        if (el.dataset.linkified === "1") return;

        const rawText = el.textContent ?? "";
        el.innerHTML = linkifyText(rawText);
        el.dataset.linkified = "1";
    });
}

function render() {
    const content = document.getElementById("timeline-content");
    const today = todayStr();
    const filteredItems = getFilteredItems();
    const pastItems = filteredItems.filter((i) => i.date < today);
    const activeItems = filteredItems.filter((i) => i.date >= today);
    const pastGroups = buildGroups(pastItems, filteredItems);
    const activeGroups = buildGroups(activeItems, filteredItems);
    let html = "";
    if (pastGroups.length > 0) {
        let inner = "",
            side = 0,
            lastMonth = "";
        pastGroups.forEach((g) => {
            const month = g.date.slice(0, 7);
            if (month !== lastMonth) {
                lastMonth = month;
                inner += `<div class="month-divider"><span class="month-divider-label">${fmtMonth(g.date)}</span></div>`;
            }
            inner += renderGroup(
                g,
                side % 2 === 0 ? "side-left" : "side-right",
                true,
            );
            side++;
        });
        html += `<div id="past-accordion"><div id="past-toggle" onclick="togglePast(event,this)">show previous activity</div><div id="past-items">${inner}</div></div>`;
    }
    html += `<div id="today-marker"><div class="today-line"></div><div class="today-badge">Today — ${fmtDisplay(today)}</div><div class="today-line"></div></div>`;
    let side = 0,
        lastMonth = "";
    activeGroups.forEach((g) => {
        const month = g.date.slice(0, 7);
        if (month !== lastMonth) {
            lastMonth = month;
            html += `<div class="month-divider"><span class="month-divider-label">${fmtMonth(g.date)}</span></div>`;
        }
        html += renderGroup(
            g,
            side % 2 === 0 ? "side-left" : "side-right",
            false,
        );
        side++;
    });
    if (activeGroups.length === 0 && pastGroups.length === 0) {
        if (filterUsers.size > 0) {
            html += `<div class="empty-state"><h2>No activity found</h2><p>No activity found for the selected team members. <button class="btn btn-outline" style="margin-top:12px;font-size:11px" onclick="clearUserFilter()">Clear filter</button></p></div>`;
        } else {
            html += `<div class="empty-state"><h2>No events planned</h2><p>Add your first match, milestone or activity above.</p></div>`;
        }
    }
    content.innerHTML = html;
    decorateLinkContainers(content);
    updateUserFilterLabel();
    attachEvents();
}

function renderGroup(g, side, isPast) {
    return g.type === "date-group"
        ? renderDateGroup(g, side, isPast)
        : "";
}

function renderDateGroup(g, side, isPast) {
    let itemsHtml = "";
    let itemSide = 0;
    g.items.forEach((item) => {
        const s = itemSide % 2 === 0 ? "side-left" : "side-right";
        if (item.type === "fixture")
            itemsHtml += renderFixtureGroup(item, s, isPast);
        else if (item.type === "milestone")
            itemsHtml += renderMilestoneGroup(item, s, isPast);
        else if (item.type === "note")
            itemsHtml += renderNoteGroup(item, s, isPast);
        else if (item.type === "activity")
            itemsHtml += renderActivityGroup(item, s, isPast);
        itemSide++;
    });
    return `<div class="date-group"><div class="date-header"><div class="date-label" data-date="${g.date}" onclick="handleDateLabelClick('${g.date}',this)">${fmtDisplay(g.date)}</div></div>${itemsHtml}</div>`;
}

function renderFixtureGroup(g, side, isPast) {
    const f = g.fixture,
        acts = g.activities;
    const days = daysUntil(f.date);
    const venueClass =
        f.venueType === "home"
            ? "home"
            : f.venueType === "away"
              ? "away"
              : "neutral";
    const venueLabel =
        f.venueType === "home"
            ? "H"
            : f.venueType === "away"
              ? "A"
              : "N";
    let countdownTxt, countdownCls;
    if (isPast || days < 0) {
        countdownTxt = `${Math.abs(days)}d ago`;
        countdownCls = "past";
    } else if (days === 0) {
        countdownTxt = "MATCHDAY";
        countdownCls = "imminent";
    } else if (days === 1) {
        countdownTxt = "Tomorrow";
        countdownCls = "imminent";
    } else if (days <= 7) {
        countdownTxt = `${days} Days To Go`;
        countdownCls = "imminent";
    } else {
        countdownTxt = `${days} Days`;
        countdownCls = "far";
    }
    const teamLogo = getTeamLogo(f.opponent);
    // Real logo -> Bradford Bulls placeholder -> SVG shield
    const logoHtml = `<img src="${teamLogo || TEAM_LOGO_FALLBACK}" alt="${esc(f.opponent)}" data-fallback="${TEAM_LOGO_FALLBACK}" onerror="if(this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}else{this.style.display='none';this.nextElementSibling.style.display='flex';}"><div class="fixture-logo-initials" style="display:none;">${shieldSVG(f.opponent)}</div>`;
    const teamBadge = f.teamType
        ? `<span class="team-badge" data-team-type="${esc(f.teamType)}">${esc(f.teamType)}</span>`
        : "";
    const actsHtml = acts
        .map((a) => renderMiniActivity(a))
        .join("");
    return `<div class="tl-row ${side}" data-id="${f.id}"><div class="tl-spacer"></div><div class="tl-node"><div class="node-dot fixture-dot${isPast ? " past-dot" : ""}"></div></div><div class="tl-card-wrap"><div class="fixture-card${isPast ? " past" : ""}" id="fc-${f.id}" data-id="${f.id}" data-fixture-id="${f.id}" draggable="true"><div class="fixture-header"><div class="drag-handle">⠿</div><div class="fixture-logo-wrap">${logoHtml}</div><div class="fixture-meta"><div class="fixture-opponent">${esc(f.opponent)}</div><div class="fixture-sub"><span class="subtle-date">${fmtDisplay(f.date)}</span>${f.venue ? `<span>📍 ${esc(f.venue)}</span>` : ""}<span>🏉 ${esc(f.matchType || "")}</span>${teamBadge}</div></div><div class="fixture-venue-badge badge-${venueClass}">${venueLabel}</div></div><div class="fixture-footer"><div class="countdown-text ${countdownCls}">${countdownTxt}</div>${acts.length > 0 ? `<button class="fixture-acts-toggle" onclick="toggleActCluster('${f.id}')">▸ ${acts.length} Matchday Activities</button>` : ""}<div class="fixture-actions"><button class="activity-btn" title="Add matchday activity" onclick="openActivityForFixture('${f.id}')">＋</button><button class="activity-btn edit" title="Edit" onclick="editFixture('${f.id}')">✎</button><button class="activity-btn del" title="Delete" onclick="deleteItem('${f.id}')">✕</button></div></div>${acts.length > 0 ? `<div class="activity-cluster" id="cluster-${f.id}" style="display:none">${actsHtml}</div>` : ""}</div></div></div>`;
}

function renderMiniActivity(a) {
    const aType =
        ACTIVITY_TYPES.find((t) => t.id === a.actType) ||
        ACTIVITY_TYPES[ACTIVITY_TYPES.length - 1];
    const completeCls = a.complete ? " complete" : "";
    const assigneesHtml = (a.assignees || [])
        .map(
            (p) =>
                `<span class="assignee-chip">👤 ${esc(p)}</span>`,
        )
        .join("");
    return `<div class="mini-activity${completeCls}" data-id="${a.id}" draggable="true"><div class="drag-handle">⠿</div><div class="activity-icon ${aType.cls}">${aType.icon}</div><div class="activity-body"><div class="activity-title">${esc(a.title)}</div><div class="activity-meta${a.complete ? " complete-meta" : ""}"><span class="subtle-date">${fmtDisplay(a.date)}</span> · ${aType.label}${a.complete ? " · ✓ Done" : ""}${a.notes ? " · [[NOTES]]" + esc(a.notes) + "[[/NOTES]]" : ""}</div>${assigneesHtml ? `<div class="assignees-row">${assigneesHtml}</div>` : ""}</div><div class="activity-btns"><button class="activity-btn complete-btn${a.complete ? " done" : ""}" title="Mark complete" onclick="event.stopPropagation(); toggleComplete('${a.id}')">✓</button><button class="activity-btn" title="Move to Timeline" onclick="event.stopPropagation(); moveToTimeline('${a.id}')">↗</button><button class="activity-btn edit" title="Edit" onclick="event.stopPropagation(); editActivity('${a.id}')">✎</button><button class="activity-btn del" title="Delete" onclick="event.stopPropagation(); deleteItem('${a.id}')">✕</button></div></div>`;
}

function renderActivityGroup(g, side, isPast) {
    const a = g.item;
    const aType =
        ACTIVITY_TYPES.find((t) => t.id === a.actType) ||
        ACTIVITY_TYPES[ACTIVITY_TYPES.length - 1];
    const linkedFixtures = Array.isArray(a.linkedFixtureId)
        ? a.linkedFixtureId.map(id => findFixtureById(id)).filter(Boolean)
        : (a.linkedFixtureId ? [findFixtureById(a.linkedFixtureId)].filter(Boolean) : []);
    const completeCls = a.complete ? " complete" : "";
    const pastCls = isPast ? " past" : "";
    const assigneesHtml = (a.assignees || [])
        .map(
            (p) =>
                `<span class="assignee-chip">👤 ${esc(p)}</span>`,
        )
        .join("");
    const linkedRow = linkedFixtures.length > 0
        ? (() => {
            const label = linkedFixtures.length === 1 ? "Related match" : "Related matches";
            const chips = linkedFixtures.map(fixture => {
                const days = daysUntil(fixture.date);
                let daysText = "";
                if (days > 0) {
                    daysText = days === 1 ? "tomorrow" : `in ${days}d`;
                } else if (days === 0) {
                    daysText = "today";
                } else {
                    daysText = `${Math.abs(days)}d ago`;
                }
                return `<span class="linked-match-chip">🏉 ${esc(fixture.opponent)} <span class="match-days-indicator">${daysText}</span></span>`;
            }).join("");
            return `<div class="activity-link-row"><span class="activity-link-label">${label}</span>${chips}</div>`;
        })()
        : "";
    return `<div class="tl-row ${side}" data-id="${a.id}"><div class="tl-spacer"></div><div class="tl-node"><div class="node-dot${a.complete ? " complete-dot" : ""}${isPast && !a.complete ? " past-dot" : ""}"></div></div><div class="tl-card-wrap"><div class="activity-card${completeCls}${pastCls}" data-id="${a.id}" id="act-${a.id}" draggable="true"><div class="act-row"><div class="drag-handle">⠿</div><div class="activity-icon ${aType.cls}">${aType.icon}</div><div class="activity-body"><div class="activity-title">${esc(a.title)}</div>${linkedRow}<div class="activity-meta${a.complete ? " complete-meta" : ""}"><span class="subtle-date">${fmtDisplay(a.date)}</span> · ${aType.label}${a.complete ? " · ✓ Done" : ""}${a.notes ? " · [[NOTES]]" + esc(a.notes) + "[[/NOTES]]" : ""}</div>${assigneesHtml ? `<div class="assignees-row">${assigneesHtml}</div>` : ""}</div><div class="activity-btns"><button class="activity-btn complete-btn${a.complete ? " done" : ""}" title="Mark complete" onclick="event.stopPropagation(); toggleComplete('${a.id}')">✓</button><button class="activity-btn edit" title="Edit" onclick="event.stopPropagation(); editActivity('${a.id}')">✎</button><button class="activity-btn del" title="Delete" onclick="event.stopPropagation(); deleteItem('${a.id}')">✕</button></div></div></div></div></div>`;
}

function renderMilestoneGroup(g, side, isPast) {
    const m = g.item,
        style = m.style || "red",
        pastCls = isPast ? " past" : "";
    return `<div class="tl-row ${side}" data-id="${m.id}"><div class="tl-spacer"></div><div class="tl-node"><div class="node-dot milestone-dot${isPast ? " past-dot" : ""}"></div></div><div class="tl-card-wrap"><div class="milestone-card ${style}${pastCls}" data-id="${m.id}" id="milestone-${m.id}" draggable="true"><div class="act-row"><div class="drag-handle">⠿</div><div class="milestone-body"><div class="milestone-label">⚑ Milestone</div><div class="milestone-title">${esc(m.title)}</div><div class="milestone-date subtle-date">${fmtDisplay(m.date)}${m.notes ? " · [[NOTES]]" + esc(m.notes) + "[[/NOTES]]" : ""}</div></div><div class="activity-btns"><button class="activity-btn edit" title="Edit" onclick="editMilestone('${m.id}')">✎</button><button class="activity-btn del" title="Delete" onclick="deleteItem('${m.id}')">✕</button></div></div></div></div></div>`;
}

function renderNoteGroup(g, side, isPast) {
    const n = g.item,
        pastCls = isPast ? " past" : "";
    return `<div class="tl-row ${side}" data-id="${n.id}"><div class="tl-spacer"></div><div class="tl-node"><div class="node-dot${isPast ? " past-dot" : ""}" style="background:var(--ink-mid);box-shadow:0 0 0 2px var(--ink-mid);"></div></div><div class="tl-card-wrap"><div class="note-card${pastCls}" data-id="${n.id}" id="note-${n.id}" draggable="true"><div class="act-row"><div class="drag-handle">⋮⋮</div><div class="note-body"><div class="note-content">[[NOTES]]${esc(n.content)}[[/NOTES]]</div><div class="note-meta"><span class="subtle-date">${fmtDisplay(n.date)}</span></div></div><div class="activity-btns"><button class="activity-btn edit" title="Edit" onclick="editNote('${n.id}')">✎</button><button class="activity-btn del" title="Delete" onclick="deleteItem('${n.id}')">✕</button></div></div></div></div></div>`;
}

function togglePasswordVisibility() {
    const input = document.getElementById("auth-password");
    const icon = document.getElementById("eye-icon");
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    icon.innerHTML = isHidden
        ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
           <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
           <line x1="1" y1="1" x2="23" y2="23"/>`
        : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
           <circle cx="12" cy="12" r="3"/>`;
}

let syncToastTimer = null;
let syncToastMsg = null;
let syncToastType = "success";

function showSyncToast(msg = "🔄 Synced from another device", type = "success") {
    // Keep the most recent message but only show one toast
    syncToastMsg = msg;
    syncToastType = type;
    if (syncToastTimer) return; // already pending, do nothing
    syncToastTimer = setTimeout(() => {
        showToast(syncToastMsg, syncToastType);
        syncToastTimer = null;
        syncToastMsg = null;
    }, 300); // 300ms window batches all table events from one sync
}
// ─── INTERACTIONS ─────────────────────────────────────────────
function isMobile() {
    return window.innerWidth <= 768 || "ontouchstart" in window;
}

function toggleComplete(id) {
    const item = S.items.find((i) => i.id === id);
    if (!item) return;
    const openDropdowns = Array.from(
        document.querySelectorAll(".activity-cluster"),
    )
        .filter((el) => el.style.display !== "none")
        .map((el) => el.id.replace("cluster-", ""));
    item.complete = !item.complete;
    save();
    render();
    openDropdowns.forEach((fid) => {
        const cluster = document.getElementById("cluster-" + fid);
        const btn = document.querySelector(
            `[onclick="toggleActCluster('${fid}')"]`,
        );
        if (cluster) {
            cluster.style.display = "";
            if (btn)
                btn.textContent =
                    "▾ " +
                    cluster.querySelectorAll(".mini-activity")
                        .length +
                    " Matchday Activities";
        }
    });
    showToast(
        item.complete ? "✓ Marked complete" : "Marked incomplete",
    );
}

function moveToTimeline(id) {
    const item = S.items.find((i) => i.id === id);
    if (!item) return;
    if (!item.fixtureId) {
        showToast("Activity is already on the main timeline");
        return;
    }
    item.linkedFixtureId = item.linkedFixtureId || (item.fixtureId ? [item.fixtureId] : []);
    item.fixtureId = null;
    save();
    render();
    showToast("Activity moved to main timeline");
}

let pastAutoCloseDebounce = null;

function closePast(reason = "click") {
    const pastItems = document.getElementById("past-items");
    const btn = document.getElementById("past-toggle");
    const accordion = document.getElementById("past-accordion");
    if (!btn || !pastItems || !accordion) return;
    if (!btn.classList.contains("open")) return;

    const currentH = pastItems.scrollHeight;

    btn.classList.remove("open");
    btn.textContent = "show previous activity";
    accordion.classList.remove("past-open");

    if (reason === "auto") {
        const scrollBefore = window.scrollY;
        pastItems.style.cssText = "max-height:0;opacity:0;overflow:hidden;transition:none;";
        window.scrollTo({ top: Math.max(0, scrollBefore - currentH), behavior: "instant" });
        return;
    }

    // Direct click: subtle collapse with height change.
    pastItems.style.visibility = "";
    pastItems.style.pointerEvents = "";
    pastItems.style.overflow = "hidden";
    pastItems.style.transition = "max-height 180ms ease, opacity 160ms ease";
    pastItems.style.maxHeight = currentH + "px";

    requestAnimationFrame(() => {
        pastItems.style.maxHeight = "0px";
        pastItems.style.opacity = "0";
    });
}

function togglePast(e, btn) {
    e.preventDefault();
    e.stopPropagation();
    const isOpening = !btn.classList.contains("open");
    const todayMarker = document.getElementById("today-marker");
    const pastItems = document.getElementById("past-items");
    const accordion = document.getElementById("past-accordion");

    if (isOpening) {
        const viewportOffset =
            todayMarker.getBoundingClientRect().top;
        pastItems.style.cssText =
            "max-height:none;opacity:1;overflow:visible;transition:none;";
        btn.classList.add("open");
        btn.textContent = "hide previous activity";
        accordion?.classList.add("past-open");

        requestAnimationFrame(() => {
            const newOffset =
                todayMarker.getBoundingClientRect().top;
            const shift = newOffset - viewportOffset;
            if (shift !== 0)
                window.scrollTo({
                    top: window.scrollY + shift - 200,
                    behavior: "instant",
                });
        });
    } else {
        pastItems.style.cssText = "max-height:0;opacity:0;overflow:hidden;transition:none;";
        btn.classList.remove("open");
        btn.textContent = "show previous activity";
        accordion?.classList.remove("past-open");
        requestAnimationFrame(() => {
            const top = todayMarker.getBoundingClientRect().top + window.scrollY - 80;
            window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
        });
    }    
}

function toggleActCluster(fid) {
    if (disableToggle) return;
    const cluster = document.getElementById("cluster-" + fid);
    const btn = document.querySelector(
        `[onclick="toggleActCluster('${fid}')"]`,
    );
    if (!cluster) return;
    const hidden = cluster.style.display === "none";
    cluster.style.display = hidden ? "" : "none";
    if (btn)
        btn.textContent =
            (hidden ? "▾ " : "▸ ") +
            cluster.querySelectorAll(".mini-activity").length +
            " Matchday Activities";
}

function ensureDropdownOpen(fid) {
    const cluster = document.getElementById("cluster-" + fid);
    const btn = document.querySelector(
        `[onclick="toggleActCluster('${fid}')"]`,
    );
    if (!cluster || !btn) return;
    cluster.style.display = "";
    btn.textContent =
        "▾ " +
        cluster.querySelectorAll(".mini-activity").length +
        " Matchday Activities";
    let attempts = 0;
    const iv = setInterval(() => {
        attempts++;
        if (cluster.style.display === "none") {
            cluster.style.display = "";
            btn.textContent =
                "▾ " +
                cluster.querySelectorAll(".mini-activity").length +
                " Matchday Activities";
        }
        if (attempts >= 60) clearInterval(iv);
    }, 50);
}

// Auto-close the "previous activity" toggle once the user scrolls
// below the Today marker (previous items are no longer visible).
let lastPastAutoCloseAt = 0;
let isAutoClosing = false;

window.addEventListener(
    "scroll",
    () => {
        if (isAutoClosing) return;

        const btn = document.getElementById("past-toggle");
        const todayMarker = document.getElementById("today-marker");
        if (!btn || !todayMarker) return;
        if (!btn.classList.contains("open")) return;

        const btnRect = btn.getBoundingClientRect();
        const todayRect = todayMarker.getBoundingClientRect();

        // Close as soon as the toggle overlaps the Today marker region.
        // (more responsive than waiting for Today to fully leave the viewport)
        const overlaps =
            btnRect.bottom >= todayRect.top + 2 &&
            btnRect.top <= todayRect.bottom - 2;

        // Fallback: if Today is already above viewport.
        const todayAbove = todayRect.bottom < btnRect.top + 8;

        if (overlaps || todayAbove) {
            const now = Date.now();
            // Throttle to avoid rapid flicker.
            if (now - lastPastAutoCloseAt < 120) return;
            lastPastAutoCloseAt = now;

            isAutoClosing = true;
            closePast("auto");

            // "Pause" scroll reactions briefly while layout is collapsing
            // and scrollTop is being corrected.
            setTimeout(() => {
                isAutoClosing = false;
            }, 380);
        }
    },
    { passive: true },
);

document.addEventListener(
    "click",
    (event) => {
        if (
            isDraggingActivity ||
            (dragEndTime && Date.now() - dragEndTime < 500)
        ) {
            const toggleBtn = event.target.closest(
                ".fixture-acts-toggle",
            );
            if (toggleBtn) {
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
        }
    },
    true,
);
document.addEventListener("click", (event) => {
    const dropdown = document.getElementById(
        "autocomplete-dropdown",
    );
    const input = document.getElementById("assignee-input");
    if (
        dropdown &&
        input &&
        !dropdown.contains(event.target) &&
        event.target !== input
    )
        hideAssigneeSuggestions();

    const fixtureDropdown = document.getElementById(
        "a-linked-fixture-dropdown",
    );
    const fixturePicker = document.querySelector(
        ".fixture-link-picker",
    );
    if (
        fixtureDropdown &&
        fixturePicker &&
        !fixturePicker.contains(event.target)
    ) {
        hideFixtureLinkSuggestions();
    }
});

// Separate click handler for user filter dropdown
document.addEventListener("click", (event) => {
    const ufWrap = document.getElementById('user-filter-wrap');
    if (ufWrap && !ufWrap.contains(event.target)) {
        closeUserFilter();
    }
});

function openActivityForFixture(fixtureId) {
    const fixture = findFixtureById(fixtureId);
    currentModal = {
        type: "activity",
        editId: null,
        data: {
            date: fixture?.date || todayStr(),
            fixtureId: fixtureId || null,
            linkedFixtureId: fixtureId ? [fixtureId] : [],
            _placementMode: "fixture",
        },
        assignees: [],
    };
    renderModal();
    document.getElementById("modal-overlay").classList.add("open");
}

// ─── DRAG & DROP ──────────────────────────────────────────────
function attachEvents() {
    // Linked-match navigation (activity chip -> linked fixture card)
    // No accordion auto-expansion by design.
    const headerOffset = 56 + 12; // fixed header + a small buffer
    function scrollToEl(el) {
        if (!el) return;
        const y =
            el.getBoundingClientRect().top + window.scrollY - headerOffset;
        window.scrollTo({ top: y, behavior: "smooth" });
    }
    
    // Remove any remaining drop indicator lines
    clearDropIndicators();

    document.querySelectorAll(".linked-match-chip").forEach((chip) => {
        chip.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            const activityCard = chip.closest(".activity-card");
            const activityId = activityCard?.dataset?.id;
            if (!activityId) return;

            const activity = S.items.find((i) => i.id === activityId && i.type === "activity");
            const linkedFixtureIds = activity?.linkedFixtureId;
            if (!linkedFixtureIds || !Array.isArray(linkedFixtureIds) || linkedFixtureIds.length === 0) return;

            const target = document.getElementById("fc-" + linkedFixtureIds[0]);
            if (!target) return;

            scrollToEl(target);
        });
    });

    document
        .querySelectorAll(
            ".activity-card,.mini-activity,.note-card,.fixture-card,.milestone-card",
        )
        .forEach((el) => {
            el.addEventListener("dragstart", (e) => {
                e.stopPropagation();
                dragActivityId = el.dataset.id;
                isDraggingActivity = true;
                disableToggle = true;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", el.dataset.id);
                el.classList.add("dragging");
                const tlRow = el.closest(".tl-row");
                if (tlRow) tlRow.classList.add("dragging");
                document
                    .querySelectorAll(".fixture-acts-toggle")
                    .forEach((btn) => {
                        btn.dataset.originalOnclick =
                            btn.getAttribute("onclick");
                        btn.removeAttribute("onclick");
                    });
            });
            el.addEventListener("dragend", (e) => {
                e.preventDefault();
                e.stopPropagation();
                el.classList.remove("dragging");
                isDraggingActivity = false;
                dragEndTime = Date.now();
                // Remove all indicators and dragging classes
                clearDropIndicators();
                document
                    .querySelectorAll(".dragging")
                    .forEach((r) => r.classList.remove("dragging"));
                document
                    .querySelectorAll(".drag-placeholder")
                    .forEach((p) => p.remove());
                document
                    .querySelectorAll(".fixture-card.drop-active")
                    .forEach((fc) =>
                        fc.classList.remove("drop-active"),
                    );
                // Immediately re-enable toggle
                disableToggle = false;
                document
                    .querySelectorAll(".fixture-acts-toggle")
                    .forEach((btn) => {
                        if (btn.dataset.originalOnclick) {
                            btn.setAttribute(
                                "onclick",
                                btn.dataset.originalOnclick,
                            );
                            delete btn.dataset.originalOnclick;
                        }
                    });
            });

            let touchStartX,
                touchStartY,
                touchElement,
                touchGhostEl = null,
                isTouchDrag = false;
            el.addEventListener(
                "touchstart",
                (e) => {
                    // Only initiate drag from the drag handle
                    const handle = e.target.closest(".drag-handle");
                    if (!handle) return;
                    // Don't stop propagation to allow proper touch handling within accordions,
                    // but ignore this event unless `el` is the closest draggable
                    // ancestor of the touched handle — otherwise a touch on a
                    // mini-activity's handle would bubble and also arm its
                    // parent fixture-card, creating a duplicate ghost/drag.
                    const owner = handle.closest(
                        ".activity-card,.mini-activity,.note-card,.fixture-card,.milestone-card",
                    );
                    if (owner !== el) return;

                    const touch = e.touches[0];
                    touchStartX = touch.clientX;
                    touchStartY = touch.clientY;
                    touchElement = el;
                    isTouchDrag = false;
                    dragActivityId = el.dataset.id;
                    isDraggingActivity = true;
                    disableToggle = true;
                    el.classList.add("dragging");
                    document
                        .querySelectorAll(".fixture-acts-toggle")
                        .forEach((btn) => {
                            btn.dataset.originalOnclick =
                                btn.getAttribute("onclick");
                            btn.removeAttribute("onclick");
                        });
                },
                { passive: true },
            );
            el.addEventListener(
                "touchmove",
                (e) => {
                    if (!isDraggingActivity || touchElement !== el)
                        return;
                    const touch = e.touches[0];
                    const deltaX = Math.abs(
                        touch.clientX - touchStartX,
                    );
                    const deltaY = Math.abs(
                        touch.clientY - touchStartY,
                    );
                    if (deltaX < 4 && deltaY < 4) return;
                    if (!isTouchDrag) {
                        isTouchDrag = true;
                        // Create ghost clone
                        const ghost = el.cloneNode(true);
                        ghost.id = "touch-drag-ghost";
                        ghost.className =
                            (ghost.className || "") +
                            " touch-drag-ghost";
                        ghost.style.width = el.offsetWidth + "px";
                        ghost.style.left =
                            touch.clientX -
                            el.offsetWidth / 2 +
                            "px";
                        ghost.style.top = touch.clientY - 30 + "px";
                        document.body.appendChild(ghost);
                        touchGhostEl = ghost;
                    }
                    e.preventDefault();
                    // Move ghost with smooth easing, tracked across every move
                    if (touchGhostEl) {
                        const ghost = touchGhostEl;
                        requestAnimationFrame(() => {
                            const targetX = touch.clientX - ghost.offsetWidth / 2;
                            const targetY = touch.clientY - 30;
                            ghost.style.left = targetX + "px";
                            ghost.style.top = targetY + "px";
                        });
                    }
                    // Clear previous highlights/indicators
                    document
                        .querySelectorAll(".fixture-card.touch-drop-target")
                        .forEach((r) =>
                            r.classList.remove("touch-drop-target"),
                        );
                    clearDropIndicators();

                    const target =
                        document.elementFromPoint(
                            touch.clientX,
                            touch.clientY + 20
                        );

                    // Cluster placeholder (reordering activities within an accordion)
                    const cluster =
                        target?.closest(".activity-cluster");

                    if (cluster) {
                        let placeholder =
                            document.querySelector(
                                ".drag-placeholder"
                            );

                        if (!placeholder) {
                            placeholder =
                                createDragPlaceholder();
                        }

                        const after =
                            getDragAfterElement(
                                cluster,
                                touch.clientY
                            );

                        if (after == null) {
                            if (
                                placeholder.parentNode !== cluster ||
                                placeholder !== cluster.lastElementChild
                            ) {
                                cluster.appendChild(
                                    placeholder
                                );
                            }
                        } else {
                            if (placeholder.nextSibling !== after) {
                                cluster.insertBefore(placeholder, after);
                            }
                        }
                    } else {
                        document
                            .querySelectorAll(".drag-placeholder")
                            .forEach((p) => p.remove());

                        const draggedAct = S.items.find(
                            (i) => i.id === dragActivityId,
                        );
                        const fixtureCard =
                            target?.closest(".fixture-card");

                        if (fixtureCard && draggedAct?.type === "activity") {
                            // Hovering a fixture card — highlight as a link target
                            fixtureCard.classList.add(
                                "touch-drop-target"
                            );
                        } else if (!el.classList.contains("mini-activity")) {
                            // Hovering the main timeline — show blue placement box
                            const dateGroup =
                                target?.closest(".date-group");
                            const draggedRow = el.closest(".tl-row");
                            if (
                                dateGroup &&
                                draggedRow &&
                                !draggedRow.closest(".activity-cluster")
                            ) {
                                showDropIndicator(dateGroup, draggedRow, touch.clientY);
                            }
                        }
                    }
                },
                { passive: false }
            );
        el.addEventListener("touchend", (e) => {
            if (!isDraggingActivity || touchElement !== el)
                return;
            // Remove ghost
            const ghost =
                document.getElementById("touch-drag-ghost");
            if (ghost) ghost.remove();
            touchGhostEl = null;
            // Remove drop highlights
            document
                .querySelectorAll(".fixture-card.touch-drop-target")
                .forEach((r) =>
                    r.classList.remove("touch-drop-target"),
                );
            clearDropIndicators();
            if (!isTouchDrag) {
                isDraggingActivity = false;
                touchElement = null;
                el.classList.remove("dragging");
                // Ensure opacity is restored
                el.style.opacity = "1";
                el.style.transform = "";
                document
                    .querySelectorAll(".fixture-acts-toggle")
                    .forEach((btn) => {
                        if (btn.dataset.originalOnclick) {
                            btn.setAttribute(
                                "onclick",
                                btn.dataset.originalOnclick,
                            );
                            delete btn.dataset.originalOnclick;
                        }
                    });
                disableToggle = false;
                return;
            }
            el.classList.remove("dragging");
            // Animate dragged item back to normal state
            el.style.transition = "opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)";
            el.style.opacity = "1";
            el.style.transform = "scale(1)";
            setTimeout(() => {
                el.style.transition = "";
                el.style.transform = "";
                // Safety cleanup: remove any lingering ghost elements
                const lingeringGhost = document.getElementById("touch-drag-ghost");
                if (lingeringGhost) lingeringGhost.remove();
            }, 300);
            
            document
                .querySelectorAll(".mini-activity")
                .forEach((i) =>
                    i.classList.remove("drag-over"),
                );
            document
                .querySelectorAll(".drag-placeholder")
                .forEach((p) => {
                    p.style.opacity = "0";
                    p.style.transform = "scale(0.9)";
                    setTimeout(() => p.remove(), 200);
                });
            isDraggingActivity = false;
            dragEndTime = Date.now();
            const touch = e.changedTouches[0];
            const target =
                document.elementFromPoint(
                    touch.clientX,
                    touch.clientY + 20
                );
            const draggedItem = S.items.find(
                (i) => i.id === dragActivityId,
            );
            const cluster = target?.closest(".activity-cluster");
            const fc = target?.closest(".fixture-card");
            const dateGroup = target?.closest(".date-group");

            if (cluster) {
                const placeholder =
                    cluster.querySelector(".drag-placeholder");
                if (placeholder) {
                    placeholder.replaceWith(el);
                } else {
                    cluster.appendChild(el);
                }
                // Auto-snap to nearest position
                snapToNearestPosition(el, cluster);

                // Smooth animate back to final position
                el.style.transition = "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)";
                el.style.transform = "scale(1)";
                setTimeout(() => {
                    el.style.transition = "";
                }, 400);

                const fixtureId = cluster.id.replace(
                    "cluster-",
                    "",
                );
                if (
                    draggedItem &&
                    draggedItem.type === "activity"
                ) {
                    draggedItem.fixtureId = fixtureId;
                    draggedItem.linkedFixtureId = [fixtureId];
                }
                const order = Array.from(
                    cluster.querySelectorAll(".mini-activity"),
                ).map((e) => e.dataset.id);
                const acts = S.items.filter(
                    (i) =>
                        i.fixtureId === fixtureId &&
                        i.type === "activity",
                );
                const sorted = order
                    .map((id) => acts.find((a) => a.id === id))
                    .filter(Boolean);
                S.items = S.items.filter(
                    (i) => !order.includes(i.id),
                );
                sorted.forEach((a, idx) => {
                    a.clusterOrder = idx;
                    S.items.push(a);
                });
                save();
                ensureDropdownOpen(fixtureId);
            } else if (fc && draggedItem && draggedItem.type === "activity") {
                // Drop onto a fixture card — link activity to that match
                const fixtureId =
                    fc.dataset.fixtureId || fc.dataset.id;
                draggedItem.fixtureId = fixtureId;
                draggedItem.linkedFixtureId = [fixtureId];
                // Animate fixture card feedback
                fc.style.transition = "all 0.3s ease";
                fc.style.transform = "scale(1.02)";
                setTimeout(() => {
                    fc.style.transform = "scale(1)";
                    setTimeout(() => {
                        fc.style.transition = "";
                    }, 300);
                }, 100);
                save();
                render();
                showToast("🏉 Activity linked to match!");
            } else if (dateGroup) {
                if (el.classList.contains("mini-activity")) {
                    // Drag a matchday activity back out onto the main timeline
                    const date =
                        dateGroup.querySelector(".date-label")
                            ?.dataset.date;
                    if (date && draggedItem) {
                        draggedItem.fixtureId = null;
                        draggedItem.linkedFixtureId = [];
                        if (draggedItem.date !== date) {
                            draggedItem.date = date;
                        }
                        save();
                        render();
                        showToast("📅 Activity moved to timeline");
                    }
                } else {
                    // Reorder/move this row within the timeline (same or different date)
                    const draggedRow = el.closest(".tl-row");
                    if (draggedRow && !draggedRow.closest(".activity-cluster")) {
                        performTimelineDrop(dateGroup, draggedRow, touch.clientY);
                    }
                }
            }
            document
                .querySelectorAll(".drag-placeholder")
                .forEach((p) => p.remove());
            setTimeout(() => {
                disableToggle = false;
                document
                    .querySelectorAll(".fixture-acts-toggle")
                    .forEach((btn) => {
                        if (btn.dataset.originalOnclick) {
                            btn.setAttribute(
                                "onclick",
                                btn.dataset.originalOnclick,
                            );
                            delete btn.dataset.originalOnclick;
                        }
                    });
            });
            touchElement = null;
            isTouchDrag = false;
        });
    });


    document.querySelectorAll(".fixture-card").forEach((fc) => {
        fc.addEventListener("dragover", (e) => e.preventDefault());
        fc.addEventListener("dragenter", () =>
            fc.classList.add("drop-active"),
        );
        fc.addEventListener("dragleave", () =>
            fc.classList.remove("drop-active"),
        );
        fc.addEventListener("drop", (e) => {
            e.preventDefault();
            fc.classList.remove("drop-active");
            const act = S.items.find(
                (i) => i.id === dragActivityId,
            );
            if (act && act.type === "activity") {
                const fixtureId = fc.dataset.fixtureId;
                act.fixtureId = fixtureId;
                act.linkedFixtureId = [fixtureId];
                save();
                render();
                showToast("🏉 Activity linked to match!");
            }
        });
    });

    document
        .querySelectorAll(".fixture-footer")
        .forEach((footer) => {
            footer.addEventListener(
                "click",
                (e) => {
                    if (
                        isDraggingActivity ||
                        (dragEndTime &&
                            Date.now() - dragEndTime < 500)
                    ) {
                        e.stopPropagation();
                        e.preventDefault();
                    }
                },
                true,
            );
        });
    document
        .querySelectorAll(".fixture-acts-toggle")
        .forEach((btn) => {
            btn.addEventListener(
                "click",
                (e) => {
                    if (
                        isDraggingActivity ||
                        (dragEndTime &&
                            Date.now() - dragEndTime < 500)
                    ) {
                        e.stopPropagation();
                        e.preventDefault();
                        e.stopImmediatePropagation();
                    }
                },
                true,
            );
        });

    // ── Timeline-level drag: reorder rows and update date ──────────
    document.querySelectorAll(".date-group").forEach((group) => {
        group.addEventListener("dragover", (e) => {
            e.preventDefault();
            const draggedRow =
                document.querySelector(".tl-row.dragging");
            if (
                !draggedRow ||
                draggedRow.closest(".activity-cluster")
            )
                return;
            if (!group.querySelector(".date-label")?.dataset.date) return;
            showDropIndicator(group, draggedRow, e.clientY);
        });

        group.addEventListener("dragleave", (e) => {
            // Only remove if we're leaving the group entirely
            if (!group.contains(e.relatedTarget)) {
                clearDropIndicators();
            }
        });

        group.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            clearDropIndicators();

            const dragging =
                document.querySelector(".tl-row.dragging");
            if (!dragging || dragging.closest(".activity-cluster"))
                return;

            performTimelineDrop(group, dragging, e.clientY);
        });
    });

    document
        .querySelectorAll(".activity-cluster")
        .forEach((cluster) => {
            cluster.addEventListener("dragover", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dragging =
                    document.querySelector(".dragging");
                if (!dragging) return;

                // Only update placeholder if position actually changed
                const after = getDragAfterElement(
                    cluster,
                    e.clientY,
                );
                const existingPlaceholder =
                    cluster.querySelector(".drag-placeholder");

                if (!existingPlaceholder) {
                    const placeholder = createDragPlaceholder();
                    after == null
                        ? cluster.appendChild(placeholder)
                        : cluster.insertBefore(placeholder, after);
                } else {
                    // Move existing placeholder to new position
                    if (after == null) {
                        if (existingPlaceholder !== cluster.lastElementChild) {
                            cluster.appendChild(existingPlaceholder);
                        }
                    } else {
                        if (existingPlaceholder.nextSibling !== after) {
                            cluster.insertBefore(existingPlaceholder, after);
                        }
                    }
                }
            });
            cluster.addEventListener("drop", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dragging =
                    document.querySelector(".dragging");
                if (!dragging) return;

                const placeholder =
                    cluster.querySelector(".drag-placeholder");
                
                // Get the dragged element from the DOM
                const draggedElement = document.querySelector(`[data-id="${dragActivityId}"]`);
                if (!draggedElement) return;

                // Insert dragged element at placeholder position
                if (placeholder) {
                    placeholder.replaceWith(draggedElement);
                } else {
                    cluster.appendChild(draggedElement);
                }

                const fixtureId = cluster.id.replace(
                    "cluster-",
                    "",
                );
                const draggedAct = S.items.find(
                    (i) => i.id === dragActivityId,
                );
                if (draggedAct && draggedAct.type === "activity") {
                    draggedAct.fixtureId = fixtureId;
                    draggedAct.linkedFixtureId = [fixtureId];
                }
                
                // Update clusterOrder based on new visual order
                const order = Array.from(
                    cluster.querySelectorAll(".mini-activity"),
                ).map((e) => e.dataset.id);
                const acts = S.items.filter(
                    (i) =>
                        i.fixtureId === fixtureId &&
                        i.type === "activity",
                );
                
                // Update clusterOrder for each activity
                order.forEach((id, idx) => {
                    const item = S.items.find(i => i.id === id);
                    if (item) item.clusterOrder = idx;
                });
                
                save();
                const btn = document.querySelector(
                    `[onclick="toggleActCluster('${fixtureId}')"]`,
                );
                if (btn) {
                    const orig = btn.getAttribute("onclick");
                    btn.removeAttribute("onclick");
                    btn.style.pointerEvents = "none";
                    setTimeout(() => {
                        btn.setAttribute("onclick", orig);
                        btn.style.pointerEvents = "";
                    }, 500);
                }
                ensureDropdownOpen(fixtureId);
                showToast("↕️ Activity reordered!");
            });
            cluster.addEventListener("dragleave", (e) => {
                const placeholder =
                    cluster.querySelector(".drag-placeholder");
                if (
                    placeholder &&
                    !cluster.contains(e.relatedTarget)
                ) {
                    placeholder.remove();
                }
            });
        });
}

function getDragAfterElement(container, y) {
    const draggableElements = [
        ...container.querySelectorAll(
            ".mini-activity:not(.dragging)",
        ),
    ];

    return draggableElements.reduce(
        (closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            } else {
                return closest;
            }
        },
        { offset: Number.NEGATIVE_INFINITY },
    ).element;
}

function clearDropIndicators() {
    document.querySelectorAll(".tl-drop-indicator").forEach((i) => {
        const parentRow = i.closest(".tl-row");
        if (parentRow && parentRow.style.pointerEvents === "none") {
            parentRow.remove();
        } else {
            i.remove();
        }
    });
}

// Shared insertion-point calculation for timeline date-group drops
function computeDropPosition(group, draggedRow, clientY) {
    const rows = [...group.querySelectorAll(":scope > .tl-row")].filter(
        (r) => r !== draggedRow && r.style.pointerEvents !== "none",
    );
    let afterRow = null, beforeRow = null, minAbsDist = Infinity;
    for (const row of rows) {
        const box = row.getBoundingClientRect();
        const mid = box.top + box.height / 2;
        const dist = clientY - mid;
        if (dist > 0 && dist < minAbsDist) { minAbsDist = dist; afterRow = row; }
        if (dist < 0 && Math.abs(dist) < minAbsDist) { minAbsDist = Math.abs(dist); beforeRow = row; }
    }

    // Calculate insertion index to determine correct side for alternating pattern
    let insertionIndex = 0;
    if (afterRow) {
        insertionIndex = rows.indexOf(afterRow) + 1;
    } else if (beforeRow) {
        insertionIndex = rows.indexOf(beforeRow);
    }
    
    // Alternating pattern: even index = left, odd index = right
    let isLeftSide = insertionIndex % 2 === 0;

    let targetRow = afterRow, checkRow = targetRow;
    while (checkRow) {
        const isCheckRowLeft = checkRow.classList.contains("side-left");
        if ((isLeftSide && !isCheckRowLeft) || (!isLeftSide && isCheckRowLeft)) {
            const nextRow = checkRow.nextElementSibling;
            if (nextRow && nextRow.classList.contains("tl-row")) {
                targetRow = nextRow;
                checkRow = nextRow;
            } else {
                targetRow = null;
                break;
            }
        } else break;
    }
    return { afterRow: targetRow, beforeRow, isLeftSide };
}

// Renders the "blue box" placement indicator (desktop dragover + mobile touchmove)
function showDropIndicator(group, draggedRow, clientY) {
    clearDropIndicators();
    const { afterRow, beforeRow, isLeftSide } = computeDropPosition(group, draggedRow, clientY);

    // Match the real row markup (spacer, node, card-wrap) and side class so
    // both the desktop 3-column grid and the mobile 2-column grid position
    // the indicator exactly like a real card.
    const indicatorRow = document.createElement("div");
    indicatorRow.className = "tl-row " + (isLeftSide ? "side-left" : "side-right");
    indicatorRow.style.pointerEvents = "none";

    const spacer = document.createElement("div");
    spacer.className = "tl-spacer";

    const node = document.createElement("div");
    node.className = "tl-node";

    const cardWrap = document.createElement("div");
    cardWrap.className = "tl-card-wrap";

    const indicator = document.createElement("div");
    indicator.className = "tl-drop-indicator";
    indicator.style.width = "100%";
    cardWrap.appendChild(indicator);

    indicatorRow.appendChild(spacer);
    indicatorRow.appendChild(node);
    indicatorRow.appendChild(cardWrap);

    if (beforeRow) {
        beforeRow.insertAdjacentElement("beforebegin", indicatorRow);
    } else if (afterRow) {
        afterRow.insertAdjacentElement("afterend", indicatorRow);
    } else {
        const firstRow = group.querySelector(":scope > .tl-row");
        if (firstRow) firstRow.insertAdjacentElement("beforebegin", indicatorRow);
        else group.appendChild(indicatorRow);
    }
}

// Executes a timeline reorder/date-change drop (desktop drop + mobile touchend)
function performTimelineDrop(group, draggedRow, clientY) {
    clearDropIndicators();
    const date = group.querySelector(".date-label")?.dataset.date;
    if (!date) return;

    // Store original position before moving
    const originalParent = draggedRow.parentNode;
    const originalNextSibling = draggedRow.nextSibling;

    const { afterRow, beforeRow, isLeftSide } = computeDropPosition(group, draggedRow, clientY);

    if (beforeRow) {
        beforeRow.insertAdjacentElement("beforebegin", draggedRow);
    } else if (afterRow) {
        afterRow.insertAdjacentElement("afterend", draggedRow);
    } else {
        const firstRow = group.querySelector(":scope > .tl-row");
        if (firstRow) group.insertBefore(draggedRow, firstRow);
        else group.appendChild(draggedRow);
    }

    draggedRow.classList.remove("side-left", "side-right");
    draggedRow.classList.add(isLeftSide ? "side-left" : "side-right");

    const orderedIds = [...group.querySelectorAll(":scope > .tl-row[data-id]")]
        .map((row) => row.dataset.id)
        .filter(Boolean);
    const dateItems = orderedIds.map((id) => S.items.find((i) => i.id === id)).filter(Boolean);
    const otherItems = S.items.filter((i) => !orderedIds.includes(i.id));

    // Check if any fixture is changing to a different date
    let fixtureDateChanging = false;
    dateItems.forEach((item) => {
        if (item.type === "fixture" && item.date !== date) {
            fixtureDateChanging = true;
        }
    });

    // If a fixture is changing dates, show confirmation
    if (fixtureDateChanging) {
        showMoveConfirm(group, draggedRow, clientY, dateItems, originalParent, originalNextSibling);
        return;
    }

    // Otherwise execute directly
    executeTimelineDrop(group, draggedRow, clientY, dateItems);
}

// Executes the actual timeline drop (called after confirmation or if no date change)
function executeTimelineDrop(group, draggedRow, clientY, dateItems) {
    const date = group.querySelector(".date-label")?.dataset.date;
    if (!date) return;

    const orderedIds = [...group.querySelectorAll(":scope > .tl-row[data-id]")]
        .map((row) => row.dataset.id)
        .filter(Boolean);
    const otherItems = S.items.filter((i) => !orderedIds.includes(i.id));

    let dateChanged = false;
    dateItems.forEach((item) => {
        if (item.date !== date) { item.date = date; dateChanged = true; }
        if (item.type === "activity" && item.fixtureId) { item.fixtureId = null; dateChanged = true; }
    });

    // Reassemble S.items: preserve order within each date group
    // Items in the current date keep their DOM order (orderedIds)
    // Items in other dates keep their original order
    const dateMap = {};
    otherItems.forEach(item => {
        if (!dateMap[item.date]) dateMap[item.date] = [];
        dateMap[item.date].push(item);
    });
    if (!dateMap[date]) dateMap[date] = [];
    dateItems.forEach(item => dateMap[date].push(item));

    // Flatten back to S.items, sorted by date, preserving order within each date
    S.items = Object.entries(dateMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([, items]) => items);

    save();
    render();
    if (dateChanged) showToast("📅 Date updated");
}

function createDragPlaceholder() {
    const placeholder = document.createElement("div");
    placeholder.className = "drag-placeholder pulse";
    placeholder.setAttribute("data-placeholder", "true");
    return placeholder;
}
    
// Auto-snap helper: snap element to nearest valid position
function snapToNearestPosition(element, container) {
    if (!element || !container) return;
    const items = Array.from(container.querySelectorAll(".mini-activity")).filter(
        el => el !== element && el.offsetHeight > 0
    );
    
    if (items.length === 0) {
        container.appendChild(element);
        return;
    }
    
    const rect = element.getBoundingClientRect();
    const elementCenter = rect.top + rect.height / 2;
    
    let closestItem = items[0];
    let closestDistance = Math.abs(
        closestItem.getBoundingClientRect().top + closestItem.offsetHeight / 2 - elementCenter
    );
    
    for (let i = 1; i < items.length; i++) {
        const itemRect = items[i].getBoundingClientRect();
        const itemCenter = itemRect.top + itemRect.height / 2;
        const distance = Math.abs(itemCenter - elementCenter);
        
        if (distance < closestDistance) {
            closestDistance = distance;
            closestItem = items[i];
        }
    }
    
    const closestRect = closestItem.getBoundingClientRect();
    if (elementCenter < closestRect.top + closestRect.height / 2) {
        container.insertBefore(element, closestItem);
    } else {
        closestItem.parentNode.insertBefore(element, closestItem.nextSibling);
    }
}

// Add skeleton pulse animation if not already in CSS
function ensureSkeletonAnimation() {
    const styleId = "skeleton-pulse-animation";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
        @keyframes skeleton-pulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 0.8; }
        }
    `;
    document.head.appendChild(style);
}
ensureSkeletonAnimation();

// ─── MODAL CONTROLS ───────────────────────────────────────────
function openModal(type, id) {
    currentModal = {
        type,
        editId: id || null,
        data: id ? S.items.find((i) => i.id === id) : null,
        assignees: [],
    };
    if (id && currentModal.data)
        currentModal.assignees = [
            ...(currentModal.data.assignees || []),
        ];
    renderModal();
    document.getElementById("modal-overlay").classList.add("open");
}

function closeModal() {
    document
        .getElementById("modal-overlay")
        .classList.remove("open");
    currentModal = null;
}

function toggleMobileDropdown() {
    document
        .getElementById("mobile-dropdown")
        .classList.toggle("show");
}

document.addEventListener("click", (event) => {
    const wrapper = document.querySelector(".mobile-add-wrapper");
    const dropdown = document.getElementById("mobile-dropdown");
    if (wrapper && dropdown && !wrapper.contains(event.target))
        dropdown.classList.remove("show");
});

function editFixture(id) {
    openModal("fixture", id);
}
function editActivity(id) {
    openModal("activity", id);
}
function editMilestone(id) {
    openModal("milestone", id);
}
function editNote(id) {
    openModal("note", id);
}

function renderModal() {
    const { type, editId, data } = currentModal;
    const isEdit = !!editId;
    document.getElementById("modal-title").textContent = isEdit
        ? `Edit ${type.toUpperCase()}`
        : `Add ${type.toUpperCase()}`;
    const body = document.getElementById("modal-body");
    document.getElementById("modal-delete").style.display = "none";

    const assigneeSection = () => {
        const chips = (currentModal.assignees || [])
            .map(
                (p, i) =>
                    `<span class="assignee-remove-chip" onclick="removeAssignee(${i})">${esc(p)} ✕</span>`,
            )
            .join("");
        const quickPills = S.savedAssignees
            .filter(
                (n) => !(currentModal.assignees || []).includes(n),
            )
            .slice(0, 8)
            .map(
                (n) =>
                    `<span class="quick-add-pill" onclick="quickAddAssignee('${esc(n)}')">${esc(n)}</span>`,
            )
            .join("");
        return `<div class="form-group"><div class="quick-add-row" id="quick-add-row"><span class="quick-add-label">Quick Add:</span>${quickPills}<button class="quick-add-settings-btn" onclick="openInlineSettings()" title="Manage names"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="3"></circle><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"></path></svg></button></div><div class="custom-assignee-row"><input class="form-input custom-assignee-input" id="custom-assignee-input" placeholder="Custom name" onkeypress="if(event.key==='Enter') addCustomAssignee()"><button class="btn btn-outline" onclick="addCustomAssignee()">Add</button></div><div class="assignee-list" id="assignee-list">${chips}</div></div>`;
    };

    if (type === "fixture") {
        const f = data || {};
        body.innerHTML = `<div class="form-group"><label class="form-label">Opponent *</label><input class="form-input" id="f-opponent" value="${esc(f.opponent || "")}"></div><div class="form-row"><div class="form-group"><label class="form-label">Date *</label><input class="form-input" id="f-date" type="date" value="${f.date || todayStr()}"></div><div class="form-group"><label class="form-label">Match Type</label><select class="form-select" id="f-type">${["League", "Cup", "Playoff", "Friendly"].map((t) => `<option ${f.matchType === t ? "selected" : ""}>${t}</option>`).join("")}</select></div></div><div class="form-group"><label class="form-label">Team Type</label><div class="team-selector" id="f-teamtype">${TEAM_TYPES.map((t) => `<div class="team-opt ${f.teamType === t || (!f.teamType && t === "Men's") ? "selected" : ""}" data-value="${t}">${t}</div>`).join("")}</div></div><div class="form-group"><label class="form-label">Venue</label><input class="form-input" id="f-venue" value="${esc(f.venue || "")}"></div><div class="form-group"><label class="form-label">Venue Type *</label><div class="venue-selector" id="f-vtype"><div class="venue-opt home ${f.venueType === "home" ? "selected" : ""}" data-value="home">Home</div><div class="venue-opt away ${f.venueType === "away" ? "selected" : ""}" data-value="away">Away</div><div class="venue-opt neutral ${f.venueType === "neutral" ? "selected" : ""}" data-value="neutral">Neutral</div></div></div>`;
        document
            .querySelectorAll("#f-vtype .venue-opt")
            .forEach((opt) =>
                opt.addEventListener("click", function () {
                    document
                        .querySelectorAll("#f-vtype .venue-opt")
                        .forEach((o) =>
                            o.classList.remove("selected"),
                        );
                    this.classList.add("selected");
                }),
            );
        document
            .querySelectorAll("#f-teamtype .team-opt")
            .forEach((opt) =>
                opt.addEventListener("click", function () {
                    document
                        .querySelectorAll("#f-teamtype .team-opt")
                        .forEach((o) =>
                            o.classList.remove("selected"),
                        );
                    this.classList.add("selected");
                }),
            );
    } else if (type === "activity") {
        const a = data || {};
        const selectedFixtureIds = Array.isArray(a.linkedFixtureId)
            ? a.linkedFixtureId
            : (a.linkedFixtureId ? [a.linkedFixtureId] : []);
        const selectedFixtures = selectedFixtureIds.map(id => findFixtureById(id)).filter(Boolean);
        const selectedFixtureLabels = selectedFixtures.map(f => fixtureDisplayLabel(f)).join(", ");
        const titleHtml = `<div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="a-title" value="${esc(a.title || "")}"></div>`;
        const typeOptions = ACTIVITY_TYPES.map((t) => '<option value="' + t.id + '"' + (a.actType === t.id || (!a.actType && t.id === "other") ? ' selected' : '') + '>' + t.icon + ' ' + t.label + '</option>').join("");
        const dateTypeHtml = `<div class="form-row"><div class="form-group"><label class="form-label">Date *</label><input class="form-input" id="a-date" type="date" value="${a.date || todayStr()}"></div><div class="form-group"><label class="form-label">Type</label><select class="form-select" id="a-type">${typeOptions}</select></div></div>`;
        const linkedInputValue = selectedFixtureIds.length ? JSON.stringify(selectedFixtureIds) : "";
        console.log("Setting linked fixture input value:", linkedInputValue, "from selectedFixtureIds:", selectedFixtureIds);
        const linkedHtml = `<div class="form-group fixture-link-picker"><label class="form-label">Linked Matches</label><input class="form-input" id="a-linked-fixture-query" placeholder="Search by opponent or date" value="${esc(selectedFixtureLabels)}" oninput="handleFixtureLinkInput()" onfocus="showFixtureLinkSuggestions(this.value)" onkeydown="handleFixtureLinkKeydown(event)"><input type="hidden" id="a-linked-fixture-id" value="${linkedInputValue}"><div class="autocomplete-dropdown" id="a-linked-fixture-dropdown"></div><div class="fixture-link-current" id="a-linked-fixture-current"></div></div>`;
        const notesHtml = `<div class="form-group"><label class="form-label">Notes</label><textarea class="form-input" id="a-notes" rows="3">${esc(a.notes || "")}</textarea></div>`;
        body.innerHTML = titleHtml + dateTypeHtml + linkedHtml + notesHtml + assigneeSection();
        renderFixtureLinkSelection();
    } else if (type === "milestone") {
        const m = data || {};
        const titleHtml = `<div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="m-title" value="${esc(m.title || "")}"></div>`;
        const dateHtml = `<div class="form-group"><label class="form-label">Date *</label><input class="form-input" id="m-date" type="date" value="${m.date || todayStr()}"></div>`;
        const styleHtml = `<div class="form-group"><label class="form-label">Style Color</label><div class="style-selector" id="m-style"><div class="style-opt red ${m.style === "red" ? "selected" : ""}" data-value="red" title="Red"></div><div class="style-opt gold ${m.style === "gold" ? "selected" : ""}" data-value="gold" title="Gold"></div><div class="style-opt neutral ${m.style === "neutral" ? "selected" : ""}" data-value="neutral" title="Neutral"></div></div></div>`;
        const notesHtml = `<div class="form-group"><label class="form-label">Notes</label><textarea class="form-input" id="m-notes" rows="3">${esc(m.notes || "")}</textarea></div>`;
        body.innerHTML = titleHtml + dateHtml + styleHtml + notesHtml;
        document
            .querySelectorAll("#m-style .style-opt")
            .forEach((opt) =>
                opt.addEventListener("click", function () {
                    document
                        .querySelectorAll("#m-style .style-opt")
                        .forEach((o) =>
                            o.classList.remove("selected"),
                        );
                    this.classList.add("selected");
                }),
            );
    } else if (type === "note") {
        const n = data || {};
        body.innerHTML = `<div class="form-group"><label class="form-label">Date *</label><input class="form-input" id="n-date" type="date" value="${n.date || todayStr()}"></div><div class="form-group"><label class="form-label">Content *</label><textarea class="form-input" id="n-content" rows="5">${esc(n.content || "")}</textarea></div>`;
    }
}

function quickAddAssignee(name) {
    if (!currentModal.assignees.includes(name))
        currentModal.assignees.push(name);
    refreshAssigneeUI();
}
function addCustomAssignee() {
    const inp = document.getElementById("custom-assignee-input");
    const name = (inp.value || "").trim();
    if (!name) return;
    if (!currentModal.assignees.includes(name))
        currentModal.assignees.push(name);
    inp.value = "";
    refreshAssigneeUI();
}
function addAssignee() {
    const inp = document.getElementById("assignee-input");
    const name = (inp.value || "").trim();
    if (!name) return;
    if (!currentModal.assignees.includes(name))
        currentModal.assignees.push(name);
    if (!S.savedAssignees.includes(name)) {
        S.savedAssignees.push(name);
        saveAssignees();
    }
    inp.value = "";
    hideAssigneeSuggestions();
    refreshAssigneeUI();
}
function refreshAssigneeUI() {
    const list = document.getElementById("assignee-list");
    if (list)
        list.innerHTML = currentModal.assignees
            .map(
                (p, i) =>
                    `<span class="assignee-remove-chip" onclick="removeAssignee(${i})">${esc(p)} ✕</span>`,
            )
            .join("");
    const quickRow = document.getElementById("quick-add-row");
    if (quickRow) {
        const pills = S.savedAssignees
            .filter((n) => !currentModal.assignees.includes(n))
            .slice(0, 8)
            .map(
                (n) =>
                    `<span class="quick-add-pill" onclick="quickAddAssignee('${esc(n)}')">${esc(n)}</span>`,
            )
            .join("");
        quickRow.style.display = pills ? "" : "none";
        if (pills)
            quickRow.innerHTML = `<span class="quick-add-label">Quick Add:</span>${pills}<button class="quick-add-settings-btn" onclick="openInlineSettings()" title="Manage names"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="3"></circle><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"></path></svg></button>`;
    }
}

function openInlineSettings() {
    const modalBody = document.getElementById("modal-body");
    if (!modalBody) return;

    const namesList = S.savedAssignees
        .map(
            (name, idx) => `
              <div class="settings-name-item">
                <span class="settings-name-text">${esc(name)}</span>
                <span class="settings-name-edit" onclick="editInlineName(${idx})" title="Edit">✎</span>
                <span class="settings-name-delete" onclick="deleteInlineName(${idx})" title="Delete">✕</span>
              </div>
            `,
        )
        .join("");

    const settingsHTML = `
              <div class="inline-settings-panel" id="inline-settings-panel">
                <div class="inline-settings-header">
                  <h3>Manage Names</h3>
                  <button class="inline-settings-close" onclick="closeInlineSettings()">✕</button>
                </div>
                <div class="inline-settings-body">
                  <div class="settings-input-row">
                    <input type="text" id="inline-name-input" placeholder="Enter a name..." class="settings-input">
                    <button class="btn btn-primary" onclick="addInlineName()">Add</button>
                  </div>
                  <div id="inline-names-list" class="settings-names-list">${namesList}</div>
                </div>
              </div>
            `;

    // Insert the settings panel after the quick-add row
    const quickRow = document.getElementById("quick-add-row");
    if (quickRow) {
        quickRow.insertAdjacentHTML("afterend", settingsHTML);
    }

    document.getElementById("inline-name-input").value = "";
    document.getElementById("inline-name-input").focus();
}

function closeInlineSettings() {
    const panel = document.getElementById("inline-settings-panel");
    if (panel) panel.remove();
}

function addInlineName() {
    const inp = document.getElementById("inline-name-input");
    const name = (inp.value || "").trim();
    if (!name) return;
    if (S.savedAssignees.includes(name)) {
        showToast("Name already exists");
        return;
    }
    S.savedAssignees.push(name);
    saveAssignees();
    inp.value = "";
    renderInlineNames();
    refreshAssigneeUI();
    showToast("Name added");
}

function deleteInlineName(idx) {
    const name = S.savedAssignees[idx];
    S.savedAssignees.splice(idx, 1);
    // Also remove from all items' assignee arrays so they disappear from filter
    S.items.forEach(item => {
        if (item.assignees && item.assignees.includes(name)) {
            item.assignees = item.assignees.filter(a => a !== name);
        }
    });
    // Remove from active filter selection if present
    if (filterUsers.has(name)) {
        filterUsers.delete(name);
        updateUserFilterLabel();
    }
    saveAssignees();
    saveToLocal();
    renderInlineNames();
    refreshAssigneeUI();
    render();
    showToast("Name removed");
}

function editInlineName(idx) {
    const name = S.savedAssignees[idx];
    const inp = document.getElementById("inline-name-input");
    inp.value = name;
    inp.focus();
    S.savedAssignees.splice(idx, 1);
    renderInlineNames();
    refreshAssigneeUI();
}

function renderInlineNames() {
    const list = document.getElementById("inline-names-list");
    if (!list) return;
    list.innerHTML = S.savedAssignees
        .map(
            (name, idx) => `
              <div class="settings-name-item">
                <span class="settings-name-text">${esc(name)}</span>
                <span class="settings-name-edit" onclick="editInlineName(${idx})" title="Edit">✎</span>
                <span class="settings-name-delete" onclick="deleteInlineName(${idx})" title="Delete">✕</span>
              </div>
            `,
        )
        .join("");
}
function showAssigneeSuggestions(query) {
    const dropdown = document.getElementById(
        "autocomplete-dropdown",
    );
    if (!query || !query.trim()) {
        hideAssigneeSuggestions();
        return;
    }
    const matches = S.savedAssignees.filter(
        (n) =>
            n.toLowerCase().includes(query.toLowerCase()) &&
            !currentModal.assignees.includes(n),
    );
    if (!matches.length) {
        hideAssigneeSuggestions();
        return;
    }
    dropdown.innerHTML = matches
        .map(
            (n) =>
                `<div class="autocomplete-item" onclick="selectAssignee('${esc(n)}')">${esc(n)}</div>`,
        )
        .join("");
    dropdown.style.display = "block";
}
function hideAssigneeSuggestions() {
    const d = document.getElementById("autocomplete-dropdown");
    if (d) d.style.display = "none";
}
function selectAssignee(name) {
    const inp = document.getElementById("assignee-input");
    inp.value = name;
    addAssignee();
}
function handleAssigneeKeydown(event) {
    const d = document.getElementById("autocomplete-dropdown");
    if (event.key === "Enter") {
        event.preventDefault();
        if (
            d.style.display === "block" &&
            d.querySelector(".autocomplete-item")
        )
            d.querySelector(".autocomplete-item").click();
        else addAssignee();
    } else if (event.key === "Escape") hideAssigneeSuggestions();
}
function removeAssignee(idx) {
    currentModal.assignees.splice(idx, 1);
    refreshAssigneeUI();
}

function saveModal() {
    const { type, editId } = currentModal;
    if (type === "fixture") {
        const opponent = document
            .getElementById("f-opponent")
            .value.trim();
        const date = document.getElementById("f-date").value;
        const venueType = document.querySelector(
            "#f-vtype .venue-opt.selected",
        )?.dataset.value;
        if (!opponent || !date || !venueType)
            return alert(
                "Opponent, date, and venue type are required",
            );
        const teamType =
            document.querySelector("#f-teamtype .team-opt.selected")
                ?.dataset.value || "Men's";
        const obj = {
            id: editId || uid(),
            type: "fixture",
            date,
            opponent,
            venue: document.getElementById("f-venue").value,
            matchType: document.getElementById("f-type").value,
            venueType,
            teamType,
            assignees: [],
        };
        if (editId)
            S.items[S.items.findIndex((i) => i.id === editId)] =
                obj;
        else S.items.push(obj);
    } else if (type === "activity") {
        const title = document
            .getElementById("a-title")
            .value.trim();
        const date = document.getElementById("a-date").value;
        const notes = document
            .getElementById("a-notes")
            .value.trim();
        if (!title || !date)
            return alert("Title and date are required");
        const existing = editId
            ? S.items.find((i) => i.id === editId)
            : null;
        const linkedFixtureInput = document.getElementById(
            "a-linked-fixture-id",
        );
        const selectedLinkedFixtureId = linkedFixtureInput
            ? (linkedFixtureInput.value ? JSON.parse(linkedFixtureInput.value) : [])
            : (Array.isArray(currentModal?.data?.linkedFixtureId) ? currentModal?.data?.linkedFixtureId :
              (currentModal?.data?.linkedFixtureId ? [currentModal?.data?.linkedFixtureId] : []) ||
              (existing ? (Array.isArray(existing.linkedFixtureId) ? existing.linkedFixtureId : (existing.linkedFixtureId ? [existing.linkedFixtureId] : [])) : []) ||
              (existing && existing.fixtureId ? [existing.fixtureId] : []) ||
              []);
        const placementMode =
            currentModal?.data?._placementMode ||
            (existing && existing.fixtureId
                ? "fixture"
                : "timeline");
        const resolvedFixtureId =
            placementMode === "fixture" && selectedLinkedFixtureId.length > 0
                ? selectedLinkedFixtureId[0]
                : null;
        const resolvedLinkedFixtureId =
            selectedLinkedFixtureId.length > 0
                ? selectedLinkedFixtureId
                : (placementMode === "fixture" && resolvedFixtureId ? [resolvedFixtureId] : []);

        const obj = {
            id: editId || uid(),
            type: "activity",
            date,
            title,
            actType: document.getElementById("a-type").value,
            assignees: currentModal.assignees,
            notes,
            complete: existing ? existing.complete : false,
            fixtureId: resolvedFixtureId,
            linkedFixtureId: resolvedLinkedFixtureId,
            clusterOrder: existing ? existing.clusterOrder : 0,
        };
        if (editId)
            S.items[S.items.findIndex((i) => i.id === editId)] =
                obj;
        else S.items.push(obj);
    } else if (type === "milestone") {
        const title = document
            .getElementById("m-title")
            .value.trim();
        const date = document.getElementById("m-date").value;
        const notes = document
            .getElementById("m-notes")
            .value.trim();
        const style =
            document.querySelector("#m-style .style-opt.selected")
                ?.dataset.value || "neutral";
        if (!title || !date)
            return alert("Title and date are required");
        const obj = {
            id: editId || uid(),
            type: "milestone",
            date,
            title,
            style,
            notes,
            assignees: [],
        };
        if (editId)
            S.items[S.items.findIndex((i) => i.id === editId)] =
                obj;
        else S.items.push(obj);
    } else if (type === "note") {
        const date = document.getElementById("n-date").value;
        const content = document
            .getElementById("n-content")
            .value.trim();
        if (!date || !content)
            return alert("Date and content are required");
        const obj = {
            id: editId || uid(),
            type: "note",
            date,
            content,
            assignees: [],
        };
        if (editId)
            S.items[S.items.findIndex((i) => i.id === editId)] =
                obj;
        else S.items.push(obj);
    }
    const openDropdowns = Array.from(
        document.querySelectorAll(".activity-cluster"),
    )
        .filter((el) => el.style.display !== "none")
        .map((el) => el.id.replace("cluster-", ""));
    save();
    closeModal();
    render();
    openDropdowns.forEach((fid) => {
        const cluster = document.getElementById("cluster-" + fid);
        const btn = document.querySelector(
            `[onclick="toggleActCluster('${fid}')"]`,
        );
        if (cluster) {
            cluster.style.display = "";
            if (btn)
                btn.textContent =
                    "▾ " +
                    cluster.querySelectorAll(".mini-activity")
                        .length +
                    " Matchday Activities";
        }
    });
    showToast("Changes saved");
}

// ─── DELETE ───────────────────────────────────────────────────
// FIX: deleteItem now records the item type in pendingDeleteOps before
// removing from S.items so saveToSupabase can issue the correct DELETE
// against the right table.
let pendingDeleteId = null;

function showDeleteConfirm(id) {
    pendingDeleteId = id;
    document.getElementById(
        "delete-confirm-overlay",
    ).style.display = "flex";
    document.getElementById("confirm-delete-btn").onclick = () => {
        if (!pendingDeleteId) return;
        // FIX: record all items being deleted (fixture cascades linked activities)
        const toDelete = S.items.filter(
            (i) =>
                i.id === pendingDeleteId ||
                i.fixtureId === pendingDeleteId,
        );
        toDelete.forEach((i) =>
            pendingDeleteOps.push({ id: i.id, type: i.type }),
        );
        const deletingFixture = S.items.find(
            (i) => i.id === pendingDeleteId && i.type === "fixture",
        );
        S.items = S.items.filter(
            (i) =>
                i.id !== pendingDeleteId &&
                i.fixtureId !== pendingDeleteId,
        );
        if (deletingFixture) {
            S.items.forEach((item) => {
                if (
                    item.type === "activity" &&
                    Array.isArray(item.linkedFixtureId) &&
                    item.linkedFixtureId.includes(pendingDeleteId)
                ) {
                    item.linkedFixtureId = item.linkedFixtureId.filter(id => id !== pendingDeleteId);
                }
            });
        }
        save();
        render();
        showToast("Item deleted");
        closeDeleteConfirm();
        pendingDeleteId = null;
    };
}

function closeDeleteConfirm() {
    document.getElementById(
        "delete-confirm-overlay",
    ).style.display = "none";
    pendingDeleteId = null;
}
function deleteItem(id) {
    showDeleteConfirm(id);
}
function deleteModalItem() {
    if (!currentModal.editId) return;
    closeModal();
    showDeleteConfirm(currentModal.editId);
}

// ─── COMPLETE CONFIRM ─────────────────────────────────────────
let pendingCompleteId = null;

function showCompleteConfirm(id) {
    pendingCompleteId = id;
    document.getElementById(
        "complete-confirm-overlay",
    ).style.display = "flex";
    document.getElementById("confirm-complete-btn").onclick =
        () => {
            if (!pendingCompleteId) return;
            const item = S.items.find(
                (i) => i.id === pendingCompleteId,
            );
            if (item) {
                const openDropdowns = Array.from(
                    document.querySelectorAll(".activity-cluster"),
                )
                    .filter((el) => el.style.display !== "none")
                    .map((el) => el.id.replace("cluster-", ""));
                item.complete = !item.complete;
                save();
                render();
                openDropdowns.forEach((fid) => {
                    const cluster = document.getElementById(
                        "cluster-" + fid,
                    );
                    const btn = document.querySelector(
                        `[onclick="toggleActCluster('${fid}')"]`,
                    );
                    if (cluster) {
                        cluster.style.display = "";
                        if (btn)
                            btn.textContent =
                                "▾ " +
                                cluster.querySelectorAll(
                                    ".mini-activity",
                                ).length +
                                " Matchday Activities";
                    }
                });
                showToast(
                    item.complete
                        ? "✓ Marked complete"
                        : "Marked incomplete",
                );
            }
            closeCompleteConfirm();
            pendingCompleteId = null;
        };
}
function closeCompleteConfirm() {
    document.getElementById(
        "complete-confirm-overlay",
    ).style.display = "none";
    pendingCompleteId = null;
}

// ─── MOVE CONFIRM ───────────────────────────────────────────────
let pendingMoveData = null;

function showMoveConfirm(group, draggedRow, clientY, dateItems, originalParent, originalNextSibling) {
    pendingMoveData = { group, draggedRow, clientY, dateItems, originalParent, originalNextSibling };
    document.getElementById("move-confirm-overlay").style.display = "flex";
    document.getElementById("confirm-move-btn").onclick = () => {
        if (!pendingMoveData) return;
        executeTimelineDrop(
            pendingMoveData.group,
            pendingMoveData.draggedRow,
            pendingMoveData.clientY,
            pendingMoveData.dateItems,
        );
        closeMoveConfirm();
        pendingMoveData = null;
    };
}

function closeMoveConfirm() {
    document.getElementById("move-confirm-overlay").style.display = "none";
    // Restore the dragged row to its original position if cancelled
    if (pendingMoveData && pendingMoveData.originalParent) {
        if (pendingMoveData.originalNextSibling) {
            pendingMoveData.originalParent.insertBefore(
                pendingMoveData.draggedRow,
                pendingMoveData.originalNextSibling
            );
        } else {
            pendingMoveData.originalParent.appendChild(pendingMoveData.draggedRow);
        }
    }
    pendingMoveData = null;
}

// ─── DATE POPUP ───────────────────────────────────────────────
let currentPopupDate = null;

let _lastClickedDate = null;

function handleDateLabelClick(dateStr, el) {
    if (_lastClickedDate === dateStr) {
        // Second click on the same label — open popup
        _lastClickedDate = null;
        showDatePopup(dateStr);
    } else {
        // First click — scroll to date
        _lastClickedDate = dateStr;
        const dg = el.closest(".date-group");
        if (dg)
            window.scrollTo({
                top:
                    window.pageYOffset +
                    dg.getBoundingClientRect().top -
                    80,
                behavior: "smooth",
            });
        // Reset after 2 s so a long pause starts the sequence over
        setTimeout(() => {
            if (_lastClickedDate === dateStr)
                _lastClickedDate = null;
        }, 2000);
    }
}

function copyDateLink(dateStr) {
    document.querySelectorAll(".date-label").forEach((label) => {
        if (label.dataset.date !== dateStr) return;
        const dg = label.closest(".date-group");
        if (dg)
            window.scrollTo({
                top:
                    window.pageYOffset +
                    dg.getBoundingClientRect().top -
                    80,
                behavior: "smooth",
            });
    });
}
function showDatePopup(dateStr) {
    currentPopupDate = dateStr;
    document.getElementById("popup-current-date").textContent =
        fmtDisplay(dateStr);
    document.getElementById("popup-date-input").value = dateStr;
    document.getElementById("date-popup-overlay").style.display =
        "flex";
}
function closeDatePopup() {
    document.getElementById("date-popup-overlay").style.display =
        "none";
    currentPopupDate = null;
}
function goToDate() {
    const newDate =
        document.getElementById("popup-date-input").value;
    if (!newDate) {
        alert("Please select a date");
        return;
    }
    let nearest = null,
        nearestDist = Infinity;
    document.querySelectorAll(".date-label").forEach((label) => {
        const dist = Math.abs(
            new Date(newDate) - new Date(label.dataset.date),
        );
        if (label.dataset.date === newDate) {
            const dg = label.closest(".date-group");
            if (dg)
                window.scrollTo({
                    top:
                        window.pageYOffset +
                        dg.getBoundingClientRect().top -
                        80,
                    behavior: "smooth",
                });
        } else if (dist < nearestDist) {
            nearestDist = dist;
            nearest = label;
        }
    });
    if (nearest) {
        const dg = nearest.closest(".date-group");
        if (dg) {
            window.scrollTo({
                top:
                    window.pageYOffset +
                    dg.getBoundingClientRect().top -
                    80,
                behavior: "smooth",
            });
            showToast(
                `Nearest date: ${fmtDisplay(nearest.dataset.date)}`,
            );
        }
    }
    closeDatePopup();
}
document
    .getElementById("date-popup-overlay")
    .addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeDatePopup();
    });

// ─── SETTINGS MODAL ───────────────────────────────────────────
function updateSyncStatus() {
    const el = document.getElementById("sync-status");
    if (!el) return;
    if (!supabaseClient) {
        el.textContent =
            "⚠ Supabase not initialised — check credentials in HTML";
        el.style.cssText =
            "color:var(--orange);background:rgba(232,102,10,0.1);border-color:var(--orange);font-size:12px;padding:8px 12px;border-radius:6px;border:1px solid;margin-bottom:12px;";
    } else if (useCloudSync) {
        el.textContent = "✓ Cloud sync active — saving to Supabase";
        el.style.cssText =
            "color:var(--green);background:rgba(46,125,50,0.1);border-color:var(--green);font-size:12px;padding:8px 12px;border-radius:6px;border:1px solid;margin-bottom:12px;";
    } else {
        el.textContent =
            "⚠ Cloud sync disabled — local storage only";
        el.style.cssText =
            "color:var(--orange);background:rgba(232,102,10,0.1);border-color:var(--orange);font-size:12px;padding:8px 12px;border-radius:6px;border:1px solid;margin-bottom:12px;";
    }
}

// ─── TOASTS ───────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 4000) {
    const c = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${esc(msg)}</span>`;
    c.appendChild(el);
    setTimeout(() => el.remove(), duration);
}

function showOfflineBanner(show = true) {
    const banner = document.getElementById("offline-banner");
    if (!banner) return;
    if (show) {
        banner.classList.add("show");
        document.body.style.paddingTop = "56px + 34px";
    } else {
        banner.classList.remove("show");
        document.body.style.paddingTop = "0";
    }
}

function updateConnectionIndicator(status) {
    const indicator = document.getElementById("connection-indicator");
    if (!indicator) return;

    let statusText = "Online";
    let statusClass = "good";

    if (status.status === "offline") {
        statusText = "Offline";
        statusClass = "offline";
        showOfflineBanner(true);
    } else if (status.status === "connected") {
        showOfflineBanner(false);
        if (status.latency > 1000) {
            statusText = "Slow";
            statusClass = "poor";
        } else if (status.latency > 500) {
            statusText = "Fair";
            statusClass = "fair";
        } else {
            statusText = "Good";
            statusClass = "good";
        }
    }

    indicator.className = statusClass;
    indicator.innerHTML = `<span class="connection-dot"></span><span>${statusText}</span>`;
}

// ─── DOT HOVER ANIMATIONS ─────────────────────────────────────
function setupDotHoverAnimations() {
    document
        .querySelectorAll(".tl-row.side-left .node-dot")
        .forEach((dot) => {
            const row = dot.closest(".tl-row.side-left");
            const cardWrap = row?.querySelector(".tl-card-wrap");
            if (!cardWrap) return;
            cardWrap
                .querySelectorAll(
                    ".fixture-card,.activity-card,.milestone-card,.note-card",
                )
                .forEach((card) => {
                    dot.addEventListener("mouseenter", () => {
                        card.classList.add("card-highlight");
                        if (dot.classList.contains("fixture-dot"))
                            card.classList.add("highlight-red");
                        else if (
                            dot.classList.contains("milestone-dot")
                        )
                            card.classList.add("highlight-gold");
                        else if (dot.classList.contains("past-dot"))
                            card.classList.add("highlight-past");
                        else if (
                            dot.classList.contains("complete-dot")
                        )
                            card.classList.add(
                                "highlight-complete",
                            );
                    });
                    dot.addEventListener("mouseleave", () => {
                        card.classList.remove(
                            "card-highlight",
                            "highlight-red",
                            "highlight-gold",
                            "highlight-past",
                            "highlight-complete",
                        );
                    });
                });
        });
}

// ─── BOOTSTRAP ────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); closeUserFilter(); }
});

const _baseRender = render;
render = function () {
    _baseRender.apply(this, arguments);
    setTimeout(setupDotHoverAnimations, 100);
};

document
    .getElementById("brand-logo-wrap")
    .addEventListener("click", () => {
        document.getElementById("today-marker")?.scrollIntoView({
            behavior: "smooth",
            block: "center",
        });
    });

initAuth(); // load() and setupRealtime() fire only after password confirmed
