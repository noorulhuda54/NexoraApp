import React, { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { loadToken, saveToken, setCacheScope } from './src/api';
import { settingGet, settingSet } from './src/db';
import { setSyncUser, startSyncEngine } from './src/sync';
import { colors, font, space } from './src/theme';
import { Loading, SyncBar } from './src/ui';
import { Route, SessionCtx, Tenant, User } from './src/session';
import Login from './src/screens/Login';
import Home from './src/screens/Home';
import Fixtures from './src/screens/Fixtures';
import Match from './src/screens/Match';
import Standings from './src/screens/Standings';
import { ClubList, ClubProfile, RosterAction } from './src/screens/Clubs';
import Store from './src/screens/Store';
import SyncScreen from './src/screens/Sync';

const TABS: { name: string; label: string }[] = [
  { name: 'Home', label: 'Home' }, { name: 'Fixtures', label: 'Fixtures' }, { name: 'Standings', label: 'Table' }, { name: 'Clubs', label: 'Clubs' }, { name: 'Store', label: 'Store' },
];
const TITLES: Record<string, string> = { Home: 'Home', Fixtures: 'Fixtures', Match: 'Match', Standings: 'Standings', Clubs: 'Clubs', Club: 'Club profile', RosterAction: 'Roster action', Store: 'Club store', Sync: 'Sync status & settings' };

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant>(null);
  const [stack, setStack] = useState<Route[]>([{ name: 'Home' }]);

  useEffect(() => {
    (async () => {
      const t = await loadToken();
      const cached = settingGet('session');
      if (t && cached) { const s = JSON.parse(cached); setCacheScope(s.user.user_id); setSyncUser(s.user.email); setUser(s.user); setTenant(s.tenant); }
      startSyncEngine();
      setReady(true);
    })();
  }, []);

  const session = useMemo(() => user && ({
    user, tenant,
    navigate: (r: Route) => setStack((s) => (TABS.some((t) => t.name === r.name) ? [r] : [...s, r])),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    // pending offline actions are kept on sign-out; they sync later with their author's token
    signOut: async () => { await saveToken(null); settingSet('session', ''); setSyncUser(null); setUser(null); setStack([{ name: 'Home' }]); },
  }), [user, tenant]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) { setStack((s) => s.slice(0, -1)); return true; }
      if (stack[0].name !== 'Home') { setStack([{ name: 'Home' }]); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack]);

  if (!ready) return <Loading />;
  if (!user || !session) {
    return (
      <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><StatusBar style="dark" />
        <Login onLogin={(u, t) => { settingSet('session', JSON.stringify({ user: u, tenant: t })); setCacheScope(u.user_id); setSyncUser(u.email); setUser(u); setTenant(t); setStack([{ name: 'Home' }]); }} />
      </SafeAreaView></SafeAreaProvider>
    );
  }
  const route = stack[stack.length - 1];
  const p = route.params || {};
  let screen: React.ReactNode = null;
  switch (route.name) {
    case 'Home': screen = <Home />; break;
    case 'Fixtures': screen = <Fixtures />; break;
    case 'Match': screen = <Match key={p.match_id} match_id={p.match_id} />; break;
    case 'Standings': screen = <Standings />; break;
    case 'Clubs': screen = <ClubList />; break;
    case 'Club': screen = <ClubProfile key={p.club_id} club_id={p.club_id} />; break;
    case 'RosterAction': screen = <RosterAction club={p.club} player={p.player} />; break;
    case 'Store': screen = <Store />; break;
    case 'Sync': screen = <SyncScreen />; break;
    default: screen = <Home />;
  }
  const brand = tenant ? tenant.colors.primary : colors.primary;
  const activeTab = stack[0].name;
  return (
    <SafeAreaProvider>
      <SessionCtx.Provider value={session}>
        <SafeAreaView style={{ flex: 1, backgroundColor: brand }} edges={['top']}>
          <StatusBar style="light" />
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: brand, minHeight: 56, paddingHorizontal: space.sm }}>
            {stack.length > 1 ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={session.back} style={{ minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: font.h1 }}>‹</Text>
              </Pressable>
            ) : <View style={{ width: space.sm }} />}
            <Text accessibilityRole="header" style={{ flex: 1, color: '#fff', fontSize: font.title, fontWeight: '700' }} numberOfLines={1}>{TITLES[route.name] || route.name}</Text>
            {tenant ? <Text style={{ color: '#fff', fontSize: font.small, marginRight: space.sm }}>{tenant.name}</Text> : null}
          </View>
          <SyncBar onOpen={() => session.navigate({ name: 'Sync' })} />
          <View style={{ flex: 1, backgroundColor: colors.bg }}>{screen}</View>
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.card }}>
            <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: colors.border }}>
              {TABS.map((t) => {
                const on = activeTab === t.name && stack.length >= 1;
                return (
                  <Pressable key={t.name} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label} onPress={() => setStack([{ name: t.name }])}
                    style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderTopWidth: 3, borderTopColor: on ? brand : 'transparent' }}>
                    <Text style={{ fontSize: font.small, fontWeight: on ? '800' : '500', color: on ? brand : colors.muted }}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </SafeAreaView>
        </SafeAreaView>
      </SessionCtx.Provider>
    </SafeAreaProvider>
  );
}
