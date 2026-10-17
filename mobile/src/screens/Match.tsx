import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { colors, font, space } from '../theme';
import { Badge, Body, Button, Card, ErrorBox, Loading, money, Muted, Notice, OfflineNote, Title, useSync } from '../ui';
import { useData } from '../useData';
import { useSession } from '../session';
import { queueAction, newId } from '../sync';
import { cacheGet } from '../db';
import { cacheKey } from '../api';
import { STATUS, when, MatchSummary } from './Fixtures';

type Ev = { sequence: number; event_id: string; type: string; payload: any; compensated: boolean; compensated_by: string | null };
type Detail = MatchSummary & { score: { events: Ev[]; outcome: string; winner_team_id: string | null; home: any; away: any; version: number };
  sport: { name: string; scoring_model: string; scoring_events: Record<string, any> }; can_score: boolean;
  pinned_product: { product_id: string; name: string; variants: { price_minor: number }[] } | null };

const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default function Match({ match_id }: { match_id: string }) {
  const { navigate, user } = useSession();
  const sync = useSync();
  const path = `/api/v1/matches/${match_id}`;
  const { data, offline, updatedAt, error, loading, reload } = useData<Detail>(path, 4000);
  const [notice, setNotice] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (!data) return <View style={{ padding: space.lg }}><ErrorBox text={error || 'Match not available offline yet.'} onRetry={reload} /></View>;
  // permission from the server, or derived from the signed-in role when showing a cached copy (server re-checks on sync)
  const m = { ...data, can_score: data.can_score || user.role === 'super_admin' || (user.role === 'league_organizer' && user.league_ids.includes((data as any).league_id)) };
  const name = (team: string) => (team === m.home.team_id ? m.home.name : team === m.away.team_id ? m.away.name : team);
  const st = STATUS[m.status] || { label: m.status, tone: 'info' as const };
  const version = Math.max(m.score.version, (cacheGet<Detail>(cacheKey(path))?.data.score.version) || 0);
  const send = (type: string, payload: Record<string, unknown>, label: string) => {
    queueAction('score_event', { event_id: newId('evt'), match_id, type, payload }, version, label);
    setNotice(sync.online ? `${label} — sending…` : `${label} — saved offline. It will sync when you are back online.`);
    setTimeout(() => { void reload(); }, 1200);
  };
  const confirm = (title: string, msg: string, go: () => void) => Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: go }]);
  const scoringKeys = Object.keys(m.sport.scoring_events || {});
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <OfflineNote offline={offline} updatedAt={updatedAt} />
      {notice ? <Notice text={notice} /> : null}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Badge label={st.label} tone={st.tone} /><Muted>{m.sport.name}</Muted></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: space.lg }} accessible accessibilityLabel={`Score: ${m.home.name} ${m.home.score}, ${m.away.name} ${m.away.score}`}>
          <Text style={{ flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text, textAlign: 'center' }}>{m.home.name}</Text>
          <Text style={{ fontSize: font.score, fontWeight: '800', color: colors.text, marginHorizontal: space.md }}>{m.home.score} – {m.away.score}</Text>
          <Text style={{ flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text, textAlign: 'center' }}>{m.away.name}</Text>
        </View>
        {m.sport.scoring_model === 'innings' ? <Muted>{`Overs: ${m.score.home.overs} / ${m.score.away.overs} · Wickets: ${m.score.home.wickets} / ${m.score.away.wickets}`}</Muted> : null}
        <Muted>{when(m.scheduled_at)}{m.venue ? ` · ${m.venue.name}` : ''}</Muted>
        {m.status === 'completed' ? <Body bold>{m.score.winner_team_id ? `${name(m.score.winner_team_id)} won` : m.score.outcome === 'draw' ? 'Draw' : 'Result undecided'}</Body> : null}
      </Card>

      {m.pinned_product ? (
        <Card style={{ borderColor: colors.accent, borderWidth: 2 }}>
          <Muted>Featured in the club store</Muted>
          <Body bold>{m.pinned_product.name}</Body>
          <Muted>{money(m.pinned_product.variants[0]?.price_minor || 0)}</Muted>
          <Button title="View in store" onPress={() => navigate({ name: 'Store' })} />
        </Card>
      ) : null}

      {m.can_score ? (
        <Card>
          <Title>Scoring</Title>
          {m.status === 'upcoming' ? <Button title="Start match" onPress={() => confirm('Start match?', 'The match will become live.', () => send('match_start', {}, 'Start match'))} /> : null}
          {m.status === 'in_progress' ? (
            <>
              {[m.home, m.away].map((t) => (
                <View key={t.team_id} style={{ marginBottom: space.sm }}>
                  <Body bold>{t.name}</Body>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {scoringKeys.map((k) => <Button key={k} kind="secondary" title={`+ ${pretty(k)}`} onPress={() => send('score', { team_id: t.team_id, event_type: k }, `${pretty(k)} for ${t.name}`)} />)}
                  </View>
                </View>
              ))}
              <Button kind="danger" title="End match" onPress={() => confirm('End match?', 'This records the final whistle.', () => send('match_end', {}, 'End match'))} />
            </>
          ) : null}
          {m.status === 'completed' ? <Muted>Match finished. You can still correct events in the timeline below.</Muted> : null}
        </Card>
      ) : null}

      <Card>
        <Title>Timeline</Title>
        {m.score.events.length === 0 ? <Muted>No events yet.</Muted> : null}
        {m.score.events.slice().reverse().map((e) => {
          const correctable = m.can_score && !e.compensated && ['score', 'discipline', 'tiebreak_winner'].includes(e.type);
          let text = pretty(e.type);
          if (e.type === 'score') text = `${pretty(e.payload.event_type)} — ${name(e.payload.team_id)}`;
          if (e.type === 'discipline') text = `Discipline ${e.payload.points} — ${name(e.payload.team_id)}`;
          if (e.type === 'compensation') text = `Correction of an earlier event${e.payload.reason ? ': ' + e.payload.reason : ''}`;
          return (
            <View key={e.event_id} style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: font.body, color: e.compensated ? colors.muted : colors.text, textDecorationLine: e.compensated ? 'line-through' : 'none' }}>#{e.sequence} {text}</Text>
              {e.compensated ? <Muted>Cancelled by a correction</Muted> : null}
              {correctable ? <Button kind="secondary" title="Correct this event" onPress={() => confirm('Correct this event?', 'A correction is added to the log; the original stays visible.', () => send('compensation', { compensates: e.event_id, reason: 'Corrected by organizer' }, `Correction of #${e.sequence}`))} /> : null}
            </View>
          );
        })}
      </Card>
    </ScrollView>
  );
}
