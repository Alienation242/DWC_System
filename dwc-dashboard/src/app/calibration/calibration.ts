import { Component, OnInit } from '@angular/core';
import { ApiService, Calibration } from '../services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCard, MatCardTitle, MatCardContent } from '@angular/material/card';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';

@Component({
    selector: 'app-calibration',
    templateUrl: './calibration.html',
    styleUrls: ['./calibration.css'],
    imports: [
        MatCard,
        MatCardTitle,
        MatCardContent,
        MatFormField,
        MatLabel,
        MatInput,
        FormsModule,
        MatButton,
    ],
})
export class CalibrationComponent implements OnInit {
  calibration: Calibration = {
    pH: { rawLow: 0, realLow: 1.0, rawHigh: 4095, realHigh: 12.0, lastCalibration: '' },
    EC: { rawLow: 0, realLow: 0.0, rawHigh: 4095, realHigh: 8000.0, lastCalibration: '' },
  };

  constructor(
    private api: ApiService,
    private snack: MatSnackBar,
  ) {}

  ngOnInit() {
    this.api.getCalibration().subscribe((c) => (this.calibration = c));
  }

  save() {
    this.api.updateCalibration(this.calibration).subscribe({
      next: () => this.snack.open('Calibration saved', 'OK', { duration: 2000 }),
      error: (err) => this.snack.open(`Error: ${err.message}`, 'Close', { duration: 3000 }),
    });
  }
}
