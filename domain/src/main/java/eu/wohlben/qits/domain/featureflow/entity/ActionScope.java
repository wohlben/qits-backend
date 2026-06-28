package eu.wohlben.qits.domain.featureflow.entity;

/**
 * Where an action lives. {@link #GLOBAL} actions (e.g. a shell, Claude Code) are available in every
 * repository; {@link #REPOSITORY} actions are owned by one repository and only available there. The
 * model is open to more tiers later (e.g. project) without changing this contract — a new value is
 * simply added.
 */
public enum ActionScope {
  GLOBAL,
  REPOSITORY
}
