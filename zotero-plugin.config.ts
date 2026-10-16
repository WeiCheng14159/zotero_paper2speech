import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

// Same scaffold/build layout as windingwind's template and Local PDF Manager.
export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  // Zotero requires a nonempty update URL even for a manually distributed XPI.
  updateURL:
    "https://github.com/{{owner}}/{{repo}}/releases/download/release/update.json",
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",
  build: {
    fluent: { dts: false },
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      buildVersion: pkg.version,
    },
    prefs: { prefix: pkg.config.prefsPrefix },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },
});
