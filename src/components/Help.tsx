import React from 'react';
import { Link, MapPin, Star, Clock, Share2, Compass } from 'lucide-react';
import { useLanguage, TranslationKeys } from '../utils/i18n';

const HELP_ITEMS: { icon: typeof Link; color: string; title: TranslationKeys; desc: TranslationKeys }[] = [
  { icon: Link, color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400', title: 'help1Title', desc: 'help1Desc' },
  { icon: MapPin, color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', title: 'help2Title', desc: 'help2Desc' },
  { icon: Share2, color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', title: 'help3Title', desc: 'help3Desc' },
  { icon: Star, color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', title: 'help4Title', desc: 'help4Desc' },
  { icon: Clock, color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400', title: 'help5Title', desc: 'help5Desc' },
  { icon: Compass, color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400', title: 'help6Title', desc: 'help6Desc' },
];

export function Help() {
  const { t } = useLanguage();

  return (
    <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 flex flex-col shadow-xl space-y-4">
      <div className="text-center mb-2 flex flex-col items-center">
        <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 mb-2 tracking-wider">
          Beta v1.0.0
        </span>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('helpTitle')}</h3>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-1">
          {t('helpSubtitle')}
        </p>
      </div>

      {HELP_ITEMS.map(({ icon: Icon, color, title, desc }) => (
        <div key={title} className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-start gap-3">
          <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-1">
              {t(title)}
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {t(desc)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
