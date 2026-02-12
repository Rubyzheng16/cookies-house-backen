// 后端应用入口
import express from 'express';
import cors from 'cors';
import { config } from './config';
import authRoutes from './routes/auth';
import emotionCookiesRoutes from './routes/emotionCookies';
import syncRoutes from './routes/sync';
import aiRoutes from './routes/ai';

const app = express();
const PORT = config.port;

// 中间件
app.use(cors());
app.use(express.json());
// 开发调试：打印请求日志
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} <- ${req.ip || req.socket?.remoteAddress}`);
  }
  next();
});
app.use(express.urlencoded({ extended: true }));

// 路由
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '情绪饼干屋后端服务运行中' });
});

app.use('/api/auth', authRoutes);
app.use('/api/emotion-cookies', emotionCookiesRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api', aiRoutes);

// 启动服务器：监听 0.0.0.0 以便真机调试时手机能访问
app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`真机调试请用电脑局域网 IP 访问，如 http://192.168.88.95:${PORT}`);
});

export default app;
