import { Routes } from '@angular/router';
import { TelemetryComponent } from './telemetry/telemetry';
import { WatchdogComponent } from './watchdog/watchdog';
import { NutrientComponent } from './nutrient/nutrient';
import { CalibrationComponent } from './calibration/calibration';
import { ManualComponent } from './manual/manual';

export const routes: Routes = [
  { path: 'dashboard', component: TelemetryComponent },
  { path: 'watchdog', component: WatchdogComponent },
  { path: 'nutrient', component: NutrientComponent },
  { path: 'calibration', component: CalibrationComponent },
  { path: 'manual', component: ManualComponent },
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
];
