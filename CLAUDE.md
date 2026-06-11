# Bradford Bulls Activity Timeline — AI Context Doc

## Purpose
Single-file HTML/JS/CSS app (`index.html`) for managing Bradford Bulls fixtures, activities, milestones, and notes on a visual timeline. Cloud-synced via Supabase.

## Architecture

### Data Model (`S.items` array)
Each item has: `{ id, type, date, ...type-specific fields }`

| type | key fields |
|------|-----------|
| fixture | opponent, venue, venueType (home/away/neutral), matchType, teamType, assignees[] |
| activity | title, actType, assignees[], notes, complete, fixtureId (nullable — links to fixture) |
| milestone | title, style (red/gold/neutral), notes |
| note | content |

### Persistence
- **Primary**: Supabase (4 tables: fixtures, activities, milestones, notes)
- **Fallback**: localStorage key `bbTimeline_v5`
- Assignees stored in `S.savedAssignees[]`, key `bbAssignees`
- Logo cache: localStorage `bbLogoCache_v1`
- Auth session: localStorage `bbTimeline_auth` (30-day expiry, SHA-256 hashed password)

### Supabase Tables
```
fixtures:   id, opponent, "venue type", match_venue, competition, team_type, date
activities: id, title, type, date, completed, assignees[], notes, fixture_id (FK)
milestones: id, title, color, date, notes
notes:      id, content, date
```

### Sync Flow
1. `initAuth()` → checks session → calls `load()` + `setupRealtime()`
2. `load()` → `loadFromCloud()` → loads local first, then Supabase overwrites
3. `save()` → `saveToLocal()` + debounced (800ms) `saveToSupabase()`
4. Realtime: postgres_changes subscriptions → `handleRealtimeEvent()` → incremental merge
5. Self-event suppression: `lastWriteTime` stamp (1500ms window)
6. Explicit deletes tracked in `pendingDeleteOps[]` before upsert

### Render Pipeline
`render()` → `buildGroups()` (groups items by date, attaches activities to fixtures) →
`renderDateGroup()` → `renderFixtureGroup/ActivityGroup/MilestoneGroup/NoteGroup()`
→ `attachEvents()` (drag, touch handlers) → `setupDotHoverAnimations()`

### Key Global State
```js
S = { items: [], savedAssignees: [] }   // Main state
currentModal = { type, editId, data, assignees }  // Active modal
dragActivityId, isDraggingActivity, dragEndTime    // Drag state
lastWriteTime, pendingDeleteOps, saveDebounceTimer  // Sync state
```

### Logo System
- `KNOWN_LOGOS` map: static club → URL mappings (Wikipedia CDN)
- `getTeamLogo(name)` → sync, returns URL or null (triggers async discovery)
- `discoverLogoAsync(name)` → Wikipedia API → updates DOM via `updateLogoInDOM()`
- `logoCache` (localStorage) caches results including NOT_FOUND sentinel

### Auth
- SHA-256 hash of password stored in `PASSWORD_HASH` constant
- `submitPassword()` → hash compare → `writeSession()` → `dismissAuthGate()`
- Gate overlay `#auth-gate` shown until valid session

### Drag & Drop
**Desktop**: HTML5 dragstart/dragend/dragover/drop on `.mini-activity`, `.fixture-card`, etc.
- Dragging onto `.fixture-card` → links activity to fixture (sets `fixtureId`)
- Dragging within `.activity-cluster` → reorders activities
- Dragging onto `.date-group` → updates item date

**Mobile**: Touch events (touchstart/touchmove/touchend) with ghost clone element
- Ghost: `#touch-drag-ghost` div, positioned via `touch.clientX/Y`
- Drop targets: `.activity-cluster` and `.date-group`

### Modal System
`openModal(type, id?)` → `renderModal()` → form HTML injected into `#modal-body`
`saveModal()` → validates → upserts to `S.items` → `save()` → `render()`

### Key DOM IDs
- `#timeline-content` — main render target
- `#modal-overlay` — add/edit modal
- `#skeleton-screen` — loading state
- `#auth-gate` — password gate
- `#past-accordion` / `#past-items` / `#past-toggle` — collapsible past events
- `#today-marker` — red "Today" divider
- `#toast-container` — notification toasts
- `#settings-overlay` — assignee/sync settings
- `#date-popup-overlay` — date jump modal
- `cluster-{fixtureId}` — activity clusters per fixture
- `fc-{id}`, `act-{id}`, `milestone-{id}`, `note-{id}` — individual cards

### CSS Variables
```css
--bg, --card, --red, --red-dark, --gold, --gold-light
--ink, --ink-mid, --ink-light, --line
--blue (activities), --orange, --purple, --green
--home (#1A4F8B), --away (#E8660A), --neutral (#6B3FA0)
--font-display (Bebas Neue), --font-body (DM Sans)
```

### Activity Types
social, email, pr, matchday, digital, print, event, photo, interview, website, other

### Team Types
Men's, Women's, Reserves, Academy, Scholarship, Wheelchair, PD/LDRL

## Common Patterns

**Add new item type**: add to `buildGroups()`, add `render*Group()` fn, add modal case in `renderModal()` + `saveModal()`, add Supabase table + upsert in `saveToSupabase()`, add converter in `convertSupabaseRecord()`

**Debug sync**: open console, watch for "✓ Saved to Supabase" / "Realtime status:" logs. Check `lastWriteTime` for self-suppression issues.

**Modify logo lookup**: edit `KNOWN_LOGOS` map for static overrides, or `discoverLogoAsync()` for API logic.

## Security Notes
- Supabase anon key is intentionally public (publishable key) — RLS policies on all tables
- Password: SHA-256 hash only in source, never plaintext
- XSS: `esc()` helper used on all user content in render functions
- The anon key only allows what RLS permits — review policies in Supabase dashboard
