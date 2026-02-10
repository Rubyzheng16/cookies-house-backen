// JWT 鉴权中间件：从 Authorization: Bearer <token> 解析并校验，仅允许访问当前用户数据
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { getUserById } from '../db';

export interface JwtPayload {
  userId: number;
  wxOpenId: string;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  user?: { id: number; wxOpenId: string };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ code: 401, message: '未登录或 token 无效' });
    return;
  }
  if (!config.jwt.secret) {
    res.status(500).json({ code: 500, message: '服务端未配置 JWT' });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwt.secret) as JwtPayload;
    const user = getUserById(payload.userId);
    if (!user) {
      res.status(401).json({ code: 401, message: '用户不存在' });
      return;
    }
    req.user = { id: user.id, wxOpenId: user.wx_open_id };
    next();
  } catch {
    res.status(401).json({ code: 401, message: '登录已过期或 token 无效' });
  }
}
