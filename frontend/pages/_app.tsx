import Head from 'next/head';
import '../styles/globals.css';
import '../styles/main.css';
import '../styles/neon-theme.css';
import '../styles/agent-sim.css';
import Providers from '../components/Providers';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>OmniVault — AI-Powered Decentralized VC</title>
      </Head>
      <Providers>
        <div className="neon-theme">
          <Component {...pageProps} />
        </div>
      </Providers>
    </>
  );
}