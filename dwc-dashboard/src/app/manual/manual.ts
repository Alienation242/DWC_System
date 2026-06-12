import { Component } from '@angular/core';
import { ApiService } from '../services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-manual',
  templateUrl: './manual.html',
  styleUrls: ['./manual.css'],
  standalone: false,
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
    this.api
      .deliver(target, vol)
      .subscribe(() => this.snack.open(`Delivered ${vol} ml to pot ${target}`, 'OK'));
  }
}
