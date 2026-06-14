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

  @ViewChild('phCanvas') phChart?: BaseChartDirective;
  @ViewChild('ecCanvas') ecChart?: BaseChartDirective;

  public chartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    animation: false,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    elements: {
      point: { radius: 0, hitRadius: 10, hoverRadius: 5 },
      line: {
        tension: 0,
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
    this.historyLoaded = false;
    this.api.getLatestTelemetry(this.potId).subscribe((data) => (this.telemetry = data));
    this.api.getRecentDoses(this.potId, 20).subscribe((data) => (this.recentDoses = data));

    // 1. Ask the backend for a larger pool of history to bypass the sorting bug
    this.api.getTelemetryHistory(this.potId, 500).subscribe((history) => {
      // 2. Sort the data chronologically (oldest to newest)
      history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // 3. THE GAP FIX: Slice ONLY the most recent 50 points from the very end of the timeline
      const recentHistory = history.slice(-50);

      const parsedLabels: string[] = [];
      const parsedPh: number[] = [];
      const parsedEc: number[] = [];

      recentHistory.forEach((d) => {
        const safeStr = d.timestamp.endsWith('Z') ? d.timestamp : d.timestamp + 'Z';
        const timeLabel = new Date(safeStr).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        parsedLabels.push(timeLabel);
        // 4. THE AXIS FIX: Strip the massive floating-point decimals
        parsedPh.push(parseFloat(d.realPH.toFixed(2)));
        parsedEc.push(Math.round(d.realEC));
      });

      this.phChartData.labels = parsedLabels;
      this.phChartData.datasets[0].data = parsedPh;
      this.ecChartData.labels = parsedLabels;
      this.ecChartData.datasets[0].data = parsedEc;

      this.historyLoaded = true;
      this.phChart?.update();
      this.ecChart?.update();
    });
  }

  pushLivePoint(data: Telemetry) {
    const safeStr = data.timestamp
      ? data.timestamp.endsWith('Z')
        ? data.timestamp
        : data.timestamp + 'Z'
      : undefined;
    const timeNow = safeStr ? new Date(safeStr) : new Date();

    const timeStr = timeNow.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const lastLabel = this.phChartData.labels?.[this.phChartData.labels.length - 1];
    if (lastLabel === timeStr) return;

    // Apply the same rounding logic to the live points
    const cleanPh = parseFloat(data.realPH.toFixed(2));
    const cleanEc = Math.round(data.realEC);

    const newLabels = [...(this.phChartData.labels as string[]), timeStr];
    const newPhData = [...this.phChartData.datasets[0].data, cleanPh];
    const newEcData = [...this.ecChartData.datasets[0].data, cleanEc];

    if (newLabels.length > 50) {
      newLabels.shift();
      newPhData.shift();
      newEcData.shift();
    }

    this.phChartData.labels = newLabels;
    this.phChartData.datasets[0].data = newPhData;
    this.ecChartData.labels = newLabels;
    this.ecChartData.datasets[0].data = newEcData;

    this.phChart?.update();
    this.ecChart?.update();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
