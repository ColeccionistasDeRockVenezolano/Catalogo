// Catálogo de agentes automáticos que CRV sabe nombrar.
//
// Portado de Herra 1.1.36 (`dist/traffic/agents.js`, idéntico en contenido a
// `herra-separacion/src/traffic/agents.ts`, que es 1.1.10) para la ventana 3.7
// (Métricas). Un agente se reconoce por su User-Agent, que cualquiera puede
// escribir. Por eso cada entrada dice también cómo se comprueba que es quien
// dice ser:
//
//   ranges  listas de IPs que el propio operador publica (ver ip-ranges.ts).
//   rdns    sufijos del DNS inverso que el operador documenta: la IP debe
//           resolver a un nombre bajo ese dominio y ese nombre, de vuelta, a la
//           misma IP (FCrDNS).
//
// Sin ninguno de los dos, el agente queda como «declarado»: se cuenta con su
// nombre, pero la interfaz no lo presenta como verificado.
//
// El orden importa: gana la primera coincidencia, así que los patrones más
// concretos (Google-CloudVertexBot) van antes que los genéricos (Googlebot).

export type AgentCategory = 'ai' | 'search' | 'bot';
// Para qué rastrea el agente, según lo documenta su operador. Es lo que decide
// una política de robots.txt: no es lo mismo entrenar un modelo que buscar.
export type AgentPurpose = 'training' | 'search' | 'user' | 'preview' | 'seo' | 'monitor' | 'tool' | 'other';

export interface AgentDef {
  key: string;
  label: string;
  operator: string;
  category: AgentCategory;
  purpose: AgentPurpose;
  pattern: RegExp;
  // Nombre con el que el agente se busca a sí mismo en robots.txt. Solo los
  // agentes que lo respetan y que la política puede permitir o bloquear.
  robotsToken?: string;
  ranges?: RangeListKey[];
  rdns?: string[];
}

// Listas de IPs publicadas por cada operador. La URL vive aquí, junto al
// agente que la usa, para que añadir un rastreador sea tocar un solo archivo.
export const RANGE_LISTS = {
  'openai-gptbot': 'https://openai.com/gptbot.json',
  'openai-searchbot': 'https://openai.com/searchbot.json',
  'openai-chatgpt-user': 'https://openai.com/chatgpt-user.json',
  anthropic: 'https://claude.com/crawling/bots.json',
  'perplexity-bot': 'https://www.perplexity.com/perplexitybot.json',
  'perplexity-user': 'https://www.perplexity.com/perplexity-user.json',
  mistral: 'https://mistral.ai/mistralai-user-ips.json',
  commoncrawl: 'https://index.commoncrawl.org/ccbot.json',
  'google-googlebot': 'https://developers.google.com/static/search/apis/ipranges/googlebot.json',
  'google-special': 'https://developers.google.com/static/search/apis/ipranges/special-crawlers.json',
  'google-user-triggered': 'https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers.json',
  'google-user-triggered-google': 'https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers-google.json',
  bing: 'https://www.bing.com/toolbox/bingbot.json',
  applebot: 'https://search.developer.apple.com/applebot.json',
  duckduckbot: 'https://duckduckgo.com/duckduckbot.json',
  duckassistbot: 'https://duckduckgo.com/duckassistbot.json',
} as const;
export type RangeListKey = keyof typeof RANGE_LISTS;

const GOOGLE_FETCHERS: RangeListKey[] = ['google-user-triggered', 'google-user-triggered-google'];

export const AGENTS: AgentDef[] = [
  // ---- Inteligencia artificial ------------------------------------------------
  { key: 'gptbot', label: 'GPTBot', operator: 'OpenAI', category: 'ai', purpose: 'training', pattern: /GPTBot/i, robotsToken: 'GPTBot', ranges: ['openai-gptbot'] },
  { key: 'oai-searchbot', label: 'OAI-SearchBot', operator: 'OpenAI', category: 'ai', purpose: 'search', pattern: /OAI-SearchBot/i, robotsToken: 'OAI-SearchBot', ranges: ['openai-searchbot'] },
  { key: 'chatgpt-user', label: 'ChatGPT-User', operator: 'OpenAI', category: 'ai', purpose: 'user', pattern: /ChatGPT-User/i, robotsToken: 'ChatGPT-User', ranges: ['openai-chatgpt-user'] },
  { key: 'claudebot', label: 'ClaudeBot', operator: 'Anthropic', category: 'ai', purpose: 'training', pattern: /ClaudeBot/i, robotsToken: 'ClaudeBot', ranges: ['anthropic'] },
  { key: 'claude-searchbot', label: 'Claude-SearchBot', operator: 'Anthropic', category: 'ai', purpose: 'search', pattern: /Claude-SearchBot/i, robotsToken: 'Claude-SearchBot', ranges: ['anthropic'] },
  { key: 'claude-user', label: 'Claude-User', operator: 'Anthropic', category: 'ai', purpose: 'user', pattern: /Claude-User/i, robotsToken: 'Claude-User', ranges: ['anthropic'] },
  { key: 'anthropic-ai', label: 'anthropic-ai', operator: 'Anthropic', category: 'ai', purpose: 'training', pattern: /anthropic-ai/i, robotsToken: 'anthropic-ai', ranges: ['anthropic'] },
  { key: 'perplexitybot', label: 'PerplexityBot', operator: 'Perplexity', category: 'ai', purpose: 'search', pattern: /PerplexityBot/i, robotsToken: 'PerplexityBot', ranges: ['perplexity-bot'] },
  { key: 'perplexity-user', label: 'Perplexity-User', operator: 'Perplexity', category: 'ai', purpose: 'user', pattern: /Perplexity-User/i, robotsToken: 'Perplexity-User', ranges: ['perplexity-user'] },
  { key: 'google-cloudvertexbot', label: 'Google-CloudVertexBot', operator: 'Google', category: 'ai', purpose: 'training', pattern: /Google-CloudVertexBot/i, robotsToken: 'Google-CloudVertexBot', ranges: ['google-special'], rdns: ['google.com'] },
  { key: 'google-notebooklm', label: 'Google-NotebookLM', operator: 'Google', category: 'ai', purpose: 'user', pattern: /Google-NotebookLM/i, ranges: GOOGLE_FETCHERS, rdns: ['googleusercontent.com', 'google.com'] },
  { key: 'gemini-deep-research', label: 'Gemini-Deep-Research', operator: 'Google', category: 'ai', purpose: 'user', pattern: /Gemini-Deep-Research/i, ranges: GOOGLE_FETCHERS, rdns: ['googleusercontent.com', 'google.com'] },
  { key: 'mistralai-user', label: 'MistralAI-User', operator: 'Mistral AI', category: 'ai', purpose: 'user', pattern: /MistralAI-User/i, robotsToken: 'MistralAI-User', ranges: ['mistral'] },
  { key: 'duckassistbot', label: 'DuckAssistBot', operator: 'DuckDuckGo', category: 'ai', purpose: 'search', pattern: /DuckAssistBot/i, robotsToken: 'DuckAssistBot', ranges: ['duckassistbot'] },
  { key: 'ccbot', label: 'CCBot', operator: 'Common Crawl', category: 'ai', purpose: 'training', pattern: /CCBot/i, robotsToken: 'CCBot', ranges: ['commoncrawl'] },
  { key: 'amazonbot', label: 'Amazonbot', operator: 'Amazon', category: 'ai', purpose: 'training', pattern: /Amazonbot/i, robotsToken: 'Amazonbot', rdns: ['crawl.amazonbot.amazon'] },
  { key: 'bytespider', label: 'Bytespider', operator: 'ByteDance', category: 'ai', purpose: 'training', pattern: /Bytespider/i, robotsToken: 'Bytespider' },
  { key: 'meta-externalagent', label: 'meta-externalagent', operator: 'Meta', category: 'ai', purpose: 'training', pattern: /meta-externalagent/i, robotsToken: 'meta-externalagent' },
  { key: 'meta-externalfetcher', label: 'meta-externalfetcher', operator: 'Meta', category: 'ai', purpose: 'user', pattern: /meta-externalfetcher/i, robotsToken: 'meta-externalfetcher' },
  { key: 'youbot', label: 'YouBot', operator: 'You.com', category: 'ai', purpose: 'search', pattern: /YouBot/i, robotsToken: 'YouBot' },
  { key: 'cohere-ai', label: 'cohere-ai', operator: 'Cohere', category: 'ai', purpose: 'training', pattern: /cohere-(?:ai|training-data-crawler)/i, robotsToken: 'cohere-ai' },
  { key: 'ai2bot', label: 'AI2Bot', operator: 'Allen Institute for AI', category: 'ai', purpose: 'training', pattern: /AI2Bot/i, robotsToken: 'AI2Bot' },
  { key: 'diffbot', label: 'Diffbot', operator: 'Diffbot', category: 'ai', purpose: 'training', pattern: /Diffbot/i, robotsToken: 'Diffbot' },
  { key: 'timpibot', label: 'Timpibot', operator: 'Timpi', category: 'ai', purpose: 'training', pattern: /Timpibot/i, robotsToken: 'Timpibot' },
  { key: 'pangubot', label: 'PanguBot', operator: 'Huawei', category: 'ai', purpose: 'training', pattern: /PanguBot/i, robotsToken: 'PanguBot' },
  { key: 'img2dataset', label: 'img2dataset', operator: 'LAION', category: 'ai', purpose: 'training', pattern: /img2dataset/i, robotsToken: 'img2dataset' },

  // ---- Buscadores -------------------------------------------------------------
  { key: 'googlebot', label: 'Googlebot', operator: 'Google', category: 'search', purpose: 'search', pattern: /Googlebot|Google-InspectionTool|Storebot-Google/i, robotsToken: 'Googlebot', ranges: ['google-googlebot'], rdns: ['googlebot.com', 'google.com'] },
  { key: 'googleother', label: 'GoogleOther', operator: 'Google', category: 'search', purpose: 'other', pattern: /GoogleOther|AdsBot-Google|Mediapartners-Google|APIs-Google/i, robotsToken: 'GoogleOther', ranges: ['google-special'], rdns: ['google.com'] },
  { key: 'google-fetcher', label: 'Google (fetchers)', operator: 'Google', category: 'search', purpose: 'user', pattern: /FeedFetcher-Google|Google-Site-Verification|Google-Read-Aloud|Google-Safety/i, ranges: GOOGLE_FETCHERS, rdns: ['googleusercontent.com', 'google.com'] },
  { key: 'bingbot', label: 'Bingbot', operator: 'Microsoft', category: 'search', purpose: 'search', pattern: /bingbot|BingPreview|adidxbot|MicrosoftPreview/i, robotsToken: 'Bingbot', ranges: ['bing'], rdns: ['search.msn.com'] },
  { key: 'applebot', label: 'Applebot', operator: 'Apple', category: 'search', purpose: 'search', pattern: /Applebot/i, robotsToken: 'Applebot', ranges: ['applebot'], rdns: ['applebot.apple.com'] },
  { key: 'duckduckbot', label: 'DuckDuckBot', operator: 'DuckDuckGo', category: 'search', purpose: 'search', pattern: /DuckDuckBot/i, robotsToken: 'DuckDuckBot', ranges: ['duckduckbot'] },
  { key: 'yandexbot', label: 'YandexBot', operator: 'Yandex', category: 'search', purpose: 'search', pattern: /YandexBot|YandexMobileBot|YandexImages|YandexRenderResourcesBot|YandexAdNet/i, robotsToken: 'Yandex', rdns: ['yandex.ru', 'yandex.net', 'yandex.com'] },
  { key: 'baiduspider', label: 'Baiduspider', operator: 'Baidu', category: 'search', purpose: 'search', pattern: /Baiduspider/i, robotsToken: 'Baiduspider', rdns: ['baidu.com', 'baidu.jp'] },
  { key: 'petalbot', label: 'PetalBot', operator: 'Huawei', category: 'search', purpose: 'search', pattern: /PetalBot/i, robotsToken: 'PetalBot', rdns: ['petalsearch.com'] },
  { key: 'seznambot', label: 'SeznamBot', operator: 'Seznam', category: 'search', purpose: 'search', pattern: /SeznamBot/i, robotsToken: 'SeznamBot', rdns: ['seznam.cz'] },
  { key: 'naver-yeti', label: 'Yeti', operator: 'Naver', category: 'search', purpose: 'search', pattern: /\bYeti\//, robotsToken: 'Yeti', rdns: ['naver.com'] },
  { key: 'mojeekbot', label: 'MojeekBot', operator: 'Mojeek', category: 'search', purpose: 'search', pattern: /MojeekBot/i, robotsToken: 'MojeekBot' },
  { key: 'qwantbot', label: 'Qwantbot', operator: 'Qwant', category: 'search', purpose: 'search', pattern: /Qwantbot|Qwantify/i, robotsToken: 'Qwantbot' },

  // ---- Otros automatismos -----------------------------------------------------
  { key: 'facebook-preview', label: 'facebookexternalhit', operator: 'Meta', category: 'bot', purpose: 'preview', pattern: /facebookexternalhit|facebookcatalog/i },
  { key: 'twitterbot', label: 'Twitterbot', operator: 'X', category: 'bot', purpose: 'preview', pattern: /Twitterbot/i },
  { key: 'linkedinbot', label: 'LinkedInBot', operator: 'LinkedIn', category: 'bot', purpose: 'preview', pattern: /LinkedInBot/i },
  { key: 'slackbot', label: 'Slackbot', operator: 'Slack', category: 'bot', purpose: 'preview', pattern: /Slackbot|Slack-ImgProxy/i },
  { key: 'discordbot', label: 'Discordbot', operator: 'Discord', category: 'bot', purpose: 'preview', pattern: /Discordbot/i },
  { key: 'telegrambot', label: 'TelegramBot', operator: 'Telegram', category: 'bot', purpose: 'preview', pattern: /TelegramBot/i },
  { key: 'whatsapp', label: 'WhatsApp', operator: 'Meta', category: 'bot', purpose: 'preview', pattern: /WhatsApp\//i },
  { key: 'pinterestbot', label: 'Pinterestbot', operator: 'Pinterest', category: 'bot', purpose: 'preview', pattern: /Pinterest(?:bot)?\//i },
  { key: 'redditbot', label: 'redditbot', operator: 'Reddit', category: 'bot', purpose: 'preview', pattern: /redditbot/i },
  { key: 'skype-preview', label: 'SkypeUriPreview', operator: 'Microsoft', category: 'bot', purpose: 'preview', pattern: /SkypeUriPreview/i },
  { key: 'embedly', label: 'Embedly', operator: 'Embedly', category: 'bot', purpose: 'preview', pattern: /Embedly|Iframely/i },
  { key: 'ahrefsbot', label: 'AhrefsBot', operator: 'Ahrefs', category: 'bot', purpose: 'seo', pattern: /AhrefsBot|AhrefsSiteAudit/i },
  { key: 'semrushbot', label: 'SemrushBot', operator: 'Semrush', category: 'bot', purpose: 'seo', pattern: /SemrushBot|SiteAuditBot/i },
  { key: 'mj12bot', label: 'MJ12bot', operator: 'Majestic', category: 'bot', purpose: 'seo', pattern: /MJ12bot/i },
  { key: 'dotbot', label: 'DotBot', operator: 'Moz', category: 'bot', purpose: 'seo', pattern: /DotBot|rogerbot/i },
  { key: 'dataforseobot', label: 'DataForSeoBot', operator: 'DataForSEO', category: 'bot', purpose: 'seo', pattern: /DataForSeoBot/i },
  { key: 'blexbot', label: 'BLEXBot', operator: 'WebMeUp', category: 'bot', purpose: 'seo', pattern: /BLEXBot/i },
  { key: 'serpstatbot', label: 'serpstatbot', operator: 'Serpstat', category: 'bot', purpose: 'seo', pattern: /serpstatbot/i },
  { key: 'screaming-frog', label: 'Screaming Frog', operator: 'Screaming Frog', category: 'bot', purpose: 'seo', pattern: /Screaming Frog/i },
  { key: 'uptimerobot', label: 'UptimeRobot', operator: 'UptimeRobot', category: 'bot', purpose: 'monitor', pattern: /UptimeRobot/i },
  { key: 'pingdom', label: 'Pingdom', operator: 'SolarWinds', category: 'bot', purpose: 'monitor', pattern: /Pingdom/i },
  { key: 'betterstack', label: 'Better Stack', operator: 'Better Stack', category: 'bot', purpose: 'monitor', pattern: /Better ?Uptime|BetterStack/i },
  { key: 'statuscake', label: 'StatusCake', operator: 'StatusCake', category: 'bot', purpose: 'monitor', pattern: /StatusCake/i },
  // Lighthouse y PageSpeed ejecutan JavaScript de verdad: sin esta entrada, cada
  // auditoría sumaría una «persona» al contador.
  { key: 'lighthouse', label: 'Lighthouse / PageSpeed', operator: 'Google', category: 'bot', purpose: 'monitor', pattern: /Chrome-Lighthouse|\bLighthouse\b|Google-PageSpeed/i },
  { key: 'gtmetrix', label: 'GTmetrix', operator: 'GTmetrix', category: 'bot', purpose: 'monitor', pattern: /GTmetrix/i },
  { key: 'webpagetest', label: 'WebPageTest', operator: 'Catchpoint', category: 'bot', purpose: 'monitor', pattern: /\bPTST\/|WebPageTest/i },
  { key: 'headless-browser', label: 'Navegador sin interfaz', operator: '—', category: 'bot', purpose: 'tool', pattern: /HeadlessChrome|PhantomJS|SlimerJS|Electron\//i },
  { key: 'curl', label: 'curl', operator: '—', category: 'bot', purpose: 'tool', pattern: /^curl\//i },
  { key: 'wget', label: 'Wget', operator: '—', category: 'bot', purpose: 'tool', pattern: /^Wget\//i },
  { key: 'python', label: 'Python', operator: '—', category: 'bot', purpose: 'tool', pattern: /python-requests|python-urllib|aiohttp|httpx|Scrapy/i },
  { key: 'go-http', label: 'Go', operator: '—', category: 'bot', purpose: 'tool', pattern: /Go-http-client/i },
  { key: 'node-http', label: 'Node.js', operator: '—', category: 'bot', purpose: 'tool', pattern: /^node(?:-fetch)?(?:\/|$)|^undici|axios\/|\bgot\b \(/i },
  { key: 'java-http', label: 'Java', operator: '—', category: 'bot', purpose: 'tool', pattern: /^Java\/|okhttp|Apache-HttpClient/i },
  { key: 'php-http', label: 'PHP', operator: '—', category: 'bot', purpose: 'tool', pattern: /GuzzleHttp|^PHP\//i },
  { key: 'postman', label: 'Postman', operator: 'Postman', category: 'bot', purpose: 'tool', pattern: /PostmanRuntime|insomnia\//i },
];

// Tokens de robots.txt que no pertenecen a un rastreador propio: Google y Apple
// los usan para decidir si lo que ya rastrearon sus buscadores alimenta además
// sus modelos. Nunca aparecen en un User-Agent, pero la política debe poder
// bloquearlos igual.
export interface RobotsOnlyToken { key: string; label: string; operator: string; category: 'ai'; purpose: AgentPurpose; robotsToken: string }
export const ROBOTS_ONLY_TOKENS: RobotsOnlyToken[] = [
  { key: 'google-extended', label: 'Google-Extended', operator: 'Google', category: 'ai', purpose: 'training', robotsToken: 'Google-Extended' },
  { key: 'applebot-extended', label: 'Applebot-Extended', operator: 'Apple', category: 'ai', purpose: 'training', robotsToken: 'Applebot-Extended' },
];

// Agentes con nombre fuera del catálogo: vienen de la lista mantenida de isbot
// o de una firma HTTP. Cualquier otra clave se rechaza al leer la base.
export const OTHER_BOT_KEY = 'other-bot';
export const NO_USER_AGENT_KEY = 'no-user-agent';
export const SIGNED_AGENT_KEY = 'signed-agent';
export const CHATGPT_AGENT_KEY = 'chatgpt-agent';

export interface AgentInfo { key: string; label: string; operator: string; category: AgentCategory; purpose: AgentPurpose; verifiable: boolean; robotsToken: string | null }

const EXTRA_AGENTS: AgentInfo[] = [
  { key: CHATGPT_AGENT_KEY, label: 'ChatGPT agent', operator: 'OpenAI', category: 'ai', purpose: 'user', verifiable: false, robotsToken: null },
  { key: SIGNED_AGENT_KEY, label: 'Agente con firma HTTP', operator: '—', category: 'ai', purpose: 'user', verifiable: false, robotsToken: null },
  { key: OTHER_BOT_KEY, label: 'Otros bots', operator: '—', category: 'bot', purpose: 'other', verifiable: false, robotsToken: null },
  { key: NO_USER_AGENT_KEY, label: 'Sin User-Agent', operator: '—', category: 'bot', purpose: 'tool', verifiable: false, robotsToken: null },
];

const AGENT_INFO = new Map<string, AgentInfo>([
  ...AGENTS.map(agent => [agent.key, {
    key: agent.key, label: agent.label, operator: agent.operator, category: agent.category, purpose: agent.purpose,
    verifiable: Boolean(agent.ranges?.length || agent.rdns?.length), robotsToken: agent.robotsToken ?? null,
  }] as const),
  ...EXTRA_AGENTS.map(agent => [agent.key, agent] as const),
]);

export function agentInfo(key: string): AgentInfo | null {
  return AGENT_INFO.get(key) ?? null;
}

export function agentDef(key: string): AgentDef | null {
  return AGENTS.find(agent => agent.key === key) ?? null;
}

export function matchAgent(userAgent: string): AgentDef | null {
  if (!userAgent) return null;
  for (const agent of AGENTS) if (agent.pattern.test(userAgent)) return agent;
  return null;
}
