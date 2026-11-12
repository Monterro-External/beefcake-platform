// Stand-in for next/link outside a Next app. In a Next app Link renders a
// plain <a> with the same href and props; designs have no router, so a
// plain <a> is exactly what they need.
import type { AnchorHTMLAttributes, ReactNode } from 'react';

export default function Link({
  href,
  children,
  prefetch: _prefetch,
  replace: _replace,
  scroll: _scroll,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string | { pathname?: string };
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
}) {
  const url = typeof href === 'string' ? href : (href.pathname ?? '#');
  return (
    <a href={url} {...rest}>
      {children}
    </a>
  );
}
