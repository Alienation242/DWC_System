import { Component, OnInit, OnDestroy } from '@angular/core';
import { SocketService, Telemetry } from '../services/socket.service';
import { ApiService } from '../services/api.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-telemetry',
  templateUrl: './telemetry.html',
  styleUrls: ['./telemetry.css'],
  standalone: false,
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
