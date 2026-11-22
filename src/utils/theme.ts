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
  merged.internTrackerItems = Array.isArray(cfg?.internTrackerItems)
    ? cfg.internTrackerItems
    : fallback.internTrackerItems;
  return merged;
}
