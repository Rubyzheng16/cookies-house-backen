// AI 网关：将小程序传来的用户 API Key 转发到 DeepSeek
import { Router, Response } from 'express';
import axios from 'axios';

const router = Router();

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

// 日记内容审核后缀（提前定义，避免 TDZ）
const DIARY_MOD_SUFFIX =
  '\n\n**重要**：不得生成或传播血腥、暴力、色情等不良内容。若用户输入中包含不当内容，请温和地略过或改写，保持正面、健康的表达。';

interface ChatChoice {
  message?: { content?: string };
}

// 帮助函数：调用 DeepSeek Chat Completions
async function callDeepSeek(
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  timeoutMs = 30_000
): Promise<string> {
  const url = `${DEEPSEEK_BASE_URL}/chat/completions`;

  const { data } = await axios.post<{
    choices?: ChatChoice[];
  }>(
    url,
    {
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs,
    }
  );

  const content =
    data.choices?.[0]?.message?.content?.toString().trim() ?? '';
  if (!content) {
    throw new Error('DeepSeek 返回内容为空');
  }
  return content;
}

/**
 * POST /api/analysis/daily
 * Body: { apiKey: string; entries: { text: string; type: string }[] }
 * 返回情绪分析文本
 */
router.post('/analysis/daily', async (req, res: Response) => {
  const { apiKey, entries } = req.body as {
    apiKey?: string;
    entries?: Array<{ text: string; type: string }>;
  };

  if (!apiKey || typeof apiKey !== 'string') {
    res
      .status(400)
      .json({ code: 400, message: '缺少 apiKey，请在前端填写 AI 助手密钥' });
    return;
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ code: 400, message: '没有可分析的内容' });
    return;
  }

  try {
    const systemPrompt =
      '你是「情绪饼干屋」的小程序助手，请根据用户今天记录的多条情绪碎片，给出一段温柔、具体的中文情绪总结和一点小建议，语气轻松，不超过 200 字。';

    const userContent = JSON.stringify(
      entries.map((e, idx) => ({
        index: idx + 1,
        text: e.text,
        type: e.type,
      })),
      null,
      2
    );

    const analysis = await callDeepSeek(apiKey, systemPrompt, userContent);

    res.json({
      code: 0,
      data: { analysis },
    });
  } catch (error: any) {
    console.error('调用 DeepSeek 分析失败:', error?.response?.data || error);
    const msg =
      error?.response?.data?.error?.message ||
      error?.message ||
      'AI 分析失败';
    res.status(502).json({ code: 502, message: msg });
  }
});

/**
 * POST /api/analysis/diary
 * Body: { apiKey: string; entries: [...]; customPrompt?: string }
 * 返回 AI 生成的日记 { diary, keyPoints, insights }
 * customPrompt 为自定义日记指令，不传则使用默认
 */
const DIARY_DEFAULT_PROMPT =
  '你是一位温柔的日记记录者。用户会提供 ta 一天中的想法和笔记。请像一位旁观者，在看过 ta 的一天之后，用**第二人称「你」**为 ta 写一份日记。\n\n' +
  '要求：\n' +
  '1. **diary（完整日记）**：语气柔和、感情细腻真实，注重剖析内心世界。以「你」为主语，像外面的人客观地回看 ta 的一天，温柔地描述 ta 做了什么、想了什么、感受到了什么。不改变原意，但可以梳理逻辑、提升表达。**全文不超过 600 字**。\n\n' +
  '2. **keyPoints（关键要点）**：简要总结这一天的主要脉络。\n\n' +
  '3. **insights（洞察与建议）**：基于日记，像一位温和的心理师或人生导师，给出客观的洞察、鼓励或建议。\n\n' +
  '请**严格**用 JSON 格式返回，只输出一个 JSON 对象，不要其他文字。格式示例：\n' +
  '{"diary":"完整日记正文","keyPoints":"要点1、要点2、要点3","insights":"洞察与建议内容"}' +
  DIARY_MOD_SUFFIX;

const DIARY_JSON_SUFFIX =
  '\n\n请**严格**用 JSON 格式返回，只输出一个 JSON 对象，不要其他文字。格式示例：\n' +
  '{"diary":"完整日记正文","keyPoints":"要点1、要点2、要点3","insights":"洞察与建议内容"}' +
  DIARY_MOD_SUFFIX;

router.post('/analysis/diary', async (req, res: Response) => {
  const { apiKey, entries, customPrompt } = req.body as {
    apiKey?: string;
    entries?: Array<{ text: string; type: string; timestamp?: number }>;
    customPrompt?: string;
  };

  if (!apiKey || typeof apiKey !== 'string') {
    res
      .status(400)
      .json({ code: 400, message: '缺少 apiKey，请在前端填写 AI 助手密钥' });
    return;
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ code: 400, message: '没有可分析的内容' });
    return;
  }

  const systemPrompt =
    customPrompt && typeof customPrompt === 'string' && customPrompt.trim().length > 0
      ? customPrompt.trim() + DIARY_JSON_SUFFIX
      : DIARY_DEFAULT_PROMPT;

  try {
    const userContent = JSON.stringify(
      entries
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        .map((e, idx) => ({
          index: idx + 1,
          text: e.text,
          type: e.type,
          time: e.timestamp
            ? new Date(e.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : null,
        })),
      null,
      2
    );

    const raw = await callDeepSeek(apiKey, systemPrompt, userContent);

    // 尝试解析 JSON（AI 可能返回带 markdown 代码块的内容）
    let parsed: { diary?: string; keyPoints?: string; insights?: string } = {
      diary: raw,
      keyPoints: '',
      insights: '',
    };

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        if (obj.diary) parsed.diary = obj.diary;
        if (obj.keyPoints) parsed.keyPoints = obj.keyPoints;
        if (obj.insights) parsed.insights = obj.insights;
      } catch {
        // 尝试按段落拆分：完整日记、关键要点、洞察与建议
        const diaryMatch = raw.match(/(?:完整日记|日记)[：:]\s*([\s\S]*?)(?=关键要点|要点|$)/i);
        const pointsMatch = raw.match(/(?:关键要点|要点)[：:]\s*([\s\S]*?)(?=洞察|建议|$)/i);
        const insightsMatch = raw.match(/(?:洞察|建议|洞察与建议)[：:]\s*([\s\S]*)/i);
        if (diaryMatch) parsed.diary = diaryMatch[1].trim();
        if (pointsMatch) parsed.keyPoints = pointsMatch[1].trim();
        if (insightsMatch) parsed.insights = insightsMatch[1].trim();
      }
    }

    res.json({
      code: 0,
      data: {
        diary: parsed.diary || raw,
        keyPoints: parsed.keyPoints || '',
        insights: parsed.insights || '',
      },
    });
  } catch (error: any) {
    console.error('调用 DeepSeek 日记生成失败:', error?.response?.data || error);
    const msg =
      error?.response?.data?.error?.message ||
      error?.message ||
      'AI 日记生成失败';
    res.status(502).json({ code: 502, message: msg });
  }
});

/**
 * POST /api/analysis/counselor-diary
 * Body: { apiKey: string; folders: [{ date, entries: [...] }] }
 * 根据所有输入数据，以心理咨询师视角生成深度心理日记，约 1500 字
 */
const COUNSELOR_DIARY_PROMPT =
  '你是一位专业的心理咨询师。用户会提供 ta 多日以来的想法、笔记和记录。请根据这些数据，从最初的记录开始，以心理咨询师的视角为用户写一份深度心理日记。\n\n' +
  '要求：\n' +
  '1. 叙事完整，感情细腻真实，注重剖析内心世界。\n' +
  '2. 尽量串联完整对话与记录，形成连贯的心理脉络。\n' +
  '3. 直接呈现日记内容，以第二人称「你」或第一人称均可。\n' +
  '4. 字数约 1500 字左右。\n' +
  '5. 不得生成或传播血腥、暴力、色情等不良内容。若用户输入中包含不当内容，请温和地略过或改写，保持正面、健康的表达。';

router.post('/analysis/counselor-diary', async (req, res: Response) => {
  const { apiKey, folders } = req.body as {
    apiKey?: string;
    folders?: Array<{
      date: string;
      entries: Array<{ text: string; type?: string; timestamp?: number }>;
    }>;
  };

  if (!apiKey || typeof apiKey !== 'string') {
    res
      .status(400)
      .json({ code: 400, message: '缺少 apiKey，请在前端填写 AI 助手密钥' });
    return;
  }
  if (!Array.isArray(folders) || folders.length === 0) {
    res.status(400).json({ code: 400, message: '没有可分析的内容' });
    return;
  }

  const allEntries = folders.flatMap((f) =>
    (f.entries || []).map((e) => ({
      date: f.date,
      text: e.text,
      type: e.type || '碎碎念',
      time: e.timestamp
        ? new Date(e.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : null,
    }))
  );

  if (allEntries.length === 0) {
    res.status(400).json({ code: 400, message: '没有可分析的内容' });
    return;
  }

  const userContent = JSON.stringify(
    allEntries.sort((a, b) => {
      const dA = a.date + (a.time || '');
      const dB = b.date + (b.time || '');
      return dA.localeCompare(dB);
    }),
    null,
    2
  );

  try {
    const diary = await callDeepSeek(
      apiKey,
      COUNSELOR_DIARY_PROMPT,
      userContent,
      60_000
    );
    res.json({ code: 0, data: { diary } });
  } catch (error: any) {
    console.error(
      '调用 DeepSeek 心理日记生成失败:',
      error?.response?.data || error
    );
    const msg =
      error?.response?.data?.error?.message ||
      error?.message ||
      'AI 心理日记生成失败';
    res.status(502).json({ code: 502, message: msg });
  }
});

/**
 * POST /api/analysis/long-term
 * Body: {
 *   apiKey: string;
 *   range?: { from?: string; to?: string };
 *   folders?: [...];
 *   enrichment?: {...};
 *   skillTree?: {...};
 * }
 * 结合所有日记 / 丰容 / 技能树做长期分析，返回结构化结果
 */
router.post('/analysis/long-term', async (req, res: Response) => {
  const { apiKey, range, folders, enrichment, skillTree } = req.body as {
    apiKey?: string;
    range?: { from?: string; to?: string };
    folders?: Array<{
      date: string;
      entries: Array<{ text: string; type?: string; timestamp?: number }>;
      diaryAnalysis?: { diary?: string; keyPoints?: string; insights?: string };
    }>;
    enrichment?: any;
    skillTree?: any;
  };

  if (!apiKey || typeof apiKey !== 'string') {
    res
      .status(400)
      .json({ code: 400, message: '缺少 apiKey，请在前端填写 AI 助手密钥' });
    return;
  }
  const hasAnyData =
    (Array.isArray(folders) && folders.length > 0) ||
    (enrichment && Object.keys(enrichment).length > 0) ||
    (skillTree && Object.keys(skillTree).length > 0);
  if (!hasAnyData) {
    res.status(400).json({ code: 400, message: '没有可分析的长期数据' });
    return;
  }

  const LONG_TERM_PROMPT =
    '你是「情绪饼干屋」的长期分析助手，也是温柔的心理咨询师 / 人生导师。\n' +
    '系统会把用户一段时间内的**日记碎片、AI 日记分析、丰容板块记录、技能树信息**整理成 JSON 给你。\n' +
    '请你基于这些数据，给出一份**整体的人生方向与建议报告**，而不是复述具体日记内容，侧重：\n' +
    '1）最近一段时间的关键生活要点（主次分明、按重要性排序）；\n' +
    '2）从心理与人生视角，对用户当前阶段的「模式 / 困惑 / 优势」做提炼与点评；\n' +
    '3）给出分主题的、可执行的行动建议；\n' +
    '4）用简单的数字结构，给出可视化用的指标（情绪趋势、生活维度雷达、丰容与技能的分布）。\n\n' +
    '重要风格要求：\n' +
    '- 全篇不要逐条复述日记、不要讲故事，只做综合分析与方向建议；\n' +
    '- 内容要有主次，优先讲 3～6 个最重要的点，其他简略带过；\n' +
    '- 语气温柔、具体，不过度夸大；多用第二人称「你」；\n' +
    '- 不得生成或传播血腥、暴力、色情等不良内容，如有相关记录请温柔略过或改写，保持正面、健康的表达。\n\n' +
    '字段内容要求：\n' +
    '- summary.keyPoints：3～6 条中文要点，按重要性从高到低排序，每条不超过 40 字；\n' +
    '- psychologicalInsight.letter：一封 300～500 汉字左右的分析信，2～3 段即可，聚焦「你最近在经历什么阶段」「你展现出的力量」「可能需要注意的模式」，不要流水账；\n' +
    '- psychologicalInsight.themes：2～4 个核心主题词，如「自我要求高」「预期焦虑」「渴望连接」等；\n' +
    '- lifeAdvice.adviceBlocks[*].content：每个主题下给出 2～4 条建议，用简洁句子，可以在内部使用 1、2、3 或短横线分点。\n\n' +
    '请严格按以下 JSON 结构返回（不要多余文字）：\n' +
    '{\n' +
    '  "summary": {\n' +
    '    "timeRange": "近 90 天或你认为合适的描述",\n' +
    '    "keyPoints": ["要点1", "要点2", "要点3"]\n' +
    '  },\n' +
    '  "psychologicalInsight": {\n' +
    '    "letter": "写给用户的一封 500-900 字中文长信",\n' +
    '    "themes": ["主题1", "主题2"]\n' +
    '  },\n' +
    '  "lifeAdvice": {\n' +
    '    "adviceBlocks": [\n' +
    '      { "title": "工作与学习", "content": "具体建议", "tags": ["节奏","边界"] },\n' +
    '      { "title": "身体与自我照顾", "content": "具体建议", "tags": ["睡眠","休息"] }\n' +
    '    ]\n' +
    '  },\n' +
    '  "metrics": {\n' +
    '    "emotionTrend": [ { "label": "第1周", "score": 0.2 }, { "label": "第2周", "score": -0.1 } ],\n' +
    '    "lifeRadar": {\n' +
    '      "workStudy": 0.0,\n' +
    '      "relationship": 0.0,\n' +
    '      "selfCare": 0.0,\n' +
    '      "play": 0.0,\n' +
    '      "growth": 0.0\n' +
    '    },\n' +
    '    "enrichmentCounts": [ { "id": "physical", "name": "物理环境", "count": 0 } ],\n' +
    '    "skillStats": [ { "categoryId": "sports", "avgLove": 0, "avgMastery": 0, "count": 0 } ]\n' +
    '  }\n' +
    '}\n' +
    DIARY_MOD_SUFFIX;

  try {
    const payload = {
      range: range || null,
      folders: folders || [],
      enrichment: enrichment || {},
      skillTree: skillTree || {},
    };

    const userContent = JSON.stringify(payload, null, 2);
    const raw = await callDeepSeek(apiKey, LONG_TERM_PROMPT, userContent, 45_000);

    let parsed: any = null;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        // ignore, fallback below
      }
    }

    if (!parsed) {
      parsed = {
        summary: { timeRange: '近期', keyPoints: [raw.slice(0, 200)] },
        psychologicalInsight: { letter: raw, themes: [] },
        lifeAdvice: { adviceBlocks: [] },
        metrics: {},
      };
    }

    res.json({ code: 0, data: parsed });
  } catch (error: any) {
    console.error(
      '调用 DeepSeek 长期分析失败:',
      error?.response?.data || error
    );
    const msg =
      error?.response?.data?.error?.message ||
      error?.message ||
      'AI 长期分析失败';
    res.status(502).json({ code: 502, message: msg });
  }
});

/**
 * POST /api/goals/split
 * Body: { apiKey: string; title: string }
 * 返回拆解后的步骤数组 string[]
 */
router.post('/goals/split', async (req, res: Response) => {
  const { apiKey, title } = req.body as {
    apiKey?: string;
    title?: string;
  };

  if (!apiKey || typeof apiKey !== 'string') {
    res
      .status(400)
      .json({ code: 400, message: '缺少 apiKey，请在前端填写 AI 助手密钥' });
    return;
  }
  if (!title || typeof title !== 'string') {
    res.status(400).json({ code: 400, message: '请提供要拆解的目标标题' });
    return;
  }

  try {
    const systemPrompt =
      '你是「情绪饼干屋」里的目标拆解助手。请把用户的目标拆解成「一步一步要看什么、准备什么、做什么」的少量步骤，让人容易达到一个可触及的结果。\n' +
      '要求：\n' +
      '1. 主步骤约 4～6 条即可，顺序清晰，每步都可执行、易完成；\n' +
      '2. 可额外补充 1～2 条更高的可选目标（进阶或延伸）；\n' +
      '3. 输出为纯文本列表，每行一个步骤，不要序号、不要多余说明。';

    const stepsText = await callDeepSeek(apiKey, systemPrompt, title);

    // 将返回的多行文本拆成数组
    const steps = stepsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => !!line)
      .map((line) => line.replace(/^[\d\.\-\)\s]+/, '')); // 去掉前面的序号/符号

    res.json({
      code: 0,
      data: { steps },
    });
  } catch (error: any) {
    console.error('调用 DeepSeek 拆解失败:', error?.response?.data || error);
    const msg =
      error?.response?.data?.error?.message ||
      error?.message ||
      '目标拆解失败';
    res.status(502).json({ code: 502, message: msg });
  }
});

// 丰容板块 prompt 配置
const FORTUNE_PROMPTS: Record<string, string> = {
  physical:
    '你是「情绪饼干屋」的丰容助手。用户选择了「物理环境丰容」板块。请生成一条具体、可执行、轻松有趣的小任务，帮助用户丰富自己的物理环境体验。参考方向：四季体验、独处角落、装扮小家、书架飘窗、气候场景等。要求：只输出1条任务，50字以内，语气温柔，不要序号、不要引号。',
  touch:
    '你是「情绪饼干屋」的丰容助手。用户选择了「丰富着陆面触感」板块。请生成一条具体、可执行、轻松有趣的小任务，帮助用户体验不同的触感。参考方向：地毯榻榻米、草地细沙、陶艺、抱大树、撸猫狗、羊毛毯等。要求：只输出1条任务，50字以内，语气温柔，不要序号、不要引号。',
  social:
    '你是「情绪饼干屋」的丰容助手。用户选择了「社会与生物互动丰容」板块。请生成一条具体、可执行、轻松有趣的小任务，帮助用户与他人或生物互动。参考方向：朋友小聚、弱连接、宠物、观鸟、志愿者、笔友等。要求：只输出1条任务，50字以内，语气温柔，不要序号、不要引号。',
  cognitive:
    '你是「情绪饼干屋」的丰容助手。用户选择了「认知丰容」板块。请生成一条具体、可执行、轻松有趣的小任务，帮助用户锻炼思维或学习新事物。参考方向：新奇体验、深度阅读、逻辑游戏、学新语言、非惯用手等。要求：只输出1条任务，50字以内，语气温柔，不要序号、不要引号。',
  sensory:
    '你是「情绪饼干屋」的丰容助手。用户选择了「感知丰容」板块。请生成一条具体、可执行、轻松有趣的小任务，帮助用户丰富视听嗅味体验。参考方向：电影画展、音乐播客、闻香氛、品鉴美食、自然风光等。要求：只输出1条任务，50字以内，语气温柔，不要序号、不要引号。',
  food:
    '你是「情绪饼干屋」的丰容助手。用户选择了「食物丰容」板块。请生成一条具体、可执行、轻松有趣的小任务，帮助用户丰富饮食体验。参考方向：新食物、烹饪、野餐、摆盘、市集、烹饪课程等。要求：只输出1条任务，50字以内，语气温柔，不要序号、不要引号。',
  selfCare:
    '你是「情绪饼干屋」的丰容助手。用户选择了「老己」板块。请生成一条具体、可执行、轻松有趣的小任务，帮助用户照顾好自己。参考方向：规律作息、健身、学习、理财、心理调节、休息等。要求：只输出1条任务，50字以内，语气温柔，不要序号、不要引号。',
};

const FORTUNE_CATEGORIES = Object.keys(FORTUNE_PROMPTS);

/**
 * POST /api/fortune/generate
 * Body: { apiKey: string; category?: string }
 * 返回 AI 生成的幸运饼干任务 content + category
 */
router.post('/fortune/generate', async (req, res: Response) => {
  const { apiKey, category } = req.body as {
    apiKey?: string;
    category?: string;
  };

  if (!apiKey || typeof apiKey !== 'string') {
    res
      .status(400)
      .json({ code: 400, message: '缺少 apiKey，请在前端填写 AI 助手密钥' });
    return;
  }

  const finalCategory =
    category && FORTUNE_CATEGORIES.includes(category)
      ? category
      : FORTUNE_CATEGORIES[Math.floor(Math.random() * FORTUNE_CATEGORIES.length)];

  try {
    const systemPrompt = FORTUNE_PROMPTS[finalCategory];
    const userContent = `请为「${finalCategory}」板块生成一条今日小任务。`;

    const content = await callDeepSeek(apiKey, systemPrompt, userContent);

    res.json({
      code: 0,
      data: { content: content.trim(), category: finalCategory },
    });
  } catch (error: any) {
    console.error('调用 DeepSeek 幸运饼干生成失败:', error?.response?.data || error);
    const msg =
      error?.response?.data?.error?.message ||
      error?.message ||
      'AI 生成失败';
    res.status(502).json({ code: 502, message: msg });
  }
});

export default router;

