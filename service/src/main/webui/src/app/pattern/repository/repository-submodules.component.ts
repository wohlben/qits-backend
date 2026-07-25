import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { RepositorySubmoduleControllerService } from '@/api/api/repositorySubmoduleController.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardInputDirective } from '@/shared/components/input';
import { invalidateRepository } from '@/pattern/repository/invalidate-repository';

/**
 * The repository's submodule section: imported edges (linking to their sibling repositories) plus
 * the still-unimported `.gitmodules` entries with the "import submodules" action. Import is
 * user-driven layer by layer — this level's action imports this repository's DIRECT submodules;
 * recursing deeper is visiting an imported child and pressing the same button there. Renders
 * nothing for a submodule-free repository.
 */
@Component({
  selector: 'app-repository-submodules',
  imports: [RouterLink, ZardButtonComponent, ZardInputDirective],
  template: `
    <section class="flex flex-col gap-3 rounded-lg border p-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-medium">Submodules</h2>
        @if (available().length > 0) {
          <button z-button zType="secondary" (click)="importMutation.mutate()" [zLoading]="importMutation.isPending()">
            Import {{ available().length }} submodule{{ available().length === 1 ? '' : 's' }}
          </button>
        }
      </div>

      @if (importError(); as error) {
        <div class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {{ error }}
        </div>
      }

      @if (entries().length > 0) {
        <ul class="flex flex-col gap-1">
          @for (entry of entries(); track entry.submodule?.id) {
            <li class="flex items-baseline gap-2 text-sm">
              <a
                class="underline-offset-4 hover:underline"
                [routerLink]="['/repositories', entry.submodule?.childRepoId]"
              >
                {{ entry.submodule?.path }}
              </a>
              <span class="text-xs text-muted-foreground">imported as sibling repository</span>
            </li>
          }
        </ul>
      }

      @if (available().length > 0) {
        <ul class="flex flex-col gap-1">
          @for (sub of available(); track sub.path) {
            <li class="flex items-baseline gap-2 text-sm text-muted-foreground">
              <span>{{ sub.path }}</span>
              <span class="truncate text-xs" [title]="sub.url">{{ sub.url }}</span>
            </li>
          }
        </ul>
      }

      <!--
        Onboard a NEW submodule whose backend isn't served yet: pre-clone it as a sibling so an
        in-container \`git submodule add ../<name>.git\` resolves before the .gitmodules reference is
        committed. Points at the real backend (not the qits git host); relative-url convention.
      -->
      <div class="flex flex-col gap-2 border-t pt-3">
        <label class="text-xs font-medium text-muted-foreground" [attr.for]="backendUrlId">
          Add a submodule — pre-serve its backend
        </label>
        <div class="flex items-center gap-2">
          <input
            z-input
            [id]="backendUrlId"
            class="h-8 flex-1 font-mono text-xs"
            placeholder="https://github.com/owner/new-submodule.git"
            [value]="backendUrl()"
            (input)="backendUrl.set($any($event.target).value)"
            (keydown.enter)="prepare()"
            [attr.aria-invalid]="prepareError() !== null"
          />
          <button
            z-button
            zType="secondary"
            (click)="prepare()"
            [disabled]="backendUrl().trim().length === 0"
            [zLoading]="prepareMutation.isPending()"
          >
            Pre-serve
          </button>
        </div>

        @if (prepareError(); as error) {
          <div class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {{ error }}
          </div>
        }

        @if (prepareMutation.data(); as prepared) {
          <div class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            Served as sibling <span class="font-medium">{{ prepared.name }}</span>. In the
            superproject workspace run:
            <code class="mt-1 block font-mono">git submodule add {{ prepared.relativeUrl }} &lt;path&gt;</code>
            then commit + push, pull this repository, and Import.
          </div>
        }
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositorySubmodulesComponent {
  readonly repoId = input.required<string>();

  private readonly submoduleService = inject(RepositorySubmoduleControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly submodulesQuery = injectQuery(() => ({
    queryKey: ['repository', this.repoId(), 'submodules'],
    queryFn: () =>
      lastValueFrom(
        this.submoduleService.apiRepositoriesRepositoryIdSubmodulesGet(this.repoId()),
      ),
  }));

  readonly entries = computed(() => this.submodulesQuery.data()?.entries ?? []);
  readonly available = computed(() => this.submodulesQuery.data()?.available ?? []);

  readonly importMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(
        this.submoduleService.apiRepositoriesRepositoryIdSubmodulesImportPost(this.repoId()),
      ),
    // The import creates sibling repositories too, so refresh everything keyed on this repo AND
    // the project's repository list (new siblings appear there).
    onSuccess: () => {
      invalidateRepository(this.queryClient, this.repoId());
      this.queryClient.invalidateQueries({ queryKey: ['project-repositories'] });
    },
  }));

  readonly importError = computed(() => {
    const error = this.importMutation.error();
    return error ? `Import failed: ${error instanceof Error ? error.message : error}` : null;
  });

  // Onboarding a new submodule: pre-serve its real backend as a sibling so an in-container
  // `git submodule add ../<name>.git` resolves before the .gitmodules reference is committed.
  readonly backendUrl = signal('');
  readonly backendUrlId = `prepare-backend-${crypto.randomUUID()}`;

  readonly prepareMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(
        this.submoduleService.apiRepositoriesRepositoryIdSubmodulesPreparePost(this.repoId(), {
          backendUrl: this.backendUrl().trim(),
        }),
      ),
    // A pre-served sibling is a new repository under the project — refresh the project's list.
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['project-repositories'] });
    },
  }));

  prepare(): void {
    if (this.backendUrl().trim().length === 0) {
      return;
    }
    this.prepareMutation.mutate();
  }

  readonly prepareError = computed(() => {
    const error = this.prepareMutation.error();
    return error ? `Pre-serve failed: ${error instanceof Error ? error.message : error}` : null;
  });
}
