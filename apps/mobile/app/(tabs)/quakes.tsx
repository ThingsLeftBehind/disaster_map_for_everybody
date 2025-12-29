import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchJson, toApiError, type ApiError } from '@/src/api/client';
import type { JmaQuakeItem, JmaQuakesResponse } from '@/src/api/types';
import { SecondaryButton, Skeleton, TabScreen } from '@/src/ui/system';
import { colors, radii, spacing, typography } from '@/src/ui/theme';

type QuakeTab = 'latest' | 'guide';

type GuideSection = {
  label: string;
  effects: string;
  actions: string[];
};

const GUIDE_SECTIONS: GuideSection[] = [
  {
    label: '0–2',
    effects: '揺れを感じる程度。大きな被害は少ない。',
    actions: ['落下物に注意', '情報を確認', '出口を確認'],
  },
  {
    label: '3',
    effects: '屋内の棚が揺れる。',
    actions: ['頭上に注意', '出口を確保', '火の元を確認'],
  },
  {
    label: '4',
    effects: '物が落ちる。揺れを強く感じる。',
    actions: ['身を守る', 'ガス・電気の安全確認', '出口確保'],
  },
  {
    label: '5弱',
    effects: '家具が動き始める。',
    actions: ['倒れやすい場所から離れる', '避難経路を確保', '落下物に注意'],
  },
  {
    label: '5強',
    effects: '家具の転倒が始まる。',
    actions: ['身を守る行動を優先', '火の元確認', '家族の安否確認'],
  },
  {
    label: '6弱',
    effects: '立っていることが難しい。',
    actions: ['頭を守る', '避難準備', '余震に備える'],
  },
  {
    label: '6強',
    effects: '大きな被害の恐れ。',
    actions: ['直ちに安全確保', '倒壊の恐れから離れる', '避難指示に従う'],
  },
  {
    label: '7',
    effects: '非常に危険。',
    actions: ['直ちに命を守る行動', '安全な場所へ避難', '余震に注意'],
  },
];

const QUICK_ACTIONS = ['身を守る', '火の元を確認', '出口を確保', '落下物に注意'];

export default function QuakesScreen() {
  const [quakes, setQuakes] = useState<JmaQuakesResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<QuakeTab>('latest');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [guideExpanded, setGuideExpanded] = useState<Record<string, boolean>>({});

  const loadQuakes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await fetchJson<JmaQuakesResponse>('/api/jma/quakes');
      setQuakes(data);
      if (data.fetchStatus !== 'OK') {
        setNotice(data.lastError ?? '更新が遅れています');
      }
    } catch (err) {
      setQuakes(null);
      setError(toApiError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQuakes();
  }, [loadQuakes]);

  const items = useMemo(() => quakes?.items ?? [], [quakes]);
  const latestItem = useMemo(() => pickLatestItem(items), [items]);
  const maxIntensityItem = useMemo(() => pickMaxIntensityItem(items), [items]);
  const strongItems = useMemo(() => items.filter((item) => isStrongIntensity(item.maxIntensity)), [items]);
  const lastUpdated = quakes?.updatedAt ?? latestItem?.time ?? null;
  const emptyState = !isLoading && !error && items.length === 0;

  return (
    <TabScreen title="地震">
      <QuakesHeader
        updatedAt={lastUpdated}
        fetchStatus={quakes?.fetchStatus ?? null}
        notice={notice}
        onRefresh={loadQuakes}
        isLoading={isLoading}
      />

      <QuakesSegTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'latest' ? (
        <>
          {error ? <FetchStateBanner message="地震情報を取得できませんでした" onRetry={loadQuakes} /> : null}
          <QuakesSummary maxItem={maxIntensityItem} latestItem={latestItem} />
          {isLoading ? <QuakeSkeletonList /> : null}
          {emptyState ? <Text style={styles.noticeText}>地震情報がありません。</Text> : null}
          {!isLoading && items.length > 0 ? (
            <>
              <QuakeList
                title="最近の地震"
                items={items}
                expandedIds={expandedIds}
                onToggle={(id) =>
                  setExpandedIds((prev) => ({
                    ...prev,
                    [id]: !prev[id],
                  }))
                }
              />
              <StrongQuakesSection items={strongItems} />
            </>
          ) : null}
        </>
      ) : (
        <>
          <QuickActionCard />
          <IntensityGuideAccordion
            sections={GUIDE_SECTIONS}
            expanded={guideExpanded}
            onToggle={(label) =>
              setGuideExpanded((prev) => ({
                ...prev,
                [label]: !prev[label],
              }))
            }
          />
          <Text style={styles.disclaimer}>気象庁の情報を参考に、自治体の指示に従ってください。</Text>
        </>
      )}
    </TabScreen>
  );
}

function QuakesHeader({
  updatedAt,
  fetchStatus,
  notice,
  onRefresh,
  isLoading,
}: {
  updatedAt: string | null;
  fetchStatus: string | null;
  notice: string | null;
  onRefresh: () => void;
  isLoading: boolean;
}) {
  return (
    <View style={styles.headerBlock}>
      <View style={styles.headerRow}>
        <View style={styles.statusRow}>
          {fetchStatus ? <StatusDot tone={statusTone(fetchStatus)} /> : null}
          <Text style={styles.statusText}>
            最終更新: {updatedAt ? formatTimeShort(updatedAt) : '--:--'}
          </Text>
        </View>
        <Pressable style={styles.refreshButton} onPress={onRefresh}>
          <Text style={styles.refreshText}>{isLoading ? '更新中' : '更新'}</Text>
        </Pressable>
      </View>
      {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
    </View>
  );
}

function QuakesSegTabs({ activeTab, onChange }: { activeTab: QuakeTab; onChange: (tab: QuakeTab) => void }) {
  return (
    <View style={styles.segmentedControl}>
      <Pressable
        style={[styles.segmentButton, activeTab === 'latest' ? styles.segmentButtonActive : null]}
        onPress={() => onChange('latest')}
      >
        <Text style={[styles.segmentText, activeTab === 'latest' ? styles.segmentTextActive : null]}>速報</Text>
      </Pressable>
      <Pressable
        style={[styles.segmentButton, activeTab === 'guide' ? styles.segmentButtonActive : null]}
        onPress={() => onChange('guide')}
      >
        <Text style={[styles.segmentText, activeTab === 'guide' ? styles.segmentTextActive : null]}>目安と行動</Text>
      </Pressable>
    </View>
  );
}

function QuakesSummary({ maxItem, latestItem }: { maxItem: JmaQuakeItem | null; latestItem: JmaQuakeItem | null }) {
  const maxIntensity = formatIntensityLabel(maxItem?.maxIntensity ?? null);
  const maxRegion = maxItem ? pickRegionName(maxItem) : '情報なし';
  const maxTime = maxItem?.time ? formatTimeShort(maxItem.time) : null;

  const magnitude = latestItem?.magnitude ? `M${latestItem.magnitude}` : null;
  const depth = latestItem?.title ? extractDepth(latestItem.title) : null;

  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>直近の最大震度</Text>
        {maxItem ? (
          <View style={styles.summaryIntensityRow}>
            <IntensityBadge value={maxIntensity} />
            <View style={styles.summaryTextBlock}>
              <Text style={styles.summaryTitle}>{maxRegion}</Text>
              {maxTime ? <Text style={styles.summaryMeta}>{maxTime}</Text> : null}
            </View>
          </View>
        ) : (
          <Text style={styles.summaryMeta}>情報なし</Text>
        )}
      </View>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>M / 深さ</Text>
        <Text style={styles.summaryTitle}>{magnitude ?? '不明'}</Text>
        <Text style={styles.summaryMeta}>{depth ? `深さ ${depth}` : '深さ 不明'}</Text>
      </View>
    </View>
  );
}

function QuakeList({
  title,
  items,
  expandedIds,
  onToggle,
}: {
  title: string;
  items: JmaQuakeItem[];
  expandedIds: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.listStack}>
        {items.map((item) => (
          <QuakeCard
            key={item.id}
            item={item}
            expanded={!!expandedIds[item.id]}
            onToggle={() => onToggle(item.id)}
          />
        ))}
      </View>
    </View>
  );
}

function StrongQuakesSection({ items }: { items: JmaQuakeItem[] }) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>強い揺れ</Text>
      {items.length === 0 ? (
        <Text style={styles.noticeText}>記録はありません</Text>
      ) : (
        <View style={styles.listStack}>
          {items.map((item) => (
            <View key={item.id} style={styles.strongRow}>
              <IntensityBadge value={formatIntensityLabel(item.maxIntensity)} compact />
              <View style={styles.strongBody}>
                <Text style={styles.strongTitle}>{pickRegionName(item)}</Text>
                <Text style={styles.strongMeta}>{formatMetaLine(item)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function QuakeCard({ item, expanded, onToggle }: { item: JmaQuakeItem; expanded: boolean; onToggle: () => void }) {
  const intensity = formatIntensityLabel(item.maxIntensity);
  const metaLine = formatMetaLine(item);
  const depth = item.title ? extractDepth(item.title) : null;

  return (
    <View style={styles.quakeCard}>
      <Pressable onPress={onToggle} style={styles.quakeRow}>
        <IntensityBadge value={intensity} />
        <View style={styles.quakeMain}>
          <Text style={styles.quakeRegion}>{pickRegionName(item)}</Text>
          <Text style={styles.quakeMeta}>{metaLine}</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? 'v' : '>'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.quakeDetail}>
          {item.epicenter ? <Text style={styles.detailText}>震源: {item.epicenter}</Text> : null}
          {item.magnitude ? <Text style={styles.detailText}>規模: M{item.magnitude}</Text> : null}
          {depth ? <Text style={styles.detailText}>深さ: {depth}</Text> : null}
          {item.title ? <Text style={styles.detailText}>{item.title}</Text> : null}
          {item.link ? (
            <SecondaryButton label="詳細を開く" onPress={() => Linking.openURL(item.link as string)} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function QuickActionCard() {
  return (
    <View style={styles.quickCard}>
      <Text style={styles.quickTitle}>今すぐやること</Text>
      <View style={styles.quickList}>
        {QUICK_ACTIONS.map((item) => (
          <Text key={item} style={styles.quickItem}>{`• ${item}`}</Text>
        ))}
      </View>
    </View>
  );
}

function IntensityGuideAccordion({
  sections,
  expanded,
  onToggle,
}: {
  sections: GuideSection[];
  expanded: Record<string, boolean>;
  onToggle: (label: string) => void;
}) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>揺れの目安と行動</Text>
      <View style={styles.listStack}>
        {sections.map((section) => {
          const isOpen = !!expanded[section.label];
          return (
            <View key={section.label} style={styles.guideCard}>
              <Pressable onPress={() => onToggle(section.label)} style={styles.guideHeader}>
                <Text style={styles.guideLabel}>{section.label}</Text>
                <Text style={styles.guideToggle}>{isOpen ? '閉じる' : '開く'}</Text>
              </Pressable>
              {isOpen ? (
                <View style={styles.guideBody}>
                  <Text style={styles.guideSubLabel}>起こりうること</Text>
                  <Text style={styles.guideText}>{section.effects}</Text>
                  <Text style={styles.guideSubLabel}>すぐやること</Text>
                  {section.actions.map((action) => (
                    <Text key={action} style={styles.guideText}>{`• ${action}`}</Text>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function FetchStateBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{message}</Text>
      <SecondaryButton label="再試行" onPress={onRetry} />
    </View>
  );
}

function QuakeSkeletonList() {
  return (
    <View style={styles.skeletonList}>
      {[0, 1, 2, 3, 4].map((item) => (
        <View key={item} style={styles.skeletonCard}>
          <Skeleton width="60%" />
          <Skeleton width="80%" />
          <Skeleton width="40%" />
        </View>
      ))}
    </View>
  );
}

function IntensityBadge({ value, compact = false }: { value: string; compact?: boolean }) {
  const tone = intensityTone(value);
  const toneStyle = intensityToneStyles[tone];
  return (
    <View style={[styles.intensityBadge, compact ? styles.intensityBadgeCompact : null, toneStyle.container]}>
      <Text style={[styles.intensityText, toneStyle.text]}>{value}</Text>
    </View>
  );
}

function StatusDot({ tone }: { tone: IntensityTone }) {
  const toneStyle = intensityToneStyles[tone];
  return <View style={[styles.statusDot, toneStyle.container]} />;
}

type IntensityTone = 'neutral' | 'info' | 'warning' | 'danger';

const intensityToneStyles: Record<IntensityTone, { container: object; text: object }> = {
  neutral: {
    container: { backgroundColor: colors.surfaceStrong, borderColor: colors.border },
    text: { color: colors.text },
  },
  info: {
    container: { backgroundColor: colors.statusBgInfo, borderColor: colors.statusInfo },
    text: { color: colors.statusInfo },
  },
  warning: {
    container: { backgroundColor: colors.statusBgWarning, borderColor: colors.statusWarning },
    text: { color: colors.statusWarning },
  },
  danger: {
    container: { backgroundColor: colors.statusBgDanger, borderColor: colors.statusDanger },
    text: { color: colors.statusDanger },
  },
};

function intensityTone(value: string) {
  const rank = intensityRank(value);
  if (rank >= 6) return 'danger';
  if (rank >= 5) return 'warning';
  if (rank >= 4) return 'info';
  return 'neutral';
}

function intensityRank(value: string | null) {
  if (!value) return -1;
  const label = formatIntensityLabel(value);
  switch (label) {
    case '7':
      return 7;
    case '6強':
      return 6.7;
    case '6弱':
      return 6.3;
    case '5強':
      return 5.7;
    case '5弱':
      return 5.3;
    case '4':
      return 4;
    case '3':
      return 3;
    case '2':
      return 2;
    case '1':
      return 1;
    case '0':
      return 0;
    default:
      return -1;
  }
}

function formatIntensityLabel(value: string | null) {
  if (!value) return '不明';
  if (value.includes('5-') || value.includes('5弱')) return '5弱';
  if (value.includes('5+') || value.includes('5強')) return '5強';
  if (value.includes('6-') || value.includes('6弱')) return '6弱';
  if (value.includes('6+') || value.includes('6強')) return '6強';
  if (value.includes('7')) return '7';
  if (value.includes('4')) return '4';
  if (value.includes('3')) return '3';
  if (value.includes('2')) return '2';
  if (value.includes('1')) return '1';
  if (value.includes('0')) return '0';
  return value;
}

function isStrongIntensity(value: string | null) {
  return intensityRank(value) >= 5.3;
}

function pickRegionName(item: JmaQuakeItem) {
  return item.epicenter ?? item.title ?? '震源不明';
}

function pickLatestItem(items: JmaQuakeItem[]) {
  if (items.length === 0) return null;
  return items.reduce((latest, item) => {
    const latestTime = latest.time ? Date.parse(latest.time) : -Infinity;
    const currentTime = item.time ? Date.parse(item.time) : -Infinity;
    return currentTime > latestTime ? item : latest;
  }, items[0]);
}

function pickMaxIntensityItem(items: JmaQuakeItem[]) {
  if (items.length === 0) return null;
  return items.reduce((maxItem, item) => {
    const maxRank = intensityRank(maxItem.maxIntensity ?? null);
    const currentRank = intensityRank(item.maxIntensity ?? null);
    if (currentRank > maxRank) return item;
    if (currentRank === maxRank) {
      const maxTime = maxItem.time ? Date.parse(maxItem.time) : -Infinity;
      const currentTime = item.time ? Date.parse(item.time) : -Infinity;
      return currentTime > maxTime ? item : maxItem;
    }
    return maxItem;
  }, items[0]);
}

function formatMetaLine(item: JmaQuakeItem) {
  const time = item.time ? formatTimeShort(item.time) : '時刻不明';
  const magnitude = item.magnitude ? `M${item.magnitude}` : 'M不明';
  const depth = item.title ? extractDepth(item.title) : null;
  const depthText = depth ? `深さ${depth}` : '深さ不明';
  return `${time} · ${magnitude} · ${depthText}`;
}

function extractDepth(title: string) {
  const match = title.match(/深さ\s*([0-9]+)\s*km/i);
  if (match?.[1]) return `${match[1]}km`;
  if (title.includes('ごく浅い')) return 'ごく浅い';
  return null;
}

function formatTimeShort(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function statusTone(status: string) {
  if (status === 'OK') return 'info' as const;
  if (status === 'DEGRADED') return 'warning' as const;
  if (status === 'DOWN') return 'danger' as const;
  return 'neutral' as const;
}

const styles = StyleSheet.create({
  headerBlock: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  statusText: {
    ...typography.caption,
    color: colors.muted,
  },
  refreshButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  refreshText: {
    ...typography.caption,
    color: colors.text,
  },
  noticeText: {
    ...typography.caption,
    color: colors.muted,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: colors.background,
  },
  segmentText: {
    ...typography.caption,
    color: colors.muted,
  },
  segmentTextActive: {
    color: colors.text,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  summaryCard: {
    flex: 1,
    minWidth: 150,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
    gap: spacing.xs,
  },
  summaryLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  summaryTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  summaryMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  summaryIntensityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryTextBlock: {
    gap: spacing.xs,
    flex: 1,
  },
  sectionBlock: {
    marginTop: spacing.md,
  },
  sectionTitle: {
    ...typography.subtitle,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  listStack: {
    gap: spacing.sm,
  },
  quakeCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  quakeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  quakeMain: {
    flex: 1,
    gap: spacing.xs,
  },
  quakeRegion: {
    ...typography.subtitle,
    color: colors.text,
  },
  quakeMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  chevron: {
    ...typography.caption,
    color: colors.muted,
  },
  quakeDetail: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  detailText: {
    ...typography.caption,
    color: colors.text,
  },
  strongRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  strongBody: {
    flex: 1,
    gap: spacing.xs,
  },
  strongTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  strongMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  quickCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  quickTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  quickList: {
    gap: spacing.xs,
  },
  quickItem: {
    ...typography.body,
    color: colors.text,
  },
  guideCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  guideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  guideLabel: {
    ...typography.subtitle,
    color: colors.text,
  },
  guideToggle: {
    ...typography.caption,
    color: colors.muted,
  },
  guideBody: {
    gap: spacing.xs,
  },
  guideSubLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  guideText: {
    ...typography.small,
    color: colors.text,
  },
  disclaimer: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.lg,
  },
  banner: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  bannerText: {
    ...typography.body,
    color: colors.text,
  },
  skeletonList: {
    marginTop: spacing.md,
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
  intensityBadge: {
    minWidth: 52,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  intensityBadgeCompact: {
    minWidth: 42,
    paddingHorizontal: spacing.xs,
  },
  intensityText: {
    ...typography.caption,
    fontWeight: '600',
  },
});
