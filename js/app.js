const App = {
  editor: null, statusEl: null, popup: null, popupWords: null,
  currentWords: [], _typingTimer: null, _currentText: '', _corrections: [],
  _inited: false, _forceRender: false,
  mode: localStorage.getItem('editor_mode') || 'simple', modeSelect: null,

  init() {
    this.editor = document.getElementById('editor');
    this.statusEl = document.getElementById('status');
    this.popup = document.getElementById('word-popup');
    this.popupWords = document.getElementById('popup-words');
    this.modeSelect = document.getElementById('mode-select');
    this.modeSelect.value = this.mode;
    this.modeSelect.addEventListener('change', () => this.setMode(this.modeSelect.value));
    document.getElementById('btn-clear').addEventListener('click', () => this.clear());
    this.editor.addEventListener('input', () => this.onTextChange());
    this.editor.addEventListener('click', (e) => this.onWordClick(e));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#word-popup') && !e.target.closest('.word')) this.hidePopup();
    });
    Dict.onReady(() => this.reparse());
    Dict.load();
  },

  setMode(mode) {
    this.mode = mode;
    localStorage.setItem('editor_mode', mode);
    this.hidePopup();
    this._forceRender = true;
    this.reparse();
  },

  setStatus(text, cls) {
    this.statusEl.textContent = text;
    this.statusEl.className = cls || '';
  },

  onTextChange() {
    let text = this.editor.innerText || '';
    if (text === this._currentText) return;
    this._currentText = text;
    clearTimeout(this._typingTimer);
    this._typingTimer = setTimeout(() => this.reparse(), 500);
  },

  reparse() {
    let text = this.editor.innerText || '';
    this._currentText = text;
    let result = Engine.analyzeSentence(text);
    this.currentWords = result.words;
    this._corrections = [];
    for (let i = 0; i < this.currentWords.length; i++) {
      if (this.currentWords[i]._auto) {
        this._corrections.push(i);
        delete this.currentWords[i]._auto;
      }
    }
    if (this._forceRender || !this._inited || this.mode === 'full' || this._corrections.length > 0) {
      this._forceRender = false;
      this._inited = true;
      this.renderSpans();
    }
  },

  renderSpans() {
    let wrap = this.editor.parentElement;
    let scrollTop = wrap.scrollTop;
    let cursorOffset = this._saveCursor();
    if (this.mode === 'simple') {
      this.renderSimple();
    } else {
      this.renderFull();
    }
    this._restoreCursor(cursorOffset);
    wrap.scrollTop = scrollTop;
    requestAnimationFrame(() => { wrap.scrollTop = scrollTop; });
  },

  _saveCursor() {
    let sel = window.getSelection();
    if (!sel || !sel.rangeCount) return -1;
    let range = sel.getRangeAt(0);
    if (!this.editor.contains(range.commonAncestorContainer)) return -1;
    let pre = document.createRange();
    pre.selectNodeContents(this.editor);
    pre.setEnd(range.startContainer, range.startOffset);
    let offset = pre.toString().length;
    return offset;
  },

  _restoreCursor(offset) {
    if (offset < 0) return;
    let sel = window.getSelection();
    if (!sel) return;
    let walker = document.createTreeWalker(this.editor, NodeFilter.SHOW_TEXT, null, false);
    let node, total = 0;
    while (node = walker.nextNode()) {
      let len = node.textContent.length;
      if (total + len >= offset) {
        let range = document.createRange();
        range.setStart(node, offset - total);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      total += len;
    }
    let last = this.editor.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) {
      let range = document.createRange();
      range.setStart(last, last.textContent.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  },

  renderFull() {
    let text = this.editor.innerText || '';
    let tokens = Engine.tokenize(text);
    let html = '';
    let wi = 0;
    for (let t of tokens) {
      if (/^\s+$/.test(t)) { html += t; continue; }
      if (!/^[\u0400-\u04FF]+$/i.test(t)) { html += t; continue; }
      let info = this.currentWords[wi] || Engine.analyzeWord(t);
      if (!this.currentWords[wi]) this.currentWords[wi] = info;
      let attrs = '';
      for (let [k,v] of Object.entries(info)) {
        if (k==='word'||k==='verbData'||k==='forms'||k==='rnLemma'||k==='_auto') continue;
        if (v!==null && v!==undefined) attrs += ` data-${k}="${v}"`;
      }
      let cls = 'word' + (this._corrections.includes(wi) ? ' auto-fixed' : '');
      html += `<span class="${cls}" data-idx="${wi}"${attrs}>${info.word || t}</span>`;
      wi++;
    }
    this.editor.innerHTML = html;
    if (this._corrections.length) {
      setTimeout(() => {
        this.editor.querySelectorAll('.auto-fixed').forEach(el => el.classList.add('changed'));
      }, 50);
    }
  },

  renderSimple() {
    let text = this.editor.innerText || '';
    let tokens = Engine.tokenize(text);
    let html = '';
    let wi = 0;
    for (let t of tokens) {
      if (/^\s+$/.test(t)) { html += t; continue; }
      if (!/^[\u0400-\u04FF]+$/i.test(t)) { html += t; continue; }
      let info = this.currentWords[wi] || Engine.analyzeWord(t);
      if (!this.currentWords[wi]) this.currentWords[wi] = info;
      let corrected = this._corrections.includes(wi);
      if (corrected) {
        html += `<span class="word changed">${info.word || t}</span>`;
      } else {
        html += info.word || t;
      }
      wi++;
    }
    this.editor.innerHTML = html;
  },

  onWordClick(e) {
    if (this.mode === 'simple') return;
    let span = e.target.closest('.word');
    if (!span) { this.hidePopup(); return; }
    let idx = parseInt(span.dataset.idx);
    if (isNaN(idx) || !this.currentWords[idx]) return;
    let info = this.currentWords[idx];
    let forms = Dict.getAllForms(info);
    if (forms.length === 0) return;
    this.showPopup(e.clientX, e.clientY, forms, (form) => {
      this.applyChange(idx, form.text);
    });
  },

  applyChange(idx, newText) {
    let oldInfo = this.currentWords[idx];
    if (!oldInfo) return;
    if (oldInfo.pos === 'pron') {
      let newInfo = Engine.analyzeWord(newText);
      this.currentWords = Engine.propagateChange(this.currentWords, idx, newInfo);
    } else if (oldInfo.pos === 'verb' && oldInfo.verbData) {
      let newInfo = Engine.analyzeWord(newText);
      if (newInfo.pos === 'verb') {
        this.currentWords = Engine.propagateChange(this.currentWords, idx, newInfo);
      }
    } else {
      this.currentWords[idx] = Engine.analyzeWord(newText);
    }
    this.hidePopup();
    this.renderSpans();
    let spans = this.editor.querySelectorAll('.word');
    if (spans[idx]) spans[idx].classList.add('changed');
  },

  showPopup(x, y, forms, onSelect) {
    this.popupWords.innerHTML = '';
    let seen = new Set();
    for (let f of forms) {
      if (seen.has(f.text)) continue;
      seen.add(f.text);
      let btn = document.createElement('button');
      btn.className = 'popup-item';
      btn.innerHTML = f.text + (f.hint ? ` <span class="hint">— ${f.hint}</span>` : '');
      btn.addEventListener('click', (e) => { e.stopPropagation(); onSelect(f); });
      this.popupWords.appendChild(btn);
    }
    if (!this.popupWords.children.length) return;
    let px = Math.min(x, window.innerWidth - 210);
    let py = Math.min(y, window.innerHeight - 310);
    this.popup.style.left = px + 'px';
    this.popup.style.top = py + 'px';
    this.popup.classList.remove('hidden');
  },

  hidePopup() { this.popup.classList.add('hidden'); },

  clear() {
    this.editor.innerHTML = '';
    this.currentWords = [];
    this._currentText = '';
    this._corrections = [];
    this.hidePopup();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
