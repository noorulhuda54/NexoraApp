import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { colors, font, space } from '../theme';
import { Badge, Body, Button, Card, Empty, ErrorBox, Loading, Muted, Notice, OfflineNote, Title, useSync } from '../ui';
import { useData } from '../useData';
import { useSession } from '../session';
import { queueAction, newId } from '../sync';
import { inputStyle } from './Login';

type Club = { club_id: string; name: string; tenant_id: string; home_venue: { name: string; lat: number; lng: number }; social?: Record<string, string>;
  staff: { name: string; role: string }[]; roster: { player_id: string; name: string; position: string; role: string; league_id: string; registration_type: string; parent_squad_id: string | null; loan_end_date: string | null }[];
  can_manage: boolean; transfer_targets: { club_id: string; name: string }[]; tenant: { name: string } };

export function ClubList() {
  const { navigate } = useSession();
  const { data, offline, updatedAt, error, loading, reload } = useData<{ clubs: { club_id: string; name: string; home_venue: { name: string } }[] }>('/api/v1/clubs');
  if (loading && !data) return <Loading />;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <OfflineNote offline={offline} updatedAt={updatedAt} />
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {data && !data.clubs.length ? <Empty text="No clubs yet." /> : null}
      {data?.clubs.map((c) => (
        <Pressable key={c.club_id} accessibilityRole="button" accessibilityLabel={`Open ${c.name}`} onPress={() => navigate({ name: 'Club', params: { club_id: c.club_id } })}
          style={({ pressed }) => ({ backgroundColor: pressed ? '#EAF0F6' : colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: space.lg, marginBottom: space.md, minHeight: 48 })}>
          <Body bold>{c.name}</Body><Muted>{c.home_venue.name}</Muted>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const ROLE: Record<string, string> = { captain: 'Captain', vice_captain: 'Vice-captain', starter: 'Starter', substitute: 'Substitute' };

export function ClubProfile({ club_id }: { club_id: string }) {
  const { navigate, user } = useSession();
  const { data, offline, updatedAt, error, loading, reload } = useData<Club>(`/api/v1/clubs/${club_id}`);
  if (loading && !data) return <Loading />;
  if (!data) return <View style={{ padding: space.lg }}><ErrorBox text={error || 'Club not available offline yet.'} onRetry={reload} /></View>;
  const canManage = data.can_manage || user.role === 'super_admin' || (user.role === 'club_manager' && user.club_id === club_id);
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <OfflineNote offline={offline} updatedAt={updatedAt} />
      <Card>
        <Title>{data.name}</Title>
        <Muted>{data.tenant?.name}</Muted>
        <Body>Home venue: {data.home_venue.name}</Body>
        <Muted>{`${data.home_venue.lat.toFixed(4)}, ${data.home_venue.lng.toFixed(4)}`}</Muted>
        {data.social ? <Muted>{Object.entries(data.social).map(([k, v]) => `${k}: ${v}`).join(' · ')}</Muted> : null}
      </Card>
      <Card>
        <Title>Staff</Title>
        {data.staff.map((s) => <Body key={s.name}>{s.name} — {s.role}</Body>)}
      </Card>
      <Card>
        <Title>Roster ({data.roster.length})</Title>
        {data.roster.length === 0 ? <Muted>No registered players.</Muted> : null}
        {data.roster.map((p) => (
          <View key={p.player_id + p.league_id} style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderColor: colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}><Body bold>{p.name}</Body><Muted>{`${p.position?.toUpperCase() || ''} · ${ROLE[p.role] || p.role}`}</Muted></View>
              {p.registration_type === 'loan' ? <Badge label={`On loan until ${p.loan_end_date}`} tone="warning" /> : null}
            </View>
            {canManage ? <Button kind="secondary" title={`Move ${p.name.split(' ')[0]}`} accessibilityHint="Transfer, loan or release this player" onPress={() => navigate({ name: 'RosterAction', params: { club: data, player: p } })} /> : null}
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

export function RosterAction({ club, player }: { club: Club; player: Club['roster'][number] }) {
  const { back } = useSession();
  const sync = useSync();
  const [type, setType] = useState<'transfer' | 'loan' | 'release'>('transfer');
  const [to, setTo] = useState(club.transfer_targets[0]?.club_id || '');
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    setErr(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr('Enter the effective date as YYYY-MM-DD.');
    if (type === 'loan' && (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= date)) return setErr('Loan end date must be after the effective date (YYYY-MM-DD).');
    if (type !== 'release' && !to) return setErr('Choose the destination club.');
    const target = club.transfer_targets.find((t) => t.club_id === to)?.name;
    const label = type === 'release' ? `Release ${player.name}` : `${type === 'loan' ? 'Loan' : 'Transfer'} ${player.name} to ${target}`;
    Alert.alert('Confirm roster change', `${label}?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: () => {
      queueAction('roster_transfer', { request_id: newId('tr'), league_id: player.league_id, player_id: player.player_id, type, from_squad_id: club.club_id,
        to_squad_id: type === 'release' ? null : to, effective_date: date, loan_end_date: type === 'loan' ? end : null, reason: reason || 'Roster update', requested_by: 'mobile' }, 0, label);
      setMsg(sync.online ? `${label} — sent. Check Sync status for the result.` : `${label} — saved offline. It will sync automatically.`);
    } }]);
  };
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
      {msg ? <><Notice text={msg} /><Button title="Back to club" onPress={back} /></> : null}
      <Card>
        <Title>Move {player.name}</Title>
        <Body bold>Action</Body>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          {(['transfer', 'loan', 'release'] as const).map((t) => <Button key={t} kind={type === t ? 'primary' : 'secondary'} title={t[0].toUpperCase() + t.slice(1)} onPress={() => setType(t)} />)}
        </View>
        {type !== 'release' ? (
          <>
            <Body bold>Destination club</Body>
            {club.transfer_targets.map((t) => <Button key={t.club_id} kind={to === t.club_id ? 'primary' : 'secondary'} title={t.name} onPress={() => setTo(t.club_id)} />)}
          </>
        ) : null}
        <Text style={{ fontSize: font.body, color: colors.text, marginTop: space.sm }}>Effective date (YYYY-MM-DD)</Text>
        <TextInput accessibilityLabel="Effective date" style={inputStyle} value={date} onChangeText={setDate} />
        {type === 'loan' ? (<><Text style={{ fontSize: font.body, color: colors.text }}>Loan end date (YYYY-MM-DD)</Text><TextInput accessibilityLabel="Loan end date" style={inputStyle} value={end} onChangeText={setEnd} placeholder="2026-12-31" placeholderTextColor={colors.muted} /></>) : null}
        <Text style={{ fontSize: font.body, color: colors.text }}>Reason</Text>
        <TextInput accessibilityLabel="Reason" style={inputStyle} value={reason} onChangeText={setReason} placeholder="e.g. Tactical move" placeholderTextColor={colors.muted} />
        {err ? <ErrorBox text={err} /> : null}
        <Button kind={type === 'release' ? 'danger' : 'primary'} title="Submit" onPress={submit} />
      </Card>
    </ScrollView>
  );
}
