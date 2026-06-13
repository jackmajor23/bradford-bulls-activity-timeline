# Quick Reference Card

## Core Classes

### DeviceManager
```javascript
const dm = new DeviceManager();
dm.getOrCreateDeviceId()           // Get unique ID
dm.generateDeviceSignature()        // Get fingerprint
dm.getDeviceInfo()                  // Full device details
```

### ConflictResolver
```javascript
const cr = new ConflictResolver('last-write-wins');
cr.detectConflict(local, remote)    // Check for conflict
cr.resolve(conflict)                // Get resolution
cr.getConflictLog()                 // View history
```

### SyncQueue
```javascript
const sq = new SyncQueue();
sq.enqueue(op, priority)            // Add to queue
sq.dequeue()                        // Get next op
sq.getStats()                       // Queue status
sq.recordAttempt(opId)              // Track retry
```

### ConnectionMonitor
```javascript
const cm = new ConnectionMonitor(supabaseClient);
cm.startHeartbeat(callback)         // Start monitoring
cm.getStatus()                      // Current status
cm.isOnline()                       // Boolean
cm.stop()                           // Stop monitoring
```

### NotificationManager
```javascript
const nm = new NotificationManager();
nm.notify(msg, type, duration)      // Show notification
nm.syncStarted()                    // Sync beginning
nm.syncSuccess()                    // Sync complete
nm.syncFailed(reason)               // Sync error
nm.conflictDetected(conflict)       // Conflict warning
nm.offlineMode()                    // Offline indicator
nm.backOnline()                     // Back online
nm.getAll()                         // Current notifications
nm.clear()                          // Clear all
```

---

## Configuration Constants

```javascript
// Core timing
DEBOUNCE_MS = 1200                  // Wait for more changes
SAVE_BATCH_WINDOW_MS = 2000         // Group operations
HEARTBEAT_INTERVAL_MS = 30000       // Check connection
SELF_EVENT_SUPPRESSION_MS = 2500    // Ignore own events

// Retry strategy
MAX_RETRIES = 5                     // Max attempts
RETRY_DELAY_MS = 1000              // Initial wait
RETRY_BACKOFF_FACTOR = 1.5         // Exponential multiplier

// Rate limiting
MAX_OPS_PER_SECOND = 10            // Max throughput
MAX_PAYLOAD_KB = 1024              // Max request size

// Sessions
SESSION_DURATION_MS = 2592000000   // 30 days
REFRESH_WARNING_MS = 300000        // 5 min warning
```

---

## Usage Patterns

### Initialize System
```javascript
const deviceManager = new DeviceManager();
const conflictResolver = new ConflictResolver('last-write-wins');
const syncQueue = new SyncQueue();
const connectionMonitor = new ConnectionMonitor(supabaseClient);
const notificationManager = new NotificationManager();

connectionMonitor.startHeartbeat((status) => {
  console.log('Connection:', status);
  if (!status.isOnline) {
    notificationManager.offlineMode();
  }
});
```

### Sync with Conflict Resolution
```javascript
async function syncItem(item) {
  // Get remote version
  const remote = await loadFromCloud(item.id);
  
  // Check for conflict
  const conflict = conflictResolver.detectConflict(item, remote);
  
  if (conflict) {
    // Resolve automatically
    const resolution = conflictResolver.resolve(conflict);
    item = resolution.merged;  // Use merged version
  }
  
  // Queue for sync
  syncQueue.enqueue({ 
    type: 'upsert', 
    data: item,
    priority: 'high'
  });
  
  notificationManager.notify('Syncing...', 'info');
}
```

### Handle Connection Changes
```javascript
connectionMonitor.startHeartbeat((status) => {
  if (status.status === 'connected') {
    notificationManager.notify('✓ Back online', 'success', 2000);
    processOfflineQueue();  // Sync queued items
  } else if (status.status === 'offline') {
    notificationManager.offlineMode();  // Persistent warning
  } else if (status.status === 'slow') {
    notificationManager.notify('⚠ Slow connection', 'warning', 5000);
  }
});
```

---

## Debugging Commands

```javascript
// Check everything
deviceManager.getDeviceInfo()
connectionMonitor.getStatus()
syncQueue.getStats()
conflictResolver.getConflictLog()

// Check specific
S.items                                      // All data
S.items.find(i => i.id === 'xyz')          // Find item
localStorage.getItem('bbTimeline_v5')       // Saved state
localStorage.getItem('bbTimeline_offlineQueue_v2')  // Queue

// Manual triggers
window.dispatchEvent(new Event('online'))   // Trigger online
window.dispatchEvent(new Event('offline'))  // Trigger offline
connectionMonitor.checkConnection()         // Force check

// Export report
const report = {
  device: deviceManager.getDeviceInfo(),
  connection: connectionMonitor.getStatus(),
  queue: syncQueue.getStats(),
  conflicts: conflictResolver.getConflictLog()
};
```

---

## Common Scenarios

### User Edits While Offline
```javascript
// User action
editItem(item);
saveToLocal();

// System detects offline
if (!connectionMonitor.isOnline()) {
  syncQueue.enqueue(op);  // Queue it
  notificationManager.offlineMode();
}

// User comes online
// → Heartbeat detects connection
// → Process all queued operations
// → Sync to Supabase
// → Notify user
```

### Two Users Edit Same Item
```javascript
// User A edits
conflictResolver.detectConflict(localA, remoteB);

// Conflict found:
resolution = conflictResolver.resolve({
  field: 'opponent',
  localValue: 'Leeds',
  remoteValue: 'Halifax',
  localTimestamp: 1700000000,
  remoteTimestamp: 1700000010
});

// Apply resolution (remote is newer)
item.opponent = 'Halifax';
conflictResolver.logConflict(resolution);
notificationManager.conflictDetected(resolution);
```

### Check Connection Quality
```javascript
const status = connectionMonitor.getStatus();

if (status.latency < 200) {
  console.log('✓ Excellent connection');
  DEBOUNCE_MS = 800;  // Sync faster
} else if (status.latency < 1000) {
  console.log('✓ Good connection');
  DEBOUNCE_MS = 1200;  // Normal speed
} else {
  console.log('⚠ Slow connection');
  DEBOUNCE_MS = 3000;  // Sync slower
}
```

---

## Security Checklist

```
Password Auth:      sha256(password) === stored hash ✓
Sessions:           Expire after 30 days ✓
Device Tracking:    Each device gets unique ID ✓
XSS Prevention:     All input escaped with esc() ✓
HTTPS/TLS:          All Supabase calls use https:// ✓
Rate Limiting:      Max 10 ops/sec ✓
RLS Policies:       Server-side access control ✓
```

---

## Notification Types

| Type | Duration | Usage |
|------|----------|-------|
| `success` | 2s | Operation succeeded |
| `info` | 4s | Informational message |
| `warning` | 5s | Potential issue |
| `error` | 6s | Operation failed |
| `offline` | ∞ | No internet connection |
| `sync` | 1-3s | Sync status updates |

---

## Conflict Resolution Strategies

| Strategy | When to Use | Result |
|----------|------------|--------|
| `last-write-wins` | Default, most edits | Remote version wins if newer |
| `merge` | Arrays, lists | Intelligently combine both |
| `local-priority` | Safety critical | Always keep local |
| `manual` | Important decisions | Show UI prompt |

---

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Optimistic update | <50ms | ✓ |
| Cloud sync latency | <2s | ✓ |
| Realtime broadcast | <500ms | ✓ |
| Conflict detection | <100ms | ✓ |
| Offline recovery | Instant | ✓ |
| Device ID generation | <5ms | ✓ |

---

## Troubleshooting Quick Guide

| Problem | Check | Solution |
|---------|-------|----------|
| No sync | `connectionMonitor.getStatus()` | Check connection |
| Data missing | `localStorage.getItem('bbTimeline_v5')` | Restore from backup |
| Conflicts loop | `conflictResolver.strategy` | Change strategy |
| Offline queue stuck | `window.dispatchEvent(new Event('online'))` | Trigger retry |
| Session expired | `Date.now() > session.expiresAt` | Re-authenticate |

---

## See Also

- **ENHANCED_SETUP.md** — Quick start guide
- **SYNC_FEATURES.md** — Complete feature reference  
- **SYNC_INTEGRATION_GUIDE.md** — Implementation details
- **sync-config.js** — Full source code
- **IMPLEMENTATION_SUMMARY.md** — Project overview
