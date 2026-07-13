import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { Provider } from '@angular/core';

/**
 * Providers merged into the TestBed environment for every unit and visual test
 * (wired via the `providersFile` option of the `test` / `test-visual` targets in
 * angular.json).
 *
 * Pin DatePipe to UTC so date-rendering components (e.g. `app-commit-row`,
 * `app-agent-session-rows`) format identically regardless of the machine's
 * timezone. The visual-regression baselines are recorded in UTC, so a container
 * on another zone (e.g. CEST) would otherwise shift the rendered clock text and
 * fail on pixel drift — the "Time/locale-dependent rendering" gotcha documented
 * in `.pi/skills/screenshot-tests/SKILL.md`. Production rendering is unaffected;
 * this default applies only under the test builder.
 */
const providers: Provider[] = [{ provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { timezone: 'UTC' } }];

export default providers;
