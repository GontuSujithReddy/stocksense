import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { ClerkProvider, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Router as WouterRouter, Switch, Route, Redirect, Link, useLocation } from 'wouter';
import { LogOut } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { ErrorBoundary } from '@/components/error-boundary';
import Home from './pages/home';
import AuthPage from './pages/auth';
import DashboardPage from './pages/dashboard';
import ProductsPage from './pages/products';
import ProductDetailPage from './pages/product-detail';
import OperationsPage from './pages/operations';
import OperationDetailPage from './pages/operation-detail';
import MovesPage from './pages/moves';
import SettingsPage from './pages/settings';
import ProfilePage from './pages/profile';
import { Brand, Shell, PageHeading } from './components/common';
import { NavigationMotionProvider } from './components/navigation-motion';
import { CourierDeliveriesPage, CourierDeliveryPage } from './pages/courier-deliveries';
import { useDeleteStocksenseAccount, useGetDeliveryProfile, useGetStocksenseSupportAdminAccess, useGetStocksenseAdminAccess } from '@workspace/api-client-react';
import { useGetStocksenseSupportAccess } from '@workspace/api-client-react';
import { useGetStocksenseAccountStatus } from '@workspace/api-client-react';
import CustomerServicePage from './pages/customer-service';
import CustomerServiceStaffPage from './pages/customer-service-staff';
import CustomerServiceAccessRequestsPage from './pages/customer-service-access-requests';
import DeliveryCustomerChatPage from './pages/delivery-customer-chat';
import StorefrontPage from './pages/storefront';
import StoreBuilderPage from './pages/store-builder';
import { getWorkspaceAccessRedirect, type WorkspaceAccessRole } from './lib/workspace-access-policy';

const IntelligencePage = lazy(() => import('./pages/intelligence'));
const OnboardingPage = lazy(() => import('./pages/onboarding'));
const AdminAccountsPage = lazy(() => import('./pages/admin-accounts'));
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}
if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}
const queryClient = new QueryClient({defaultOptions:{queries:{retry:1,staleTime:15000,refetchOnWindowFocus:true}}});
const clerkAppearance = {
 theme: shadcn,
 cssLayerName:'clerk',
 options:{logoPlacement:'inside' as const,logoLinkUrl:basePath||'/',logoImageUrl:`${window.location.origin}${basePath}/logo.svg`,socialButtonsPlacement:'bottom' as const},
  variables:{colorPrimary:'#3f6fd5',colorForeground:'#203248',colorMutedForeground:'#8492a0',colorDanger:'#b44d4d',colorBackground:'#fbfcfd',colorInput:'#ffffff',colorInputForeground:'#203248',colorNeutral:'#c8d4df',fontFamily:'Manrope, sans-serif',borderRadius:'8px'},
   elements:{rootBox:'w-full flex justify-center',cardBox:'!bg-[#fbfcfd] rounded-[18px] w-full max-w-[440px] overflow-hidden shadow-[0_20px_65px_#20324815] border border-[#dce4eb]',card:'!shadow-none !border-0 !bg-transparent !rounded-none',footer:'!shadow-none !border-0 !bg-transparent !rounded-none',headerTitle:'!text-[#203248] !font-bold',headerSubtitle:'!text-[#586a7d]',socialButtonsBlockButtonText:'!text-[#203248]',formFieldLabel:'!text-[#586a7d]',footerActionLink:'!text-[#2f58b0] !font-bold',footerActionText:'!text-[#586a7d]',dividerText:'!text-[#8492a0]',identityPreviewEditButton:'!text-[#2f58b0]',formFieldSuccessText:'!text-[#387b62]',alertText:'!text-[#b44d4d]',logoBox:'!h-12',logoImage:'!h-10 !max-w-[190px]',socialButtonsBlockButton:'!border-[#dce4eb] !bg-[#f5f8fb]',formButtonPrimary:'!bg-[#3f6fd5] !text-white hover:!bg-[#2f58b0]',formFieldInput:'!bg-white !text-[#203248] !border-[#d5dfe8]',footerAction:'!bg-transparent',dividerLine:'!bg-[#dce4eb]',alert:'!bg-[#fbe9e7]',otpCodeFieldInput:'!bg-white !text-[#203248]',formFieldRow:'!text-[#203248]',main:'!text-[#203248]'}
};
function ClerkQueryClientCacheInvalidator() {
 const { addListener } = useClerk(); const client=useQueryClient(); const previous=useRef<string|null|undefined>(undefined);
 useEffect(()=>{const unsubscribe=addListener(({user})=>{const id=user?.id??null;if(previous.current!==undefined&&previous.current!==id)client.clear();previous.current=id});return unsubscribe},[addListener,client]);return null;
}

function WorkspaceError({error,retry}:{error:unknown;retry:()=>void}){return <div className="page" role="alert">Could not load your workspace. {error instanceof Error ? error.message : ''} <button className="btn btn-outline" onClick={retry}>Retry</button></div>}
function RoleHome(){
 const q=useGetDeliveryProfile();
 const support=useGetStocksenseSupportAccess();
 const account=useGetStocksenseAccountStatus();
 const admin=useGetStocksenseAdminAccess();
  if(q.isLoading||account.isLoading||support.isLoading||admin.isLoading)return <div className="page" role="status">Loading your workspace…</div>;
 if(q.isError)return <WorkspaceError error={q.error} retry={()=>void q.refetch()}/>;
  if(account.isError)return <WorkspaceError error={account.error} retry={()=>void account.refetch()}/>;
   if(admin.isError)return <WorkspaceError error={admin.error} retry={()=>void admin.refetch()}/>;
  if(account.data?.deleted)return <Redirect to="/account-deleted"/>;
  if(admin.data?.status==='pending'||admin.data?.status==='inactive'||admin.data?.status==='terminated')return <Redirect to="/onboarding"/>;
  if(admin.data?.status!=='active'&&(support.data?.status==='paused'||support.data?.status==='approved'))return <Redirect to="/customer-service/staff"/>;
 if(q.data?.role==='support_staff')return <Redirect to="/onboarding"/>;
 if(!q.data?.role || !/^[0-9]{10}$/.test(q.data.phone))return <Redirect to="/onboarding"/>;
 return <Redirect to={q.data.role==='courier'?'/courier/deliveries':'/dashboard'}/>;
}
function HomeRedirect(){return <><Show when="signed-in"><RoleHome/></Show><Show when="signed-out"><Home/></Show></>}

function WorkspaceAccess({children,role}:{children:ReactNode;role:WorkspaceAccessRole}){
 const q=useGetDeliveryProfile();
 const support=useGetStocksenseSupportAccess();
 const account=useGetStocksenseAccountStatus();
 const admin=useGetStocksenseAdminAccess();
  if(q.isLoading||account.isLoading||support.isLoading||admin.isLoading)return <div className="page" role="status">Loading your workspace…</div>;
 if(q.isError)return <WorkspaceError error={q.error} retry={()=>void q.refetch()}/>;
  if(account.isError)return <WorkspaceError error={account.error} retry={()=>void account.refetch()}/>;
   if(admin.isError)return <WorkspaceError error={admin.error} retry={()=>void admin.refetch()}/>;
  const redirect = getWorkspaceAccessRedirect({
    role,
    deliveryRole: q.data?.role,
    phone: q.data?.phone,
    accountDeleted: account.data?.deleted === true,
    adminStatus: admin.data?.status,
    supportStatus: support.data?.status,
  });
  if(redirect)return <Redirect to={redirect}/>;
 return <>{children}</>;
}
function Protected({children,role='owner'}:{children:ReactNode;role?:WorkspaceAccessRole}){return <><Show when="signed-in"><WorkspaceAccess role={role}>{children}</WorkspaceAccess></Show><Show when="signed-out"><Redirect to="/"/></Show></>}
function SupportAccessReviewRoute(){
 const access=useGetStocksenseSupportAdminAccess();
 if(access.isLoading)return <div className="page" role="status">Checking administrator access…</div>;
 if(access.isError)return <div className="page" role="alert">Unable to verify access. Refresh the page and try again.</div>;
 if(!access.data?.canReview)return <Redirect to="/"/>;
 return <CustomerServiceAccessRequestsPage/>;
}
function AdminAccountsRoute(){
 const access=useGetStocksenseAdminAccess();
 if(access.isLoading)return <div className="page" role="status" data-testid="status-admin-access-check">Checking administrator access…</div>;
 if(access.isError)return <div className="page" role="alert" data-testid="status-admin-access-error">Unable to verify administrator access. Refresh the page and try again.</div>;
 if(!access.data?.isMainAdmin)return <Redirect to="/"/>;
 return <Suspense fallback={<div className="page" role="status">Loading Admin accounts…</div>}><AdminAccountsPage/></Suspense>;
}
 function NotFound(){return <Shell title="Not found"><main className="page not-found-page"><div className="eyebrow">404 / WRONG AISLE</div><h1 className="display not-found-title">Nothing stored here.</h1><p className="subtle">This page may have moved or never existed.</p><Link href="/dashboard" className="btn btn-primary" style={{marginTop:20}} data-testid="link-back-dashboard">Back to overview</Link></main></Shell>}
function RoutedErrorBoundary({children}:{children:ReactNode}){const [location]=useLocation();return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>}
function accountDeletionError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data;
    if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  return 'The deletion could not be confirmed. Keep this page open and retry.';
}

function AccountDeletionPendingPage(){
  const {signOut}=useClerk();
  const account=useGetStocksenseAccountStatus();
  const deletion=useDeleteStocksenseAccount();
  const client=useQueryClient();
  const [,setLocation]=useLocation();
  const [error,setError]=useState('');
  if(account.isLoading)return <div className="page" role="status">Checking account deletion…</div>;
  if(account.isError)return <WorkspaceError error={account.error} retry={()=>void account.refetch()}/>;
  if(!account.data?.deleted)return <Redirect to="/profile"/>;
  const retryDeletion=async()=>{
    setError('');
    try{
      await deletion.mutateAsync();
      client.clear();
      setLocation('/account-deleted?complete=1');
    }catch(failure){
      setError(accountDeletionError(failure));
    }
  };
  return <Shell title="Finish account deletion"><main className="page"><PageHeading eyebrow="ACCOUNT DELETION IN PROGRESS" title="Finish deleting your account" description="Your StockSense data and Delivery profile/settings have been removed. The shared sign-in still needs to be deleted."/><div className="panel" style={{maxWidth:700,padding:28}}><p>Delivery-linked operational history is retained in Delivery. Retry to finish removing the shared sign-in; this step is safe to repeat.</p>{error&&<p role="alert" style={{color:'#a34432',fontSize:13}}>{error}</p>}<div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:18}}><button className="btn btn-danger" onClick={()=>void retryDeletion()} disabled={deletion.isPending} data-testid="button-retry-account-deletion">{deletion.isPending?'Finishing deletion…':'Retry account deletion'}</button><button className="btn btn-outline" onClick={()=>signOut({redirectUrl:basePath||'/'})} data-testid="button-deleted-account-signout"><LogOut size={16}/> Sign out</button></div></div></main></Shell>;
}

function AccountDeletionResultPage({completed}:{completed:boolean}){
  return <main style={{minHeight:'100dvh',display:'grid',placeItems:'center',padding:'32px 20px'}}>
    <div style={{width:'min(700px, 100%)'}}>
      <div style={{marginBottom:28}}><Brand/></div>
      <section className="panel" aria-live="polite" style={{padding:30}}>
        <PageHeading eyebrow={completed?'DELETION COMPLETE':'ACCOUNT STATUS'} title={completed?'Your account was deleted':'This account is no longer available'} description={completed?'Your StockSense workspace, shared sign-in, and Delivery profile/settings have been permanently removed.':'There is no active StockSense workspace for this signed-out session.'}/>
        <p className="subtle" style={{fontSize:14,lineHeight:1.65}}>Delivery-linked operational history is retained in Delivery.</p>
        <Link href="/" className="btn btn-outline" style={{marginTop:18}} data-testid="link-deleted-account-home">Back to StockSense home</Link>
      </section>
    </div>
  </main>;
}

function AccountDeletedRoute(){
  const completed=new URLSearchParams(window.location.search).get('complete')==='1';
  if(completed)return <AccountDeletionResultPage completed/>;
  return <><Show when="signed-in"><AccountDeletionPendingPage/></Show><Show when="signed-out"><AccountDeletionResultPage completed={false}/></Show></>;
}
function Routes(){
 return <RoutedErrorBoundary><Switch>
  <Route path="/delivery-chat" component={DeliveryCustomerChatPage}/>
   <Route path="/store/:slug">{params => <StorefrontPage slug={params.slug} />}</Route>
  <Route path="/" component={HomeRedirect}/>
   <Route path="/account-deleted" component={AccountDeletedRoute}/>
  <Route path="/sign-in/*?">{()=><AuthPage kind="sign-in"/>}</Route>
  <Route path="/sign-up/*?">{()=><AuthPage kind="sign-up"/>}</Route>
  <Route path="/onboarding">{()=><><Show when="signed-in"><Suspense fallback={<div className="page" role="status">Loading account setup…</div>}><OnboardingPage/></Suspense></Show><Show when="signed-out"><Redirect to="/sign-up"/></Show></>}</Route>
   <Route path="/customer-service/staff">{()=><><Show when="signed-in"><CustomerServiceStaffPage/></Show><Show when="signed-out"><Redirect to="/"/></Show></>}</Route>
     <Route path="/customer-service/access-requests">{()=><><Show when="signed-in"><SupportAccessReviewRoute/></Show><Show when="signed-out"><Redirect to="/"/></Show></>}</Route>
    <Route path="/admin/accounts">{()=><><Show when="signed-in"><AdminAccountsRoute/></Show><Show when="signed-out"><Redirect to="/"/></Show></>}</Route>
   <Route path="/customer-service">{()=><Protected><CustomerServicePage/></Protected>}</Route>
  <Route path="/courier/deliveries">{()=><Protected role="courier"><CourierDeliveriesPage/></Protected>}</Route>
  <Route path="/courier/deliveries/:id">{()=><Protected role="courier"><CourierDeliveryPage/></Protected>}</Route>
  <Route path="/dashboard">{()=><Protected><DashboardPage/></Protected>}</Route>
   <Route path="/intelligence">{()=><Protected><Suspense fallback={<div className="page" role="status">Loading inventory intelligence…</div>}><IntelligencePage/></Suspense></Protected>}</Route>
  <Route path="/products">{()=><Protected><ProductsPage/></Protected>}</Route>
   <Route path="/store-builder">{()=><Protected><StoreBuilderPage/></Protected>}</Route>
  <Route path="/products/:id">{()=><Protected><ProductDetailPage/></Protected>}</Route>
  <Route path="/operations">{()=><Protected><OperationsPage/></Protected>}</Route>
  <Route path="/operations/:id">{()=><Protected><OperationDetailPage/></Protected>}</Route>
  <Route path="/moves">{()=><Protected><MovesPage/></Protected>}</Route>
  <Route path="/settings">{()=><Protected><SettingsPage/></Protected>}</Route>
  <Route path="/profile">{()=><Protected role="profile"><ProfilePage/></Protected>}</Route>
  <Route>{()=><Protected><NotFound/></Protected>}</Route>
 </Switch></RoutedErrorBoundary>;
}
function ClerkProviderWithRoutes(){
 const [,setLocation]=useLocation();
 return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{signIn:{start:{title:'Welcome back',subtitle:'Sign in to see what is moving.'}},signUp:{start:{title:'Start with a clear picture',subtitle:'Create your StockSense account.'}}}} routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}>
   <QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator/><TooltipProvider><Routes/><Toaster/></TooltipProvider></QueryClientProvider>
 </ClerkProvider>;
}
function App(){return <WouterRouter base={basePath}><NavigationMotionProvider><ClerkProviderWithRoutes/></NavigationMotionProvider></WouterRouter>}
export default App;
