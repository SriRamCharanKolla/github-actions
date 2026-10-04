import { Injectable } from '@angular/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Network, type ConnectionStatus } from '@capacitor/network';
import { BehaviorSubject } from 'rxjs';

const browserConnectionStatus = (): ConnectionStatus => ({
  connected: typeof navigator === 'undefined' ? true : navigator.onLine,
  connectionType: 'unknown',
});

@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  readonly status$ = new BehaviorSubject<ConnectionStatus>(browserConnectionStatus());

  private initialized: Promise<void> | undefined;
  private listener: PluginListenerHandle | undefined;

  get isOnline(): boolean {
    return this.status$.value.connected;
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.start();
    }
    return this.initialized;
  }

  private async start(): Promise<void> {
    try {
      this.status$.next(await Network.getStatus());
      this.listener = await Network.addListener('networkStatusChange', status => {
        this.status$.next(status);
      });
    } catch {
      // Browser development and test runners may not expose the native plugin.
      this.status$.next(browserConnectionStatus());
    }
  }
}
