import { BrandingTemplateConfig, MdaAccentTheme } from '../types/mda';

export function getThemeStyles(theme: MdaAccentTheme = 'mda-emerald') {
  switch (theme) {
    case 'darul-forest':
      return {
        bannerGradient:
          'linear-gradient(125deg, #059669 0%, #065F46 55%, #0F172A 100%)',
        footerGradient:
          'linear-gradient(90deg, #10B981 0%, #059669 55%, #0F766E 100%)',
        pageTint: '#ECFDF5',
        barTrack: '#D1FAE5',
        barFill: '#10B981',
        darkPill: '#064E3B',
        sectionSky: '#34D399',
      };
    case 'ocean-cyan':
      return {
        bannerGradient:
          'linear-gradient(125deg, #00B0FF 0%, #00A896 55%, #0F172A 100%)',
        footerGradient:
          'linear-gradient(90deg, #00E676 0%, #00B0FF 100%)',
        pageTint: '#ECFEFF',
        barTrack: '#CFFAFE',
        barFill: '#0EA5E9',
        darkPill: '#0C4A6E',
        sectionSky: '#38BDF8',
      };
    case 'mda-emerald':
    default:
      return {
        bannerGradient:
          'linear-gradient(125deg, #00D084 0%, #0D7A6F 52%, #0B4F6C 100%)',
        footerGradient:
          'linear-gradient(90deg, #00E676 0%, #00C49A 50%, #00B0FF 100%)',
        pageTint: '#E8FAF3',
        barTrack: '#A7EBD0',
        barFill: '#00C49A',
        darkPill: '#0E2228',
        sectionSky: '#00AEEF',
      };
  }
}

export function getParentPortalAccessUrl(
  nisnMda: string,
  pin: string,
  spreadsheetId?: string
): string {
  if (typeof window === 'undefined') return `/?nisn=${nisnMda}&pin=${pin}`;
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('nisn', nisnMda);
  url.searchParams.set('pin', pin);
  if (spreadsheetId) {
    url.searchParams.set('sheet', spreadsheetId);
  }
  return url.toString();
}

export function mergeTemplateConfig(
  cfg: Partial<BrandingTemplateConfig> | undefined,
  fallback: BrandingTemplateConfig
): BrandingTemplateConfig {
  const merged = { ...fallback, ...(cfg || {}) };

  // Upgrade legacy default copy saved previously in Google Sheets without overwriting custom edits
  if (
    !merged.loginHeadline ||
    merged.loginHeadline.trim() === 'Dashboard Rapor Digital & Student Portfolio'
  ) {
    merged.loginHeadline = fallback.loginHeadline;
  }
  if (
    !merged.loginDescription ||
    merged.loginDescription.trim() ===
      'Sistem pengelolaan hasil belajar terpadu Muslim Digital Academy (MDA) Pondok Pesantren Darul Fithrah dengan penyimpanan permanen di Google Sheets dan akses privat bagi setiap wali santri.'
  ) {
    merged.loginDescription = fallback.loginDescription;
  }
  if (merged.loginAdminInfo) {
    merged.loginAdminInfo = merged.loginAdminInfo.replace(/eskpor/gi, 'ekspor');
  }
  if (merged.loginParentInfo) {
    merged.loginParentInfo = merged.loginParentInfo.replace(/eskpor/gi, 'ekspor');
  }

  merged.internTrackerItems = Array.isArray(cfg?.internTrackerItems)
    ? cfg.internTrackerItems
    : fallback.internTrackerItems;
  const rawHalamanPerJuz = Number(cfg?.internHalamanPerJuz);
  const rawLegacyLembar = Number(cfg?.internLembarPerJuz);
  merged.internHalamanPerJuz =
    Number.isFinite(rawHalamanPerJuz) && rawHalamanPerJuz >= 1 && rawHalamanPerJuz <= 200
      ? Math.round(rawHalamanPerJuz)
      : Number.isFinite(rawLegacyLembar) && rawLegacyLembar >= 1 && rawLegacyLembar <= 100 && rawLegacyLembar !== 10
        ? Math.min(200, Math.round(rawLegacyLembar * 2))
        : fallback.internHalamanPerJuz || 20;
  return merged;
}
