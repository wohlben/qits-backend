import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AgentControllerService } from '@/api/api/agentController.service';
import { PromptRefinementControllerService } from '@/api/api/promptRefinementController.service';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { SpeakToPromptComponent } from './speak-to-prompt.component';

describe('SpeakToPromptComponent', () => {
  const refinementService = {
    apiRepositoriesRepoIdWorktreesWorktreeIdPromptRefinementsPost: vi
      .fn()
      .mockReturnValue(of({ prompt: 'refined prompt' })),
  };
  const agentService = {
    apiRepositoriesRepoIdWorktreesWorktreeIdAgentsPost: vi
      .fn()
      .mockReturnValue(of({ command: { id: 'cmd-1' } })),
  };
  const router = { navigate: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [SpeakToPromptComponent],
      providers: [
        provideTanStackQuery(new QueryClient()),
        { provide: PromptRefinementControllerService, useValue: refinementService },
        { provide: AgentControllerService, useValue: agentService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(SpeakToPromptComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('worktreeId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('refines the edited transcript and shows the result for editing', async () => {
    const fixture = createComponent();
    fixture.componentInstance.transcript.set('umm add a healthcheck');
    fixture.componentInstance.refineMutation.mutate('umm add a healthcheck');
    await fixture.whenStable();

    expect(
      refinementService.apiRepositoriesRepoIdWorktreesWorktreeIdPromptRefinementsPost,
    ).toHaveBeenCalledWith('repo-1', 'wt-1', { transcript: 'umm add a healthcheck' });
    expect(fixture.componentInstance.refinedPrompt()).toBe('refined prompt');
  });

  it('launches the agent with the refined prompt as initial context and opens its command', async () => {
    const fixture = createComponent();
    fixture.componentInstance.refinedPrompt.set('do the thing');
    fixture.componentInstance.launch();
    await fixture.whenStable();

    expect(agentService.apiRepositoriesRepoIdWorktreesWorktreeIdAgentsPost).toHaveBeenCalledWith(
      'repo-1',
      'wt-1',
      { scope: AgentMcpScope.Repository, initialContext: 'do the thing' },
    );
    expect(router.navigate).toHaveBeenCalledWith(['/commands', 'cmd-1']);
  });

  it('appends utterances committed by the recorder to the transcript', () => {
    const fixture = createComponent();
    // Drive the callback the component handed to its SpeechTranscriber — the same path a real
    // VAD-committed utterance takes (no mic/model involved).
    const onUtterance = (
      fixture.componentInstance.recorder as unknown as { onUtterance: (text: string) => void }
    ).onUtterance;
    onUtterance('first part');
    onUtterance('second');
    expect(fixture.componentInstance.transcript()).toBe('first part second');
  });
});
