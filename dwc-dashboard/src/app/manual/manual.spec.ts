import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ManualComponent } from './manual';
describe('Manual', () => {
  let component: ManualComponent;
  let fixture: ComponentFixture<ManualComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ManualComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ManualComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
