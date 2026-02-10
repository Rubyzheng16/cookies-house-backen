// 登录/注册：使用微信 code 换取 openid，自动注册或登录；可选绑定手机号（与 README 用户注册方案一致）
import { Router, Response } from 'express';
import jwt, { SignOptions, Secret } from 'jsonwebtoken';
import { config } from '../config';
import { findUserByWxOpenId, createUser, getUserById, updateUserPhone, UserRow } from '../db';
import { code2Session, getPhoneNumber } from '../services/wechat';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// 统一返回给前端的用户信息（不含敏感字段）
function toUserDto(row: UserRow) {
  return {
    id: row.id,
    wxOpenId: row.wx_open_id,
    phone: row.phone ?? undefined,
    vipLevel: row.vip_level as 'free' | 'vip',
    settings: row.settings ? JSON.parse(row.settings) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * POST /api/auth/login
 * Body: { code: string }  —— 小程序 wx.login() 得到的 code
 * 后端用 code 换 openid，若用户不存在则自动注册，返回 token 与用户信息
 */
router.post('/login', async (req: AuthRequest, res: Response) => {
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== 'string') {
    res.status(400).json({ code: 400, message: '请提供微信登录 code' });
    return;
  }
  if (!config.jwt.secret) {
    res.status(500).json({ code: 500, message: '服务端未配置 JWT' });
    return;
  }
  try {
    const { openid } = await code2Session(code);
    let user = findUserByWxOpenId(openid);
    if (!user) {
      user = createUser(openid);
    }
    const token = jwt.sign(
      { userId: user.id, wxOpenId: user.wx_open_id },
      config.jwt.secret as Secret,
      { expiresIn: config.jwt.expiresIn } as SignOptions
    );
    res.json({
      code: 0,
      message: '登录成功',
      data: {
        token,
        user: toUserDto(user),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : '登录失败';
    res.status(401).json({ code: 401, message });
  }
});

/**
 * GET /api/auth/me
 * Header: Authorization: Bearer <token>
 * 返回当前登录用户信息
 */
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = req.user && getUserById(req.user.id);
  if (!user) {
    res.status(401).json({ code: 401, message: '用户不存在' });
    return;
  }
  res.json({ code: 0, data: { user: toUserDto(user) } });
});

/**
 * POST /api/auth/phone
 * Header: Authorization: Bearer <token>
 * Body: { code: string }  —— 小程序 getPhoneNumber 返回的 code（需企业认证）
 * 绑定/更新当前用户手机号
 */
router.post('/phone', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== 'string') {
    res.status(400).json({ code: 400, message: '请提供手机号授权 code' });
    return;
  }
  if (!req.user) {
    res.status(401).json({ code: 401, message: '未登录' });
    return;
  }
  try {
    const { purePhoneNumber } = await getPhoneNumber(code);
    updateUserPhone(req.user.id, purePhoneNumber);
    const user = getUserById(req.user.id)!;
    res.json({ code: 0, message: '手机号已更新', data: { user: toUserDto(user) } });
  } catch (e) {
    const message = e instanceof Error ? e.message : '绑定手机号失败';
    res.status(400).json({ code: 400, message });
  }
});

export default router;
