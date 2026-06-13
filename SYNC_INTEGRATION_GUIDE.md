# Bradford Bulls Timeline — Enhanced Sync Integration Guide

## Overview

This guide shows how to integrate the advanced sync system (`sync-config.js`) with your existing Bradford Bulls Activity Timeline to achieve:

- **Multi-device sync** with conflict resolution
- **Offline-first** operation with automatic cloud sync
- **Advanced notifications** for sync status
- **Device tracking** and presence detection
- **Connection quality** monitoring
- **Session management** with refresh logic
- **Rate limiting** and request queuing

---

## Quick Start

### 1. Add the Sync Script to HTML

Add this to your `<head>` before the main script:

```html
<script src="sync-config.js"></script>
```

### 2. Initialize Sync System in JavaScript

```javascript
// After Supabase client initialization
const deviceManager = new window.SyncSystem.DeviceManager();
const conflictResolver = new window.SyncSystem.ConflictResolver('last-write-wins');
const syncQueue = new window.SyncSystem.SyncQueue();
const connectionMonitor = new window.SyncSystem.ConnectionMonitor(supabaseClient);
const notificationManager = new window.SyncSystem.NotificationManager();

// Start connection monitoring
connectionMonitor.startHeartbeat((status) => {
  console.log('Connection status:', status);
  if (status.status === 'offline') {
    notificationManager.offlineMode();
  } else if (status.status === 'connected') {
    notificationManager.backOnline();
  }
});
```

---

## Features & Implementation

### A. Device Identification

Every user's device gets a unique ID that persists across sessions:

```javascript
// Automatically generated and stored
const deviceInfo = deviceManager.getDeviceInfo();
console.log(deviceInfo);
// Output:
// {
//   id: "550e8400-e29b-41d4-a716-446655440000",
//   signature: "abc123def456",
//   lastActivity: 1718292000000,
//   userAgent: "Mozilla/5.0...",
//   isOnline: true,
//   platform: "MacIntel"
// }
```

**Use Cases:**
- Track which device edited an item
- Implement device-specific caching
- Support multi-device conflict resolution

---

### B. Conflict Detection & Resolution

Automatically detects when multiple users/devices edit the same item:

```javascript
// When pulling remote changes
const conflict = conflictResolver.detectConflict(localItem, remoteItem);

if (conflict) {
  const resolution = conflictResolver.resolve(conflict);
  
  switch (resolution.winner) {
    case 'remote':
      // Use remote version
      S.items = S.items.map(i => i.id === conflict.id ? resolution.resolvedItem : i);
      notificationManager.conflictDetected(conflict.type);
      break;
      
    case 'merged':
      // Use intelligently merged version
      S.items = S.items.map(i => i.id === conflict.id ? resolution.resolvedItem : i);
      break;
  }
  
  save();
  render();
}
```

**Strategies:**
- `last-write-wins`: Remote version takes priority if more recent
- `merge`: Intelligently combines both versions (preserves unique data)
- `local-priority`: Always use local version
- `manual`: Flag for user decision

---

### C. Sync Queue with Retry Logic

Queue saves and automatically retry with exponential backoff:

```javascript
// Enqueue a save operation
const opId = syncQueue.enqueue({
  type: 'fixture',
  itemId: fixtureId,
  action: 'create',
  payload: fixtureData,
  priority: window.SyncSystem.SyncPriority.HIGH, // Direct user action
});

// Process queue
async function processSyncQueue() {
  while (syncQueue.peek()) {
    const op = syncQueue.dequeue();
    
    try {
      const success = await executeSyncOperation(op);
      
      const { shouldRetry, retryCount, retryAfterMs } = 
        syncQueue.recordAttempt(op.id, success);
      
      if (shouldRetry) {
        // Re-enqueue for retry
        setTimeout(() => {
          syncQueue.enqueue(op);
          processSyncQueue();
        }, retryAfterMs);
      }
    } catch (error) {
      const { shouldRetry, retryCount } = 
        syncQueue.recordAttempt(op.id, false, error);
      
      if (shouldRetry) {
        console.log(`Retry ${retryCount}/${SYNC_CONFIG.MAX_RETRIES}`);
      } else {
        console.error(`Max retries exceeded for operation ${op.id}`);
        notificationManager.syncFailed(error.message);
      }
    }
  }
}
```

**Priority Levels:**
- `CRITICAL` (0): Auth, security operations
- `HIGH` (1): Direct user actions
- `NORMAL` (2): Scheduled syncs
- `LOW` (3): Background cleanup

---

### D. Connection Quality Monitoring

Track internet connection quality and adapt behavior:

```javascript
// Check current connection status
const status = connectionMonitor.getStatus();
console.log(status);
// Output:
// {
//   isOnline: true,
//   connectionQuality: 'good', // 'good', 'fair', 'poor'
//   lastHeartbeat: 1718292000000,
//   timeSinceHeartbeat: 1234
// }

// Adapt sync strategy based on quality
if (status.connectionQuality === 'poor') {
  // Use smaller batch sizes, longer debounce
  SYNC_CONFIG.DEBOUNCE_MS = 3000;
} else {
  SYNC_CONFIG.DEBOUNCE_MS = 1200;
}
```

---

### E. Advanced Notifications

Replace basic toasts with rich notification system:

```javascript
// Auto-managed notifications
notificationManager.syncStarted();        // Persistent until dismissed
notificationManager.syncSuccess();        // Auto-dismisses in 2s
notificationManager.syncFailed('Network timeout'); // 6s
notificationManager.conflictDetected('activity');  // 5s
notificationManager.offlineMode();        // Persistent
notificationManager.backOnline();         // 3s
notificationManager.sessionExpiring();    // Persistent with action

// Custom notifications
notificationManager.notify('info', 'Custom message', {
  duration: 5000,
  action: {
    label: 'Retry',
    handler: () => { /* ... */ }
  }
});

// Get all active notifications
const notifications = notificationManager.getAll();
```

---

### F. Enhanced Sync with Metadata

Track sync state on each item:

```javascript
// When saving, add metadata
const itemWithMetadata = {
  ...item,
  _deviceId: deviceManager.deviceId,
  _lastModified: Date.now(),
  _synced: false,
  _syncAttempts: 0,
};

// In realtime handler, check metadata for conflicts
function handleRealtimeEvent(payload, itemType) {
  const remoteItem = convertSupabaseRecord(payload.new, itemType);
  const localItem = S.items.find(i => i.id === remoteItem.id);
  
  if (localItem) {
    const conflict = conflictResolver.detectConflict(localItem, remoteItem);
    if (conflict) {
      const resolution = conflictResolver.resolve(conflict);
      // Apply resolution...
      return;
    }
  }
  
  // Normal update
  const idx = S.items.findIndex(i => i.id === remoteItem.id);
  if (idx >= 0) {
    S.items[idx] = { ...remoteItem, _synced: true };
  } else {
    S.items.push({ ...remoteItem, _synced: true });
  }
}
```

---

## Enhanced save() Function

Here's how to enhance your existing `save()` function:

```javascript
function save() {
  // Update device activity
  deviceManager.updateLastActivity();
  
  saveToLocal();
  
  if (!useCloudSync) return;
  
  // Clear previous debounce timer
  clearTimeout(saveDebounceTimer);
  
  // Debounce cloud save
  saveDebounceTimer = setTimeout(async () => {
    // Add device metadata
    S.items.forEach(item => {
      if (!item._deviceId) item._deviceId = deviceManager.deviceId;
      item._lastModified = Date.now();
    });
    
    // Show sync in progress
    const notif = notificationManager.syncStarted();
    
    try {
      const success = await saveToSupabase();
      
      if (success) {
        S.items.forEach(item => { item._synced = true; });
        notificationManager.dismiss(notif.id);
        notificationManager.syncSuccess();
      } else {
        notificationManager.syncFailed('Unknown error');
      }
    } catch (error) {
      notificationManager.syncFailed(error.message);
    }
  }, SYNC_CONFIG.DEBOUNCE_MS);
}
```

---

## Rate Limiting Implementation

Prevent request flooding:

```javascript
class RateLimiter {
  constructor(maxOpsPerSecond) {
    this.maxOpsPerSecond = maxOpsPerSecond;
    this.operations = [];
  }

  async waitIfNeeded() {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    
    // Remove old operations
    this.operations = this.operations.filter(t => t > oneSecondAgo);
    
    if (this.operations.length >= this.maxOpsPerSecond) {
      const oldestOp = this.operations[0];
      const waitTime = oldestOp + 1000 - now;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.operations.shift();
    }
    
    this.operations.push(now);
  }
}

const rateLimiter = new RateLimiter(SYNC_CONFIG.MAX_OPS_PER_SECOND);

async function saveToSupabase() {
  await rateLimiter.waitIfNeeded();
  // ... proceed with save
}
```

---

## Security: Session Management

Enhanced session handling with refresh:

```javascript
class SessionManager {
  constructor() {
    this.SESSION_KEY = 'bbTimeline_auth_v2';
    this.SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
    this.REFRESH_BUFFER_MS = 60 * 60 * 1000; // Refresh 1 hour before expiry
    this.refreshInterval = null;
  }

  createSession(passwordHash) {
    const session = {
      hash: passwordHash,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.SESSION_DURATION_MS,
      deviceId: deviceManager.deviceId,
      nonce: Math.random().toString(36).slice(2),
    };
    
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    this.setupRefreshTimer();
    return session;
  }

  isValid() {
    const session = this.getSession();
    if (!session) return false;
    
    const now = Date.now();
    const expiresAt = session.expiresAt || 0;
    
    return now < expiresAt;
  }

  getSession() {
    try {
      return JSON.parse(localStorage.getItem(this.SESSION_KEY) || '{}');
    } catch {
      return null;
    }
  }

  setupRefreshTimer() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    
    this.refreshInterval = setInterval(() => {
      const session = this.getSession();
      if (!session) return;
      
      const now = Date.now();
      const timeUntilExpiry = (session.expiresAt || 0) - now;
      
      if (timeUntilExpiry < this.REFRESH_BUFFER_MS) {
        notificationManager.sessionExpiring();
      }
      
      if (timeUntilExpiry <= 0) {
        this.clearSession();
        notificationManager.notify('warning', 'Your session has expired. Please log in again.');
        location.reload();
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  clearSession() {
    localStorage.removeItem(this.SESSION_KEY);
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  logout() {
    this.clearSession();
    S.items = [];
    S.savedAssignees = [];
    saveToLocal();
    render();
  }
}

const sessionManager = new SessionManager();
```

---

## Offline-First Architecture

Enable reliable offline operation:

```javascript
class OfflineQueue {
  constructor() {
    this.QUEUE_KEY = 'bbTimeline_offlineQueue_v2';
    this.queue = [];
    this.loadQueue();
  }

  add(operation) {
    this.queue.push({
      ...operation,
      queuedAt: Date.now(),
    });
    this.saveQueue();
  }

  getAll() {
    return [...this.queue];
  }

  remove(operationId) {
    this.queue = this.queue.filter(op => op.id !== operationId);
    this.saveQueue();
  }

  clear() {
    this.queue = [];
    this.saveQueue();
  }

  saveQueue() {
    try {
      localStorage.setItem(this.QUEUE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.warn('Failed to save offline queue:', e);
    }
  }

  loadQueue() {
    try {
      const data = localStorage.getItem(this.QUEUE_KEY);
      this.queue = data ? JSON.parse(data) : [];
    } catch {
      this.queue = [];
    }
  }

  getSize() {
    return this.queue.length;
  }
}

const offlineQueue = new OfflineQueue();

// When coming back online, process queued operations
async function processPendingOperations() {
  const pending = offlineQueue.getAll();
  
  for (const op of pending) {
    try {
      await executeOperation(op);
      offlineQueue.remove(op.id);
      notificationManager.notify('info', `Synced: ${op.type}`);
    } catch (error) {
      console.error('Failed to process pending operation:', error);
      // Leave in queue for retry
    }
  }
}

// Listen for connection restoration
window.addEventListener('online', () => {
  notificationManager.backOnline();
  processPendingOperations();
});
```

---

## Monitoring & Debugging

```javascript
class SyncDebugger {
  constructor() {
    this.events = [];
    this.MAX_EVENTS = 500;
  }

  log(type, data) {
    this.events.push({
      timestamp: Date.now(),
      type,
      data,
    });
    
    if (this.events.length > this.MAX_EVENTS) {
      this.events.shift();
    }
  }

  export() {
    return {
      events: this.events,
      deviceInfo: deviceManager.getDeviceInfo(),
      syncStats: syncQueue.getStats(),
      connectionStatus: connectionMonitor.getStatus(),
      queuedNotifications: notificationManager.getAll(),
      conflictLog: conflictResolver.getConflictLog(),
      timestamp: Date.now(),
    };
  }

  printReport() {
    const report = this.export();
    console.group('🔍 Sync System Report');
    console.table(report.deviceInfo);
    console.table(report.syncStats);
    console.table(report.connectionStatus);
    console.log('Recent Events:', report.events.slice(-10));
    console.log('Conflict Log:', report.conflictLog);
    console.groupEnd();
  }
}

const debugger = new SyncDebugger();

// Use in browser console:
// debugger.export()  // Get full report object
// debugger.printReport()  // Print formatted report
// debugger.events  // View recent events
```

---

## Configuration Tuning

Adjust these values based on your use case:

```javascript
// Faster sync for real-time collaboration
SYNC_CONFIG.DEBOUNCE_MS = 500;
SYNC_CONFIG.HEARTBEAT_INTERVAL_MS = 10000;

// Slower sync for limited bandwidth
SYNC_CONFIG.DEBOUNCE_MS = 5000;
SYNC_CONFIG.HEARTBEAT_INTERVAL_MS = 60000;
SYNC_CONFIG.SAVE_BATCH_WINDOW_MS = 5000;

// Aggressive retry for unreliable networks
SYNC_CONFIG.MAX_RETRIES = 10;
SYNC_CONFIG.RETRY_DELAY_MS = 2000;

// Conservative retry for stable networks
SYNC_CONFIG.MAX_RETRIES = 3;
SYNC_CONFIG.RETRY_DELAY_MS = 500;
```

---

## Testing & Validation

```javascript
// Simulate offline mode
window.dispatchEvent(new Event('offline'));

// Simulate coming back online
window.dispatchEvent(new Event('online'));

// Manually trigger sync
await processSyncQueue();

// Check sync status
console.log(syncQueue.getStats());
console.log(connectionMonitor.getStatus());

// View all notifications
console.log(notificationManager.getAll());

// Export debug report
const report = debugger.export();
console.log(JSON.stringify(report, null, 2));
```

---

## Troubleshooting

### Sync not working?
1. Check: `connectionMonitor.getStatus()` — verify connection
2. Check: `syncQueue.getStats()` — verify queue is processing
3. Check: `debugger.export()` — view recent events

### Conflicts not resolving?
1. Verify conflict resolver strategy: `conflictResolver.strategy`
2. Check conflict log: `conflictResolver.getConflictLog()`
3. Try manual resolution if needed

### Offline queue growing?
1. Restore connection: `window.dispatchEvent(new Event('online'))`
2. Manually process: `processPendingOperations()`
3. Clear if stuck: `offlineQueue.clear()`

---

## Best Practices

1. **Always call `deviceManager.updateLastActivity()`** when user interacts
2. **Don't bypass sync queue** — use it for all remote operations
3. **Monitor connection quality** — adapt UX accordingly
4. **Handle conflicts gracefully** — show UI feedback
5. **Clean up old notifications** — call `notificationManager.clear()` when needed
6. **Export debug reports** — for troubleshooting multi-user issues
7. **Test offline mode** — regularly verify offline queue works

---

## Next Steps

1. Add notification UI components
2. Implement visual conflict resolution UI
3. Create dashboard for multi-user monitoring
4. Add analytics for sync performance
5. Setup automated conflict testing
