import type { ActivatedRouteSnapshot, Route } from '@angular/router';

import { ParamRemountRouteReuseStrategy } from './param-remount-route-reuse.strategy';

function snapshot(routeConfig: Route | null, params: Record<string, string>): ActivatedRouteSnapshot {
  return { routeConfig, params } as unknown as ActivatedRouteSnapshot;
}

describe('ParamRemountRouteReuseStrategy', () => {
  const strategy = new ParamRemountRouteReuseStrategy();

  it('keeps the default rule: different route configs never reuse', () => {
    const a: Route = { path: 'a' };
    const b: Route = { path: 'b' };
    expect(strategy.shouldReuseRoute(snapshot(a, {}), snapshot(b, {}))).toBe(false);
  });

  it('keeps the default rule: the same config without remountParams reuses across param changes', () => {
    const config: Route = { path: ':id' };
    expect(
      strategy.shouldReuseRoute(snapshot(config, { id: '1' }), snapshot(config, { id: '2' })),
    ).toBe(true);
  });

  it('remounts when a listed param changes — the workspace-switch regression', () => {
    const config: Route = { data: { remountParams: ['repoId', 'workspaceId'] } };
    expect(
      strategy.shouldReuseRoute(
        snapshot(config, { repoId: 'repo-1', workspaceId: 'wt-2', tab: 'chat' }),
        snapshot(config, { repoId: 'repo-1', workspaceId: 'wt-1', tab: 'chat' }),
      ),
    ).toBe(false);
  });

  it('still reuses when only an unlisted param (the tab slug) changes', () => {
    const config: Route = { data: { remountParams: ['repoId', 'workspaceId'] } };
    expect(
      strategy.shouldReuseRoute(
        snapshot(config, { repoId: 'repo-1', workspaceId: 'wt-1', tab: 'files' }),
        snapshot(config, { repoId: 'repo-1', workspaceId: 'wt-1', tab: 'chat' }),
      ),
    ).toBe(true);
  });

  it('reuses when every listed param is unchanged', () => {
    const config: Route = { data: { remountParams: ['repoId', 'workspaceId'] } };
    expect(
      strategy.shouldReuseRoute(
        snapshot(config, { repoId: 'repo-1', workspaceId: 'wt-1' }),
        snapshot(config, { repoId: 'repo-1', workspaceId: 'wt-1' }),
      ),
    ).toBe(true);
  });
});
