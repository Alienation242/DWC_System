import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Watchdog } from './watchdog';

describe('Watchdog', () => {
  let component: Watchdog;
  let fixture: ComponentFixture<Watchdog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [Watchdog]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Watchdog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
