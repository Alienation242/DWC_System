import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { SocketService, Telemetry } from '../services/socket.service';
import { ApiService } from '../services/api.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-pot-card',
  standalone: true,
  templateUrl: './pot-card.html',
  styleUrls: ['./pot-card.css'],
  imports: [CommonModule, RouterModule, MatCardModule, MatIconModule, MatDividerModule],
})
export class PotCardComponent implements OnInit, OnDestroy {
  @Input() potId!: string;

  telemetry: Telemetry | null = null;
  targetPPM = 0;
  phase = '';
  showingPPM: boolean = false;
  private subs = new Subscription();

  // Assuming standard DWC pH target
  targetPH = 5.8;

  get ppm() {
    return this.telemetry ? this.telemetry.realEC * 0.5 : 0;
  }

  get targetEC() {
    return this.targetPPM * 2;
  }

  // --- Dynamic Color Logic ---
  get phStatusClass() {
    if (!this.telemetry) return '';
    const diff = Math.abs(this.telemetry.realPH - this.targetPH);
    if (diff <= 0.2) return 'val-optimal';
    if (diff <= 0.5) return 'val-warning';
    return 'val-danger';
  }

  get ecStatusClass() {
    if (!this.telemetry) return '';
    const diff = Math.abs(this.telemetry.realEC - this.targetEC);
    if (diff <= 100) return 'val-optimal'; // within 100 µS/cm is great
    if (diff <= 250) return 'val-warning';
    return 'val-danger';
  }

  constructor(
    private socket: SocketService,
    private api: ApiService,
  ) {}

  ngOnInit() {
    this.loadData();
    this.subs.add(
      this.socket.onTelemetry().subscribe((data) => {
        if (data.potId === this.potId) {
          this.telemetry = data;
        }
      }),
    );
  }

  loadData() {
    this.api.getLatestTelemetry(this.potId).subscribe((data) => (this.telemetry = data));
    this.api.getTarget().subscribe((t) => {
      this.targetPPM = t.targetPPM;
      this.phase = t.phase;
    });
  }

  // Passing the click event stops the routerLink from firing!
  toggleEcPpm(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    this.showingPPM = !this.showingPPM;
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
