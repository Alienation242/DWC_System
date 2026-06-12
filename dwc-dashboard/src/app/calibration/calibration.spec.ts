import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Calibration } from './calibration';

describe('Calibration', () => {
  let component: Calibration;
  let fixture: ComponentFixture<Calibration>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [Calibration]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Calibration);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
