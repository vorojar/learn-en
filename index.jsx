import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Mic, MicOff, CheckCircle2, XCircle, ArrowRight, BookOpen, MessageSquare, Volume2, Send, Loader2, RotateCcw, AlertCircle, KeyRound, Save, ChevronDown, ChevronUp, Square } from 'lucide-react';

const DEFAULT_API_BASE = 'https://api.kie.ai/gemini-3-flash/v1/chat/completions';
const DEFAULT_API_MODEL = 'gemini-3-flash';
const LS_KEYS = {
  key: 'sec_api_key',
  base: 'sec_api_base',
  model: 'sec_api_model'
};

const safeGetLS = (k) => {
  try { return (typeof localStorage !== 'undefined' && localStorage.getItem(k)) || ''; } catch { return ''; }
};
const safeSetLS = (k, v) => {
  try { localStorage.setItem(k, v); } catch { /* 私密模式等环境下忽略 */ }
};

const getApiConfig = () => ({
  apiKey: safeGetLS(LS_KEYS.key),
  apiBase: safeGetLS(LS_KEYS.base) || DEFAULT_API_BASE,
  apiModel: safeGetLS(LS_KEYS.model) || DEFAULT_API_MODEL
});

// --- 统一的 chat/completions 调用封装（OpenAI 兼容） ---
const chatComplete = async ({ system, messages, jsonMode = false }) => {
  const { apiKey, apiBase, apiModel } = getApiConfig();
  if (!apiKey) throw new Error('未配置 API Key，请先在首页填入并保存');
  const body = {
    model: apiModel,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages
    ]
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const response = await fetch(apiBase, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('API 响应为空');
  return content;
};

// --- 自制的语音气泡播放器（取代原生灰色 <audio controls>） ---
function VoiceBubble({ url, duration }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => { setPlaying(false); setProgress(0); };
    const onTime = () => {
      if (a.duration && isFinite(a.duration)) setProgress(a.currentTime / a.duration);
    };
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnd);
    a.addEventListener('timeupdate', onTime);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('timeupdate', onTime);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play(); else a.pause();
  };

  const BAR_COUNT = 18;
  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    const h = 35 + Math.abs(Math.sin(i * 0.9) * 50) + (i % 3) * 8;
    return Math.min(100, h);
  });
  const progressBarIdx = progress * BAR_COUNT;

  return (
    <div className="flex items-center gap-2.5 py-0.5 min-w-[200px]">
      <button
        onClick={toggle}
        className="shrink-0 w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 active:scale-95 flex items-center justify-center transition-all"
      >
        {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
      </button>
      <div className="flex items-center gap-[3px] h-7 flex-1">
        {bars.map((h, i) => {
          const played = i < progressBarIdx;
          return (
            <span
              key={i}
              className={`w-[3px] rounded-full transition-colors ${played ? 'bg-white' : 'bg-white/35'}`}
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>
      <span className="text-xs font-mono tabular-nums opacity-90 shrink-0">{duration}s</span>
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
    </div>
  );
}

// --- 持久化学习进度（刷新保持步骤） ---
const STATE_KEY = 'sec_learning_state';
const loadSavedState = () => {
  try {
    const raw = safeGetLS(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || !parsed) return null;
    return parsed;
  } catch {
    return null;
  }
};

// --- 主应用组件 ---
export default function App() {
  const savedState = loadSavedState();
  const [step, setStep] = useState(savedState?.step || 1); // 1: Input, 2: Learn, 3: Practice, 4: Roleplay
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // 核心数据状态
  const [corpus, setCorpus] = useState(savedState?.corpus || "");
  const [analysisData, setAnalysisData] = useState(savedState?.analysisData || null);

  // 练习题状态
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(savedState?.currentQuestionIdx || 0);
  const [selectedOption, setSelectedOption] = useState(savedState?.selectedOption ?? null);
  const [isAnswerChecked, setIsAnswerChecked] = useState(savedState?.isAnswerChecked || false);
  const [score, setScore] = useState(savedState?.score || 0);

  // 角色扮演状态
  const [chatHistory, setChatHistory] = useState(savedState?.chatHistory || []);
  const [chatInput, setChatInput] = useState("");
  const [isAiTyping, setIsAiTyping] = useState(false);
  const chatEndRef = useRef(null);

  // 跟读评测状态
  const [isRecording, setIsRecording] = useState(false);
  const [recognitionResult, setRecognitionResult] = useState("");
  const [pronunciationFeedback, setPronunciationFeedback] = useState(null);
  const [activeWordId, setActiveWordId] = useState(null);

  // 语音聊天录音状态
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const recordStartRef = useRef(0);
  const audioStreamRef = useRef(null);
  const MAX_RECORD_SEC = 60;

  // API 配置状态（走 localStorage）
  const [apiKeyInput, setApiKeyInput] = useState(() => safeGetLS(LS_KEYS.key));
  const [apiBaseInput, setApiBaseInput] = useState(() => safeGetLS(LS_KEYS.base) || DEFAULT_API_BASE);
  const [apiModelInput, setApiModelInput] = useState(() => safeGetLS(LS_KEYS.model) || DEFAULT_API_MODEL);
  const [showKeyPanel, setShowKeyPanel] = useState(() => !safeGetLS(LS_KEYS.key));
  const [keySaved, setKeySaved] = useState(false);

  // 输入即持久化（不依赖"保存"按钮），刷新后即可直接用
  const persistKey = (v) => {
    setApiKeyInput(v);
    const t = v.trim();
    if (t) safeSetLS(LS_KEYS.key, t);
    else safeSetLS(LS_KEYS.key, '');
  };
  const persistBase = (v) => {
    setApiBaseInput(v);
    safeSetLS(LS_KEYS.base, v.trim() || DEFAULT_API_BASE);
  };
  const persistModel = (v) => {
    setApiModelInput(v);
    safeSetLS(LS_KEYS.model, v.trim() || DEFAULT_API_MODEL);
  };

  const saveApiConfig = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setErrorMsg('API Key 不能为空');
      return false;
    }
    safeSetLS(LS_KEYS.key, trimmed);
    safeSetLS(LS_KEYS.base, apiBaseInput.trim() || DEFAULT_API_BASE);
    safeSetLS(LS_KEYS.model, apiModelInput.trim() || DEFAULT_API_MODEL);
    // 回读校验：Safari 私密模式等情况下 setItem 可能静默失败
    if (safeGetLS(LS_KEYS.key) !== trimmed) {
      setErrorMsg('浏览器禁用了本地存储，无法保存 Key（是否在私密/隐身模式？）');
      return false;
    }
    setShowKeyPanel(false);
    setErrorMsg('');
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
    return true;
  };

  useEffect(() => {
    if (step === 4) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, step, isAiTyping]);

  // 刷新后直接进入 Step 4 时，chatHistory 是空的，重建开场白
  useEffect(() => {
    if (step === 4 && analysisData && chatHistory.length === 0) {
      setChatHistory([{ role: 'ai', content: analysisData.roleplay.firstMessage }]);
    }
  }, [step, analysisData]);

  // 持久化学习进度（所有 step 的核心数据）
  useEffect(() => {
    try {
      // chatHistory 里语音消息的 blob URL 刷新后失效，persist 时剥离成"语音消息 占位"
      const persistableChat = chatHistory.map(msg => {
        if (msg.audio) {
          return { role: msg.role, content: msg.content, _wasAudio: true, _audioDuration: msg.audio.duration };
        }
        return msg;
      });
      safeSetLS(STATE_KEY, JSON.stringify({
        step,
        corpus,
        analysisData,
        currentQuestionIdx,
        selectedOption,
        isAnswerChecked,
        score,
        chatHistory: persistableChat
      }));
    } catch { /* 忽略 localStorage 失败 */ }
  }, [step, corpus, analysisData, currentQuestionIdx, selectedOption, isAnswerChecked, score, chatHistory]);


  // --- API 调用：分析语料生成学习数据 ---
  const handleAnalyze = async () => {
    // 用户体验兜底：填了输入框但没点"保存"，自动替他保存
    if (apiKeyInput.trim() && !getApiConfig().apiKey) {
      if (!saveApiConfig()) return;
    }
    if (!getApiConfig().apiKey) {
      setErrorMsg("请先在上方配置 API Key 并保存。");
      setShowKeyPanel(true);
      return;
    }
    if (!corpus.trim()) {
      setErrorMsg("语料内容不能为空，请填写要学习的段落。");
      return;
    }
    // 简单的字数判断，防止输入过短无法生成足够内容
    if (corpus.trim().length < 15) {
      setErrorMsg("输入的语料太短啦，请至少输入一个完整的句子以便智能分析。");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    const systemPrompt = `你是一位资深的中职英语教师，严格按要求输出 JSON。`;
    const userPrompt = `请分析以下英语语料，并生成教学内容。
语料内容: "${corpus}"

请提取核心词汇（4-6个），生成 3 道单项选择题用于强化理解，并设定一个用于最后口语实战的角色扮演情景。

只返回一个纯 JSON 对象（不要 Markdown 代码围栏、不要任何解释性文字），结构如下：
{
  "theme": "语料的核心主题（中文）",
  "coreVocab": [
    { "word": "【必须是语料中原文出现的字面形态，大小写和词形一致；若语料里是 swimming 就写 swimming，不要写原形 swim】", "lemma": "该词的词典原形，例如 swim / take care of；若与 word 相同也要填写", "phonetic": "音标（不含 // 斜杠，基于 lemma）", "translation": "中文释义", "explanation": "简短的用法说明或例句" }
  ],
  "exercises": [
    { "question": "英文题目", "options": ["A选项","B选项","C选项","D选项"], "answerIndex": 0, "explanation": "中文解析" }
  ],
  "roleplay": {
    "scenario": "情景说明（中文），例如：你在一家酒店前台，你需要接待一位外宾。",
    "aiRole": "AI扮演的角色，例如：外宾",
    "studentRole": "学生扮演的角色，例如：前台接待员",
    "firstMessage": "AI 的第一句开场白（英文）"
  }
}
严格要求：
1. coreVocab 的 word 字段必须是语料文本里**逐字出现**的片段（可用 Ctrl+F 在语料里搜到），用于在原文中高亮定位；不得改写成原形、复数/单数互换、时态变换。
2. coreVocab 的 lemma 字段才是词典原形（给学生记忆用）；若语料里就是原形，lemma 与 word 相同即可。
3. coreVocab 4-6 条；exercises 恰好 3 条，每题 4 个选项，answerIndex 为 0-3 的整数。`;

    try {
      let textResult = await chatComplete({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        jsonMode: true
      });
      textResult = textResult.trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '');
      const parsedData = JSON.parse(textResult);
      setAnalysisData(parsedData);
      setStep(2);
    } catch (err) {
      setErrorMsg(`分析语料失败：${err.message || '未知错误'}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // --- 文本转语音：使用浏览器原生 SpeechSynthesis ---
  const playTTS = (text) => {
    if (!('speechSynthesis' in window)) {
      alert("当前浏览器不支持语音合成，请使用 Chrome/Edge/Safari。");
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'en-US';
      utter.rate = 0.95;
      utter.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => /en[-_]US/i.test(v.lang) && /female|samantha|aria|jenny|zira/i.test(v.name))
        || voices.find(v => /en[-_]US/i.test(v.lang))
        || voices.find(v => /^en/i.test(v.lang));
      if (preferred) utter.voice = preferred;
      window.speechSynthesis.speak(utter);
    } catch (error) {
      console.error("TTS 播放失败", error);
    }
  };

  // --- 浏览器语音识别 (用于跟读评测和口语输入) ---
  const startSpeechRecognition = (expectedText = null, callback = null) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("您的浏览器不支持语音识别功能，推荐使用主流浏览器（如 Chrome/Edge 浏览器）。");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsRecording(true);

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setRecognitionResult(transcript);

      if (callback) {
        callback(transcript);
      } else if (expectedText) {
        // 简单的字符串相似度评测
        const cleanExpected = expectedText.toLowerCase().replace(/[.,!?]/g, '').trim();
        const cleanActual = transcript.toLowerCase().replace(/[.,!?]/g, '').trim();

        if (cleanActual.includes(cleanExpected) || cleanExpected.includes(cleanActual)) {
          setPronunciationFeedback({ status: 'excellent', msg: "发音非常棒！(Excellent)" });
        } else {
          setPronunciationFeedback({ status: 'needs_work', msg: `识别为: "${transcript}"。请再试一次！` });
        }
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error);
      setPronunciationFeedback({ status: 'error', msg: "未获取到声音，请检查设备麦克风权限。" });
    };

    recognition.onend = () => setIsRecording(false);

    recognition.start();
  };

  // --- API 调用：情景对话 (Roleplay) ---
  const buildRoleplaySystemPrompt = () => `你正在和一个中职英语学生进行角色扮演对话。
情景设定: ${analysisData.roleplay.scenario}
你扮演: ${analysisData.roleplay.aiRole}
学生扮演: ${analysisData.roleplay.studentRole}
请保持回复简短、自然（1-3句话），使用适合初中/中职水平的基础词汇。如果学生的回复中存在明显的英语语法/发音错误，请在你的回复中自然地用正确的表达重复一次，以作示范。`;

  // 把 chatHistory 转成 API 消息；历史里的 audio 降级为文本占位（节省 token 与重复编码）
  const historyToApiMessages = (history, audioPayload) => history.map((msg, idx) => {
    const isLast = idx === history.length - 1;
    if (msg.role === 'ai') {
      return { role: 'assistant', content: msg.content };
    }
    if (isLast && audioPayload) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: '请直接用英语自然地回应这段录音（1-3 句）。如学生有明显发音或语法错误，请在你的回复中示范一次正确的表达。' },
          { type: 'input_audio', input_audio: { data: audioPayload.base64, format: audioPayload.format } }
        ]
      };
    }
    return {
      role: 'user',
      content: msg.audio ? `[voice message, ${msg.audio.duration}s]` : msg.content
    };
  });

  const sendChatMessage = async (userMsg) => {
    if (!userMsg.trim()) return;
    const newHistory = [...chatHistory, { role: 'user', content: userMsg }];
    setChatHistory(newHistory);
    setChatInput("");
    setIsAiTyping(true);
    try {
      const aiReply = await chatComplete({
        system: buildRoleplaySystemPrompt(),
        messages: historyToApiMessages(newHistory, null)
      });
      if (aiReply) {
        setChatHistory(prev => [...prev, { role: 'ai', content: aiReply }]);
        playTTS(aiReply);
      }
    } catch (err) {
      console.error("Chat error", err);
      setChatHistory(prev => [...prev, { role: 'ai', content: `(对话出错: ${err.message || '网络异常'}，请重试)` }]);
    } finally {
      setIsAiTyping(false);
    }
  };

  // --- 真录音：MediaRecorder 录 webm/opus，直接发给多模态 API ---
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const pickRecorderMime = () => {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return candidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
  };

  const mimeToFormat = (mime) => {
    const m = (mime || '').toLowerCase();
    if (m.includes('webm')) return 'webm';
    if (m.includes('mp4') || m.includes('m4a')) return 'mp4';
    if (m.includes('ogg')) return 'ogg';
    if (m.includes('wav')) return 'wav';
    return 'webm';
  };

  const stopAudioRecording = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') {
      try { mr.stop(); } catch { /* noop */ }
    }
  };

  // 通用录音函数：录完把 blob 交给 onResult 回调处理（Step 2 发音评测 / Step 4 对话都复用）
  const startAudioRecording = async (onResult, maxSec = 60) => {
    if (isVoiceRecording) { stopAudioRecording(); return; }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      alert('当前浏览器不支持录音，请使用最新的 Chrome/Edge/Safari。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const mime = pickRecorderMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const actualMime = mr.mimeType || mime || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: actualMime });
        const duration = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
        stream.getTracks().forEach(t => t.stop());
        audioStreamRef.current = null;
        setIsVoiceRecording(false);
        if (blob.size > 200) {
          onResult(blob, duration, actualMime);
        }
      };
      recordStartRef.current = Date.now();
      setRecordSec(0);
      mr.start();
      setIsVoiceRecording(true);
      recordTimerRef.current = setInterval(() => {
        const sec = Math.round((Date.now() - recordStartRef.current) / 1000);
        setRecordSec(sec);
        if (sec >= maxSec) stopAudioRecording();
      }, 250);
    } catch (err) {
      console.error(err);
      alert('无法访问麦克风：' + (err?.message || err));
      setIsVoiceRecording(false);
    }
  };

  // Step 2 发音评测：录完发给 AI，让它判断发音好坏
  const evaluatePronunciation = async (blob, mime, item, idx) => {
    const target = item.lemma || item.word;
    setActiveWordId(idx);
    setPronunciationFeedback({ status: 'pending', msg: '正在评测发音...' });
    try {
      const base64 = await blobToBase64(blob);
      const raw = await chatComplete({
        system: '你是一位英语发音教练。严格只返回 JSON，不要 Markdown 围栏、不要任何解释性文字。',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `评估这段录音是否在清晰地念出目标单词/短语。
目标: "${target}"（语料中的形态: "${item.word}"）

严格按以下 JSON 格式回复:
{"status": "excellent|ok|needs_work|not_heard", "heard": "你实际听到的英文（若听不清写 ?）", "tip": "中文简短反馈，不超过 20 字"}

status 含义:
- excellent: 发音清晰基本标准
- ok: 基本正确，只有小瑕疵
- needs_work: 发音和目标差距较大
- not_heard: 录音里几乎没有人声或听不出英文` },
            { type: 'input_audio', input_audio: { data: base64, format: mimeToFormat(mime) } }
          ]
        }],
        jsonMode: true
      });
      const text = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      const r = JSON.parse(text);
      const statusMap = {
        excellent: { status: 'excellent', msg: `发音非常棒！（${r.heard || target}）` },
        ok: { status: 'ok', msg: `基本正确 · ${r.tip || '继续保持'}（识别为：${r.heard || target}）` },
        needs_work: { status: 'needs_work', msg: `${r.tip || '再试一次'}（识别为：${r.heard || '？'}）` },
        not_heard: { status: 'error', msg: '录音里没听到清晰的英文，请靠近麦克风再说一遍' }
      };
      setPronunciationFeedback(statusMap[r.status] || statusMap.needs_work);
    } catch (err) {
      console.error('Pronunciation evaluation error:', err);
      setPronunciationFeedback({ status: 'error', msg: `评测失败：${err.message || '网络异常'}，请重试` });
    }
  };

  const handleSendVoice = async (blob, duration, mime) => {
    const audioUrl = URL.createObjectURL(blob);
    const newMsg = {
      role: 'user',
      content: `[voice ${duration}s]`,
      audio: { url: audioUrl, duration, mime }
    };
    const newHistory = [...chatHistory, newMsg];
    setChatHistory(newHistory);
    setIsAiTyping(true);
    try {
      const base64 = await blobToBase64(blob);
      const aiReply = await chatComplete({
        system: buildRoleplaySystemPrompt(),
        messages: historyToApiMessages(newHistory, { base64, format: mimeToFormat(mime) })
      });
      if (aiReply) {
        setChatHistory(prev => [...prev, { role: 'ai', content: aiReply }]);
        playTTS(aiReply);
      }
    } catch (err) {
      console.error('Voice chat error', err);
      setChatHistory(prev => [...prev, { role: 'ai', content: `(语音处理失败: ${err.message || '网络异常'}，请重试)` }]);
    } finally {
      setIsAiTyping(false);
    }
  };


  // --- 高亮渲染逻辑 ---
  const renderHighlightedCorpus = () => {
    if (!analysisData) return corpus;

    let htmlText = corpus;

    // 1. 转义正则表达式的特殊字符
    const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 2. 将词汇按长度降序排列
    const sortedVocab = [...analysisData.coreVocab].sort((a, b) => b.word.length - a.word.length);

    // 3. 第一轮替换：用独立的占位符替换目标词汇。
    sortedVocab.forEach((item, index) => {
      const escapedWord = escapeRegExp(item.word);
      const regex = new RegExp(`\\b(${escapedWord})\\b`, 'gi');
      htmlText = htmlText.replace(regex, `__HIGHLIGHT_${index}__$1__ENDHIGHLIGHT__`);
    });

    // 4. 第二轮替换：将占位符替换为真实的 HTML 标签。
    sortedVocab.forEach((_, index) => {
      const tokenRegex = new RegExp(`__HIGHLIGHT_${index}__(.*?)__ENDHIGHLIGHT__`, 'g');
      htmlText = htmlText.replace(tokenRegex, `<mark class="bg-yellow-200 text-yellow-900 px-1.5 mx-0.5 rounded-md font-semibold border-b-2 border-yellow-500 shadow-sm">$1</mark>`);
    });

    return <div className="text-lg leading-relaxed text-slate-700 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: htmlText }} />;
  };

  // --- 练习题逻辑 ---
  const handleAnswerSubmit = () => {
    if (selectedOption === null) return;
    setIsAnswerChecked(true);
    if (selectedOption === analysisData.exercises[currentQuestionIdx].answerIndex) {
      setScore(prev => prev + 1);
    }
  };

  const nextQuestion = () => {
    setIsAnswerChecked(false);
    setSelectedOption(null);
    if (currentQuestionIdx < analysisData.exercises.length - 1) {
      setCurrentQuestionIdx(prev => prev + 1);
    } else {
      // 进入角色扮演初始化
      setChatHistory([{ role: 'ai', content: analysisData.roleplay.firstMessage }]);
      setStep(4);
    }
  };

  // ================= 渲染视图 =================

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 flex flex-col items-center p-4 sm:p-8">
      {/* 头部进度指示 */}
      <div className="w-full max-w-3xl flex items-center justify-between mb-8 px-4">
        {[
          { id: 1, label: "输入语料" },
          { id: 2, label: "理解跟读" },
          { id: 3, label: "强化练习" },
          { id: 4, label: "口语实战" }
        ].map((s, i) => (
          <div key={s.id} className="flex flex-col items-center flex-1 relative">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mb-2 transition-colors z-10 ${step >= s.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-200 text-slate-500'}`}>
              {s.id}
            </div>
            <span className={`text-xs hidden sm:block ${step >= s.id ? 'text-indigo-800 font-semibold' : 'text-slate-400'}`}>{s.label}</span>
            {/* 连接线 */}
            {i < 3 && <div className={`hidden sm:block absolute h-1 w-full bg-slate-200 top-4 left-1/2`} />}
          </div>
        ))}
      </div>

      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100 flex flex-col flex-1 min-h-[600px] max-h-[85vh]">

        {/* ================= Step 1: 输入语料 ================= */}
        {step === 1 && (
          <div className="p-6 sm:p-10 flex flex-col h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="mb-6">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-indigo-900 mb-2">定制学习语料</h1>
              <p className="text-slate-500 text-sm sm:text-base">请在下方粘贴或输入你要学习的英语段落，系统将为你量身定制学习和对话任务。</p>
            </div>

            {/* API 配置面板 */}
            <div className="mb-5 border-2 border-slate-200 rounded-2xl bg-white overflow-hidden">
              <button
                onClick={() => setShowKeyPanel(v => !v)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <KeyRound className="w-4 h-4 text-indigo-600" />
                  API 配置
                  {apiKeyInput ? (
                    <>
                      <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">已缓存</span>
                      <span className="text-xs text-slate-400 font-mono">····{apiKeyInput.trim().slice(-4)}</span>
                    </>
                  ) : (
                    <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-medium">未配置</span>
                  )}
                  {keySaved && <span className="text-xs text-green-600 font-medium animate-in fade-in">✓ 已更新</span>}
                </span>
                {showKeyPanel ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>

              {showKeyPanel && (
                <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-100 animate-in fade-in slide-in-from-top-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">API Key <span className="text-red-500">*</span></label>
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => persistKey(e.target.value)}
                      placeholder="粘贴你的 API Key，例如 kie.ai 的 key"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">API Base URL</label>
                    <input
                      type="text"
                      value={apiBaseInput}
                      onChange={(e) => persistBase(e.target.value)}
                      placeholder={DEFAULT_API_BASE}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
                    <input
                      type="text"
                      value={apiModelInput}
                      onChange={(e) => persistModel(e.target.value)}
                      placeholder={DEFAULT_API_MODEL}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
                    />
                  </div>
                  <button
                    onClick={saveApiConfig}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <Save className="w-4 h-4" /> 保存到本机
                  </button>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    🔒 Key 仅存在于你浏览器的 localStorage，不会上传到任何服务器，也不会出现在代码仓库里。换浏览器或清缓存后需要重新填写。
                  </p>
                </div>
              )}
            </div>

            <textarea
              className="w-full flex-1 min-h-[250px] p-5 border-2 border-slate-200 rounded-2xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all resize-none text-base sm:text-lg text-slate-700 shadow-sm"
              placeholder="请输入或粘贴英语段落（例如一篇小短文、一段对话等）..."
              value={corpus}
              onChange={(e) => setCorpus(e.target.value)}
            />

            {errorMsg && (
              <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-xl flex items-center gap-2 text-sm">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={loading || !corpus.trim()}
              className="mt-6 w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-2xl font-bold text-lg flex justify-center items-center gap-2 transition-all shadow-lg hover:shadow-indigo-200"
            >
              {loading ? <><Loader2 className="w-6 h-6 animate-spin" /> 正在智能生成学习路径...</> : <><BookOpen className="w-6 h-6" /> 开始学习</>}
            </button>
          </div>
        )}

        {/* ================= Step 2: 理解与跟读 ================= */}
        {step === 2 && analysisData && (
          <div className="p-6 sm:p-10 flex flex-col h-full overflow-y-auto animate-in fade-in zoom-in-95 duration-500">
            <div className="bg-slate-50 border border-indigo-100 p-5 sm:p-6 rounded-2xl mb-8">
              <h2 className="text-sm font-bold text-indigo-500 uppercase tracking-wider mb-3">语料解析 · {analysisData.theme}</h2>
              {renderHighlightedCorpus()}
            </div>

            <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Mic className="w-6 h-6 text-indigo-600" /> 核心业务词汇跟读
            </h3>

            <div className="grid gap-4 mb-8">
              {analysisData.coreVocab.map((item, idx) => (
                <div key={idx} className={`p-4 sm:p-5 border-2 rounded-2xl transition-all ${activeWordId === idx ? 'border-indigo-400 bg-indigo-50/50 shadow-md' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
                  <div className="flex justify-between items-start sm:items-center flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-end gap-2 sm:gap-3 mb-1">
                        <span className="text-xl font-bold text-indigo-900">{item.word}</span>
                        {item.lemma && item.lemma.toLowerCase() !== item.word.toLowerCase() && (
                          <span className="text-xs text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">
                            原形：{item.lemma}
                          </span>
                        )}
                        <span className="text-slate-500 font-mono text-sm">/{item.phonetic}/</span>
                      </div>
                      <div className="text-slate-700 font-medium mb-1.5">{item.translation}</div>
                      <div className="text-sm text-slate-500 bg-slate-50 p-2 rounded-lg inline-block w-full">{item.explanation}</div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
                      <button
                        onClick={() => playTTS(item.word)}
                        className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full transition-colors"
                        title="标准示范"
                      >
                        <Volume2 className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => {
                          setActiveWordId(idx);
                          setPronunciationFeedback(null);
                          startAudioRecording(
                            (blob, _dur, mime) => evaluatePronunciation(blob, mime, item, idx),
                            8
                          );
                        }}
                        disabled={pronunciationFeedback?.status === 'pending' && activeWordId === idx}
                        className={`rounded-full transition-all text-white shadow-md flex items-center gap-2 font-mono ${
                          isVoiceRecording && activeWordId === idx
                            ? 'bg-red-500 animate-pulse px-4 py-3'
                            : 'bg-indigo-600 hover:bg-indigo-700 p-3'
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                        title={isVoiceRecording && activeWordId === idx ? '点击停止' : '点击录音跟读（最长 8s）'}
                      >
                        {isVoiceRecording && activeWordId === idx ? (
                          <>
                            <Square className="w-4 h-4 fill-current" />
                            <span className="text-sm tabular-nums">{String(recordSec).padStart(2, '0')}s</span>
                          </>
                        ) : (
                          <Mic className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 发音反馈展示 */}
                  {activeWordId === idx && pronunciationFeedback && (() => {
                    const s = pronunciationFeedback.status;
                    const colorClass = s === 'excellent' ? 'bg-green-100 text-green-800'
                      : s === 'ok' ? 'bg-emerald-100 text-emerald-800'
                      : s === 'pending' ? 'bg-slate-100 text-slate-600'
                      : s === 'error' ? 'bg-red-100 text-red-800'
                      : 'bg-orange-100 text-orange-800';
                    const IconEl = s === 'excellent' || s === 'ok'
                      ? <CheckCircle2 className="w-5 h-5 shrink-0" />
                      : s === 'pending'
                        ? <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
                        : <XCircle className="w-5 h-5 shrink-0" />;
                    return (
                      <div className={`mt-4 p-3 rounded-xl text-sm flex items-center gap-2 animate-in slide-in-from-top-2 ${colorClass}`}>
                        {IconEl}
                        <span className="font-medium">{pronunciationFeedback.msg}</span>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>

            <div className="mt-auto pt-4">
              <button
                onClick={() => setStep(3)}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-lg flex justify-center items-center gap-2 transition-all shadow-lg"
              >
                已掌握，进入强化练习 <ArrowRight className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}

        {/* ================= Step 3: 强化练习 ================= */}
        {step === 3 && analysisData && (
          <div className="p-6 sm:p-10 flex flex-col h-full overflow-y-auto animate-in fade-in slide-in-from-right-8 duration-500">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-bold text-slate-800">小测验：理解巩固</h2>
              <span className="text-indigo-600 font-bold bg-indigo-100 px-4 py-1.5 rounded-full text-sm">
                题 {currentQuestionIdx + 1} / {analysisData.exercises.length}
              </span>
            </div>

            <div className="flex-1">
              <h3 className="text-lg sm:text-xl text-indigo-950 font-medium mb-6 leading-relaxed">
                {analysisData.exercises[currentQuestionIdx].question}
              </h3>

              <div className="grid gap-3">
                {analysisData.exercises[currentQuestionIdx].options.map((opt, idx) => {
                  let btnClass = "w-full text-left p-4 sm:p-5 rounded-2xl border-2 transition-all font-medium text-slate-700 text-base ";

                  if (!isAnswerChecked) {
                    btnClass += selectedOption === idx ? "border-indigo-500 bg-indigo-50 shadow-sm" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50 bg-white";
                  } else {
                    if (idx === analysisData.exercises[currentQuestionIdx].answerIndex) {
                      btnClass += "border-green-500 bg-green-50 text-green-800 shadow-sm"; // 正确答案
                    } else if (selectedOption === idx) {
                      btnClass += "border-red-500 bg-red-50 text-red-800"; // 错误答案
                    } else {
                      btnClass += "border-slate-200 opacity-50"; // 未选择的其他项
                    }
                  }

                  return (
                    <button
                      key={idx}
                      disabled={isAnswerChecked}
                      onClick={() => setSelectedOption(idx)}
                      className={btnClass}
                    >
                      <span className="inline-block w-6 font-bold">{String.fromCharCode(65 + idx)}.</span> {opt}
                    </button>
                  );
                })}
              </div>

              {isAnswerChecked && (
                <div className="mt-6 p-5 bg-blue-50 rounded-2xl border border-blue-100 animate-in fade-in slide-in-from-bottom-4">
                  <div className="font-bold text-blue-900 mb-2 flex items-center gap-2">
                    {selectedOption === analysisData.exercises[currentQuestionIdx].answerIndex ? "🎉 回答正确！" : "💪 再接再厉！"}
                  </div>
                  <p className="text-blue-800 text-sm sm:text-base leading-relaxed">
                    <span className="font-semibold">解析：</span>{analysisData.exercises[currentQuestionIdx].explanation}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-8 pt-4">
              {!isAnswerChecked ? (
                <button
                  disabled={selectedOption === null}
                  onClick={handleAnswerSubmit}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-2xl font-bold text-lg transition-all shadow-lg"
                >
                  确定答案
                </button>
              ) : (
                <button
                  onClick={nextQuestion}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-bold text-lg flex justify-center items-center gap-2 transition-all shadow-lg"
                >
                  {currentQuestionIdx < analysisData.exercises.length - 1 ? "下一题" : "全部完成，进入情景实战"} <ArrowRight className="w-6 h-6" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ================= Step 4: 口语实战 (Roleplay) ================= */}
        {step === 4 && analysisData && (
          <div className="flex flex-col h-full bg-slate-50 animate-in fade-in duration-700">
            {/* 对话情景头部 */}
            <div className="bg-indigo-600 p-4 sm:p-5 text-white shrink-0 relative overflow-hidden">
              <div className="relative z-10">
                <h2 className="text-lg font-bold flex items-center gap-2 mb-2">
                  <MessageSquare className="w-5 h-5" /> 角色扮演实战
                </h2>
                <p className="text-indigo-100 text-sm leading-relaxed mb-1">
                  <span className="font-semibold text-white">场景：</span>{analysisData.roleplay.scenario}
                </p>
                <p className="text-indigo-100 text-sm">
                  <span className="font-semibold text-white">你扮演：</span><span className="inline-block bg-yellow-400 text-indigo-900 px-2 py-0.5 rounded font-bold">{analysisData.roleplay.studentRole}</span>
                </p>
              </div>
              {/* 背景装饰 */}
              <div className="absolute right-[-20px] top-[-20px] opacity-10">
                <MessageSquare className="w-32 h-32" />
              </div>
            </div>

            {/* 聊天记录区 */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-50/50">
              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                  <div className={`max-w-[85%] sm:max-w-[75%] p-4 rounded-3xl ${msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-tr-sm shadow-md'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm'
                    }`}>
                    {msg.role === 'ai' && (
                      <button onClick={() => playTTS(msg.content)} className="mb-2 text-indigo-500 hover:text-indigo-700 bg-indigo-50 p-1.5 rounded-full inline-block">
                        <Volume2 className="w-4 h-4" />
                      </button>
                    )}
                    {msg.audio ? (
                      <VoiceBubble url={msg.audio.url} duration={msg.audio.duration} />
                    ) : msg._wasAudio ? (
                      <div className="flex items-center gap-2 opacity-75">
                        <Mic className="w-4 h-4 shrink-0" />
                        <span className="italic text-sm">语音消息 · {msg._audioDuration}s</span>
                        <span className="text-xs opacity-60">（刷新后无法回放）</span>
                      </div>
                    ) : (
                      <p className="leading-relaxed text-base">{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}
              {isAiTyping && (
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-200 p-4 rounded-3xl rounded-tl-sm shadow-sm flex gap-2 items-center">
                    <span className="w-2.5 h-2.5 bg-indigo-300 rounded-full animate-bounce"></span>
                    <span className="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                    <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* 底部输入区 */}
            <div className="bg-white p-3 sm:p-4 border-t border-slate-200 shrink-0">
              <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-full border border-slate-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
                <button
                  onClick={() => startAudioRecording((blob, dur, mime) => handleSendVoice(blob, dur, mime), MAX_RECORD_SEC)}
                  disabled={isAiTyping}
                  className={`shrink-0 rounded-full transition-all flex items-center gap-2 font-mono ${
                    isVoiceRecording
                      ? 'bg-red-500 text-white animate-pulse px-4 py-2.5'
                      : 'bg-white text-indigo-600 hover:bg-slate-50 shadow-sm p-3'
                  } ${isAiTyping ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title={isVoiceRecording ? '点击停止并发送' : '点击开始录音'}
                >
                  {isVoiceRecording ? (
                    <>
                      <Square className="w-4 h-4 fill-current" />
                      <span className="text-sm tabular-nums">
                        {String(Math.floor(recordSec / 60)).padStart(2, '0')}:{String(recordSec % 60).padStart(2, '0')}
                      </span>
                    </>
                  ) : (
                    <Mic className="w-5 h-5" />
                  )}
                </button>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChatMessage(chatInput)}
                  placeholder={isVoiceRecording ? '录音中，再次点击左侧按钮结束并发送' : '可打字，或点击左侧麦克风说话（最长 60s）'}
                  disabled={isVoiceRecording}
                  className="flex-1 bg-transparent border-none focus:outline-none px-2 text-slate-700 text-base w-full disabled:text-slate-400"
                />
                <button
                  onClick={() => sendChatMessage(chatInput)}
                  disabled={!chatInput.trim() || isAiTyping || isVoiceRecording}
                  className="p-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-full shrink-0 transition-colors shadow-sm"
                >
                  <Send className="w-5 h-5 -ml-0.5 mt-0.5" />
                </button>
              </div>
            </div>

            <div className="bg-white px-4 pb-4 pt-1 flex justify-center">
              <button onClick={() => { setStep(1); setCorpus(""); setAnalysisData(null); setChatHistory([]); setCurrentQuestionIdx(0); setSelectedOption(null); setIsAnswerChecked(false); setScore(0); }} className="text-sm text-slate-400 flex items-center gap-1 hover:text-indigo-600 transition-colors py-2 px-4 rounded-full hover:bg-slate-50">
                <RotateCcw className="w-4 h-4" /> 结束练习，返回首页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}