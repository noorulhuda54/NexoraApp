import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { colors, font, space } from '../theme';
import { Badge, Body, Button, Card, Muted, Notice, Title, useSync } from '../ui';
import { pendingActions, recentResults, QueuedAction } from '../db';
import { friendly, getBaseUrl, setBaseUrl } from '../api';
import { deviceId, syncNow } from '../sync';
import { inputStyle } from './Login';

export default function SyncScreen() {
  const s = useSync();
  const [pending, setPending] = useState<QueuedAction[]>([]);
  const [done, setDone] = useState<QueuedAction[]>([]);
  const [url, setUrl] = useState(getBaseUrl());
  const [saved, setSaved] = useState(false);
  useEffect(() => { setPending(pendingActions()); setDone(recentResults()); }, [s]);
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <Card>
        <Title>Connection</Title>
        <Badge label={s.syncing ? 'Syncing' : s.online ? 'Online' : 'Offline'} tone={s.syncing ? 'info' : s.online ? 'success' : 'danger'} />
        {s.lastMessage ? <Body>{s.lastMessage}</Body> : null}
        <Button title={s.syncing ? 'Syncing…' : 'Sync now'} disabled={s.syncing || !s.online || pending.length === 0} onPress={() => { void syncNow(); }} />
        {!s.online ? <Muted>Actions you take offline are saved on this phone and sent automatically when the connection returns.</Muted> : null}
      </Card>
      <Card>
        <Title>Pending actions ({pending.length})</Title>
        {pending.length === 0 ? <Muted>Nothing waiting to sync.</Muted> : null}
        {pending.map((a) => (
          <Body key={a.action_id}>{`⏳ ${a.label}\n`}<Text style={{ fontSize: font.small, color: colors.muted }}>{`Pending · queued ${new Date(a.queued_at).toLocaleTimeString()}${a.user_email ? ' by ' + a.user_email : ''}`}</Text></Body>
        ))}
      </Card>
      <Card>
        <Title>Recent results</Title>
        {done.length === 0 ? <Muted>No synced actions yet.</Muted> : null}
        {done.map((a) => (
          <Body key={a.action_id}>
            {`${a.status === 'applied' ? '✓ Applied' : a.status === 'duplicate' ? '• Already on server' : '✗ Rejected'} — ${a.label}`}
            {a.status === 'rejected' ? <Text style={{ color: colors.danger }}>{`\n${friendly(a.error_code || '', 'The server refused this action.')} The server's version was kept.`}</Text> : null}
            {a.resolution === 'rebased_append' ? <Text style={{ color: colors.muted }}>{'\nApplied on top of newer changes from others.'}</Text> : null}
          </Body>
        ))}
      </Card>
      <Card>
        <Title>Server</Title>
        <TextInput accessibilityLabel="Backend address" style={inputStyle} autoCapitalize="none" value={url} onChangeText={(t) => { setUrl(t); setSaved(false); }} />
        <Button kind="secondary" title="Save address" onPress={() => { setBaseUrl(url); setSaved(true); }} />
        {saved ? <Notice text="Server address saved." /> : null}
        <Muted>{`Device ${deviceId()}`}</Muted>
      </Card>
    </ScrollView>
  );
}
