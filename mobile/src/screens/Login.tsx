import React, { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { getBaseUrl, isNetworkError, request, saveToken, setBaseUrl } from '../api';
import { colors, font, space } from '../theme';
import { Button, Card, ErrorBox, Muted, Title } from '../ui';
import type { Tenant, User } from '../session';

export const inputStyle = { borderWidth: 1, borderColor: colors.border, borderRadius: 8, minHeight: 48, paddingHorizontal: space.md, fontSize: font.body, color: colors.text, backgroundColor: '#fff', marginBottom: space.md } as const;

export default function Login({ onLogin }: { onLogin: (u: User, t: Tenant) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState(getBaseUrl());
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    if (!email || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    const mail = email.trim().toLowerCase();
    const key = 'acct_' + mail.replace(/[^a-z0-9]/g, '_');
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `nascon|${mail}|${password}`);
    try {
      setBaseUrl(url);
      const r = await request<{ token: string; user: User; tenant: Tenant }>('POST', '/api/v1/auth/login', { email: mail, password });
      await saveToken(r.token);
      // remember a salted hash so this account can sign in again while offline (stored in the Android Keystore)
      await SecureStore.setItemAsync(key, JSON.stringify({ hash, token: r.token, user: r.user, tenant: r.tenant }));
      onLogin(r.user, r.tenant);
    } catch (e: any) {
      if (isNetworkError(e)) {
        const saved = await SecureStore.getItemAsync(key);
        const acct = saved ? JSON.parse(saved) : null;
        if (acct && acct.hash === hash) { await saveToken(acct.token); onLogin(acct.user, acct.tenant); return; }
        setError('You are offline. Offline sign-in works only for accounts that signed in on this phone before.');
      } else setError(e.message);
    } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="height">
      <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={{ fontSize: font.h1, fontWeight: '800', color: colors.primary, marginTop: space.xl }}>NaSCon League</Text>
        <Muted>Fixtures, standings, clubs and the club store.</Muted>
        <Card style={{ marginTop: space.xl }}>
          <Title>Sign in</Title>
          <Text style={{ color: colors.text, marginBottom: space.xs }}>Email</Text>
          <TextInput accessibilityLabel="Email" style={inputStyle} autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} placeholder="name@nascon.test" placeholderTextColor={colors.muted} />
          <Text style={{ color: colors.text, marginBottom: space.xs }}>Password</Text>
          <TextInput accessibilityLabel="Password" style={inputStyle} secureTextEntry value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.muted} onSubmitEditing={submit} />
          {error ? <ErrorBox text={error} /> : null}
          <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={submit} disabled={busy} />
        </Card>
        <Button kind="secondary" title={showServer ? 'Hide server settings' : 'Server settings'} onPress={() => setShowServer(!showServer)} />
        {showServer ? (
          <Card>
            <Text style={{ color: colors.text, marginBottom: space.xs }}>Backend address</Text>
            <TextInput accessibilityLabel="Backend address" style={inputStyle} autoCapitalize="none" value={url} onChangeText={setUrl} />
            <Muted>Emulator: http://10.0.2.2:8080 · Phone: http://&lt;laptop LAN IP&gt;:8080</Muted>
          </Card>
        ) : null}
        <View style={{ marginTop: space.lg }}><Muted>Demo: admin@ / organizer@ / manager@ / player@ / viewer@nascon.test — password Nascon@26</Muted></View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
