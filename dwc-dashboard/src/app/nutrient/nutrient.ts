import { Component, OnInit } from '@angular/core';
import { ApiService, NutrientConfig } from '../services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCard, MatCardTitle, MatCardContent } from '@angular/material/card';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatSelect, MatOption } from '@angular/material/select';
import { NgFor } from '@angular/common';
import { MatButton } from '@angular/material/button';

@Component({
    selector: 'app-nutrient',
    templateUrl: './nutrient.html',
    styleUrls: ['./nutrient.css'],
    imports: [
        MatCard,
        MatCardTitle,
        MatCardContent,
        MatFormField,
        MatLabel,
        MatInput,
        FormsModule,
        MatSelect,
        NgFor,
        MatOption,
        MatButton,
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
