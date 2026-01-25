import NextAuth from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import Nodemailer from 'next-auth/providers/nodemailer';
import { db } from '@/lib/db/client';
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from '@/lib/db/schema';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Nodemailer({
      server: process.env.EMAIL_SERVER || {
        host: 'localhost',
        port: 1025,
        auth: {
          user: '',
          pass: '',
        },
      },
      from: process.env.EMAIL_FROM || 'noreply@autonomous-teams.local',
      ...(process.env.NODE_ENV === 'development' && {
        sendVerificationRequest: async ({ identifier: email, url }) => {
          // In development, log magic link to console instead of sending email
          console.log('\n========================================');
          console.log('MAGIC LINK LOGIN');
          console.log('========================================');
          console.log(`Email: ${email}`);
          console.log(`URL: ${url}`);
          console.log('========================================\n');
        },
      }),
    }),
  ],
  session: {
    strategy: 'database',
  },
  pages: {
    signIn: '/auth/signin',
    verifyRequest: '/auth/verify-request',
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});
