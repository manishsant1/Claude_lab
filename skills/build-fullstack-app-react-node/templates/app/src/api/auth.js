// Sign-in state for the browser, via Better Auth's React client. The server sets an httpOnly
// session cookie; nothing secret is stored in JS or localStorage. Same origin, so no baseURL.
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();
export const { useSession } = authClient;

// Better Auth returns { data, error } instead of throwing; these throw so pages can try/catch.
async function unwrap(promise, fallback) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || fallback);
  return data;
}

export const signUp = ({ name, email, password }) =>
  unwrap(authClient.signUp.email({ name, email, password }), 'Could not create the account');
export const signIn = ({ email, password }) =>
  unwrap(authClient.signIn.email({ email, password }), 'Could not sign in');
export const signOut = () => unwrap(authClient.signOut(), 'Could not sign out');
