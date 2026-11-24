/* ============ 乐学英语 · 交互逻辑 ============ */
(function () {
  "use strict";

  // ---- DOM 引用 ----
  const el = {
    chinese: document.getElementById("chineseSentence"),
    inputArea: document.getElementById("inputArea"),
    feedback: document.getElementById("feedback"),
    checkBtn: document.getElementById("checkBtn"),
    hintBtn: document.getElementById("hintBtn"),
    resetBtn: document.getElementById("resetBtn"),
    speakBtn: document.getElementById("speakBtn"),
    shuffleBtn: document.getElementById("shuffleBtn"),
    clearBtn: document.getElementById("clearBtn"),
    soundToggle: document.getElementById("soundToggle"),
    gradeBadge: document.getElementById("gradeBadge"),
    currentNum: document.getElementById("currentNum"),
    totalNum: document.getElementById("totalNum"),
    progressFill: document.getElementById("progressFill"),
    progressTrack: document.getElementById("progressTrack"),
    modalMask: document.getElementById("modalMask"),
    modalClose: document.getElementById("modalClose"),
    modalRestart: document.getElementById("modalRestart")
  };

  const TOTAL = SENTENCES.length;
  const STORAGE_KEY = "study-en-done-v1";
  let index = 0;
  let soundOn = true;
  let checkTimer = null;
  let jumpTimer = null;
  let locked = false; // 本句已答对并进入切换流程，防止重复检查
  let inputs = [];

  // 已做过的句子索引，持久化到 localStorage，刷新后仍然记住
  let done = loadDone();

  function loadDone() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      const set = new Set();
      if (Array.isArray(arr)) {
        arr.forEach(function (n) { if (Number.isInteger(n) && n >= 0 && n < TOTAL) set.add(n); });
      }
      return set;
    } catch (e) { return new Set(); }
  }
  function saveDone() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(done))); } catch (e) {}
  }
  // 从"未做过"的句子里随机抽一个；当 excludeCurrent 为真时排除当前句
  function pickRandom(excludeCurrent) {
    const pool = [];
    for (let i = 0; i < TOTAL; i++) {
      if (done.has(i)) continue;
      if (excludeCurrent && i === index) continue;
      pool.push(i);
    }
    if (!pool.length) return -1; // 全部做完
    return pool[Math.floor(Math.random() * pool.length)];
  }

  el.totalNum.textContent = TOTAL;

  // ---- 音频（按键 / 正确 / 错误）----
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, duration, type, volume, delay) {
    if (!soundOn) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    const start = ctx.currentTime + (delay || 0);
    gain.gain.setValueAtTime(volume || 0.06, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }
  function playKey() { tone(620 + Math.random() * 120, 0.06, "sine", 0.04); }
  function playSuccess() {
    tone(523, 0.14, "sine", 0.09, 0);
    tone(659, 0.14, "sine", 0.09, 0.13);
    tone(784, 0.26, "sine", 0.10, 0.26);
  }
  function playError() { tone(220, 0.28, "triangle", 0.09); }

  // ---- 语音跟读 ----
  function speak(text, rate) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = rate || 0.82;
    utter.pitch = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const en = voices.find(function (v) { return v.lang && v.lang.toLowerCase().indexOf("en") === 0; });
    if (en) utter.voice = en;
    window.speechSynthesis.speak(utter);
  }

  // ---- 渲染句子 ----
  function render() {
    const data = SENTENCES[index];
    clearTimeout(checkTimer);
    clearTimeout(jumpTimer);
    locked = false;
    el.chinese.textContent = data.cn;
    el.gradeBadge.textContent = getGrade(index);
    updateProgress();

    // 输入框
    el.inputArea.innerHTML = "";
    inputs = [];
    data.w.forEach(function (item, i) {
      const group = document.createElement("div");
      group.className = "word-group";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "word-input";
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.setAttribute("aria-label", "第 " + (i + 1) + " 个单词，" + item[1]);
      input.maxLength = item[0].length + 6;
      input.style.width = Math.max(item[0].length + 0.9, 2.6) + "em";
      input.dataset.answer = item[0].toLowerCase();

      const hint = document.createElement("div");
      hint.className = "word-hint";
      hint.innerHTML = '<span class="hint-cn">' + item[1] + "</span>";
      hint.title = "点击听这个单词的发音";
      hint.addEventListener("click", function () { speak(item[0], 0.75); });

      group.appendChild(input);
      group.appendChild(hint);

      input.addEventListener("input", function () {
        if (locked) return;
        input.value = input.value.replace(/[^a-zA-Z']/g, "");
        input.classList.toggle("filled", input.value.length > 0);
        input.classList.remove("error", "correct");
        clearFeedback();
        clearTimeout(jumpTimer);
        if (input.value.length > 0) playKey();

        // 输入正确 -> 标记为绿色并自动跳到下一个输入框
        if (input.value.trim().toLowerCase() === input.dataset.answer) {
          input.classList.add("correct");
          jumpTimer = setTimeout(function () {
            if (locked) return;
            // 再次确认内容仍正确，避免误跳
            if (input.value.trim().toLowerCase() !== input.dataset.answer) return;
            focusNext(i); // 末格会自动调用 checkAnswer
          }, 200);
        } else {
          // 输入有误/未完成时，全部填满后也自动检查
          scheduleAutoCheck();
        }
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === " " || e.key === "Tab") {
          e.preventDefault();
          focusNext(i);
        } else if (e.key === "Enter") {
          e.preventDefault();
          checkAnswer();
        } else if (e.key === "Backspace" && input.value === "" && i > 0) {
          e.preventDefault();
          inputs[i - 1].focus();
        } else if (e.key === "ArrowLeft" && i > 0) {
          e.preventDefault(); inputs[i - 1].focus();
        } else if (e.key === "ArrowRight" && i < inputs.length - 1) {
          e.preventDefault(); inputs[i + 1].focus();
        }
      });

      el.inputArea.appendChild(group);
      inputs.push(input);

      if (i === data.w.length - 1 && data.p) {
        const punc = document.createElement("span");
        punc.className = "punctuation";
        punc.textContent = data.p;
        el.inputArea.appendChild(punc);
      }
    });

    clearFeedback();
    setTimeout(function () { if (inputs.length) inputs[0].focus(); }, 60);
  }

  function focusNext(i) {
    if (i < inputs.length - 1) inputs[i + 1].focus();
    else checkAnswer();
  }

  function updateProgress() {
    const n = done.size;
    el.currentNum.textContent = n;
    el.progressFill.style.width = (n / TOTAL * 100) + "%";
    el.progressTrack.setAttribute("aria-valuenow", n);
  }

  // 进入下一句：从未做过的句子里随机抽；全部做完则弹完成层
  function goNext() {
    const next = pickRandom(false);
    if (next === -1) { showModal(); return; }
    index = next;
    render();
  }

  function clearFeedback() {
    el.feedback.textContent = "";
    el.feedback.className = "feedback";
  }
  function setFeedback(msg, type) {
    el.feedback.textContent = msg;
    el.feedback.className = "feedback " + type;
  }

  // ---- 检查答案 ----
  function scheduleAutoCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(function () {
      if (inputs.every(function (inp) { return inp.value.trim().length > 0; })) checkAnswer();
    }, 700);
  }

  function checkAnswer() {
    if (locked) return;
    clearTimeout(checkTimer);
    clearTimeout(jumpTimer);
    let allOk = true;
    inputs.forEach(function (inp) {
      const ok = inp.value.trim().toLowerCase() === inp.dataset.answer;
      inp.classList.remove("error", "correct");
      inp.classList.add(ok ? "correct" : "error");
      if (!ok) allOk = false;
    });

    if (allOk) {
      locked = true;
      done.add(index);
      saveDone();
      updateProgress();
      playSuccess();
      setFeedback("🎉 完全正确！太棒啦！正在进入下一句…", "success");
      const sentence = SENTENCES[index].w.map(function (w) { return w[0]; }).join(" ") + (SENTENCES[index].p || "");
      speak(sentence, 0.85);
      inputs.forEach(function (inp) { inp.disabled = true; });
      setTimeout(goNext, 1800);
    } else {
      playError();
      const wrong = inputs.filter(function (inp) { return inp.classList.contains("error"); }).length;
      setFeedback("还有 " + wrong + " 个单词写错了，看看红色方框，再试试吧！", "error");
    }
  }

  function showModal() { el.modalMask.hidden = false; }
  function hideModal() { el.modalMask.hidden = true; }

  // ---- 事件绑定 ----
  el.checkBtn.addEventListener("click", checkAnswer);
  el.resetBtn.addEventListener("click", function () {
    clearTimeout(jumpTimer);
    clearTimeout(checkTimer);
    locked = false;
    inputs.forEach(function (inp) {
      inp.value = "";
      inp.disabled = false;
      inp.classList.remove("error", "correct", "filled");
    });
    clearFeedback();
    if (inputs.length) inputs[0].focus();
  });
  el.hintBtn.addEventListener("click", function () {
    const data = SENTENCES[index];
    let revealed = 0;
    inputs.forEach(function (inp) {
      if (inp.value.trim().toLowerCase() !== inp.dataset.answer) {
        if (revealed < 1) {
          inp.value = inp.dataset.answer;
          inp.classList.add("filled");
          revealed++;
        }
      }
    });
    if (revealed) { setFeedback("已为你填出一个单词，加油！", "info"); playKey(); }
    else setFeedback("已经全部填对啦，点检查答案吧！", "info");
  });
  el.speakBtn.addEventListener("click", function () {
    const data = SENTENCES[index];
    speak(data.w.map(function (w) { return w[0]; }).join(" ") + (data.p || ""), 0.78);
  });
  el.shuffleBtn.addEventListener("click", function () {
    const next = pickRandom(true); // 随机换一句未做过、且不同于当前的句子
    if (next === -1) {
      setFeedback(done.size >= TOTAL ? "🎉 全部句子都做完啦，清除记忆可重新开始！" : "只剩下这一句没做啦，加油完成它！", "info");
      return;
    }
    index = next;
    render();
  });
  el.clearBtn.addEventListener("click", function () {
    done.clear();
    saveDone();
    updateProgress();
    const first = pickRandom(false);
    if (first === -1) { render(); return; }
    index = first;
    render();
    setFeedback("记忆已清除，已为你随机抽取一句，重新开始吧！", "info");
  });
  el.soundToggle.addEventListener("click", function () {
    soundOn = !soundOn;
    el.soundToggle.classList.toggle("muted", !soundOn);
    el.soundToggle.setAttribute("aria-label", soundOn ? "关闭音效" : "开启音效");
    el.soundToggle.querySelector(".icon-sound-on").style.display = soundOn ? "" : "none";
    el.soundToggle.querySelector(".icon-sound-off").style.display = soundOn ? "none" : "";
    if (soundOn) playKey();
  });
  el.modalClose.addEventListener("click", hideModal);
  el.modalRestart.addEventListener("click", function () {
    hideModal();
    done.clear();
    saveDone();
    index = pickRandom(false);
    if (index === -1) index = 0;
    render();
  });
  el.modalMask.addEventListener("click", function (e) { if (e.target === el.modalMask) hideModal(); });

  // 预加载语音列表（部分浏览器需要）
  if ("speechSynthesis" in window) window.speechSynthesis.getVoices();

  // 首次进入：随机抽一句未做过的；若已全部做完则从头清除并开始
  index = pickRandom(false);
  if (index === -1) {
    done.clear();
    saveDone();
    index = pickRandom(false);
  }
  render();
})();
