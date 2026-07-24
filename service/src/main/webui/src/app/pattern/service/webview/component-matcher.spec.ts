import { ComponentMapDto } from '@/api/model/componentMapDto';
import { createComponentMatcher } from './component-matcher';

const map: ComponentMapDto = {
  framework: 'angular',
  components: [
    {
      className: 'Greeting',
      componentFile: 'src/app/greeting.ts',
      selectors: [{ element: 'app-greeting' }],
    },
    {
      className: 'App',
      componentFile: 'src/app/app.ts',
      selectors: [{ element: 'app-root' }],
    },
    {
      className: 'Detail',
      componentFile: 'src/app/detail/detail.ts',
      templateFile: 'src/app/detail/detail.html',
      styleFiles: ['src/app/detail/detail.scss'],
      selectors: [{ element: 'app-detail' }, { attribute: 'appDetail' }],
    },
    {
      className: 'RoutedOnly',
      componentFile: 'src/app/routed.ts',
      selectors: [],
    },
  ],
};

/** `<app-root><app-greeting><button>` — returns the button. */
function greetingButton(): HTMLElement {
  const root = document.createElement('app-root');
  const greeting = document.createElement('app-greeting');
  const button = document.createElement('button');
  greeting.appendChild(button);
  root.appendChild(greeting);
  document.body.appendChild(root);
  return button;
}

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as { ng?: unknown }).ng;
});

describe('createComponentMatcher', () => {
  it('attributes an element to itself when its tag is a mapped element selector', () => {
    const match = createComponentMatcher(map)(greetingButton().parentElement!);

    expect(match).toEqual({
      selector: 'app-greeting',
      className: 'Greeting',
      files: ['src/app/greeting.ts'],
      ancestors: ['app-root'],
    });
  });

  it('walks up to the nearest mapped ancestor and records the enclosing chain', () => {
    const match = createComponentMatcher(map)(greetingButton());

    expect(match?.className).toBe('Greeting');
    expect(match?.ancestors).toEqual(['app-root']);
  });

  it('matches attribute selectors and lists all source files', () => {
    const host = document.createElement('div');
    host.setAttribute('appDetail', '');
    document.body.appendChild(host);

    const match = createComponentMatcher(map)(host);

    expect(match?.className).toBe('Detail');
    expect(match?.selector).toBe('[appDetail]');
    expect(match?.files).toEqual([
      'src/app/detail/detail.ts',
      'src/app/detail/detail.html',
      'src/app/detail/detail.scss',
    ]);
  });

  it('prefers the dev-mode debug API and attributes selector-less routed components', () => {
    const host = document.createElement('ng-component');
    const inner = document.createElement('p');
    host.appendChild(inner);
    document.body.appendChild(host);
    class RoutedOnly {}
    (window as { ng?: unknown }).ng = {
      getComponent: (el: Element) => (el === host ? new RoutedOnly() : null),
    };

    const match = createComponentMatcher(map)(inner);

    expect(match?.className).toBe('RoutedOnly');
    expect(match?.files).toEqual(['src/app/routed.ts']);
    // no element selector in the map — the DOM tag stands in for display
    expect(match?.selector).toBe('ng-component');
  });

  it('falls back to selector matching when the debug API names an unmapped class', () => {
    const button = greetingButton();
    class Minified {}
    (window as { ng?: unknown }).ng = {
      getComponent: (el: Element) => (el.tagName === 'APP-GREETING' ? new Minified() : null),
    };

    const match = createComponentMatcher(map)(button);

    expect(match?.className).toBe('Greeting');
  });

  it('survives a throwing debug API', () => {
    (window as { ng?: unknown }).ng = {
      getComponent: () => {
        throw new Error('boom');
      },
    };

    expect(createComponentMatcher(map)(greetingButton())?.className).toBe('Greeting');
  });

  it('returns undefined for elements outside every known component', () => {
    const stray = document.createElement('div');
    document.body.appendChild(stray);

    expect(createComponentMatcher(map)(stray)).toBeUndefined();
    expect(createComponentMatcher({ framework: 'angular', components: [] })(stray)).toBeUndefined();
  });
});
