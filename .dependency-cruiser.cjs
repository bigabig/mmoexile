/**
 * Enforces the monorepo dependency rules from SERVER_INFRASTRUCTURE.md §7:
 *   1. Apps may import packages.
 *   2. Packages never import apps.
 *   3. Apps never import each other (they talk over the network).
 * Plus: the pure packages (game-core, protocol, simulation) stay free of
 * I/O so they can run anywhere, including the browser.
 *
 * Run with `pnpm lint:deps`.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "packages-must-not-import-apps",
      comment: "Libraries in packages/ must never depend on deployables in apps/.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-must-not-import-other-apps",
      comment:
        "Apps only talk to each other over the network, via packages/contracts.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "pure-packages-no-io",
      comment:
        "game-core, protocol and simulation must stay I/O-free (no Node built-ins, sockets or database).",
      severity: "error",
      from: { path: "^packages/(game-core|protocol|simulation)/src/" },
      to: {
        dependencyTypes: ["core"],
      },
    },
    {
      name: "pure-packages-no-io-libraries",
      comment:
        "game-core, protocol and simulation must not depend on networking or database libraries.",
      severity: "error",
      from: { path: "^packages/(game-core|protocol|simulation)/src/" },
      to: {
        path: "(^|/)node_modules/(ws|@prisma/client|\\.prisma|ioredis|fastify)/",
      },
    },
    {
      name: "not-to-unresolvable",
      comment:
        "Every import must resolve. Catches typos and dependencies missing from a package.json.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-circular",
      comment:
        "Runtime circular imports make module initialization order fragile. Type-only cycles are erased at compile time and allowed.",
      severity: "error",
      from: {},
      to: {
        circular: true,
        viaOnly: { dependencyTypesNot: ["type-only"] },
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|node_modules)/" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".d.ts"],
      mainFields: ["module", "main", "types"],
    },
  },
};
