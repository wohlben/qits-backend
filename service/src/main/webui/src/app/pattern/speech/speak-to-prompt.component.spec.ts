import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AgentControllerService } from '@/api/api/agentController.service';
import { PromptRefinementControllerService } from '@/api/api/promptRefinementController.service';
import { SpeechControllerService } from '@/api/api/speechController.service';
import { AgentLaunchMode } from '@/api/model/agentLaunchMode';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { PromptContextStore } from '@/shared/state/prompt-context.store';
import { SpeakToPromptComponent } from './speak-to-prompt.component';

describe('SpeakToPromptComponent', () => {
  const speechService = {
    apiSpeechTranscriptionsPost: vi.fn().mockReturnValue(of({ text: 'spoken words' })),
  };
  const refinementService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptRefinementsPost: vi
      .fn()
      .mockReturnValue(of({ prompt: 'refined prompt' })),
  };
  const agentService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost: vi
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
        { provide: SpeechControllerService, useValue: speechService },
        { provide: PromptRefinementControllerService, useValue: refinementService },
        { provide: AgentControllerService, useValue: agentService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(SpeakToPromptComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('refines the edited transcript and shows the result for editing', async () => {
    const fixture = createComponent();
    fixture.componentInstance.transcript.set('umm add a healthcheck');
    fixture.componentInstance.refineMutation.mutate('umm add a healthcheck');
    await fixture.whenStable();

    expect(
      refinementService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptRefinementsPost,
    ).toHaveBeenCalledWith('repo-1', 'wt-1', { transcript: 'umm add a healthcheck' });
    expect(fixture.componentInstance.refinedPrompt()).toBe('refined prompt');
  });

  it('launches the agent with the refined prompt as initial context and opens its command', async () => {
    const fixture = createComponent();
    fixture.componentInstance.refinedPrompt.set('do the thing');
    fixture.componentInstance.launch(AgentLaunchMode.Chat);
    await fixture.whenStable();

    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledWith(
      'repo-1',
      'wt-1',
      { scope: AgentMcpScope.Repository, initialContext: 'do the thing', mode: AgentLaunchMode.Chat },
    );
    expect(router.navigate).toHaveBeenCalledWith(['/commands', 'cmd-1']);
  });

  it('launches the interactive terminal session when asked', async () => {
    const fixture = createComponent();
    fixture.componentInstance.refinedPrompt.set('do the thing');
    fixture.componentInstance.launch(AgentLaunchMode.Interactive);
    await fixture.whenStable();

    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledWith(
      'repo-1',
      'wt-1',
      {
        scope: AgentMcpScope.Repository,
        initialContext: 'do the thing',
        mode: AgentLaunchMode.Interactive,
      },
    );
  });

  it('emits the launched command id alongside navigating by default', async () => {
    const fixture = createComponent();
    let launchedId: string | undefined;
    fixture.componentInstance.launched.subscribe((id) => (launchedId = id));
    fixture.componentInstance.refinedPrompt.set('do the thing');
    fixture.componentInstance.launch(AgentLaunchMode.Chat);
    await fixture.whenStable();

    expect(launchedId).toBe('cmd-1');
    expect(router.navigate).toHaveBeenCalledWith(['/commands', 'cmd-1']);
  });

  it('only emits, without navigating, when navigateOnLaunch is off', async () => {
    const fixture = createComponent();
    fixture.componentRef.setInput('navigateOnLaunch', false);
    let launchedId: string | undefined;
    fixture.componentInstance.launched.subscribe((id) => (launchedId = id));
    fixture.componentInstance.refinedPrompt.set('do the thing');
    fixture.componentInstance.launch(AgentLaunchMode.Chat);
    await fixture.whenStable();

    expect(launchedId).toBe('cmd-1');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('appends picked snippets from the prompt-context store to the initial context', async () => {
    const store = TestBed.inject(PromptContextStore);
    store.add({
      html: '<button class="cta">Go</button>',
      selector: '#root > button',
      url: 'http://localhost/daemon/wt/d/',
      tag: 'button',
      textPreview: 'Go',
    });
    const fixture = createComponent();
    fixture.componentInstance.refinedPrompt.set('fix this button');
    fixture.componentInstance.launch(AgentLaunchMode.Chat);
    await fixture.whenStable();

    const [, , body] =
      agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost.mock.calls[0];
    expect(body.scope).toBe(AgentMcpScope.Repository);
    expect(body.initialContext).toContain('fix this button');
    expect(body.initialContext).toContain('Picked element <button>');
    expect(body.initialContext).toContain('<button class="cta">Go</button>');
    store.clear();
  });

  it('shows the full pick context on a picked-element row: component, route, files, chain', () => {
    const store = TestBed.inject(PromptContextStore);
    store.add({
      html: '<button class="cta">Go</button>',
      selector: '#root > button',
      url: 'http://localhost/daemon/wt/d/greeting/world',
      appPath: '/greeting/world',
      tag: 'button',
      textPreview: 'Go',
      component: {
        selector: 'app-greeting',
        className: 'Greeting',
        files: ['src/app/greeting.ts'],
        ancestors: ['app-root'],
      },
    });
    const fixture = createComponent();

    const text = (fixture.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('Greeting (app-greeting)');
    expect(text).toContain('/greeting/world');
    expect(text).toContain('src/app/greeting.ts');
    expect(text).toContain('in app-root');
    store.clear();
  });

  it('renders a plain row without an attribution line for an unattributed pick', () => {
    const store = TestBed.inject(PromptContextStore);
    store.add({
      html: '<div>x</div>',
      selector: 'div',
      url: 'http://localhost/elsewhere',
      tag: 'div',
      textPreview: 'x',
    });
    const fixture = createComponent();

    const text = (fixture.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('Picked elements');
    expect(text).not.toContain('in app-root');
    expect(text).not.toContain('src/app/');
    store.clear();
  });

  it('uploads the recording and appends the server transcript', async () => {
    const fixture = createComponent();
    fixture.componentInstance.transcript.set('earlier text');
    fixture.componentInstance.transcribeMutation.mutate('QkFTRTY0');
    await fixture.whenStable();

    expect(speechService.apiSpeechTranscriptionsPost).toHaveBeenCalledWith({
      audioBase64: 'QkFTRTY0',
    });
    expect(fixture.componentInstance.transcript()).toBe('earlier text spoken words');
  });
});
