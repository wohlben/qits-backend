package eu.wohlben.qits.domain.daemon.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

/**
 * The daemon's web-view configuration — present ({@code port} set) means the daemon's app is
 * web-viewable through the {@code /daemon/{workspaceId}/{daemonId}/} proxy; an absent (all-null)
 * embeddable reads back as a null {@code RepositoryDaemon#webView}, meaning not web-viewable.
 *
 * <p>Paths are stored normalized: no leading/trailing slashes, never {@code ..} (see {@code
 * DaemonDefinitionValidator#requireValidWebView}).
 */
@Embeddable
public class WebView {

  /**
   * Container-loopback port the proxy targets. Point this at the FRONTEND dev server (it natively
   * serves assets + HMR under a base path); a single-origin backend that honours {@code
   * $QITS_PUBLIC_BASE} itself is the override case. The server must bind 0.0.0.0.
   */
  @Column(name = "web_view_port")
  public Integer port;

  /** Route the frame opens at, below the served base (e.g. {@code greeting}). Null = app root. */
  @Column(name = "web_view_entry_path", length = 500)
  public String entryPath;

  /**
   * Advanced: extra sub-path the app pins on top of the proxy prefix; included in the served base
   * and {@code $QITS_PUBLIC_BASE}. Null for apps that serve directly under the prefix (the norm).
   */
  @Column(name = "web_view_base_path", length = 500)
  public String basePath;
}
