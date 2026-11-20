// こよみ計算（旧暦・六曜・干支・節気・雑節・暦注・祝日）
(function (root) {
  const D = (typeof KOYOMI_DATA !== 'undefined') ? KOYOMI_DATA : root.KOYOMI_DATA;
  const DAY0 = Date.UTC(1970, 0, 1);
  const dn = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - DAY0) / 86400000);
  const fromDn = (n) => { const t = new Date(DAY0 + n * 86400000); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), w: t.getUTCDay() }; };

  const ROKUYO = ['大安', '赤口', '先勝', '友引', '先負', '仏滅'];
  const ROKUYO_INFO = {
    '大安': '何事にも吉。結婚式や引っ越し、お祝いごとに選ばれる日。',
    '赤口': '正午ごろ（11時〜13時）だけ吉、それ以外は凶とされる日。',
    '先勝': '「先んずれば勝つ」。午前が吉、午後は凶。',
    '友引': '朝夕は吉、昼は凶。お祝いごとは良いが、葬儀は避けられる日。',
    '先負': '「先んずれば負ける」。午前は凶、午後は吉。急がず静かに過ごす日。',
    '仏滅': '何事も凶とされる日。お祝いごとは避けられることが多い。'
  };
  const KAN = '甲乙丙丁戊己庚辛壬癸';
  const SHI = '子丑寅卯辰巳午未申酉戌亥';
  const ETO = 'ねずみ,うし,とら,うさぎ,たつ,へび,うま,ひつじ,さる,とり,いぬ,いのしし'.split(',');
  const SEKKI = { 0: '春分', 15: '清明', 30: '穀雨', 45: '立夏', 60: '小満', 75: '芒種', 90: '夏至', 105: '小暑', 120: '大暑', 135: '立秋', 150: '処暑', 165: '白露', 180: '秋分', 195: '寒露', 210: '霜降', 225: '立冬', 240: '小雪', 255: '大雪', 270: '冬至', 285: '小寒', 300: '大寒', 315: '立春', 330: '雨水', 345: '啓蟄' };
  const KYUREKI_MONTH = ['', '睦月', '如月', '弥生', '卯月', '皐月', '水無月', '文月', '葉月', '長月', '神無月', '霜月', '師走'];

  // 暦注の説明
  const REKICHU_INFO = {
    '一粒万倍日': '一粒の籾が万倍に実る吉日。始めごと・お金を使う・財布をおろすのに良い日。',
    '天赦日': '日本の暦で最上の吉日。何をするにも良い日とされる。',
    '寅の日': '金運の吉日。「出ていったお金が戻ってくる」とされ、財布の購入や旅行に良い日。',
    '巳の日': '弁財天の縁日。金運・芸事の吉日。',
    '己巳の日': '60日に一度の巳の日。弁財天にお参りするのに最も良い日。',
    '甲子の日': '干支のはじまりの日。新しいことを始めるのに良い日。',
    '天恩日': '天の恵みを受ける吉日。お祝いごとに良い（5日続く）。',
    '不成就日': '何事も成就しないとされる凶日。始めごとは避けた方が良いとされる。',
    '三隣亡': '建築関係の凶日。家を建てる・棟上げは避けるとされる。',
    '十方暮': '何をしてもうまくいきにくいとされる10日間。',
    '庚申': '庚申（かのえさる）の日。昔は夜通し起きて過ごす「庚申待ち」をした。',
    '土用': '季節の変わり目の約18日間。土を動かす作業（土いじり・建築の基礎工事）は避けるとされる。',
    '土用の丑の日': '土用の期間中の丑の日。夏はうなぎを食べる習わしで有名。',
    '八専': '1年に6回ある12日間。同じ気が重なり、良いことも悪いことも極端になるとされる。'
  };

  function kanshi(n) { return ((n + 17) % 60 + 60) % 60; }
  // 旧暦
  const M = D.m; // [dn, month, leap]
  function kyureki(n) {
    let lo = 0, hi = M.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (M[mid][0] <= n) lo = mid; else hi = mid - 1; }
    const e = M[lo];
    // 年: 旧1月(閏でない)の開始を基準
    const g = fromDn(n);
    let year = g.y;
    if (e[1] >= 11 && g.m <= 2) year = g.y - 1; // 前年の11・12月
    if (e[1] <= 2 && g.m >= 11) year = g.y + 1;
    return { y: year, m: e[1], d: n - e[0] + 1, leap: !!e[2] };
  }
  // 節気・土用など
  const T = D.t; const termByDn = {}; T.forEach(([n, L]) => { (termByDn[n] = termByDn[n] || []).push(L); });
  function termLon(n, Ls) { // n以前の直近の指定黄経
    let best = null; for (let i = T.length - 1; i >= 0; i--) { if (T[i][0] <= n && Ls.includes(T[i][1])) { best = T[i]; break; } } return best;
  }
  const SETSU = [315, 345, 15, 45, 75, 105, 135, 165, 195, 225, 255, 285];
  function setsuMonth(n) { // 節月 1=寅月(立春〜)
    const t = termLon(n, SETSU); return SETSU.indexOf(t[1]) + 1;
  }
  const fullMoon = new Set(D.f);
  const newMoon = new Set(M.map(e => e[0]));

  // 祝日
  const holCache = {};
  function nthMonday(y, m, k) { const w = fromDn(dn(y, m, 1)).w; const first = 1 + ((8 - w) % 7); return first + (k - 1) * 7; }
  function equinox(y, L) { for (const [n, l] of T) { if (l === L) { const g = fromDn(n); if (g.y === y) return g.d; } } return null; }
  function holidays(y) {
    if (holCache[y]) return holCache[y];
    const h = {};
    const add = (m, d, name) => { if (d) h[dn(y, m, d)] = name; };
    add(1, 1, '元日');
    add(1, y >= 2000 ? nthMonday(y, 1, 2) : 15, '成人の日');
    if (y >= 1967) add(2, 11, '建国記念の日');
    if (y >= 2020) add(2, 23, '天皇誕生日');
    add(3, equinox(y, 0), '春分の日');
    add(4, 29, y >= 2007 ? '昭和の日' : y >= 1989 ? 'みどりの日' : '天皇誕生日');
    add(5, 3, '憲法記念日');
    if (y >= 2007) add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');
    if (y >= 1996) { if (y === 2020) add(7, 23, '海の日'); else if (y === 2021) add(7, 22, '海の日'); else add(7, y >= 2003 ? nthMonday(y, 7, 3) : 20, '海の日'); }
    if (y >= 2016) { if (y === 2020) add(8, 10, '山の日'); else if (y === 2021) add(8, 8, '山の日'); else add(8, 11, '山の日'); }
    if (y >= 1966) add(9, y >= 2003 ? nthMonday(y, 9, 3) : 15, '敬老の日');
    add(9, equinox(y, 180), '秋分の日');
    if (y >= 1966) { if (y === 2020) add(7, 24, 'スポーツの日'); else if (y === 2021) add(7, 23, 'スポーツの日');
      else add(10, y >= 2000 ? nthMonday(y, 10, 2) : 10, y >= 2020 ? 'スポーツの日' : '体育の日'); }
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');
    if (y >= 1989 && y <= 2018) add(12, 23, '天皇誕生日');
    if (y === 1959) add(4, 10, '皇太子明仁親王の結婚の儀');
    if (y === 1989) add(2, 24, '昭和天皇の大喪の礼');
    if (y === 1990) add(11, 12, '即位礼正殿の儀');
    if (y === 1993) add(6, 9, '皇太子徳仁親王の結婚の儀');
    if (y === 2019) { add(5, 1, '天皇の即位の日'); add(10, 22, '即位礼正殿の儀'); }
    // 国民の休日（1985年12月から：祝日に挟まれた平日）
    const keys = Object.keys(h).map(Number).sort((a, b) => a - b);
    const KOKUMIN = dn(1985, 12, 27), FURIKAE = dn(1973, 4, 12);
    for (const k of keys) { if (k + 1 >= KOKUMIN && h[k + 2] && !h[k + 1] && fromDn(k + 1).w !== 0) h[k + 1] = '国民の休日'; }
    // 振替休日（1973年4月12日から）
    for (const k of Object.keys(h).map(Number).sort((a, b) => a - b)) {
      if (k >= FURIKAE && fromDn(k).w === 0 && h[k] !== '振替休日') { let j = k + 1; while (h[j]) j++; h[j] = '振替休日'; }
    }
    holCache[y] = h; return h;
  }

  // 暦注（選日）
  const MANBAI = { 1: [1, 6], 2: [9, 2], 3: [0, 3], 4: [3, 4], 5: [5, 6], 6: [9, 6], 7: [0, 7], 8: [3, 8], 9: [9, 6], 10: [9, 10], 11: [11, 0], 12: [3, 0] };
  const SANRINBO = { 1: 11, 4: 11, 7: 11, 10: 11, 2: 2, 5: 2, 8: 2, 11: 2, 3: 6, 6: 6, 9: 6, 12: 6 };
  const FUJOJU = { 1: 3, 7: 3, 2: 2, 8: 2, 3: 1, 9: 1, 4: 4, 10: 4, 5: 5, 11: 5, 6: 6, 12: 6 };
  function season(n) { // 立春〜立夏前=春 ...（土用は前の季節に含めて扱う）
    const t = termLon(n, [315, 45, 135, 225]);
    return { 315: 'spring', 45: 'summer', 135: 'autumn', 225: 'winter' }[t[1]];
  }
  function inDoyo(n) { // 土用の入り〜節分（立春・立夏・立秋・立冬の前日）
    const t = termLon(n, [27, 117, 207, 297, 315, 45, 135, 225]);
    return t && [27, 117, 207, 297].includes(t[1]);
  }

  function info(y, m, d) {
    const n = dn(y, m, d); const g = fromDn(n);
    const k = kyureki(n);
    const rokuyo = ROKUYO[(k.m + k.d) % 6];
    const ks = kanshi(n); const kan = ks % 10, shi = ks % 12;
    const sm = setsuMonth(n);
    const se = season(n);
    const list = [];
    const [a, b] = MANBAI[sm]; if (shi === a || shi === b) list.push('一粒万倍日');
    if ((se === 'spring' && ks === 14) || (se === 'summer' && ks === 30) || (se === 'autumn' && ks === 44) || (se === 'winter' && ks === 0)) list.push('天赦日');
    if (shi === 2) list.push('寅の日');
    if (ks === 5) list.push('己巳の日'); else if (shi === 5) list.push('巳の日');
    if (ks === 0) list.push('甲子の日');
    if ((ks >= 0 && ks <= 4) || (ks >= 15 && ks <= 19) || (ks >= 45 && ks <= 49)) list.push('天恩日');
    if ((k.d - FUJOJU[k.m] + 32) % 8 === 0) list.push('不成就日');
    if (SANRINBO[sm] === shi) list.push('三隣亡');
    if (ks >= 20 && ks <= 29) list.push('十方暮');
    if (ks === 56) list.push('庚申');
    if (ks >= 48 && ks <= 59 && ![49, 52, 54, 58].includes(ks)) list.push('八専');
    const doyo = inDoyo(n);
    if (doyo) { list.push('土用'); if (shi === 1) list.push('土用の丑の日'); }

    // 節気・雑節
    const terms = [];
    (termByDn[n] || []).forEach(L => {
      if (SEKKI[L] !== undefined) terms.push(SEKKI[L]);
      if ([27, 117, 207, 297].includes(L)) terms.push('土用の入り');
      if (L === 80) terms.push('入梅');
      if (L === 100) terms.push('半夏生');
    });
    (termByDn[n + 1] || []).forEach(L => { if (L === 315) terms.push('節分'); });
    const sb = termLon(n, [0]); const ab = termLon(n, [180]);
    [[sb, '春'], [ab, '秋']].forEach(([t, s]) => {
      if (!t) return; const diff = n - t[0];
      if (diff === -3) terms.push(s + 'の彼岸入り'); if (diff === 0) terms.push(s + 'の彼岸中日'); if (diff === 3) terms.push(s + 'の彼岸明け');
    });
    // 次の春分・秋分の前の彼岸入りも拾う
    (termByDn[n + 3] || []).forEach(L => { if (L === 0) terms.push('春の彼岸入り'); if (L === 180) terms.push('秋の彼岸入り'); });
    const rs = termLon(n, [315]);
    if (rs) { const diff = n - rs[0]; if (diff === 87) terms.push('八十八夜'); if (diff === 209) terms.push('二百十日'); if (diff === 219) terms.push('二百二十日'); }
    const uniq = [...new Set(terms)];
    // 行事（固定）
    const ev = [];
    const md = m * 100 + d;
    const FIXED = { 101: '', 303: 'ひな祭り', 707: '七夕', 1225: 'クリスマス', 1231: '大晦日', 214: 'バレンタインデー', 1115: '七五三' };
    if (FIXED[md]) ev.push(FIXED[md]);
    if (m === 5 && d === nthMonday(y, 5, 2) + 6) ev.push('母の日');
    if (m === 6 && d === nthMonday(y, 6, 3) + 6) ev.push('父の日');
    if (k.m === 8 && k.d === 15 && !k.leap) ev.push('十五夜');
    if (k.m === 9 && k.d === 13 && !k.leap) ev.push('十三夜');

    const hol = holidays(y)[n] || null;
    return {
      n, y, m, d, w: g.w,
      kyureki: k, kyurekiName: KYUREKI_MONTH[k.m],
      rokuyo, kanshi: KAN[kan] + SHI[shi], eto: ETO[shi],
      holiday: hol, rekichu: list, terms: uniq, events: ev.filter(Boolean),
      fullMoon: fullMoon.has(n), newMoon: newMoon.has(n), moonAge: k.d - 1
    };
  }
  function wareki(y, m, d) {
    const v = y * 10000 + m * 100 + d;
    if (v >= 20190501) return '令和' + (y - 2018 === 1 ? '元' : y - 2018) + '年';
    if (v >= 19890108) return '平成' + (y - 1988 === 1 ? '元' : y - 1988) + '年';
    return '昭和' + (y - 1925) + '年';
  }
  function yearEto(y) { const i = ((y - 4) % 12 + 12) % 12; return KAN[((y - 4) % 10 + 10) % 10] + SHI[i] + '（' + ETO[i] + '）'; }

  root.Koyomi = { info, wareki, yearEto, dn, fromDn, ROKUYO_INFO, REKICHU_INFO };
})(typeof window !== 'undefined' ? window : globalThis);
