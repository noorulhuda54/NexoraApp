import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { colors, font, space } from '../theme';
import { Body, Button, Card, Muted, Title } from '../ui';
import { ROLE_LABEL, useSession } from '../session';

export default function Home() {
  const { user, tenant, navigate, signOut } = useSession();
  const brand = tenant ? tenant.colors.primary : colors.primary;
  const actions: { title: string; hint: string; route: any }[] = [];
  if (user.role === 'league_organizer' || user.role === 'super_admin') actions.push({ title: 'Record match scores', hint: 'Open fixtures and pick a match to score', route: { name: 'Fixtures' } });
  if ((user.role === 'club_manager' || user.role === 'player') && user.club_id) actions.push({ title: user.role === 'club_manager' ? 'Manage my club roster' : 'My club', hint: 'Open your club profile', route: { name: 'Club', params: { club_id: user.club_id } } });
  actions.push({ title: 'League standings', hint: 'Open the points table', route: { name: 'Standings' } });
  actions.push({ title: 'Upcoming fixtures', hint: 'Open the list of matches', route: { name: 'Fixtures' } });
  actions.push({ title: 'Club store', hint: 'Buy merchandise', route: { name: 'Store' } });
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <Card style={{ borderLeftWidth: 6, borderLeftColor: brand }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {tenant ? (
            <View accessibilityLabel={`${tenant.name} logo`} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: brand, alignItems: 'center', justifyContent: 'center', marginRight: space.md }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: font.title }}>{tenant.logo}</Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Title>Hello, {user.name}</Title>
            <Muted>{ROLE_LABEL[user.role]}{tenant ? ` · ${tenant.name}` : ' · All organisations'}</Muted>
          </View>
        </View>
      </Card>
      <Card>
        <Body bold>What would you like to do?</Body>
        {actions.map((a) => <Button key={a.title} title={a.title} accessibilityHint={a.hint} kind={a === actions[0] ? 'primary' : 'secondary'} onPress={() => navigate(a.route)} />)}
      </Card>
      <Button kind="secondary" title="Sync status & settings" onPress={() => navigate({ name: 'Sync' })} />
      <Button kind="danger" title="Sign out" onPress={signOut} />
    </ScrollView>
  );
}
