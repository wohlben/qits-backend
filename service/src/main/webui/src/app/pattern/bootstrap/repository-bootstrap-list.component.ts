import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { BootstrapCommandControllerService } from '@/api/api/bootstrapCommandController.service';
import { BootstrapCommandDto } from '@/api/model/bootstrapCommandDto';
import { BootstrapCommandCardComponent } from '@/ui/components/bootstrap/bootstrap-command-card.component';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';

/**
 * The repository's bootstrap chain in execution order. UI-origin commands reorder with up/down
 * (each move sends the full id list to the atomic order endpoint); config-origin commands are
 * pinned to their file position and re-stamped on every ingest, so they don't offer the buttons.
 */
@Component({
  selector: 'app-repository-bootstrap-list',
  imports: [BootstrapCommandCardComponent, EmptyStateComponent],
  template: `
    @if (commandsQuery.isPending()) {
      <div class="py-12 text-center text-muted-foreground">Loading bootstrap commands…</div>
    } @else if (commandsQuery.isError()) {
      <div class="py-12 text-center text-destructive">Failed to load bootstrap commands</div>
    } @else {
      @let commands = commandsQuery.data() ?? [];
      @if (commands.length === 0) {
        <app-empty-state>
          <span title>No bootstrap commands yet</span>
          <span description>
            Declare the ordered one-shot steps (install, build, seed) a fresh workspace container
            runs before its daemons start
          </span>
        </app-empty-state>
      } @else {
        <ul class="flex flex-col divide-y rounded-md border">
          @for (command of commands; track command.id) {
            <li>
              <app-bootstrap-command-card
                [command]="command"
                [position]="$index"
                [canMoveUp]="$index > 0"
                [canMoveDown]="$index < commands.length - 1"
                (moveUp)="move(commands, $index, $index - 1)"
                (moveDown)="move(commands, $index, $index + 1)"
              />
            </li>
          }
        </ul>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryBootstrapListComponent {
  readonly repoId = input.required<string>();

  private readonly bootstrapService = inject(BootstrapCommandControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly commandsQuery = injectQuery(() => ({
    queryKey: ['repository-bootstrap-commands', this.repoId()],
    queryFn: () =>
      lastValueFrom(
        this.bootstrapService.apiRepositoriesRepositoryIdBootstrapCommandsGet(this.repoId()),
      ).then(
        (r) =>
          r.entries?.map((e) => e.command).filter((c): c is BootstrapCommandDto => !!c) ?? [],
      ),
  }));

  readonly orderMutation = injectMutation(() => ({
    mutationFn: (ids: string[]) =>
      lastValueFrom(
        this.bootstrapService.apiRepositoriesRepositoryIdBootstrapCommandsOrderPut(this.repoId(), {
          ids,
        }),
      ),
    onSettled: () =>
      this.queryClient.invalidateQueries({
        queryKey: ['repository-bootstrap-commands', this.repoId()],
      }),
  }));

  /** Swap the rows at `from`/`to` and submit the whole resulting order atomically. */
  move(commands: BootstrapCommandDto[], from: number, to: number) {
    if (to < 0 || to >= commands.length || this.orderMutation.isPending()) {
      return;
    }
    const ids = commands.map((c) => c.id!);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    this.orderMutation.mutate(ids);
  }
}
