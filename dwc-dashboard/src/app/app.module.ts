import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

import { MaterialModule } from './material.module';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app';
import { TelemetryComponent } from './telemetry/telemetry';
import { WatchdogComponent } from './watchdog/watchdog';
import { NutrientComponent } from './nutrient/nutrient';
import { CalibrationComponent } from './calibration/calibration';
import { ManualComponent } from './manual/manual';

@NgModule({
    declarations: [AppComponent],
    imports: [
        BrowserModule,
        BrowserAnimationsModule,
        HttpClientModule,
        FormsModule,
        MaterialModule,
        AppRoutingModule,
        TelemetryComponent,
        WatchdogComponent,
        NutrientComponent,
        CalibrationComponent,
        ManualComponent,
    ],
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
    providers: [],
    bootstrap: [AppComponent],
})
export class AppModule {}
