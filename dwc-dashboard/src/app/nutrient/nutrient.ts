import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService, NutrientConfig } from '../services/api.service';

@Component({
  selector: 'app-nutrient',
  standalone: true,
  templateUrl: './nutrient.html',
  styleUrls: ['./nutrient.css'],
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
})
export class NutrientComponent implements OnInit {
  config: NutrientConfig = {
    brandName: '',
    carrierFluid: '',
    carrierVolumeMl: 0,
    mixingSequence: [],
  };
  availableNutrients = ['CalMag', 'Micro', 'Gro', 'Bloom', 'Finisher'];

  constructor(
    private api: ApiService,
    private snack: MatSnackBar,
  ) {}

  ngOnInit() {
    this.api.getNutrientConfig().subscribe((c) => (this.config = c));
  }

  save() {
    this.api.updateNutrientConfig(this.config).subscribe({
      next: () => this.snack.open('Nutrient profile saved', 'OK', { duration: 2000 }),
      error: (err) => this.snack.open(`Error: ${err.message}`, 'Close', { duration: 3000 }),
    });
  }
}
