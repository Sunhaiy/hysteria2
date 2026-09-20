# Third-Party Notices

## dotLottie Web runtime

The homepage serves the WebAssembly runtime from `@lottiefiles/dotlottie-web`
0.80.0 locally, matching the installed player. Animation rendering runs in a
Worker while the main thread remains available for page interaction.

- Local runtime: `public/vendor/dotlottie/dotlottie-player-0.80.0.wasm`
- Local license copy: `public/vendor/dotlottie/LICENSE`
- When updating the player, update the versioned runtime and its cache header.
- Run `node scripts/check-homepage-build.mjs` after a production build to check
  the runtime digest and server-rendered first-screen visibility.

## Perfect Panel frontend

The public homepage includes adapted components and the original homepage
Lottie assets from [perfect-panel/frontend](https://github.com/perfect-panel/frontend).

- License: GNU General Public License v3.0
- Upstream source: https://github.com/perfect-panel/frontend
- Local license copy: `public/vendor/perfect-panel/LICENSE`
- Adapted files: `src/components/deferred-dot-lottie.tsx`,
  `src/components/hover-border-gradient.tsx`,
  `src/components/text-generate-effect.tsx`, and `src/app/page.tsx`
- Original assets: `public/assets/lotties/network-security.json`,
  `users.json`, `servers.json`, `locations.json`, and `global-map.json`

The adapted implementation integrates the upstream homepage with this
project's catalog, authentication routes, site identity, and theme variables.

## Tiptap Simple Editor template

The SEO administrator uses adapted source from Tiptap's official Simple Editor
template together with the Tiptap open-source packages.

- License: MIT
- Upstream source: https://tiptap.dev/docs/ui-components/templates/simple-editor
- Adapted files: `src/components/tiptap-templates`, `tiptap-ui`,
  `tiptap-ui-primitive`, `tiptap-node`, `tiptap-extension`, `tiptap-icons`,
  and the supporting editor hooks and styles.
