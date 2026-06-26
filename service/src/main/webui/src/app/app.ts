import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'qits-root',
  imports: [RouterOutlet],
  template: `  <router-outlet />`,
  styles: [],
})
export class App {
}
