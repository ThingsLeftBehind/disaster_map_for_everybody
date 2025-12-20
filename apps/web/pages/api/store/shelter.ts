import type { NextApiRequest, NextApiResponse } from 'next';
import { getAdminState, getShelterCommunitySnapshot } from 'lib/store/adapter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const shelterId = (Array.isArray(req.query.id) ? req.query.id[0] : req.query.id) as string | undefined;
  if (!shelterId) return res.status(400).json({ error: 'id is required' });

  const [community, admin] = await Promise.all([getShelterCommunitySnapshot(shelterId), getAdminState()]);

  const votesSummary = community.votes.reduce<Record<string, number>>((acc, v) => {
    acc[v.value] = (acc[v.value] ?? 0) + 1;
    return acc;
  }, {});
  const visibleComments = community.comments.filter((c) => !c.hidden);
  const hiddenCount = community.comments.length - visibleComments.length;
  const mostReported = Math.max(0, ...community.comments.map((c) => c.reportCount ?? 0));

  return res.status(200).json({
    updatedAt: community.updatedAt,
    moderationPolicy: admin.moderationPolicy,
    votesSummary,
    commentCount: visibleComments.length,
    hiddenCount,
    mostReported,
    commentsCollapsed: mostReported >= admin.moderationPolicy.reportHideThreshold,
    comments: mostReported >= admin.moderationPolicy.reportHideThreshold ? [] : visibleComments.slice(0, 50),
  });
}

