import { UrlSegment } from '@angular/router';

import { workspaceDetailMatcher } from './repositories.routes';

function segments(url: string): UrlSegment[] {
  return url.split('/').map((s) => new UrlSegment(s, {}));
}

describe('workspaceDetailMatcher', () => {
  it('matches the bare workspace detail URL without a tab param', () => {
    const result = workspaceDetailMatcher(segments('repo-1/workspaces/wt-1'));

    expect(result).not.toBeNull();
    expect(result!.consumed).toHaveLength(3);
    expect(result!.posParams!['repoId']!.path).toBe('repo-1');
    expect(result!.posParams!['workspaceId']!.path).toBe('wt-1');
    expect(result!.posParams!['tab']).toBeUndefined();
  });

  it('matches a trailing tab segment — even an unknown slug (the page normalizes those)', () => {
    const result = workspaceDetailMatcher(segments('repo-1/workspaces/wt-1/daemons'));
    expect(result!.posParams!['tab']!.path).toBe('daemons');

    expect(
      workspaceDetailMatcher(segments('repo-1/workspaces/wt-1/bogus'))!.posParams!['tab']!.path,
    ).toBe('bogus');
  });

  it('declines wip — reserved for the legacy speak-to-prompt page', () => {
    expect(workspaceDetailMatcher(segments('repo-1/workspaces/wt-1/wip'))).toBeNull();
  });

  it('declines URLs that are not workspace detail shapes', () => {
    expect(workspaceDetailMatcher(segments('repo-1/history/h-1'))).toBeNull();
    expect(workspaceDetailMatcher(segments('repo-1/daemons'))).toBeNull();
    expect(workspaceDetailMatcher(segments('repo-1'))).toBeNull();
    expect(workspaceDetailMatcher(segments('repo-1/workspaces/wt-1/files/extra'))).toBeNull();
  });
});
