import { redirect } from 'next/navigation';

/**
 * Root → /dashboard. Middleware will bounce to /auth/login if there's
 * no session cookie. Sprint 0's palette landing has been retired.
 */
export default function Home() {
  redirect('/dashboard');
}
