import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WatchdogComponent } from './watchdog';
describe('Watchdog', () => {
  let component: WatchdogComponent;
  let fixture: ComponentFixture<WatchdogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [WatchdogComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WatchdogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
