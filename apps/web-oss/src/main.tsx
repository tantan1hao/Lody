import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { Provider } from 'jotai';
import { createRouter } from '@lody/components/router';
import '@lody/components/tailwind/index.css';
import { createLodyAuthClient, jotaiStore } from '@lody/components/lib';
import { installResizeObserverLoopErrorHandler } from '@lody/components/lib/resize-observer';
import { registerWebPushServiceWorker } from '@lody/components/lib/web-push-client';

installResizeObserverLoopErrorHandler();

if ('serviceWorker' in navigator) {
  void registerWebPushServiceWorker().catch((error: unknown) => {
    console.warn('Failed to register web push service worker', error);
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element.');

// Routes require the auth-client shape in their context, but self-hosted routes
// use the static single-user PlatformProvider and never call this client.
const authClient = createLodyAuthClient({ disableDefaultFetchPlugins: true });
const router = createRouter({ authClient });

createRoot(rootElement).render(
  <Provider store={jotaiStore}>
    <RouterProvider router={router} />
  </Provider>,
);
