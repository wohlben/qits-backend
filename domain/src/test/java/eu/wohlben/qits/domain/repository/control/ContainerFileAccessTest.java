package eu.wohlben.qits.domain.repository.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.repository.control.WorkspaceFileAccess.Entry;
import eu.wohlben.qits.domain.repository.control.WorkspaceFileAccess.EntryType;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for the pure {@code find -printf} listing parser — the one piece of {@link
 * ContainerFileAccess} that has non-trivial logic and can be exercised without a container. Covers
 * the record shape ({@code %d\t%y\t%s\t%p}), leading {@code ./} stripping, depth-2 child counting,
 * symlink/other types, and awkward names.
 */
class ContainerFileAccessTest {

  private static Optional<Entry> find(List<Entry> entries, String path) {
    return entries.stream().filter(e -> e.path().equals(path)).findFirst();
  }

  @Test
  void parsesImmediateChildrenWithTypesAndSizesStrippingDotSlash() {
    String output =
        String.join(
            "\n",
            "1\td\t4096\t./node_modules/pkg",
            "1\tf\t3\t./node_modules/top.js",
            "2\tf\t5\t./node_modules/pkg/index.js");

    List<Entry> entries = ContainerFileAccess.parseFindListing(output);

    // only depth-1 entries are returned; the depth-2 line is consumed for counting
    assertEquals(2, entries.size());
    Entry file = find(entries, "node_modules/top.js").orElseThrow();
    assertEquals(EntryType.FILE, file.type());
    assertEquals(3, file.size());
    assertEquals(0, file.childCount());

    Entry dir = find(entries, "node_modules/pkg").orElseThrow();
    assertEquals(EntryType.DIRECTORY, dir.type());
    // one grandchild (node_modules/pkg/index.js) nested under the subdir
    assertEquals(1, dir.childCount());
  }

  @Test
  void countsOnlyGrandchildrenNestedUnderEachSubdirectory() {
    String output =
        String.join(
            "\n",
            "1\td\t4096\t./a",
            "1\td\t4096\t./b",
            "2\tf\t1\t./a/one",
            "2\tf\t1\t./a/two",
            "2\tf\t1\t./b/only");

    List<Entry> entries = ContainerFileAccess.parseFindListing(output);

    assertEquals(2, find(entries, "a").orElseThrow().childCount());
    assertEquals(1, find(entries, "b").orElseThrow().childCount());
  }

  @Test
  void handlesNamesWithSpacesAndUnicode() {
    String output =
        String.join(
            "\n", "1\tf\t7\t./my file.txt", "1\td\t4096\t./café", "2\tf\t2\t./café/über.md");

    List<Entry> entries = ContainerFileAccess.parseFindListing(output);

    assertTrue(find(entries, "my file.txt").isPresent());
    Entry unicodeDir = find(entries, "café").orElseThrow();
    assertEquals(EntryType.DIRECTORY, unicodeDir.type());
    assertEquals(1, unicodeDir.childCount());
  }

  @Test
  void mapsSymlinkAndOtherEntryTypes() {
    String output =
        String.join("\n", "1\tl\t10\t./link", "1\tp\t0\t./a-pipe", "1\tf\t4\t./real.txt");

    List<Entry> entries = ContainerFileAccess.parseFindListing(output);

    assertEquals(EntryType.SYMLINK, find(entries, "link").orElseThrow().type());
    assertEquals(EntryType.OTHER, find(entries, "a-pipe").orElseThrow().type());
    assertEquals(EntryType.FILE, find(entries, "real.txt").orElseThrow().type());
  }

  @Test
  void emptyDirectoryYieldsNoEntries() {
    assertTrue(ContainerFileAccess.parseFindListing("").isEmpty());
    assertTrue(ContainerFileAccess.parseFindListing("\n\n").isEmpty());
  }

  @Test
  void directoryWithNoChildrenReportsZeroCount() {
    List<Entry> entries = ContainerFileAccess.parseFindListing("1\td\t4096\t./empty");
    assertEquals(0, find(entries, "empty").orElseThrow().childCount());
  }

  @Test
  void skipsMalformedLines() {
    String output =
        String.join(
            "\n",
            "not a record",
            "1\tf", // too few fields
            "x\tf\t1\t./bad-depth",
            "1\tf\t9\t./good.txt");

    List<Entry> entries = ContainerFileAccess.parseFindListing(output);

    assertEquals(1, entries.size());
    assertEquals("good.txt", entries.get(0).path());
  }
}
