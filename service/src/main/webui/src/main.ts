import { bootstrapApplication } from '@angular/platform-browser';
import { initQitsIntegration } from '@qits/angular';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Telemetry first: the fetch instrumentation must patch window.fetch before Angular's
// FetchBackend captures it (the @qits/angular two-phase contract). Standalone (no supervising
// qits, config.json reports telemetry: null) this resolves in one round-trip and stays dark.
initQitsIntegration()
  .catch(() => undefined)
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
