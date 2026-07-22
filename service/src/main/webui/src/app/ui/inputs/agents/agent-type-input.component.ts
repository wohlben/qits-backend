import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { AgentType } from '@/api';
import { ZardSelectComponent } from '@/shared/components/select';
import { ZardSelectItemComponent } from '@/shared/components/select/select-item.component';

/** Human-readable labels for the coding-agent harnesses the backend can launch. */
export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  [AgentType.Claude]: 'Claude Code',
  [AgentType.Kimi]: 'Kimi Code',
};

/**
 * A presentational picker for the coding-agent harness used at launch. It is not a signal-form
 * input (its two launch surfaces hold the selection in a plain signal), so it exposes a
 * `value`/`valueChange` pair over a zard select and lists whatever agents the caller passes in.
 */
@Component({
  selector: 'app-agent-type-input',
  imports: [ZardSelectComponent, ZardSelectItemComponent],
  template: `
    <label class="flex flex-col gap-1 text-sm">
      <span class="font-medium">Coding agent</span>
      <z-select
        [zValue]="value() ?? ''"
        [zDisabled]="disabled()"
        zPlaceholder="Select agent…"
        aria-label="Coding agent"
        (zSelectionChange)="onSelectionChange($event)"
      >
        @for (agent of agents(); track agent) {
          <z-select-item [zValue]="agent">{{ label(agent) }}</z-select-item>
        }
      </z-select>
    </label>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentTypeInputComponent {
  readonly agents = input.required<AgentType[]>();
  readonly value = input<AgentType | undefined>();
  readonly disabled = input(false);
  readonly valueChange = output<AgentType>();

  protected label(agent: AgentType): string {
    return AGENT_TYPE_LABELS[agent] ?? agent;
  }

  protected onSelectionChange(value: string | string[]): void {
    if (typeof value === 'string' && value) {
      this.valueChange.emit(value as AgentType);
    }
  }
}
