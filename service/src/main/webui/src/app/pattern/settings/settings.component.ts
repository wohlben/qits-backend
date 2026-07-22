import { ChangeDetectionStrategy, Component, inject, linkedSignal } from '@angular/core';
import { form, FormField, submit } from '@angular/forms/signals';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { SettingControllerService } from '@/api';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardSelectComponent } from '@/shared/components/select';
import { ZardSelectItemComponent } from '@/shared/components/select/select-item.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';

/** The key of the DB-backed default-agent setting the picker reads and writes. */
const DEFAULT_AGENT_KEY = 'agent.default-type';

interface SettingsFormData {
  agentDefaultType: string;
}

/**
 * The settings surface: a small form over the DB-backed instance settings. Today it edits the
 * default coding agent, but the form is shaped so more settings can be added as extra fields.
 */
@Component({
  selector: 'app-settings',
  imports: [
    FormField,
    FormFieldLayoutComponent,
    FormFieldSlotDirective,
    ZardButtonComponent,
    ZardSelectComponent,
    ZardSelectItemComponent,
  ],
  template: `
    @if (settingQuery.isPending()) {
      <div class="py-12 text-center text-muted-foreground">Loading settings…</div>
    } @else if (settingQuery.isError()) {
      <div class="py-12 text-center text-destructive">Failed to load settings</div>
    } @else {
      <form (submit)="onSubmit($event)" class="flex max-w-xl flex-col gap-4">
        <app-form-field-layout
          [field]="form.agentDefaultType"
          id="settings-agent-default-type"
          label="Default coding agent"
        >
          <z-select
            appFormFieldSlot="input"
            [formField]="form.agentDefaultType"
            zPlaceholder="Select…"
          >
            <z-select-item zValue="CLAUDE">Claude Code</z-select-item>
            <z-select-item zValue="KIMI">Kimi Code</z-select-item>
          </z-select>
        </app-form-field-layout>

        <div class="flex items-center gap-2">
          <button
            z-button
            type="submit"
            [zLoading]="saveMutation.isPending()"
            [zDisabled]="!form.agentDefaultType().value()"
          >
            Save
          </button>
          @if (saveMutation.isSuccess()) {
            <span class="text-sm text-muted-foreground">Saved</span>
          }
          @if (saveMutation.isError()) {
            <span class="text-sm text-destructive">Failed to save</span>
          }
        </div>
      </form>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  private readonly settingService = inject(SettingControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly settingQuery = injectQuery(() => ({
    queryKey: ['setting', DEFAULT_AGENT_KEY],
    queryFn: () =>
      lastValueFrom(this.settingService.apiSettingsKeyGet(DEFAULT_AGENT_KEY)).then(
        (res) => res.setting?.value ?? '',
      ),
  }));

  // Seeded from the loaded value, but writable so user edits stick until the next server value
  // lands (e.g. after a save invalidates and refetches).
  readonly model = linkedSignal<SettingsFormData>(() => ({
    agentDefaultType: this.settingQuery.data() ?? '',
  }));
  readonly form = form(this.model);

  readonly saveMutation = injectMutation(() => ({
    mutationFn: (value: string) =>
      lastValueFrom(this.settingService.apiSettingsKeyPut(DEFAULT_AGENT_KEY, { value })),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['setting', DEFAULT_AGENT_KEY] }),
  }));

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.form, {
      action: async () => {
        this.saveMutation.mutate(this.model().agentDefaultType);
      },
    });
  }
}
