import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { HAZARD_OPTIONS } from '@/src/constants/hazards';
import { fetchJson, getApiBaseUrl, toApiError, type ApiError } from '@/src/api/client';
import type { CrowdVoteValue, Shelter, ShelterCommunityResponse } from '@/src/api/types';
import { getPushState } from '@/src/push/state';
import { radii, spacing, typography, useThemedStyles, useTheme } from '@/src/ui/theme';

type Props = {
  visible: boolean;
  shelter: Shelter | null;
  distanceLabel: string | null;
  isFavorite: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
  onDirections: () => void;
  onShare: () => void;
};

const VOTE_OPTIONS: { value: CrowdVoteValue; label: string }[] = [
  { value: 'EVACUATING', label: '避難中' },
  { value: 'SMOOTH', label: 'スムーズ' },
  { value: 'NORMAL', label: '普通' },
  { value: 'CROWDED', label: '混雑' },
  { value: 'CLOSED', label: '閉鎖' },
];

export function ShelterDetailSheet({
  visible,
  shelter,
  distanceLabel,
  isFavorite,
  onClose,
  onToggleFavorite,
  onDirections,
  onShare,
}: Props) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const translateY = useRef(new Animated.Value(0)).current;

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [community, setCommunity] = useState<ShelterCommunityResponse | null>(null);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<ApiError | null>(null);
  const [selectedVote, setSelectedVote] = useState<CrowdVoteValue | null>(null);
  const [comment, setComment] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    getPushState()
      .then((state) => {
        if (!active) return;
        setDeviceId(state.deviceId);
      })
      .catch(() => {
        if (!active) return;
        setDeviceId(null);
      });
    return () => {
      active = false;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || !shelter) return;
    let active = true;
    const load = async () => {
      setCommunityLoading(true);
      setCommunityError(null);
      try {
        const data = await fetchJson<ShelterCommunityResponse>(`/api/store/shelter?id=${encodeURIComponent(String(shelter.id))}`);
        if (!active) return;
        setCommunity(data);
      } catch (err) {
        if (!active) return;
        setCommunity(null);
        setCommunityError(toApiError(err));
      } finally {
        if (active) setCommunityLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [shelter, visible]);

  const topVote = useMemo(() => {
    const summary = community?.votesSummary ?? {};
    let best: { key: CrowdVoteValue | null; count: number } = { key: null, count: 0 };
    Object.entries(summary).forEach(([key, value]) => {
      const count = typeof value === 'number' ? value : 0;
      if (count > best.count) {
        best = { key: key as CrowdVoteValue, count };
      }
    });
    return best.key;
  }, [community?.votesSummary]);

  const topVoteLabel = useMemo(() => {
    if (!topVote) return '情報なし';
    return VOTE_OPTIONS.find((opt) => opt.value === topVote)?.label ?? '情報なし';
  }, [topVote]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8,
        onPanResponderMove: (_, gesture) => {
          translateY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 80 || gesture.vy > 0.5) {
            Animated.timing(translateY, {
              toValue: 200,
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              translateY.setValue(0);
              onClose();
            });
            return;
          }
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [onClose, translateY]
  );

  const refreshCommunity = useCallback(async () => {
    if (!shelter) return;
    try {
      const data = await fetchJson<ShelterCommunityResponse>(`/api/store/shelter?id=${encodeURIComponent(String(shelter.id))}`);
      setCommunity(data);
    } catch (err) {
      setCommunityError(toApiError(err));
    }
  }, [shelter]);

  const handleSubmit = useCallback(async () => {
    if (!shelter || !deviceId) return;
    setSubmitError(null);
    setSubmitNotice(null);
    if (!selectedVote) {
      setSubmitError('投票状況を選択してください');
      return;
    }
    const text = comment.trim();
    const shouldSendComment = text.length > 0;
    setSubmitBusy(true);
    try {
      const voteRes = await apiRequest('/api/store/shelter/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shelterId: String(shelter.id), deviceId, value: selectedVote }),
      });
      if (!voteRes.ok && !isIgnorable(voteRes.json?.errorCode)) {
        setSubmitError(voteRes.json?.error ?? '送信できませんでした');
        return;
      }

      if (shouldSendComment) {
        const commentRes = await apiRequest('/api/store/shelter/comment', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ shelterId: String(shelter.id), deviceId, text }),
        });
        if (!commentRes.ok && !isIgnorable(commentRes.json?.errorCode)) {
          setSubmitError(commentRes.json?.error ?? '送信できませんでした');
          return;
        }
      }

      setSelectedVote(null);
      setComment('');
      setSubmitNotice('送信しました');
      await refreshCommunity();
    } finally {
      setSubmitBusy(false);
    }
  }, [comment, deviceId, refreshCommunity, selectedVote, shelter]);

  const handleReset = useCallback(async () => {
    if (!shelter || !deviceId) return;
    setSubmitError(null);
    setSubmitNotice(null);
    setSubmitBusy(true);
    try {
      const res = await apiRequest('/api/store/shelter/vote', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shelterId: String(shelter.id), deviceId }),
      });
      if (!res.ok) {
        setSubmitError(res.json?.error ?? '削除できませんでした');
        return;
      }
      setSubmitNotice('削除しました');
      setSelectedVote(null);
      setComment('');
      await refreshCommunity();
    } finally {
      setSubmitBusy(false);
    }
  }, [deviceId, refreshCommunity, shelter]);

  if (!visible || !shelter) return null;

  const hazardFlags = shelter.hazards ?? {};
  const updatedAtLabel = community?.updatedAt ? formatUpdatedAt(community.updatedAt) : '不明';
  const comments = community?.comments ?? [];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>{shelter.name ?? '避難所'}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>閉じる</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {shelter.address ? <Text style={styles.address}>{shelter.address}</Text> : null}
            {distanceLabel ? <Text style={styles.distance}>{distanceLabel}</Text> : null}

            <View style={styles.actionRow}>
              <Pressable style={styles.actionButton} onPress={onToggleFavorite}>
                <FontAwesome name={isFavorite ? 'star' : 'star-o'} size={16} color={colors.text} />
                <Text style={styles.actionText}>保存</Text>
              </Pressable>
              <Pressable style={styles.actionButton} onPress={onDirections}>
                <FontAwesome name="location-arrow" size={16} color={colors.text} />
                <Text style={styles.actionText}>経路確認</Text>
              </Pressable>
              <Pressable style={styles.actionButton} onPress={onShare}>
                <FontAwesome name="share-alt" size={16} color={colors.text} />
                <Text style={styles.actionText}>共有</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>対応ハザード</Text>
              <View style={styles.hazardRow}>
                {HAZARD_OPTIONS.map((option) => {
                  const active = Boolean(hazardFlags?.[option.key]);
                  // Active: Black BG, White Text. Inactive: White BG, Black Border, Black Text.
                  return (
                    <View
                      key={option.key}
                      style={[styles.hazardChip, active ? styles.hazardChipActive : styles.hazardChipInactive]}
                    >
                      <Text style={active ? styles.hazardTextActive : styles.hazardTextInactive}>{option.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>混雑状況（投票/コメント）</Text>
              <Text style={styles.sectionNote}>個人情報は書かないでください。</Text>
              {communityLoading ? <Text style={styles.sectionNote}>読み込み中...</Text> : null}
              {communityError && !communityLoading ? <Text style={styles.sectionNote}>情報なし</Text> : null}
              {!communityLoading && !communityError ? (
                <>
                  <View style={styles.statusCard}>
                    <Text style={styles.statusLabel}>現在</Text>
                    <Text style={styles.statusValue}>{topVoteLabel}</Text>
                    <Text style={styles.statusUpdated}>最終更新 {updatedAtLabel}</Text>
                  </View>

                  <View style={styles.voteRow}>
                    {VOTE_OPTIONS.map((opt) => (
                      <Pressable
                        key={opt.value}
                        style={[styles.voteButton, selectedVote === opt.value ? styles.voteButtonActive : null]}
                        onPress={() => setSelectedVote(opt.value)}
                        disabled={!deviceId || submitBusy}
                      >
                        <Text style={selectedVote === opt.value ? styles.voteTextActive : styles.voteText}>{opt.label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.inputLabel}>コメント（任意）</Text>
                  <TextInput
                    value={comment}
                    onChangeText={setComment}
                    placeholder="空欄の場合は送信されません"
                    placeholderTextColor={colors.muted}
                    multiline
                    style={styles.textArea}
                    maxLength={300}
                  />

                  <View style={styles.submitRow}>
                    <Pressable style={styles.submitButton} onPress={handleSubmit} disabled={submitBusy || !deviceId}>
                      <Text style={styles.submitButtonText}>送信</Text>
                    </Pressable>
                    <Pressable style={styles.resetButton} onPress={handleReset} disabled={submitBusy || !deviceId}>
                      <Text style={styles.resetButtonText}>解除</Text>
                    </Pressable>
                  </View>

                  {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
                  {submitNotice ? <Text style={styles.noticeText}>{submitNotice}</Text> : null}

                  <View style={styles.commentSection}>
                    <Text style={styles.commentTitle}>コメント</Text>
                    {comments.length === 0 ? <Text style={styles.sectionNote}>コメントはまだありません。</Text> : null}
                    {comments.map((entry) => (
                      <View key={entry.id} style={styles.commentCard}>
                        <Text style={styles.commentText}>{String(entry.text ?? '')}</Text>
                        <Text style={styles.commentMeta}>{formatUpdatedAt(entry.createdAt)}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function isIgnorable(code: unknown) {
  return code === 'DUPLICATE' || code === 'RATE_LIMITED';
}

async function apiRequest(path: string, init: RequestInit) {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, init);
  const json = await response.json().catch(() => null);
  return { ok: response.ok, json };
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// HAZARD_OPTIONS removed, imported from constants

const createStyles = (colors: {
  background: string;
  border: string;
  text: string;
  muted: string;
  surface: string;
}) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.2)',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.border,
      maxHeight: '90%',
    },
    handle: {
      width: 44,
      height: 4,
      borderRadius: radii.pill,
      backgroundColor: colors.border,
      alignSelf: 'center',
      marginTop: spacing.md,
      marginBottom: spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
    },
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
    },
    title: {
      ...typography.subtitle,
      color: colors.text,
      flex: 1,
      marginRight: spacing.sm,
    },
    closeText: {
      ...typography.caption,
      color: colors.muted,
    },
    address: {
      ...typography.body,
      color: colors.text,
      marginTop: spacing.sm,
    },
    distance: {
      ...typography.caption,
      color: colors.muted,
      marginTop: spacing.xs,
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.pill,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
    },
    actionText: {
      ...typography.label,
      color: colors.text,
    },
    section: {
      marginTop: spacing.lg,
    },
    sectionTitle: {
      ...typography.subtitle,
      color: colors.text,
      marginBottom: spacing.xs,
    },
    sectionNote: {
      ...typography.caption,
      color: colors.muted,
      marginBottom: spacing.sm,
    },
    hazardRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    hazardChip: {
      borderRadius: radii.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderWidth: 1,
    },
    hazardChipActive: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    hazardChipInactive: {
      backgroundColor: colors.background,
      borderColor: colors.border,
    },
    hazardTextActive: {
      ...typography.caption,
      color: colors.background,
    },
    hazardTextInactive: {
      ...typography.caption,
      color: colors.muted,
    },
    statusCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      padding: spacing.sm,
      marginBottom: spacing.md,
    },
    statusLabel: {
      ...typography.caption,
      color: colors.muted,
    },
    statusValue: {
      ...typography.subtitle,
      color: colors.text,
    },
    statusUpdated: {
      ...typography.caption,
      color: colors.muted,
      marginTop: spacing.xxs,
    },
    voteRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginBottom: spacing.md,
    },
    voteButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.pill,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    voteButtonActive: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    voteText: {
      ...typography.caption,
      color: colors.text,
    },
    voteTextActive: {
      ...typography.caption,
      color: colors.background,
    },
    inputLabel: {
      ...typography.caption,
      color: colors.text,
      marginBottom: spacing.xs,
    },
    textArea: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      padding: spacing.sm,
      minHeight: 72,
      color: colors.text,
      backgroundColor: colors.background,
      marginBottom: spacing.md,
    },
    submitRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    submitButton: {
      backgroundColor: colors.text,
      borderRadius: radii.pill,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.lg,
    },
    submitButtonText: {
      ...typography.label,
      color: colors.background,
    },
    resetButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.pill,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.lg,
    },
    resetButtonText: {
      ...typography.label,
      color: colors.text,
    },
    errorText: {
      ...typography.caption,
      color: colors.muted,
      marginBottom: spacing.xs,
    },
    noticeText: {
      ...typography.caption,
      color: colors.muted,
      marginBottom: spacing.xs,
    },
    commentSection: {
      marginTop: spacing.md,
    },
    commentTitle: {
      ...typography.label,
      color: colors.text,
      marginBottom: spacing.xs,
    },
    commentCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      padding: spacing.sm,
      marginBottom: spacing.sm,
      backgroundColor: colors.surface,
    },
    commentText: {
      ...typography.body,
      color: colors.text,
    },
    commentMeta: {
      ...typography.caption,
      color: colors.muted,
      marginTop: spacing.xs,
    },
  });
