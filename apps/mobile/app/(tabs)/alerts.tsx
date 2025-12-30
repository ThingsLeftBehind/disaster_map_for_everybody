import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { fetchJson, toApiError, type ApiError } from '@/src/api/client';
import type { JmaWarningItem, JmaWarningsResponse, Prefecture, PrefecturesResponse } from '@/src/api/types';
import { SecondaryButton, Skeleton, TabScreen, TextField } from '@/src/ui/system';
import { radii, spacing, typography, useThemedStyles } from '@/src/ui/theme';

const DEFAULT_AREA = '130000';
const SAVED_AREAS_KEY = 'hinanavi_saved_areas_v1';
const MAX_SAVED_AREAS = 5;

type PermissionState = 'unknown' | 'granted' | 'denied';

type LatLng = {
  lat: number;
  lon: number;
};

type Severity = 'special' | 'warning' | 'advisory';

type WarningGuide = {
  description: string;
  actions: string[];
};

type SavedArea = {
  prefCode: string;
  prefName: string;
};

type NormalizedWarning = {
  id: string;
  kind: string;
  phenomenon: string;
  severity: Severity;
  guide: WarningGuide;
};

const GUIDE_MAP: { patterns: RegExp[]; description: string; actions: string[] }[] = [
  {
    patterns: [/雷/, /落雷/],
    description: '落雷や突風の危険があります。',
    actions: ['屋外を避ける', '金属製品から離れる'],
  },
  {
    patterns: [/大雨/],
    description: '短時間の強い雨で浸水のおそれ。',
    actions: ['低地を避ける', '避難情報を確認'],
  },
  {
    patterns: [/洪水/],
    description: '河川の増水に警戒。',
    actions: ['川沿いに近づかない', '高い場所へ'],
  },
  {
    patterns: [/強風/, /暴風/],
    description: '飛来物や倒木の危険。',
    actions: ['外出を控える', '窓を養生'],
  },
  {
    patterns: [/波浪/],
    description: '高波に警戒。',
    actions: ['海岸に近づかない', '漁港を避ける'],
  },
  {
    patterns: [/濃霧/],
    description: '視界不良が発生します。',
    actions: ['速度を落とす', '無理な外出を控える'],
  },
  {
    patterns: [/大雪/],
    description: '路面凍結や交通障害に注意。',
    actions: ['不要不急の外出を控える', '交通情報を確認'],
  },
  {
    patterns: [/乾燥/],
    description: '火災が発生しやすい状態です。',
    actions: ['火の取り扱い注意', '換気と加湿'],
  },
  {
    patterns: [/熱中症/],
    description: '熱中症の危険があります。',
    actions: ['水分補給', '涼しい場所へ'],
  },
];

const FALLBACK_GUIDE: WarningGuide = {
  description: '公式情報を確認してください。',
  actions: ['周囲の安全確保', '避難情報に注意'],
};

export default function AlertsScreen() {
  const styles = useThemedStyles(createStyles);
  const [warnings, setWarnings] = useState<JmaWarningsResponse | null>(null);
  const [warningsError, setWarningsError] = useState<ApiError | null>(null);
  const [isWarningsLoading, setIsWarningsLoading] = useState(false);
  const [useCurrent, setUseCurrent] = useState(true);
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [currentPrefCode, setCurrentPrefCode] = useState<string | null>(null);
  const [manualPref, setManualPref] = useState<Prefecture | null>(null);
  const [prefectures, setPrefectures] = useState<Prefecture[]>([]);
  const [prefListOpen, setPrefListOpen] = useState(false);
  const [prefFilter, setPrefFilter] = useState('');
  const [prefLoading, setPrefLoading] = useState(false);
  const [prefError, setPrefError] = useState<ApiError | null>(null);
  const [savedAreas, setSavedAreas] = useState<SavedArea[]>([]);
  const [selectedFromSaved, setSelectedFromSaved] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setPrefLoading(true);
      setPrefError(null);
      try {
        const data = await fetchJson<PrefecturesResponse>('/api/ref/municipalities');
        if (!active) return;
        setPrefectures(data.prefectures ?? []);
      } catch (err) {
        if (!active) return;
        setPrefectures([]);
        setPrefError(toApiError(err));
      } finally {
        if (active) setPrefLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadSaved = async () => {
      try {
        const raw = await AsyncStorage.getItem(SAVED_AREAS_KEY);
        if (!raw || !active) return;
        const parsed = JSON.parse(raw) as SavedArea[];
        if (!Array.isArray(parsed)) return;
        setSavedAreas(parsed.filter((item) => item?.prefCode && item?.prefName));
      } catch {
        if (!active) return;
        setSavedAreas([]);
      }
    };
    void loadSaved();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(SAVED_AREAS_KEY, JSON.stringify(savedAreas));
  }, [savedAreas]);

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
      } catch {
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

  const defaultPrefName = useMemo(
    () => prefectures.find((pref) => pref.prefCode === DEFAULT_AREA.slice(0, 2))?.prefName ?? '東京',
    [prefectures]
  );

  const areaName = useMemo(() => {
    if (useCurrent) {
      const name = prefectures.find((p) => p.prefCode === currentPrefCode)?.prefName ?? null;
      return name ?? defaultPrefName;
    }
    if (manualPref?.prefName) return manualPref.prefName;
    return defaultPrefName;
  }, [currentPrefCode, defaultPrefName, manualPref?.prefName, prefectures, useCurrent]);

  const areaModeLabel = useMemo(() => {
    if (useCurrent) return '現在地';
    return selectedFromSaved ? '保存エリア' : '手動';
  }, [selectedFromSaved, useCurrent]);

  const loadWarnings = useCallback(async () => {
    setIsWarningsLoading(true);
    setWarningsError(null);
    try {
      const data = await fetchJson<JmaWarningsResponse>(`/api/jma/warnings?area=${areaCode}`);
      setWarnings(data);
    } catch (err) {
      setWarnings(null);
      setWarningsError(toApiError(err));
    } finally {
      setIsWarningsLoading(false);
    }
  }, [areaCode]);

  useEffect(() => {
    void loadWarnings();
  }, [loadWarnings]);

  const dedupedItems = useMemo(() => dedupeWarnings(warnings?.items ?? []), [warnings?.items]);

  const normalizedItems = useMemo(() => {
    return dedupedItems.map((item) => {
      const severity = getSeverity(item.kind);
      const phenomenon = normalizePhenomenon(item.kind);
      const guide = getGuide(phenomenon);
      return {
        id: item.id,
        kind: item.kind,
        phenomenon,
        severity,
        guide,
      };
    });
  }, [dedupedItems]);

  const grouped = useMemo(() => {
    const groups: Record<Severity, NormalizedWarning[]> = { special: [], warning: [], advisory: [] };
    normalizedItems.forEach((item) => {
      groups[item.severity].push(item);
    });
    return groups;
  }, [normalizedItems]);

  const totalCount = normalizedItems.length;
  const emptyState = !isWarningsLoading && !warningsError && totalCount === 0;

  const handleSelectSaved = useCallback(
    (area: SavedArea) => {
      setManualPref({ prefCode: area.prefCode, prefName: area.prefName });
      setUseCurrent(false);
      setSelectedFromSaved(true);
      setPrefListOpen(false);
    },
    []
  );

  const handleSelectPref = useCallback(
    (pref: Prefecture) => {
      setManualPref(pref);
      setUseCurrent(false);
      setSelectedFromSaved(false);
      setPrefListOpen(false);
      setSavedAreas((prev) => {
        const next = [{ prefCode: pref.prefCode, prefName: pref.prefName }, ...prev.filter((p) => p.prefCode !== pref.prefCode)];
        return next.slice(0, MAX_SAVED_AREAS);
      });
    },
    []
  );

  const filteredPrefectures = useMemo(() => {
    if (!prefFilter.trim()) return prefectures;
    return prefectures.filter((p) => p.prefName.includes(prefFilter.trim()));
  }, [prefFilter, prefectures]);

  return (
    <TabScreen title="警報">
      <View style={styles.headerBlock}>
        <Text style={styles.subtitle}>気象庁の発表をもとに表示</Text>
      </View>

      <AreaScopeCard
        areaName={areaName}
        modeLabel={areaModeLabel}
        onChange={() => setPrefListOpen(true)}
      />

      {warningsError ? <ErrorBanner message="警報情報を取得できませんでした" onRetry={loadWarnings} /> : null}

      <ActiveWarningsSection
        isLoading={isWarningsLoading}
        empty={emptyState}
        groups={grouped}
      />

      <DetailsAccordion items={dedupedItems} />

      <AreaScopeSheet
        visible={prefListOpen}
        onClose={() => setPrefListOpen(false)}
        useCurrent={useCurrent}
        onToggleCurrent={(next) => {
          setUseCurrent(next);
          if (next) {
            setSelectedFromSaved(false);
          }
        }}
        permission={permission}
        savedAreas={savedAreas}
        selectedPrefCode={!useCurrent ? manualPref?.prefCode ?? null : null}
        onSelectSaved={handleSelectSaved}
        filterValue={prefFilter}
        onChangeFilter={setPrefFilter}
        prefectures={filteredPrefectures}
        isLoading={prefLoading}
        error={prefError}
        onSelectPref={handleSelectPref}
      />
    </TabScreen>
  );
}

function AreaScopeCard({ areaName, modeLabel, onChange }: { areaName: string; modeLabel: string; onChange: () => void }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.scopeCard}>
      <View style={styles.scopeText}>
        <Text style={styles.scopeLabel}>対象エリア</Text>
        <Text style={styles.scopeName}>{areaName}</Text>
        <View style={styles.scopeMetaRow}>
          <View style={styles.modePill}>
            <Text style={styles.modePillText}>{modeLabel}</Text>
          </View>
        </View>
      </View>
      <SecondaryButton label="変更" onPress={onChange} />
    </View>
  );
}

function AreaScopeSheet({
  visible,
  onClose,
  useCurrent,
  onToggleCurrent,
  permission,
  savedAreas,
  selectedPrefCode,
  onSelectSaved,
  filterValue,
  onChangeFilter,
  prefectures,
  isLoading,
  error,
  onSelectPref,
}: {
  visible: boolean;
  onClose: () => void;
  useCurrent: boolean;
  onToggleCurrent: (next: boolean) => void;
  permission: PermissionState;
  savedAreas: SavedArea[];
  selectedPrefCode: string | null;
  onSelectSaved: (area: SavedArea) => void;
  filterValue: string;
  onChangeFilter: (value: string) => void;
  prefectures: Prefecture[];
  isLoading: boolean;
  error: ApiError | null;
  onSelectPref: (pref: Prefecture) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>対象エリアを変更</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.sheetClose}>閉じる</Text>
            </Pressable>
          </View>

          <View style={styles.sheetSection}>
            <Text style={styles.sheetLabel}>現在地</Text>
            <View style={styles.toggleRow}>
              <Pressable
                style={[styles.toggleButton, useCurrent ? styles.toggleButtonActive : null]}
                onPress={() => onToggleCurrent(true)}
              >
                <Text style={[styles.toggleText, useCurrent ? styles.toggleTextActive : null]}>ON</Text>
              </Pressable>
              <Pressable
                style={[styles.toggleButton, !useCurrent ? styles.toggleButtonActive : null]}
                onPress={() => onToggleCurrent(false)}
              >
                <Text style={[styles.toggleText, !useCurrent ? styles.toggleTextActive : null]}>OFF</Text>
              </Pressable>
            </View>
            {useCurrent && permission === 'denied' ? (
              <InlineBanner
                message="位置情報の許可が必要です。"
                actionLabel="設定を開く"
                onAction={() => Linking.openSettings()}
              />
            ) : null}
          </View>

          <View style={styles.sheetSection}>
            <Text style={styles.sheetLabel}>保存エリア</Text>
            {savedAreas.length === 0 ? (
              <Text style={styles.sheetMuted}>保存エリアはありません。</Text>
            ) : (
              <View style={styles.savedList}>
                {savedAreas.map((area) => (
                  <Pressable key={area.prefCode} style={styles.savedRow} onPress={() => onSelectSaved(area)}>
                    <Text style={styles.savedName}>{area.prefName}</Text>
                    <View style={[styles.radio, selectedPrefCode === area.prefCode ? styles.radioActive : null]}>
                      {selectedPrefCode === area.prefCode ? <View style={styles.radioDot} /> : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.sheetSection}>
            <Text style={styles.sheetLabel}>都道府県から選ぶ</Text>
            <TextField value={filterValue} placeholder="都道府県を検索" onChangeText={onChangeFilter} />
            {isLoading ? (
              <View style={styles.skeletonStack}>
                <Skeleton height={14} />
                <Skeleton width="70%" />
              </View>
            ) : null}
            {error ? <InlineBanner message="都道府県一覧を取得できませんでした。" /> : null}
            <ScrollView style={styles.prefList} contentContainerStyle={styles.prefListContent}>
              {prefectures.map((pref) => (
                <Pressable key={pref.prefCode} onPress={() => onSelectPref(pref)} style={styles.prefRow}>
                  <Text style={styles.prefName}>{pref.prefName}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ActiveWarningsSection({
  isLoading,
  empty,
  groups,
}: {
  isLoading: boolean;
  empty: boolean;
  groups: Record<Severity, NormalizedWarning[]>;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>発令中</Text>
      {isLoading ? <WarningSkeletonList /> : null}
      {empty ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>現在、発令中の警報・注意報はありません</Text>
          <Text style={styles.emptyNote}>状況は変わることがあります</Text>
        </View>
      ) : null}
      <WarningGroup label="特別警報" severity="special" items={groups.special} />
      <WarningGroup label="警報" severity="warning" items={groups.warning} />
      <WarningGroup label="注意報" severity="advisory" items={groups.advisory} />
    </View>
  );
}

function WarningGroup({
  label,
  severity,
  items,
}: {
  label: string;
  severity: Severity;
  items: NormalizedWarning[];
}) {
  const styles = useThemedStyles(createStyles);
  if (items.length === 0) return null;
  return (
    <View style={styles.groupBlock}>
      <View style={styles.groupHeader}>
        <Text style={styles.groupTitle}>{label}</Text>
        <Text style={styles.groupCount}>{items.length}件</Text>
      </View>
      <View style={styles.groupList}>
        {items.map((item) => (
          <WarningPhenomenonCard key={item.id} item={item} severity={severity} />
        ))}
      </View>
    </View>
  );
}

function WarningPhenomenonCard({ item, severity }: { item: NormalizedWarning; severity: Severity }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.warnCard}>
      <View style={styles.warnHeader}>
        <View style={styles.warnTitleRow}>
          <View style={styles.warnIcon} />
          <Text style={styles.warnTitle}>{item.phenomenon}</Text>
        </View>
        <SeverityBadge severity={severity} />
      </View>
      <Text style={styles.warnDescription}>{item.guide.description}</Text>
      <View style={styles.warnActions}>
        {item.guide.actions.slice(0, 2).map((action) => (
          <Text key={action} style={styles.warnAction}>{`• ${action}`}</Text>
        ))}
      </View>
    </View>
  );
}

function DetailsAccordion({ items }: { items: JmaWarningItem[] }) {
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.sectionBlock}>
      <Pressable onPress={() => setOpen((prev) => !prev)} style={styles.accordionHeader}>
        <Text style={styles.sectionTitle}>詳細（エリア別）</Text>
        <Text style={styles.accordionToggle}>{open ? '閉じる' : '開く'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.detailList}>
          {items.length === 0 ? (
            <Text style={styles.detailText}>詳細情報はありません。</Text>
          ) : (
            items.map((item) => (
              <View key={item.id} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{item.kind}</Text>
                {item.status ? <Text style={styles.detailText}>{item.status}</Text> : null}
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{message}</Text>
      <SecondaryButton label="再試行" onPress={onRetry} />
    </View>
  );
}

function InlineBanner({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.inlineBanner}>
      <Text style={styles.inlineBannerText}>{message}</Text>
      {actionLabel && onAction ? <SecondaryButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

function WarningSkeletonList() {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.skeletonList}>
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.skeletonCard}>
          <Skeleton width="60%" />
          <Skeleton width="40%" />
          <Skeleton width="70%" />
        </View>
      ))}
    </View>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const styles = useThemedStyles(createStyles);
  const label = severity === 'special' ? '特別' : severity === 'warning' ? '警報' : '注意';
  const toneStyle =
    severity === 'special'
      ? styles.badgeSpecial
      : severity === 'warning'
        ? styles.badgeWarning
        : styles.badgeAdvisory;
  return (
    <View style={[styles.badge, toneStyle]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

function dedupeWarnings(items: JmaWarningsResponse['items']) {
  const seen = new Set<string>();
  const result: JmaWarningsResponse['items'] = [];
  for (const item of items) {
    const key = item.kind;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function getSeverity(kind: string): Severity {
  if (kind.includes('特別警報')) return 'special';
  if (kind.includes('警報')) return 'warning';
  return 'advisory';
}

function normalizePhenomenon(kind: string): string {
  const trimmed = kind
    .replace('特別警報', '')
    .replace('警報', '')
    .replace('注意報', '')
    .trim();
  return trimmed.length > 0 ? trimmed : kind;
}

function getGuide(phenomenon: string): WarningGuide {
  for (const entry of GUIDE_MAP) {
    if (entry.patterns.some((pattern) => pattern.test(phenomenon))) {
      return { description: entry.description, actions: entry.actions };
    }
  }
  return FALLBACK_GUIDE;
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

const createStyles = (colors: {
  background: string;
  border: string;
  text: string;
  muted: string;
  surface: string;
  surfaceStrong: string;
  statusBgDanger: string;
  statusDanger: string;
  statusBgWarning: string;
  statusWarning: string;
  statusBgInfo: string;
  statusInfo: string;
}) =>
  StyleSheet.create({
  headerBlock: {
    marginBottom: spacing.md,
  },
  subtitle: {
    ...typography.caption,
    color: colors.muted,
  },
  scopeCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  scopeText: {
    flex: 1,
    gap: spacing.xs,
  },
  scopeLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  scopeName: {
    ...typography.subtitle,
    color: colors.text,
  },
  scopeMetaRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
  },
  modePill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  modePillText: {
    ...typography.caption,
    color: colors.text,
  },
  banner: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  bannerText: {
    ...typography.body,
    color: colors.text,
  },
  sectionBlock: {
    marginTop: spacing.lg,
  },
  sectionTitle: {
    ...typography.subtitle,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyState: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  emptyTitle: {
    ...typography.body,
    color: colors.text,
  },
  emptyNote: {
    ...typography.caption,
    color: colors.muted,
  },
  groupBlock: {
    marginTop: spacing.md,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  groupTitle: {
    ...typography.label,
    color: colors.text,
  },
  groupCount: {
    ...typography.caption,
    color: colors.muted,
  },
  groupList: {
    gap: spacing.sm,
  },
  warnCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
    gap: spacing.xs,
  },
  warnHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  warnTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  warnIcon: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.text,
  },
  warnTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  warnDescription: {
    ...typography.body,
    color: colors.text,
  },
  warnActions: {
    marginTop: spacing.xs,
    gap: spacing.xxs,
  },
  warnAction: {
    ...typography.small,
    color: colors.muted,
  },
  badge: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    ...typography.caption,
    color: colors.text,
  },
  badgeSpecial: {
    backgroundColor: colors.statusBgDanger,
    borderColor: colors.statusDanger,
  },
  badgeWarning: {
    backgroundColor: colors.statusBgWarning,
    borderColor: colors.statusWarning,
  },
  badgeAdvisory: {
    backgroundColor: colors.statusBgInfo,
    borderColor: colors.statusInfo,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accordionToggle: {
    ...typography.caption,
    color: colors.muted,
  },
  detailList: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  detailRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  detailLabel: {
    ...typography.body,
    color: colors.text,
  },
  detailText: {
    ...typography.caption,
    color: colors.muted,
  },
  skeletonList: {
    gap: spacing.sm,
  },
  skeletonCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetCard: {
    backgroundColor: colors.background,
    padding: spacing.lg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  sheetClose: {
    ...typography.caption,
    color: colors.text,
  },
  sheetSection: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  sheetLabel: {
    ...typography.label,
    color: colors.text,
  },
  sheetMuted: {
    ...typography.caption,
    color: colors.muted,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  toggleButtonActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  toggleText: {
    ...typography.label,
    color: colors.text,
  },
  toggleTextActive: {
    color: colors.background,
  },
  savedList: {
    gap: spacing.xs,
  },
  savedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  savedName: {
    ...typography.body,
    color: colors.text,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: colors.text,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.text,
  },
  prefList: {
    maxHeight: 280,
  },
  prefListContent: {
    paddingBottom: spacing.md,
  },
  prefRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  prefName: {
    ...typography.body,
    color: colors.text,
  },
  inlineBanner: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  inlineBannerText: {
    ...typography.caption,
    color: colors.text,
  },
  skeletonStack: {
    gap: spacing.xs,
  },
});
