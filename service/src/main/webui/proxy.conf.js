// Dev proxy for `ng serve`: forward the SPA's backend calls to Quarkus (:8080).
//
// Env-keyed (the fixture-proven pattern) because under a supervising qits' daemon web view the
// app is served at $QITS_PUBLIC_BASE (/daemon/{ws}/{daemonId}/) — a bare '/daemon' key would then
// match the serve path itself and proxy every app request back to Quarkus in a loop. So the keys
// carry the base: at the default '/' they collapse to the old '/api' + '/daemon' entries, under a
// base they become '{base}api' + '{base}daemon' (the child's own API and daemon web views, which
// Quarkus serves under the same base via -Dquarkus.http.root-path).
const base = process.env.QITS_PUBLIC_BASE || '/';

const target = {
  target: 'http://localhost:8080',
  secure: false,
  changeOrigin: true,
  ws: true,
};

module.exports = {
  [base + 'api']: target,
  [base + 'daemon']: target,
};
