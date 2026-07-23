/**
 * OpenMusic 站点 SEO 文案与 robots/sitemap 生成。
 * 客户端 / Vite / Node 共用，禁止引入 Node 专属 API。
 *
 * 只写正常人会搜的口语词；标题短、自然；FAQ 精简，不堆砌。
 */

export const SITE_NAME = 'OpenMusic';

/** 口语主词在前，场景清楚，品牌在后 */
export const DEFAULT_TITLE = '一起听歌 - 和喜欢的人 听同一首歌 | OpenMusic';

export const DEFAULT_DESCRIPTION =
  '想和朋友一起听歌？OpenMusic 免费在线一起听歌：创建房间就能和朋友、情侣同步听歌、共同点歌、边听边聊。异地远程、宿舍聚会也方便。';

/** 真人会搜的词靠前；别塞生造词 */
export const DEFAULT_KEYWORDS =
  '一起听歌,多人听歌,和朋友一起听歌,在线一起听歌,两个人一起听歌,情侣一起听歌,异地一起听歌,同步听歌,好友一起听歌,远程一起听歌,宿舍一起听歌,免费一起听歌,点歌房,在线点歌,OpenMusic,一起听歌吧';

export const DEFAULT_HERO_HEADLINE = '和喜欢的人';
export const DEFAULT_HERO_SUBLINE = '听同一首歌';
export const DEFAULT_ABOUT_TITLE = '和喜欢的人听同一首歌，就用 OpenMusic';
export const DEFAULT_ABOUT_TEXT =
  'OpenMusic 是免费的一起听歌网站。网页建房，邀请好友进来，就能多人一起听歌、听同一首歌、一起点歌。适合情侣、室友、远方的朋友。';

export const FEATURE_LIST = [
  '和朋友一起听歌，进度同步',
  '两个人或多人都能点歌',
  '异地远程也能听同一首歌',
  '宿舍聚会、边听边聊都行',
];

/** 精简 FAQ：只覆盖最高频口语问法 */
export const SEO_FAQS = [
  {
    q: '怎么和朋友一起听歌？',
    a: '打开 OpenMusic 创建房间，把房间号发给朋友。对方加入后就能一起听歌、同步播放、共同点歌。',
  },
  {
    q: '异地怎么一起听歌？',
    a: '双方进同一个在线听歌房间即可。歌曲进度同步，适合情侣、朋友远程陪伴。',
  },
  {
    q: '两个人怎么听同一首歌？',
    a: '创建房间后邀请对方加入。两个人一起听歌时进度一致，还能轮流点歌、边听边聊。',
  },
];

/** 可收录的静态路径（不含 /room /tv /admin） */
export const INDEXABLE_PATHS = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
];

/** SEO 字段默认值（后台留空时回退） */
export function getSeoDefaults() {
  return {
    seoTitle: DEFAULT_TITLE,
    seoDescription: DEFAULT_DESCRIPTION,
    seoKeywords: DEFAULT_KEYWORDS,
    seoSiteName: SITE_NAME,
    seoCanonicalUrl: '',
    seoBaiduVerification: '',
    seoOgImage: '/og-cover.png',
    seoHeroHeadline: DEFAULT_HERO_HEADLINE,
    seoHeroSubline: DEFAULT_HERO_SUBLINE,
    seoAboutTitle: DEFAULT_ABOUT_TITLE,
    seoAboutText: DEFAULT_ABOUT_TEXT,
  };
}

/**
 * @param {Record<string, unknown>} [config]
 */
export function buildPublicSiteSeo(config = {}) {
  const d = getSeoDefaults();
  const pick = (key, maxLen) => {
    const raw = String(config[key] ?? '').trim();
    if (!raw) return d[key];
    return maxLen ? raw.slice(0, maxLen) : raw;
  };
  const ogImage = pick('seoOgImage', 500);
  return {
    siteName: pick('seoSiteName', 80),
    title: pick('seoTitle', 120),
    description: pick('seoDescription', 300),
    keywords: pick('seoKeywords', 400),
    canonicalUrl: String(config.seoCanonicalUrl || '').trim().replace(/\/$/, ''),
    baiduVerification: String(config.seoBaiduVerification || '').trim().slice(0, 120),
    ogImage: ogImage.startsWith('/') || /^https?:\/\//i.test(ogImage) ? ogImage : d.seoOgImage,
    heroHeadline: pick('seoHeroHeadline', 40),
    heroSubline: pick('seoHeroSubline', 80),
    aboutTitle: pick('seoAboutTitle', 80),
    aboutText: pick('seoAboutText', 800),
    featureList: FEATURE_LIST,
    faqs: SEO_FAQS,
  };
}

/**
 * @param {string | Iterable<string> | null | undefined} allowedOrigins
 * @param {string} [canonicalEnv]
 */
export function resolvePrimarySiteOrigin(allowedOrigins, canonicalEnv = '') {
  const fromEnv = String(canonicalEnv || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;

  if (typeof allowedOrigins === 'string') {
    const first = allowedOrigins.split(',')[0]?.trim().replace(/\/$/, '');
    if (first) return first;
    return '';
  }

  if (allowedOrigins && typeof allowedOrigins[Symbol.iterator] === 'function') {
    const list = [...allowedOrigins];
    if (list.length > 0) return String(list[0]).replace(/\/$/, '');
  }

  return '';
}

/**
 * @param {import('express').Request} req
 * @param {Set<string> | string[] | null | undefined} allowedOrigins
 * @param {{ canonicalEnv?: string }} [opts]
 */
export function resolveSiteOrigin(req, allowedOrigins, opts = {}) {
  const primary = resolvePrimarySiteOrigin(allowedOrigins, opts.canonicalEnv);
  if (primary) return primary;

  const forwardedProto = req.get?.('x-forwarded-proto') || req.headers?.['x-forwarded-proto'];
  const proto = (
    (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : '')
    || req.protocol
    || 'http'
  );
  const forwardedHost = req.get?.('x-forwarded-host') || req.headers?.['x-forwarded-host'];
  const host = (
    (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0].trim() : '')
    || req.get?.('host')
    || req.headers?.host
    || 'localhost'
  );
  return `${proto}://${host}`.replace(/\/$/, '');
}

/** @param {import('http').IncomingMessage} req */
export function resolveDevSiteOrigin(req) {
  const host = req.headers.host || 'localhost:5173';
  return `http://${host}`.replace(/\/$/, '');
}

export function buildRobotsTxt(siteOrigin) {
  const origin = String(siteOrigin || '').replace(/\/$/, '');
  return [
    '# OpenMusic · 一起听歌',
    'User-agent: *',
    'Allow: /',
    '',
    '# 动态会话页不参与收录',
    'Disallow: /room/',
    'Disallow: /tv/',
    '',
    'User-agent: Baiduspider',
    'Allow: /',
    'Disallow: /room/',
    'Disallow: /tv/',
    '',
    'User-agent: Googlebot',
    'Allow: /',
    'Disallow: /room/',
    'Disallow: /tv/',
    '',
    'User-agent: Sogou web spider',
    'Allow: /',
    'Disallow: /room/',
    'Disallow: /tv/',
    '',
    'User-agent: 360Spider',
    'Allow: /',
    'Disallow: /room/',
    'Disallow: /tv/',
    '',
    origin ? `Sitemap: ${origin}/sitemap.xml` : 'Sitemap: /sitemap.xml',
    '',
  ].join('\n');
}

/**
 * @param {string} siteOrigin
 * @param {{ lastmod?: string }} [opts]
 */
export function buildSitemapXml(siteOrigin, opts = {}) {
  const origin = String(siteOrigin || '').replace(/\/$/, '');
  const lastmod = opts.lastmod || new Date().toISOString().slice(0, 10);
  const urls = INDEXABLE_PATHS.map((item) => {
    const loc = `${origin}${item.path === '/' ? '/' : item.path}`;
    return [
      '  <url>',
      `    <loc>${loc}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      `    <changefreq>${item.changefreq}</changefreq>`,
      `    <priority>${item.priority}</priority>`,
      '  </url>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * @param {string} [origin]
 * @param {ReturnType<typeof buildPublicSiteSeo>} [seo]
 */
export function buildWebApplicationJsonLd(origin = '', seo = buildPublicSiteSeo()) {
  const clean = String(origin || '').replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: seo.siteName || SITE_NAME,
    alternateName: ['一起听歌', '多人听歌', '和朋友一起听歌', '点歌房'],
    description: seo.description || DEFAULT_DESCRIPTION,
    ...(clean ? { url: `${clean}/` } : {}),
    applicationCategory: 'MusicApplication',
    operatingSystem: 'Web Browser',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'CNY',
    },
    inLanguage: 'zh-CN',
    featureList: seo.featureList || FEATURE_LIST,
    publisher: {
      '@type': 'Organization',
      name: seo.siteName || SITE_NAME,
      ...(clean ? { url: `${clean}/` } : {}),
    },
  };
}

/** @param {typeof SEO_FAQS} [faqs] */
export function buildFaqJsonLd(faqs = SEO_FAQS) {
  const list = Array.isArray(faqs) && faqs.length ? faqs : SEO_FAQS;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: list.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  };
}

/**
 * @param {string} html
 * @param {string} siteOrigin
 */
export function applySiteOriginToHtml(html, siteOrigin) {
  const origin = String(siteOrigin || '').replace(/\/$/, '');
  if (!origin || !html) return html;
  return html.split('__SITE_ORIGIN__').join(origin);
}

/**
 * 百度站长要求标签字面量与平台一致（含自闭合 `/`）。
 * 只保留安全字符，避免写进 HTML 属性。
 * @param {string} [code]
 */
export function sanitizeBaiduVerificationCode(code) {
  const raw = String(code || '').trim();
  if (!raw) return '';
  const matched = raw.match(/content\s*=\s*["']([^"']+)["']/i);
  const value = (matched?.[1] || raw).trim();
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : '';
}

/**
 * 严格按搜索资源平台示例输出，勿改格式。
 * @param {string} [code]
 */
export function buildBaiduVerificationMeta(code) {
  const value = sanitizeBaiduVerificationCode(code);
  if (!value) return '';
  return `<meta name="baidu-site-verification" content="${value}" />`;
}

const BAIDU_META_RE = /<meta\s+name=["']baidu-site-verification["']\s+content=["'][^"']*["']\s*\/?\s*>/gi;
const BAIDU_PLACEHOLDER = '<!-- __BAIDU_SITE_VERIFICATION__ -->';

/**
 * @param {string} html
 * @param {{ siteOrigin?: string, baiduVerification?: string }} [opts]
 */
export function applySeoToHtml(html, opts = {}) {
  if (!html) return html;
  let out = applySiteOriginToHtml(html, opts.siteOrigin);
  const meta = buildBaiduVerificationMeta(opts.baiduVerification);
  // 先清掉旧标签，再写入占位符位置，保证源码里是百度要求的完整一行
  out = out.replace(BAIDU_META_RE, '');
  if (out.includes(BAIDU_PLACEHOLDER)) {
    out = out.split(BAIDU_PLACEHOLDER).join(meta ? `${BAIDU_PLACEHOLDER}\n    ${meta}` : BAIDU_PLACEHOLDER);
  } else if (meta) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>\n    ${meta}`);
  }
  return out;
}
