import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  AfterViewInit,
  ChangeDetectorRef,
} from '@angular/core';
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
export class PotDetailComponent implements OnInit, AfterViewInit, OnDestroy {
  potId!: string;
  telemetry: Telemetry | null = null;
  recentDoses: any[] = [];
  historyLoaded = false;
  private subs = new Subscription();
  private chartSlideInterval: any;
  private chartsReady = false;
  private readonly STORAGE_KEY = 'potDetailTimeWindow';

  @ViewChild('phCanvas') phChart?: BaseChartDirective;
  @ViewChild('ecCanvas') ecChart?: BaseChartDirective;

  // Full historical arrays (never filtered)
  private fullPhPoints: { x: number; y: number }[] = [];
  private fullEcPoints: { x: number; y: number }[] = [];

  // Filtered arrays for display (recomputed on each window change)
  public phPoints: { x: number; y: number }[] = [];
  public ecPoints: { x: number; y: number }[] = [];

  public showPPM = false;
  public chartTitle = 'EC Nutrient Concentration (µS/cm)';

  public timeWindows = [
    { label: '1m', value: 60 * 1000 },
    { label: '5m', value: 5 * 60 * 1000 },
    { label: '60m', value: 60 * 60 * 1000 },
    { label: '12h', value: 12 * 60 * 60 * 1000 },
    { label: '24h', value: 24 * 60 * 60 * 1000 },
  ];
  public selectedWindow = 5 * 60 * 1000;

  private getBaseChartOptions(
    title: string,
    yTitle: string,
    yTickFormatter?: (value: string | number) => string,
  ): ChartConfiguration<'line'>['options'] {
    return {
      responsive: true,
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (ctx) => {
              const xVal = ctx[0]?.parsed?.x;
              return xVal ? new Date(xVal).toLocaleTimeString() : '';
            },
          },
        },
      },
      elements: {
        point: { radius: 0, hitRadius: 15, hoverRadius: 5 },
        line: { tension: 0.1, borderWidth: 2 },
      },
      scales: {
        x: {
          type: 'linear',
          min: Date.now() - this.selectedWindow,
          max: Date.now(),
          title: { display: true, text: 'Time', color: 'var(--text)' },
          ticks: {
            color: 'var(--text)',
            callback: (val) =>
              new Date(val as number).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }),
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
          },
          grid: { color: 'rgba(150,150,150,0.1)' },
        },
        y: {
          title: { display: true, text: yTitle, color: 'var(--text)' },
          ticks: {
            color: 'var(--text)',
            callback:
              yTickFormatter ||
              ((value: string | number) => {
                const num = typeof value === 'string' ? parseFloat(value) : value;
                return isNaN(num) ? '0' : num.toFixed(2);
              }),
          },
          grid: { color: 'rgba(150,150,150,0.1)' },
        },
      },
    };
  }

  private roundTo2(num: number): number {
    return Math.round(num * 100) / 100;
  }

  public phChartOptions = this.getBaseChartOptions(
    'pH Stabilization Curve',
    'pH',
    (value: string | number) => {
      const num = typeof value === 'string' ? parseFloat(value) : value;
      return isNaN(num) ? '0' : num.toFixed(2);
    },
  );

  public ecChartOptions = this.getBaseChartOptions(
    this.chartTitle,
    'EC (µS/cm)',
    (value: string | number) => {
      const num = typeof value === 'string' ? parseFloat(value) : value;
      return isNaN(num) ? '0' : Math.round(num).toString();
    },
  );

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
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.potId = this.route.snapshot.paramMap.get('id') || 'A';

    // Restore saved time window
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (this.timeWindows.some((w) => w.value === parsed)) {
        this.selectedWindow = parsed;
      }
    }

    this.loadData();

    this.subs.add(
      this.socket.onTelemetry().subscribe((data) => {
        if (data.potId === this.potId) {
          this.telemetry = data;
          if (this.historyLoaded) {
            this.pushLivePoint(data);
            this.cdr.detectChanges();
          }
        }
      }),
    );
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.chartsReady = true;
      this.slideCharts();
    }, 100);
    this.chartSlideInterval = setInterval(() => {
      if (this.historyLoaded && this.chartsReady) {
        this.slideCharts();
      }
    }, 1000);
  }

  setWindow(ms: number) {
    this.selectedWindow = ms;
    localStorage.setItem(this.STORAGE_KEY, ms.toString());
    this.slideCharts(); // Will recompute filtered points from full arrays
  }

  toggleUnit() {
    this.showPPM = !this.showPPM;
    this.chartTitle = this.showPPM
      ? 'Nutrient Concentration (PPM)'
      : 'EC Nutrient Concentration (µS/cm)';

    if (this.ecChart?.chart?.options?.scales?.['y']) {
      const yScale = this.ecChart.chart.options.scales['y'] as any;
      yScale.title.text = this.showPPM ? 'PPM' : 'EC (µS/cm)';
      yScale.ticks.callback = (value: string | number) => {
        const num = typeof value === 'string' ? parseFloat(value) : value;
        return isNaN(num) ? '0' : Math.round(num).toString();
      };
    }
    this.slideCharts();
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

    this.api.getTelemetryHistory(this.potId, 2000).subscribe({
      next: (history) => {
        history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        this.fullPhPoints = [];
        this.fullEcPoints = [];
        for (const d of history) {
          const ts = new Date(d.timestamp).getTime();
          this.fullPhPoints.push({ x: ts, y: Number(d.realPH) || 0 });
          this.fullEcPoints.push({ x: ts, y: Number(d.realEC) || 0 });
        }
        this.historyLoaded = true;
        this.slideCharts(); // This will filter and display
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load history:', err);
        this.historyLoaded = true;
      },
    });
  }

  pushLivePoint(data: Telemetry) {
    const now = Date.now();
    const phNum = this.roundTo2(Number(data.realPH) || 0);
    const ecNum = this.roundTo2(Number(data.realEC) || 0);
    this.fullPhPoints.push({ x: now, y: phNum });
    this.fullEcPoints.push({ x: now, y: ecNum });
    this.slideCharts();
  }

  slideCharts() {
    if (!this.chartsReady || !this.historyLoaded) return;

    const now = Date.now();
    const minTime = now - this.selectedWindow;

    // Filter full arrays to the current window (without mutating the originals)
    this.phPoints = this.fullPhPoints.filter((p) => p.x >= minTime);
    this.ecPoints = this.fullEcPoints.filter((p) => p.x >= minTime);

    // Update pH chart
    if (this.phChart?.chart) {
      this.phChart.chart.data.datasets[0].data = this.phPoints;
      if (this.phChart.chart.options.scales?.['x']) {
        this.phChart.chart.options.scales['x'].min = minTime;
        this.phChart.chart.options.scales['x'].max = now;
      }
      this.phChart.chart.update();
    }

    // Update EC chart (convert to PPM if needed)
    if (this.ecChart?.chart) {
      this.ecChart.chart.data.datasets[0].data = this.ecPoints.map((p) => ({
        x: p.x,
        y: this.showPPM ? this.roundTo2(p.y * 0.5) : p.y,
      }));
      if (this.ecChart.chart.options.scales?.['x']) {
        this.ecChart.chart.options.scales['x'].min = minTime;
        this.ecChart.chart.options.scales['x'].max = now;
      }
      this.ecChart.chart.update();
    }
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    if (this.chartSlideInterval) clearInterval(this.chartSlideInterval);
  }
}
