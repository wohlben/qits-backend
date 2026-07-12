import { TelemetrySpanDto } from '@/api/model/telemetrySpanDto';
import { isPageLoadSpan } from './telemetry-span-classification';

function span(name?: string): TelemetrySpanDto {
  return { name, kind: 'INTERNAL' };
}

describe('isPageLoadSpan', () => {
  it('classifies the page-load instrumentation family as hidden', () => {
    expect(isPageLoadSpan(span('resourceFetch'))).toBe(true);
    expect(isPageLoadSpan(span('documentLoad'))).toBe(true);
    expect(isPageLoadSpan(span('documentFetch'))).toBe(true);
  });

  it('keeps Navigation visible even though it is also an INTERNAL span', () => {
    expect(isPageLoadSpan(span('Navigation'))).toBe(false);
  });

  it('keeps ordinary CLIENT/SERVER spans visible', () => {
    expect(isPageLoadSpan(span('HTTP POST'))).toBe(false);
    expect(isPageLoadSpan(span('POST /greetings'))).toBe(false);
  });

  it('treats a nameless span as visible', () => {
    expect(isPageLoadSpan(span(undefined))).toBe(false);
  });
});
