export type PlatformNavigationSection =
  | 'overview'
  | 'companies'
  | 'subs'
  | 'plans'
  | 'modules'
  | 'support'
  | 'audit'
  | 'settings';

export type PlatformRole = 'platform_owner' | 'finance' | 'support' | 'viewer';

export interface PlatformUser {
  id: string;
  email: string;
  display_name: string;
  platform_role: PlatformRole;
}

export const ROLE_LABELS: Record<PlatformRole, string> = {
  platform_owner: 'Владелец платформы',
  finance: 'Финансы и биллинг',
  support: 'Техническая поддержка',
  viewer: 'Аналитик / Наблюдатель',
};

export const ROLE_BADGE_COLORS: Record<PlatformRole, { bg: string; color: string; border: string }> = {
  platform_owner: { bg: '#FEE2E2', color: '#991B1B', border: '#FCA5A5' },
  finance: { bg: '#E0F2FE', color: '#0369A1', border: '#BAE6FD' },
  support: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
  viewer: { bg: '#F1F5F9', color: '#475569', border: '#CBD5E1' },
};
