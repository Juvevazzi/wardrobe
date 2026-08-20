import { createWardrobeHandler, initialize } from "../server/wardrobe-api.mjs";

export function wardrobeImportApi(options = {}) {
  let root;
  const context = () => ({ env: options.env, root, garmentPrompt: options.garmentPrompt });

  return {
    name: "wardrobe-import-job-api",
    apply: "serve",
    async configResolved(config) {
      root = config.root;
      await initialize(context());
    },
    configureServer(server) {
      server.middlewares.use(createWardrobeHandler(context()));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createWardrobeHandler(context()));
    },
  };
}
