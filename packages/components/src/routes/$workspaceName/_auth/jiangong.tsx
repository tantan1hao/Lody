import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { RouteSuspense } from '@/components/route-suspense';

const LazyJiangongView = lazy(async () => {
  const module = await import('@/components/jiangong/project-board');
  return { default: module.JiangongView };
});

export const Route = createFileRoute('/$workspaceName/_auth/jiangong')({
  component: JiangongRoute,
});

function JiangongRoute() {
  return (
    <RouteSuspense>
      <LazyJiangongView />
    </RouteSuspense>
  );
}
