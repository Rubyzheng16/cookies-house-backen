// 情绪饼干云端接口：仅对 VIP 开放，普通用户继续使用本地存储
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  upsertEmotionDay,
  listEmotionDaysWithinMonths,
  getUserById,
} from '../db';

const router = Router();

// 保存某一天的情绪饼干（VIP 云端存储）
router.post('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = req.user && getUserById(req.user.id);
  if (!user) {
    res.status(401).json({ code: 401, message: '未登录' });
    return;
  }
  if (user.vip_level !== 'vip') {
    res.status(403).json({ code: 403, message: '仅 VIP 用户可使用云端存储' });
    return;
  }

  const { date, entries, analysis } = req.body as {
    date?: string;
    entries?: unknown;
    analysis?: string;
  };

  if (!date || typeof date !== 'string') {
    res.status(400).json({ code: 400, message: '请提供日期 date' });
    return;
  }

  const dataJson = JSON.stringify({ entries, analysis });
  const row = upsertEmotionDay(user.id, date, dataJson);

  res.json({
    code: 0,
    message: '已保存到云端',
    data: {
      id: row.id,
      date: row.date,
    },
  });
});

// 获取最近半年的情绪饼干（VIP 云端读取，“半年可见”）
router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = req.user && getUserById(req.user.id);
  if (!user) {
    res.status(401).json({ code: 401, message: '未登录' });
    return;
  }
  if (user.vip_level !== 'vip') {
    res.status(403).json({ code: 403, message: '仅 VIP 用户可使用云端存储' });
    return;
  }

  const rows = listEmotionDaysWithinMonths(user.id, 6);
  const items = rows.map((r) => {
    const parsed = JSON.parse(r.data || '{}') as {
      entries?: unknown;
      analysis?: string;
    };
    return {
      id: r.id,
      date: r.date,
      entries: parsed.entries ?? [],
      analysis: parsed.analysis,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });

  res.json({
    code: 0,
    data: {
      items,
    },
  });
});

export default router;

