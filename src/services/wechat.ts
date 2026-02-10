// 微信小程序登录与手机号：code 换 openid；手机号 code 换手机号（与 README 鉴权方案一致）
import axios from 'axios';
import { config } from '../config';

const CODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session';
const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const GET_PHONE_URL = 'https://api.weixin.qq.com/wxa/business/getuserphonenumber';

export interface Code2SessionResult {
  openid: string;
  session_key: string;
  unionid?: string;
}

let cachedAccessToken: { token: string; expireAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expireAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }
  if (!config.wechat.appId || !config.wechat.secret) {
    throw new Error('未配置微信 AppID/Secret');
  }
  const { data } = await axios.get<{
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  }>(TOKEN_URL, {
    params: {
      grant_type: 'client_credential',
      appid: config.wechat.appId,
      secret: config.wechat.secret,
    },
  });
  if (data.errcode || !data.access_token) {
    throw new Error(data.errmsg || `获取 access_token 失败: ${JSON.stringify(data)}`);
  }
  cachedAccessToken = {
    token: data.access_token,
    expireAt: Date.now() + (data.expires_in ?? 7200) * 1000,
  };
  return cachedAccessToken.token;
}

export async function code2Session(code: string): Promise<Code2SessionResult> {
  if (!config.wechat.appId || !config.wechat.secret) {
    throw new Error('未配置微信 AppID/Secret');
  }
  const { data } = await axios.get<{
    openid?: string;
    session_key?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  }>(CODE2SESSION_URL, {
    params: {
      appid: config.wechat.appId,
      secret: config.wechat.secret,
      js_code: code,
      grant_type: 'authorization_code',
    },
  });
  if (data.errcode || !data.openid) {
    throw new Error(data.errmsg || `微信接口错误: ${JSON.stringify(data)}`);
  }
  return {
    openid: data.openid,
    session_key: data.session_key!,
    unionid: data.unionid,
  };
}

/** 使用 getPhoneNumber 返回的 code 换取手机号（需企业认证小程序） */
export async function getPhoneNumber(phoneCode: string): Promise<{ phoneNumber: string; purePhoneNumber: string }> {
  const accessToken = await getAccessToken();
  const { data } = await axios.post<{
    errcode?: number;
    errmsg?: string;
    phone_info?: { phoneNumber: string; purePhoneNumber: string };
  }>(`${GET_PHONE_URL}?access_token=${accessToken}`, { code: phoneCode });
  if (data.errcode || !data.phone_info) {
    throw new Error(data.errmsg || `获取手机号失败: ${JSON.stringify(data)}`);
  }
  return {
    phoneNumber: data.phone_info.phoneNumber,
    purePhoneNumber: data.phone_info.purePhoneNumber,
  };
}
