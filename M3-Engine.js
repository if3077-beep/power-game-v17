// ============================================================
//  M3: 核心引擎（粒子/光标/音频/状态/打字机/转场）
// ============================================================

// --- 粒子系统 ---
const canvas = document.getElementById('particles');
const pCtx = canvas.getContext('2d');
let particles = [];
// V18 Round 3: 移动端性能优化 — 设备探测 + 降级策略
const PERF = (function detectPerf() {
  const ua = navigator.userAgent || '';
  const isMobile = /Mobi|Android|iPhone|iPod|iPad|Windows Phone/i.test(ua);
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // 限制 DPR 上限避免高清屏过载
  const vw = window.innerWidth, vh = window.innerHeight;
  const smallScreen = Math.min(vw, vh) < 600;
  // prefers-reduced-motion: 完全关闭粒子动画
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    isMobile, isTouch, dpr, smallScreen, reducedMotion,
    particleCount: reducedMotion ? 0 : (isMobile || smallScreen ? 25 : 60),
    targetFps: (isMobile || smallScreen) ? 30 : 60, // 移动端限 30fps
    frameInterval: 1000 / ((isMobile || smallScreen) ? 30 : 60),
  };
})();
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resizeCanvas();
// V18 Round 3: debounce resize (150ms) — 避免拖拽窗口时频繁重绘
let _resizeTimer = null;
window.addEventListener('resize', () => {
  if (_resizeTimer) clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(resizeCanvas, 150);
}, { passive: true });
// V14.5: 渠道栏滑动时出现，静止后消失
let channelBarTimer = null;
// V18 Round 3: throttle scroll (节流 ~16ms ≈ 60fps 上限) — 用 rAF 节流
let _scrollTicking = false;
window.addEventListener('scroll', () => {
  if (_scrollTicking) return;
  _scrollTicking = true;
  requestAnimationFrame(() => {
    const bar = document.getElementById('channelsBar');
    if (bar) {
      bar.classList.add('visible');
      clearTimeout(channelBarTimer);
      channelBarTimer = setTimeout(() => { bar.classList.remove('visible'); }, 1500);
    }
    _scrollTicking = false;
  });
}, { passive: true });
class Particle {
  constructor() { this.reset(); }
  reset() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.size = Math.random() * 1.5 + 0.3;
    this.speedY = -(Math.random() * 0.3 + 0.05);
    this.speedX = (Math.random() - 0.5) * 0.2;
    this.opacity = Math.random() * 0.4 + 0.1;
    this.life = Math.random() * 200 + 100;
    this.maxLife = this.life;
  }
  update() {
    this.x += this.speedX; this.y += this.speedY; this.life--;
    if (this.life <= 0 || this.y < -10) this.reset();
  }
  draw() {
    const a = this.opacity * (this.life / this.maxLife);
    if (this.color) {
      pCtx.fillStyle = this.color.replace(')', `,${a})`).replace('rgb(', 'rgba(');
    } else {
      pCtx.fillStyle = `rgba(201,169,110,${a})`;
    }
    pCtx.beginPath(); pCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2); pCtx.fill();
  }
}
for (let i = 0; i < PERF.particleCount; i++) particles.push(new Particle());
// V18 Round 3: 帧率限制 — 移动端 30fps, 桌面 60fps; reduced-motion 直接停止
let _lastFrameTime = 0;
let _particleRAF = null;
function animateParticles(ts) {
  if (PERF.reducedMotion) { pCtx.clearRect(0, 0, canvas.width, canvas.height); return; }
  _particleRAF = requestAnimationFrame(animateParticles);
  if (ts - _lastFrameTime < PERF.frameInterval - 1) return; // 帧率门控
  _lastFrameTime = ts;
  pCtx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < particles.length; i++) { particles[i].update(); particles[i].draw(); }
}
_particleRAF = requestAnimationFrame(animateParticles);
// V18 Round 3: 页面隐藏时暂停粒子动画 (省电)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (_particleRAF) { cancelAnimationFrame(_particleRAF); _particleRAF = null; }
  } else if (!_particleRAF && !PERF.reducedMotion) {
    _lastFrameTime = 0;
    _particleRAF = requestAnimationFrame(animateParticles);
  }
});

// --- 光标跟随 ---
const glow = document.getElementById('cursorGlow');
// V18 Round 3: 触摸设备禁用光标跟随 (无鼠标); 桌面用 rAF 节流
if (glow && !PERF.isTouch) {
  let _glowRAF = null;
  let _glowX = 0, _glowY = 0;
  document.addEventListener('mousemove', e => {
    _glowX = e.clientX; _glowY = e.clientY;
    if (_glowRAF) return;
    _glowRAF = requestAnimationFrame(() => {
      glow.style.transform = `translate(${_glowX}px, ${_glowY}px) translate(-50%, -50%)`;
      _glowRAF = null;
    });
  }, { passive: true });
} else if (glow) {
  glow.style.display = 'none'; // 触摸设备隐藏光标光晕
}

// --- 音频系统（AudioEngine）V8 ---
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.reverbNode = null;
    this.reverbGain = null;
    this.enabled = false;
    this.bgmRunning = false;
    this._bgmTimer = null;
    this._bgmStep = 0;
    this._bgmStyle = null;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(this.ctx.destination);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.5;
    this.bgmGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.7;
    this.sfxGain.connect(this.master);
    // 延迟混响（模拟空间感）
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.25;
    this.reverbGain.connect(this.master);
  }

  enable() {
    this.init();
    this.enabled = true;
    const btn = document.getElementById('audioBtn');
    if (btn) btn.classList.remove('muted');
  }

  toggle() {
    this.init();
    this.enabled = !this.enabled;
    const btn = document.getElementById('audioBtn');
    if (btn) btn.classList.toggle('muted', !this.enabled);
    if (!this.enabled) this.stopBGM();
    return this.enabled;
  }

  // --- V8: 增强音效 ---
  play(type) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const sounds = {
      click: () => {
        this._tone(1800, 0.05, 'sine', this.sfxGain, 0.25);
        this._tone(2400, 0.03, 'sine', this.sfxGain, 0.12);
      },
      debt: () => {
        this._tone(280, 0.35, 'triangle', this.sfxGain, 0.45);
        setTimeout(() => this._tone(220, 0.3, 'triangle', this.sfxGain, 0.3), 150);
        setTimeout(() => this._tone(165, 0.4, 'triangle', this.sfxGain, 0.18), 300);
      },
      scene: () => {
        this._tone(392, 0.25, 'sine', this.sfxGain, 0.3);
        setTimeout(() => this._tone(523, 0.3, 'sine', this.sfxGain, 0.22), 120);
        this._delay(392, 0.5, 0.12);
      },
      ending: () => {
        this._tone(392, 0.5, 'sine', this.sfxGain, 0.45);
        setTimeout(() => this._tone(523, 0.5, 'sine', this.sfxGain, 0.35), 300);
        setTimeout(() => this._tone(659, 0.6, 'sine', this.sfxGain, 0.3), 600);
        setTimeout(() => this._tone(784, 1.0, 'sine', this.sfxGain, 0.25), 900);
        this._delay(523, 1.5, 0.15);
      },
      ink: () => {
        this._noise(0.3, 0.25);
        this._tone(120, 0.45, 'sawtooth', this.sfxGain, 0.2);
      },
      success: () => {
        this._tone(523, 0.2, 'sine', this.sfxGain, 0.4);
        setTimeout(() => this._tone(659, 0.2, 'sine', this.sfxGain, 0.3), 100);
        setTimeout(() => this._tone(784, 0.35, 'sine', this.sfxGain, 0.25), 200);
      },
      fail: () => {
        this._tone(330, 0.4, 'sawtooth', this.sfxGain, 0.35);
        setTimeout(() => this._tone(220, 0.55, 'sawtooth', this.sfxGain, 0.25), 200);
        this._delay(220, 1.0, 0.12);
      },
      scroll: () => {
        this._noise(0.15, 0.12);
        this._tone(180, 0.15, 'triangle', this.sfxGain, 0.2);
      },
      channelLost: () => {
        this._tone(180, 0.7, 'sawtooth', this.sfxGain, 0.35);
        setTimeout(() => this._tone(130, 0.9, 'sawtooth', this.sfxGain, 0.25), 300);
        this._delay(130, 1.2, 0.12);
      },
      zhongyong: () => {
        this._tone(523, 0.3, 'sine', this.sfxGain, 0.3);
        setTimeout(() => this._tone(440, 0.35, 'sine', this.sfxGain, 0.25), 200);
        setTimeout(() => this._tone(392, 0.4, 'sine', this.sfxGain, 0.2), 400);
        setTimeout(() => this._tone(349, 0.55, 'sine', this.sfxGain, 0.18), 600);
        this._delay(392, 1.0, 0.12);
      },
      dramatic: () => {
        this._tone(110, 0.6, 'sawtooth', this.sfxGain, 0.35);
        this._tone(165, 0.5, 'square', this.sfxGain, 0.15);
        setTimeout(() => this._tone(220, 0.5, 'triangle', this.sfxGain, 0.25), 250);
        this._delay(110, 1.2, 0.15);
      },
      choice_hover: () => {
        this._tone(600, 0.04, 'sine', this.sfxGain, 0.15);
      },
      // V20 R8: AI 支线专属音效 — 智能体觉醒主题
      agent_awaken: () => {
        // 觉醒音:从低频嗡鸣到高频清脆,模拟"意识涌现"
        this._tone(110, 0.8, 'sine', this.sfxGain, 0.15);
        setTimeout(() => this._tone(220, 0.5, 'sine', this.sfxGain, 0.18), 200);
        setTimeout(() => this._tone(440, 0.4, 'sine', this.sfxGain, 0.15), 400);
        setTimeout(() => this._tone(880, 0.6, 'sine', this.sfxGain, 0.12), 600);
        this._delay(440, 1.2, 0.10);
      },
      agent_cluster: () => {
        // 集群音:多频叠加,模拟智能体集群协作
        this._tone(330, 0.3, 'triangle', this.sfxGain, 0.12);
        setTimeout(() => this._tone(415, 0.3, 'triangle', this.sfxGain, 0.12), 80);
        setTimeout(() => this._tone(494, 0.3, 'triangle', this.sfxGain, 0.12), 160);
        setTimeout(() => this._tone(659, 0.5, 'sine', this.sfxGain, 0.15), 240);
      },
      agent_breakthrough: () => {
        // 突破音:从噪音到和谐,模拟"涌现"
        this._noise(0.4, 0.15);
        setTimeout(() => {
          this._tone(523, 0.3, 'sine', this.sfxGain, 0.18);
          this._tone(659, 0.3, 'sine', this.sfxGain, 0.15);
          this._tone(784, 0.4, 'sine', this.sfxGain, 0.12);
        }, 300);
        this._delay(784, 1.0, 0.12);
      },
      agent_dataflow: () => {
        // 数据流音:快速琶音,模拟数据流动
        const notes = [392, 440, 494, 523, 587, 659, 698, 784];
        notes.forEach((n, i) => setTimeout(() => this._tone(n, 0.08, 'sine', this.sfxGain, 0.08), i * 40));
      },
      // V14.6: 首页卡牌扫过音效 — 微升调
      landing_scan: () => {
        this._tone(800, 0.06, 'sine', this.sfxGain, 0.10);
        setTimeout(() => this._tone(1100, 0.04, 'sine', this.sfxGain, 0.07), 40);
      },
      // V14.6: 标题乱码音效 — 短噪音
      glitch_tick: () => {
        this._noise(0.03, 0.06);
      },
      // V14.3: 情感分类音效 — 更有区分度，平衡音量
      choice_moral: () => {
        this._tone(523, 0.18, 'sine', this.sfxGain, 0.28);
        setTimeout(() => this._tone(659, 0.18, 'sine', this.sfxGain, 0.2), 100);
        setTimeout(() => this._tone(784, 0.3, 'sine', this.sfxGain, 0.15), 200);
        this._delay(659, 0.6, 0.08);
      },
      choice_self_serving: () => {
        this._tone(900, 0.07, 'square', this.sfxGain, 0.18);
        setTimeout(() => this._tone(1200, 0.05, 'sine', this.sfxGain, 0.1), 60);
      },
      choice_compromise: () => {
        this._tone(330, 0.22, 'triangle', this.sfxGain, 0.2);
        setTimeout(() => this._tone(440, 0.18, 'sine', this.sfxGain, 0.12), 80);
      },
      choice_betrayal: () => {
        this._tone(440, 0.18, 'sawtooth', this.sfxGain, 0.22);
        setTimeout(() => this._tone(311, 0.22, 'sawtooth', this.sfxGain, 0.18), 120);
        setTimeout(() => this._tone(220, 0.35, 'sawtooth', this.sfxGain, 0.14), 250);
        this._delay(220, 0.9, 0.08);
      },
      choice_passive: () => {
        this._tone(200, 0.45, 'sine', this.sfxGain, 0.16);
        this._delay(150, 0.9, 0.06);
      },
      // V11: 惩罚音效
      penalty: () => {
        this._tone(180, 0.5, 'sawtooth', this.sfxGain, 0.35);
        setTimeout(() => this._tone(130, 0.6, 'square', this.sfxGain, 0.25), 200);
        setTimeout(() => this._tone(98, 0.8, 'sawtooth', this.sfxGain, 0.2), 400);
        this._noise(0.3, 0.15);
      },
      chapter: () => {
        this._tone(261, 0.35, 'sine', this.sfxGain, 0.3);
        setTimeout(() => this._tone(329, 0.35, 'sine', this.sfxGain, 0.25), 200);
        setTimeout(() => this._tone(392, 0.55, 'sine', this.sfxGain, 0.2), 400);
        this._delay(329, 1.0, 0.1);
      },
      // V20 R7: 章节进度音效 — 序章柔和、转折悬疑、终章庄严
      chapter_prologue: () => {
        this._tone(196, 0.5, 'sine', this.sfxGain, 0.28);
        setTimeout(() => this._tone(261, 0.5, 'sine', this.sfxGain, 0.22), 250);
        setTimeout(() => this._tone(329, 0.7, 'sine', this.sfxGain, 0.18), 500);
        this._delay(261, 1.2, 0.1);
      },
      chapter_turn: () => {
        this._tone(330, 0.3, 'triangle', this.sfxGain, 0.28);
        setTimeout(() => this._tone(392, 0.25, 'sine', this.sfxGain, 0.22), 150);
        setTimeout(() => this._tone(330, 0.3, 'triangle', this.sfxGain, 0.2), 350);
        setTimeout(() => this._tone(440, 0.4, 'sine', this.sfxGain, 0.15), 550);
      },
      chapter_climax: () => {
        this._tone(110, 0.4, 'sawtooth', this.sfxGain, 0.25);
        this._tone(165, 0.3, 'triangle', this.sfxGain, 0.12);
        setTimeout(() => this._tone(220, 0.5, 'triangle', this.sfxGain, 0.2), 200);
        setTimeout(() => this._tone(277, 0.6, 'sine', this.sfxGain, 0.15), 450);
        this._delay(110, 1.3, 0.12);
      },
      chapter_finale: () => {
        this._tone(130, 0.6, 'sine', this.sfxGain, 0.35);
        setTimeout(() => this._tone(196, 0.6, 'sine', this.sfxGain, 0.28), 350);
        setTimeout(() => this._tone(261, 0.7, 'sine', this.sfxGain, 0.22), 700);
        setTimeout(() => this._tone(392, 1.2, 'sine', this.sfxGain, 0.18), 1050);
        this._delay(196, 1.8, 0.12);
      },
      // V20 R10: 水墨晕染转场音效 — 墨滴低响 + 晕开低嗡,匹配ink-bloom动画
      ink_bloom: () => {
        this._tone(90, 0.18, 'sine', this.sfxGain, 0.32);
        setTimeout(() => this._tone(55, 0.55, 'sine', this.sfxGain, 0.2), 90);
        this._delay(60, 0.7, 0.1);
      },
    };
    (sounds[type] || sounds.click)();
  }

  // --- V8: BGM — 多声部 + 和声进行 ---
  startBGM(style) {
    if (!this.enabled || !this.ctx) return;
    if (this.bgmRunning) this.stopBGM();
    this.bgmRunning = true;
    this._bgmStyle = style;
    this._bgmStep = 0;

    const configs = {
      whitehouse: {
        // 白宫：军鼓行进感 d小调，庄严紧张
        melody:  [293,261,293,349,330,293,261,247,261,293,349,392,349,330,293,261],
        harmony: [146,130,146,175,165,146,130,123,130,146,175,196,175,165,146,130],
        bass:    [73, 65, 73, 87, 82, 73, 65, 62, 65, 73, 87, 98, 87, 82, 73, 65],
        wave: 'triangle', harmWave: 'sine', tempo: 1800, melVol: 0.28, harmVol: 0.14, bassVol: 0.2,
      },
      ming: {
        // 大明：五声调式 古琴韵味，宫商角徵羽
        melody:  [261,293,329,392,440,523,587,523,440,392,329,293,261,220,196,261],
        harmony: [130,146,165,196,220,261,293,261,220,196,165,146,130,110, 98,130],
        bass:    [65, 73, 82, 98,110,130,147,130,110, 98, 82, 73, 65, 55, 49, 65],
        wave: 'sine', harmWave: 'triangle', tempo: 2600, melVol: 0.22, harmVol: 0.12, bassVol: 0.14,
      },
      ai: {
        // AI：高频琶音 C大调 电子脉冲
        melody:  [523,659,784,880,1047,880,784,659,523,440,392,440,523,659,784,523],
        harmony: [261,330,392,440,523,440,392,330,261,220,196,220,261,330,392,261],
        bass:    [130,165,196,220,261,220,196,165,130,110, 98,110,130,165,196,130],
        wave: 'sine', harmWave: 'sine', tempo: 1500, melVol: 0.2, harmVol: 0.1, bassVol: 0.15,
      },
      africa: {
        // 非洲：五度循环 部落鼓点 F大调
        melody:  [349,392,440,349,330,261,293,330,349,293,261,220,196,261,293,349],
        harmony: [175,196,220,175,165,130,146,165,175,146,130,110, 98,130,146,175],
        bass:    [87, 98,110, 87, 82, 65, 73, 82, 87, 73, 65, 55, 49, 65, 73, 87],
        wave: 'triangle', harmWave: 'sine', tempo: 2000, melVol: 0.24, harmVol: 0.14, bassVol: 0.24,
      },
      cyber: {
        // 3077：半音阶下行 工业合成器 暗黑
        melody:  [370,349,330,311,293,277,261,247,233,220,247,261,277,311,349,370],
        harmony: [185,175,165,155,146,139,130,124,117,110,124,130,139,155,175,185],
        bass:    [93, 87, 82, 77, 73, 69, 65, 62, 58, 55, 62, 65, 69, 77, 87, 93],
        wave: 'sawtooth', harmWave: 'square', tempo: 1300, melVol: 0.14, harmVol: 0.08, bassVol: 0.28,
      },
      cyber_high: {
        // 3077高强度：不协和半音 工业噪音
        melody:  [311,277,261,233,220,208,196,208,220,247,277,330,370,392,440,370],
        harmony: [155,139,130,117,110,104, 98,104,110,124,139,165,185,196,220,185],
        bass:    [77, 69, 65, 58, 55, 52, 49, 52, 55, 62, 69, 82, 93, 98,110, 93],
        wave: 'sawtooth', harmWave: 'sawtooth', tempo: 900, melVol: 0.1, harmVol: 0.06, bassVol: 0.32,
      },
      korea: {
        // 韩国：大调卡农进行 温暖吉他感
        melody:  [392,440,494,523,587,523,494,440,392,349,330,349,392,440,494,392],
        harmony: [196,220,247,261,293,261,247,220,196,175,165,175,196,220,247,196],
        bass:    [98,110,124,130,147,130,124,110, 98, 87, 82, 87, 98,110,124, 98],
        wave: 'sine', harmWave: 'triangle', tempo: 2800, melVol: 0.2, harmVol: 0.1, bassVol: 0.13,
      },
      encounter: {
        // 奇遇：急促上行 悬念感
        melody:  [293,330,349,392,440,523,587,659,587,523,440,392,330,293,261,293],
        harmony: [146,165,175,196,220,261,293,330,293,261,220,196,165,146,130,146],
        bass:    [73, 82, 87, 98,110,130,147,165,147,130,110, 98, 82, 73, 65, 73],
        wave: 'triangle', harmWave: 'sine', tempo: 1200, melVol: 0.3, harmVol: 0.15, bassVol: 0.22,
      },
      crisis: {
        // 危机：不协和音程 压迫急迫
        melody:  [277,311,330,370,392,370,330,311,277,261,233,220,233,261,277,220],
        harmony: [139,155,165,185,196,185,165,155,139,130,117,110,117,130,139,110],
        bass:    [69, 77, 82, 93, 98, 93, 82, 77, 69, 65, 58, 55, 58, 65, 69, 55],
        wave: 'sawtooth', harmWave: 'triangle', tempo: 1000, melVol: 0.18, harmVol: 0.1, bassVol: 0.26,
      },
      penalty: {
        // 惩罚危机：极度不协和 低频压迫
        melody:  [220,233,247,277,311,349,311,277,247,233,220,196,185,196,220,185],
        harmony: [110,117,124,139,155,175,155,139,124,117,110, 98, 93, 98,110, 93],
        bass:    [55, 58, 62, 69, 77, 87, 77, 69, 62, 58, 55, 49, 46, 49, 55, 46],
        wave: 'sawtooth', harmWave: 'sawtooth', tempo: 850, melVol: 0.12, harmVol: 0.08, bassVol: 0.3,
      },
      chaos: {
        // 混沌之渊：三时代调式交汇 空灵深邃
        melody:  [261,330,392,523,440,349,293,261,330,440,523,659,587,523,440,392],
        harmony: [130,165,196,261,220,175,146,130,165,220,261,330,293,261,220,196],
        bass:    [65, 82, 98,130,110, 87, 73, 65, 82,110,130,165,147,130,110, 98],
        wave: 'sine', harmWave: 'triangle', tempo: 2200, melVol: 0.24, harmVol: 0.13, bassVol: 0.16,
      },
      // V14.6: 结局BGM — 凯旋上行和弦 D大调
      ending: {
        melody:  [587,659,784,880,1047,784,880,1047,1175,1047,880,784,659,587,523,587],
        harmony: [293,330,392,440,523,392,440,523,587,523,440,392,330,293,261,293],
        bass:    [146,165,196,220,261,196,220,261,293,261,220,196,165,146,130,146],
        wave: 'sine', harmWave: 'triangle', tempo: 3200, melVol: 0.25, harmVol: 0.12, bassVol: 0.15,
      },
      // V14.6: 序章BGM — 低沉引子 悬念感
      prelude: {
        melody:  [220,261,293,261,220,196,220,261,293,330,293,261,220,247,261,220],
        harmony: [110,130,146,130,110, 98,110,130,146,165,146,130,110,124,130,110],
        bass:    [55, 65, 73, 65, 55, 49, 55, 65, 73, 82, 73, 65, 55, 62, 65, 55],
        wave: 'triangle', harmWave: 'sine', tempo: 2800, melVol: 0.18, harmVol: 0.1, bassVol: 0.14,
      },
    };
    const cfg = configs[style] || configs.whitehouse;
    const len = cfg.melody.length;

    const step = () => {
      if (!this.bgmRunning || !this.enabled) return;
      const i = this._bgmStep % len;
      const now = this.ctx.currentTime;

      // 主旋律
      this._bgmOsc(cfg.melody[i], cfg.wave, cfg.melVol, cfg.tempo / 1000);
      // 和声（低八度）
      this._bgmOsc(cfg.harmony[i], cfg.harmWave, cfg.harmVol, cfg.tempo / 1000);
      // 低音
      this._bgmOsc(cfg.bass[i], 'sine', cfg.bassVol, cfg.tempo / 1000 + 0.5);

      this._bgmStep++;
      this._bgmTimer = setTimeout(step, cfg.tempo);
    };
    step();
  }

  _bgmOsc(freq, type, vol, dur) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g);
    g.connect(this.bgmGain);
    // 同时送一点到混响
    g.connect(this.reverbGain);
    o.start(now);
    o.stop(now + dur + 0.1);
  }

  stopBGM() {
    this.bgmRunning = false;
    clearTimeout(this._bgmTimer);
  }

  // --- V10: Landing 页氛围音效 ---
  playLandingHover(scenario) {
    if (!this.enabled || !this.ctx) return;
    if (scenario === 'whitehouse') {
      this._tone(110, 0.4, 'triangle', this.sfxGain, 0.12);
      setTimeout(() => this._tone(130, 0.3, 'triangle', this.sfxGain, 0.08), 100);
      setTimeout(() => this._tone(165, 0.5, 'sine', this.sfxGain, 0.06), 200);
    } else if (scenario === 'ming') {
      this._tone(392, 0.5, 'sine', this.sfxGain, 0.1);
      setTimeout(() => this._tone(440, 0.4, 'sine', this.sfxGain, 0.07), 150);
      setTimeout(() => this._tone(523, 0.6, 'sine', this.sfxGain, 0.05), 300);
    } else if (scenario === 'ai') {
      this._tone(880, 0.15, 'sine', this.sfxGain, 0.08);
      setTimeout(() => this._tone(1047, 0.1, 'sine', this.sfxGain, 0.06), 80);
      setTimeout(() => this._tone(1319, 0.2, 'sine', this.sfxGain, 0.04), 160);
    } else if (scenario === 'africa') {
      this._tone(220, 0.5, 'triangle', this.sfxGain, 0.1);
      setTimeout(() => this._tone(330, 0.4, 'triangle', this.sfxGain, 0.07), 120);
      setTimeout(() => this._tone(440, 0.6, 'sine', this.sfxGain, 0.06), 280);
    } else if (scenario === 'cyber') {
      this._tone(280, 0.2, 'sawtooth', this.sfxGain, 0.1);
      setTimeout(() => this._tone(370, 0.15, 'square', this.sfxGain, 0.06), 80);
      setTimeout(() => this._tone(440, 0.3, 'sawtooth', this.sfxGain, 0.05), 200);
    } else if (scenario === 'korea') {
      this._tone(349, 0.4, 'sine', this.sfxGain, 0.08);
      setTimeout(() => this._tone(392, 0.45, 'sine', this.sfxGain, 0.06), 150);
      setTimeout(() => this._tone(440, 0.5, 'sine', this.sfxGain, 0.04), 300);
    } else if (scenario === 'chaos') {
      this._tone(261, 0.3, 'sine', this.sfxGain, 0.1);
      setTimeout(() => this._tone(330, 0.25, 'sine', this.sfxGain, 0.07), 100);
      setTimeout(() => this._tone(392, 0.2, 'triangle', this.sfxGain, 0.05), 180);
      setTimeout(() => this._tone(523, 0.5, 'sine', this.sfxGain, 0.04), 280);
    }
  }

  playLandingAmbient() {
    if (!this.enabled || !this.ctx) return;
    // 一个低沉的持续音，营造氛围
    const freqs = [55, 82, 110];
    freqs.forEach((f, i) => {
      setTimeout(() => {
        this._tone(f, 2.0, 'sine', this.sfxGain, 0.04);
      }, i * 400);
    });
  }

  // --- 底层方法 ---
  _tone(freq, dur, type, dest, vol) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(vol || 0.15, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g);
    g.connect(dest || this.sfxGain);
    o.start(now);
    o.stop(now + dur + 0.01);
  }

  _delay(freq, dur, vol) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(vol || 0.03, now + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g);
    g.connect(this.reverbGain);
    o.start(now);
    o.stop(now + dur + 0.01);
  }

  _noise(dur, vol) {
    const bufSize = this.ctx.sampleRate * dur;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 2000;
    g.gain.setValueAtTime(vol || 0.05, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.sfxGain);
    src.start();
  }
}

// 全局音频引擎实例
const audioEngine = new AudioEngine();

// 兼容旧接口
function toggleAudio() { audioEngine.toggle(); }
function playClick() { audioEngine.play('click'); }
function playDebt() { audioEngine.play('debt'); }
function playEnding() { audioEngine.play('ending'); }
function playScroll() { audioEngine.play('scroll'); }
function playChannelLost() { audioEngine.play('channelLost'); }
function startBGM(style) { audioEngine.startBGM(style); }
function stopBGM() { audioEngine.stopBGM(); }

// --- 游戏状态 ---
// V14.6: channelEventCount 限制每局最多触发2次渠道事件
let state = { scenario: null, currentScene: 0, debts: [], channels: 5, choices: [], history: [], usedEvents: [], channelEventCount: 0, fragments: 0, fragmentsSeen: [] };
let unlockedEndings = JSON.parse(localStorage.getItem('unlockedEndings') || '{}');

// --- 屏幕切换 ---
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'game-screen') {
    const bar = document.getElementById('channelsBar');
    bar.classList.add('visible');
    clearTimeout(channelBarTimer);
    channelBarTimer = setTimeout(() => { bar.classList.remove('visible'); }, 2000);
  } else {
    document.getElementById('channelsBar').classList.remove('visible');
  }
  // V14.3: 图鉴按钮仅首页和结算页可见
  const footer = document.querySelector('.landing-footer');
  if (footer) {
    if (id === 'landing') { initLanding(); }
    if (id === 'landing' || id === 'ending-screen') {
      footer.style.display = '';
      footer.style.visibility = 'visible';
      footer.style.pointerEvents = 'auto';
    } else {
      footer.style.display = 'none';
      footer.style.visibility = 'hidden';
      footer.style.pointerEvents = 'none';
    }
  }
}

// --- 转场 ---
function transition(callback) {
  const overlay = document.getElementById('transitionOverlay');
  // V20 R9: 注入水墨晕染层(仅一次)
  if (!overlay.querySelector('.ink-bloom')) {
    overlay.innerHTML = '<div class="ink-bloom"></div><div class="ink-bloom b2"></div><div class="ink-bloom b3"></div>';
  }
  overlay.style.pointerEvents = 'all';
  overlay.classList.remove('fading');
  // 强制重排以确保动画从头播放
  void overlay.offsetHeight;
  overlay.classList.add('active');
  // V20 R10: 水墨晕染转场音效,与ink-bloom动画同步
  if (typeof audioEngine !== 'undefined') audioEngine.play('ink_bloom');
  setTimeout(() => {
    window.scrollTo(0, 0);
    callback();
    setTimeout(() => {
      overlay.classList.remove('active');
      overlay.classList.add('fading');
      setTimeout(() => {
        overlay.classList.remove('fading');
        overlay.style.pointerEvents = 'none';
      }, 470);
    }, 90);
  }, 620);
}

// --- 涟漪效果 ---
function createRipple(e, el) {
  const ripple = document.createElement('span');
  ripple.className = 'ripple-effect';
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  el.appendChild(ripple);
  setTimeout(() => ripple.remove(), 800);
}

// --- 屏幕震击 ---
function screenShake(intensity) {
  const container = document.getElementById('sceneContainer');
  if (!container) return;
  const cls = intensity === 'heavy' ? 'shake-heavy' : intensity === 'light' ? 'shake-light' : 'shake-medium';
  container.classList.add(cls);
  setTimeout(() => container.classList.remove(cls), 600);
}

// --- V12: 粒子爆发（增强版） ---
function particleBurst(x, y, color, count) {
  count = count || 20;
  for (let i = 0; i < count; i++) {
    const p = new Particle();
    p.x = x; p.y = y;
    const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
    const speed = 2 + Math.random() * 4;
    p.speedX = Math.cos(angle) * speed;
    p.speedY = Math.sin(angle) * speed - 1.5;
    p.size = Math.random() * 4 + 1.5;
    p.life = 80 + Math.random() * 60;
    p.maxLife = p.life;
    p.opacity = 0.9;
    if (color) p.color = color;
    particles.push(p);
  }
  // 第二波：更小更密集的粒子
  for (let i = 0; i < count / 2; i++) {
    const p = new Particle();
    p.x = x + (Math.random() - 0.5) * 20;
    p.y = y + (Math.random() - 0.5) * 20;
    p.speedX = (Math.random() - 0.5) * 2;
    p.speedY = -Math.random() * 3 - 1;
    p.size = Math.random() * 2 + 0.5;
    p.life = 40 + Math.random() * 30;
    p.maxLife = p.life;
    p.opacity = 0.6;
    if (color) p.color = color;
    particles.push(p);
  }
  setTimeout(() => { if (particles.length > 300) particles = particles.slice(-150); }, 4000);
}

// --- 全屏闪光 ---
function flashScreen(color, duration) {
  const flash = document.createElement('div');
  flash.className = 'screen-flash';
  flash.style.background = color || 'rgba(201,169,110,0.15)';
  document.body.appendChild(flash);
  requestAnimationFrame(() => flash.classList.add('active'));
  setTimeout(() => { flash.classList.remove('active'); setTimeout(() => flash.remove(), 500); }, duration || 300);
}

// --- 打字机 ---
function typewriter(el, text, callback) {
  let i = 0;
  const cursor = document.createElement('span');
  cursor.className = 'typewriter-cursor';
  el.textContent = '';
  el.appendChild(cursor);
  function type() {
    if (i < text.length) {
      if (text[i] === '\n') {
        el.insertBefore(document.createElement('br'), cursor);
      } else {
        el.insertBefore(document.createTextNode(text[i]), cursor);
      }
      i++;
      const ch = text[i - 1];
      const speed = ch === '。' ? 120 : ch === '，' ? 80 : ch === '\n' ? 200 : 25 + Math.random() * 20;
      setTimeout(type, speed);
    } else {
      setTimeout(() => { cursor.remove(); if (callback) callback(); }, 500);
    }
  }
  type();
}

// --- 结果闪字 ---
function showResultFlash(text) {
  let flash = document.getElementById('resultFlash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'resultFlash';
    flash.className = 'result-flash';
    document.body.appendChild(flash);
  }
  flash.textContent = text;
  flash.style.opacity = '1';
  flash.style.transform = 'translate(-50%, -50%) scale(1)';
  setTimeout(() => {
    flash.style.opacity = '0';
    flash.style.transform = 'translate(-50%, -50%) scale(0.95)';
  }, 2500);
}

// --- 债务面板 ---
function toggleDebtPanel() {
  const panel = document.getElementById('debtPanel');
  const toggle = document.getElementById('debtToggle');
  panel.classList.toggle('collapsed');
  toggle.classList.toggle('collapsed');
}
function addDebt(phrase, category, sceneIndex) {
  const entry = { text: phrase, category, sceneIndex };
  state.debts.push(entry);
  // V14.7: 逐条追加，CSS new-entry 动画驱动，避免全量重绘生硬推进
  const scroll = document.getElementById('debtScroll');
  const mobile = document.getElementById('mobileDebtScroll');
  const el = document.createElement('div');
  el.className = `debt-item ${category} new-entry`;
  el.textContent = phrase;
  scroll.appendChild(el);
  if (mobile) {
    const mel = document.createElement('div');
    mel.className = `debt-item ${category} new-entry`;
    mel.textContent = phrase;
    mobile.appendChild(mel);
  }
  document.getElementById('debtCount').textContent = `共 ${state.debts.length} 笔 · ${currentDebtTitle()}`;
  // 自动滚动到底部展示新条目
  requestAnimationFrame(() => {
    const panel = document.getElementById('debtPanel');
    if (panel) panel.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' });
    if (mobile) mobile.scrollTo({ top: mobile.scrollHeight, behavior: 'smooth' });
  });
  playDebt();
}
// V20 R10: 当前章节债名(含保护)
function currentDebtTitle() {
  try { return getDebtTitleByScenario(state.scenario, state.currentScene, scenarios[state.scenario].scenes.length); }
  catch(e) { return '人情债'; }
}
function renderDebtScroll() {
  // V14.7: 仅用于初始渲染（游戏开始时清空），逐条追加以保留入场动画
  const scroll = document.getElementById('debtScroll');
  const mobile = document.getElementById('mobileDebtScroll');
  const count = document.getElementById('debtCount');
  const html = state.debts.map((d, i) =>
    `<div class="debt-item ${d.category}" style="animation-delay:${i * 0.08}s">${d.text}</div>`
  ).join('');
  scroll.innerHTML = html;
  if (mobile) mobile.innerHTML = html;
  count.textContent = `共 ${state.debts.length} 笔 · ${currentDebtTitle()}`;
}

// --- 消息渠道 ---
function renderChannels() {
  const dots = document.getElementById('channelDots');
  const status = document.getElementById('channelStatus');
  dots.innerHTML = Array.from({ length: 5 }, (_, i) =>
    `<div class="ch-dot ${i >= state.channels ? 'lost' : ''}"></div>`
  ).join('');
  const msgs = ['彻底失聪', '几近聋哑', '孤陋寡闻', '耳目渐少', '消息尚可', '内线畅通'];
  status.textContent = msgs[Math.min(state.channels, 5)];
}
function loseChannel(reason) {
  if (state.channels <= 0) return;
  state.channels--;
  state.channelLossCount = (state.channelLossCount || 0) + 1;
  renderChannels();
  playChannelLost();
  showResultFlash('消息渠道 -1');
  // V14.5: 渠道惩罚2次触发极端事件
  if (state.channelLossCount >= 2 && !state._pendingExtreme && !state.extremeChannelTriggered) {
    state._pendingExtreme = getChannelExtremeEvent(state.scenario);
    state.extremeChannelTriggered = true;
  }
}

// --- 确认退出 ---
function confirmExit() {
  if (confirm('确定要返回首页吗？当前进度不会保存。')) {
    showScreen('landing');
    document.getElementById('vignette').classList.remove('active');
    document.getElementById('scanline').classList.remove('active');
    stopBGM();
    // V18 Round 2: 隐藏命运河流
    if (typeof fateRiver !== 'undefined' && fateRiver) fateRiver.hide();
  }
}

// --- 墨水飞溅（大明专用） ---
function inkSplash() {
  const splash = document.createElement('div');
  splash.className = 'ink-splash';
  splash.style.left = '50%'; splash.style.top = '50%';
  document.body.appendChild(splash);
  audioEngine.play('ink');
  setTimeout(() => splash.remove(), 2000);
}

// --- 键盘快捷键 ---
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const gs = document.getElementById('game-screen');
    if (gs.classList.contains('active')) confirmExit();
  }
});

// --- V10: Landing 页交互音效 ---
document.addEventListener('DOMContentLoaded', () => {
  // V12.1: 检查AI道路是否已解锁
  if (localStorage.getItem('aiUnlocked')) {
    const aiCard = document.getElementById('aiCard');
    if (aiCard) aiCard.style.display = '';
  }

  const cards = document.querySelectorAll('.choice-card[data-scenario]');
  cards.forEach(card => {
    const scenario = card.dataset.scenario;
    card.addEventListener('mouseenter', () => {
      audioEngine.playLandingHover(scenario);
    });
    card.addEventListener('click', () => {
      audioEngine.enable();
      audioEngine.play('chapter');
    });
  });

  // V13: 随机副标题 — 9本书严格引用，5秒轮播 + 淡入淡出 + 严格不相邻同源
  const subtitles = [
    { text: '人最大的敌人是自己，天地不限人，人自限于天地', source: '阎真《沧浪之水》' },
    { text: '原则千万条，利害关系第一条', source: '阎真《沧浪之水》' },
    { text: '一个人吧，只要他不把自尊看得那么重，放得下脸来，机会还是很多的', source: '阎真《沧浪之水》' },
    { text: '世人都有一些生活原则，可又都刻意地不按原则行事', source: '阎真《沧浪之水》' },
    { text: '什么事都是人在做，规则只能限定那些没有办法的人', source: '阎真《沧浪之水》' },
    { text: '从土里长出过光荣的历史，自然也会受到土的束缚', source: '费孝通《乡土中国》' },
    { text: '礼是社会公认合式的行为规范', source: '费孝通《乡土中国》' },
    { text: '在差序格局中，社会关系是逐渐从一个一个人推出去的', source: '费孝通《乡土中国》' },
    { text: '各人自扫门前雪，莫管他人瓦上霜', source: '费孝通《乡土中国》' },
    { text: '中国传统社会里一个人为了自己可以牺牲家，为了家可以牺牲党', source: '费孝通《乡土中国》' },
    { text: '中国的政府事务，不仅在于怎么做，还在于谁来做', source: '兰小欢《置身事内》' },
    { text: '成功的政策背后是成功的协商和妥协', source: '兰小欢《置身事内》' },
    { text: '现实世界没有黑白分明的界限，只有复杂的权衡与取舍', source: '兰小欢《置身事内》' },
    { text: '了解政府认为自己在做什么，是理解政府行为的起点', source: '兰小欢《置身事内》' },
    { text: '制度设计的关键在于激励机制', source: '兰小欢《置身事内》' },
    { text: '做官要三思：思危、思退、思变', source: '刘和平《大明王朝1566》' },
    { text: '任何人答应你的事都不算数，只有你自己能做主的事才算数', source: '刘和平《大明王朝1566》' },
    { text: '这个世上，真靠得住的就两种人：一种是笨人，一种是直人', source: '刘和平《大明王朝1566》' },
    { text: '圣人的书是用来读的，用来办事百无一用', source: '刘和平《大明王朝1566》' },
    { text: '喜怒哀乐之未发，谓之中；发而皆中节，谓之和', source: '子思《中庸》' },
    { text: '君子之中庸也，君子而时中', source: '子思《中庸》' },
    { text: '道也者，不可须臾离也；可离，非道也', source: '子思《中庸》' },
    { text: '博学之，审问之，慎思之，明辨之，笃行之', source: '子思《中庸》' },
    { text: '极高明而道中庸', source: '子思《中庸》' },
    { text: '一个大帝国的覆亡，往往不是由于外力的打击，而是由于内部的腐烂', source: '黄仁宇《万历十五年》' },
    { text: '当一个人口众多的国家，各人行动全凭儒家简单粗浅而又无法固定的原则所限制，而法律又缺乏创造性，则其社会发展的程度，必然受到限制', source: '黄仁宇《万历十五年》' },
    { text: '道德绝不是万能的，它不能代替技术，更不能代替法律', source: '黄仁宇《万历十五年》' },
    { text: '以道德代替法治，是中国两千年来一切问题的症结', source: '黄仁宇《万历十五年》' },
    { text: '君子和而不同，小人同而不和', source: '孔子《论语》' },
    { text: '己所不欲，勿施于人', source: '孔子《论语》' },
    { text: '知之为知之，不知为不知，是知也', source: '孔子《论语》' },
    { text: '不在其位，不谋其政', source: '孔子《论语》' },
    { text: '过犹不及', source: '孔子《论语》' },
    { text: '事在四方，要在中央', source: '韩非《韩非子》' },
    { text: '不期修古，不法常可，论世之事，因为之备', source: '韩非《韩非子》' },
    { text: '以肉去蚁，蚁愈多；以鱼驱蝇，蝇愈至', source: '韩非《韩非子》' },
    { text: '被人畏惧比受人爱戴更安全', source: '马基雅维利《君主论》' },
    { text: '目的总是证明手段是正确的', source: '马基雅维利《君主论》' },
    { text: '命运是我们行动的半个主宰，但她留下其余一半归我们自己支配', source: '马基雅维利《君主论》' },
    { text: '在白宫，信息就是权力，而控制信息的人才是真正的决策者', source: '《白宫幕僚》' },
    { text: '总统的每一个决定都是政治，但不是每个政治决定都是正确的', source: '《白宫幕僚》' },
    { text: '真正危险的不是敌人，而是你以为是朋友的那些人', source: '《白宫幕僚》' },
    { text: '一个人吧，只要他不把自尊看得那么重，放得下脸来，机会还是很多的', source: '阎真《沧浪之水》' },
    { text: '在差序格局中，社会关系是逐渐从一个一个人推出去的', source: '费孝通《乡土中国》' },
    { text: '权力不是手段，权力本身就是目的', source: '乔治·奥威尔《1984》' },
    { text: '人们总是服从权力，但不是因为害怕，而是因为相信', source: '马克斯·韦伯《经济与社会》' },
    { text: '夫以铜为镜，可以正衣冠；以古为镜，可以知兴替', source: '李世民《旧唐书·魏徵传》' },
    { text: '最危险的权力不是暴政，而是让人忘记自由曾存在过', source: '汉娜·阿伦特《极权主义的起源》' },
    { text: '在下城区，谢谢是最值钱的货币', source: '《3077生存指南》' },
    { text: '选择比命运更重——因为命运是别人给的，选择是自己的', source: '《权力的游戏 v14》' },
  ];
  // V13: 生成队列 — 洗牌后修复相邻同源，保证无相邻重复
  let lastQueueLastSource = '';
  function buildSubtitleQueue() {
    const n = subtitles.length;
    const indices = Array.from({length: n}, (_, i) => i);
    // Fisher-Yates 洗牌
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    // 确保首项不与上一轮末项同源
    if (lastQueueLastSource && subtitles[indices[0]].source === lastQueueLastSource) {
      // 找一个不同源的交换到首位
      for (let k = 1; k < n; k++) {
        if (subtitles[indices[k]].source !== lastQueueLastSource) {
          [indices[0], indices[k]] = [indices[k], indices[0]];
          break;
        }
      }
    }
    // 修复相邻同源：向后扫描，发现相邻同源就与下一个不同源的交换
    for (let i = 0; i < n - 1; i++) {
      if (subtitles[indices[i]].source === subtitles[indices[i+1]].source) {
        for (let k = i + 2; k < n; k++) {
          if (subtitles[indices[k]].source !== subtitles[indices[i]].source) {
            // 确保交换后 indices[k] 也不会和 indices[i+2] 冲突
            if (k === n - 1 || subtitles[indices[k]].source !== subtitles[indices[i+2]].source || i + 2 >= n) {
              [indices[i+1], indices[k]] = [indices[k], indices[i+1]];
              break;
            }
            // 即使可能冲突，也先交换，后续循环会继续修复
            [indices[i+1], indices[k]] = [indices[k], indices[i+1]];
            break;
          }
        }
      }
    }
    // 记录本轮末项来源，用于下轮首项去重
    lastQueueLastSource = subtitles[indices[indices.length - 1]].source;
    return indices;
  }
  let subtitleQueue = buildSubtitleQueue();
  let subtitleQueuePos = 0;
  const subtitleEl = document.getElementById('landingSubtitle');
  const subtitleSourceEl = subtitleEl ? subtitleEl.querySelector('.subtitle-source') : null;
  function showNextSubtitle() {
    if (!subtitleEl) return;
    const idx = subtitleQueue[subtitleQueuePos % subtitleQueue.length];
    const item = subtitles[idx];
    subtitleEl.innerHTML = `<span class="subtitle-text">"${item.text}"</span><span class="subtitle-source">—— ${item.source}</span>`;
    subtitleQueuePos++;
    if (subtitleQueuePos >= subtitleQueue.length) {
      subtitleQueue = buildSubtitleQueue();
      subtitleQueuePos = 0;
    }
  }
  showNextSubtitle();
  setInterval(() => {
    if (subtitleEl) {
      const h = subtitleEl.offsetHeight;
      subtitleEl.style.height = h + 'px';
      subtitleEl.classList.add('subtitle-fade-out');
      setTimeout(() => {
        showNextSubtitle();
        subtitleEl.classList.remove('subtitle-fade-out');
        subtitleEl.classList.add('subtitle-fade-in');
        subtitleEl.style.height = '';
        setTimeout(() => subtitleEl.classList.remove('subtitle-fade-in'), 600);
      }, 400);
    }
  }, 5000);
});
