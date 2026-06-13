/**
 * Bradford Bulls Timeline — Advanced Sync Configuration
 * 
 * Comprehensive sync, conflict resolution, and notification system for
 * multi-user, multi-device cloud synchronization.
 * 
 * Features:
 * - Optimistic updates with rollback
 * - Conflict detection & automatic resolution
 * - Sync queue & retry logic
 * - Device identification & presence
 * - Advanced notifications & status reporting
 * - Enhanced security & session management
 */

// ═══════════════════════════════════════════════════════════════════════════
// SYNC CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const SYNC_CONFIG = {
  // Debounce timing
  DEBOUNCE_MS: 1200,           // Time before saving after last change
  SAVE_BATCH_WINDOW_MS: 2000,  // Batch saves within this window
  
  // Self-event suppression
  SELF_EVENT_WINDOW_MS: 2500,  // Window to suppress self-triggered events
  
  // Conflict resolution
  CONFLICT_RESOLUTION: 'last-write-wins', // or 'merge', 'manual'
  CONFLICT_CHECK_INTERVAL_MS: 500,
  
  // Retry logic
  MAX_RETRIES: 5,
  RETRY_DELAY_MS: 1000,
  RETRY_BACKOFF_MULTIPLIER: 1.5,
  
  // Heartbeat & connectivity
  HEARTBEAT_INTERVAL_MS: 30000,   // Check connection every 30s
  HEARTBEAT_TIMEOUT_MS: 10000,    // Fail if no response in 10s
  OFFLINE_GRACE_PERIOD_MS: 15000, // Wait before declaring offline
  
  // Device & session
  DEVICE_SIGNATURE_REFRESH_MS: 86400000, // 24 hours
  SESSION_REFRESH_INTERVAL_MS: 3600000,  // 1 hour
  
  // Rate limiting
  MAX_OPS_PER_SECOND: 10,
  MAX_SYNC_PAYLOAD_KB: 1024,
  
  // Persistence
  STORAGE_VERSION: 'v6',
  CACHE_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// ═══════════════════════════════════════════════════════════════════════════
// SYNC STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════

const SyncState = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  SYNCING: 'syncing',
  CONNECTED: 'connected',
  OFFLINE: 'offline',
  ERROR: 'error',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate-limited',
};

const SyncPriority = {
  CRITICAL: 0,   // Auth, security
  HIGH: 1,       // Direct user action
  NORMAL: 2,     // Scheduled sync
  LOW: 3,        // Background cleanup
};

// ═══════════════════════════════════════════════════════════════════════════
// DEVICE IDENTIFICATION & TRACKING
// ═══════════════════════════════════════════════════════════════════════════

class DeviceManager {
  constructor() {
    this.DEVICE_ID_KEY = 'bbTimeline_deviceId_v2';
    this.DEVICE_SIGNATURE_KEY = 'bbTimeline_deviceSignature_v2';
    this.deviceId = this.getOrCreateDeviceId();
    this.signature = this.generateDeviceSignature();
    this.lastActivityTime = Date.now();
  }

  getOrCreateDeviceId() {
    let id = localStorage.getItem(this.DEVICE_ID_KEY);
    if (!id) {
      id = this.generateUUID();
      localStorage.setItem(this.DEVICE_ID_KEY, id);
    }
    return id;
  }

  generateDeviceSignature() {
    const components = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      deviceTime: new Date().toISOString(),
    };
    
    return this.hashObject(components);
  }

  hashObject(obj) {
    const str = JSON.stringify(obj);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  updateLastActivity() {
    this.lastActivityTime = Date.now();
  }

  getDeviceInfo() {
    return {
      id: this.deviceId,
      signature: this.signature,
      lastActivity: this.lastActivityTime,
      userAgent: navigator.userAgent,
      isOnline: navigator.onLine,
      platform: navigator.platform,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFLICT DETECTION & RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

class ConflictResolver {
  constructor(strategy = 'last-write-wins') {
    this.strategy = strategy;
    this.conflictLog = [];
    this.MAX_LOG_SIZE = 1000;
  }

  detectConflict(localItem, remoteItem) {
    if (!localItem || !remoteItem) return null;
    
    // Check if items have same ID but different content/timestamps
    if (localItem.id !== remoteItem.id) return null;
    
    const localModified = localItem._lastModified || 0;
    const remoteModified = remoteItem._lastModified || 0;
    
    // No conflict if one hasn't been modified
    if (localModified === 0 || remoteModified === 0) return null;
    
    // Check for actual content differences
    const localContent = JSON.stringify(this.stripMetadata(localItem));
    const remoteContent = JSON.stringify(this.stripMetadata(remoteItem));
    
    if (localContent === remoteContent) return null;
    
    // Conflict detected
    return {
      id: localItem.id,
      type: localItem.type,
      localVersion: { ...localItem, _timestamp: localModified },
      remoteVersion: { ...remoteItem, _timestamp: remoteModified },
      detectedAt: Date.now(),
      strategy: this.strategy,
    };
  }

  stripMetadata(item) {
    const { _lastModified, _deviceId, _synced, ...rest } = item;
    return rest;
  }

  resolve(conflict) {
    const resolution = {
      conflictId: `${conflict.id}-${conflict.detectedAt}`,
      itemId: conflict.id,
      strategy: this.strategy,
      resolvedAt: Date.now(),
      winner: null,
      details: {},
    };

    switch (this.strategy) {
      case 'last-write-wins':
        resolution.winner = conflict.remoteVersion._timestamp > conflict.localVersion._timestamp
          ? 'remote'
          : 'local';
        resolution.resolvedItem = resolution.winner === 'remote'
          ? conflict.remoteVersion
          : conflict.localVersion;
        break;

      case 'merge':
        resolution.winner = 'merged';
        resolution.resolvedItem = this.mergeItems(conflict.localVersion, conflict.remoteVersion);
        break;

      case 'local-priority':
        resolution.winner = 'local';
        resolution.resolvedItem = conflict.localVersion;
        break;

      default:
        resolution.winner = null;
        resolution.requiresManual = true;
    }

    this.logConflict(conflict, resolution);
    return resolution;
  }

  mergeItems(localItem, remoteItem) {
    const merged = { ...remoteItem };
    
    // Merge arrays (assignees, etc.)
    if (Array.isArray(localItem.assignees) && Array.isArray(remoteItem.assignees)) {
      merged.assignees = [...new Set([...localItem.assignees, ...remoteItem.assignees])];
    }
    
    // Keep non-empty local notes if remote notes are empty
    if (!merged.notes && localItem.notes) {
      merged.notes = localItem.notes;
    }
    
    // Preserve local status changes if remote hasn't been modified since
    if (localItem.complete !== remoteItem.complete && 
        (localItem._lastModified || 0) > (remoteItem._lastModified || 0)) {
      merged.complete = localItem.complete;
    }
    
    merged._mergedAt = Date.now();
    merged._mergedFrom = [localItem.id];
    
    return merged;
  }

  logConflict(conflict, resolution) {
    this.conflictLog.push({
      ...conflict,
      ...resolution,
    });
    
    if (this.conflictLog.length > this.MAX_LOG_SIZE) {
      this.conflictLog.shift();
    }
  }

  getConflictLog() {
    return [...this.conflictLog];
  }

  clearConflictLog() {
    this.conflictLog = [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNC QUEUE & RETRY LOGIC
// ═══════════════════════════════════════════════════════════════════════════

class SyncQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.lastProcessedTime = 0;
    this.retryMap = new Map(); // Track retry attempts
  }

  enqueue(operation) {
    const queuedOp = {
      id: `${operation.type}-${operation.itemId}-${Date.now()}`,
      ...operation,
      priority: operation.priority || SyncPriority.NORMAL,
      enqueuedAt: Date.now(),
      attempts: 0,
      nextRetryTime: null,
    };
    
    this.queue.push(queuedOp);
    this.queue.sort((a, b) => a.priority - b.priority);
    
    return queuedOp.id;
  }

  dequeue() {
    return this.queue.shift();
  }

  peek() {
    return this.queue[0] || null;
  }

  getQueueSize() {
    return this.queue.length;
  }

  recordAttempt(opId, success, error = null) {
    const retryCount = (this.retryMap.get(opId) || 0) + 1;
    this.retryMap.set(opId, retryCount);

    if (!success && retryCount < SYNC_CONFIG.MAX_RETRIES) {
      const delay = SYNC_CONFIG.RETRY_DELAY_MS * 
        Math.pow(SYNC_CONFIG.RETRY_BACKOFF_MULTIPLIER, retryCount - 1);
      return {
        shouldRetry: true,
        retryAfterMs: delay,
        retryCount,
      };
    }

    if (success || retryCount >= SYNC_CONFIG.MAX_RETRIES) {
      this.retryMap.delete(opId);
    }

    return {
      shouldRetry: false,
      retryCount,
    };
  }

  clear() {
    this.queue = [];
    this.retryMap.clear();
  }

  getStats() {
    return {
      queueSize: this.queue.length,
      totalRetries: this.retryMap.size,
      oldestOp: this.queue[0] ? this.queue[0].enqueuedAt : null,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONNECTION MONITOR (Heartbeat)
// ═══════════════════════════════════════════════════════════════════════════

class ConnectionMonitor {
  constructor(supabaseClient) {
    this.supabaseClient = supabaseClient;
    this.isOnline = navigator.onLine;
    this.connectionQuality = 'good'; // good, fair, poor
    this.lastHeartbeatTime = Date.now();
    this.heartbeatInterval = null;
    this.offlineTimer = null;
    
    this.setupListeners();
  }

  setupListeners() {
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  async startHeartbeat(callback) {
    this.heartbeatInterval = setInterval(async () => {
      const startTime = Date.now();
      
      try {
        // Lightweight health check
        const { data, error } = await Promise.race([
          this.supabaseClient.from('fixtures').select('id').limit(1),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Heartbeat timeout')), SYNC_CONFIG.HEARTBEAT_TIMEOUT_MS)
          ),
        ]);

        const latency = Date.now() - startTime;
        this.lastHeartbeatTime = Date.now();
        
        if (error) throw error;

        // Update connection quality based on latency
        if (latency < 200) this.connectionQuality = 'good';
        else if (latency < 1000) this.connectionQuality = 'fair';
        else this.connectionQuality = 'poor';

        this.isOnline = true;
        clearTimeout(this.offlineTimer);
        
        callback?.({ status: 'connected', quality: this.connectionQuality, latency });
      } catch (e) {
        // Connection failed, start offline timer
        if (!this.offlineTimer) {
          this.offlineTimer = setTimeout(() => {
            if (!navigator.onLine) {
              this.isOnline = false;
              callback?.({ status: 'offline', error: e.message });
            }
          }, SYNC_CONFIG.OFFLINE_GRACE_PERIOD_MS);
        }
      }
    }, SYNC_CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.offlineTimer) {
      clearTimeout(this.offlineTimer);
      this.offlineTimer = null;
    }
  }

  handleOnline() {
    this.isOnline = true;
    clearTimeout(this.offlineTimer);
  }

  handleOffline() {
    this.isOnline = false;
  }

  getStatus() {
    return {
      isOnline: this.isOnline,
      connectionQuality: this.connectionQuality,
      lastHeartbeat: this.lastHeartbeatTime,
      timeSinceHeartbeat: Date.now() - this.lastHeartbeatTime,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION MANAGER
// ═══════════════════════════════════════════════════════════════════════════

class NotificationManager {
  constructor() {
    this.notifications = [];
    this.MAX_NOTIFICATIONS = 5;
    this.notificationTimeouts = new Map();
  }

  notify(type, message, options = {}) {
    const notification = {
      id: `${type}-${Date.now()}-${Math.random()}`,
      type,
      message,
      duration: options.duration || 4000,
      action: options.action || null,
      timestamp: Date.now(),
      ...options,
    };

    this.notifications.push(notification);
    if (this.notifications.length > this.MAX_NOTIFICATIONS) {
      this.notifications.shift();
    }

    // Auto-dismiss after duration
    if (notification.duration) {
      const timeout = setTimeout(() => this.dismiss(notification.id), notification.duration);
      this.notificationTimeouts.set(notification.id, timeout);
    }

    return notification;
  }

  dismiss(id) {
    const timeout = this.notificationTimeouts.get(id);
    if (timeout) clearTimeout(timeout);
    this.notificationTimeouts.delete(id);
    
    this.notifications = this.notifications.filter(n => n.id !== id);
  }

  // Specific notification types
  syncStarted() {
    return this.notify('sync', '⟳ Syncing changes to cloud...', { duration: null });
  }

  syncSuccess() {
    return this.notify('success', '✓ All changes synced', { duration: 2000 });
  }

  syncFailed(error) {
    return this.notify('error', `✕ Sync failed: ${error}`, { duration: 6000 });
  }

  conflictDetected(itemType) {
    return this.notify('warning', `⚠ Conflict detected in ${itemType} — using latest version`, { duration: 5000 });
  }

  offlineMode() {
    return this.notify('offline', '📡 Offline — changes will sync when back online', { duration: null });
  }

  backOnline() {
    return this.notify('success', '✓ Back online, syncing...', { duration: 3000 });
  }

  sessionExpiring() {
    return this.notify('warning', '⏰ Your session expires in 5 minutes', {
      duration: null,
      action: 'Refresh',
    });
  }

  getAll() {
    return [...this.notifications];
  }

  clear() {
    this.notificationTimeouts.forEach(timeout => clearTimeout(timeout));
    this.notificationTimeouts.clear();
    this.notifications = [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SYNC_CONFIG,
    SyncState,
    SyncPriority,
    DeviceManager,
    ConflictResolver,
    SyncQueue,
    ConnectionMonitor,
    NotificationManager,
  };
}

// Browser globals
if (typeof window !== 'undefined') {
  window.SyncSystem = {
    SYNC_CONFIG,
    SyncState,
    SyncPriority,
    DeviceManager,
    ConflictResolver,
    SyncQueue,
    ConnectionMonitor,
    NotificationManager,
  };
}
