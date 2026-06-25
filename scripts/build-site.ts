#!/usr/bin/env bun
/**
 * build-site.ts (bun) — full generated static-site build for local use or
 * GitHub Actions. Generated sample data is copied into input/resources only as
 * an ephemeral build input so the IG Publisher can validate and publish it.
 */
import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = `${import.meta.dir}/..`;
const exampleOut = `${root}/input/resources/Bundle-period-tracking-longitudinal-example.json`;
const englishOut = `${root}/output/en`;
const viewerAssetOut = `${root}/output/view-assets`;
const viewerPageOut = `${root}/output/view.html`;
const viewer2AssetOut = `${root}/output/view2-assets`;
const viewer2PageOut = `${root}/output/view2.html`;
const viewer3AssetOut = `${root}/output/view3-assets`;
const viewer3PageOut = `${root}/output/view3.html`;
const publisherJar = `${root}/input-cache/publisher.jar`;
const viewerBase = Bun.env.VIEWER_BASE || "http://localhost:5525/view";
const demoFiles = ["example.jwe", "shlink.txt", "_shlink-local.txt", "_shlink-local-ig.txt"];

async function step(name: string, cmd: string[], env: Record<string, string> = {}) {
  console.log(`\n-- ${name} --`);
  const proc = Bun.spawn(cmd, {
    cwd: root,
    env: { ...Bun.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${name} failed (exit ${code})`);
}

async function requireTool(name: string, cmd: string[], hint: string) {
  try {
    await step(`check ${name}`, cmd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${name} is required for site builds. ${hint}\n${msg}`);
  }
}

async function copyChildren(src: string, dest: string) {
  for (const entry of await readdir(src, { withFileTypes: true })) {
    await cp(join(src, entry.name), join(dest, entry.name), { recursive: true, force: true });
  }
}

async function mirrorDemoAssets(srcDir: string, destDirs: string[]) {
  for (const destDir of destDirs) {
    for (const file of demoFiles) await cp(join(srcDir, file), join(destDir, file), { force: true });
  }
}

await requireTool("Graphviz dot", ["dot", "-V"], "Install the graphviz package so PlantUML diagrams render.");
await requireTool("zip", ["zip", "-v"], "Install zip so the generated agent skill package can be published.");
await step("generate build example Bundle", ["bun", "scripts/gen-example.ts"], { EXAMPLE_OUT: exampleOut });
await step("compile FSH", ["./_sushi.sh"]);
await step("integrity checks", ["bun", "scripts/check-mvp.ts"], { BUNDLE_FILE: exampleOut });

if (!(await Bun.file(publisherJar).exists())) {
  await step("download IG Publisher", ["./_updatePublisher.sh"]);
}
await step("run IG Publisher", ["./_genonce.sh"]);

// Publisher writes English pages under output/en plus a root language-redirect
// stub. This project publishes English only, so make the English build the root
// site while leaving /en/ in place for any existing links.
await copyChildren(`${root}/output/en`, `${root}/output`);

await rm(`${root}/output/view`, { recursive: true, force: true });
for (const path of [viewerAssetOut, viewer2AssetOut, viewer3AssetOut]) await rm(path, { recursive: true, force: true });
for (const path of [viewerPageOut, viewer2PageOut, viewer3PageOut]) await rm(path, { force: true });

if (Bun.env.PAGES_CNAME) {
  await Bun.write(`${root}/output/CNAME`, `${Bun.env.PAGES_CNAME}\n`);
}

await step("bundle viewer v1", ["bun", "scripts/build-viewer.ts"], {
  VIEWER_OUTDIR: viewerAssetOut,
  VIEWER_PAGE_OUT: viewerPageOut,
});
await step("bundle viewer v2", ["bun", "scripts/build-viewer.ts"], {
  VIEWER_OUTDIR: viewer2AssetOut,
  VIEWER_PAGE_OUT: viewer2PageOut,
});
await step("bundle viewer v3", ["bun", "scripts/build-viewer.ts"], {
  VIEWER_OUTDIR: viewer3AssetOut,
  VIEWER_PAGE_OUT: viewer3PageOut,
  VIEWER_ENTRY: `${root}/view3-src/app.jsx`,
  VIEWER_TEMPLATE: `${root}/view3-src/index.html`,
});
await step("package sample SMART Health Link", ["bun", "scripts/gen-shl.ts"], {
  BUNDLE_FILE: exampleOut,
  SHL_OUTDIR: viewerAssetOut,
  VIEWER_BASE: viewerBase,
});
await mirrorDemoAssets(viewerAssetOut, [viewer2AssetOut, viewer3AssetOut]);
await step("package agent assets", ["bun", "scripts/build-agent-assets.ts"], {
  AGENT_OUTDIR: `${root}/output`,
});

// Keep /en/ as a compatibility mirror for generated assets that are created
// after Publisher/Jekyll finishes.
for (const [page, out] of [[viewerPageOut, "view.html"], [viewer2PageOut, "view2.html"], [viewer3PageOut, "view3.html"]] as const) {
  await cp(page, join(englishOut, out), { force: true });
}
for (const [assets, out] of [[viewerAssetOut, "view-assets"], [viewer2AssetOut, "view2-assets"], [viewer3AssetOut, "view3-assets"]] as const) {
  await cp(assets, join(englishOut, out), { recursive: true, force: true });
}
await cp(`${root}/output/skill.zip`, join(englishOut, "skill.zip"), { force: true });
await cp(`${root}/output/llms.txt`, join(englishOut, "llms.txt"), { force: true });

console.log("\nsite build complete: output/");
