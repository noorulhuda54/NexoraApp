import React, { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { colors, font, space } from '../theme';
import { Body, Button, Card, Empty, ErrorBox, Loading, money, Muted, Notice, OfflineNote, Title, useSync } from '../ui';
import { useData } from '../useData';
import { getBaseUrl, loadToken, request } from '../api';
import { newId } from '../sync';
import { inputStyle } from './Login';

type Variant = { variant_id: string; size: string; color: string; price_minor: number; stock: number };
type Product = { product_id: string; name: string; description: string; category: string; variants: Variant[] };
type Receipt = { order_id: string; status: string; items: { variant_id: string; quantity: number; unit_price_minor: number }[]; subtotal_minor: number; discount_minor: number; total_minor: number;
  receipt: { payload: { paid_at: string }; signature: string } };
const PAYMENTS = [{ token: 'tok_success', label: 'Test card — approved' }, { token: 'tok_declined', label: 'Test card — declined' }, { token: 'tok_capture_fail', label: 'Test card — capture fails' }];

export default function Store() {
  const sync = useSync();
  const { data, offline, updatedAt, error, loading, reload } = useData<{ products: Product[] }>('/api/v1/products');
  const [pick, setPick] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [code, setCode] = useState('');
  const [token, setToken] = useState('tok_success');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  if (loading && !data) return <Loading />;
  const variants = new Map<string, Variant & { product: string }>();
  data?.products.forEach((p) => p.variants.forEach((v) => variants.set(v.variant_id, { ...v, product: p.name })));
  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  const subtotal = lines.reduce((s, [id, q]) => s + (variants.get(id)?.price_minor || 0) * q, 0);
  const add = (id: string) => setCart({ ...cart, [id]: Math.min(10, (cart[id] || 0) + 1) });
  const dec = (id: string) => setCart({ ...cart, [id]: Math.max(0, (cart[id] || 0) - 1) });
  const pay = () => {
    Alert.alert('Confirm purchase', `Pay about ${money(subtotal)} with "${PAYMENTS.find((p) => p.token === token)?.label}"?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Pay', onPress: async () => {
      setBusy(true); setErr(null);
      try {
        const r = await request<Receipt>('POST', '/api/v1/checkout', { order_id: newId('ord'), items: lines.map(([variant_id, quantity]) => ({ variant_id, quantity })),
          discount_code: code.trim() ? code.trim().toUpperCase() : null, payment: { token } }, 15000);
        setReceipt(r); setCart({}); void reload();
      } catch (e: any) { setErr(e.message); void reload(); } finally { setBusy(false); }
    } }]);
  };
  const share = async () => {
    if (!receipt) return;
    try {
      const t = await loadToken();
      const file = `${FileSystem.cacheDirectory}receipt-${receipt.order_id}.pdf`;
      await FileSystem.downloadAsync(`${getBaseUrl()}/api/v1/orders/${receipt.order_id}/receipt.pdf`, file, { headers: { Authorization: `Bearer ${t}` } });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file, { mimeType: 'application/pdf', dialogTitle: 'Receipt' });
    } catch { setErr('Could not download the PDF receipt. Check your connection.'); }
  };
  if (receipt) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <Notice text="Payment successful. Thank you!" />
        <Card>
          <Title>Receipt</Title>
          <Muted>{`Order ${receipt.order_id} · ${new Date(receipt.receipt.payload.paid_at).toLocaleString()}`}</Muted>
          {receipt.items.map((i) => <Body key={i.variant_id}>{`${variants.get(i.variant_id)?.product || i.variant_id} (${variants.get(i.variant_id)?.size || ''}) × ${i.quantity} — ${money(i.unit_price_minor * i.quantity)}`}</Body>)}
          <Body>Subtotal: {money(receipt.subtotal_minor)}</Body>
          <Body>Discount: −{money(receipt.discount_minor)}</Body>
          <Text style={{ fontSize: font.title, fontWeight: '800', color: colors.text }}>Total: {money(receipt.total_minor)}</Text>
          <Muted>{`Signature ${receipt.receipt.signature.slice(0, 16)}…`}</Muted>
        </Card>
        {err ? <ErrorBox text={err} /> : null}
        <Button title="Download PDF receipt" onPress={share} />
        <Button kind="secondary" title="Back to store" onPress={() => setReceipt(null)} />
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
      <OfflineNote offline={offline} updatedAt={updatedAt} />
      {error ? <ErrorBox text={error} onRetry={reload} /> : null}
      {data && !data.products.length ? <Empty text="No products yet." /> : null}
      {data?.products.map((p) => {
        const sel = pick[p.product_id] || p.variants[0]?.variant_id;
        const v = p.variants.find((x) => x.variant_id === sel);
        return (
          <Card key={p.product_id}>
            <Title>{p.name}</Title>
            <Muted>{p.description}</Muted>
            <Body bold>Size</Body>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {p.variants.map((x) => <Button key={x.variant_id} kind={x.variant_id === sel ? 'primary' : 'secondary'} title={`${x.size}${x.stock === 0 ? ' (sold out)' : ''}`} accessibilityHint={`${x.stock} in stock`} onPress={() => setPick({ ...pick, [p.product_id]: x.variant_id })} />)}
            </View>
            {v ? <Body>{`${money(v.price_minor)} · ${v.stock > 0 ? v.stock + ' in stock' : 'Sold out'}`}</Body> : null}
            <Button title="Add to cart" disabled={!v || v.stock === 0 || offline} onPress={() => v && add(v.variant_id)} />
          </Card>
        );
      })}
      <Card>
        <Title>Cart</Title>
        {lines.length === 0 ? <Muted>Your cart is empty.</Muted> : null}
        {lines.map(([id, q]) => (
          <View key={id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ flex: 1, fontSize: font.body, color: colors.text }}>{`${variants.get(id)?.product} (${variants.get(id)?.size})`}</Text>
            <Button kind="secondary" title="−" accessibilityHint="Remove one" onPress={() => dec(id)} style={{ width: 48 }} />
            <Text style={{ width: 32, textAlign: 'center', fontSize: font.body, color: colors.text }}>{q}</Text>
            <Button kind="secondary" title="+" accessibilityHint="Add one" onPress={() => add(id)} style={{ width: 48 }} />
          </View>
        ))}
        {lines.length ? (
          <>
            <Body bold>Subtotal: {money(subtotal)}</Body>
            <Text style={{ fontSize: font.body, color: colors.text, marginTop: space.sm }}>Discount code (optional)</Text>
            <TextInput accessibilityLabel="Discount code" style={inputStyle} autoCapitalize="characters" value={code} onChangeText={setCode} placeholder="WELCOME10" placeholderTextColor={colors.muted} />
            <Body bold>Payment method (mock gateway)</Body>
            {PAYMENTS.map((p) => <Button key={p.token} kind={token === p.token ? 'primary' : 'secondary'} title={p.label} onPress={() => setToken(p.token)} />)}
            {err ? <ErrorBox text={err} /> : null}
            {!sync.online ? <Notice tone="warning" text="Checkout needs a connection." /> : null}
            <Button title={busy ? 'Processing…' : 'Buy now'} disabled={busy || !sync.online} onPress={pay} />
          </>
        ) : null}
      </Card>
    </ScrollView>
  );
}
