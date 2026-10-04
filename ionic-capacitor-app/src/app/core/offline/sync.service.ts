import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { filter, Subscription } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ConnectivityService } from './connectivity.service';
import { type SyncOperation, type SyncRequest, type SyncResult } from './offline.models';
import { OfflineStoreService } from './offline-store.service';

class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class SyncService {
  private static readonly maxAttempts = 8;
  private static readonly retryBaseMs = 5_000;
  private syncing = false;
  private initialized: Promise<void> | undefined;
  private networkSubscription: Subscription | undefined;
  private retryTimer: number | undefined;

  constructor(
    private readonly store: OfflineStoreService,
    private readonly connectivity: ConnectivityService,
  ) {}

  async initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.start();
    }
    return this.initialized;
  }

  async synchronize(reason: 'manual' | 'new-activity' | 'network-restored' | 'app-resumed'):
    Promise<SyncResult> {
    await this.initialize();

    if (!this.connectivity.isOnline) {
      return { processed: 0, synced: 0, failed: 0, skippedReason: 'No network connection.' };
    }
    if (!environment.sync.apiBaseUrl) {
      return {
        processed: 0,
        synced: 0,
        failed: 0,
        skippedReason: 'Server API URL is not configured.',
      };
    }
    if (this.syncing) {
      return { processed: 0, synced: 0, failed: 0, skippedReason: 'A sync is already running.' };
    }

    this.syncing = true;
    const result: SyncResult = { processed: 0, synced: 0, failed: 0 };

    try {
      const operations = await this.store.getReadyOperations(new Date().toISOString());
      for (const operation of operations) {
        if (!this.connectivity.isOnline) {
          break;
        }
        result.processed += 1;
        const synced = await this.syncOperation(operation);
        if (synced) {
          result.synced += 1;
        } else {
          result.failed += 1;
        }
      }
      return result;
    } finally {
      this.syncing = false;
    }
  }

  async retryNeedsAttention(): Promise<SyncResult> {
    await this.store.retryNeedsAttention();
    return this.synchronize('manual');
  }

  private async start(): Promise<void> {
    await this.store.initialize();
    await this.connectivity.initialize();
    this.networkSubscription = this.connectivity.status$
      .pipe(filter(status => status.connected))
      .subscribe(() => {
        void this.synchronize('network-restored');
      });

    // This is intentionally a single timer plus a single-flight guard. It cannot
    // create duplicate API loops, even if connectivity changes repeatedly.
    if (Capacitor.isNativePlatform()) {
      this.retryTimer = window.setInterval(() => {
        if (this.connectivity.isOnline) {
          void this.synchronize('app-resumed');
        }
      }, 30_000);
    }
  }

  private async syncOperation(operation: SyncOperation): Promise<boolean> {
    await this.store.markOperationSyncing(operation);
    const requests = await this.store.getRequests(operation.id);

    for (const request of requests) {
      if (request.status === 'synced') {
        continue;
      }

      await this.store.markRequestSyncing(request);
      try {
        await this.send(request);
        await this.store.markRequestSynced(request);
      } catch (error) {
        const message = this.errorMessage(error);
        const isPermanent = this.isPermanentFailure(error);
        const attempts = Math.max(operation.attempts, request.attempts) + 1;
        const exhausted = attempts >= SyncService.maxAttempts;
        const retryAt = isPermanent
          ? null
          : this.nextRetryAt(attempts);
        const status = isPermanent || exhausted ? 'needs-attention' : 'failed';

        await this.store.markRequestFailed(request, status, message, retryAt);
        await this.store.markOperationFailed(operation, status, message, retryAt);
        return false;
      }
    }

    await this.store.markOperationSynced(operation);
    return true;
  }

  private async send(request: SyncRequest): Promise<void> {
    const url = new URL(request.path, environment.sync.apiBaseUrl).toString();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), environment.sync.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotencyKey,
          'X-Client-Request-Id': request.id,
        },
        body: request.bodyJson ?? undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new SyncHttpError(response.status, await this.responseMessage(response));
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private nextRetryAt(attempt: number): string | null {
    if (attempt >= SyncService.maxAttempts) {
      return null;
    }
    const cappedAttempt = Math.min(attempt, 6);
    const delay = Math.min(SyncService.retryBaseMs * 2 ** cappedAttempt, 5 * 60_000);
    const jitter = Math.floor(Math.random() * 1_000);
    return new Date(Date.now() + delay + jitter).toISOString();
  }

  private isPermanentFailure(error: unknown): boolean {
    if (!(error instanceof SyncHttpError)) {
      return false;
    }
    return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
  }

  private async responseMessage(response: Response): Promise<string> {
    const message = (await response.text()).trim();
    return message ? `Server returned ${response.status}: ${message.slice(0, 300)}` :
      `Server returned ${response.status}.`;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'Request timed out or the network dropped before the server responded.';
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'The request failed for an unknown reason.';
  }
}
