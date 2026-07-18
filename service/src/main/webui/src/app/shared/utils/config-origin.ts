import { Origin } from '@/api/model/origin';

/**
 * The reserved suffix stamped on every action/daemon declared in a repository's `.qits-config.yml`.
 * Must match the backend `QitsConfig.CONFIG_NAME_SUFFIX`. The write API rejects it in user input, so
 * a name carrying it is always config-managed.
 */
export const CONFIG_NAME_SUFFIX = '@qits-config';

/** Whether an action/daemon is declared in `.qits-config.yml` (and thus read-only in the UI). */
export function isConfigManaged(origin: Origin | undefined, name: string | undefined): boolean {
  return origin === Origin.Config || (!!name && name.endsWith(CONFIG_NAME_SUFFIX));
}

/** The display name of a config-managed entry: its stored name minus the reserved suffix. */
export function configBaseName(name: string | undefined): string {
  if (!name) return '';
  return name.endsWith(CONFIG_NAME_SUFFIX)
    ? name.slice(0, -CONFIG_NAME_SUFFIX.length)
    : name;
}
