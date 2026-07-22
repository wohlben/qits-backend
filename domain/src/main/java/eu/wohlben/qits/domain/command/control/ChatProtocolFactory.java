package eu.wohlben.qits.domain.command.control;

/**
 * Builds the {@link ChatProtocol} bound to a freshly spawned chat process. Passed down the chat
 * launch path ({@code AgentLaunchService} → {@code CommandService.launchChat} → {@link
 * CommandRegistry#spawnChat}) so the agent domain can supply Kimi's ACP client without the command
 * domain depending on {@code AgentType} or the ACP package. A {@code null} factory means the
 * default Claude {@link StreamJsonChatProtocol}, so every existing caller is unaffected.
 */
@FunctionalInterface
public interface ChatProtocolFactory {

  /** Creates the protocol that drives {@code process}'s stdin/stdout. */
  ChatProtocol create(Process process);
}
