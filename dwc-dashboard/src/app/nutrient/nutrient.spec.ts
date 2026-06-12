import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Nutrient } from './nutrient';

describe('Nutrient', () => {
  let component: Nutrient;
  let fixture: ComponentFixture<Nutrient>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [Nutrient]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Nutrient);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
