import { Component, OnInit } from '@angular/core';
import { ApiService, WatchdogConfig } from '../services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-watchdog',
  templateUrl: './watchdog.html',
  styleUrls: ['./watchdog.css'],
  standalone: false,
})
export class WatchdogComponent implements OnInit {
  configs: WatchdogConfig[] = [];
  displayedColumns = ['pumpName', 'dailyLimitMl', 'cooldownSecs', 'enabled', 'actions'];

  constructor(
    private api: ApiService,
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit() {
    this.api.getWatchdogConfigs().subscribe((c) => (this.configs = c));
  }

  save(config: WatchdogConfig) {
    this.api.upsertWatchdogConfig(config).subscribe({
      next: () => this.snackBar.open(`Saved ${config.pumpName}`, 'OK', { duration: 2000 }),
      error: (err) => this.snackBar.open(`Error: ${err.message}`, 'Close', { duration: 3000 }),
    });
  }
}
