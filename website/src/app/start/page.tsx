import React from 'react';
import type { Metadata } from 'next';
import HomepageContent from '../components/HomepageContent';

export const metadata: Metadata = {
  title: 'Get Started',
};

/**
 * Create/join screen — previously the homepage, now lives at /start.
 * Server component — no client state needed at this level.
 */
export default function StartPage() {
  return <HomepageContent />;
}
