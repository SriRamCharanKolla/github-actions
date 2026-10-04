export type SyncStatus = 'pending' | 'syncing' | 'failed' | 'needs-attention' | 'synced';

export type HttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface OfflineActivity {
  id: string;
  module: string;
  siteName: string;
  notes: string;
  status: SyncStatus;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncOperation {
  id: string;
  activityId: string;
  module: string;
  status: SyncStatus;
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRequest {
  id: string;
  operationId: string;
  sequence: number;
  method: HttpMethod;
  path: string;
  bodyJson: string | null;
  idempotencyKey: string;
  status: SyncStatus;
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewSyncRequest {
  sequence: number;
  method: HttpMethod;
  path: string;
  body: unknown | null;
}

export interface SyncResult {
  processed: number;
  synced: number;
  failed: number;
  skippedReason?: string;
}
