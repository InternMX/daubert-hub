import { createContext, useContext } from 'react';

// Shared with AppShell's own expanded/collapsed sidebar state (see AppShell.tsx) so pages
// rendered inside it can react to the sidebar eating horizontal space — without measuring the
// drawer's DOM width (no ResizeObserver/getBoundingClientRect) and without prop-drilling through
// every layout in between.
export interface SidebarContextValue {
  collapsed: boolean;
}

export const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

// Defaults to "collapsed" (true) when rendered outside an AppShell provider — e.g. a page
// component under test in isolation — so a missing provider never fabricates the
// horizontal-space-constrained (expanded sidebar) case. Unlike useAuth(), this is intentionally
// non-throwing: most pages never need sidebar state at all, and the few call sites that do should
// still render sensibly (as if the sidebar were out of the way) rather than crash.
export function useSidebarCollapsed(): boolean {
  const context = useContext(SidebarContext);
  return context?.collapsed ?? true;
}
