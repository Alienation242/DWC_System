import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-manual',
  standalone: true,
  templateUrl: './manual.html',
  styleUrls: ['./manual.css'],
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatListModule,
    MatFormFieldModule,
    MatSelectModule,
  ],
})
export class ManualComponent {
  waterVol = 500;
  phDownVol = 2;
  phUpVol = 2;
  deliverTarget = 'A';
  deliverVol = 1000;

  constructor(
    private api: ApiService,
    private snack: MatSnackBar,
  ) {}

  emergencyStop() {
    this.api.stopAll().subscribe(() => this.snack.open('Emergency stop sent', 'OK'));
  }

  doseWater() {
    this.api
      .dose('Water', 'dose_water', this.waterVol)
      .subscribe((r) => this.snack.open(`Dosed ${r.dosedMl} ml`, 'OK'));
  }

  private dosePh(type: 'pH_Down' | 'pH_Up', action: 'dose_ph_down' | 'dose_ph_up', ml: number) {
    this.api
      .dose('Water', 'dose_water', 250) // carrier water first
      .subscribe({
        next: (waterResult) => {
          this.api.dose(type, action, ml).subscribe({
            next: (phResult) => {
              this.snack.open(
                `Dosed ${waterResult.dosedMl}ml water + ${phResult.dosedMl}ml ${type}`,
                'OK',
              );
            },
            error: (err) => this.snack.open(`pH dose error: ${err.message}`, 'Close'),
          });
        },
        error: (err) => this.snack.open(`Water dose error: ${err.message}`, 'Close'),
      });
  }

  dosePhDown() {
    this.dosePh('pH_Down', 'dose_ph_down', this.phDownVol);
  }

  dosePhUp() {
    this.dosePh('pH_Up', 'dose_ph_up', this.phUpVol);
  }

  deliver() {
    this.api.deliver(this.deliverTarget, this.deliverVol).subscribe({
      next: () =>
        this.snack.open(`Delivered ${this.deliverVol} ml to pot ${this.deliverTarget}`, 'OK'),
      error: (err) => this.snack.open(`Error: ${err.error?.error || err.message}`, 'Close'),
    });
  }
}
