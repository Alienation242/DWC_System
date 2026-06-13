import { Component, Input, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatDividerModule } from '@angular/material/divider';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { SocketService, Telemetry } from '../services/socket.service';
import { ApiService } from '../services/api.service';
import { Subscription } from 'rxjs';

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

  // Grab the charts from the HTML so we can force them to update
  @ViewChild('phCanvas') phChart?: BaseChartDirective;
  @ViewChild('ecCanvas') ecChart?: BaseChartDirective;

  telemetry: Telemetry | null = null;
  targetPPM = 0;
  phase = '';
  recentDoses: any[] = [];
  private subs = new Subscription();
  showingPPM: boolean = false;

  get ppm() {
    return this.telemetry ? this.telemetry.realEC * 0.5 : 0;
  }

  get targetEC() {
    return this.targetPPM * 2;
  }

  toggleEcPpm() {
    this.showingPPM = !this.showingPPM;
  }

  public phChartData: ChartConfiguration<'line'>['data'] = {
    datasets: [
      {
        data: [],
        label: 'pH',
        borderColor: '#4cbfa6',
        backgroundColor: 'rgba(76, 191, 166, 0.2)',
        fill: true,
        tension: 0.4,
      },
    ],
    labels: [],
  };
  public ecChartData: ChartConfiguration<'line'>['data'] = {
    datasets: [
      {
        data: [],
        label: 'EC (µS/cm)',
        borderColor: '#dfb953',
        backgroundColor: 'rgba(223, 185, 83, 0.2)',
        fill: true,
        tension: 0.4,
      },
    ],
    labels: [],
  };

  // Upgraded Chart Options to look good in dark mode
  public chartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: 'var(--text, #999)' } } },
    scales: {
      x: {
        ticks: { color: 'var(--text, #999)', maxTicksLimit: 6 },
        grid: { color: 'rgba(150, 150, 150, 0.1)' },
      },
      y: {
        ticks: { color: 'var(--text, #999)' },
        grid: { color: 'rgba(150, 150, 150, 0.1)' },
      },
    },
  };

  public lineChartType: 'line' = 'line';
  displayedColumns = ['timestamp', 'pumpName', 'ml', 'status'];

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
          this.pushLivePoint(data);
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
      history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      this.phChartData.labels = history.map((d) => new Date(d.timestamp).toLocaleTimeString());
      this.phChartData.datasets[0].data = history.map((d) => d.realPH);

      this.ecChartData.labels = history.map((d) => new Date(d.timestamp).toLocaleTimeString());
      this.ecChartData.datasets[0].data = history.map((d) => d.realEC);

      this.phChart?.update();
      this.ecChart?.update();
    });
  }

  pushLivePoint(data: Telemetry) {
    const timeNow = new Date().toLocaleTimeString();

    this.phChartData.labels?.push(timeNow);
    this.phChartData.datasets[0].data.push(data.realPH);

    this.ecChartData.labels?.push(timeNow);
    this.ecChartData.datasets[0].data.push(data.realEC);

    if (this.phChartData.labels!.length > 30) {
      this.phChartData.labels?.shift();
      this.phChartData.datasets[0].data.shift();

      this.ecChartData.labels?.shift();
      this.ecChartData.datasets[0].data.shift();
    }

    this.phChart?.update();
    this.ecChart?.update();
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
