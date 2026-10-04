import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';

import {
  type OfflineActivity,
  type SyncOperation,
  type SyncRequest,
  type SyncStatus,
} from './offline.models';

interface BrowserSnapshot {
  activities: OfflineActivity[];
  operations: SyncOperation[];
  requests: SyncRequest[];
}

@Injectable({ providedIn: 'root' })
export class OfflineStoreService {
  private static readonly databaseName = 'construction_offline';
  private static readonly browserStorageKey = 'construction-offline-v1';

  private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | undefined;
  private initialized: Promise<void> | undefined;
  private browserSnapshot: BrowserSnapshot = {
    activities: [],
    operations: [],
    requests: [],
  };

  async initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.open();
    }

    return this.initialized;
  }

  async saveActivity(
    activity: OfflineActivity,
    operation: SyncOperation,
    requests: SyncRequest[],
  ): Promise<void> {
    await this.initialize();

    if (!this.isNative()) {
      this.browserSnapshot.activities.unshift(activity);
      this.browserSnapshot.operations.push(operation);
      this.browserSnapshot.requests.push(...requests);
      this.persistBrowserSnapshot();
      return;
    }

    const db = this.requireDb();
    await db.beginTransaction();

    try {
      await db.run(
        `INSERT INTO activities
          (id, module, site_name, notes, status, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          activity.id,
          activity.module,
          activity.siteName,
          activity.notes,
          activity.status,
          activity.lastError,
          activity.createdAt,
          activity.updatedAt,
        ],
      );
      await db.run(
        `INSERT INTO sync_operations
          (id, activity_id, module, status, attempts, next_retry_at, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          operation.id,
          operation.activityId,
          operation.module,
          operation.status,
          operation.attempts,
          operation.nextRetryAt,
          operation.lastError,
          operation.createdAt,
          operation.updatedAt,
        ],
      );

      for (const request of requests) {
        await db.run(
          `INSERT INTO sync_requests
            (id, operation_id, sequence, method, path, body_json, idempotency_key, status,
             attempts, next_retry_at, last_error, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            request.id,
            request.operationId,
            request.sequence,
            request.method,
            request.path,
            request.bodyJson,
            request.idempotencyKey,
            request.status,
            request.attempts,
            request.nextRetryAt,
            request.lastError,
            request.createdAt,
            request.updatedAt,
          ],
        );
      }

      await db.commitTransaction();
    } catch (error) {
      await db.rollbackTransaction();
      throw error;
    }
  }

  async listActivities(): Promise<OfflineActivity[]> {
    await this.initialize();

    if (!this.isNative()) {
      return [...this.browserSnapshot.activities].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    }

    const result = await this.requireDb().query(
      `SELECT id,
              module,
              site_name AS siteName,
              notes,
              status,
              last_error AS lastError,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM activities
       ORDER BY created_at DESC`,
    );
    return (result.values ?? []) as OfflineActivity[];
  }

  async getReadyOperations(now: string): Promise<SyncOperation[]> {
    await this.initialize();

    if (!this.isNative()) {
      return this.browserSnapshot.operations.filter(
        operation =>
          (operation.status === 'pending' || operation.status === 'failed') &&
          operation.nextRetryAt !== null &&
          operation.nextRetryAt <= now,
      );
    }

    const result = await this.requireDb().query(
      `SELECT id,
              activity_id AS activityId,
              module,
              status,
              attempts,
              next_retry_at AS nextRetryAt,
              last_error AS lastError,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM sync_operations
       WHERE status IN ('pending', 'failed')
         AND next_retry_at IS NOT NULL
         AND next_retry_at <= ?
       ORDER BY created_at ASC
       LIMIT 25`,
      [now],
    );
    return (result.values ?? []) as SyncOperation[];
  }

  async getRequests(operationId: string): Promise<SyncRequest[]> {
    await this.initialize();

    if (!this.isNative()) {
      return this.browserSnapshot.requests
        .filter(request => request.operationId === operationId)
        .sort((a, b) => a.sequence - b.sequence);
    }

    const result = await this.requireDb().query(
      `SELECT id,
              operation_id AS operationId,
              sequence,
              method,
              path,
              body_json AS bodyJson,
              idempotency_key AS idempotencyKey,
              status,
              attempts,
              next_retry_at AS nextRetryAt,
              last_error AS lastError,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM sync_requests
       WHERE operation_id = ?
       ORDER BY sequence ASC`,
      [operationId],
    );
    return (result.values ?? []) as SyncRequest[];
  }

  async markOperationSyncing(operation: SyncOperation): Promise<void> {
    await this.updateOperation(operation.id, {
      status: 'syncing',
      attempts: operation.attempts + 1,
      nextRetryAt: null,
      lastError: null,
    });
    await this.updateActivity(operation.activityId, { status: 'syncing', lastError: null });
  }

  async markRequestSyncing(request: SyncRequest): Promise<void> {
    await this.updateRequest(request.id, {
      status: 'syncing',
      attempts: request.attempts + 1,
      nextRetryAt: null,
      lastError: null,
    });
  }

  async markRequestSynced(request: SyncRequest): Promise<void> {
    await this.updateRequest(request.id, {
      status: 'synced',
      attempts: request.attempts + 1,
      nextRetryAt: null,
      lastError: null,
    });
  }

  async markRequestFailed(
    request: SyncRequest,
    status: Extract<SyncStatus, 'failed' | 'needs-attention'>,
    error: string,
    nextRetryAt: string | null,
  ): Promise<void> {
    await this.updateRequest(request.id, {
      status,
      attempts: request.attempts + 1,
      lastError: error,
      nextRetryAt,
    });
  }

  async markOperationFailed(
    operation: SyncOperation,
    status: Extract<SyncStatus, 'failed' | 'needs-attention'>,
    error: string,
    nextRetryAt: string | null,
  ): Promise<void> {
    await this.updateOperation(operation.id, {
      status,
      attempts: operation.attempts + 1,
      lastError: error,
      nextRetryAt,
    });
    await this.updateActivity(operation.activityId, { status, lastError: error });
  }

  async markOperationSynced(operation: SyncOperation): Promise<void> {
    await this.updateOperation(operation.id, {
      status: 'synced',
      attempts: operation.attempts + 1,
      nextRetryAt: null,
      lastError: null,
    });
    await this.updateActivity(operation.activityId, { status: 'synced', lastError: null });
  }

  async retryNeedsAttention(): Promise<void> {
    await this.initialize();
    const now = new Date().toISOString();

    if (!this.isNative()) {
      for (const operation of this.browserSnapshot.operations) {
        if (operation.status === 'needs-attention') {
          operation.status = 'failed';
          operation.nextRetryAt = now;
          operation.updatedAt = now;
          const activity = this.getBrowserActivity(operation.activityId);
          if (activity) {
            activity.status = 'failed';
            activity.updatedAt = now;
          }
        }
      }
      this.persistBrowserSnapshot();
      return;
    }

    const db = this.requireDb();
    await db.run(
      `UPDATE sync_operations
       SET status = 'failed', next_retry_at = ?, updated_at = ?
       WHERE status = 'needs-attention'`,
      [now, now],
    );
    await db.run(
      `UPDATE activities
       SET status = 'failed', updated_at = ?
       WHERE status = 'needs-attention'`,
      [now],
    );
  }

  private async open(): Promise<void> {
    if (!this.isNative()) {
      this.loadBrowserSnapshot();
      return;
    }

    const existingConnection = await this.sqlite.isConnection(
      OfflineStoreService.databaseName,
      false,
    );
    this.db = existingConnection.result
      ? await this.sqlite.retrieveConnection(OfflineStoreService.databaseName, false)
      : await this.sqlite.createConnection(
          OfflineStoreService.databaseName,
          false,
          'no-encryption',
          1,
          false,
        );
    await this.db.open();
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY NOT NULL,
        module TEXT NOT NULL,
        site_name TEXT NOT NULL,
        notes TEXT NOT NULL,
        status TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_operations (
        id TEXT PRIMARY KEY NOT NULL,
        activity_id TEXT NOT NULL,
        module TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(activity_id) REFERENCES activities(id)
      );
      CREATE TABLE IF NOT EXISTS sync_requests (
        id TEXT PRIMARY KEY NOT NULL,
        operation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        body_json TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(operation_id) REFERENCES sync_operations(id)
      );
      CREATE INDEX IF NOT EXISTS idx_operations_ready
        ON sync_operations(status, next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_requests_operation
        ON sync_requests(operation_id, sequence);
    `);

    // A process crash or a network loss can interrupt an in-flight request. On the
    // next app start, replay only that unresolved request using its idempotency key.
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE sync_operations
       SET status = 'failed', next_retry_at = ?, updated_at = ?
       WHERE status = 'syncing'`,
      [now, now],
    );
    await this.db.run(
      `UPDATE sync_requests
       SET status = 'failed', next_retry_at = ?, updated_at = ?
       WHERE status = 'syncing'`,
      [now, now],
    );
    await this.db.run(
      `UPDATE activities
       SET status = 'failed', updated_at = ?
       WHERE status = 'syncing'`,
      [now],
    );
  }

  private async updateActivity(
    activityId: string,
    patch: Pick<OfflineActivity, 'status' | 'lastError'>,
  ): Promise<void> {
    await this.initialize();
    const updatedAt = new Date().toISOString();

    if (!this.isNative()) {
      const activity = this.getBrowserActivity(activityId);
      if (activity) {
        activity.status = patch.status;
        activity.lastError = patch.lastError;
        activity.updatedAt = updatedAt;
        this.persistBrowserSnapshot();
      }
      return;
    }

    await this.requireDb().run(
      `UPDATE activities SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      [patch.status, patch.lastError, updatedAt, activityId],
    );
  }

  private async updateOperation(
    operationId: string,
    patch: Pick<SyncOperation, 'status' | 'attempts' | 'nextRetryAt' | 'lastError'>,
  ): Promise<void> {
    await this.initialize();
    const updatedAt = new Date().toISOString();

    if (!this.isNative()) {
      const operation = this.browserSnapshot.operations.find(item => item.id === operationId);
      if (operation) {
        operation.status = patch.status;
        operation.attempts = patch.attempts;
        operation.nextRetryAt = patch.nextRetryAt;
        operation.lastError = patch.lastError;
        operation.updatedAt = updatedAt;
        this.persistBrowserSnapshot();
      }
      return;
    }

    await this.requireDb().run(
      `UPDATE sync_operations
       SET status = ?, attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ?
       WHERE id = ?`,
      [
        patch.status,
        patch.attempts,
        patch.nextRetryAt,
        patch.lastError,
        updatedAt,
        operationId,
      ],
    );
  }

  private async updateRequest(
    requestId: string,
    patch: Pick<SyncRequest, 'status' | 'attempts' | 'nextRetryAt' | 'lastError'>,
  ): Promise<void> {
    await this.initialize();
    const updatedAt = new Date().toISOString();

    if (!this.isNative()) {
      const request = this.browserSnapshot.requests.find(item => item.id === requestId);
      if (request) {
        request.status = patch.status;
        request.attempts = patch.attempts;
        request.nextRetryAt = patch.nextRetryAt;
        request.lastError = patch.lastError;
        request.updatedAt = updatedAt;
        this.persistBrowserSnapshot();
      }
      return;
    }

    await this.requireDb().run(
      `UPDATE sync_requests
       SET status = ?, attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ?
       WHERE id = ?`,
      [
        patch.status,
        patch.attempts,
        patch.nextRetryAt,
        patch.lastError,
        updatedAt,
        requestId,
      ],
    );
  }

  private getBrowserActivity(activityId: string): OfflineActivity | undefined {
    return this.browserSnapshot.activities.find(activity => activity.id === activityId);
  }

  private loadBrowserSnapshot(): void {
    try {
      const stored = globalThis.localStorage?.getItem(OfflineStoreService.browserStorageKey);
      if (stored) {
        this.browserSnapshot = JSON.parse(stored) as BrowserSnapshot;
      }
    } catch {
      // The browser fallback exists only for local web development and unit tests.
      this.browserSnapshot = { activities: [], operations: [], requests: [] };
    }
  }

  private persistBrowserSnapshot(): void {
    try {
      globalThis.localStorage?.setItem(
        OfflineStoreService.browserStorageKey,
        JSON.stringify(this.browserSnapshot),
      );
    } catch {
      // Native Android and iOS use SQLite; browser storage failure must not affect them.
    }
  }

  private isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  private requireDb(): SQLiteDBConnection {
    if (!this.db) {
      throw new Error('The native offline database has not been initialized.');
    }
    return this.db;
  }
}
