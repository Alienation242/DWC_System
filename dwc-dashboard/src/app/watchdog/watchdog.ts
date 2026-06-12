import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService, WatchdogConfig } from '../services/api.service';
import { DialogService } from '../services/dialog.service';
import { MatDialogModule } from '@angular/material/dialog';

@Component({
  selector: 'app-watchdog',
  standalone: true,
  templateUrl: './watchdog.html',
  styleUrls: ['./watchdog.css'],
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatTableModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatDialogModule,
  ],
})
export class WatchdogComponent implements OnInit {
  configs: WatchdogConfig[] = [];
  displayedColumns = ['pumpName', 'dailyLimitMl', 'cooldownSecs', 'enabled', 'actions'];

  constructor(
    private api: ApiService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private dialog: DialogService,
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
    this.dialog
      .confirm(`Save watchdog config for ${config.pumpName}?`, 'Confirm')
      .subscribe((confirmed) => {
        if (confirmed) {
          this.api.upsertWatchdogConfig(config).subscribe({
            next: () => this.snackBar.open(`Saved ${config.pumpName}`, 'OK', { duration: 2000 }),
            error: (err) =>
              this.snackBar.open(`Error: ${err.message}`, 'Close', { duration: 3000 }),
          });
        }
      });
  }
}
