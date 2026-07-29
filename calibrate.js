/**
 * calibrate.js — V18 Round 2: 校准面板 + 雷达图 + 命运河流 + 图鉴 grid
 *
 * 功能:
 *   1. CalibratePanel   — 开局校准 (人格预设 + 三轴 slider)
 *   2. RadarChart       — 五维画像雷达图 Canvas (道德/妥协/自私/被动/被动+)
 *   3. FateRiver        — 选择轨迹河流 Canvas (顶部条)
 *   4. GalleryGrid      — 多结局图鉴 grid 重构
 *
 * 依赖: 无 (纯 JS, Canvas 2D)
 */
(function (global) {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // [1] 人格预设 — 6 种, 每种设定三轴默认值
  // 权力欲(power) / 关系重视度(relation) / 渠道敏感度(channel)
  // 范围 1-5, 3 为中性
  // ═══════════════════════════════════════════════════════════
  const PERSONAS = [
    { id:'idealist',   icon:'🌟', name:'理想主义者', desc:'原则高于一切',     power:2, relation:4, channel:3 },
    { id:'pragmatist', icon:'⚖️', name:'实用主义者', desc:'结果导向, 灵活变通', power:4, relation:3, channel:3 },
    { id:'strategist', icon:'♟️', name:'权谋家',     desc:'深谋远虑, 善用资源', power:5, relation:2, channel:4 },
    { id:'loneWolf',   icon:'🐺', name:'孤狼',       desc:'独来独往, 不欠人情', power:3, relation:1, channel:2 },
    { id:'peacemaker', icon:'🕊️', name:'和事佬',     desc:'维系关系, 息事宁人', power:2, relation:5, channel:4 },
    { id:'gambler',    icon:'🎲', name:'赌徒',       desc:'押注高风险选择',    power:4, relation:2, channel:1 },
  ];

  const SLIDER_LABELS = {
    power:   { 1:'淡泊', 2:'低调', 3:'平衡', 4:'进取', 5:'野心' },
    relation:{ 1:'冷漠', 2:'疏离', 3:'平衡', 4:'重视', 5:'深情' },
    channel: { 1:'迟钝', 2:'被动', 3:'平衡', 4:'敏锐', 5:'全知' },
  };

  // ═══════════════════════════════════════════════════════════
  // [2] CalibratePanel — 校准面板控制器
  // ═══════════════════════════════════════════════════════════
  class CalibratePanel {
    constructor() {
      this.selectedPersona = null;
      this.values = { power: 3, relation: 3, channel: 3 };
      this._onComplete = null;
    }

    /** 渲染校准面板到 #calibrate-screen */
    show(scenarioKey, onComplete) {
      this._onComplete = onComplete;
      const screen = document.getElementById('calibrate-screen');
      if (!screen) return;

      screen.innerHTML = `
        <div class="calibrate-container">
          <div>
            <h2 class="cal-title">校准你的命运</h2>
            <p class="cal-sub">在踏入权力之前, 先选择你的处世姿态——它将影响事件如何向你涌来。</p>
          </div>

          <div class="persona-section">
            <div class="persona-section-title">— 选择人格底色 —</div>
            <div class="persona-grid" id="personaGrid">
              ${PERSONAS.map(p => `
                <div class="persona-card" data-persona="${p.id}" onclick="calibratePanel.selectPersona('${p.id}')">
                  <span class="persona-icon">${p.icon}</span>
                  <div class="persona-name">${p.name}</div>
                  <div class="persona-desc">${p.desc}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="slider-section">
            <div class="slider-section-title">— 微调三轴参数 —</div>
            <div class="slider-stack">
              <div class="slider-row">
                <div class="slider-info"><span class="slider-label">权力欲</span><span class="slider-val" id="valPower">平衡</span></div>
                <input type="range" class="range-slider" id="slPower" min="1" max="5" value="3" oninput="calibratePanel.onSlider('power', this.value)">
                <div class="slider-range"><span>淡泊</span><span>野心</span></div>
              </div>
              <div class="slider-row">
                <div class="slider-info"><span class="slider-label">关系重视度</span><span class="slider-val" id="valRelation">平衡</span></div>
                <input type="range" class="range-slider" id="slRelation" min="1" max="5" value="3" oninput="calibratePanel.onSlider('relation', this.value)">
                <div class="slider-range"><span>冷漠</span><span>深情</span></div>
              </div>
              <div class="slider-row">
                <div class="slider-info"><span class="slider-label">渠道敏感度</span><span class="slider-val" id="valChannel">平衡</span></div>
                <input type="range" class="range-slider" id="slChannel" min="1" max="5" value="3" oninput="calibratePanel.onSlider('channel', this.value)">
                <div class="slider-range"><span>迟钝</span><span>全知</span></div>
              </div>
            </div>
          </div>

          <div class="cal-footer">
            <button class="cal-btn" onclick="calibratePanel.skip()">跳过校准</button>
            <button class="cal-btn primary" onclick="calibratePanel.confirm()">踏入命运 →</button>
          </div>
        </div>
      `;

      document.body.className = `theme-${scenarioKey}`;
      showScreen('calibrate-screen');
      audioEngine.play('chapter');
    }

    selectPersona(id) {
      this.selectedPersona = id;
      const p = PERSONAS.find(x => x.id === id);
      if (!p) return;
      // 应用预设值到 slider
      this.values = { power: p.power, relation: p.relation, channel: p.channel };
      document.getElementById('slPower').value = p.power;
      document.getElementById('slRelation').value = p.relation;
      document.getElementById('slChannel').value = p.channel;
      this._updateSliderLabels();
      // 高亮选中卡
      document.querySelectorAll('.persona-card').forEach(c => c.classList.toggle('selected', c.dataset.persona === id));
      audioEngine.play('click');
    }

    onSlider(key, val) {
      this.values[key] = parseInt(val, 10);
      this.selectedPersona = null; // 手动调整后取消预设选中
      document.querySelectorAll('.persona-card').forEach(c => c.classList.remove('selected'));
      this._updateSliderLabels();
    }

    _updateSliderLabels() {
      document.getElementById('valPower').textContent = SLIDER_LABELS.power[this.values.power];
      document.getElementById('valRelation').textContent = SLIDER_LABELS.relation[this.values.relation];
      document.getElementById('valChannel').textContent = SLIDER_LABELS.channel[this.values.channel];
    }

    confirm() {
      audioEngine.play('click');
      const persona = this.selectedPersona ? PERSONAS.find(p => p.id === this.selectedPersona) : null;
      const calibration = {
        persona: persona ? persona.id : 'custom',
        personaName: persona ? persona.name : '自定义',
        values: Object.assign({}, this.values),
      };
      if (typeof this._onComplete === 'function') this._onComplete(calibration);
    }

    skip() {
      audioEngine.play('click');
      if (typeof this._onComplete === 'function') this._onComplete(null);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // [3] RadarChart — 五维画像雷达图
  // 维度: 道德(moral) / 妥协(compromise) / 自私(self-serving) /
  //       被动(passive) / 主动(active=补偿)
  // 数据来源: state.debts 的 category 分布
  // ═══════════════════════════════════════════════════════════
  class RadarChart {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.dpr = window.devicePixelRatio || 1;
      this._setupSize();
      this.labels = ['道德', '妥协', '自私', '被动', '主动'];
      this.maxValue = 5;
    }

    _setupSize() {
      const w = 240, h = 240;
      this.canvas.width = w * this.dpr;
      this.canvas.height = h * this.dpr;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.scale(this.dpr, this.dpr);
      this.w = w; this.h = h;
    }

    /** 从游戏 state 提取五维数据 [0, max] */
    extractData(state) {
      const counts = { moral: 0, compromise: 0, 'self-serving': 0, passive: 0 };
      if (state && Array.isArray(state.debts)) {
        state.debts.forEach(d => {
          if (counts[d.category] !== undefined) counts[d.category]++;
        });
      }
      const max = Math.max(1, ...Object.values(counts));
      // 主动 = 总数 - 被动 (选择越多越主动, 但被动多则主动低)
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const active = Math.max(0, total - counts.passive);
      return [
        this._scale(counts.moral, max),
        this._scale(counts.compromise, max),
        this._scale(counts['self-serving'], max),
        this._scale(counts.passive, max),
        this._scale(active, max),
      ];
    }

    _scale(v, max) { return max === 0 ? 0 : (v / max) * this.maxValue; }

    /** 渲染雷达图 */
    render(data) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const cx = this.w / 2, cy = this.h / 2;
      const radius = Math.min(cx, cy) - 30;
      const n = this.labels.length;

      ctx.clearRect(0, 0, this.w, this.h);

      // 背景网格 (5 层)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let layer = 1; layer <= 5; layer++) {
        const r = (radius / 5) * layer;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // 轴线
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        ctx.stroke();
      }

      // 数据多边形
      if (data && data.length === n) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
          const r = (data[i] / this.maxValue) * radius;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(201,169,110,0.15)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(201,169,110,0.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 顶点
        ctx.fillStyle = 'rgba(201,169,110,1)';
        for (let i = 0; i < n; i++) {
          const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
          const r = (data[i] / this.maxValue) * radius;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 标签
      ctx.fillStyle = 'rgba(232,228,222,0.7)';
      ctx.font = '11px "Noto Serif SC", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
        const labelR = radius + 16;
        const x = cx + Math.cos(angle) * labelR;
        const y = cy + Math.sin(angle) * labelR;
        ctx.fillText(this.labels[i], x, y);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // [4] FateRiver — 命运河流 (顶部 3px 条, 选择轨迹流)
  // 每次选择在河流上留下一道流光, 颜色按 debtCategory 区分
  // ═══════════════════════════════════════════════════════════
  class FateRiver {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.flows = []; // {x, color, alpha, speed}
      this._running = false;
      this._resize();
      window.addEventListener('resize', () => this._resize());
    }

    _resize() {
      this.canvas.width = window.innerWidth;
      this.canvas.height = 3;
      this.w = this.canvas.width;
      this.h = 3;
    }

    /** 添加一道选择流光 */
    addFlow(debtCategory) {
      const colors = {
        moral: '#6b8f71',
        compromise: '#c9a96e',
        'self-serving': '#c45c4a',
        passive: '#6b6560',
      };
      const color = colors[debtCategory] || '#c9a96e';
      this.flows.push({
        x: -20,
        color,
        alpha: 1,
        speed: 0.5 + Math.random() * 0.3,
      });
      if (!this._running) this._start();
    }

    _start() {
      this._running = true;
      const tick = () => {
        if (!this._running) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.w, this.h);

        // 背景渐变
        const grad = ctx.createLinearGradient(0, 0, this.w, 0);
        grad.addColorStop(0, 'rgba(201,169,110,0.02)');
        grad.addColorStop(0.5, 'rgba(201,169,110,0.05)');
        grad.addColorStop(1, 'rgba(201,169,110,0.02)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.w, this.h);

        // 流光
        this.flows = this.flows.filter(f => f.x < this.w + 20 && f.alpha > 0.01);
        this.flows.forEach(f => {
          f.x += f.speed;
          f.alpha *= 0.998;
          // 绘制流光 (带拖尾)
          const tailLen = 60;
          const g = ctx.createLinearGradient(f.x - tailLen, 0, f.x, 0);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(1, f.color);
          ctx.fillStyle = g;
          ctx.globalAlpha = f.alpha;
          ctx.fillRect(f.x - tailLen, 0, tailLen, this.h);
          ctx.globalAlpha = 1;
        });

        if (this.flows.length > 0) {
          requestAnimationFrame(tick);
        } else {
          this._running = false;
        }
      };
      requestAnimationFrame(tick);
    }

    show() {
      const wrap = this.canvas.parentElement;
      if (wrap) wrap.classList.add('visible');
    }

    hide() {
      const wrap = this.canvas.parentElement;
      if (wrap) wrap.classList.remove('visible');
    }

    clear() {
      this.flows = [];
      if (this.ctx) this.ctx.clearRect(0, 0, this.w, this.h);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // [5] GalleryGrid — 多结局图鉴 grid (重构版)
  // 从 localStorage 读取已解锁结局, 渲染响应式 grid
  // ═══════════════════════════════════════════════════════════
  class GalleryGrid {
    constructor(endingsData) {
      this.endingsData = endingsData || {}; // { scenarioKey: [{id, icon, title, desc}, ...] }
    }

    render(container, activeTab) {
      if (!container) return;
      const tabs = Object.keys(this.endingsData);
      activeTab = activeTab || tabs[0] || 'whitehouse';

      const unlocked = this._loadUnlocked();

      let html = `
        <div class="gallery-container">
          <div class="gallery-header">
            <h2 class="gallery-title">结局图鉴</h2>
            <div class="gallery-sub">已解锁 ${unlocked.size} 个结局 · 探索所有可能</div>
          </div>
          <div class="gallery-tabs">
            ${tabs.map(t => `<button class="gallery-tab ${t === activeTab ? 'active' : ''}" onclick="galleryGrid.render(document.querySelector('.gallery-grid-wrap'), '${t}')">${this._tabLabel(t)}</button>`).join('')}
          </div>
          <div class="gallery-grid">
      `;

      const endings = this.endingsData[activeTab] || [];
      endings.forEach(e => {
        const isUnlocked = unlocked.has(e.id);
        html += `
          <div class="ending-card ${isUnlocked ? '' : 'locked'}" ${isUnlocked ? `onclick="alert('${e.title}\\n\\n${e.desc}')"` : ''}>
            ${isUnlocked ? '' : '<span class="ending-card-lock-icon">🔒</span>'}
            <span class="ending-card-icon">${isUnlocked ? e.icon : '❓'}</span>
            <div class="ending-card-scenario">${this._tabLabel(activeTab)}</div>
            <div class="ending-card-title">${isUnlocked ? e.title : '???'}</div>
            <div class="ending-card-desc">${isUnlocked ? e.desc : '尚未解锁这个结局'}</div>
          </div>
        `;
      });

      html += `</div></div>`;
      container.innerHTML = html;
    }

    _tabLabel(key) {
      const labels = {
        whitehouse: '白宫', ming: '大明', ai: '共生',
        africa: '非洲', cyber: '3077', korea: '日常', chaos: '混沌',
      };
      return labels[key] || key;
    }

    _loadUnlocked() {
      // 兼容现有 loadUnlockedEndings 逻辑
      try {
        const saved = localStorage.getItem('unlockedEndings');
        if (saved) {
          const arr = JSON.parse(saved);
          return new Set(Array.isArray(arr) ? arr : []);
        }
      } catch (e) {}
      // 没有记录则返回空集 (全部锁定)
      return new Set();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 导出
  // ═══════════════════════════════════════════════════════════
  global.CalibratePanel = CalibratePanel;
  global.RadarChart = RadarChart;
  global.FateRiver = FateRiver;
  global.GalleryGrid = GalleryGrid;
  global.PERSONAS = PERSONAS;
  global.SLIDER_LABELS = SLIDER_LABELS;

})(typeof window !== 'undefined' ? window : this);
