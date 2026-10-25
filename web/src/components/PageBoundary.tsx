import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";

/** Keep navigation and other persistent sections alive when a page fails. */
export function PageBoundary({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  return <ErrorBoundary label="esta página" resetKey={`${pathname}${search}`}>{children}</ErrorBoundary>;
}
