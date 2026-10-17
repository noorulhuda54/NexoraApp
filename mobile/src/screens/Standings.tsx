import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { colors, font, space } from '../theme';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Muted, OfflineNote, Title } from '../ui';
import { useData } from '../useData';

type Row = { rank: number; team_id: string; name: string; played: number; won: number; drawn: number; lost: number; diff: number; points: number; status: string; resolved_by: string | null };
const STATUS: Record<string, { label: string; tone: 'success' | 'danger' | 'info' }> = {
  clinched: { label: 'Qualified', tone: 'success' }, eliminated: { label: 'Out', tone: 'danger' }, still_possible: { label: 'In contention', tone: 'info' },
};

export default function Standings() {
  const leagues = useData<{ leagues: { league_id: string; name: string }[] }>('/api/v1/leagues');
  const [sel, setSel] = useState<string | null>(null);
  const id = sel || leagues.data?.leagues[0]?.league_id || null;
  const table = useData<{ name: string; qualification_spots: number; table: Row[] }>(id ? `/api/v1/standings/${id}` : null, 10000);
  if (leagues.loading && !leagues.data) return <Loading />;
  if (leagues.error && !leagues.data) return <View style={{ padding: space.lg }}><ErrorBox text={leagues.error} onRetry={leagues.reload} /></View>;
  if (!leagues.data?.leagues.length) return <Empty text="No leagues yet." />;
  const cols = [['P', 'played'], ['W', 'won'], ['D', 'drawn'], ['L', 'lost'], ['GD', 'diff'], ['Pts', 'points']] as const;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <OfflineNote offline={table.offline || leagues.offline} updatedAt={table.updatedAt} />
      {leagues.data.leagues.length > 1 ? leagues.data.leagues.map((l) => <Button key={l.league_id} kind={l.league_id === id ? 'primary' : 'secondary'} title={l.name} onPress={() => setSel(l.league_id)} />) : null}
      {table.error && !table.data ? <ErrorBox text={table.error} onRetry={table.reload} /> : null}
      {table.data ? (
        <Card>
          <Title>{table.data.name}</Title>
          <Muted>Top {table.data.qualification_spots} qualify for the playoffs.</Muted>
          <View style={{ flexDirection: 'row', paddingVertical: space.sm, borderBottomWidth: 1, borderColor: colors.border, marginTop: space.sm }}>
            <Text style={{ width: 24, fontWeight: '700', color: colors.muted }}>#</Text>
            <Text style={{ flex: 1, fontWeight: '700', color: colors.muted }}>Team</Text>
            {cols.map(([h]) => <Text key={h} style={{ width: h === 'Pts' ? 34 : 26, textAlign: 'center', fontWeight: '700', color: colors.muted }}>{h}</Text>)}
          </View>
          {table.data.table.length === 0 ? <Muted>No teams yet.</Muted> : null}
          {table.data.table.map((r) => (
            <View key={r.team_id} accessible accessibilityLabel={`Rank ${r.rank}, ${r.name}, ${r.points} points, ${STATUS[r.status]?.label}`} style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderColor: colors.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ width: 24, fontSize: font.body, color: colors.text }}>{r.rank}</Text>
                <Text style={{ flex: 1, fontSize: font.body, color: colors.text, fontWeight: '600' }} numberOfLines={1}>{r.name}</Text>
                {cols.map(([h, k]) => <Text key={h} style={{ width: h === 'Pts' ? 34 : 26, textAlign: 'center', fontSize: font.body, color: colors.text, fontWeight: h === 'Pts' ? '800' : '400' }}>{String(r[k])}</Text>)}
              </View>
              <View style={{ marginLeft: 24, marginTop: 2 }}><Badge label={STATUS[r.status]?.label || r.status} tone={STATUS[r.status]?.tone || 'info'} /></View>
            </View>
          ))}
        </Card>
      ) : table.loading ? <Loading /> : null}
    </ScrollView>
  );
}
