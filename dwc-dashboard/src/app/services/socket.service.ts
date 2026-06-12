import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';

export interface Telemetry {
  rawPH: number;
  rawEC: number;
  realPH: number;
  realEC: number;
  isTankEmpty: boolean;
  isTankOverflowing: boolean;
}

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket;

  constructor() {
    this.socket = io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => console.log('✅ Socket connected'));
    this.socket.on('connect_error', (err) => console.error('Socket error:', err));
  }

  onTelemetry(): Observable<Telemetry> {
    return new Observable((observer) => {
      this.socket.on('telemetry_update', (data: Telemetry) => observer.next(data));
    });
  }

  onNetworkUpdate(): Observable<any> {
    return new Observable((observer) => {
      this.socket.on('network_update', (data: any) => observer.next(data));
    });
  }
}
