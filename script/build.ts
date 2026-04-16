import { build } from "esbuild";
import { execSync } from "child_process";

console.log("Building client...");
execSync("npx vite build", { stdio: "inherit" });

const serverOptions = {
  bundle: true,
  platform: "node" as const,
  format: "cjs" as const,
  target: "node18",
  outdir: "dist",
  packages: "external" as const,
};

console.log("Building server...");
await build({
  ...serverOptions,
  entryPoints: {
    index: "server/index.ts",
    routes: "server/routes.ts",
    static: "server/static.ts",
    webhookHandlers: "server/webhookHandlers.ts",
  },
});

console.log("Build complete.");
