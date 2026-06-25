#!/usr/bin/env bun
/**
 * Compatibility wrapper for building view2 directly.
 *
 * The canonical viewer build path is scripts/build-viewer.ts plus the shared
 * viewer-variants registry. This wrapper keeps `bun scripts/build-view2.ts`
 * working without maintaining a separate view2 bundler.
 */
import { viewerBuildEnv, viewerVariant } from "./viewer-variants.ts";
import { access, copyFile } from "node:fs/promises";

const root = `${import.meta.dir}/..`;
const env = viewerBuildEnv(viewerVariant("view2"), `${root}/dist`);
const outdir = Bun.env.VIEW2_OUTDIR || Bun.env.VIEWER_OUTDIR || env.VIEWER_OUTDIR;
const pageOut = Bun.env.VIEW2_PAGE_OUT || Bun.env.VIEWER_PAGE_OUT || env.VIEWER_PAGE_OUT;

const proc = Bun.spawn(["bun", "scripts/build-viewer.ts"], {
  cwd: root,
  env: {
    ...Bun.env,
    ...env,
    VIEWER_OUTDIR: outdir,
    VIEWER_PAGE_OUT: pageOut,
  },
  stdout: "inherit",
  stderr: "inherit",
});

const code = await proc.exited;
if (code === 0) {
  for (const name of ["example.jwe", "shlink.txt"]) {
    const src = `${root}/dist/view-assets/${name}`;
    try {
      await access(src);
      await copyFile(src, `${outdir}/${name}`);
    } catch {
      // Demo assets are produced by gen-shl.ts; direct view2 builds can run before that.
    }
  }
}

process.exit(code);
