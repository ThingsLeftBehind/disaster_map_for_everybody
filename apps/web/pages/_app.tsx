import type { AppProps } from 'next/app';
import { useEffect } from 'react';
import '../styles/globals.css';
import 'leaflet/dist/leaflet.css';
import Layout from '../components/Layout';
import { DeviceProvider } from '../components/device/DeviceProvider';

function MyApp({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // PWA support is helpful, but page rendering must not depend on it.
    });
  }, []);

  return (
    <DeviceProvider>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </DeviceProvider>
  );
}

export default MyApp;
