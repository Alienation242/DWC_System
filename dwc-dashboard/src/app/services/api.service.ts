import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface Calibration {
  pH: {
    rawLow: number;
    realLow: number;
    rawHigh: number;
    realHigh: number;
    lastCalibration: string;
  };
  EC: {
    rawLow: number;
    realLow: number;
    rawHigh: number;
    realHigh: number;
    lastCalibration: string;
  };
}

export interface NutrientConfig {
  brandName: string;
  carrierFluid: string;
  carrierVolumeMl: number;
  mixingSequence: string[];
}

export interface WatchdogConfig {
  pumpName: string;
  dailyLimitMl: number;
  cooldownSecs: number;
  enabled: boolean;
}

export interface SystemState {
  id: number;
  currentStrain: string;
  currentProfilePath: string;
  currentDay: number;
  automationMode: string;
  sysVol: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = '/api';

  constructor(private http: HttpClient) {}

  getStatus() {
    return this.http.get<{ status: string; hardware: any }>(`${this.base}/status`);
  }
  getCalibration() {
    return this.http.get<Calibration>(`${this.base}/calibration`);
  }
  updateCalibration(cal: Calibration) {
    return this.http.post<Calibration>(`${this.base}/calibration`, cal);
  }
  getNutrientConfig() {
    return this.http.get<NutrientConfig>(`${this.base}/nutrient-config`);
  }
  updateNutrientConfig(config: NutrientConfig) {
    return this.http.post<{ success: boolean }>(`${this.base}/nutrient-config`, config);
  }
  getWatchdogConfigs() {
    return this.http.get<WatchdogConfig[]>(`${this.base}/watchdog/config`);
  }
  upsertWatchdogConfig(config: WatchdogConfig) {
    return this.http.post<WatchdogConfig>(`${this.base}/watchdog/config`, config);
  }
  getSystemState() {
    return this.http.get<SystemState>(`${this.base}/system/state`);
  }
  advanceDay() {
    return this.http.post<{ currentDay: number }>(`${this.base}/system/advance-day`, {});
  }
  setOverrideMode(mode: string) {
    return this.http.post<{ automationMode: string }>(`${this.base}/system/override`, { mode });
  }
  getTarget() {
    return this.http.get<{ targetPPM: number; phase: string }>(`${this.base}/system/target`);
  }

  stopAll() {
    return this.http.post<{ success: boolean }>(`${this.base}/manual/stop`, {});
  }
  dose(pumpName: string, actionStr: string, ml: number) {
    return this.http.post<{ success: boolean; dosedMl: number }>(`${this.base}/manual/dose`, {
      pumpName,
      actionStr,
      ml,
    });
  }
  deliver(target: string, volumeMl: number) {
    return this.http.post<{ success: boolean }>(`${this.base}/manual/deliver`, {
      target,
      volumeMl: volumeMl,
    });
  }
}
