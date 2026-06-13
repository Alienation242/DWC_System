import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartType } from 'chart.js';
import { SocketService, Telemetry } from '../services/socket.service';
import { ApiService } from '../services/api.service';
import { Subscription } from 'rxjs';
import 'chart.js/auto';

@Component({
  selector: 'app-pot-card',
  standalone: true,
  templateUrl: './pot-card.html',
  styleUrls: ['./pot-card.css'],
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTableModule,
    BaseChartDirective,
  ],
})
export class PotCardComponent implements OnInit, OnDestroy {
  @Input() potId!: string;

  telemetry: Telemetry | null = null;
  targetPPM = 0;
  phase = '';
  historyData: any[] = [];
  recentDoses: any[] = [];

  private subs = new Subscription();

  // Chart
  public lineChartData: ChartConfiguration['data'] = {
    datasets: [
      { data: [], label: 'pH', borderColor: 'blue', fill: false },
      { data: [], label: 'EC (µS/cm)', borderColor: 'green', fill: false, yAxisID: 'y1' },
    ],
    labels: [],
  };
  public lineChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { position: 'top' } },
    scales: {
      y: { title: { display: true, text: 'pH' } },
      y1: { position: 'right', title: { text: 'EC (µS/cm)' } },
    },
  };
  public lineChartType: ChartType = 'line';

  displayedColumns = ['timestamp', 'pumpName', 'ml', 'status'];

  get ppm() {
    return this.telemetry ? this.telemetry.realEC * 0.5 : 0;
  }

  constructor(
    private socket: SocketService,
    private api: ApiService,
  ) {}

  ngOnInit() {
    this.loadData();
    // Subscribe to real‑time telemetry
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
    this.api.getTelemetryHistory(this.potId, 30).subscribe((data) => {
      this.historyData = data;
      const labels = data.map((d) => new Date(d.timestamp).toLocaleTimeString());
      const phData = data.map((d) => d.realPH);
      const ecData = data.map((d) => d.realEC);
      this.lineChartData = {
        ...this.lineChartData,
        labels,
        datasets: [
          { ...this.lineChartData.datasets[0], data: phData },
          { ...this.lineChartData.datasets[1], data: ecData },
        ],
      };
    });
    this.api.getRecentDoses(this.potId, 10).subscribe((data) => (this.recentDoses = data));
    this.loadGlobalTarget();
  }

  loadGlobalTarget() {
    this.api.getTarget().subscribe((t) => {
      this.targetPPM = t.targetPPM;
      this.phase = t.phase;
    });
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
