import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NutrientComponent } from './nutrient';
describe('Nutrient', () => {
  let component: NutrientComponent;
  let fixture: ComponentFixture<NutrientComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [NutrientComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(NutrientComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
