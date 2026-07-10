import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CommandControllerService } from '@/api/api/commandController.service';
import { LogChannel } from '@/api/model/logChannel';
import { CommandChatLogComponent } from './command-chat-log.component';

describe('CommandChatLogComponent', () => {
  const commandService = {
    apiCommandsCommandIdLogGet: vi.fn().mockReturnValue(
      of({
        lines: [
          {
            sequence: 1099511627776,
            channel: LogChannel.Transcript,
            content: JSON.stringify({
              type: 'user',
              message: { content: [{ type: 'text', text: 'hello' }] },
            }),
          },
        ],
      }),
    ),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnMount: false } },
    });

    await TestBed.configureTestingModule({
      imports: [CommandChatLogComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: CommandControllerService, useValue: commandService },
      ],
    }).compileComponents();
  });

  it('replays the durable conversation from the TRANSCRIPT channel', async () => {
    const fixture = TestBed.createComponent(CommandChatLogComponent);
    fixture.componentRef.setInput('commandId', 'cmd-1');
    fixture.detectChanges();

    expect(commandService.apiCommandsCommandIdLogGet).toHaveBeenCalledWith(
      'cmd-1',
      LogChannel.Transcript,
    );
    await vi.waitFor(() =>
      expect(fixture.componentInstance.items()).toEqual([{ kind: 'user', text: 'hello' }]),
    );
  });
});
