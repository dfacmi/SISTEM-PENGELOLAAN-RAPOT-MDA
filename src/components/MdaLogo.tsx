import React from 'react';

export const MdaLogo: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  customLogoUrl?: string;
  className?: string;
}> = ({ size = 'md', customLogoUrl = '', className = '' }) => {
  const logoDims =
    size === 'sm'
      ? 'h-8 max-w-[160px]'
      : size === 'lg'
        ? 'h-12 max-w-[230px]'
        : 'h-10 max-w-[190px]';

  const trimmedCustom = customLogoUrl ? customLogoUrl.trim() : '';
  const logoSrc = trimmedCustom !== '' ? trimmedCustom : '/mda-logo-official.png';

  return (
    <div
      className={`inline-flex items-center justify-center select-none leading-none ${className}`}
    >
      <img
        src={logoSrc}
        alt="Muslim Digital Academy"
        referrerPolicy="no-referrer"
        onError={(e) => {
          const img = e.currentTarget;
          if (!img.src.endsWith('/mda-logo-official.png')) {
            img.src = '/mda-logo-official.png';
          }
        }}
        className={`${logoDims} w-auto block shrink-0 object-contain object-center`}
      />
    </div>
  );
};

export const StudentAvatar: React.FC<{
  name: string;
  fotoUrl?: string;
  className?: string;
}> = ({ name, fotoUrl, className = 'w-12 h-12' }) => {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

  if (fotoUrl && fotoUrl.trim() !== '') {
    return (
      <img
        src={fotoUrl}
        alt={name}
        referrerPolicy="no-referrer"
        className={`object-cover rounded-xl border border-slate-200 bg-slate-100 ${className}`}
      />
    );
  }

  return (
    <div
      className={`rounded-xl bg-gradient-to-br from-emerald-600 via-teal-600 to-sky-600 text-white font-display font-bold flex items-center justify-center border border-emerald-700/20 select-none ${className}`}
    >
      <span>{initials || 'MS'}</span>
    </div>
  );
};

export const PortfolioArtwork: React.FC<{
  preset?: 'poster' | 'uiux' | 'photo' | 'video';
  title: string;
  className?: string;
}> = ({ preset = 'poster', title, className = '' }) => {
  if (preset === 'uiux') {
    return (
      <div
        className={`w-full h-full min-h-0 overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-teal-950 p-3 flex flex-col justify-between gap-1.5 text-white select-none ${className}`}
      >
        <div className="flex items-center justify-between text-[9px] text-emerald-300 font-mono shrink-0">
          <span>MDA UI/UX</span>
          <span>FIGMA</span>
        </div>
        <div className="my-auto mx-auto w-full max-w-[140px] rounded-lg bg-white/10 border border-white/15 p-2 space-y-1.5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="w-8 h-1.5 rounded bg-emerald-400" />
            <div className="w-3 h-3 rounded-full bg-sky-400/80" />
          </div>
          <div className="h-6 rounded bg-gradient-to-r from-emerald-500/40 to-sky-500/40 border border-white/10" />
          <div className="grid grid-cols-2 gap-1">
            <div className="h-4 rounded bg-white/10" />
            <div className="h-4 rounded bg-white/10" />
          </div>
        </div>
        <div className="text-[10px] font-medium text-slate-200 truncate shrink-0">{title}</div>
      </div>
    );
  }

  if (preset === 'video') {
    return (
      <div
        className={`w-full h-full min-h-0 overflow-hidden bg-gradient-to-br from-slate-950 via-emerald-950 to-sky-950 p-3 flex flex-col justify-between gap-1.5 text-white select-none ${className}`}
      >
        <div className="flex items-center justify-between text-[9px] text-sky-300 font-mono shrink-0">
          <span>REC 4K</span>
          <span>24 FPS</span>
        </div>
        <div className="my-auto flex flex-col items-center gap-1.5 shrink-0">
          <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center">
            <div className="w-0 h-0 border-y-[5px] border-y-transparent border-l-[9px] border-l-emerald-300 ml-0.5" />
          </div>
          <div className="w-full max-w-[130px] h-1 rounded-full bg-white/15 overflow-hidden">
            <div className="w-2/3 h-full bg-gradient-to-r from-emerald-400 to-sky-400" />
          </div>
        </div>
        <div className="text-[10px] font-medium text-slate-200 truncate shrink-0">{title}</div>
      </div>
    );
  }

  if (preset === 'photo') {
    return (
      <div
        className={`w-full h-full min-h-0 overflow-hidden bg-gradient-to-br from-emerald-50 via-teal-50 to-sky-100 p-3 flex flex-col justify-between gap-1.5 text-slate-800 select-none ${className}`}
      >
        <div className="flex items-center justify-between text-[9px] text-teal-700 font-mono shrink-0">
          <span>ISO 200</span>
          <span>f/2.8 · 50mm</span>
        </div>
        <div className="my-auto mx-auto w-14 h-14 rounded-xl border-2 border-dashed border-teal-500/50 bg-white/80 flex items-center justify-center shrink-0">
          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-emerald-500 to-sky-500 opacity-85" />
        </div>
        <div className="text-[10px] font-semibold text-slate-700 truncate shrink-0">{title}</div>
      </div>
    );
  }

  return (
    <div
      className={`w-full h-full min-h-0 overflow-hidden bg-gradient-to-br from-emerald-500 via-teal-600 to-sky-600 p-3.5 flex flex-col justify-between gap-1.5 text-white select-none ${className}`}
    >
      <div className="flex items-center justify-between text-[9px] font-mono text-emerald-100 shrink-0">
        <span>MDA STUDIO</span>
        <span>VISUAL DESIGN</span>
      </div>
      <div className="my-auto space-y-1.5 min-h-0">
        <div className="w-8 h-1 bg-white/80 rounded" />
        <div className="font-display font-bold text-sm leading-snug line-clamp-2">
          {title}
        </div>
        <div className="text-[10px] text-emerald-50/90 truncate">
          Muslim Digital Academy · Darul Fithrah
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="h-1.5 flex-1 rounded bg-white/25" />
        <div className="h-1.5 w-7 rounded bg-slate-900/40" />
      </div>
    </div>
  );
};
