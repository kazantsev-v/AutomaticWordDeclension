const Engine = {
  _rnEngine: null,
  get RN() { return window.RussianNouns; },
  get eng() {
    if (!this._rnEngine) this._rnEngine = new this.RN.Engine();
    return this._rnEngine;
  },

  tokenize(text) {
    let tokens = [], re = /([\u0400-\u04FF]+|[^\u0400-\u04FF\s]+|\s+)/gi, m;
    while ((m = re.exec(text)) !== null) tokens.push(m[1]);
    return tokens;
  },

  guessGender(word) {
    let w = word.toLowerCase();
    if (w.endsWith('а') || w.endsWith('я')) return 'f';
    if (w.endsWith('о') || w.endsWith('е') || w.endsWith('ё')) return 'n';
    if (w.endsWith('ь')) return null;
    return 'm';
  },

  analyzeWord(word) {
    let lower = word.toLowerCase();
    let p = PRONOUNS[lower];
    if (!p) {
      let sl = STRIP(lower);
      if (sl !== lower) p = PRONOUNS[sl];
      if (!p) {
        for (let [k, v] of Object.entries(PRONOUNS)) {
          if (STRIP(k) === sl) { p = v; break; }
        }
      }
    }
    if (p) {
      let res = { word, lemma:p.lemma, pos:'pron', person:p.person, number:p.number, gender:p.gender||null, case:p.case||'nom' };
      if (p.forms) res.forms = p.forms;
      return res;
    }
    let adj = Dict.adjectives[lower];
    if (adj) {
      let gender = null;
      let number = 'sg';
      if (adj.m === lower) gender = 'm';
      else if (adj.f === lower) gender = 'f';
      else if (adj.n === lower) gender = 'n';
      if (adj.pl === lower) { number = 'pl'; gender = null; }
      return { word, lemma:adj.lemma||lower, pos:'adj', gender, number };
    }
    let stripLower = STRIP(lower);
    for (let [lemma, v] of Object.entries(Dict.verbs)) {
      let found = null;
      if (STRIP(v.infinitive) === stripLower) found = { tense:'infinitive' };
      if (v.present) {
        for (let n of ['singular','plural']) {
          if (!v.present[n]) continue;
          for (let [per, form] of Object.entries(v.present[n])) {
            if (STRIP(form) === stripLower) found = { tense:'present', number:n==='singular'?'sg':'pl', person:{first:1,second:2,third:3}[per] };
          }
        }
      }
      if (v.past) {
        for (let [g, form] of Object.entries(v.past)) {
          if (typeof form === 'string' && STRIP(form) === stripLower) {
            let gender = g==='plural'?null:{masculine:'m',feminine:'f',neuter:'n'}[g];
            found = { tense:'past', number:g==='plural'?'pl':'sg', gender };
          }
        }
      }
      if (v.imperative) {
        for (let [num, form] of Object.entries(v.imperative)) {
          if (typeof form === 'string' && STRIP(form) === stripLower) found = { tense:'imperative', number:num==='singular'?'sg':'pl' };
        }
      }
      if (found) { found.verbData = v; return { word, lemma, pos:'verb', ...found }; }
    }
    let g = this.guessGender(word);
    if (window.RussianNouns && g) {
      try {
        let rnG = {m:this.RN.Gender.MASCULINE, f:this.RN.Gender.FEMININE, n:this.RN.Gender.NEUTER}[g];
        this.RN.createLemma({ text:lower, gender:rnG });
        return { word, lemma:lower, pos:'noun', gender:g, number:'sg', case:'nom' };
      } catch(e) {}
    }
    return { word, lemma:lower, pos:'other' };
  },

  _isLikelySubject(w) {
    if (w.pos === 'pron' || w.pos === 'noun') return true;
    if (w.pos !== 'other') return false;
    let lower = w.word.toLowerCase();
    if (lower.length <= 2) return false;
    let funcs = ['и','а','но','да','или','ни','не','в','на','с','к','у','о',
      'об','от','по','до','за','над','под','без','для','из','через','около'];
    if (funcs.includes(lower)) return false;
    let g = this.guessGender(w.word);
    if (g) return true;
    if (/[бвгджзйклмнпрстфхцчшщ]ь$/i.test(lower) && !/[чшщ]ь$/i.test(lower)) return true;
    return false;
  },

  _detectSubject(words) {
    let verb = words.find(w => w.pos === 'verb');
    let verbIdx = verb ? words.indexOf(verb) : words.length;
    let nomWords = words.filter((w, i) => i < verbIdx && this._isLikelySubject(w) && (!w.case || w.case === 'nom'));
    nomWords = nomWords.map(w => {
      if (w.pos !== 'other') return w;
      let g = this.guessGender(w.word);
      if (!g && /[бвгджзйклмнпрстфхцчшщ]ь$/i.test(w.word.toLowerCase()) && !/[чшщ]ь$/i.test(w.word.toLowerCase())) {
        g = 'm';
      }
      return { ...w, pos: 'noun', gender: g || null, number: 'sg', case: 'nom' };
    });
    if (nomWords.length < 2) return nomWords[0] || null;
    let hasAnd = false;
    for (let i = 0; i < nomWords.length - 1; i++) {
      let i1 = words.indexOf(nomWords[i]);
      let i2 = words.indexOf(nomWords[i + 1]);
      for (let j = i1 + 1; j < i2; j++) {
        if (words[j].word === 'и') { hasAnd = true; break; }
      }
      if (hasAnd) break;
    }
    if (hasAnd) {
      return { word: nomWords.map(w => w.word).join(' и '), lemma: 'compound', pos: 'noun', number: 'pl', gender: null, case: 'nom' };
    }
    return nomWords[0];
  },

  _splitClauses(words, commaSplits) {
    let clauses = [], start = 0;
    let ci = 0;
    for (let i = 0; i < words.length; i++) {
      if (words[i].word === 'и') {
        let hasBefore = false;
        for (let j = start; j < i; j++) { if (words[j].pos === 'verb') { hasBefore = true; break; } }
        if (!hasBefore) continue;
        let hasAfter = false, hasSubjectAfter = false;
        let seen = -1;
        for (let j = i + 1; j < words.length; j++) {
          if (words[j].pos === 'verb') { hasAfter = true; break; }
          if (seen < 0 && words[j].pos !== 'verb' && words[j].word !== 'и' && words[j].word !== 'а' && words[j].word !== 'но') seen = j;
        }
        if (hasAfter && seen >= 0) hasSubjectAfter = true;
        if (hasSubjectAfter) {
          clauses.push(words.slice(start, i));
          start = i + 1;
        }
        continue;
      }
      if (commaSplits && ci < commaSplits.length && commaSplits[ci] === i) {
        let hasVerbBefore = false;
        for (let j = start; j < i; j++) { if (words[j].pos === 'verb') { hasVerbBefore = true; break; } }
        let hasVerbAfter = false;
        for (let j = i; j < words.length; j++) { if (words[j].pos === 'verb') { hasVerbAfter = true; break; } }
        if (hasVerbBefore && hasVerbAfter) {
          clauses.push(words.slice(start, i));
          start = i;
        }
        ci++;
      }
    }
    if (start < words.length) clauses.push(words.slice(start));
    return clauses.length ? clauses : [words];
  },

  analyzeSentence(text) {
    let rawSentences = text.match(/[^.!?]+[.!?]*/g) || [text];
    let allWords = [];
    for (let raw of rawSentences) {
      let s = raw.trim();
      if (!s) continue;
      let tokens = this.tokenize(s);
      let words = [], commaSplits = [], wIdx = 0;
      for (let t of tokens) {
        if (/^[\u0400-\u04FF]+$/i.test(t)) {
          words.push(this.analyzeWord(t));
          wIdx++;
        } else if (t === ',') {
          commaSplits.push(wIdx);
        }
      }
      let clauses = this._splitClauses(words, commaSplits);
      let result = words.map(w => ({...w}));
      for (let clause of clauses) {
        let subject = this._detectSubject(clause);
        let verb = clause.find(w => w.pos === 'verb');
        let corrected = this.correctAgreement(clause, subject, verb);
        if (corrected) {
          for (let ci = 0; ci < clause.length; ci++) {
            let origIdx = words.indexOf(clause[ci]);
            if (origIdx >= 0 && corrected[ci]._auto) {
              result[origIdx] = corrected[ci];
            }
          }
        }
      }
      allWords.push(...result);
    }
    let subject = allWords.find(w => (w.pos === 'pron' || w.pos === 'noun') && (!w.case || w.case === 'nom'));
    let verb = allWords.find(w => w.pos === 'verb');
    return { words: allWords, subject, verb };
  },

  correctAgreement(words, subject, verb) {
    if (!subject || !verb) return null;
    let subNum = subject.number, subGen = subject.gender, subPer = subject.person;
    let corrected = false;
    let res = words.map(w => ({...w}));
    for (let i = 0; i < res.length; i++) {
      let w = res[i];
      if (w.pos !== 'verb' || !w.verbData) continue;
      let v = w.verbData;
      if (w.tense === 'past' || (!w.tense && v.past)) {
        if (subGen && w.gender !== subGen && subNum !== 'pl') {
          let key = {m:'masculine',f:'feminine',n:'neuter'}[subGen];
          let form = v.past && v.past[key];
          if (form && STRIP(form) !== STRIP(w.word)) {
            res[i] = { ...w, word:STRIP(form), gender:subGen, number:'sg', tense:'past', _auto:true };
            corrected = true;
          }
        }
        if (subNum === 'pl' && w.number !== 'pl') {
          let form = v.past && v.past.plural;
          if (form && STRIP(form) !== STRIP(w.word)) {
            res[i] = { ...w, word:STRIP(form), number:'pl', gender:null, tense:'past', _auto:true };
            corrected = true;
          }
        }
        if (subNum === 'sg' && w.number === 'pl') {
          let tg = subGen || 'm';
          let key = {m:'masculine',f:'feminine',n:'neuter'}[tg];
          let form = v.past && v.past[key];
          if (form && STRIP(form) !== STRIP(w.word)) {
            res[i] = { ...w, word:STRIP(form), gender:tg, number:'sg', tense:'past', _auto:true };
            corrected = true;
          }
        }
      }
      if (w.tense === 'present' || (!w.tense && v.present)) {
        if (subPer && w.person !== subPer) {
          let n = (subNum||'sg') === 'pl' ? 'plural' : 'singular';
          let pm = {1:'first',2:'second',3:'third'};
          let form = v.present && v.present[n] && v.present[n][pm[subPer]];
          if (form && STRIP(form) !== STRIP(w.word)) {
            res[i] = { ...w, word:STRIP(form), person:subPer, number:subNum, tense:'present', _auto:true };
            corrected = true;
          }
        }
        if (subNum === 'pl' && w.number !== 'pl') {
          let p = subPer || w.person || 3;
          let pm = {1:'first',2:'second',3:'third'};
          let form = v.present && v.present.plural && v.present.plural[pm[p]];
          if (form && STRIP(form) !== STRIP(w.word)) {
            res[i] = { ...w, word:STRIP(form), number:'pl', tense:'present', _auto:true };
            corrected = true;
          }
        }
        if (subNum === 'sg' && w.number === 'pl') {
          let p = subPer || w.person || 3;
          let pm = {1:'first',2:'second',3:'third'};
          let form = v.present && v.present.singular && v.present.singular[pm[p]];
          if (form && STRIP(form) !== STRIP(w.word)) {
            res[i] = { ...w, word:STRIP(form), person:p, number:'sg', tense:'present', _auto:true };
            corrected = true;
          }
        }
      }
    }
    return corrected ? res : null;
  },

  propagateChange(words, changedIdx, newInfo) {
    let res = words.map(w => ({...w}));
    res[changedIdx] = {...newInfo};
    let old = words[changedIdx];
    let chNum = old.number !== newInfo.number;
    let chGen = old.gender !== newInfo.gender && newInfo.gender !== null;
    let chPer = old.person !== newInfo.person;
    if (!chNum && !chGen && !chPer) return res;
    for (let i = 0; i < res.length; i++) {
      if (i === changedIdx) continue;
      let w = res[i];
      if (w.pos === 'verb' && w.verbData) {
        let v = w.verbData;
        if (chNum) {
          if (w.tense === 'past' || !w.tense) {
            let g = newInfo.number === 'pl' ? 'plural' : (newInfo.gender || w.gender || 'm');
            let key = g === 'plural' ? 'plural' : {m:'masculine',f:'feminine',n:'neuter'}[g];
            let form = v.past && v.past[key];
            if (form) res[i] = { ...w, word:STRIP(form), number:newInfo.number==='pl'?'pl':'sg', gender:g==='plural'?null:g, tense:'past' };
          } else if (w.tense === 'present') {
            let n = newInfo.number === 'pl' ? 'plural' : 'singular';
            let p = newInfo.person || w.person || 3;
            let pm = {1:'first',2:'second',3:'third'};
            let form = v.present && v.present[n] && v.present[n][pm[p]];
            if (form) res[i] = { ...w, word:STRIP(form), number:newInfo.number, person:p };
          }
        }
        if (chGen && (w.tense === 'past' || !w.tense)) {
          let g = newInfo.gender || 'm';
          let key = {m:'masculine',f:'feminine',n:'neuter'}[g];
          let form = v.past && v.past[key];
          if (form) res[i] = { ...w, word:STRIP(form), gender:g, number:'sg', tense:'past' };
        }
        if (chPer && w.tense === 'present') {
          let n = (newInfo.number || w.number || 'sg') === 'pl' ? 'plural' : 'singular';
          let pm = {1:'first',2:'second',3:'third'};
          let form = v.present && v.present[n] && v.present[n][pm[newInfo.person]];
          if (form) res[i] = { ...w, word:STRIP(form), person:newInfo.person };
        }
      }
    }
    return res;
  }
};
