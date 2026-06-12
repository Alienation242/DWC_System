import { Component, OnInit } from '@angular/core';
import { ApiService, NutrientConfig } from '../services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-nutrient',
  templateUrl: './nutrient.html',
  styleUrls: ['./nutrient.css'],
  standalone: false,
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
