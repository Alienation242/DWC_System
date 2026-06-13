import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatDividerModule } from '@angular/material/divider';
import { BaseChartDirective } from 'ng2-charts'; // <-- changed
import { Chart, ChartConfiguration, ChartType, registerables } from 'chart.js';
import { SocketService, Telemetry } from '../services/socket.service';
import { ApiService } from '../services/api.service';
import { Subscription } from 'rxjs';

// Register all Chart.js components (fixes "linear is not a registered scale")
Chart.register(...registerables);

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
    MatDividerModule,
    BaseChartDirective,
  ],
})
export class PotCardComponent implements OnInit, OnDestroy {
  @Input() potId!: string;

  telemetry: Telemetry | null = null;
  targetPPM = 0;
  phase = '';
  recentDoses: any[] = [];

  // Separate charts for pH and EC
  public phChartData: ChartConfiguration<'line'>['data'] = {
    datasets: [{ data: [], label: 'pH', borderColor: 'blue', fill: false }],
    labels: [],
  };
  public ecChartData: ChartConfiguration<'line'>['data'] = {
    datasets: [{ data: [], label: 'EC (µS/cm)', borderColor: 'green', fill: false }],
    labels: [],
  };
  public phChartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 6,
        },
      },
      y: {
        title: { display: true, text: 'pH' },
      },
    },
  };

  public ecChartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 6,
        },
      },
      y: {
        title: { display: true, text: 'EC (µS/cm)' },
      },
    },
  };
  public lineChartType: 'line' = 'line';
  displayedColumns = ['timestamp', 'pumpName', 'ml', 'status'];

  private subs = new Subscription();

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
          // Refresh history and chart when new telemetry arrives
          this.refreshHistory();
        }
      }),
    );
  }

  loadData() {
    this.api.getLatestTelemetry(this.potId).subscribe((data) => (this.telemetry = data));
    this.refreshHistory();
    this.api.getRecentDoses(this.potId, 10).subscribe((data) => (this.recentDoses = data));
    this.loadGlobalTarget();
  }

  refreshHistory() {
    this.api.getTelemetryHistory(this.potId, 30).subscribe((history) => {
      const labels = history.map((d) => new Date(d.timestamp).toLocaleTimeString());
      const phData = history.map((d) => d.realPH);
      const ecData = history.map((d) => d.realEC);
      this.phChartData = {
        ...this.phChartData,
        labels,
        datasets: [{ ...this.phChartData.datasets[0], data: phData }],
      };
      this.ecChartData = {
        ...this.ecChartData,
        labels,
        datasets: [{ ...this.ecChartData.datasets[0], data: ecData }],
      };
    });
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
