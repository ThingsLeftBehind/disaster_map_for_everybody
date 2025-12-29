import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import { fetchJson } from '@/src/api/client';
import type {
  JmaStatusResponse,
  JmaWarningsResponse,
  Prefecture,
  PrefecturesResponse,
} from '@/src/api/types';
import { Button, Card, Input, Screen, SectionTitle, TextBlock, Toggle } from '@/src/ui/kit';
import { colors, spacing } from '@/src/ui/theme';

type PermissionState = 'unknown' | 'granted' | 'denied';

type LatLng = {
  lat: number;
  lon: number;
};

const DEFAULT_AREA = '130000';

export default function AlertsScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<JmaStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<JmaWarningsResponse | null>(null);
  const [warningsError, setWarningsError] = useState<string | null>(null);
  const [warningsNotice, setWarningsNotice] = useState<string | null>(null);
  const [isStatusLoading, setIsStatusLoading] = useState(false);
  const [isWarningsLoading, setIsWarningsLoading] = useState(false);
  const [useCurrent, setUseCurrent] = useState(true);
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [currentPrefCode, setCurrentPrefCode] = useState<string | null>(null);
  const [manualPref, setManualPref] = useState<Prefecture | null>(null);
  const [prefectures, setPrefectures] = useState<Prefecture[]>([]);
  const [prefListOpen, setPrefListOpen] = useState(false);
  const [prefFilter, setPrefFilter] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await fetchJson<PrefecturesResponse>('/api/ref/municipalities');
        if (!active) return;
        setPrefectures(data.prefectures ?? []);
      } catch (err) {
        if (!active) return;
        setPrefectures([]);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      setIsStatusLoading(true);
      setStatusError(null);
      try {
        const data = await fetchJson<JmaStatusResponse>('/api/jma/status');
        if (!active) return;
        setStatus(data);
      } catch (err) {
        if (!active) return;
        setStatus(null);
        setStatusError(err instanceof Error ? err.message : 'Failed to load status');
      } finally {
        if (active) setIsStatusLoading(false);
      }
    };
    void loadStatus();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!useCurrent) return;
    let active = true;
    const locate = async () => {
      try {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (!active) return;
        if (perm !== 'granted') {
          setPermission('denied');
          setCurrentPrefCode(null);
          return;
        }
        setPermission('granted');
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!active) return;
        const coords = { lat: position.coords.latitude, lon: position.coords.longitude };
        const prefCode = await reverseGeocodePrefCode(coords);
        if (!active) return;
        setCurrentPrefCode(prefCode);
      } catch (err) {
        if (!active) return;
        setCurrentPrefCode(null);
      }
    };
    void locate();
    return () => {
      active = false;
    };
  }, [useCurrent]);

  const areaCode = useMemo(() => {
    if (useCurrent && currentPrefCode) return `${currentPrefCode}0000`;
    if (manualPref?.prefCode) return `${manualPref.prefCode}0000`;
    return DEFAULT_AREA;
  }, [currentPrefCode, manualPref?.prefCode, useCurrent]);

  const areaLabel = useMemo(() => {
    if (useCurrent && currentPrefCode) {
      const name = prefectures.find((p) => p.prefCode === currentPrefCode)?.prefName ?? null;
      return name ? `現在地: ${name}` : '現在地: エリア未取得';
    }
    if (manualPref?.prefName) return `手動: ${manualPref.prefName}`;
    return '既定: 東京';
  }, [currentPrefCode, manualPref?.prefName, prefectures, useCurrent]);

  useEffect(() => {
    let active = true;
    const loadWarnings = async () => {
      setIsWarningsLoading(true);
      setWarningsError(null);
      setWarningsNotice(null);
      try {
        const data = await fetchJson<JmaWarningsResponse>(`/api/jma/warnings?area=${areaCode}`);
        if (!active) return;
        setWarnings(data);
        if (data.fetchStatus !== 'OK') {
          setWarningsNotice(data.lastError ?? '更新が遅れています');
        }
      } catch (err) {
        if (!active) return;
        setWarnings(null);
        setWarningsError(err instanceof Error ? err.message : 'Failed to load warnings');
      } finally {
        if (active) setIsWarningsLoading(false);
      }
    };
    void loadWarnings();
    return () => {
      active = false;
    };
  }, [areaCode]);

  const dedupedItems = useMemo(() => dedupeWarnings(warnings?.items ?? []), [warnings?.items]);
  const urgentItems = dedupedItems.filter((item) => isWarning(item.kind));
  const advisoryItems = dedupedItems.filter((item) => isAdvisory(item.kind));

  const emptyState = !isWarningsLoading && !warningsError && dedupedItems.length === 0;

  return (
    <Screen title="Alerts" rightAction={{ label: 'Settings', onPress: () => router.push('/settings') }}>
      <Card>
        <SectionTitle>JMAステータス</SectionTitle>
        {isStatusLoading ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.text} />
            <TextBlock>更新中...</TextBlock>
          </View>
        ) : null}
        {status ? <StatusChip status={status.fetchStatus} updatedAt={status.updatedAt} /> : null}
        {statusError ? <TextBlock muted>{statusError}</TextBlock> : null}
      </Card>

      <Card>
        <SectionTitle>エリア</SectionTitle>
        <Toggle label={useCurrent ? '現在地: ON' : '現在地: OFF'} value={useCurrent} onToggle={() => setUseCurrent((v) => !v)} />
        <TextBlock muted>{areaLabel}</TextBlock>
        {useCurrent && permission === 'denied' ? (
          <>
            <TextBlock>位置情報がオフです。現在地エリアを取得できません。</TextBlock>
            <Button label="設定を開く" variant="secondary" onPress={() => Linking.openSettings()} />
          </>
        ) : null}
        <Button
          label={manualPref ? `手動エリア: ${manualPref.prefName}` : '手動エリアを選択'}
          variant="secondary"
          onPress={() => setPrefListOpen((v) => !v)}
        />
        {prefListOpen ? (
          <>
            <Input value={prefFilter} placeholder="都道府県を絞り込み" onChangeText={setPrefFilter} />
            <View style={styles.listWrap}>
              {prefectures
                .filter((p) => (prefFilter ? p.prefName.includes(prefFilter.trim()) : true))
                .map((pref) => (
                  <Pressable
                    key={pref.prefCode}
                    style={styles.listItem}
                    onPress={() => {
                      setManualPref(pref);
                      setPrefListOpen(false);
                    }}
                  >
                    <TextBlock>{pref.prefName}</TextBlock>
                  </Pressable>
                ))}
            </View>
          </>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>警報・注意報</SectionTitle>
        <TextBlock muted>対象エリア: {warnings?.areaName ?? areaCode}</TextBlock>
        {isWarningsLoading ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.text} />
            <TextBlock>読み込み中...</TextBlock>
          </View>
        ) : null}
        {warningsNotice ? <TextBlock muted>{warningsNotice}</TextBlock> : null}
        {warningsError ? <TextBlock muted>{warningsError}</TextBlock> : null}
        {emptyState ? <TextBlock muted>発表中の警報・注意報はありません。</TextBlock> : null}
      </Card>

      {dedupedItems.length > 0 ? (
        <Card>
          <SectionTitle>概要</SectionTitle>
          <TextBlock>警報: {urgentItems.length}件</TextBlock>
          <TextBlock>注意報: {advisoryItems.length}件</TextBlock>
        </Card>
      ) : null}

      {urgentItems.length > 0 ? (
        <Card>
          <SectionTitle>警報</SectionTitle>
          {urgentItems.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <TextBlock>{item.kind}</TextBlock>
              {shouldShowStatus(item.status) ? <TextBlock muted>{item.status}</TextBlock> : null}
            </View>
          ))}
        </Card>
      ) : null}

      {advisoryItems.length > 0 ? (
        <Card>
          <SectionTitle>注意報</SectionTitle>
          {advisoryItems.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <TextBlock>{item.kind}</TextBlock>
              {shouldShowStatus(item.status) ? <TextBlock muted>{item.status}</TextBlock> : null}
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function StatusChip({ status, updatedAt }: { status: string; updatedAt: string | null }) {
  const isOk = status === 'OK';
  return (
    <View style={[styles.chip, isOk ? styles.chipOk : styles.chipWarn]}>
      <Text style={[styles.chipText, isOk ? styles.chipTextOn : styles.chipTextOff]}>状態: {status}</Text>
      {updatedAt ? (
        <Text style={[styles.chipSub, isOk ? styles.chipTextOn : styles.chipTextOff]}>{formatTime(updatedAt)}</Text>
      ) : null}
    </View>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

function dedupeWarnings(items: JmaWarningsResponse['items']) {
  const seen = new Set<string>();
  const result: JmaWarningsResponse['items'] = [];
  for (const item of items) {
    const key = `${item.kind}|${item.status ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function isWarning(kind: string) {
  if (!kind) return false;
  return kind.includes('警報') || kind.includes('特別警報');
}

function isAdvisory(kind: string) {
  if (!kind) return false;
  return kind.includes('注意報');
}

function shouldShowStatus(status: string | null) {
  if (!status) return false;
  if (status.includes('継続')) return false;
  return true;
}

async function reverseGeocodePrefCode(coords: LatLng): Promise<string | null> {
  const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${encodeURIComponent(
    coords.lon
  )}&lat=${encodeURIComponent(coords.lat)}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;
  const json = await response.json();
  const muniRaw = json?.results?.muniCd ?? null;
  const { prefCode } = normalizeMuniCode(muniRaw);
  return prefCode;
}

function computeCheckDigit(code5: string): string {
  const digits = code5.split('').map((ch) => Number(ch));
  if (digits.length !== 5 || digits.some((d) => !Number.isFinite(d))) return '0';
  const weights = [6, 5, 4, 3, 2];
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const remainder = sum % 11;
  const cd = (11 - remainder) % 11;
  return cd === 10 ? '0' : String(cd);
}

function normalizeMuniCode(raw: unknown): { muniCode: string | null; prefCode: string | null } {
  if (typeof raw !== 'string') return { muniCode: null, prefCode: null };
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { muniCode: null, prefCode: null };

  if (digits.length === 6) {
    const prefCode = digits.slice(0, 2);
    return { muniCode: digits, prefCode: /^\d{2}$/.test(prefCode) ? prefCode : null };
  }

  if (digits.length <= 5) {
    const base5 = digits.padStart(5, '0');
    if (!/^\d{5}$/.test(base5)) return { muniCode: null, prefCode: null };
    const muniCode = `${base5}${computeCheckDigit(base5)}`;
    const prefCode = base5.slice(0, 2);
    return { muniCode, prefCode: /^\d{2}$/.test(prefCode) ? prefCode : null };
  }

  return { muniCode: null, prefCode: null };
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chip: {
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  chipOk: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  chipWarn: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  chipSub: {
    fontSize: 12,
  },
  chipTextOn: {
    color: colors.background,
  },
  chipTextOff: {
    color: colors.text,
  },
  listWrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.sm,
    marginBottom: spacing.md,
    maxHeight: 240,
  },
  listItem: {
    paddingVertical: spacing.xs,
  },
  itemRow: {
    marginBottom: spacing.sm,
  },
});
