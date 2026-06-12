import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CalibrationComponent } from './calibration';
describe('Calibration', () => {
  let component: CalibrationComponent;
  let fixture: ComponentFixture<CalibrationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [CalibrationComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CalibrationComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
