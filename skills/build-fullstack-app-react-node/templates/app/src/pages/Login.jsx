import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { signIn, signUp, useSession } from '../api/auth';

const MIN_PASSWORD = 8; // keep equal to emailAndPassword.minPasswordLength in server/auth.js

// One page for both sign-in and sign-up. Returns the visitor to where they were headed.
export default function Login() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const from = useLocation().state?.from;
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const back = { pathname: from?.pathname ?? '/', search: from?.search };
  if (session && !submitting) return <Navigate to={back} state={from?.state} replace />;

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && !form.name.trim()) return setError('Enter your name');
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return setError('Enter a valid email');
    if (form.password.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters`);
    setSubmitting(true);
    try {
      if (mode === 'signup') await signUp({ name: form.name.trim(), email: form.email, password: form.password });
      else await signIn({ email: form.email, password: form.password });
      navigate(back, { state: from?.state, replace: true });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <form className="panel auth-panel" onSubmit={submit} noValidate>
      <h1>{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
      {from && <p className="note">Please sign in to continue.</p>}
      <div className="form-grid single">
        {mode === 'signup' && (
          <label>Name<input autoComplete="name" value={form.name} onChange={set('name')} /></label>
        )}
        <label>Email<input type="email" autoComplete="email" value={form.email} onChange={set('email')} /></label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={form.password}
            onChange={set('password')}
          />
        </label>
      </div>
      {error && <p className="alert">{error}</p>}
      <button className="btn block" disabled={submitting}>
        {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>
      <button
        type="button"
        className="link-btn"
        onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); }}
      >
        {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </form>
  );
}
