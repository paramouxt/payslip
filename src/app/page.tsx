import { redirect } from 'next/navigation';
import { auth } from '@/server/auth/config';

export default async function Home() {
  const session = await auth();
  redirect(session?.user ? '/dashboard' : '/sign-in');
}
