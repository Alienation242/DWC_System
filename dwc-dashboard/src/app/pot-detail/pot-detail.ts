import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { SocketService, Telemetry } from '../services/socket.service';
import { ApiService } from '../services/api.service';
import { Subscription } from 'rxjs';

Chart.register(...registerables);

@Component({
  selector: 'app-pot-detail',
  standalone: true,
  templateUrl: './pot-detail.html',
  styleUrls: ['./pot-detail.css'],
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTableModule,
    BaseChartDirective,
  ],
})
export class PotDetailComponent implements OnInit, OnDestroy {
  potId!: string;
  telemetry: Telemetry | null = null;
  recentDoses: any[] = [];
  private subs = new Subscription();

  @ViewChild('phCanvas') phChart?: BaseChartDirective;
  @ViewChild('ecCanvas') ecChart?: BaseChartDirective;

  // Stripped-down chart configurations
  public chartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }, // <-- NO LEGEND
    },
    elements: {
      point: { radius: 0, hitRadius: 10, hoverRadius: 5 }, // <-- NO DOTS on the line
      line: { tension: 0.3, borderWidth: 3 },
    },
    scales: {
      x: {
        ticks: { color: 'var(--text)', maxTicksLimit: 8 },
        grid: { color: 'rgba(150,150,150,0.1)' },
      },
      y: { ticks: { color: 'var(--text)' }, grid: { color: 'rgba(150,150,150,0.1)' } },
    },
  };

  public phChartData: ChartConfiguration<'line'>['data'] = {
    datasets: [
      { data: [], borderColor: '#4cbfa6', backgroundColor: 'rgba(76, 191, 166, 0.1)', fill: true },
    ],
    labels: [],
  };
  public ecChartData: ChartConfiguration<'line'>['data'] = {
    datasets: [
      { data: [], borderColor: '#dfb953', backgroundColor: 'rgba(223, 185, 83, 0.1)', fill: true },
    ],
    labels: [],
  };

  displayedColumns = ['timestamp', 'pumpName', 'ml', 'status'];

  constructor(
    private route: ActivatedRoute,
    private socket: SocketService,
    private api: ApiService,
  ) {}

  ngOnInit() {
    this.potId = this.route.snapshot.paramMap.get('id') || 'A';
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
    this.api.getRecentDoses(this.potId, 20).subscribe((data) => (this.recentDoses = data));

    this.api.getTelemetryHistory(this.potId, 50).subscribe((history) => {
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

    if (this.phChartData.labels!.length > 50) {
      this.phChartData.labels?.shift();
      this.phChartData.datasets[0].data.shift();
      this.ecChartData.labels?.shift();
      this.ecChartData.datasets[0].data.shift();
    }
    this.phChart?.update();
    this.ecChart?.update();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
