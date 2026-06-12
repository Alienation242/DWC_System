import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { ApiService, WatchdogConfig } from '../services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCard, MatCardTitle, MatCardContent } from '@angular/material/card';
import { MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow } from '@angular/material/table';
import { FormsModule } from '@angular/forms';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatButton } from '@angular/material/button';

@Component({
    selector: 'app-watchdog',
    templateUrl: './watchdog.html',
    styleUrls: ['./watchdog.css'],
    imports: [
        MatCard,
        MatCardTitle,
        MatCardContent,
        MatTable,
        MatColumnDef,
        MatHeaderCellDef,
        MatHeaderCell,
        MatCellDef,
        MatCell,
        FormsModule,
        MatSlideToggle,
        MatButton,
        MatHeaderRowDef,
        MatHeaderRow,
        MatRowDef,
        MatRow,
    ],
})
export class WatchdogComponent implements OnInit {
  configs: WatchdogConfig[] = [];
  displayedColumns = ['pumpName', 'dailyLimitMl', 'cooldownSecs', 'enabled', 'actions'];

  constructor(
    private api: ApiService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.api.getWatchdogConfigs().subscribe({
      next: (c) => {
        this.configs = c;
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Failed to load watchdog configs', err),
    });
  }

  save(config: WatchdogConfig) {
    this.api.upsertWatchdogConfig(config).subscribe({
      next: () => this.snackBar.open(`Saved ${config.pumpName}`, 'OK', { duration: 2000 }),
      error: (err) => this.snackBar.open(`Error: ${err.message}`, 'Close', { duration: 3000 }),
    });
  }
}
