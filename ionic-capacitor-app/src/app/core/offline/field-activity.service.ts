import { Injectable } from '@angular/core';

import { type NewSyncRequest, type OfflineActivity, type SyncOperation, type SyncRequest } from './offline.models';
import { OfflineStoreService } from './offline-store.service';
import { SyncService } from './sync.service';

export interface NewFieldActivity {
  siteName: string;
  notes: string;
  // A module can queue one request or a sequence of requests. The sync engine
  // completes them in sequence and resumes at the first unfinished request.
  requestSteps?: NewSyncRequest[];
}

@Injectable({ providedIn: 'root' })
export class FieldActivityService {
  constructor(
    private readonly store: OfflineStoreService,
    private readonly sync: SyncService,
  ) {}

  async capture(input: NewFieldActivity): Promise<OfflineActivity> {
    const now = new Date().toISOString();
    const activityId = this.newId();
    const operationId = this.newId();
    const activity: OfflineActivity = {
      id: activityId,
      module: 'site-activity',
      siteName: input.siteName.trim(),
      notes: input.notes.trim(),
      status: 'pending',
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    const operation: SyncOperation = {
      id: operationId,
      activityId,
      module: activity.module,
      status: 'pending',
      attempts: 0,
      nextRetryAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    const steps = input.requestSteps ?? [
      {
        sequence: 1,
        method: 'POST',
        path: '/v1/construction/site-activities',
        body: {
          clientActivityId: activity.id,
          siteName: activity.siteName,
          notes: activity.notes,
          occurredAt: activity.createdAt,
        },
      },
    ];
    const requests: SyncRequest[] = steps.map(step => ({
      id: this.newId(),
      operationId,
      sequence: step.sequence,
      method: step.method,
      path: step.path,
      bodyJson: step.body === null ? null : JSON.stringify(step.body),
      idempotencyKey: this.newId(),
      status: 'pending',
      attempts: 0,
      nextRetryAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }));

    await this.store.saveActivity(activity, operation, requests);
    // Saving is complete before sync begins. A crash, request timeout, or network
    // loss cannot remove the user's local activity.
    void this.sync.synchronize('new-activity');
    return activity;
  }

  private newId(): string {
    return globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
