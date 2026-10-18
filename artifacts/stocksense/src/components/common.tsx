import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { useGetStocksenseSupportAdminAccess, useGetStocksenseAdminAccess } from '@workspace/api-client-react';
import {
  Activity,
  AlertCircle,
  ArrowLeftRight,
  ChevronRight,
  History,
  LifeBuoy,
  LogOut,
  Menu,
  Package,
  Plus,
  ScanSearch,
  Search,
  Settings2,
  ShieldCheck,
  Store,
  Truck,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { navigationLinks, useNavigationMotion } from './navigation-motion';

type HeadingSection = 'overview' | 'intelligence' | 'products' | 'operations' | 'stockLedger' | 'settings' | 'storeBuilder' | 'customerService' | 'profile' | 'administration' | 'supportReview' | 'deliveries';

const headingSectionIcons: Record<HeadingSection, LucideIcon> = {
  overview: Activity,
  intelligence: ScanSearch,
  products: Package,
  operations: ArrowLeftRight,
  stockLedger: History,
  settings: Settings2,
  storeBuilder: Store,
  customerService: LifeBuoy,
  profile: UserRound,
  administration: UsersRound,
  supportReview: ShieldCheck,
  deliveries: Truck,
};

function sectionForPageTitle(title: string): HeadingSection {
  switch (title.trim().toLowerCase()) {
    case 'overview': return 'overview';
    case 'intelligence':
    case 'inventory intelligence': return 'intelligence';
    case 'operations': return 'operations';
    case 'stock ledger': return 'stockLedger';
    case 'settings': return 'settings';
    case 'store builder': return 'storeBuilder';
    case 'customer service':
    case 'support desk': return 'customerService';
    case 'account profile': return 'profile';
    default: return 'products';
  }
}

export function SectionHeadingIcon({ section }: { section: HeadingSection }) {
  const Icon = headingSectionIcons[section];
  return <span className="section-heading-icon" aria-hidden="true"><Icon size={18} strokeWidth={2}/></span>;
}

export function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" className={`brand ${light ? 'brand-light' : ''}`} data-testid="link-brand"><span className="brand-mark"><Package size={20} strokeWidth={2.5}/></span><span className={`brand-name ${light ? 'brand-name-light' : ''}`}>StockSense<span className="brand-dot">.</span></span></Link>;
}
export function Shell({ children, title, supportWorkspace = false }: { children:ReactNode; title:string; supportWorkspace?:boolean }) {
  const [path] = useLocation(); const [open,setOpen] = useState(false); const {user} = useUser(); const {signOut} = useClerk();
  const adminAccess = useGetStocksenseSupportAdminAccess();
  const stocksenseAdminAccess = useGetStocksenseAdminAccess();
  const { target, sequence, trigger } = useNavigationMotion();
  const contentRef = useRef<HTMLDivElement>(null);
  const isStaffWorkspace = path.startsWith('/customer-service/staff');
  const isSupportWorkspace = isStaffWorkspace || (supportWorkspace && path === '/profile');
  const serviceLink = navigationLinks.find(link => link.href === '/customer-service')!;
  const shellLinks = isSupportWorkspace ? [{ ...serviceLink, href: '/customer-service/staff' }] : navigationLinks;

  useLayoutEffect(() => {
    if (target !== path || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = contentRef.current?.animate([
      { opacity: 0.15, transform: 'translateY(18px) scale(.975)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { duration: 620, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    return () => animation?.cancel();
  }, [path, sequence, target]);

  useLayoutEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  return <div className="app-shell">
    {open && <button aria-label="Close navigation" data-testid="button-close-navigation-overlay" onClick={()=>setOpen(false)} style={{position:'fixed',inset:0,zIndex:20,background:'#092c2c70',border:0}}/>}
    <aside id="stocksense-navigation" aria-label="Main navigation" className={`sidebar ${open?'open':''}`}>
      <div className="sidebar-brand"><Brand/></div>
      <div className="side-caption">Workspace</div>
        <nav>{shellLinks.map(({href,label,icon:Icon})=>{const active=path===href || (href==='/products' && path.startsWith('/products/')) || (href==='/operations' && path.startsWith('/operations/'));const popping=target===href;return <Link key={href} href={href} onClick={()=>{trigger(href);setOpen(false)}} className={`side-link ${active?'active':''}`} aria-current={active?'page':undefined} data-testid={`link-${label.toLowerCase().replace(' ','-')}`}><span key={popping?sequence:'idle'} className={`side-link-icon ${popping?'is-popping':''}`}><Icon aria-hidden="true"/></span><span>{label}</span>{path===href&&<ChevronRight size={13} style={{marginLeft:'auto'}}/>}</Link>})}
          {(adminAccess.data?.canReview === true || stocksenseAdminAccess.data?.isMainAdmin === true) && <>
            <div className="side-caption" style={{marginTop:28}}>Administration</div>
             {adminAccess.data?.canReview === true && <Link href="/customer-service/access-requests" onClick={()=>{trigger('/customer-service/access-requests');setOpen(false)}} className={`side-link ${path==='/customer-service/access-requests'?'active':''}`} aria-current={path==='/customer-service/access-requests'?'page':undefined} data-testid="link-access-review"><span key={target==='/customer-service/access-requests'?sequence:'idle'} className={`side-link-icon ${target==='/customer-service/access-requests'?'is-popping':''}`}><ShieldCheck aria-hidden="true"/></span><span>Support access review</span>{path==='/customer-service/access-requests'&&<ChevronRight size={13} style={{marginLeft:'auto'}}/>}</Link>}
             {stocksenseAdminAccess.data?.isMainAdmin === true && <Link href="/admin/accounts" onClick={()=>{trigger('/admin/accounts');setOpen(false)}} className={`side-link ${path==='/admin/accounts'?'active':''}`} aria-current={path==='/admin/accounts'?'page':undefined} data-testid="link-admin-accounts"><span key={target==='/admin/accounts'?sequence:'idle'} className={`side-link-icon ${target==='/admin/accounts'?'is-popping':''}`}><UsersRound aria-hidden="true"/></span><span>Admin accounts</span>{path==='/admin/accounts'&&<ChevronRight size={13} style={{marginLeft:'auto'}}/>}</Link>}
          </>}
        </nav>
      <div className="side-bottom"><div className="eyebrow side-status-eyebrow">{isSupportWorkspace ? 'SUPPORT WORKSPACE' : 'SYSTEM STATUS'}</div><div className="side-status-line"><span/> {isSupportWorkspace ? 'Customer service active' : 'Inventory connected'}</div><Link href="/profile" onClick={()=>setOpen(false)} className="side-link side-profile-link" data-testid="link-profile"><span className="side-profile-avatar"><UserRound size={16}/></span><span className="side-profile-copy"><strong>{user?.firstName || user?.primaryEmailAddress?.emailAddress || 'Your account'}</strong><small>Account profile</small></span></Link><button type="button" className="side-link side-signout-link" onClick={()=>void signOut({redirectUrl:import.meta.env.BASE_URL})} data-testid="button-shell-signout"><span className="side-link-icon"><LogOut aria-hidden="true"/></span><span>Sign out</span></button></div>
    </aside>
    <div className="main-area"><header className="topbar"><div className="topbar-left"><button className="btn btn-outline icon-btn mobile-menu" onClick={()=>setOpen(true)} aria-label="Open navigation" aria-expanded={open} aria-controls="stocksense-navigation" data-testid="button-open-navigation"><Menu size={18}/></button><span className="eyebrow topbar-crumb">STOCKSENSE <span>/</span> {title.toUpperCase()}</span></div><div className="topbar-right"><span className="eyebrow workspace-live"><i/> LIVE WORKSPACE</span><Link href="/profile" className="btn btn-outline icon-btn" aria-label="Account" data-testid="link-account"><UserRound size={17}/></Link></div></header><div ref={contentRef}>{children}</div></div>
  </div>;
}
export function PageHeading({eyebrow,title,description,action,section}: {eyebrow:string;title:string;description:string;action?:ReactNode;section?:HeadingSection}) {
  return <div className="section-heading-row"><div className="section-heading-copy"><SectionHeadingIcon section={section ?? sectionForPageTitle(title)}/><div className="section-heading-copy-text"><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1><p className="subtle" style={{margin:'8px 0 0',fontSize:13}}>{description}</p></div></div>{action&&<div className="section-heading-action">{action}</div>}</div>;
}
export function Status({value,label}:{value:string;label?:string}) {return <span className={`badge badge-${value}`} data-testid={`status-${value}`}>{label||value}</span>}
export function LoadingRows() {return <div className="panel panel-pad" data-testid="status-loading">{[1,2,3,4,5].map(n=><div key={n} className="skeleton" style={{height:42,marginBottom:12,width:`${95-n*6}%`}}/>)}</div>}
export function QueryError({retry}:{retry:()=>void}) {return <div className="panel empty" data-testid="status-error"><div className="empty-icon"><AlertCircle size={23}/></div><h3 className="display" style={{fontSize:21,margin:0}}>Couldn't load this view</h3><p>Check your connection and try again.</p><button className="btn btn-primary" onClick={retry} data-testid="button-retry">Retry</button></div>}
export function Empty({title,description,action}:{title:string;description:string;action?:ReactNode}) {return <div className="empty" data-testid="status-empty"><div className="empty-icon"><Package size={22}/></div><h3 className="display" style={{fontSize:21,margin:'0 0 8px'}}>{title}</h3><p style={{maxWidth:330,margin:'0 auto 18px',fontSize:13}}>{description}</p>{action}</div>}
export function Modal({title,children,onClose,footer}:{title:string;children:ReactNode;onClose:()=>void;footer?:ReactNode}) {return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="dialog" role="dialog" aria-modal="true" aria-label={title}><div className="dialog-header"><div><div className="eyebrow">STOCKSENSE / WORKSPACE</div><h2 className="display" style={{fontSize:24,margin:'5px 0 0'}}>{title}</h2></div><button className="btn btn-outline icon-btn" onClick={onClose} aria-label="Close" data-testid="button-close-dialog"><X size={17}/></button></div><div className="dialog-body">{children}</div>{footer&&<div className="dialog-footer">{footer}</div>}</div></div>}
export function Field({label,children}:{label:string;children:ReactNode}) {return <label className="field-group"><span className="label">{label}</span>{children}</label>}
export function AddButton({children,onClick}:{children:ReactNode;onClick:()=>void}) {return <button className="btn btn-primary" onClick={onClick} data-testid="button-add"><Plus size={16}/>{children}</button>}
export function SearchField({value,onChange,placeholder='Search by name or SKU'}:{value:string;onChange:(value:string)=>void;placeholder?:string}) {return <div style={{position:'relative',minWidth:220,flex:'1 1 230px'}}><Search size={16} style={{position:'absolute',left:13,top:12,color:'#77948b'}}/><input className="field" type="search" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{paddingLeft:38}} data-testid="input-search"/></div>}
export const dateText=(value:string|null|undefined)=>value?new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
export const numberText=(value:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(value);
export function Confirm({title,description,onClose,onConfirm,busy}:{title:string;description:string;onClose:()=>void;onConfirm:()=>void;busy?:boolean}) {return <Modal title={title} onClose={onClose} footer={<><button className="btn btn-outline" onClick={onClose}>Keep it</button><button className="btn btn-danger" disabled={busy} onClick={onConfirm} data-testid="button-confirm-delete">{busy?'Working…':'Confirm'}</button></>}><p className="subtle" style={{fontSize:13,lineHeight:1.6}}>{description}</p></Modal>}