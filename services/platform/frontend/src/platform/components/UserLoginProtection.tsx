import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {platformApi} from '../../../api.client';
import type {User} from '../../types';

export function UserLoginProtection({user, canManage}: {user: User; canManage: boolean}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const locked = Boolean(user.login_locked_until && new Date(user.login_locked_until).getTime() > Date.now());
  const unlock = async () => {
    setBusy(true); setMessage('');
    try {
      await platformApi.users.unlockLogin(user.id);
      await queryClient.invalidateQueries({queryKey: ['users']});
      setMessage('Login protection reset. The user can sign in again.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to unlock login.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Login protection" className="detail-summary">
    <strong>Login protection</strong>
    <span>{locked ? `Temporarily locked until ${new Date(user.login_locked_until!).toLocaleString()}` : 'Sign-in available'}</span>
    <span>{user.login_failed_attempts || 0} recent failed attempts. Five attempts pause sign-in for 15 minutes; password reset also unlocks access.</span>
    {canManage && (locked || Boolean(user.login_failed_attempts)) ? <button type="button" className="ghost-button" disabled={busy} onClick={() => void unlock()}>{busy ? 'Unlocking…' : 'Unlock login'}</button> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
