// Dev proxy for `ng serve`: forward the SPA's backend calls to Quarkus (:8080).
//
// Env-keyed (the fixture-proven pattern) because under a supervising qits' service web view the
// app is served at $QITS_PUBLIC_BASE (/service/{ws}/{serviceId}/) — a bare '/service' key would then
// match the serve path itself and proxy every app request back to Quarkus in a loop. So the keys
// carry the base: at the default '/' they collapse to the plain '/api' + '/service' entries, under a
// base they become '{base}api' + '{base}service' (the child's own API and service web views, which
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
  [base + 'service']: target,
};
