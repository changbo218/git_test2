(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Constants
   * ------------------------------------------------------------------ */

  const W = 960;
  const H = 640;
  const COLS = 10;
  const ROWS = 6;
  const SIDE = 42;
  const TOP = 78;
  const GAP = 8;
  const ROW_GAP = 10;
  const BRICK_H = 26;
  const BRICK_W = (W - SIDE * 2 - GAP * (COLS - 1)) / COLS;
  const STEP = 1 / 120;
  const MAX_LEVEL = 3;

  const LEVELS = [
    { speed: 380, toughRows: 2 },
    { speed: 430, toughRows: 3 },
    { speed: 480, toughRows: 4 },
  ];

  const ROW_COLORS = ['#ff4d94', '#ff6b6b', '#ffa94d', '#ffe066', '#5ee6a8', '#4dabf7'];

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const ui = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    overlay: document.getElementById('overlay'),
    kicker: document.getElementById('overlayKicker'),
    title: document.getElementById('overlayTitle'),
    text: document.getElementById('overlayText'),
    primary: document.getElementById('primaryBtn'),
    status: document.getElementById('status'),
    pauseBtn: document.getElementById('pauseBtn'),
    soundBtn: document.getElementById('soundBtn'),
  };

  /* ------------------------------------------------------------------ *
   *  Storage / preferences
   * ------------------------------------------------------------------ */

  const memoryStore = Object.create(null);

  function readStore(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return memoryStore[key] ?? null;
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      memoryStore[key] = value;
    }
  }

  const savedBest = Number.parseInt(readStore('brickbreaker.best') || '0', 10);

  const prefersReducedMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ------------------------------------------------------------------ *
   *  State
   * ------------------------------------------------------------------ */

  const state = {
    phase: 'ready',                 // ready | serve | playing | paused | levelclear | gameover | win
    prevPhase: 'playing',
    levelIndex: 0,
    score: 0,
    best: Number.isFinite(savedBest) ? savedBest : 0,
    lives: 3,
    muted: readStore('brickbreaker.muted') === '1',
    bricks: [],
    particles: [],
    pops: [],
    trail: [],
    ball: { x: W / 2, y: H - 120, r: 8, vx: 0, vy: 0, speed: LEVELS[0].speed },
    paddle: { x: W / 2, y: H - 46, w: 132, h: 14, targetX: W / 2 },
    keys: { left: false, right: false },
    pointerActive: false,
    shake: 0,
    time: 0,
    accumulator: 0,
    lastTimestamp: 0,
  };

  const stars = Array.from({ length: 90 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    size: Math.random() * 1.5 + 0.4,
    alpha: Math.random() * 0.42 + 0.12,
    speed: Math.random() * 1.5 + 0.4,
  }));

  /* ------------------------------------------------------------------ *
   *  Canvas sizing (logical coordinates are always 960 x 640)
   * ------------------------------------------------------------------ */

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  /* ------------------------------------------------------------------ *
   *  Audio
   * ------------------------------------------------------------------ */

  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return null;
      try {
        audioCtx = new AudioContextCtor();
      } catch (error) {
        return null;
      }
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function tone(frequency, duration, type = 'square', volume = 0.03) {
    if (state.muted) return;
    const audio = ensureAudio();
    if (!audio) return;
    try {
      const now = audio.currentTime;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    } catch (error) {
      /* Audio is a nice-to-have; never let it break the game. */
    }
  }

  function syncSoundButton() {
    ui.soundBtn.textContent = state.muted ? 'MUTED' : 'SOUND';
    ui.soundBtn.setAttribute('aria-pressed', String(!state.muted));
    ui.soundBtn.setAttribute('aria-label', state.muted ? '打开音效' : '关闭音效');
  }

  function toggleMute() {
    state.muted = !state.muted;
    writeStore('brickbreaker.muted', state.muted ? '1' : '0');
    syncSoundButton();
    if (!state.muted) tone(660, 0.06, 'triangle', 0.03);
  }

  /* ------------------------------------------------------------------ *
   *  Helpers
   * ------------------------------------------------------------------ */

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function roundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function updateHud() {
    ui.score.textContent = String(state.score);
    ui.best.textContent = String(state.best);
    ui.level.innerHTML = `${state.levelIndex + 1}<span class="dim">/${MAX_LEVEL}</span>`;
    ui.lives.textContent = '● '.repeat(state.lives) + '○ '.repeat(Math.max(0, 3 - state.lives));
    ui.lives.setAttribute('aria-label', `剩余 ${state.lives} 条命`);
  }

  function setStatus(message) {
    ui.status.textContent = message;
  }

  function setPhase(phase) {
    state.phase = phase;
    const canPause = phase === 'playing' || phase === 'serve' || phase === 'paused';
    ui.pauseBtn.disabled = !canPause;
    ui.pauseBtn.textContent = phase === 'paused' ? 'RESUME' : 'PAUSE';
    ui.pauseBtn.setAttribute('aria-label', phase === 'paused' ? '继续游戏' : '暂停游戏');
    if (phase !== 'playing') state.accumulator = 0;
  }

  function showOverlay(kicker, title, text, button, focus) {
    ui.kicker.textContent = kicker;
    ui.title.textContent = title;
    ui.text.textContent = text;
    ui.primary.textContent = button;
    ui.overlay.classList.remove('hidden');
    if (focus) {
      window.requestAnimationFrame(() => {
        try {
          ui.primary.focus({ preventScroll: true });
        } catch (error) {
          ui.primary.focus();
        }
      });
    }
  }

  function hideOverlay() {
    ui.overlay.classList.add('hidden');
    if (document.activeElement === ui.primary) ui.primary.blur();
  }

  function primaryAction() {
    switch (state.phase) {
      case 'ready':
      case 'gameover':
      case 'win':
        startGame();
        break;
      case 'paused':
        resumeGame();
        break;
      case 'levelclear':
        nextLevel();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ *
   *  Level / ball setup
   * ------------------------------------------------------------------ */

  function buildLevel() {
    const config = LEVELS[state.levelIndex];
    state.bricks = [];

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const hp = row < config.toughRows ? 2 : 1;
        state.bricks.push({
          x: SIDE + col * (BRICK_W + GAP),
          y: TOP + row * (BRICK_H + ROW_GAP),
          w: BRICK_W,
          h: BRICK_H,
          hp,
          maxHp: hp,
          color: ROW_COLORS[row % ROW_COLORS.length],
          alive: true,
          flash: 0,
        });
      }
    }

    state.particles.length = 0;
    state.pops.length = 0;
    state.trail.length = 0;
    state.ball.speed = config.speed;
    resetBall();
  }

  function resetBall() {
    const ball = state.ball;
    const paddle = state.paddle;
    ball.x = paddle.x;
    ball.y = paddle.y - ball.r - 2;
    ball.vx = 0;
    ball.vy = 0;
    state.trail.length = 0;
  }

  function launchBall() {
    if (state.phase !== 'serve') return;
    ensureAudio();
    const ball = state.ball;
    const speed = LEVELS[state.levelIndex].speed;
    const angle = -Math.PI / 2 + (Math.random() * 0.7 - 0.35);
    ball.speed = speed;
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
    setPhase('playing');
    setStatus('游戏中');
    tone(520, 0.05, 'square', 0.03);
  }

  function nextLevel() {
    if (state.levelIndex >= MAX_LEVEL - 1) return;
    state.levelIndex += 1;
    buildLevel();
    hideOverlay();
    setPhase('serve');
    setStatus(`第 ${state.levelIndex + 1} 关 · 按空格 / 点击画面发球`);
    updateHud();
  }

  function levelClear() {
    const clearedLevel = state.levelIndex + 1;
    const bonus = 100 * clearedLevel;

    state.score += bonus;
    if (state.score > state.best) {
      state.best = state.score;
      writeStore('brickbreaker.best', String(state.best));
    }
    state.trail.length = 0;
    updateHud();

    if (state.levelIndex >= MAX_LEVEL - 1) {
      setPhase('win');
      showOverlay(
        'VICTORY',
        '全部通关',
        `最终得分 ${state.score} · 通关奖励 +${bonus}`,
        '再玩一次',
        true
      );
      setStatus(`全部通关 · 得分 ${state.score}`);
      tone(660, 0.1, 'triangle', 0.035);
      window.setTimeout(() => tone(990, 0.16, 'triangle', 0.035), 100);
      return;
    }

    setPhase('levelclear');
    showOverlay(
      'LEVEL CLEAR',
      `第 ${clearedLevel} 关完成`,
      `过关奖励 +${bonus} · 当前得分 ${state.score}`,
      '进入下一关',
      true
    );
    setStatus(`第 ${clearedLevel} 关完成`);
    tone(660, 0.1, 'triangle', 0.035);
    window.setTimeout(() => tone(880, 0.14, 'triangle', 0.035), 90);
  }

  function startGame() {
    ensureAudio();
    state.score = 0;
    state.lives = 3;
    state.levelIndex = 0;
    state.paddle.x = W / 2;
    state.paddle.targetX = W / 2;
    state.pointerActive = false;
    state.shake = 0;
    buildLevel();
    hideOverlay();
    setPhase('serve');
    updateHud();
    setStatus('第 1 关 · 按空格 / 点击画面发球');
  }

  function resumeGame() {
    if (state.phase !== 'paused') return;
    const phase = state.prevPhase === 'serve' ? 'serve' : 'playing';
    hideOverlay();
    setPhase(phase);
    setStatus(phase === 'serve' ? '按空格 / 点击画面发球' : '游戏中');
  }

  function togglePause() {
    if (state.phase === 'paused') {
      resumeGame();
      return;
    }
    if (state.phase !== 'playing' && state.phase !== 'serve') return;
    state.prevPhase = state.phase;
    setPhase('paused');
    showOverlay('PAUSED', '已暂停', '喘口气，准备好再继续。', '继续游戏', true);
    setStatus('已暂停');
  }

  function loseLife() {
    state.lives -= 1;
    state.shake = prefersReducedMotion ? 0 : 12;
    burst(state.ball.x, Math.min(H - 20, state.ball.y), '#ff3d8b', 18, 280);
    tone(180, 0.16, 'sawtooth', 0.04);
    updateHud();

    if (state.lives <= 0) {
      writeStore('brickbreaker.best', String(state.best));
      setPhase('gameover');
      showOverlay(
        'GAME OVER',
        '游戏结束',
        `本局得分 ${state.score} · 历史最高 ${state.best}`,
        '再来一局',
        true
      );
      setStatus(`游戏结束 · 得分 ${state.score}`);
      window.setTimeout(() => tone(98, 0.3, 'sawtooth', 0.035), 140);
      resetBall();
      return;
    }

    resetBall();
    setPhase('serve');
    setStatus(`还剩 ${state.lives} 条命 · 按空格 / 点击画面发球`);
  }

  /* ------------------------------------------------------------------ *
   *  Score / effects
   * ------------------------------------------------------------------ */

  function addScore(points, x, y) {
    state.score += points;
    if (state.score > state.best) {
      state.best = state.score;
      writeStore('brickbreaker.best', String(state.best));
    }
    if (!prefersReducedMotion) {
      state.pops.push({ x, y, text: `+${points}`, life: 0.8, color: '#ffe066' });
    }
    updateHud();
  }

  function burst(x, y, color, count, spread) {
    if (prefersReducedMotion) return;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * spread;
      const life = 0.35 + Math.random() * 0.45;
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life,
        maxLife: life,
        size: 2 + Math.random() * 3,
        color,
      });
    }
  }

  function updateEffects(dt) {
    for (const particle of state.particles) {
      particle.life -= dt;
      particle.vy += 900 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
    state.particles = state.particles.filter((particle) => particle.life > 0);

    for (const pop of state.pops) {
      pop.life -= dt;
      pop.y -= 36 * dt;
    }
    state.pops = state.pops.filter((pop) => pop.life > 0);

    for (const brick of state.bricks) {
      if (brick.flash > 0) brick.flash = Math.max(0, brick.flash - dt);
    }

    state.shake = Math.max(0, state.shake - 40 * dt);
  }

  /* ------------------------------------------------------------------ *
   *  Paddle + keyboard / pointer input
   * ------------------------------------------------------------------ */

  function updatePaddle(dt) {
    const paddle = state.paddle;
    if (state.keys.left) paddle.targetX -= 640 * dt;
    if (state.keys.right) paddle.targetX += 640 * dt;

    const half = paddle.w / 2 + 8;
    paddle.targetX = clamp(paddle.targetX, half, W - half);
    paddle.x += (paddle.targetX - paddle.x) * Math.min(1, dt * 18);
    paddle.x = clamp(paddle.x, half, W - half);
  }

  function movePointerTo(clientX) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const x = ((clientX - rect.left) / rect.width) * W;
    const half = state.paddle.w / 2 + 8;
    state.paddle.targetX = clamp(x, half, W - half);
    state.pointerActive = true;
  }

  function pushTrail() {
    if (prefersReducedMotion) return;
    state.trail.unshift({ x: state.ball.x, y: state.ball.y });
    if (state.trail.length > 14) state.trail.pop();
  }

  /* ------------------------------------------------------------------ *
   *  Physics
   * ------------------------------------------------------------------ */

  function hitBrick(brick) {
    const ball = state.ball;
    const nearestX = clamp(ball.x, brick.x, brick.x + brick.w);
    const nearestY = clamp(ball.y, brick.y, brick.y + brick.h);
    let dx = ball.x - nearestX;
    let dy = ball.y - nearestY;

    if (dx * dx + dy * dy > ball.r * ball.r) return false;

    if (dx === 0 && dy === 0) {
      // Ball centre is inside the brick: push it out along the shallowest edge.
      const left = ball.x - brick.x;
      const right = brick.x + brick.w - ball.x;
      const top = ball.y - brick.y;
      const bottom = brick.y + brick.h - ball.y;
      const minimum = Math.min(left, right, top, bottom);

      if (minimum === left) {
        ball.x = brick.x - ball.r;
        ball.vx = -Math.abs(ball.vx);
      } else if (minimum === right) {
        ball.x = brick.x + brick.w + ball.r;
        ball.vx = Math.abs(ball.vx);
      } else if (minimum === top) {
        ball.y = brick.y - ball.r;
        ball.vy = -Math.abs(ball.vy);
      } else {
        ball.y = brick.y + brick.h + ball.r;
        ball.vy = Math.abs(ball.vy);
      }
    } else {
      const distance = Math.hypot(dx, dy);
      const normalX = dx / distance;
      const normalY = dy / distance;
      ball.x += normalX * (ball.r - distance);
      ball.y += normalY * (ball.r - distance);

      const velocityAlongNormal = ball.vx * normalX + ball.vy * normalY;
      if (velocityAlongNormal < 0) {
        ball.vx -= 2 * velocityAlongNormal * normalX;
        ball.vy -= 2 * velocityAlongNormal * normalY;
      }
    }

    brick.hp -= 1;
    brick.flash = 0.12;
    state.shake = Math.max(state.shake, prefersReducedMotion ? 0 : 2);

    if (brick.hp <= 0) {
      brick.alive = false;
      const points = 10 * brick.maxHp;
      addScore(points, brick.x + brick.w / 2, brick.y + brick.h / 2);
      burst(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.color, 14, 240);
      tone(480 + (brick.y - TOP) * 1.4, 0.055, 'triangle', 0.028);
    } else {
      burst(ball.x, ball.y, '#ffffff', 5, 160);
      tone(300, 0.03, 'square', 0.018);
    }

    return true;
  }

  function step(dt) {
    const ball = state.ball;
    const paddle = state.paddle;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x - ball.r < 0) {
      ball.x = ball.r;
      ball.vx = Math.abs(ball.vx);
      tone(160, 0.025, 'sine', 0.015);
    } else if (ball.x + ball.r > W) {
      ball.x = W - ball.r;
      ball.vx = -Math.abs(ball.vx);
      tone(160, 0.025, 'sine', 0.015);
    }

    if (ball.y - ball.r < 0) {
      ball.y = ball.r;
      ball.vy = Math.abs(ball.vy);
      tone(160, 0.025, 'sine', 0.015);
    }

    if (ball.y - ball.r > H) {
      loseLife();
      return;
    }

    if (
      ball.vy > 0 &&
      ball.y + ball.r >= paddle.y &&
      ball.y - ball.r <= paddle.y + paddle.h &&
      ball.x + ball.r >= paddle.x - paddle.w / 2 &&
      ball.x - ball.r <= paddle.x + paddle.w / 2
    ) {
      ball.y = paddle.y - ball.r;
      const relative = clamp((ball.x - paddle.x) / (paddle.w / 2), -1, 1);
      const currentSpeed = Math.hypot(ball.vx, ball.vy);
      const speed = Math.min(
        LEVELS[state.levelIndex].speed * 1.35,
        Math.max(ball.speed, currentSpeed) * 1.02
      );
      const angle = relative * 1.05;
      ball.speed = speed;
      ball.vx = Math.sin(angle) * speed;
      ball.vy = -Math.cos(angle) * speed;
      state.shake = Math.max(state.shake, prefersReducedMotion ? 0 : 2.5);
      burst(ball.x, paddle.y, '#7df9ff', 6, 150);
      tone(230, 0.04, 'square', 0.024);
    }

    for (const brick of state.bricks) {
      if (!brick.alive) continue;
      if (hitBrick(brick)) {
        if (state.bricks.every((item) => !item.alive)) {
          levelClear();
        }
        return;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  Rendering
   * ------------------------------------------------------------------ */

  function drawBackground() {
    const background = ctx.createLinearGradient(0, 0, 0, H);
    background.addColorStop(0, '#080e1f');
    background.addColorStop(0.55, '#050912');
    background.addColorStop(1, '#04060d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, W, H);

    const topGlow = ctx.createRadialGradient(W * 0.5, -140, 40, W * 0.5, -140, 640);
    topGlow.addColorStop(0, 'rgba(61, 242, 255, 0.13)');
    topGlow.addColorStop(1, 'rgba(61, 242, 255, 0)');
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, W, H);

    const cornerGlow = ctx.createRadialGradient(W, H, 20, W, H, 560);
    cornerGlow.addColorStop(0, 'rgba(255, 61, 139, 0.09)');
    cornerGlow.addColorStop(1, 'rgba(255, 61, 139, 0)');
    ctx.fillStyle = cornerGlow;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(120, 160, 255, 0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 48) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
    }
    for (let y = 0; y <= H; y += 48) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
    }
    ctx.stroke();

    for (const star of stars) {
      const alpha = star.alpha * (0.72 + 0.28 * Math.sin(state.time * star.speed + star.x));
      ctx.fillStyle = `rgba(190, 220, 255, ${alpha.toFixed(3)})`;
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }

    ctx.strokeStyle = 'rgba(61, 242, 255, 0.16)';
    ctx.beginPath();
    ctx.moveTo(0, H - 0.5);
    ctx.lineTo(W, H - 0.5);
    ctx.stroke();
  }

  function drawBricks() {
    for (const brick of state.bricks) {
      if (!brick.alive) continue;

      roundedRect(brick.x, brick.y, brick.w, brick.h, 6);
      ctx.fillStyle = brick.color;
      ctx.fill();

      roundedRect(brick.x + 2, brick.y + 2, brick.w - 4, 5, 2.5);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fill();

      if (brick.hp > 1) {
        roundedRect(brick.x + 4, brick.y + 4, brick.w - 8, brick.h - 8, 4);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (brick.flash > 0) {
        roundedRect(brick.x, brick.y, brick.w, brick.h, 6);
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.5, brick.flash * 4).toFixed(3)})`;
        ctx.fill();
      }
    }
  }

  function drawTrail() {
    const ball = state.ball;
    for (let index = 0; index < state.trail.length; index += 1) {
      const point = state.trail[index];
      const ratio = 1 - index / state.trail.length;
      ctx.beginPath();
      ctx.arc(point.x, point.y, ball.r * ratio * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(61, 242, 255, ${(ratio * 0.16).toFixed(3)})`;
      ctx.fill();
    }
  }

  function drawParticles() {
    for (const particle of state.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(
        particle.x - particle.size / 2,
        particle.y - particle.size / 2,
        particle.size,
        particle.size
      );
    }
    ctx.globalAlpha = 1;
  }

  function drawPaddle() {
    const paddle = state.paddle;
    const x = paddle.x - paddle.w / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(61, 242, 255, 0.85)';
    ctx.shadowBlur = 22;
    const gradient = ctx.createLinearGradient(0, paddle.y, 0, paddle.y + paddle.h);
    gradient.addColorStop(0, '#c7feff');
    gradient.addColorStop(0.45, '#5ef5ff');
    gradient.addColorStop(1, '#1cb6d4');
    roundedRect(x, paddle.y, paddle.w, paddle.h, 7);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    roundedRect(x + 7, paddle.y + 3, paddle.w - 14, 3, 1.5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fill();
  }

  function drawBall() {
    const ball = state.ball;
    ctx.save();
    ctx.shadowColor = 'rgba(61, 242, 255, 0.95)';
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = '#f2ffff';
    ctx.fill();
    ctx.restore();
  }

  function drawPops() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const pop of state.pops) {
      const alpha = clamp(pop.life / 0.8, 0, 1);
      ctx.font = '700 15px ui-monospace, Menlo, monospace';
      ctx.fillStyle = `rgba(255, 224, 102, ${alpha.toFixed(3)})`;
      ctx.fillText(pop.text, pop.x, pop.y);
    }
  }

  function drawServeHint() {
    if (state.phase !== 'serve') return;
    const pulse = 0.5 + 0.3 * Math.sin(state.time * 4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 13px ui-monospace, "PingFang SC", Menlo, monospace';
    ctx.fillStyle = `rgba(232, 241, 255, ${pulse.toFixed(3)})`;
    ctx.fillText('SPACE / 点击画面发球', W / 2, state.paddle.y - 56);
  }

  function render() {
    drawBackground();

    ctx.save();
    if (state.shake > 0.1 && !prefersReducedMotion) {
      ctx.translate(
        (Math.random() * 2 - 1) * state.shake * 0.55,
        (Math.random() * 2 - 1) * state.shake * 0.55
      );
    }

    drawBricks();
    drawTrail();
    drawParticles();
    drawPops();
    drawPaddle();
    drawBall();
    drawServeHint();

    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   *  Main loop
   * ------------------------------------------------------------------ */

  function tick(timestamp) {
    if (!state.lastTimestamp) state.lastTimestamp = timestamp;
    let dt = (timestamp - state.lastTimestamp) / 1000;
    state.lastTimestamp = timestamp;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05);

    if (state.phase !== 'paused') {
      state.time += dt;
      updateEffects(dt);
      if (state.phase === 'serve' || state.phase === 'playing') {
        updatePaddle(dt);
      }
    }

    if (state.phase === 'playing') {
      state.accumulator += dt;
      let guard = 0;
      while (state.accumulator >= STEP && state.phase === 'playing' && guard < 8) {
        step(STEP);
        state.accumulator -= STEP;
        guard += 1;
      }
      if (guard >= 8) state.accumulator = 0;
      if (state.phase === 'playing') pushTrail();
    }

    if (state.phase === 'serve') {
      const ball = state.ball;
      const paddle = state.paddle;
      ball.x = paddle.x;
      ball.y = paddle.y - ball.r - 2;
      ball.vx = 0;
      ball.vy = 0;
    }

    render();
    window.requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------ *
   *  Events
   * ------------------------------------------------------------------ */

  ui.primary.addEventListener('click', primaryAction);
  ui.pauseBtn.addEventListener('click', (event) => {
    togglePause();
    if (event.detail > 0) ui.pauseBtn.blur();
  });
  ui.soundBtn.addEventListener('click', (event) => {
    toggleMute();
    if (event.detail > 0) ui.soundBtn.blur();
  });

  canvas.addEventListener('pointermove', (event) => {
    movePointerTo(event.clientX);
  });

  canvas.addEventListener('pointerdown', (event) => {
    ensureAudio();
    movePointerTo(event.clientX);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      /* Pointer capture is optional. */
    }
    if (state.phase === 'serve') {
      event.preventDefault();
      launchBall();
    }
  });

  canvas.addEventListener('pointerup', (event) => {
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* Pointer capture is optional. */
    }
  });

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const onButton = target instanceof Element && target.closest('button');

    switch (event.code) {
      case 'ArrowLeft':
      case 'KeyA':
        state.keys.left = true;
        state.pointerActive = false;
        if (state.phase === 'playing' || state.phase === 'serve') event.preventDefault();
        break;
      case 'ArrowRight':
      case 'KeyD':
        state.keys.right = true;
        state.pointerActive = false;
        if (state.phase === 'playing' || state.phase === 'serve') event.preventDefault();
        break;
      case 'Space':
        if (onButton) return;
        event.preventDefault();
        if (state.phase === 'serve') {
          launchBall();
        } else {
          primaryAction();
        }
        break;
      case 'Enter':
        if (onButton) return;
        if (['ready', 'paused', 'levelclear', 'gameover', 'win'].includes(state.phase)) {
          event.preventDefault();
          primaryAction();
        }
        break;
      case 'KeyP':
      case 'Escape':
        event.preventDefault();
        togglePause();
        break;
      case 'KeyM':
        event.preventDefault();
        toggleMute();
        break;
      default:
        break;
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') state.keys.left = false;
    if (event.code === 'ArrowRight' || event.code === 'KeyD') state.keys.right = false;
  });

  window.addEventListener('blur', () => {
    state.keys.left = false;
    state.keys.right = false;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (state.phase === 'playing' || state.phase === 'serve')) {
      togglePause();
    }
  });

  /* ------------------------------------------------------------------ *
   *  Boot
   * ------------------------------------------------------------------ */

  syncSoundButton();
  setPhase('ready');
  buildLevel();
  updateHud();
  setStatus('准备就绪');
  window.requestAnimationFrame(tick);

  // Small read-only API used by smoke tests and embedders.
  window.BrickBreaker = {
    getState() {
      return {
        phase: state.phase,
        score: state.score,
        best: state.best,
        lives: state.lives,
        level: state.levelIndex + 1,
        bricksAlive: state.bricks.filter((brick) => brick.alive).length,
        paddleX: Math.round(state.paddle.x),
        ball: {
          x: Math.round(state.ball.x),
          y: Math.round(state.ball.y),
          speed: Math.round(state.ball.speed),
        },
      };
    },
    start: startGame,
    launch: launchBall,
    pause: togglePause,
  };
})();
