import { parseAppPath, stripProxyPrefix, toProxyUrl } from './app-path';

const PROXY = '/service/wt-1/d-1/';
const ORIGIN = 'http://localhost:8080';

describe('parseAppPath', () => {
  it('passes app-side paths through, normalizing the leading slash', () => {
    expect(parseAppPath('/greeting?tab=2', PROXY, ORIGIN)).toEqual({ appPath: '/greeting?tab=2' });
    expect(parseAppPath('greeting', PROXY, ORIGIN)).toEqual({ appPath: '/greeting' });
    expect(parseAppPath('  /greeting ', PROXY, ORIGIN)).toEqual({ appPath: '/greeting' });
    expect(parseAppPath('', PROXY, ORIGIN)).toEqual({ appPath: '/' });
  });

  it('strips this service proxy prefix from a pasted proxy path', () => {
    expect(parseAppPath('/service/wt-1/d-1/greeting#top', PROXY, ORIGIN)).toEqual({
      appPath: '/greeting#top',
    });
    expect(parseAppPath('/service/wt-1/d-1/', PROXY, ORIGIN)).toEqual({ appPath: '/' });
    expect(parseAppPath('/service/wt-1/d-1', PROXY, ORIGIN)).toEqual({ appPath: '/' });
  });

  it('accepts a full URL only when it resolves inside this proxy prefix on this origin', () => {
    expect(parseAppPath(ORIGIN + '/service/wt-1/d-1/greeting?x=1', PROXY, ORIGIN)).toEqual({
      appPath: '/greeting?x=1',
    });
    expect(parseAppPath('https://evil.example/service/wt-1/d-1/', PROXY, ORIGIN)).toHaveProperty(
      'error',
    );
    expect(parseAppPath(ORIGIN + '/repositories/r-1', PROXY, ORIGIN)).toHaveProperty('error');
  });

  it("rejects another service's proxy path instead of reinterpreting it as an app route", () => {
    expect(parseAppPath('/service/wt-1/d-2/greeting', PROXY, ORIGIN)).toHaveProperty('error');
    expect(parseAppPath('/service/other/d-1/', PROXY, ORIGIN)).toHaveProperty('error');
  });
});

describe('toProxyUrl', () => {
  it('joins the trailing-slashed proxy path with the app path', () => {
    expect(toProxyUrl('/greeting?tab=2', PROXY)).toBe('/service/wt-1/d-1/greeting?tab=2');
    expect(toProxyUrl('/', PROXY)).toBe('/service/wt-1/d-1/');
  });
});

describe('stripProxyPrefix', () => {
  it('extracts route, query and hash from an absolute proxied URL', () => {
    expect(stripProxyPrefix(ORIGIN + '/service/wt-1/d-1/greeting?x=1#top', PROXY)).toBe(
      '/greeting?x=1#top',
    );
    expect(stripProxyPrefix(ORIGIN + '/service/wt-1/d-1/', PROXY)).toBe('/');
  });

  it('returns null for URLs outside the prefix', () => {
    expect(stripProxyPrefix(ORIGIN + '/service/wt-1/d-2/greeting', PROXY)).toBeNull();
    expect(stripProxyPrefix('about:blank', PROXY)).toBeNull();
    expect(stripProxyPrefix(ORIGIN + '/', PROXY)).toBeNull();
  });
});
