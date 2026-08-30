interface ImportMetaEnv {
  readonly VITE_CONVEX_SITE_URL?: string
  readonly VITE_CONVEX_DEPLOY_URL?: string
  readonly VITE_SERVER_URL?: string
  readonly VITE_SITE_URL?: string
  readonly VITE_ELECTRON_UPDATE_URL?: string
  readonly VITE_ELECTRON_UPDATE_CHANNEL?: string
  readonly VITE_PUBLIC_POSTHOG_KEY?: string
  readonly VITE_PUBLIC_POSTHOG_HOST?: string
  readonly VITE_LODY_ENV?: string
  readonly VITE_LODY_PLATFORM?: string
  readonly VITE_LODY_OSS_CONTROL_URL?: string
  readonly VITE_LODY_OSS_RELEASE_MANIFEST_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
