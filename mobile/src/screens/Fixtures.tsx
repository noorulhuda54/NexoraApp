import React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { colors, font, space } from '../theme';
import { Badge, Empty, ErrorBox, Loading, Muted, OfflineNote } from '../ui';
import { useData } from '../useData';
import { useSession } from '../session';

export type MatchSummary = { match_id: string; status: string; outcome: string; scheduled_at: string | null; venue: { name: string } | null;
  home: { team_id: string; name: string; score: number }; away: { team_id: string; name: string; score: number }; version: number };
export const STATUS: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' | 'info' }> = {
  upcoming: { label: 'Upcoming', tone: 'info' }, in_progress: { label: 'Live', tone: 'danger' }, completed: { label: 'Full time', tone: 'success' },
  postponed: { label: 'Postponed', tone: 'warning' }, abandoned: { label: 'Abandoned', tone: 'warning' }, cancelled: { label: 'Cancelled', tone: 'warning' },
};
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Time to be confirmed');

export default function Fixtures() {
  const { navigate } = useSession();
  const { data, offline, updatedAt, error, loading, reload } = useData<{ matches: MatchSummary[] }>('/api/v1/matches');
  if (loading && !data) return <Loading />;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }} refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <OfflineNote offline={offline} updatedAt={updatedAt} />
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {data && data.matches.length === 0 ? <Empty text="No matches yet." /> : null}
      {data?.matches.map((m) => {
        const st = STATUS[m.status] || { label: m.status, tone: 'info' as const };
        return (
          <Pressable key={m.match_id} accessibilityRole="button" accessibilityLabel={`${m.home.name} ${m.home.score} versus ${m.away.name} ${m.away.score}, ${st.label}. Open match`}
            onPress={() => navigate({ name: 'Match', params: { match_id: m.match_id } })}
            style={({ pressed }) => ({ backgroundColor: pressed ? '#EAF0F6' : colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: space.lg, marginBottom: space.md, minHeight: 48 })}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.sm }}>
              <Badge label={st.label} tone={st.tone} /><Muted>{when(m.scheduled_at)}</Muted>
            </View>
            <Row name={m.home.name} score={m.status === 'upcoming' ? '–' : String(m.home.score)} />
            <Row name={m.away.name} score={m.status === 'upcoming' ? '–' : String(m.away.score)} />
            {m.venue ? <Muted>{m.venue.name}</Muted> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
const Row = ({ name, score }: { name: string; score: string }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
    <Text style={{ fontSize: font.body, color: colors.text, flex: 1 }} numberOfLines={1}>{name}</Text>
    <Text style={{ fontSize: font.title, fontWeight: '800', color: colors.text, minWidth: 32, textAlign: 'right' }}>{score}</Text>
  </View>
);
