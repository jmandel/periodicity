/**
 * build-all.ts (bun) — local generated demo build. Runs every step that
 * produces uncommitted artifacts under dist/ for local testing or deployment.
 *
 *   bun scripts/build-all.ts   (or: bun run build)
 *
 * Steps:
 *   1. gen-example  -> dist/examples/Bundle-...longitudinal-example.json
 *   2. build-viewer -> dist/view*.html + dist/view*-assets/{app.js, index.html}
 *   3. gen-shl      -> dist/view-assets/{example.jwe, shlink.txt, ...}
 */
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { viewerBuildEnv, viewerOutput, viewerVariants } from "./viewer-variants.ts";

const here = import.meta.dir;
const root = `${here}/..`;
const distOut = `${root}/dist`;
const demoFiles = ["example.jwe", "shlink.txt", "_shlink-local.txt", "_shlink-local-ig.txt"];

async function step(name: string, file: string, env: Record<string, string> = {}) {
  console.log(`\n── ${name} ──`);
  const p = Bun.spawn(["bun", `${here}/${file}`], { env: { ...Bun.env, ...env }, stdout: "inherit", stderr: "inherit" });
  const code = await p.exited;
  if (code !== 0) throw new Error(`${name} failed (exit ${code})`);
}

async function mirrorDemoAssets(srcDir: string, destDirs: string[]) {
  for (const destDir of destDirs) {
    for (const file of demoFiles) await cp(join(srcDir, file), join(destDir, file), { force: true });
  }
}

await step("generate example bundle", "gen-example.ts");
for (const variant of viewerVariants) {
  await step(`bundle ${variant.label} SPA`, "build-viewer.ts", viewerBuildEnv(variant, distOut));
}
const [primaryViewer, ...otherViewers] = viewerVariants.map((variant) => viewerOutput(variant, distOut));
await step("package SMART Health Link", "gen-shl.ts", { SHL_OUTDIR: primaryViewer.assets });
await mirrorDemoAssets(primaryViewer.assets, otherViewers.map((viewer) => viewer.assets));
await step("package agent assets", "build-agent-assets.ts");
console.log("\n✔ local generated demo artifacts built under dist/.");
