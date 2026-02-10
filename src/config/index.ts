// 配置：从环境变量读取，启动时校验必填项
// 在这里加载 .env，确保所有地方读取到的都是已解析的环境变量
import dotenv from 'dotenv';

dotenv.config();

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (!value && (key === 'WECHAT_APPID' || key === 'WECHAT_SECRET' || key === 'JWT_SECRET')) {
    console.warn(`[config] 未设置 ${key}，登录相关接口将不可用`);
  }
  return value || '';
}

export const config = {
  wechat: {
    appId: getEnv('WECHAT_APPID'),
    secret: getEnv('WECHAT_SECRET'),
  },
  jwt: {
    secret: getEnv('JWT_SECRET'),
    expiresIn: '7d',
  },
  port: parseInt(getEnv('PORT', '3000'), 10),
};
