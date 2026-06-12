import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { SocketService, Telemetry } from '../services/socket.service';
import { ApiService } from '../services/api.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-telemetry',
  standalone: true,
  templateUrl: './telemetry.html',
  styleUrls: ['./telemetry.css'],
  imports: [CommonModule, MatCardModule, MatIconModule, MatButtonModule],
})
export class TelemetryComponent implements OnInit, OnDestroy {
  telemetry: Telemetry | null = null;
  systemState: any = null;
  targetPPM = 0;
  phase = '';
  private subs = new Subscription();

  get ppm() {
    return this.telemetry ? this.telemetry.realEC * 0.5 : 0;
  }

  constructor(
    private socket: SocketService,
    private api: ApiService,
  ) {}

  ngOnInit() {
    this.subs.add(this.socket.onTelemetry().subscribe((data) => (this.telemetry = data)));
    this.loadSystemState();
    this.refreshTarget();
  }

  loadSystemState() {
    this.api.getSystemState().subscribe((s) => (this.systemState = s));
  }
  refreshTarget() {
    this.api.getTarget().subscribe((t) => {
      this.targetPPM = t.targetPPM;
      this.phase = t.phase;
    });
  }
  advanceDay() {
    this.api.advanceDay().subscribe(() => {
      this.loadSystemState();
      this.refreshTarget();
    });
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
