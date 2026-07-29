/**
 * evo-lite.js — evo-engine 精华蒸馏版 v1.0
 * 零依赖轻量演化引擎，用于 powergame 事件生成
 *
 * 蒸馏自 evo-engine (github.com/if3077-beep/evo-engine) 的四个核心模式:
 *   1. SeededRNG   — 种子化伪随机 (mulberry32)
 *   2. Genome       — 事件基因 + similarity 多样性度量
 *   3. Mutator      — 事件文案突变 (词替换/语气切换/选项微调)
 *   4. Selector     — 偏好画像 + fitness 选择 (根据玩家历史债务分布)
 *
 * 用法:
 *   const evo = new EvoLite({ seed: 42, lexicon: {...} });
 *   const event = evo.pickEvent(randomEvents.whitehouse, state);
 *   const variant = evo.mutate(event);
 *
 * 设计原则:
 *   - 零依赖: 纯 JS, 可直接 inline 进 standalone HTML
 *   - 可选接入: 不破坏现有 Math.random 路径, 作为增强层
 *   - 可复现: 同 seed + 同历史 → 同结果
 *   - 渐进增强: 偏好画像为空时退化为随机选择
 */
(function (global) {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // [1] SeededRNG — 种子化伪随机 (蒸馏自 evo-engine/src/utils/rng.ts)
  // ═══════════════════════════════════════════════════════════
  // mulberry32 算法: 同 seed 产生同序列, 32-bit 状态, ~5ns/next
  class SeededRNG {
    constructor(seed) {
      this.state = (seed || Date.now()) >>> 0;
      if (this.state === 0) this.state = 1;
    }

    /** 返回 [0, 1) 浮点数 */
    next() {
      this.state = (this.state + 0x6d2b79f5) >>> 0;
      let t = this.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** 返回 [min, max] 整数 (闭区间) */
    nextInt(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    }

    /** 随机选一个元素 */
    pick(arr) {
      if (arr.length === 0) return undefined;
      return arr[this.nextInt(0, arr.length - 1)];
    }

    /** 按 probability 概率返回 true */
    chance(p) {
      return this.next() < p;
    }

    /** Fisher-Yates 洗牌, 返回新数组 */
    shuffle(arr) {
      const r = arr.slice();
      for (let i = r.length - 1; i > 0; i--) {
        const j = this.nextInt(0, i);
        const t = r[i]; r[i] = r[j]; r[j] = t;
      }
      return r;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // [2] Genome — 事件基因 + similarity (蒸馏自 Genome.ts + Generation.ts)
  // ═══════════════════════════════════════════════════════════
  // 把一个事件对象包装成 Genome, 提供相似度计算用于多样性控制
  // similarity 基于标签集合的 Jaccard 系数 (无需 embedding, 零依赖)
  class EventGenome {
    constructor(event) {
      this.data = event;
      this.id = event.title || String(Math.random());
      // 提取特征标签: debtCategory 分布 + 标题关键词
      this._tags = extractTags(event);
    }

    /** 与另一个 Genome 的相似度 [0,1], 1 = 完全相同 */
    similarity(other) {
      if (!(other instanceof EventGenome)) return 0;
      return jaccard(this._tags, other._tags);
    }

    serialize() {
      return { id: this.id, data: this.data };
    }
  }

  /** 从事件对象提取特征标签 (用于相似度计算) */
  function extractTags(event) {
    const tags = new Set();
    // 标题分词
    if (event.title) {
      event.title.split(/[\s·，。！？、]+/).forEach(w => {
        if (w.length >= 2) tags.add('t:' + w);
      });
    }
    // 选择的债务类别
    if (Array.isArray(event.choices)) {
      event.choices.forEach(c => {
        if (c.debtCategory) tags.add('c:' + c.debtCategory);
        if (c.historyFlag) tags.add('f:' + c.historyFlag);
      });
    }
    // 高强度标记
    if (event.isHighIntensity) tags.add('meta:highIntensity');
    return tags;
  }

  /** Jaccard 相似系数: |A∩B| / |A∪B| */
  function jaccard(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    let inter = 0;
    setA.forEach(v => { if (setB.has(v)) inter++; });
    const union = setA.size + setB.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  /** 计算种群多样性 [0,1]: 1 = 完全不同, 0 = 完全相同 */
  function computeDiversity(genomes) {
    if (genomes.length < 2) return 0;
    let totalSim = 0, pairs = 0;
    for (let i = 0; i < genomes.length; i++) {
      for (let j = i + 1; j < genomes.length; j++) {
        totalSim += genomes[i].similarity(genomes[j]);
        pairs++;
      }
    }
    return pairs > 0 ? 1 - totalSim / pairs : 0;
  }

  // ═══════════════════════════════════════════════════════════
  // [3] Mutator — 事件文案突变 (蒸馏自 Mutator.ts)
  // ═══════════════════════════════════════════════════════════
  // 轻量突变: 从词库替换关键词, 生成文案变体
  // 不改变事件逻辑, 只改变表述方式 → 增加重玩新鲜感
  const DEFAULT_LEXICON = {
    // 时间词替换
    '凌晨': ['深夜', '夜半', '子夜'],
    '清晨': ['破晓', '黎明', '天将亮'],
    '深夜': ['夜深', '更漏', '夜半'],
    // 动作词替换
    '走进': ['踱进', '踏入', '步入'],
    '看着': ['望着', '凝视', '端详'],
    '说道': ['开口', '言道', '道'],
    // 情绪词替换
    '沉默': ['无言', '默然', '一语不发'],
    '微笑': ['浅笑', '莞尔', '嘴角微扬'],
  };

  class EventMutator {
    constructor(lexicon) {
      this.lexicon = lexicon || DEFAULT_LEXICON;
    }

    canApply(genome) {
      return genome instanceof EventGenome && !!genome.data.text;
    }

    /** 对事件文案做轻量突变, 返回新事件对象 (不修改原事件) */
    apply(genome, rng) {
      const r = rng || new SeededRNG();
      const event = genome.data;
      const mutated = JSON.parse(JSON.stringify(event));

      // 突变标题: 30% 概率
      if (mutated.title && r.chance(0.3)) {
        mutated._mutatedTitle = true;
      }

      // 突变正文: 词替换
      if (mutated.text) {
        mutated.text = this._replaceWords(mutated.text, r);
      }

      // 突变后果文案: 20% 概率词替换
      if (Array.isArray(mutated.choices)) {
        mutated.choices = mutated.choices.map(c => {
          const nc = Object.assign({}, c);
          if (nc.consequence && r.chance(0.2)) {
            nc.consequence = this._replaceWords(nc.consequence, r);
          }
          return nc;
        });
      }

      mutated._mutated = true;
      return new EventGenome(mutated);
    }

    _replaceWords(text, rng) {
      let result = text;
      for (const [src, targets] of Object.entries(this.lexicon)) {
        if (result.includes(src) && rng.chance(0.4)) {
          const target = rng.pick(targets);
          result = result.replace(src, target);
        }
      }
      return result;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // [4] Selector — 偏好画像 + fitness 选择 (蒸馏自 Selector.ts)
  // ═══════════════════════════════════════════════════════════
  // 根据玩家历史债务分布计算事件 fitness:
  //   - 玩家常选 moral → moral 类事件 fitness 更高
  //   - 玩家常选 compromise → compromise 类事件 fitness 更高
  //   - 加 diversity 惩罚: 避免连续触发相似事件
  class PreferenceSelector {
    constructor() {
      this.profile = { categoryFreq: {}, totalCount: 0 };
    }

    /** 从游戏 state 提取偏好画像 */
    buildProfile(state) {
      const freq = {};
      let total = 0;
      if (state && Array.isArray(state.debts)) {
        state.debts.forEach(d => {
          const cat = d.category || 'unknown';
          freq[cat] = (freq[cat] || 0) + 1;
          total++;
        });
      }
      // 历史 flag 也作为偏好信号
      if (state && state.history) {
        state.history.forEach(h => {
          if (h && h.debtCategory) {
            freq[h.debtCategory] = (freq[h.debtCategory] || 0) + 1;
            total++;
          }
        });
      }
      this.profile = { categoryFreq: freq, totalCount: total };
      return this.profile;
    }

    /** 计算单个事件的 fitness [0,1] */
    calculateFitness(genome, recentGenomes) {
      if (this.profile.totalCount === 0) return 0.5; // 无偏好基线

      const event = genome.data;
      const eventCats = new Set();
      if (Array.isArray(event.choices)) {
        event.choices.forEach(c => {
          if (c.debtCategory) eventCats.add(c.debtCategory);
        });
      }

      // 偏好匹配度: 事件提供的类别中, 玩家偏好的类别占比
      let matchScore = 0;
      eventCats.forEach(cat => {
        const freq = this.profile.categoryFreq[cat] || 0;
        matchScore += freq / this.profile.totalCount;
      });
      matchScore = eventCats.size > 0 ? matchScore / eventCats.size : 0.3;

      // 多样性惩罚: 与最近触发的事件相似度越高, fitness 越低
      let diversityPenalty = 0;
      if (recentGenomes && recentGenomes.length > 0) {
        const recent = recentGenomes.slice(-3); // 只看最近3个
        let avgSim = 0;
        recent.forEach(rg => { avgSim += genome.similarity(rg); });
        avgSim = recent.length > 0 ? avgSim / recent.length : 0;
        diversityPenalty = avgSim * 0.4; // 最多扣 40%
      }

      // 条件事件加分: 有条件且满足的事件更值得触发
      let conditionBonus = 0;
      if (event.condition) {
        try {
          if (event.condition()) conditionBonus = 0.2;
        } catch (e) { /* 条件检查失败, 忽略 */ }
      }

      return Math.max(0, Math.min(1, matchScore - diversityPenalty + conditionBonus));
    }

    /** 从候选中选 top-n (按 fitness 排序) */
    selectTop(genomes, n, recentGenomes) {
      const scored = genomes.map(g => ({
        genome: g,
        score: this.calculateFitness(g, recentGenomes)
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, n).map(s => s.genome);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // [5] EvoLite — 组合引擎 (蒸馏自 EvolutionEngine.ts)
  // ═══════════════════════════════════════════════════════════
  // 组合 RNG + Genome + Mutator + Selector
  // 提供 pickEvent / mutateEvent / getDiversity 三个核心 API
  class EvoLite {
    constructor(options) {
      options = options || {};
      this.rng = new SeededRNG(options.seed);
      this.mutator = new EventMutator(options.lexicon);
      this.selector = new PreferenceSelector();
      this.recentGenomes = []; // 最近触发的事件 (用于多样性控制)
      this.mutationRate = options.mutationRate != null ? options.mutationRate : 0.15;
    }

    /**
     * 从事件池中选择一个事件 (偏好驱动 + 多样性控制)
     * 替代 Math.random() 选择逻辑
     */
    pickEvent(events, state) {
      if (!events || events.length === 0) return null;

      // 构建/更新偏好画像
      this.selector.buildProfile(state);

      // 包装成 Genome
      const genomes = events.map(e => new EventGenome(e));

      // 用 selector 计算 fitness, 选 top-3
      const top = this.selector.selectTop(genomes, Math.min(3, genomes.length), this.recentGenomes);

      // 从 top 中按 fitness 加权随机选 (非确定性, 增加变化)
      // fitness 越高被选中概率越大, 但不是必选
      const weights = top.map(g => {
        const s = this.selector.calculateFitness(g, this.recentGenomes);
        return Math.max(0.1, s); // 最低 0.1 权重, 避免完全排除
      });
      const totalW = weights.reduce((a, b) => a + b, 0);
      let r = this.rng.next() * totalW;
      let picked = top[0];
      for (let i = 0; i < top.length; i++) {
        r -= weights[i];
        if (r <= 0) { picked = top[i]; break; }
      }

      // 记录到 recent (用于后续多样性计算)
      this.recentGenomes.push(picked);
      if (this.recentGenomes.length > 5) this.recentGenomes.shift();

      return picked.data;
    }

    /**
     * 对事件做突变 (生成文案变体)
     * 按 mutationRate 概率触发
     */
    mutateEvent(event) {
      if (this.rng.chance(this.mutationRate)) {
        const genome = new EventGenome(event);
        if (this.mutator.canApply(genome)) {
          return this.mutator.apply(genome, this.rng).data;
        }
      }
      return event;
    }

    /** 计算当前事件池的多样性 [0,1] */
    getDiversity(events) {
      const genomes = events.map(e => new EventGenome(e));
      return computeDiversity(genomes);
    }

    /** 重置引擎状态 (新一局游戏时调用) */
    reset(seed) {
      this.rng = new SeededRNG(seed);
      this.recentGenomes = [];
      this.selector = new PreferenceSelector();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 导出
  // ═══════════════════════════════════════════════════════════
  global.EvoLite = EvoLite;
  global.SeededRNG = SeededRNG;
  global.EventGenome = EventGenome;
  global.EventMutator = EventMutator;
  global.PreferenceSelector = PreferenceSelector;
  global.computeDiversity = computeDiversity;

})(typeof window !== 'undefined' ? window : this);
