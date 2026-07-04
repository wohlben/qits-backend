package eu.wohlben.qits.githost;

import jakarta.servlet.ServletConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import org.eclipse.jgit.http.server.GitServlet;
import org.eclipse.jgit.transport.ReceivePack;
import org.eclipse.jgit.transport.UploadPack;
import org.eclipse.microprofile.config.ConfigProvider;

/**
 * The in-process git smart-HTTP server, mounted at {@code /git/*} so workspace containers can clone
 * and push over {@code http://host.docker.internal:<port>/git/<repoId>}. The codebase's first
 * servlet (via quarkus-undertow). No authentication: repo ids are capability UUIDs, the same trust
 * level as the rest of unauthenticated local qits — revisit alongside any qits-wide auth.
 *
 * <p>Anonymous fetch <em>and</em> push are both enabled explicitly: the default receive-pack
 * factory refuses anonymous clients, so a plain allow-all one is installed. The git CLI ({@code
 * GitExecutor}) remains the only thing that mutates repositories; JGit here speaks the wire
 * protocol and nothing else.
 */
@WebServlet(name = "git", urlPatterns = "/git/*")
public class QitsGitServlet extends GitServlet {

  @Override
  public void init(ServletConfig config) throws ServletException {
    String dataDir =
        ConfigProvider.getConfig()
            .getOptionalValue("qits.repositories.data-dir", String.class)
            .orElse("data/repositories");
    setRepositoryResolver(new QitsRepositoryResolver(dataDir));
    setUploadPackFactory((req, db) -> new UploadPack(db));
    setReceivePackFactory((req, db) -> new ReceivePack(db));
    super.init(config);
  }
}
