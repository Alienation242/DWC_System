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
  historyLoaded: boolean = false;
  private subs = new Subscription();

  public chartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    animation: false,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    elements: {
      point: { radius: 0, hitRadius: 10, hoverRadius: 5 },
      line: {
        tension: 0, // <-- FIX 1: This makes the line perfectly straight (removes arcs)
        borderWidth: 2,
      },
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
    // FIX 2: Set fill to false to remove the blob under the arc
    datasets: [{ data: [], borderColor: '#4cbfa6', fill: false }],
    labels: [],
  };

  public ecChartData: ChartConfiguration<'line'>['data'] = {
    // FIX 3: Set fill to false and strictly use the BioShock Gold/Brass accent
    datasets: [{ data: [], borderColor: '#dfb953', fill: false }],
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
          if (this.historyLoaded) {
            this.pushLivePoint(data);
          }
        }
      }),
    );
  }

  loadData() {
    this.historyLoaded = false; // Block socket updates while loading
    this.api.getLatestTelemetry(this.potId).subscribe((data) => (this.telemetry = data));
    this.api.getRecentDoses(this.potId, 20).subscribe((data) => (this.recentDoses = data));

    this.api.getTelemetryHistory(this.potId, 50).subscribe((history) => {
      // 1. Wipe old data
      this.phChartData.labels = [];
      this.phChartData.datasets[0].data = [];
      this.ecChartData.labels = [];
      this.ecChartData.datasets[0].data = [];

      // 2. Sort and Parse
      history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      history.forEach((d) => {
        const safeStr = d.timestamp.endsWith('Z') ? d.timestamp : d.timestamp + 'Z';
        const timeLabel = new Date(safeStr).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });

        this.phChartData.labels?.push(timeLabel);
        this.phChartData.datasets[0].data.push(d.realPH);
        this.ecChartData.labels?.push(timeLabel);
        this.ecChartData.datasets[0].data.push(d.realEC);
      });

      this.historyLoaded = true; // Unlock socket updates
      this.phChart?.update();
      this.ecChart?.update();
    });
  }

  pushLivePoint(data: Telemetry) {
    const timeStr = data.timestamp
      ? new Date(data.timestamp).toLocaleTimeString()
      : new Date().toLocaleTimeString();
    if (this.phChartData.labels?.includes(timeStr)) return;

    this.phChartData.labels?.push(timeStr);
    this.phChartData.datasets[0].data.push(data.realPH);
    this.ecChartData.labels?.push(timeStr);
    this.ecChartData.datasets[0].data.push(data.realEC);

    while (this.phChartData.labels!.length > 50) {
      this.phChartData.labels?.shift();
      this.phChartData.datasets[0].data.shift();
      this.ecChartData.labels?.shift();
      this.ecChartData.datasets[0].data.shift();
    }
    // No need to call update() – NgChartsModule listens to changes
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
