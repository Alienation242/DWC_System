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
  constructor(
    private api: ApiService,
    private snack: MatSnackBar,
  ) {}

  emergencyStop() {
    this.api.stopAll().subscribe(() => this.snack.open('Emergency stop sent', 'OK'));
  }
  doseWater(ml: number) {
    this.api
      .dose('Water', 'dose_water', ml)
      .subscribe((r) => this.snack.open(`Dosed ${r.dosedMl} ml`, 'OK'));
  }
  dosePhDown(ml: number) {
    this.api
      .dose('pH_Down', 'dose_ph_down', ml)
      .subscribe((r) => this.snack.open(`Dosed ${r.dosedMl} ml pH Down`, 'OK'));
  }
  deliver(target: string, vol: number) {
    this.api.deliver(target, vol).subscribe({
      next: () => this.snack.open(`Delivered ${vol} ml to pot ${target}`, 'OK'),
      error: (err) => this.snack.open(`Error: ${err.error?.error || err.message}`, 'Close'),
    });
  }
}
