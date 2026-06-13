import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../services/api.service';
import { PotCardComponent } from '../pot-card/pot-card';

@Component({
  selector: 'app-telemetry',
  standalone: true,
  templateUrl: './telemetry.html',
  styleUrls: ['./telemetry.css'],
  imports: [CommonModule, PotCardComponent],
})
export class TelemetryComponent implements OnInit {
  pots: string[] = [];

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.getPots().subscribe((pots) => (this.pots = pots));
  }
}
