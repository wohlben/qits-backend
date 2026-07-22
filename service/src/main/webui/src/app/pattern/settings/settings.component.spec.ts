import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { SettingControllerService } from '@/api';
import { SettingsComponent } from './settings.component';

/** Query results and mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SettingsComponent', () => {
  const settingService = {
    apiSettingsKeyGet: vi
      .fn()
      .mockReturnValue(of({ setting: { key: 'agent.default-type', value: 'CLAUDE' } })),
    apiSettingsKeyPut: vi
      .fn()
      .mockReturnValue(of({ setting: { key: 'agent.default-type', value: 'KIMI' } })),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    settingService.apiSettingsKeyGet.mockReturnValue(
      of({ setting: { key: 'agent.default-type', value: 'CLAUDE' } }),
    );
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideTanStackQuery(new QueryClient()),
        { provide: SettingControllerService, useValue: settingService },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('loads the current default agent into the form', async () => {
    const fixture = createComponent();
    await flush();
    fixture.detectChanges();
    await flush();

    expect(settingService.apiSettingsKeyGet).toHaveBeenCalledWith('agent.default-type');
    expect(fixture.componentInstance.model().agentDefaultType).toBe('CLAUDE');
  });

  it('saves the selected value via the setting key PUT', async () => {
    const fixture = createComponent();
    await flush();
    fixture.detectChanges();
    await flush();

    fixture.componentInstance.model.set({ agentDefaultType: 'KIMI' });
    await fixture.componentInstance.onSubmit(new Event('submit'));
    await flush();

    expect(settingService.apiSettingsKeyPut).toHaveBeenCalledWith('agent.default-type', {
      value: 'KIMI',
    });
  });
});
