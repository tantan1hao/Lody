/// <reference types="vite/client" />

import '../../../packages/components/src/window-globals';

declare global {
  const __APP_VERSION__: string;
  const __BUILD_DATE__: string;
  const __GIT_COMMIT__: string;
}
