import { Component, OnDestroy, OnInit } from '@angular/core';
import type { ConnectionStatus } from '@capacitor/network';
import { Subscription } from 'rxjs';

import { ConnectivityService } from '../core/offline/connectivity.service';
import { FieldActivityService } from '../core/offline/field-activity.service';
import type { OfflineActivity, SyncResult } from '../core/offline/offline.models';
import { OfflineStoreService } from '../core/offline/offline-store.service';
import { SyncService } from '../core/offline/sync.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy {
  siteName = '';
  notes = '';
  activities: OfflineActivity[] = [];
  connection: ConnectionStatus = { connected: false, connectionType: 'unknown' };
  isSaving = false;
  isSyncing = false;
  message = 'Initializing the encrypted-device offline store…';

  private connectionSubscription: Subscription | undefined;

  constructor(
    private readonly activityService: FieldActivityService,
    private readonly store: OfflineStoreService,
    private readonly connectivity: ConnectivityService,
    private readonly sync: SyncService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.store.initialize();
      await this.connectivity.initialize();
      this.connectionSubscription = this.connectivity.status$.subscribe(status => {
        this.connection = status;
        if (status.connected) {
          this.message = 'Connected. Pending activities will sync automatically when the server is configured.';
        } else {
          this.message = 'Offline. New activity is being saved safely on this device.';
        }
      });
      await this.sync.initialize();
      await this.refreshActivities();
    } catch (error) {
      this.message = `Local storage could not start: ${this.errorMessage(error)}`;
    }
  }

  ngOnDestroy(): void {
    this.connectionSubscription?.unsubscribe();
  }

  async saveActivity(): Promise<void> {
    if (!this.siteName.trim()) {
      this.message = 'Enter a site name before saving the activity.';
      return;
    }

    this.isSaving = true;
    try {
      const activity = await this.activityService.capture({
        siteName: this.siteName,
        notes: this.notes,
      });
      this.siteName = '';
      this.notes = '';
      this.message = this.connection.connected
        ? `Saved ${activity.siteName} locally and queued it for safe sync.`
        : `Saved ${activity.siteName} on this device. It will sync after connectivity returns.`;
      await this.refreshActivities();
    } catch (error) {
      this.message = `Could not save the activity: ${this.errorMessage(error)}`;
    } finally {
      this.isSaving = false;
    }
  }

  async syncNow(): Promise<void> {
    this.isSyncing = true;
    try {
      const result = await this.sync.synchronize('manual');
      this.message = this.syncMessage(result);
      await this.refreshActivities();
    } finally {
      this.isSyncing = false;
    }
  }

  async retryAttentionItems(): Promise<void> {
    this.isSyncing = true;
    try {
      const result = await this.sync.retryNeedsAttention();
      this.message = this.syncMessage(result);
      await this.refreshActivities();
    } finally {
      this.isSyncing = false;
    }
  }

  statusColor(status: OfflineActivity['status']): string {
    switch (status) {
      case 'synced':
        return 'success';
      case 'needs-attention':
        return 'danger';
      case 'failed':
        return 'warning';
      case 'syncing':
        return 'primary';
      default:
        return 'medium';
    }
  }

  trackByActivity(_index: number, activity: OfflineActivity): string {
    return activity.id;
  }

  private async refreshActivities(): Promise<void> {
    this.activities = await this.store.listActivities();
  }

  private syncMessage(result: SyncResult): string {
    if (result.skippedReason) {
      return result.skippedReason;
    }
    return `Sync checked ${result.processed} activity${result.processed === 1 ? '' : 'ies'}: ${result.synced} synced, ${result.failed} waiting.`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }

}
