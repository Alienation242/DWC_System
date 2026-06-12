import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatGridListModule } from '@angular/material/grid-list';

import { AppComponent } from './app.component';
import { TelemetryComponent } from './telemetry/telemetry.component';
import { SystemComponent } from './system/system.component';
import { WatchdogComponent } from './watchdog/watchdog.component';
import { NutrientComponent } from './nutrient/nutrient.component';
import { CalibrationComponent } from './calibration/calibration.component';
import { ManualComponent } from './manual/manual.component';
import { Telemetry } from './telemetry/telemetry';
import { Watchdog } from './watchdog/watchdog';
import { Nutrient } from './nutrient/nutrient';
import { Calibration } from './calibration/calibration';
import { Manual } from './manual/manual';

@NgModule({
  declarations: [
    AppComponent,
    TelemetryComponent,
    SystemComponent,
    WatchdogComponent,
    NutrientComponent,
    CalibrationComponent,
    ManualComponent,
    Telemetry,
    Watchdog,
    Nutrient,
    Calibration,
    Manual,
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    MatSnackBarModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatGridListModule,
  ],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}
