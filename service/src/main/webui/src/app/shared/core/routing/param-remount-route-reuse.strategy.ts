import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy } from '@angular/router';

/**
 * The default reuse rule (same route config ⇒ reuse the component) plus an opt-in remount: a route
 * config carrying `data: { remountParams: [...] }` is reused only while every listed param is
 * unchanged. Needed by routes that collapse several URLs into ONE config (the workspace detail
 * matcher): the default rule then reuses the page across entity switches, but pages read their
 * identity params from the route snapshot once — so switching e.g. the workspace would otherwise
 * change the URL and nothing else. Params NOT listed (the detail page's `:tab` slug) still reuse,
 * keeping in-page state alive across tab navigation.
 */
@Injectable()
export class ParamRemountRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (!super.shouldReuseRoute(future, curr)) {
      return false;
    }
    const params = future.routeConfig?.data?.['remountParams'] as string[] | undefined;
    return !params || params.every((param) => future.params[param] === curr.params[param]);
  }
}
