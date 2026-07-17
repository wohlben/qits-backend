package eu.wohlben.qits.spa;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** The content-type seam deciding which responses get the no-cache override. */
class SpaShellCacheFilterTest {

  @Test
  void matchesHtmlWithAndWithoutParameters() {
    assertTrue(SpaShellCacheFilter.isHtml("text/html"));
    assertTrue(SpaShellCacheFilter.isHtml("text/html;charset=UTF-8"));
    assertTrue(SpaShellCacheFilter.isHtml("TEXT/HTML; charset=utf-8"));
  }

  @Test
  void leavesEverythingElseAlone() {
    assertFalse(SpaShellCacheFilter.isHtml(null));
    assertFalse(SpaShellCacheFilter.isHtml("application/json"));
    assertFalse(SpaShellCacheFilter.isHtml("text/javascript"));
    assertFalse(SpaShellCacheFilter.isHtml("text/plain"));
    // The hashed bundles must keep their immutable caching.
    assertFalse(SpaShellCacheFilter.isHtml("application/javascript"));
  }
}
