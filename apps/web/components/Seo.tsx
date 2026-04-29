import Head from 'next/head';
import { useRouter } from 'next/router';

const SITE_NAME = '避難ナビ（HinaNavi）';
const DEFAULT_TITLE = '避難ナビ（HinaNavi） | 災害から身を守る避難を';
const DEFAULT_DESCRIPTION =
  '避難ナビ（HinaNavi）は、全国の避難場所検索、警報・注意報、地震情報、ハザードマップをまとめた防災支援サイトです。現在地周辺の避難所を素早く確認し、災害時の判断と行動を支援します。避難所の保存や共有にも対応します。';

type Props = {
  title?: string | null;
  description?: string | null;
  canonicalPath?: string | null;
};

function normalizePath(path: string): string {
  const trimmed = path.split('?')[0]?.split('#')[0] ?? '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function Seo({ title, description, canonicalPath }: Props) {
  const router = useRouter();
  const path = canonicalPath ?? router.asPath ?? '/';
  const canonical = `https://www.hinanavi.com${normalizePath(path)}`;
  const pageTitle = title ? `${title} | ${SITE_NAME}` : DEFAULT_TITLE;
  const pageDescription = description ?? DEFAULT_DESCRIPTION;

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    alternateName: ['避難ナビ', 'HinaNavi'],
    url: 'https://www.hinanavi.com/',
  };

  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'HinaNavi',
    url: 'https://www.hinanavi.com/',
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'contact@hinanavi.com',
      },
    ],
  };

  return (
    <Head>
      <title>{pageTitle}</title>
      <meta name="description" content={pageDescription} />
      <link rel="canonical" href={canonical} />
      <meta name="robots" content="index,follow" />
      <meta name="theme-color" content="#0f172a" />

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={pageDescription} />
      <meta property="og:url" content={canonical} />
      <meta property="og:type" content="website" />

      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={pageDescription} />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
    </Head>
  );
}
