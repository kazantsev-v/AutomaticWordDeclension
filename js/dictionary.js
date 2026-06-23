const PRONOUNS = {
  'я':     { lemma:'я',     pos:'pron', person:1, number:'sg', gender:null,
    forms:{ nom:'я', gen:'меня', dat:'мне', acc:'меня', ins:'мной', prep:'мне' } },
  'меня':  { lemma:'я',     pos:'pron', person:1, number:'sg', gender:null, case:'gen' },
  'мне':   { lemma:'я',     pos:'pron', person:1, number:'sg', gender:null, case:'dat' },
  'мной':  { lemma:'я',     pos:'pron', person:1, number:'sg', gender:null, case:'ins' },
  'ты':    { lemma:'ты',    pos:'pron', person:2, number:'sg', gender:null,
    forms:{ nom:'ты', gen:'тебя', dat:'тебе', acc:'тебя', ins:'тобой', prep:'тебе' } },
  'тебя':  { lemma:'ты',    pos:'pron', person:2, number:'sg', gender:null, case:'gen' },
  'тебе':  { lemma:'ты',    pos:'pron', person:2, number:'sg', gender:null, case:'dat' },
  'тобой': { lemma:'ты',    pos:'pron', person:2, number:'sg', gender:null, case:'ins' },
  'он':    { lemma:'он',    pos:'pron', person:3, number:'sg', gender:'m',
    forms:{ nom:'он', gen:'его', dat:'ему', acc:'его', ins:'им', prep:'нём' } },
  'его':   { lemma:'он',    pos:'pron', person:3, number:'sg', gender:'m', case:'gen' },
  'ему':   { lemma:'он',    pos:'pron', person:3, number:'sg', gender:'m', case:'dat' },
  'она':   { lemma:'она',   pos:'pron', person:3, number:'sg', gender:'f',
    forms:{ nom:'она', gen:'её', dat:'ей', acc:'её', ins:'ей', prep:'ней' } },
  'её':    { lemma:'она',   pos:'pron', person:3, number:'sg', gender:'f', case:'gen' },
  'ей':    { lemma:'она',   pos:'pron', person:3, number:'sg', gender:'f', case:'dat' },
  'оно':   { lemma:'оно',   pos:'pron', person:3, number:'sg', gender:'n',
    forms:{ nom:'оно', gen:'его', dat:'ему', acc:'его', ins:'им', prep:'нём' } },
  'мы':    { lemma:'мы',    pos:'pron', person:1, number:'pl', gender:null,
    forms:{ nom:'мы', gen:'нас', dat:'нам', acc:'нас', ins:'нами', prep:'нас' } },
  'нас':   { lemma:'мы',    pos:'pron', person:1, number:'pl', case:'gen' },
  'нам':   { lemma:'мы',    pos:'pron', person:1, number:'pl', case:'dat' },
  'нами':  { lemma:'мы',    pos:'pron', person:1, number:'pl', case:'ins' },
  'вы':    { lemma:'вы',    pos:'pron', person:2, number:'pl', gender:null,
    forms:{ nom:'вы', gen:'вас', dat:'вам', acc:'вас', ins:'вами', prep:'вас' } },
  'вас':   { lemma:'вы',    pos:'pron', person:2, number:'pl', case:'gen' },
  'вам':   { lemma:'вы',    pos:'pron', person:2, number:'pl', case:'dat' },
  'вами':  { lemma:'вы',    pos:'pron', person:2, number:'pl', case:'ins' },
  'они':   { lemma:'они',   pos:'pron', person:3, number:'pl', gender:null,
    forms:{ nom:'они', gen:'их', dat:'им', acc:'их', ins:'ими', prep:'них' } },
  'их':    { lemma:'они',   pos:'pron', person:3, number:'pl', case:'gen' },
  'им':    { lemma:'они',   pos:'pron', person:3, number:'pl', case:'dat' },
};
const RN_G = {m:'MASCULINE', f:'FEMININE', n:'NEUTER'};
const STRIP = s => s ? s.replace(/'/g,'').replace(/ё/g,'е') : '';

Dict = {
  verbs: {}, adjectives: {}, _loaded: false, _callbacks: [],

  async load() {
    try {
      App.setStatus('Загрузка глаголов...', 'loading');
      let resp = await fetch('https://raw.githubusercontent.com/TBlackford/russian-conjugation/master/data/verbs.json');
      this.verbs = await resp.json();
      App.setStatus('Загрузка прилагательных...', 'loading');
      resp = await fetch('data/adjectives.min.json');
      this.adjectives = await resp.json();
      this._loaded = true;
      App.setStatus('Готово', 'ready');
      this._callbacks.forEach(f => f());
    } catch(e) {
      App.setStatus('Ошибка загрузки словарей: ' + e.message, 'error');
    }
  },

  onReady(fn) {
    if (this._loaded) fn(); else this._callbacks.push(fn);
  },

  getAdjForm(lemma, gender, number) {
    let a = this.adjectives[lemma];
    if (!a) return null;
    if (number === 'pl') return a.pl;
    return a[gender] || a.m;
  },

  getAllForms(wordInfo) {
    let forms = [], w = wordInfo.word.toLowerCase();
    if (wordInfo.pos === 'pron') {
      let pi = PRONOUNS[w];
      if (pi && pi.forms) {
        let caseLabels = {nom:'им.п', gen:'род.п', dat:'дат.п', acc:'вин.п', ins:'тв.п', prep:'пр.п'};
        for (let [k,v] of Object.entries(pi.forms)) {
          forms.push({ text:v, hint:caseLabels[k]||k });
        }
      }
      if (pi) {
        let pairs = {'sg':{мы:'pl'}, 'pl':{я:'sg'}};
        let targetNum = pi.number === 'sg' ? 'pl' : 'sg';
        for (let [lemma, info] of Object.entries(PRONOUNS)) {
          if (info.forms && info.number === targetNum && info.person === pi.person) {
            forms.push({ text:lemma, hint:targetNum==='sg'?'ед.ч':'мн.ч' });
            break;
          }
        }
      }
      return forms;
    }
    if (wordInfo.pos === 'verb' && wordInfo.verbData) {
      let v = wordInfo.verbData, existing = STRIP(wordInfo.word);
      if (v.past) {
        for (let [k,vv] of Object.entries(v.past)) {
          if (vv && STRIP(vv) !== existing) {
            forms.push({ text:STRIP(vv), hint:{masculine:'м.р.',feminine:'ж.р.',neuter:'ср.р.',plural:'мн.ч.'}[k]||k });
          }
        }
      }
      if (v.present) {
        for (let [nk, nv] of Object.entries(v.present)) {
          for (let [pk, f] of Object.entries(nv)) {
            if (f && STRIP(f) !== existing) {
              forms.push({ text:STRIP(f), hint:(nk==='singular'?'ед':'мн')+'.'+(nk==='singular'?{first:'1л',second:'2л',third:'3л'}[pk]:{first:'1л',second:'2л',third:'3л'}[pk]) });
            }
          }
        }
      }
      if (v.imperative && v.imperative.singular && STRIP(v.imperative.singular) !== existing) {
        forms.push({ text:STRIP(v.imperative.singular), hint:'повел.' });
      }
      return forms;
    }
    if (wordInfo.pos === 'noun') {
      let RN = window.RussianNouns;
      if (!RN) return forms;
      try {
        let g = RN_G[wordInfo.gender];
        if (!g) return forms;
        let lemm = RN.createLemma({ text: wordInfo.lemma, gender: RN.Gender[g] });
        let eng = new RN.Engine();
        if (wordInfo.number === 'pl') {
          forms.push({ text: eng.decline(lemm, RN.Case.NOMINATIVE)[0], hint: 'ед.ч.' });
        } else {
          forms.push({ text: eng.pluralize(lemm)[0], hint: 'мн.ч.' });
        }
      } catch(e) {}
      return forms;
    }
    if (wordInfo.pos === 'adj') {
      let a = this.adjectives[wordInfo.lemma];
      if (!a) return forms;
      for (let [k,v] of Object.entries(a)) {
        if (v && v !== wordInfo.word && k !== 'lemma') {
          forms.push({ text:v, hint:{m:'м.р.',f:'ж.р.',n:'ср.р.',pl:'мн.ч.'}[k]||k });
        }
      }
      return forms;
    }
    return forms;
  }
};
