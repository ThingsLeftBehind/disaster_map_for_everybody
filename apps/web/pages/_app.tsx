import type { AppProps } from 'next/app';
import '../styles/globals.css';
import 'leaflet/dist/leaflet.css';
import Layout from '../components/Layout';
import { DeviceProvider } from '../components/device/DeviceProvider';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <DeviceProvider>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </DeviceProvider>
  );
}

export default MyApp;
