import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta name="description" content="OmniVault is a decentralized venture capital fund powered by multi-agent AI auditing." />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/png" href="/logo.png" sizes="512x512" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
