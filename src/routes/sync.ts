// 云端同步：所有登录用户可上传/下载完整数据快照（自动上传 + 手动备份/恢复）
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getSyncSnapshot, setSyncSnapshot, getUserById } from '../db';

const router = Router();

// 前端会传的 key 与后端一致即可，不校验结构
const SNAPSHOT_KEYS = [
  'emotion_cookies',
  'cookie_goals',
  'user_info',
  'enrichment_data',
  'skill_tree_data',
  'diary_prompt_custom',
  'user_vip',
  'counselor_diary',
];

function sanitizeSnapshot(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SNAPSHOT_KEYS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

/**
 * POST /api/sync/upload
 * Body: { emotion_cookies?, cookie_goals?, ... } 与本地 storage 一致
 * 保存到云端，覆盖该用户之前的快照
 */
router.post('/upload', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = req.user && getUserById(req.user.id);
  if (!user) {
    res.status(401).json({ code: 401, message: '未登录' });
    return;
  }
  const snapshot = sanitizeSnapshot((req.body || {}) as Record<string, unknown>);
  const dataJson = JSON.stringify(snapshot);
  const updatedAt = setSyncSnapshot(user.id, dataJson);
  res.json({
    code: 0,
    message: '已备份到云端',
    data: { updatedAt },
  });
});

/**
 * GET /api/sync/download
 * 返回该用户云端快照；若无则返回空对象
 */
router.get('/download', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = req.user && getUserById(req.user.id);
  if (!user) {
    res.status(401).json({ code: 401, message: '未登录' });
    return;
  }
  const row = getSyncSnapshot(user.id);
  const snapshot = row ? (JSON.parse(row.data || '{}') as Record<string, unknown>) : {};
  res.json({
    code: 0,
    data: {
      snapshot,
      updatedAt: row?.updated_at ?? null,
    },
  });
});

export default router;
