import React, { useState } from 'react';
import { Copy, Navigation, Search, Info, Share2, Check } from 'lucide-react';
import { LocationItem } from '../types';
import { useLanguage } from '../utils/i18n';
import { shareOrCopy } from '../utils/share';
import {
  ConvertResult,
  extractCoordinates,
  extractPlaceName,
  fetchWithTimeout,
  resolveFromPage,
  resolveQuery,
  wazeLink,
} from '../lib/geo';

interface ConverterProps {
  onConvert: (item: Omit<LocationItem, 'id' | 'timestamp'>) => void;
  onSelectLocation?: (item: LocationItem) => void;
}

// Used only when the backend is unavailable (e.g. static hosting) to expand short links from the browser
const CORS_PROXIES: { url: (target: string) => string; json?: boolean }[] = [
  { url: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, json: true },
  { url: (u) => `https://corsproxy.io/?${encodeURIComponent(u)}` },
  { url: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
];

async function expandViaProxies(url: string): Promise<{ resolvedUrl: string; html: string }> {
  let resolvedUrl = url;
  let html = '';
  for (const proxy of CORS_PROXIES) {
    try {
      const res = await fetchWithTimeout(proxy.url(url));
      if (!res.ok) continue;

      let pageUrl = '';
      let pageHtml = '';
      if (proxy.json) {
        const data = await res.json();
        pageUrl = data?.status?.url || '';
        pageHtml = data?.contents || '';
      } else {
        pageHtml = await res.text();
      }
      pageUrl =
        pageHtml.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i)?.[1] ||
        pageHtml.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1] ||
        pageUrl;

      if (pageUrl) resolvedUrl = pageUrl;
      if (pageHtml) html = pageHtml;
      if (extractCoordinates(resolvedUrl) || extractCoordinates(html)) break;
    } catch (err) {
      console.warn('CORS proxy resolution failed:', err);
    }
  }
  return { resolvedUrl, html };
}

async function convertLocation(input: string): Promise<ConvertResult | null> {
  const isUrl = /^https?:\/\//i.test(input);
  const directCoords = extractCoordinates(input);

  // 1. Coordinates already in the link (or typed as "lat,lng"): no network needed
  if (directCoords) {
    return {
      ...directCoords,
      title: (isUrl && extractPlaceName(input)) || 'Localização GPS',
      wazeUrl: wazeLink(directCoords.lat, directCoords.lng),
    };
  }

  // 2. Plain text address
  if (!isUrl) return resolveQuery(input);

  // 3. Backend conversion API
  try {
    const res = await fetchWithTimeout('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input }),
    }, 30000);
    if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Backend API call failed or unavailable, attempting client-side fallback:', err);
  }

  // 4. Client-side fallback (works on static platforms like Vercel)
  const { resolvedUrl, html } = /goo\.gl|maps\.app|g\.co/.test(input)
    ? await expandViaProxies(input)
    : { resolvedUrl: input, html: '' };
  return resolveFromPage(resolvedUrl, html);
}

export function Converter({ onConvert, onSelectLocation }: ConverterProps) {
  const { t } = useLanguage();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Omit<LocationItem, 'id' | 'timestamp'> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = url.trim();
    if (!input) return;
    setError('');
    setResult(null);
    setIsLoading(true);

    try {
      const data = await convertLocation(input);
      if (!data) {
        throw new Error('Não foi possível extrair coordenadas nem a morada deste link. Por favor, introduza a morada diretamente.');
      }

      const newItem = {
        title: data.title || 'Destino',
        originalUrl: url,
        wazeUrl: data.wazeUrl,
        lat: data.lat,
        lng: data.lng,
        fullAddress: data.fullAddress,
        road: data.road,
        houseNumber: data.houseNumber,
        postcode: data.postcode,
        city: data.city,
        isAddressOnly: data.isAddressOnly,
      };

      setResult(newItem);
      onConvert(newItem);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleShare = async () => {
    if (!result) return;
    const outcome = await shareOrCopy({
      title: result.title,
      text: `Navegar para ${result.title}`,
      url: result.wazeUrl,
    });
    if (outcome === 'copied') flashCopied();
  };

  const flashCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopy = async () => {
    if (result) {
      await navigator.clipboard.writeText(result.wazeUrl);
      flashCopied();
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xl">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Search className="w-4 h-4 text-cyan-600 dark:text-cyan-500" />
          {t('tabConvert')} Link
        </h2>
        <form onSubmit={handleConvert} className="space-y-4">
          <div>
            <label htmlFor="url" className="block text-xs font-bold text-slate-500 uppercase mb-3 tracking-widest">
              {t('inputLabel')}
            </label>
            <div className="flex flex-col gap-3">
              <div className="relative">
                <input
                  id="url"
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t('inputPlaceholder')}
                  className="w-full bg-slate-50 dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-800 rounded-2xl py-4 pl-5 pr-12 text-sm focus:outline-none focus:border-cyan-500 transition-colors text-slate-800 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-700 shadow-inner"
                  required
                />
                {url && (
                  <button
                    type="button"
                    onClick={() => { setUrl(''); setResult(null); setError(''); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400 dark:text-slate-500 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors bg-slate-200/50 dark:bg-slate-950/50 rounded-full"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isLoading || !url}
                className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-4 px-6 rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 uppercase tracking-widest text-xs"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  t('convertBtn')
                )}
              </button>
            </div>
          </div>
        </form>

        {error && (
          <div className="mt-4 p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 rounded-2xl text-xs uppercase tracking-wider font-bold">
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 relative overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              {result.isAddressOnly || !result.lat ? 'Navegação por Morada' : 'Navegação GPS'}
            </span>
            <span className={`text-[10px] font-bold px-2 py-1 rounded ${
              result.isAddressOnly || !result.lat 
                ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'bg-cyan-100 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-500'
            }`}>
              {result.isAddressOnly || !result.lat ? 'MORADA WAZE' : 'GPS WAZE'}
            </span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Destino</span>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">
                {result.title}
              </p>
            </div>
            {onSelectLocation && (
              <button
                onClick={() => onSelectLocation({
                  id: 'temp-' + Date.now(),
                  title: result.title,
                  originalUrl: result.originalUrl,
                  wazeUrl: result.wazeUrl,
                  lat: result.lat,
                  lng: result.lng,
                  timestamp: Date.now(),
                  fullAddress: result.fullAddress,
                  road: result.road,
                  houseNumber: result.houseNumber,
                  postcode: result.postcode,
                  city: result.city,
                  isAddressOnly: result.isAddressOnly,
                })}
                className="shrink-0 px-3 py-1.5 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 rounded-xl text-xs font-bold hover:bg-cyan-500/20 transition-colors flex items-center gap-1.5"
              >
                <Info className="w-3.5 h-3.5" />
                <span>{t('viewFullAddress')}</span>
              </button>
            )}
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 mb-6">
            <code className="text-cyan-600 dark:text-cyan-400 font-mono text-xs break-all leading-relaxed">{result.wazeUrl}</code>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <a
              href={result.wazeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-cyan-600 text-white py-3 rounded-2xl font-bold hover:bg-cyan-500 transition-colors shadow-lg shadow-cyan-900/20 text-xs uppercase"
            >
              <Navigation className="w-4 h-4" />
              {t('openWaze')}
            </a>

            <button
              onClick={handleShare}
              className="flex items-center justify-center gap-2 bg-emerald-600 text-white py-3 rounded-2xl font-bold hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-900/20 text-xs uppercase"
            >
              <Share2 className="w-4 h-4" />
              {t('share')}
            </button>
            
            <button
              onClick={handleCopy}
              className="flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 py-3 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-xs uppercase"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-500" />
                  {t('copied')}
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  {t('copy')}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
