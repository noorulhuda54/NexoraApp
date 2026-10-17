import React, { createContext, useContext } from 'react';
export type User = { user_id: string; email: string; name: string; role: 'super_admin' | 'league_organizer' | 'club_manager' | 'player' | 'viewer'; tenant_id: string | null; club_id: string | null; player_id: string | null; league_ids: string[] };
export type Tenant = { tenant_id: string; name: string; logo: string; colors: { primary: string; accent: string } } | null;
export type Route = { name: string; params?: Record<string, any> };
export type Session = { user: User; tenant: Tenant; navigate: (r: Route) => void; back: () => void; signOut: () => void };
export const SessionCtx = createContext<Session | null>(null);
export const useSession = () => useContext(SessionCtx) as Session;
export const ROLE_LABEL: Record<User['role'], string> = {
  super_admin: 'Platform Super-Admin', league_organizer: 'League Organizer', club_manager: 'Club Manager', player: 'Player', viewer: 'General Viewer',
};
