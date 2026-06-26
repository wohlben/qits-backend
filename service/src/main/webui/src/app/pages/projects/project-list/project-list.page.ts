import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { ProjectListComponent } from '@/pattern/project/project-list.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-project-list-page',
  imports: [PageLayoutComponent, ProjectListComponent, RouterLink, ZardButtonComponent],
  template: `
    <app-page-layout>
      <div pageTitle>
        <h1 class="text-2xl font-bold">Projects</h1>
        <p class="text-sm text-muted-foreground">Manage your projects and their repositories</p>
      </div>
      <div pageActions>
        <a z-button routerLink="/projects/new">New Project</a>
      </div>
      <app-project-list />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectListPage {}
