package eu.wohlben.qits.userflows.report;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import java.util.List;

/**
 * The canonical structured output of a story run — everything a renderer needs, serialized to
 * {@code userflow.json}. The markdown writer is merely the <i>default</i> renderer over this model;
 * future renderers (the artifacts publisher) consume this record, never the markdown.
 *
 * <p>Field order and names mirror the report contract in {@code
 * docs/epics/qits-userflows/features/2026-07-19_qits-userflows.md}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonPropertyOrder({
  "story",
  "slug",
  "description",
  "steps",
  "definitionHash",
  "screenshots",
  "video",
  "outcome"
})
public record UserflowReport(
    String story,
    String slug,
    String description,
    List<Step> steps,
    String definitionHash,
    List<Screenshot> screenshots,
    Video video,
    String outcome) {

  /**
   * One recorded step: an explicit string {@code id} (e.g. {@code "step-05"}, stable and matching a
   * screenshot's file-name prefix) plus the human-readable {@code line} (verb + selector + any
   * typed value). Screenshots reference a step by its {@code id}, so the coupling is by name, not
   * by position.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  @JsonPropertyOrder({"id", "line"})
  public record Step(String id, String line) {}

  /**
   * A captured screenshot. {@code step} is the {@link Step#id() id} of the screenshot step that
   * produced it — the explicit, by-name link a renderer uses to place the image under its step.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  @JsonPropertyOrder({"path", "label", "step", "width", "height", "contentHash"})
  public record Screenshot(
      String path, String label, String step, int width, int height, String contentHash) {}

  /**
   * The full-run video. No duration is emitted: Playwright exposes no webm length, and a wall-clock
   * value would make this canonical sidecar differ on every run.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  @JsonPropertyOrder({"path", "width", "height"})
  public record Video(String path, int width, int height) {}

  /** {@code "passed"} or {@code "failed"} — the future uploader skips non-passing runs by this. */
  public static final String PASSED = "passed";

  public static final String FAILED = "failed";
}
