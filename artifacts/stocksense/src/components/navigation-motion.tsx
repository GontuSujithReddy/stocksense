import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Package, ArrowLeftRight, History, Settings2, ScanSearch, LifeBuoy, Store } from 'lucide-react';

export const navigationLinks = [
  { href: '/dashboard', label: 'Overview', icon: Activity },
  { href: '/intelligence', label: 'Intelligence', icon: ScanSearch },
  { href: '/products', label: 'Products', icon: Package },
  { href: '/operations', label: 'Operations', icon: ArrowLeftRight },
  { href: '/moves', label: 'Stock ledger', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings2 },
  { href: '/store-builder', label: 'Store builder', icon: Store },
  { href: '/customer-service', label: 'Customer service', icon: LifeBuoy },
] as const;

type NavigationMotion = {
  target: string | null;
  sequence: number;
  trigger: (href: string) => void;
};

const NavigationMotionContext = createContext<NavigationMotion | null>(null);

export function NavigationMotionProvider({ children }: { children: ReactNode }) {
  const [motion, setMotion] = useState({ target: null as string | null, sequence: 0 });
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeItem = navigationLinks.find(({ href }) => href === motion.target);
  const Icon = activeItem?.icon;

  const trigger = useCallback((href: string) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setMotion((current) => ({ target: href, sequence: current.sequence + 1 }));
    clearTimer.current = setTimeout(() => {
      setMotion((current) => ({ ...current, target: null }));
      clearTimer.current = null;
    }, 1150);
  }, []);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  return (
    <NavigationMotionContext.Provider value={{ ...motion, trigger }}>
      {children}
      {activeItem && Icon && createPortal(
        <div key={motion.sequence} className="nav-splash" aria-hidden="true" data-testid={`animation-${activeItem.label.toLowerCase().replace(/\s+/g, '-')}`}>
          <div className="nav-splash-content">
            <span className="nav-splash-icon"><Icon size={78} strokeWidth={1.8}/></span>
            <span className="nav-splash-label">{activeItem.label}</span>
          </div>
        </div>,
        document.body,
      )}
    </NavigationMotionContext.Provider>
  );
}

export function useNavigationMotion() {
  const motion = useContext(NavigationMotionContext);
  if (!motion) throw new Error('Navigation motion must be used inside its provider.');
  return motion;
}