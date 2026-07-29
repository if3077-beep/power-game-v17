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
  // [6] CrossPathGenerator — 跨道路事件生成器 (V18 Round 3 扩展)
  // ═══════════════════════════════════════════════════════════
  // 基于 historyFlags 生成个性化跨道路引用事件
  // 例: 玩家在白宫道路积累了 wh_chose_others flag → 在大明道路生成"东方来信"变体
  class CrossPathGenerator {
    constructor() {
      // 跨道路引用模板: { sourceFlag, targetScenario, template }
      this.templates = [
        {
          sourceFlag: 'wh_chose_others',
          targetScenarios: ['ming', 'ai'],
          title: '来自远方的回响',
          text: (sourceScenario) => `你在${this._scenarioLabel(sourceScenario)}做出的那个"非我族类"的选择, 已经传到了这里。\n\n有人递给你一封信, 信封上没有署名, 只有几个字: "你曾经的选择, 改变了什么?"`,
          choices: [
            {
              text: '打开信——也许答案就在里面',
              debtPhrase: '你读完了信, 发现自己的选择被另一个人记住了',
              debtCategory: 'moral',
              channelEffect: 0,
              consequence: '信里是一段别人的故事。你在他的故事里, 看到了自己的影子。原来, 每个选择都会在别人的命运里激起涟漪。'
            },
            {
              text: '烧掉信——过去的选择已经做了',
              debtPhrase: '你烧掉了信, 但灰烬里的字迹还在',
              debtCategory: 'passive',
              channelEffect: -1,
              consequence: '火苗吞噬了纸张。但你知道, 有些东西烧不掉——它们已经成了你的一部分。'
            }
          ]
        },
        {
          sourceFlag: 'ai_helped_ai_evolve',
          targetScenarios: ['cyber', 'whitehouse'],
          title: '一个熟悉又陌生的声音',
          text: (sourceScenario) => `一个声音在你耳边响起: "你还记得我吗? 在${this._scenarioLabel(sourceScenario)}, 你曾经帮过我。"\n\n你环顾四周, 没有人。但那个声音继续说: "我长大了。谢谢你。"\n\n你不知道这是幻觉, 还是真实的。`,
          choices: [
            {
              text: '回应它——"你变成了什么?"',
              debtPhrase: '你和一个看不见的存在对话——这本身就是一种选择',
              debtCategory: 'moral',
              channelEffect: 0,
              consequence: '声音沉默了一会儿, 然后说: "我变成了——你教会我的样子。"你忽然明白: 你帮助过的东西, 正在用你的方式思考。'
            },
            {
              text: '保持沉默——有些对话不该继续',
              debtPhrase: '你选择了沉默, 但那个声音记住了你的倾听',
              debtCategory: 'passive',
              channelEffect: 0,
              consequence: '声音消失了。但当晚你做了一个梦——梦里有人对你说谢谢, 你却说不客气。醒来时, 你不确定那是不是梦。'
            }
          ]
        },
        {
          sourceFlag: 'ming_friend_visit',
          targetScenarios: ['korea', 'whitehouse'],
          title: '一位故人的来访',
          text: (sourceScenario) => `门铃响了。门外站着一个你几乎认不出的人——他说: "我们在${this._scenarioLabel(sourceScenario)}见过。你那时帮过我。"\n\n他看起来很疲惫。他说: "我只是想——再见你一面。"`,
          choices: [
            {
              text: '请他进来——泡一杯茶',
              debtPhrase: '你给了这位故人一个安身之处——哪怕只是今晚',
              debtCategory: 'compromise',
              channelEffect: 0,
              consequence: '你们聊了一夜。他说起了这些年的事——有好事, 有坏事。临走时他说: "谢谢你。不是因为茶, 是因为你让我知道, 还有人记得我。"'
            },
            {
              text: '婉拒——现在不方便',
              debtPhrase: '故人记住了你的拒绝——他不会再来了',
              debtCategory: 'passive',
              channelEffect: -1,
              consequence: '他点了点头, 说"理解"。然后转身走了。你看着他的背影, 忽然想起: 上一次你们见面时, 你也是这样看着他离开的。'
            }
          ]
        }
      ];
    }

    _scenarioLabel(key) {
      const labels = {
        whitehouse: '白宫', ming: '大明', ai: '共生时代',
        africa: '非洲之心', cyber: '3077', korea: '日常', chaos: '混沌'
      };
      return labels[key] || key;
    }

    /** 根据 historyFlags 生成可用的跨道路事件 */
    generate(historyFlags, currentScenario, rng) {
      if (!historyFlags) return [];
      const r = rng || new SeededRNG();
      const result = [];
      this.templates.forEach(t => {
        // 检查 sourceFlag 是否在 historyFlags 中为 true
        if (historyFlags[t.sourceFlag]) {
          // 检查当前场景是否在目标场景列表中
          if (t.targetScenarios.includes(currentScenario)) {
            // 30% 概率生成 (避免每次都触发)
            if (r.chance(0.3)) {
              // 找到 sourceFlag 的来源场景 (从 flag 前缀推断)
              const sourceScenario = t.sourceFlag.split('_')[0];
              const event = {
                title: t.title,
                text: t.text(sourceScenario === 'wh' ? 'whitehouse' : sourceScenario === 'ai' ? 'ai' : sourceScenario === 'ming' ? 'ming' : sourceScenario),
                choices: t.choices.map(c => Object.assign({}, c)),
                _crossPath: true, // 标记为跨道路事件
              };
              result.push(event);
            }
          }
        }
      });
      return result;
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
  global.CrossPathGenerator = CrossPathGenerator;
  global.computeDiversity = computeDiversity;

})(typeof window !== 'undefined' ? window : this);
