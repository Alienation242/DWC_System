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
    this.api.getLatestTelemetry(this.potId).subscribe((data) => (this.telemetry = data));

    const limit = 20;
    this.api.getRecentDoses(this.potId, limit).subscribe({
      next: (data) => {
        console.log('💊 Doses received:', data);
        this.recentDoses = data;
      },
      error: (err) => console.error('Log API Error:', err),
    });

    this.api.getTelemetryHistory(this.potId, 50).subscribe((history) => {
      console.log('📜 History received:', history);
      history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const parsedLabels: string[] = [];
      const parsedPh: number[] = [];
      const parsedEc: number[] = [];

      history.forEach((d) => {
        // FIX 4: The Timezone UTC bug!
        // If the database timestamp is missing the 'Z', JS thinks it's local time (which causes the 2-hour gap in CEST).
        // Appending 'Z' forces it to parse as UTC, realigning it perfectly with your live local time.
        const safeStr = d.timestamp.endsWith('Z') ? d.timestamp : d.timestamp + 'Z';
        parsedLabels.push(new Date(safeStr).toLocaleTimeString());
        parsedPh.push(d.realPH);
        parsedEc.push(d.realEC);
      });

      this.phChartData.labels = parsedLabels;
      this.phChartData.datasets[0].data = parsedPh;

      this.ecChartData.labels = parsedLabels;
      this.ecChartData.datasets[0].data = parsedEc;

      this.phChart?.update();
      this.ecChart?.update();
      this.historyLoaded = true;
    });
  }

  pushLivePoint(data: Telemetry) {
    // Safely convert timestamp (use current time if missing)
    const timeStr = data.timestamp
      ? new Date(data.timestamp).toLocaleTimeString()
      : new Date().toLocaleTimeString();

    // Prevent duplicate timestamps
    if (this.phChartData.labels?.includes(timeStr)) return;

    this.phChartData.labels?.push(timeStr);
    this.phChartData.datasets[0].data.push(data.realPH);

    this.ecChartData.labels?.push(timeStr);
    this.ecChartData.datasets[0].data.push(data.realEC);

    // Keep only last 50 points
    while (this.phChartData.labels!.length > 50) {
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
