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

export interface NetworkUpdate {
  sensor_node_1: string;
  pump_node_1: string;
}

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket;

  constructor() {
    this.socket = io(); // connects to same origin
  }

  onTelemetry(): Observable<Telemetry> {
    return new Observable((observer) => {
      this.socket.on('telemetry_update', (data: Telemetry) => observer.next(data));
    });
  }

  onNetworkUpdate(): Observable<NetworkUpdate> {
    return new Observable((observer) => {
      this.socket.on('network_update', (data: NetworkUpdate) => observer.next(data));
    });
  }
}
