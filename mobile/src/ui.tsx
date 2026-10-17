import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, font, space, touch } from './theme';
import { getSyncState, subscribe, syncNow, SyncState } from './sync';

export function Button({ title, onPress, kind = 'primary', disabled, accessibilityHint, style }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; accessibilityHint?: string; style?: ViewStyle }) {
  const bg = kind === 'primary' ? colors.primary : kind === 'danger' ? colors.danger : colors.card;
  const fg = kind === 'secondary' ? colors.primary : colors.primaryText;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={accessibilityHint} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, borderColor: kind === 'secondary' ? colors.primary : bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}>
      <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}
export const Card = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => <View style={[styles.card, style]}>{children}</View>;
export const Title = ({ children }: { children: React.ReactNode }) => <Text accessibilityRole="header" style={styles.title}>{children}</Text>;
export const Muted = ({ children }: { children: React.ReactNode }) => <Text style={styles.muted}>{children}</Text>;
export const Body = ({ children, bold }: { children: React.ReactNode; bold?: boolean }) => <Text style={[styles.body, bold && { fontWeight: '700' }]}>{children}</Text>;
export function Badge({ label, tone = 'info' }: { label: string; tone?: 'success' | 'danger' | 'warning' | 'info' }) {
  return <View style={[styles.badge, { borderColor: colors[tone] }]}><Text style={[styles.badgeText, { color: colors[tone] }]}>{label}</Text></View>;
}
export const Empty = ({ text }: { text: string }) => <View style={styles.empty}><Text style={styles.muted}>{text}</Text></View>;
export const Loading = () => <View style={styles.empty}><ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Loading" /><Text style={styles.muted}>Loading…</Text></View>;
export const ErrorBox = ({ text, onRetry }: { text: string; onRetry?: () => void }) => (
  <Card style={{ borderColor: colors.danger }}><Text style={[styles.body, { color: colors.danger }]}>{text}</Text>{onRetry ? <Button title="Try again" kind="secondary" onPress={onRetry} /> : null}</Card>
);
export const Notice = ({ text, tone = 'success' }: { text: string; tone?: 'success' | 'danger' | 'warning' }) => (
  <View accessibilityLiveRegion="polite" style={[styles.notice, { borderLeftColor: colors[tone] }]}><Text style={styles.body}>{text}</Text></View>
);
export function OfflineNote({ offline, updatedAt }: { offline: boolean; updatedAt?: string }) {
  if (!offline) return null;
  return <Notice tone="warning" text={`Offline — showing saved data${updatedAt ? ' from ' + new Date(updatedAt).toLocaleString() : ''}.`} />;
}

export function useSync(): SyncState {
  const [s, setS] = useState(getSyncState());
  useEffect(() => subscribe(setS), []);
  return s;
}
// Always-visible connectivity / sync indicator with the pending-action count.
export function SyncBar({ onOpen }: { onOpen: () => void }) {
  const s = useSync();
  const label = s.syncing ? 'Syncing…' : s.online ? 'Online' : 'Offline';
  const tone = s.syncing ? colors.info : s.online ? colors.success : colors.danger;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${s.pending} pending actions. Open sync status`} onPress={onOpen} style={[styles.syncBar, { backgroundColor: tone }]}>
      <Text style={styles.syncText}>{s.online ? '●' : '○'} {label}</Text>
      <Text style={styles.syncText}>{s.pending} pending{s.pending && s.online && !s.syncing ? ' · tap to sync' : ''}</Text>
    </Pressable>
  );
}
export const syncPress = () => { void syncNow(); };

export const money = (minor: number) => `PKR ${(minor / 100).toFixed(2)}`;

export const styles = StyleSheet.create({
  btn: { minHeight: touch, borderRadius: 8, borderWidth: 1.5, paddingHorizontal: space.lg, justifyContent: 'center', alignItems: 'center', marginVertical: space.xs },
  btnText: { fontSize: font.body, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: space.lg, marginBottom: space.md },
  title: { fontSize: font.title, fontWeight: '700', color: colors.text, marginBottom: space.sm },
  muted: { fontSize: font.small, color: colors.muted },
  body: { fontSize: font.body, color: colors.text },
  badge: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: font.small, fontWeight: '700' },
  empty: { padding: space.xl, alignItems: 'center' },
  notice: { backgroundColor: colors.card, borderLeftWidth: 5, padding: space.md, marginBottom: space.md, borderRadius: 6 },
  syncBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.lg, minHeight: 36, alignItems: 'center' },
  syncText: { color: '#FFFFFF', fontWeight: '700', fontSize: font.small },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
