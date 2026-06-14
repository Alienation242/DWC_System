import { Component, OnInit, OnDestroy, ViewChild, ChangeDetectorRef } from '@angular/core';
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
  historyLoaded = false;
  private subs = new Subscription();

  @ViewChild('phCanvas') phChart?: BaseChartDirective;
  @ViewChild('ecCanvas') ecChart?: BaseChartDirective;

  // Numeric x‑axis (seconds ago)
  public chartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    animation: false,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    elements: {
      point: { radius: 0, hitRadius: 10, hoverRadius: 5 },
      line: { tension: 0, borderWidth: 2 },
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Time (seconds ago)', color: 'var(--text)' },
        ticks: {
          color: 'var(--text)',
          callback: (val) => `${Math.round(Number(val))}s ago`,
        },
        grid: { color: 'rgba(150,150,150,0.1)' },
      },
      y: {
        ticks: { color: 'var(--text)' },
        grid: { color: 'rgba(150,150,150,0.1)' },
      },
    },
  };

  public phChartData: ChartConfiguration<'line'>['data'] = {
    datasets: [{ data: [], borderColor: '#4cbfa6', fill: false }],
  };

  public ecChartData: ChartConfiguration<'line'>['data'] = {
    datasets: [{ data: [], borderColor: '#dfb953', fill: false }],
  };

  displayedColumns = ['timestamp', 'pumpName', 'ml', 'status'];

  constructor(
    private route: ActivatedRoute,
    private socket: SocketService,
    private api: ApiService,
    private cdr: ChangeDetectorRef, // <-- add this
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
            this.cdr.detectChanges(); // force update
          }
        }
      }),
    );
  }

  loadData() {
    this.historyLoaded = false;
    this.api.getLatestTelemetry(this.potId).subscribe((data) => (this.telemetry = data));

    this.api.getRecentDoses(this.potId, 20).subscribe({
      next: (data) => {
        this.recentDoses = [...data];
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Failed to load doses:', err),
    });

    this.api.getTelemetryHistory(this.potId, 500).subscribe({
      next: (history) => {
        history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const recentHistory = history.slice(-50);
        const baseTime = recentHistory.length
          ? new Date(recentHistory[recentHistory.length - 1].timestamp).getTime()
          : Date.now();

        const phPoints: { x: number; y: number }[] = [];
        const ecPoints: { x: number; y: number }[] = [];

        for (const d of recentHistory) {
          const pointTime = new Date(d.timestamp).getTime();
          const secondsAgo = Math.round((baseTime - pointTime) / 1000);
          phPoints.push({ x: secondsAgo, y: Number(d.realPH) || 0 });
          ecPoints.push({ x: secondsAgo, y: Math.round(Number(d.realEC) || 0) });
        }

        // oldest first (negative secondsAgo)
        phPoints.reverse();
        ecPoints.reverse();

        this.phChartData.datasets[0].data = phPoints;
        this.ecChartData.datasets[0].data = ecPoints;

        this.historyLoaded = true;
        this.phChart?.update();
        this.ecChart?.update();
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load history:', err);
        this.historyLoaded = true;
      },
    });
  }

  pushLivePoint(data: Telemetry) {
    const currentPoints = this.phChartData.datasets[0].data as { x: number; y: number }[];
    const lastPoint = currentPoints.length ? currentPoints[currentPoints.length - 1] : null;
    let newX = 0;
    if (lastPoint && lastPoint.x < 0) {
      newX = lastPoint.x + 1; // keep moving right
    } else {
      newX = (lastPoint?.x || 0) + 1;
    }

    const phNum = Number(data.realPH) || 0;
    const ecNum = Number(data.realEC) || 0;
    const newPhPoint = { x: newX, y: parseFloat(phNum.toFixed(2)) };
    const newEcPoint = { x: newX, y: Math.round(ecNum) };

    let newPhData = [...currentPoints, newPhPoint];
    let newEcData = [
      ...(this.ecChartData.datasets[0].data as { x: number; y: number }[]),
      newEcPoint,
    ];

    if (newPhData.length > 50) {
      newPhData = newPhData.slice(-50);
      newEcData = newEcData.slice(-50);
    }

    this.phChartData.datasets[0].data = newPhData;
    this.ecChartData.datasets[0].data = newEcData;

    this.phChart?.update('none');
    this.ecChart?.update('none');
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
