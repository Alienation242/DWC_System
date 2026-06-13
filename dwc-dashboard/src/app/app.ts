import { Component, Inject, OnInit } from '@angular/core';
import { DOCUMENT, CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatSelectModule,
    MatFormFieldModule,
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class AppComponent implements OnInit {
  title = 'dwc-dashboard';
  currentTheme = 'theme-default';

  constructor(@Inject(DOCUMENT) private document: Document) {}

  ngOnInit() {
    const savedTheme = localStorage.getItem('dwc-theme') || 'theme-default';
    this.setTheme(savedTheme);
  }

  setTheme(themeName: string) {
    this.currentTheme = themeName;
    localStorage.setItem('dwc-theme', themeName);

    const themeLink = this.document.getElementById('app-theme') as HTMLLinkElement;
    if (themeLink) {
      themeLink.href = `${themeName}.css`;
    }
  }
}
