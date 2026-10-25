'use client';

import { usePathname } from 'next/navigation';

/**
 * Each page blurs in when it opens, its cards following frosted and sharpening one after another
 * (globals.css .page-enter). Keyed on the path, so a new page plays it and a filter change does not.
 */
export function PageEnter({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
