package eu.wohlben.qits.domain.repository.dto;

import eu.wohlben.qits.domain.repository.entity.PromptAttachmentSource;
import java.time.Instant;

/**
 * A prompt attachment's metadata as returned to the client — deliberately without {@code bytes}
 * (the image payload is served to the agent off the entity, never round-tripped through this
 * shape).
 *
 * @param id the service-generated id the draft blob references
 * @param mimeType the effective (sniffed) media type
 * @param label the human label ("Sketch 1")
 * @param source where the image came from
 * @param createdAt when it was attached
 */
public record WorkspacePromptAttachmentDto(
    String id, String mimeType, String label, PromptAttachmentSource source, Instant createdAt) {}
