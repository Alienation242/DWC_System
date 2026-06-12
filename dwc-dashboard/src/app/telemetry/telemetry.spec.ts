import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TelemetryComponent } from './telemetry';
describe('Telemetry', () => {
  let component: TelemetryComponent;
  let fixture: ComponentFixture<TelemetryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TelemetryComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TelemetryComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
