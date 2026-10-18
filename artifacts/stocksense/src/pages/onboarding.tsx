import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useClerk, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { LogOut, Truck, Warehouse, Headset, ShieldCheck, Clock3, CircleOff } from 'lucide-react';
import {
  useGetDeliveryProfile,
  useSaveDeliveryProfile,
  getGetDeliveryProfileQueryKey,
  useGetStocksenseSupportAccess,
  useGetStocksenseSupportAdminAccess,
  useRequestStocksenseSupportAccess,
  getGetStocksenseSupportAccessQueryKey,
  useGetStocksenseAdminAccess,
  getGetStocksenseAdminAccessQueryKey,
  useRequestStocksenseAdminAccess,
} from '@workspace/api-client-react';
import './onboarding.css';

type Role = 'admin' | 'owner' | 'courier' | 'customer-service';
const TEN = /^[0-9]{10}$/;
const dest = (r: string | null | undefined) => (r === 'courier' ? '/courier/deliveries' : '/dashboard');

export default function OnboardingPage() {
  const q = useGetDeliveryProfile();
  const save = useSaveDeliveryProfile();
  const supportAccess = useGetStocksenseSupportAccess();
  const adminAccess = useGetStocksenseAdminAccess();
  const supportAdminAccess = useGetStocksenseSupportAdminAccess();
  const requestSupport = useRequestStocksenseSupportAccess();
  const requestAdmin = useRequestStocksenseAdminAccess();
  const qc = useQueryClient();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [lockedRole, setLockedRole] = useState<Role | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [supportSubmitted, setSupportSubmitted] = useState(false);
  const [supportEmailNotificationSent, setSupportEmailNotificationSent] = useState<boolean | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSubmitted, setAdminSubmitted] = useState(false);
  const init = useRef(false);
  const profile = q.data;
  const supportState = supportAccess.data;
  const adminState = adminAccess.data;
  const adminAccessBlocked = adminState?.status === 'inactive' || adminState?.status === 'terminated';
  const adminAccessHeading = adminState?.status === 'inactive' ? 'INACTIVE' : 'TERMINATED';

  useEffect(() => {
    if (!profile || init.current) return;
    init.current = true;
    setName(profile.name ?? '');
    if (profile.role === 'support_staff') {
      setRole('customer-service');
      setLockedRole('customer-service');
      if (TEN.test(profile.phone ?? '')) setPhone(profile.phone);
    } else if (profile.role === 'owner' || profile.role === 'courier') {
      setRole(profile.role);
      setLockedRole(profile.role);
      if (TEN.test(profile.phone ?? '')) setPhone(profile.phone);
      else setLegacy(true);
    }
  }, [profile]);

  useEffect(() => {
    if (adminState?.status !== 'active') return;
    setRole('owner');
    setLockedRole('owner');
    const registeredName = adminState.displayName ?? profile?.name;
    if (registeredName) setName(registeredName);
    if (TEN.test(profile?.phone ?? '')) setPhone(profile!.phone);
  }, [adminState?.status, adminState?.displayName, profile]);

  useEffect(() => {
    if (adminState?.status === 'active') return;
    if (supportState?.status !== 'approved' || supportState.profileComplete || lockedRole === 'customer-service') return;
    setRole('customer-service');
    setLockedRole('customer-service');
    const registeredName = supportState.displayName ?? profile?.name;
    const registeredPhone = supportState.phone ?? profile?.phone;
    if (registeredName) setName(registeredName);
    if (typeof registeredPhone === 'string' && TEN.test(registeredPhone)) setPhone(registeredPhone);
  }, [profile, supportState, lockedRole, adminState?.status]);

  const complete = !!profile && (profile.role === 'owner' || profile.role === 'courier') && TEN.test(profile.phone ?? '') && (adminState?.status !== 'active' || profile.role === 'owner');
  useEffect(() => {
    if (adminState?.status === 'pending' || adminState?.status === 'inactive' || adminState?.status === 'terminated') return;
    if (adminState?.status !== 'active' && supportState?.status === 'paused') {
      setLocation('/customer-service/staff', { replace: true });
      return;
    }
    if (adminState?.status !== 'active' && supportState?.status === 'approved' && supportState.profileComplete) {
      setLocation('/customer-service/staff', { replace: true });
      return;
    }
    if (complete && !save.isPending && (!supportAccess.isLoading || supportAccess.isError)) setLocation(dest(profile?.role), { replace: true });
  }, [complete, profile?.role, save.isPending, setLocation, supportState?.status, supportAccess.isLoading, supportAccess.isError, adminState?.status]);

  const phoneValid = TEN.test(phone);
  const validName = role === 'customer-service' || role === 'admin' ? name.trim().length >= 2 : name.trim().length > 0;
  const canSubmit = !!role && validName && phoneValid && !q.isError && !save.isPending && !requestSupport.isPending && !requestAdmin.isPending && !done;
  const showPhoneErr = phoneTouched && phone.length > 0 && !phoneValid;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !role) return;
    if (role === 'admin') {
      setAdminError(null);
      try {
        const response = await requestAdmin.mutateAsync({ data: { name: name.trim(), phone } });
        qc.setQueryData(getGetStocksenseAdminAccessQueryKey(), response);
        await qc.invalidateQueries({ queryKey: getGetStocksenseAdminAccessQueryKey() });
        setAdminSubmitted(true);
      } catch (err) {
        setAdminError(err instanceof Error && err.message ? err.message : 'Your Admin request could not be sent. Check your connection and try again.');
      }
      return;
    }
    if (role === 'customer-service') {
      setSupportError(null);
      try {
        const response = await requestSupport.mutateAsync({ data: { name: name.trim(), phone } });
        setSupportEmailNotificationSent(response.emailNotificationSent);
        qc.setQueryData(getGetStocksenseSupportAccessQueryKey(), response);
        await qc.invalidateQueries({ queryKey: getGetStocksenseSupportAccessQueryKey() });
        if (response.status === 'approved') setLocation('/customer-service/staff', { replace: true });
        else setSupportSubmitted(true);
      } catch (err) {
        setSupportError(err instanceof Error && err.message ? err.message : 'Your access request could not be sent. Check your connection and try again.');
      }
      return;
    }
    setSaveError(null);
    try {
      const result = await save.mutateAsync({ data: { name: name.trim(), phone, role } });
      qc.setQueryData(getGetDeliveryProfileQueryKey(), result);
      setDone(true);
      await qc.invalidateQueries({ queryKey: getGetDeliveryProfileQueryKey() });
      setLocation(dest(result.role ?? role), { replace: true });
    } catch (err) {
      setDone(false);
      setSaveError(err instanceof Error && err.message ? err.message : 'We could not save your details. Check your connection and try again.');
    }
  };

  const logout = () => void signOut({ redirectUrl: import.meta.env.BASE_URL });
  const pick = (r: Role) => { if (!lockedRole) setRole(r); };

  const roleBtn = (r: Role, title: string, text: string, Icon: typeof Truck) => (
    <button
      type="button" role="radio" aria-checked={role === r}
      disabled={!!lockedRole && lockedRole !== r}
      className="ob-role" onClick={() => pick(r)} data-testid={`onboarding-role-${r}`}
    >
      <Icon size={20} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{text}</span>
    </button>
  );

  let body;
  if (q.isLoading) {
    body = <div role="status" aria-label="Loading your profile"><div className="skeleton ob-skel" /><div className="skeleton ob-skel" /><div className="skeleton ob-skel" /></div>;
  } else if (q.isError) {
    body = (
      <div className="ob-alert" role="alert" data-testid="onboarding-error">
        <span>We could not load your profile, so setup is paused.</span>
        <button type="button" className="btn btn-outline" onClick={() => void q.refetch()} data-testid="onboarding-retry">Retry</button>
      </div>
    );
  } else if (adminAccess.isLoading) {
    body = <div role="status" aria-label="Checking Admin access"><div className="skeleton ob-skel" /><div className="skeleton ob-skel" /></div>;
  } else if (adminAccess.isError) {
    body = <div className="ob-alert" role="alert" data-testid="onboarding-admin-access-error"><span>We could not check Admin access, so account setup is paused.</span><button type="button" className="btn btn-outline" onClick={() => void adminAccess.refetch()} data-testid="onboarding-admin-retry">Retry</button></div>;
  } else if (adminState?.status === 'pending' || adminSubmitted) {
    body = <div className="ob-lifecycle pending" role="status" data-testid="onboarding-admin-pending"><span className="eyebrow"><Clock3 size={13}/> ADMIN REQUEST / PENDING</span><h2 className="display">Your request is in review.</h2><p className="ob-lead">An administrator will review your details. Submitting this request does not create an Owner profile or grant workspace access.</p>{adminState?.requestCreatedAt && <p className="ob-hint">Requested {new Date(adminState.requestCreatedAt).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'})}</p>}<button type="button" className="btn btn-outline" onClick={() => void adminAccess.refetch()} data-testid="onboarding-admin-check">Check request status</button></div>;
  } else if (adminState?.status === 'inactive') {
    body = <div className="ob-lifecycle inactive" role="status" data-testid="onboarding-admin-inactive"><span className="eyebrow"><CircleOff size={13}/> ADMIN ACCESS / INACTIVE</span><h2 className="display">Admin portal unavailable</h2><p className="ob-lead">You can still sign in, but you cannot use your StockSense Admin portal while access is inactive. Contact the main administrator to reactivate your access.</p><button type="button" className="btn btn-outline" onClick={() => void adminAccess.refetch()} data-testid="onboarding-admin-inactive-check">Check access status</button></div>;
  } else if (adminState?.status === 'terminated') {
    body = <div className="ob-lifecycle terminated" role="status" data-testid="onboarding-admin-terminated"><span className="eyebrow"><CircleOff size={13}/> ADMIN ACCESS / TERMINATED</span><h2 className="display">Admin portal access has ended</h2><p className="ob-lead">You can still sign in, but you can no longer use StockSense as an Admin. Termination is permanent. Your Admin record and workspace data remain; a separate Owner or Courier account and its data are not deleted.</p><button type="button" className="btn btn-outline" onClick={() => void adminAccess.refetch()} data-testid="onboarding-admin-terminated-check">Check access status</button></div>;
  } else if (supportAccess.isLoading) {
    body = <div role="status" aria-label="Checking customer service access"><div className="skeleton ob-skel" /><div className="skeleton ob-skel" /></div>;
  } else if (supportAccess.isError) {
    body = <div className="ob-alert" role="alert" data-testid="onboarding-support-access-error"><span>We could not check customer service access.</span><button type="button" className="btn btn-outline" onClick={() => void supportAccess.refetch()} data-testid="onboarding-support-retry">Retry</button></div>;
  } else if (adminState?.status !== 'active' && supportState?.status === 'paused') {
    body = <div className="ob-support-pending" role="status" data-testid="onboarding-support-paused">
      <span className="eyebrow">ACCESS PAUSED</span>
      <h2 className="display">Your support access is inactive</h2>
      <p className="ob-lead">An administrator paused your StockSense support access. You cannot open the shared queue while it is paused. Your accepted status is preserved, and Delivery access is unchanged.</p>
      <Link className="btn btn-outline" href="/customer-service/staff" data-testid="onboarding-paused-staff-link">View access status</Link>
    </div>;
  } else if (adminState?.status !== 'active' && (supportState?.status === 'pending' || supportSubmitted)) {
    body = <div className="ob-support-pending" data-testid="onboarding-support-pending">
      <span className="eyebrow">REQUEST RECEIVED</span>
      <h2 className="display">Awaiting approval</h2>
      <p className="ob-lead">Your customer service access request is saved for administrator review. This request does not grant access to the shared ticket queue.</p>
      {supportEmailNotificationSent === false && <p className="ob-note" role="status" data-testid="onboarding-support-email-notice-failed">The administrator could not be emailed, but your request is in the review queue. They may need to check it manually.</p>}
      {supportEmailNotificationSent === true && <p className="ob-hint" role="status" data-testid="onboarding-support-email-notice-sent">The administrator was notified by email.</p>}
      <button type="button" className="btn btn-outline" onClick={() => void supportAccess.refetch()} data-testid="onboarding-support-check">Check approval status</button>
      {supportState?.requestCreatedAt && <p className="ob-hint">Requested {new Date(supportState.requestCreatedAt).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'})}</p>}
    </div>;
  } else if (adminState?.status !== 'active' && supportState?.status === 'approved' && supportState.profileComplete) {
    body = <div role="status" data-testid="onboarding-support-approved">Approved. Opening the customer service desk…</div>;
  } else {
    body = (
      <form onSubmit={onSubmit} noValidate>
        {adminState?.status !== 'active' && supportState?.status === 'approved' && !supportState.profileComplete && (
          <div className="ob-note" role="note" data-testid="onboarding-support-profile-needed">
            Your customer service access is approved. Add your registered name and phone to continue. This does not change your owner or courier workspace.
          </div>
        )}
          {supportState?.status === 'denied' && (
          <div className="ob-note" role="note" data-testid="onboarding-support-denied">
            Your previous access request was denied. You may update your contact details and submit a new request; it will be reviewed as a new pending application.
          </div>
        )}
        {adminState?.status === 'denied' && (
          <div className="ob-note" role="note" data-testid="onboarding-admin-denied">
            Your previous Admin request was denied. You may submit a new Admin request or continue with a standard Owner or Courier role.
          </div>
        )}
        {legacy && (
          <div className="ob-note" role="note" data-testid="onboarding-legacy-note">
            Your role is already set, but the phone number on file is not a 10-digit number. Please enter an updated 10-digit contact number.
          </div>
        )}
         {adminState?.status !== 'active' && supportState?.status === 'approved' && !supportState.profileComplete
          ? <p className="ob-hint">Approved customer service staff</p>
           : adminState?.status === 'active' ? <div className="ob-active-admin" data-testid="onboarding-admin-active"><span className="ob-admin-mark"><ShieldCheck size={17}/></span><span><strong>Admin · Owner workspace</strong><small>Your active Admin access is scoped to your own Owner workspace.</small></span></div>
           : <fieldset className="ob-roles" role="radiogroup" aria-label="Your role" disabled={save.isPending || requestAdmin.isPending}>
                {(!lockedRole || adminState?.status === 'denied') && !adminState?.isMainAdmin && roleBtn('admin', 'Admin', 'Request administrator access for your own workspace.', ShieldCheck)}
              {roleBtn('owner', 'Owner', 'I manage stock, products and deliveries.', Warehouse)}
              {roleBtn('courier', 'Courier', 'I carry orders to customers.', Truck)}
              {roleBtn('customer-service', 'Customer service', 'Request access to help StockSense owners.', Headset)}
            </fieldset>}
        {lockedRole && <p className="ob-hint">Your role is locked to {lockedRole}.</p>}
        <div className={`ob-reveal${role ? ' open' : ''}`} aria-hidden={!role}>
          <div>
            <div className="ob-fields">
              <div className="field-group">
                <label className="label" htmlFor="ob-name">Full name</label>
                <input id="ob-name" className="field" type="text" autoComplete="name" maxLength={120} minLength={role === 'customer-service' ? 2 : 1} required
                  tabIndex={role ? 0 : -1} value={name} onChange={(e) => setName(e.target.value)} data-testid="onboarding-name" />
              </div>
              <div className="field-group">
                <label className="label" htmlFor="ob-phone">Phone number</label>
                <input id="ob-phone" className="field" type="tel" inputMode="numeric" autoComplete="tel-national"
                  pattern="[0-9]{10}" minLength={10} maxLength={10} required tabIndex={role ? 0 : -1}
                  placeholder="10 digits" value={phone} aria-invalid={showPhoneErr}
                  aria-describedby="ob-phone-help"
                   onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => setPhoneTouched(true)} data-testid="onboarding-phone" />
                {showPhoneErr
                  ? <div id="ob-phone-help" className="ob-err" role="alert">Enter exactly 10 digits, with no country code ({phone.length}/10).</div>
                  : <div id="ob-phone-help" className="ob-hint">Digits only, no country code.{user?.primaryEmailAddress ? ` Signed in as ${user.primaryEmailAddress.emailAddress}.` : ''}</div>}
              </div>
              {saveError && (
                <div className="ob-alert" role="alert" data-testid="onboarding-save-error">
                  <span>{saveError}</span>
                </div>
              )}
              {supportError && <div className="ob-alert" role="alert" data-testid="onboarding-support-request-error">{supportError}</div>}
              {adminError && <div className="ob-alert" role="alert" data-testid="onboarding-admin-request-error">{adminError}</div>}
              <button type="submit" className="btn btn-primary ob-submit" disabled={!canSubmit || !role} tabIndex={role ? 0 : -1} data-testid="onboarding-submit">
                {requestAdmin.isPending || requestSupport.isPending ? 'Sending request…' : save.isPending || done ? 'Saving…' : adminError || supportError ? 'Try again' : role === 'admin' || role === 'customer-service' ? 'Request access' : 'Save and continue'}
              </button>
            </div>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className="ob-wrap" data-testid="page-onboarding">
      <div className="ob-top">
        <div className="brand"><span className="brand-mark"><Warehouse size={18} aria-hidden="true" /></span>StockSense</div>
        <div className="ob-top-actions">
          {adminState?.isMainAdmin === true && <Link href="/admin/accounts" className="ob-link" data-testid="onboarding-admin-accounts">Admin accounts</Link>}
          {supportAdminAccess.data?.canReview === true && <Link href="/customer-service/access-requests" className="ob-link" data-testid="onboarding-access-review">Review access</Link>}
          <button type="button" className="ob-link" onClick={logout} data-testid="onboarding-signout">
            <LogOut size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 5 }} />Sign out
          </button>
        </div>
      </div>
       <main className="panel ob-card" aria-busy={q.isLoading || adminAccess.isLoading || save.isPending || requestAdmin.isPending}>
         <div className="eyebrow">{adminAccessBlocked ? 'ADMIN PORTAL / ACCESS STATUS' : 'Account setup'}</div>
         <h1 className={`ob-title${adminAccessBlocked ? ` ob-title-status ${adminAccessHeading.toLowerCase()}` : ''}`}>{adminAccessBlocked ? adminAccessHeading : role ? 'Tell us who you are.' : 'How will you use StockSense?'}</h1>
        {!q.isError && profile?.role !== 'support_staff' && !q.isLoading && !role && (
          <p className="ob-lead">Choose your role to continue. You will add your name and phone next.</p>
        )}
        {body}
      </main>
    </div>
  );
}
