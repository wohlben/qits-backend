import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { ProjectRepositoryCreateFormComponent } from '@/pattern/project/project-repository-create-form.component';

@Component({
  selector: 'app-project-repository-new-page',
  imports: [PageLayoutComponent, ProjectRepositoryCreateFormComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">Add Repository</h1>
        <p class="text-sm text-muted-foreground">Create a new repository within this project</p>
      </div>
      <app-project-repository-create-form
        [projectId]="projectId"
        (saved)="onSaved()"
        (cancelled)="onCancelled()"
      />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectRepositoryNewPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly projectId = this.route.snapshot.paramMap.get('projectId')!;

  onSaved() {
    this.router.navigate(['/projects', this.projectId]);
  }

  onCancelled() {
    this.router.navigate(['/projects', this.projectId]);
  }
}
