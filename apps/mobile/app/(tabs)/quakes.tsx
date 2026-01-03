import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchJson, toApiError, type ApiError } from '@/src/api/client';
import type { JmaQuakeItem, JmaQuakesResponse } from '@/src/api/types';
import { SecondaryButton, Skeleton, TabScreen } from '@/src/ui/system';
import { radii, spacing, typography, useTheme, useThemedStyles } from '@/src/ui/theme';

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
  const styles = useThemedStyles(createStyles);
  const [quakes, setQuakes] = useState<JmaQuakesResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<QuakeTab>('latest');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [guideExpanded, setGuideExpanded] = useState<Record<string, boolean>>({});
  const [strongExpandedIds, setStrongExpandedIds] = useState<Record<string, boolean>>({});
  const loggedKeysRef = useRef(false);
  const loggedDepthRef = useRef(false);
  const loggedFilterRef = useRef('');

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

  useEffect(() => {
    if (!__DEV__ || !quakes?.items?.length) return;
    if (!loggedKeysRef.current) {
      loggedKeysRef.current = true;
      console.log('[Quakes] item keys', Object.keys(quakes.items[0] ?? {}));
    }
    if (!loggedDepthRef.current) {
      const sample = quakes.items.find((item) => typeof item.depthKm === 'number');
      if (sample) {
        loggedDepthRef.current = true;
        console.log('[Quakes] depth sample', { id: sample.id, depthKm: sample.depthKm, title: sample.title });
      }
    }
  }, [quakes]);

  const [strongVisibleCount, setStrongVisibleCount] = useState(3);
  const [recentVisibleCount, setRecentVisibleCount] = useState(10);

  const { filteredItems, filterStats } = useMemo(() => {
    const all = quakes?.items ?? [];
    const stats = { removed: 0, byReportType: 0, byTitle: 0 };
    const next = all.filter((item) => {
      if (!item.maxIntensity) return false;
      const reason = getSokuhouReason(item);
      if (reason) {
        stats.removed += 1;
        if (reason === 'reportType') stats.byReportType += 1;
        if (reason === 'title') stats.byTitle += 1;
        return false;
      }
      return true;
    });
    return { filteredItems: next, filterStats: stats };
  }, [quakes]);

  useEffect(() => {
    if (!__DEV__) return;
    const key = JSON.stringify(filterStats);
    if (key === loggedFilterRef.current) return;
    loggedFilterRef.current = key;
    if (filterStats.removed > 0) {
      console.log('[Quakes] filtered sokuhou', filterStats);
    }
  }, [filterStats]);

  const items = filteredItems;

  const latestItem = useMemo(() => pickLatestItem(items), [items]);


  const strongItems = useMemo(() => {
    // Q8: Last 7 days, Max Int desc, Top 9
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const candidates = items.filter(item => {
      if (!isStrongIntensity(item.maxIntensity)) return false;
      const t = item.time ? Date.parse(item.time) : 0;
      return t >= sevenDaysAgo;
    });

    return candidates.sort((a, b) => {
      const rankA = intensityRank(a.maxIntensity);
      const rankB = intensityRank(b.maxIntensity);
      if (rankA !== rankB) return rankB - rankA; // Descending rank
      // Tie-break: time desc
      const tA = a.time ? Date.parse(a.time) : 0;
      const tB = b.time ? Date.parse(b.time) : 0;
      return tB - tA;
    }).slice(0, 9);
  }, [items]);

  const strongCap = Math.min(9, strongItems.length);
  const recentCap = Math.min(100, items.length);
  const canShowMoreStrong = strongVisibleCount < strongCap;
  const canShowMoreRecent = recentVisibleCount < recentCap;

  const visibleStrong = strongItems.slice(0, strongVisibleCount);
  const visibleList = items.slice(0, recentVisibleCount);

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
          {isLoading ? <QuakeSkeletonList /> : null}
          {emptyState ? <Text style={styles.noticeText}>地震情報がありません。</Text> : null}
          {!isLoading && items.length > 0 ? (
            <>
              {strongItems.length > 0 ? (
                <StrongQuakesSection
                  items={visibleStrong}
                  canShowMore={canShowMoreStrong}
                  onShowMore={() => setStrongVisibleCount(prev => Math.min(prev + 3, 9))}
                  expandedIds={strongExpandedIds}
                  onToggle={(id) => setStrongExpandedIds(prev => ({ ...prev, [id]: !prev[id] }))}
                />
              ) : null}

              <QuakeList
                title="最近の地震"
                items={visibleList}
                expandedIds={expandedIds}
                onToggle={(id) =>
                  setExpandedIds((prev) => ({
                    ...prev,
                    [id]: !prev[id],
                  }))
                }
                canShowMore={canShowMoreRecent}
                onShowMore={() => setRecentVisibleCount((prev) => Math.min(prev + 10, 100))}
              />
            </>
          ) : null}
        </>
      ) : (
        <>
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
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
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



function QuakeList({
  title,
  items,
  expandedIds,
  onToggle,
  canShowMore,
  onShowMore,
}: {
  title: string;
  items: JmaQuakeItem[];
  expandedIds: Record<string, boolean>;
  onToggle: (id: string) => void;
  canShowMore: boolean;
  onShowMore: () => void;
}) {
  const styles = useThemedStyles(createStyles);
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
      {canShowMore ? (
        <View style={styles.paginationRow}>
          <LoadMoreButton onPress={onShowMore} />
        </View>
      ) : null}
    </View>
  );
}

function StrongQuakesSection({
  items, canShowMore, onShowMore, expandedIds, onToggle
}: {
  items: JmaQuakeItem[];
  canShowMore: boolean;
  onShowMore: () => void;
  expandedIds: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>最近の強い揺れ</Text>
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
      {canShowMore ? (
        <View style={styles.paginationRow}>
          <LoadMoreButton onPress={onShowMore} />
        </View>
      ) : null}
    </View>
  );
}

function LoadMoreButton({ onPress }: { onPress: () => void }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable style={styles.loadMoreButton} onPress={onPress}>
      <Text style={styles.loadMoreButtonText}>もっと見る</Text>
    </Pressable>
  );
}

function QuakeCard({ item, expanded, onToggle }: { item: JmaQuakeItem; expanded: boolean; onToggle: () => void }) {
  const styles = useThemedStyles(createStyles);
  const intensity = formatIntensityLabel(item.maxIntensity);
  const metaLine = formatMetaLine(item);
  const depth = formatDepthKm(item.depthKm) ?? (item.title ? extractDepth(item.title) : null);

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

          {item.intensityAreas && item.intensityAreas.length > 0 ? (
            <FeltPointsList areas={item.intensityAreas} />
          ) : null}

          {item.link ? (
            <SecondaryButton label="気象庁HPで見る" onPress={() => Linking.openURL(item.link as string)} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function FeltPointsList({ areas }: { areas: { intensity: string; areas: string[] }[] }) {
  const styles = useThemedStyles(createStyles);
  const rows = buildFeltAreaLines(areas);
  if (rows.length === 0) return null;
  return (
    <View style={styles.pointsStack}>
      {rows.map((row) => (
        <Text key={row.label} style={styles.feltLine}>
          {`震度${row.label}：${row.text}`}
        </Text>
      ))}
    </View>
  );
}

function QuickActionCard() {
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>揺れの目安と行動</Text>
      <View style={styles.listStack}>
        {sections.map((section) => {
          const isOpen = !!expanded[section.label];
          return (
            <View key={section.label} style={styles.guideCard}>
              <Pressable onPress={() => onToggle(section.label)} style={styles.guideHeader}>
                <View style={styles.guideTitleRow}>
                  <IntensityBadge value={section.label === '0–2' ? '2' : section.label} />
                  <Text style={styles.guideLabel}>{section.label}</Text>
                </View>
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
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{message}</Text>
      <SecondaryButton label="再試行" onPress={onRetry} />
    </View>
  );
}

function QuakeSkeletonList() {
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const tone = intensityTone(value);
  const toneStyle = getIntensityToneStyles(colors)[tone];
  const label = displayIntensity(value);
  return (
    <View style={[styles.intensityBadge, compact ? styles.intensityBadgeCompact : null, toneStyle.container]}>
      <Text style={[styles.intensityText, toneStyle.text]}>震度{label}</Text>
    </View>
  );
}

function StatusDot({ tone }: { tone: StatusTone }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const toneStyle = getStatusToneStyles(colors)[tone];
  return <View style={[styles.statusDot, toneStyle.container]} />;
}

type StatusTone = 'neutral' | 'info' | 'warning' | 'danger';

function getStatusToneStyles(colors: {
  surfaceStrong: string;
  border: string;
  statusBgInfo: string;
  statusInfo: string;
  statusBgWarning: string;
  statusWarning: string;
  statusBgDanger: string;
  statusDanger: string;
}): Record<StatusTone, { container: object }> {
  return {
    neutral: {
      container: { backgroundColor: colors.surfaceStrong, borderColor: colors.border },
    },
    info: {
      container: { backgroundColor: colors.statusBgInfo, borderColor: colors.statusInfo },
    },
    warning: {
      container: { backgroundColor: colors.statusBgWarning, borderColor: colors.statusWarning },
    },
    danger: {
      container: { backgroundColor: colors.statusBgDanger, borderColor: colors.statusDanger },
    },
  };
}

type IntensityTone = '1' | '2' | '3' | '4' | '5-' | '5+' | '6-' | '6+' | '7' | 'unknown';

function getIntensityColor(tone: IntensityTone) {
  switch (tone) {
    case '1': return '#B3E7EA'; // Official 0-2
    case '2': return '#B3E7EA'; // Official 0-2
    case '3': return '#0041FF'; // Official 3
    case '4': return '#FAE495'; // Official 4
    case '5-': return '#FFE501'; // Official 5-
    case '5+': return '#FF9904'; // Official 5+
    case '6-': return '#FF2900'; // Official 6-
    case '6+': return '#A50021'; // Official 6+
    case '7': return '#B30168'; // Official 7
    default: return '#9ca3af';
  }
}

function getIntensityToneStyles(colors: {
  surfaceStrong: string;
  border: string;
  text: string;
}): Record<IntensityTone, { container: object; text: object }> {
  // We ignore theme colors for intensity badges to stick to official JMA colors (standardized).
  // But we adjust text color for contrast (White for most, Black for Yellow).
  const makeStyle = (bgColor: string, textColor: string = '#1f2937') => ({
    container: { backgroundColor: bgColor, borderColor: bgColor },
    text: { color: textColor },
  });

  return {
    '1': makeStyle(getIntensityColor('1')),
    '2': makeStyle(getIntensityColor('2')),
    '3': makeStyle(getIntensityColor('3')),
    '4': makeStyle(getIntensityColor('4'), '#000000'), // Yellow needs black text
    '5-': makeStyle(getIntensityColor('5-')),
    '5+': makeStyle(getIntensityColor('5+')),
    '6-': makeStyle(getIntensityColor('6-')),
    '6+': makeStyle(getIntensityColor('6+')),
    '7': makeStyle(getIntensityColor('7')),
    'unknown': makeStyle(colors.surfaceStrong, colors.text),
  };
}

function intensityTone(value: string): IntensityTone {
  const norm = formatIntensityLabel(value);
  if (getRank(norm) !== -1) return norm as IntensityTone;
  return 'unknown';
}

function getRank(label: string) {
  const ranks: Record<string, number> = {
    '7': 9, '6+': 8, '6-': 7, '5+': 6, '5-': 5, '4': 4, '3': 3, '2': 2, '1': 1, '0': 0
  };
  return ranks[label] ?? -1;
}

// ... existing helpers ...

function formatIntensityLabel(value: string | null) {
  if (!value) return '不明';
  if (value.includes('5-') || value.includes('5弱')) return '5-'; // Map to code keys
  if (value.includes('5+') || value.includes('5強')) return '5+';
  if (value.includes('6-') || value.includes('6弱')) return '6-';
  if (value.includes('6+') || value.includes('6強')) return '6+';
  if (value.includes('7')) return '7';
  if (value.includes('4')) return '4';
  if (value.includes('3')) return '3';
  if (value.includes('2')) return '2';
  if (value.includes('1')) return '1';
  return value; // 0 or unknown
}

function displayIntensity(value: string | null) {
  const raw = formatIntensityLabel(value);
  const map: Record<string, string> = {
    '5-': '5弱', '5+': '5強', '6-': '6弱', '6+': '6強'
  };
  return map[raw] ?? raw;
}



function intensityRank(value: string | null) {
  if (!value) return -1;
  const label = formatIntensityLabel(value);
  return getRank(label);
}

function getSokuhouReason(item: JmaQuakeItem): 'reportType' | 'title' | null {
  const reportType = item.reportType?.trim();
  if (reportType) return reportType.includes('速報') ? 'reportType' : null;
  return item.title?.includes('速報') ? 'title' : null;
}

function isStrongIntensity(value: string | null) {
  // 5- (Rank 5) or higher
  return intensityRank(value) >= 3; // "Strong" usually means 3 or 4+?
  // User Requirement Q3: "Strong Quakes Ranking ... Last 7 days ... Top N"
  // Usually this list shows "Notable" quakes.
  // I will set threshold to 3 (Rank 3).
  // JMA "Latest" often shows all.
  // Let's filter >= 3 to be "Strong".
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
  const time = item.time ? formatTimeLong(item.time) : '日時不明';
  const magnitude = item.magnitude ? `M${item.magnitude}` : 'M不明';
  const depth = formatDepthKm(item.depthKm) ?? (item.title ? extractDepth(item.title) : null);
  const depthText = depth ? `深さ${depth}` : '深さ不明';
  return `${time} · ${magnitude} · ${depthText}`;
}

function formatDepthKm(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${rounded}km`;
}

function buildFeltAreaLines(areas: { intensity: string; areas: string[] }[]) {
  const sorted = [...areas].sort((a, b) => intensityRank(b.intensity) - intensityRank(a.intensity));
  const limit = 8;
  return sorted.map((group) => {
    const list = group.areas ?? [];
    const shown = list.slice(0, limit);
    const remaining = list.length - shown.length;
    const tail = remaining > 0 ? `ほか${remaining}市区町村` : null;
    const text = [...shown, tail].filter(Boolean).join('、');
    return { label: displayIntensity(group.intensity), text };
  });
}

function extractDepth(title: string) {
  // Handle "深さ約10km", "深さ 10km", "10km", etc.
  const match = title.match(/(?:深さは?|約)?\s*([0-9]+)\s*km/i);
  if (match?.[1]) return `${match[1]}km`;
  if (title.includes('ごく浅い')) return 'ごく浅い';
  return null;
}

function formatTimeShort(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatTimeLong(value: string) {
  const date = new Date(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${y}/${m}/${d} ${time}`;
}

function statusTone(status: string): StatusTone {
  if (status === 'OK') return 'info';
  if (status === 'DEGRADED') return 'warning';
  if (status === 'DOWN') return 'danger';
  return 'neutral';
}

const createStyles = (colors: {
  background: string;
  border: string;
  text: string;
  muted: string;
  surface: string;
  surfaceStrong: string;
  statusBgInfo: string;
  statusInfo: string;
  statusBgWarning: string;
  statusWarning: string;
  statusBgDanger: string;
  statusDanger: string;
}) =>
  StyleSheet.create({
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
    },

    loadMoreButton: {
      alignSelf: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      minWidth: 88,
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    loadMoreButtonText: {
      ...typography.caption,
      color: colors.text,
      fontWeight: '600',
    },
    guideTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    paginationRow: {
      flexDirection: 'row',
      gap: spacing.md,
      justifyContent: 'center',
      marginTop: spacing.sm,
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
    pointsStack: {
      gap: spacing.sm,
      marginTop: spacing.xs,
      paddingTop: spacing.xs,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    feltLine: {
      ...typography.caption,
      color: colors.text,
      lineHeight: 20,
    },
    pointGroup: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    pointHeader: {
      width: 40,
      alignItems: 'center',
    },
    pointBody: {
      flex: 1,
      ...typography.caption,
      color: colors.text,
      lineHeight: 20,
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
