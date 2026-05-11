import { useState, useEffect, useRef, useCallback } from 'react';

// ============================================================
// CONSTANTS — tweak these to adjust game feel
// ============================================================
const GAME_WIDTH        = 480;
const GAME_HEIGHT       = 640;
const ROAD_WIDTH        = 292;
const ROAD_LEFT         = (GAME_WIDTH - ROAD_WIDTH) / 2;   // 94px
const ROAD_RIGHT        = ROAD_LEFT + ROAD_WIDTH;          // 386px

const CAR_WIDTH         = 44;
const CAR_HEIGHT        = 66;
const CAR_START_X       = GAME_WIDTH / 2 - CAR_WIDTH / 2;
const CAR_Y             = Math.round(GAME_HEIGHT * 0.68);  // vertical position (fixed)

const SPEED_MAX         = 300;   // px/s — road scroll speed at full throttle
const SPEED_RAMP_MS     = 3000;  // ms to ramp from 0 → max speed
const PLAYER_MOVE_SPEED = 240;   // px/s horizontal

const COIN_SIZE         = 26;
const COIN_SPAWN_DIST   = 320;   // road-distance units between coin spawns
const OBSTACLE_W        = 44;
const OBSTACLE_H        = 66;
const OBSTACLE_SPAWN_DIST = 550;

const NUM_CHECKPOINTS   = 8;
const CHECKPOINT_DIST   = 2800;  // distance units between checkpoints
const FINISH_DIST       = NUM_CHECKPOINTS * CHECKPOINT_DIST + 2200;

const COIN_BONUS        = 25;    // coins for correct answer
const HIT_PENALTY       = 2;    // coins lost when hitting obstacle

// Road dash animation — period in pixels (dash + gap)
const DASH_PERIOD       = 60;

// ============================================================
// EDIT QUESTIONS HERE
// ============================================================
const QUESTIONS = [
  {
    question: "Vietnam's globalization level\nin 2014 vs world average?",
    options: [
      "Well below average",
      "Slightly below average",
      "Slightly above average",
      "Far above average",
    ],
    correct: 2,
  },
  {
    question: "Biggest worry before\nentering Vietnam?",
    options: [
      "Geography & resources",
      "Institutions & infrastructure",
      "Political-economic conditions",
      "None — Rosenberg irrelevant",
    ],
    correct: 1,
  },
  {
    question: "Where does Uber fit\nin the GPR Matrix (Vietnam)?",
    options: [
      "Friendly Fire",
      "Global Villains",
      "Troy Syndrome",
      "Valley of Josaphat",
    ],
    correct: 3,
  },
  {
    question: "Dominant form of urban\nmobility in Vietnam?",
    options: [
      "Private cars",
      "Public transport",
      "Motorbikes / scooters",
      "Ride-hailing cars",
    ],
    correct: 2,
  },
  {
    question: "Vietnam looks attractive.\nWhat is Uber's real challenge?",
    options: [
      "Entering the market",
      "Building technology",
      "Local product-market fit",
      "Finding drivers",
    ],
    correct: 2,
  },


  
  {
    question: "What was Uber's\nentry mode in Vietnam?",
    options: [
      "Brownfield acquisition",
      "Equity joint venture",
      "Greenfield, asset-light",
      "Licensing agreement",
    ],
    correct: 2,
  },
  {
    question: "Which organizational logic\ndescribes Uber in Vietnam?",
    options: [
      "Multinational enterprise",
      "Free-standing company",
      "Global enterprise",
      "Transnational network",
    ],
    correct: 2,
  },
  {
    question: "What was Uber mainly\nseeking in Vietnam?",
    options: [
      "Natural resources",
      "Market opportunities",
      "Strategic assets",
      "Production efficiency",
    ],
    correct: 1,
  },

  {
    question: "Uber's 2018 exit from\nVietnam should be seen as:",
    options: [
      "Sudden collapse",
      "Political decision",
      "Strategic retreat",
      "Humanitarian withdrawal",
    ],
    correct: 2,
  },
];

// ============================================================
// HELPER — random int in [min, max)
// ============================================================
const randInt = (min, max) => Math.floor(Math.random() * (max - min)) + min;

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function App() {
  // ── render trigger (incremented every RAF frame) ──────────
  const [tick, setTick] = useState(0);

  // ── scale: fit the fixed game canvas into whichever screen we're on ──
  const [scale, setScale] = useState(() =>
    Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT)
  );
  useEffect(() => {
    const onResize = () =>
      setScale(Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── auto-focus the canvas so keyboard events fire immediately ──
  const containerRef = useRef(null);
  useEffect(() => { containerRef.current?.focus(); }, []);

  // ── all mutable game state lives in a single ref ─────────
  const G = useRef({
    phase: 'start',   // 'start' | 'playing' | 'checkpoint' | 'finish'
    distance: 0,
    speed: 0,
    startTime: null,
    rafId: null,
    lastTime: null,
    idCtr: 0,

    // Player
    carX: CAR_START_X,

    // Score
    coins: 0,
    correctAnswers: 0,
    checkpointsPassed: 0, // how many checkpoints triggered so far

    // Objects
    coins_obj: [],    // { id, x, y }
    obstacles: [],    // { id, x, y, type, hit }

    // Spawn tracking
    lastCoinSpawnDist: 0,
    lastObstacleSpawnDist: 0,

    // Flash overlays
    coinFlashUntil: 0,
    hitFlashUntil: 0,

    // Checkpoint modal
    activeQuestion: null,  // index into QUESTIONS
    cpAnswered: false,
    cpWasCorrect: false,

    // Input
    keys: {},

    // Road offset for visual scroll (loops 0 → DASH_PERIOD)
    roadOffset: 0,

    // Checkpoint approach line — y position on screen (null = not active)
    cpLineY: null,

    // Finish line stripe — y position on screen (null = not active)
    finishLineY: null,
  });

  // ── key handling ──────────────────────────────────────────
  useEffect(() => {
    const down = (e) => {
      G.current.keys[e.key] = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
        e.preventDefault();
      }
    };
    const up = (e) => { G.current.keys[e.key] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ── game loop ─────────────────────────────────────────────
  const gameLoop = useCallback((timestamp) => {
    const g = G.current;
    if (g.phase !== 'playing') return;

    // Delta time (capped at 50ms to avoid huge jumps after tab switch)
    if (!g.lastTime) g.lastTime = timestamp;
    const dt = Math.min((timestamp - g.lastTime) / 1000, 0.05);
    g.lastTime = timestamp;

    // ── Speed ramp ──────────────────────────────────────────
    const elapsed = timestamp - g.startTime;
    const rampFraction = Math.min(elapsed / SPEED_RAMP_MS, 1);
    g.speed = SPEED_MAX * rampFraction;

    // ── Horizontal player movement ──────────────────────────
    if (g.keys['ArrowLeft'] || g.keys['a'] || g.keys['A']) {
      g.carX = Math.max(ROAD_LEFT + 4, g.carX - PLAYER_MOVE_SPEED * dt);
    }
    if (g.keys['ArrowRight'] || g.keys['d'] || g.keys['D']) {
      g.carX = Math.min(ROAD_RIGHT - CAR_WIDTH - 4, g.carX + PLAYER_MOVE_SPEED * dt);
    }

    // ── Distance & road scroll ──────────────────────────────
    const distDelta = g.speed * dt;
    g.distance += distDelta;
    g.roadOffset = (g.roadOffset + g.speed * dt) % DASH_PERIOD;

    // ── Spawn coins ─────────────────────────────────────────
    if (g.distance - g.lastCoinSpawnDist > COIN_SPAWN_DIST) {
      g.lastCoinSpawnDist = g.distance;
      const numCoins = randInt(1, 4);
      for (let i = 0; i < numCoins; i++) {
        g.coins_obj.push({
          id: g.idCtr++,
          x: randInt(ROAD_LEFT + 10, ROAD_RIGHT - COIN_SIZE - 10),
          y: -COIN_SIZE - i * 70,
        });
      }
    }

    // ── Spawn obstacles ─────────────────────────────────────
    if (g.distance - g.lastObstacleSpawnDist > OBSTACLE_SPAWN_DIST) {
      g.lastObstacleSpawnDist = g.distance;
      const type = randInt(0, 3);
      const positions = [ROAD_LEFT + 18, ROAD_LEFT + ROAD_WIDTH / 2 - OBSTACLE_W / 2, ROAD_RIGHT - OBSTACLE_W - 18];
      g.obstacles.push({
        id: g.idCtr++,
        x: positions[randInt(0, positions.length)],
        y: -OBSTACLE_H,
        type,
        hit: false,
      });
    }

    // ── Move objects downward ───────────────────────────────
    g.coins_obj = g.coins_obj
      .map(c => ({ ...c, y: c.y + g.speed * dt }))
      .filter(c => c.y < GAME_HEIGHT + COIN_SIZE);

    g.obstacles = g.obstacles
      .map(o => ({ ...o, y: o.y + g.speed * dt }))
      .filter(o => o.y < GAME_HEIGHT + OBSTACLE_H);

    // ── Collision: coins ────────────────────────────────────
    const carLeft   = g.carX;
    const carRight  = g.carX + CAR_WIDTH;
    const carTop    = CAR_Y;
    const carBottom = CAR_Y + CAR_HEIGHT;

    const keepCoins = [];
    for (const c of g.coins_obj) {
      const hit =
        c.x < carRight && c.x + COIN_SIZE > carLeft &&
        c.y < carBottom && c.y + COIN_SIZE > carTop;
      if (hit) {
        g.coins += 1;
        g.coinFlashUntil = timestamp + 400;
      } else {
        keepCoins.push(c);
      }
    }
    g.coins_obj = keepCoins;

    // ── Collision: obstacles ────────────────────────────────
    for (const o of g.obstacles) {
      if (o.hit) continue;
      const hit =
        o.x < carRight && o.x + OBSTACLE_W > carLeft &&
        o.y < carBottom && o.y + OBSTACLE_H > carTop;
      if (hit) {
        o.hit = true;
        g.coins = Math.max(0, g.coins - HIT_PENALTY);
        g.hitFlashUntil = timestamp + 500;
      }
    }

    // ── Checkpoint approach line ────────────────────────────
    // Spawn a visible checkpoint stripe that scrolls toward the player,
    // reaching CAR_Y at the same moment the checkpoint fires.
    const nextCp = g.checkpointsPassed + 1; // 1-based (used both here and below)
    if (nextCp <= NUM_CHECKPOINTS) {
      const distToNext = nextCp * CHECKPOINT_DIST - g.distance;
      // Spawn when ~500 units away (line needs ~CAR_Y road-px to travel)
      if (distToNext <= 520 && g.cpLineY === null) {
        g.cpLineY = -20;
      }
    }
    if (g.cpLineY !== null) {
      g.cpLineY += g.speed * dt;
      if (g.cpLineY > GAME_HEIGHT) g.cpLineY = null;
    }

    // ── Checkpoint trigger ──────────────────────────────────
    if (nextCp <= NUM_CHECKPOINTS) {
      const cpDistance = nextCp * CHECKPOINT_DIST;
      if (g.distance >= cpDistance) {
        g.phase = 'checkpoint';
        g.activeQuestion = g.checkpointsPassed; // 0-based index
        g.cpAnswered  = false;
        g.cpWasCorrect = false;
        g.checkpointsPassed = nextCp;
        g.cpLineY = null;
        setTick(t => t + 1);
        return;
      }
    }

    // ── Finish approach stripe ────────────────────────────
    const distToFinish = FINISH_DIST - g.distance;
    if (distToFinish <= 520 && g.finishLineY === null && g.distance < FINISH_DIST) {
      g.finishLineY = -24;
    }
    if (g.finishLineY !== null) {
      g.finishLineY += g.speed * dt;
      if (g.finishLineY > GAME_HEIGHT) g.finishLineY = null;
    }

    // ── Finish line ─────────────────────────────────────────
    if (g.distance >= FINISH_DIST) {
      g.phase = 'finish';
      setTick(t => t + 1);
      return;
    }

    // ── Schedule next frame ─────────────────────────────────
    g.rafId = requestAnimationFrame(gameLoop);
    setTick(t => t + 1);
  }, []);

  // ── start / restart ───────────────────────────────────────
  const startGame = useCallback(() => {
    const g = G.current;
    if (g.rafId) cancelAnimationFrame(g.rafId);

    g.phase              = 'playing';
    g.distance           = 0;
    g.speed              = 0;
    g.startTime          = performance.now();
    g.lastTime           = null;
    g.idCtr              = 0;
    g.carX               = CAR_START_X;
    g.coins              = 0;
    g.correctAnswers     = 0;
    g.checkpointsPassed  = 0;
    g.coins_obj          = [];
    g.obstacles          = [];
    g.lastCoinSpawnDist  = 0;
    g.lastObstacleSpawnDist = 0;
    g.coinFlashUntil     = 0;
    g.hitFlashUntil      = 0;
    g.activeQuestion     = null;
    g.roadOffset         = 0;
    g.cpLineY            = null;
    g.finishLineY        = null;
    g.keys               = {};

    g.rafId = requestAnimationFrame(gameLoop);
    setTick(t => t + 1);
  }, [gameLoop]);

  // ── resume after checkpoint ───────────────────────────────
  const resumeGame = useCallback(() => {
    const g = G.current;
    g.phase     = 'playing';
    g.lastTime  = null;
    g.startTime = performance.now() - SPEED_RAMP_MS; // keep full speed
    g.rafId     = requestAnimationFrame(gameLoop);
    setTick(t => t + 1);
  }, [gameLoop]);

  // ── answer a checkpoint question ──────────────────────────
  const answerQuestion = useCallback((optionIdx) => {
    const g = G.current;
    const q = QUESTIONS[g.activeQuestion];
    const correct = optionIdx === q.correct;
    g.cpAnswered   = true;
    g.cpWasCorrect = correct;
    if (correct) {
      g.coins += COIN_BONUS;
      g.correctAnswers += 1;
    }
    setTick(t => t + 1);
  }, []);

  // ── cleanup ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (G.current.rafId) cancelAnimationFrame(G.current.rafId);
    };
  }, []);

  // ── derive render values ──────────────────────────────────
  const g = G.current;
  const now = performance.now();
  const showCoinFlash = now < g.coinFlashUntil;
  const showHitFlash  = now < g.hitFlashUntil;
  const progressToNext = g.checkpointsPassed < NUM_CHECKPOINTS
    ? Math.min((g.distance - g.checkpointsPassed * CHECKPOINT_DIST) / CHECKPOINT_DIST, 1)
    : 1;
  const cpNear = g.cpLineY !== null; // flashing HUD warning

  // ── RENDER ───────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: #071007;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        @keyframes coinSpin {
          0%   { transform: scaleX(1); }
          50%  { transform: scaleX(0.15); }
          100% { transform: scaleX(1); }
        }
        @keyframes coinPop {
          0%   { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes neonPulse {
          0%, 100% { text-shadow: 0 0 6px #FFD700, 0 0 14px #FFD700; }
          50%       { text-shadow: 0 0 2px #FFD700; }
        }
        @keyframes slideIn {
          from { transform: translateY(-20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes exhaust {
          0%   { opacity: 0.7; height: 10px; }
          100% { opacity: 0;   height: 20px; }
        }
        @keyframes hitShake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-5px); }
          60%       { transform: translateX(5px); }
        }
        @keyframes dragHintFade {
          0%   { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes cpWarning {
          0%, 100% { opacity: 1; box-shadow: 0 0 18px #DA251D, 0 0 40px #DA251D44; }
          50%       { opacity: 0.55; box-shadow: 0 0 6px #DA251D; }
        }
        @keyframes cpTextBlink {
          0%, 100% { opacity: 1; color: #ff4040; }
          50%       { opacity: 0.3; color: #ffaa00; }
        }
      `}</style>

      {/* Scaling wrapper */}
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#071007',
        overflow: 'hidden',
      }}>
      {/* Game container */}
      <div
        ref={containerRef}
        tabIndex={0}
        onFocus={() => {}}
        style={{ ...S.gameContainer, transform: `scale(${scale})`, transformOrigin: 'center center', outline: 'none', touchAction: 'none' }}
      >

        {/* SCANLINE OVERLAY */}
        <div style={S.scanlines} />

        {/* JUNGLE GRASS — left and right shoulders with scrolling palms */}
        <JungleShoulder side="left"  distance={g.distance} />
        <JungleShoulder side="right" distance={g.distance} />

        {/* ROAD */}
        <div style={S.road}>
          <div style={{ ...S.edgeLine, left: 0 }} />
          <div style={{ ...S.edgeLine, right: 0 }} />
          <DashTrack roadOffset={g.roadOffset} />
          <DashTrack roadOffset={g.roadOffset} offsetX={-74} />
          <DashTrack roadOffset={g.roadOffset} offsetX={74} />
        </div>

        {/* CHECKPOINT APPROACH LINE */}
        {g.cpLineY !== null && (
          <CheckpointLine y={g.cpLineY} />
        )}

        {/* FINISH LINE STRIPE */}
        {g.finishLineY !== null && (
          <FinishLineStripe y={g.finishLineY} />
        )}

        {/* COIN OBJECTS */}
        {g.coins_obj.map(c => (
          <CoinObj key={c.id} x={c.x} y={c.y} />
        ))}

        {/* OBSTACLE CARS */}
        {g.obstacles.map(o => (
          <NpcCar key={o.id} x={o.x} y={o.y} type={o.type} hit={o.hit} />
        ))}

        {/* PLAYER CAR */}
        {(g.phase === 'playing' || g.phase === 'checkpoint') && (
          <PlayerCar
            x={g.carX}
            y={CAR_Y}
            moving={g.phase === 'playing'}
            shaking={showHitFlash}
          />
        )}

        {/* HIT FLASH */}
        {showHitFlash && <div style={S.hitFlash} />}

        {/* COIN COLLECT FLASH */}
        {showCoinFlash && <div style={S.coinFlashOverlay}>+1 🪙</div>}

        {/* HUD */}
        {(g.phase === 'playing' || g.phase === 'checkpoint') && (
          <Hud
            coins={g.coins}
            checkpointsPassed={g.checkpointsPassed}
            progressToNext={progressToNext}
            cpNear={cpNear}
          />
        )}

        {/* START SCREEN */}
        {g.phase === 'start' && <StartScreen onStart={startGame} />}

        {/* CHECKPOINT MODAL */}
        {g.phase === 'checkpoint' && (
          <CheckpointModal
            cpNumber={g.checkpointsPassed}
            question={QUESTIONS[g.activeQuestion]}
            answered={g.cpAnswered}
            wasCorrect={g.cpWasCorrect}
            onAnswer={answerQuestion}
            onContinue={resumeGame}
          />
        )}

        {/* FINISH SCREEN */}
        {g.phase === 'finish' && (
          <FinishScreen
            coins={g.coins}
            correct={g.correctAnswers}
            total={NUM_CHECKPOINTS}
            onRestart={startGame}
          />
        )}

        {/* STEERING SLIDER — road-width slider at the bottom for touch/mouse steering */}
        {g.phase === 'playing' && (
          <SteeringSlider gameRef={G} />
        )}
      </div>
      </div>
    </>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

/**
 * On-screen touch controls — two large transparent buttons for left/right.
 * Uses pointer events so they work with both touch and mouse.
 */
/**
 * Steering slider — a road-width track with a draggable gold thumb.
 * Pointer-capturing on the track so you can slide freely in any direction.
 * Works with both touch and mouse.
 */
function SteeringSlider({ gameRef }) {
  const trackRef   = useRef(null);
  const activePtr  = useRef(null);
  const grabOffset = useRef(0); // finger offset from thumb centre (screen px)

  const CAR_X_MIN = ROAD_LEFT + 4;
  const CAR_X_MAX = ROAD_RIGHT - CAR_WIDTH - 4;
  const THUMB_W   = 56; // design-space px

  // Convert a clientX to a clamped carX, accounting for where within the thumb
  // the user grabbed (grabOffset) and the CSS scale of the outer canvas.
  const clientToCarX = (clientX) => {
    const rect       = trackRef.current.getBoundingClientRect();
    const screenThumbW = THUMB_W * (rect.width / ROAD_WIDTH);
    const travel       = rect.width - screenThumbW;           // max thumb travel in screen px
    const posInTrack   = (clientX - rect.left) - grabOffset.current - screenThumbW / 2;
    const frac         = Math.max(0, Math.min(1, posInTrack / travel));
    return CAR_X_MIN + frac * (CAR_X_MAX - CAR_X_MIN);
  };

  const onPointerDown = (e) => {
    if (gameRef.current.phase !== 'playing') return;
    e.stopPropagation();
    trackRef.current.setPointerCapture(e.pointerId);
    activePtr.current = e.pointerId;
    // Measure how far inside the thumb the finger landed so the grab feels natural
    const rect          = trackRef.current.getBoundingClientRect();
    const screenThumbW  = THUMB_W * (rect.width / ROAD_WIDTH);
    const frac          = (gameRef.current.carX - CAR_X_MIN) / (CAR_X_MAX - CAR_X_MIN);
    const thumbLeft     = frac * (rect.width - screenThumbW);
    const thumbCentreX  = rect.left + thumbLeft + screenThumbW / 2;
    // grabOffset = how far from thumb centre the pointer landed
    grabOffset.current  = e.clientX - thumbCentreX;
    // Update immediately so the thumb doesn't jump
    gameRef.current.carX = clientToCarX(e.clientX);
  };

  const onPointerMove = (e) => {
    if (e.pointerId !== activePtr.current) return;
    if (gameRef.current.phase !== 'playing') return;
    e.stopPropagation();
    gameRef.current.carX = clientToCarX(e.clientX);
  };

  const onPointerUp = (e) => {
    if (e.pointerId === activePtr.current) {
      activePtr.current = null;
      grabOffset.current = 0;
    }
  };

  // Thumb position derived from live carX (re-evaluated each render tick via parent setTick)
  const frac     = Math.max(0, Math.min(1, (gameRef.current.carX - CAR_X_MIN) / (CAR_X_MAX - CAR_X_MIN)));
  const thumbPct = frac * 100;

  return (
    <div style={{
      position: 'absolute',
      bottom: 18,
      left: ROAD_LEFT,
      width: ROAD_WIDTH,
      zIndex: 55,
      touchAction: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    }}>
      {/* Track */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative',
          width: '100%',
          height: 52,
          background: 'rgba(6,6,18,0.82)',
          border: '2px solid rgba(255,215,0,0.4)',
          borderRadius: 12,
          cursor: 'grab',
          touchAction: 'none',
          overflow: 'hidden',
        }}
      >
        {/* Subtle fill left of thumb */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `calc(${thumbPct}% * (1 - ${THUMB_W / ROAD_WIDTH}) + ${THUMB_W / 2}px)`,
          background: 'rgba(255,215,0,0.07)',
          pointerEvents: 'none',
        }} />
        {/* Centre notch */}
        <div style={{
          position: 'absolute', left: '50%', top: '22%', bottom: '22%', width: 2,
          background: 'rgba(255,215,0,0.18)',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }} />
        {/* Thumb */}
        <div style={{
          position: 'absolute',
          left: `calc(${thumbPct}% * (1 - ${THUMB_W / ROAD_WIDTH}))`,
          top: '50%',
          transform: 'translateY(-50%)',
          width: THUMB_W,
          height: 40,
          background: 'linear-gradient(180deg, #ffe566 0%, #FFD700 50%, #c8960a 100%)',
          border: '2px solid rgba(255,255,255,0.25)',
          borderRadius: 8,
          boxShadow: '0 0 16px #FFD70099, 0 2px 8px rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          pointerEvents: 'none',
        }}>
          {/* Grip lines */}
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 3, height: 22,
              background: 'rgba(90,50,0,0.45)',
              borderRadius: 2,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Checkpoint stripe — a red/white striped banner that scrolls down the road,
 * arriving at the car's position exactly when the checkpoint fires.
 */
function CheckpointLine({ y }) {
  return (
    <div style={{
      position: 'absolute',
      left: ROAD_LEFT,
      top: y,
      width: ROAD_WIDTH,
      height: 22,
      zIndex: 16,
      pointerEvents: 'none',
      // red-and-white diagonal stripes, like a real checkpoint banner
      background: 'repeating-linear-gradient(45deg, #DA251D 0px, #DA251D 12px, #fff 12px, #fff 24px)',
      animation: 'cpWarning 0.4s ease-in-out infinite',
      boxShadow: '0 0 20px #DA251Daa',
    }}>
      {/* centre label */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: '"Press Start 2P", monospace',
        fontSize: 7, color: '#fff',
        textShadow: '0 0 6px #DA251D, 1px 1px 0 #000',
        letterSpacing: 1,
        background: 'rgba(0,0,0,0.28)',
      }}>
        ★ CHECKPOINT ★
      </div>
    </div>
  );
}

/** Checkered black-and-white finish line that scrolls toward the player */
function FinishLineStripe({ y }) {
  return (
    <div style={{
      position: 'absolute',
      left: ROAD_LEFT, width: ROAD_WIDTH,
      top: y, height: 28,
      background: 'repeating-linear-gradient(90deg, #000 0px, #000 20px, #fff 20px, #fff 40px)',
      zIndex: 16,
      pointerEvents: 'none',
      boxShadow: '0 0 22px #ffffff88, 0 0 8px #000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Double stripe for a thicker look */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 14, height: 14,
        background: 'repeating-linear-gradient(90deg, #fff 0px, #fff 20px, #000 20px, #000 40px)',
      }} />
      <div style={{
        position: 'relative', zIndex: 1,
        color: '#FFD700', fontSize: 8, fontFamily: '"Press Start 2P", monospace',
        textShadow: '0 0 6px #000, 1px 1px 0 #000, -1px -1px 0 #000',
        letterSpacing: 3, whiteSpace: 'nowrap',
      }}>
        🏁 FINISH 🏁
      </div>
    </div>
  );
}

/** Single CSS-drawn palm tree */
function PalmTree({ x, y, scale = 1, flip = false }) {
  const s = scale;
  const fronds = [
    { rot: -80, tx: 2,  ty: 3  },
    { rot: -50, tx: 4,  ty: -2 },
    { rot: -15, tx: 7,  ty: -5 },
    { rot:  20, tx: 9,  ty: -4 },
    { rot:  55, tx: 8,  ty:  0 },
    { rot:  85, tx: 4,  ty:  4 },
  ];
  return (
    <div style={{
      position: 'absolute', left: x, top: y,
      transform: flip ? 'scaleX(-1)' : 'none',
      zIndex: 3, pointerEvents: 'none',
    }}>
      {/* trunk — slightly curved via border-radius */}
      <div style={{
        position: 'absolute', left: 5 * s, top: 10 * s,
        width: 7 * s, height: 44 * s,
        background: 'linear-gradient(to right, #3b2008, #6b3a12, #3b2008)',
        borderRadius: `${3*s}px ${5*s}px ${4*s}px ${3*s}px`,
        transform: 'rotate(-4deg)',
      }} />
      {/* fronds */}
      {fronds.map((f, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: (2 + f.tx) * s, top: (f.ty + 4) * s,
          width: 28 * s, height: 9 * s,
          background: `linear-gradient(to right, #1c6b1c, ${i % 2 === 0 ? '#2faa2f' : '#2a8a2a'})`,
          borderRadius: '50% 90% 50% 10%',
          transform: `rotate(${f.rot}deg)`,
          transformOrigin: '4% 50%',
          opacity: 0.92,
        }} />
      ))}
      {/* bunch of coconuts */}
      <div style={{
        position: 'absolute', left: 4 * s, top: 8 * s,
        width: 10 * s, height: 8 * s,
        background: '#7a4e28',
        borderRadius: '50%',
        boxShadow: `${4*s}px ${2*s}px 0 #7a4e28, ${-2*s}px ${3*s}px 0 #5c3818`,
        opacity: 0.85,
      }} />
    </div>
  );
}

const TREE_REPEAT = 210; // px — vertical spacing between repeating trees

/** Jungle shoulder strip with scrolling palm trees */
function JungleShoulder({ side, distance }) {
  const isLeft = side === 'left';
  const scrollOffset = distance % TREE_REPEAT;

  // Each config: x position within shoulder, phase offset (staggered start)
  const treeConfigs = isLeft
    ? [{ x: 4,  phase: 0   }, { x: 36, phase: 105 }, { x: 18, phase: 170 }]
    : [{ x: 20, phase: 40  }, { x: 50, phase: 130 }, { x: 8,  phase: 80  }];

  const trees = [];
  treeConfigs.forEach((cfg, ti) => {
    for (let i = 0; i <= 4; i++) {
      const y = cfg.phase + i * TREE_REPEAT - scrollOffset;
      if (y > -65 && y < GAME_HEIGHT + 10) {
        trees.push({ key: `${ti}-${i}`, x: cfg.x, y, scale: 0.65 + (ti % 2) * 0.1 });
      }
    }
  });

  return (
    <div style={{
      position: 'absolute',
      top: 0, bottom: 0,
      ...(isLeft ? { left: 0 } : { right: 0 }),
      width: ROAD_LEFT,
      background: [
        'repeating-linear-gradient(160deg, #0b2a0b 0px, #122a12 6px, #0a220a 12px, #162c16 20px)',
        'linear-gradient(180deg, #071a07 0%, #0e260e 40%, #0a1e0a 100%)',
      ].join(', '),
      zIndex: 1,
      overflow: 'hidden',
    }}>
      {/* faint ground texture line near road edge */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0,
        [isLeft ? 'right' : 'left']: 0,
        width: 6,
        background: 'rgba(255,255,255,0.04)',
      }} />
      {trees.map(t => (
        <PalmTree key={t.key} x={t.x} y={t.y} scale={t.scale} flip={!isLeft} />
      ))}
    </div>
  );
}

/** Scrolling dashed lane line */
function DashTrack({ roadOffset, offsetX = 0 }) {
  const count = Math.ceil(GAME_HEIGHT / DASH_PERIOD) + 2;
  return (
    <div style={{
      position: 'absolute', top: 0, left: '50%',
      transform: `translateX(calc(-50% + ${offsetX}px))`,
      width: 4, height: '100%',
      overflow: 'hidden', pointerEvents: 'none',
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          position: 'absolute', left: 0,
          top: -DASH_PERIOD / 2 + i * DASH_PERIOD + (roadOffset % DASH_PERIOD),
          width: 4,
          height: Math.round(DASH_PERIOD * 0.55),
          background: '#e8e8e8',
          opacity: 0.55,
          borderRadius: 2,
        }} />
      ))}
    </div>
  );
}

/** Player car — CSS-only pixel art */
function PlayerCar({ x, y, moving, shaking }) {
  return (
    <div style={{
      position: 'absolute',
      left: x, top: y,
      width: CAR_WIDTH, height: CAR_HEIGHT,
      transition: 'left 0.04s linear',
      zIndex: 20,
      animation: shaking ? 'hitShake 0.3s ease-in-out' : 'none',
    }}>
      {/* Body */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, #e3f2fd 0%, #42a5f5 28%, #1565c0 100%)',
        borderRadius: '8px 8px 4px 4px',
        border: '2px solid #0d47a1',
      }} />
      {/* Windshield */}
      <div style={{
        position: 'absolute', top: 6, left: 6, right: 6, height: 14,
        background: 'rgba(190,240,255,0.85)',
        border: '1.5px solid #0d47a1', borderRadius: 3,
      }} />
      {/* Hood stripe L */}
      <div style={{
        position: 'absolute', top: 22, left: 5, width: 5, bottom: 12,
        background: '#FFD700', borderRadius: 2,
      }} />
      {/* Hood stripe R */}
      <div style={{
        position: 'absolute', top: 22, right: 5, width: 5, bottom: 12,
        background: '#FFD700', borderRadius: 2,
      }} />
      {/* Rear window */}
      <div style={{
        position: 'absolute', bottom: 14, left: 7, right: 7, height: 10,
        background: 'rgba(190,240,255,0.6)',
        border: '1.5px solid #0d47a1', borderRadius: 2,
      }} />
      {/* Front wheels */}
      <div style={{ position: 'absolute', top: 8, left: -7, width: 8, height: 14, background: '#111', borderRadius: 3, border: '1.5px solid #444' }} />
      <div style={{ position: 'absolute', top: 8, right: -7, width: 8, height: 14, background: '#111', borderRadius: 3, border: '1.5px solid #444' }} />
      {/* Rear wheels */}
      <div style={{ position: 'absolute', bottom: 10, left: -7, width: 8, height: 16, background: '#111', borderRadius: 3, border: '1.5px solid #444' }} />
      <div style={{ position: 'absolute', bottom: 10, right: -7, width: 8, height: 16, background: '#111', borderRadius: 3, border: '1.5px solid #444' }} />
      {/* Headlights */}
      <div style={{ position: 'absolute', top: 2, left: 5, width: 9, height: 4, background: '#fffde7', borderRadius: 2, boxShadow: '0 0 6px #fff' }} />
      <div style={{ position: 'absolute', top: 2, right: 5, width: 9, height: 4, background: '#fffde7', borderRadius: 2, boxShadow: '0 0 6px #fff' }} />
      {/* Rear lights */}
      <div style={{ position: 'absolute', bottom: 2, left: 5, width: 8, height: 4, background: '#ff1744', borderRadius: 2, boxShadow: '0 0 4px #ff1744' }} />
      <div style={{ position: 'absolute', bottom: 2, right: 5, width: 8, height: 4, background: '#ff1744', borderRadius: 2, boxShadow: '0 0 4px #ff1744' }} />
      {/* Exhaust smoke */}
      {moving && <>
        <div style={{
          position: 'absolute', bottom: -10, left: 9, width: 6, height: 10,
          background: 'rgba(180,180,200,0.5)', borderRadius: '0 0 4px 4px',
          animation: 'exhaust 0.35s ease-out infinite',
        }} />
        <div style={{
          position: 'absolute', bottom: -10, right: 9, width: 6, height: 10,
          background: 'rgba(180,180,200,0.5)', borderRadius: '0 0 4px 4px',
          animation: 'exhaust 0.35s ease-out infinite 0.18s',
        }} />
      </>}
    </div>
  );
}

/** NPC obstacle car */
const NPC_COLORS = [
  { top: '#c62828', bot: '#b71c1c', stripe: '#ff8a80' },
  { top: '#2e7d32', bot: '#1b5e20', stripe: '#a5d6a7' },
  { top: '#6a1b9a', bot: '#4a148c', stripe: '#ce93d8' },
];
function NpcCar({ x, y, type, hit }) {
  const col = NPC_COLORS[type % NPC_COLORS.length];
  return (
    <div style={{
      position: 'absolute', left: x, top: y,
      width: OBSTACLE_W, height: OBSTACLE_H,
      zIndex: 15, opacity: hit ? 0.35 : 1,
      filter: hit ? 'brightness(2.5)' : 'none',
      transition: 'opacity 0.3s',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, ${col.top} 0%, ${col.bot} 100%)`,
        borderRadius: '4px 4px 8px 8px',
        border: '2px solid rgba(0,0,0,0.45)',
      }} />
      <div style={{ position: 'absolute', bottom: 6, left: 6, right: 6, height: 14, background: 'rgba(190,240,255,0.75)', border: '1.5px solid rgba(0,0,0,0.4)', borderRadius: 3 }} />
      <div style={{ position: 'absolute', top: 14, left: 5, width: 5, bottom: 12, background: col.stripe, borderRadius: 2 }} />
      <div style={{ position: 'absolute', top: 14, right: 5, width: 5, bottom: 12, background: col.stripe, borderRadius: 2 }} />
      <div style={{ position: 'absolute', top: 2, left: 5, width: 9, height: 4, background: '#ff1744', borderRadius: 2, boxShadow: '0 0 5px #ff1744' }} />
      <div style={{ position: 'absolute', top: 2, right: 5, width: 9, height: 4, background: '#ff1744', borderRadius: 2, boxShadow: '0 0 5px #ff1744' }} />
      <div style={{ position: 'absolute', top: 8, left: -6, width: 7, height: 13, background: '#111', borderRadius: 2 }} />
      <div style={{ position: 'absolute', top: 8, right: -6, width: 7, height: 13, background: '#111', borderRadius: 2 }} />
      <div style={{ position: 'absolute', bottom: 8, left: -6, width: 7, height: 15, background: '#111', borderRadius: 2 }} />
      <div style={{ position: 'absolute', bottom: 8, right: -6, width: 7, height: 15, background: '#111', borderRadius: 2 }} />
    </div>
  );
}

/** Gold coin object */
function CoinObj({ x, y }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y,
      width: COIN_SIZE, height: COIN_SIZE,
      borderRadius: '50%',
      background: 'radial-gradient(circle at 35% 35%, #fffde7, #FFD700 55%, #f57f17)',
      border: '2px solid #b8860b',
      boxShadow: '0 0 8px #FFD700, inset 0 0 4px #FFD700',
      zIndex: 12,
      animation: 'coinSpin 0.85s linear infinite',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: 'bold', color: '#7a5200',
      fontFamily: '"Press Start 2P", monospace',
    }}>
      $
    </div>
  );
}

/** HUD — always visible during gameplay */
function Hud({ coins, checkpointsPassed, progressToNext, cpNear }) {
  const barW = Math.round(Math.max(0, Math.min(1, progressToNext)) * 158);
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0,
      padding: '10px 12px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      zIndex: 50, pointerEvents: 'none',
      fontFamily: '"Press Start 2P", monospace',
    }}>
      {/* Left: coin count */}
      <div style={hudPanel}>
        <div style={{ color: '#FFD700', fontSize: 8, marginBottom: 4, animation: 'neonPulse 2s infinite' }}>
          🪙 COINS
        </div>
        <div style={{ color: '#fff', fontSize: 14 }}>
          {String(coins).padStart(4, '0')}
        </div>
      </div>

      {/* Right: checkpoint + progress bar */}
      <div style={{ ...hudPanel, alignItems: 'flex-end' }}>
        <div style={{ color: cpNear ? undefined : '#39ff14', fontSize: 7, marginBottom: 4, animation: cpNear ? 'cpTextBlink 0.5s infinite' : undefined }}>
          {cpNear ? '⚠ CHECKPOINT!' : 'CHECKPOINT'}
        </div>
        <div style={{ color: '#fff', fontSize: 12, marginBottom: 6 }}>
          {checkpointsPassed}/{NUM_CHECKPOINTS}
        </div>
        <div style={{ width: 160, height: 8, background: '#222', border: '2px solid #444', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            width: barW, height: '100%',
            background: cpNear
              ? 'linear-gradient(90deg, #DA251D, #ff6b35)'
              : 'linear-gradient(90deg, #39ff14, #FFD700)',
            transition: 'width 0.12s linear',
          }} />
        </div>
      </div>
    </div>
  );
}

const hudPanel = {
  background: 'rgba(4,12,4,0.88)',
  border: '2px solid #DA251D',
  borderRadius: 4,
  padding: '6px 10px',
  display: 'flex',
  flexDirection: 'column',
};

/** START SCREEN */
function StartScreen({ onStart }) {
  return (
    <div style={overlayBg}>
      <div style={modalBox}>
        {/* Vietnam flag star */}
        <div style={{ fontSize: 28, marginBottom: 6, filter: 'drop-shadow(0 0 8px #DA251D)' }}>⭐</div>
        <div style={{ color: '#DA251D', fontSize: 11, marginBottom: 4, animation: 'neonPulse 1.5s infinite', textAlign: 'center', lineHeight: 1.7,
          textShadow: '0 0 10px #DA251D' }}>
          UBER VIETNAM
        </div>
        <div style={{ color: '#FFD700', fontSize: 14, marginBottom: 6, textAlign: 'center' }}>
          COIN RACER
        </div>
        <div style={{ width: '100%', height: 2, background: '#DA251D', boxShadow: '0 0 8px #DA251D', marginBottom: 20 }} />
        <div style={{ color: '#aaa', fontSize: 7, marginBottom: 8, textAlign: 'center', lineHeight: 2.2 }}>
          ← → ARROW KEYS or A / D
        </div>
        <div style={{ color: '#888', fontSize: 7, marginBottom: 22, textAlign: 'center', lineHeight: 2.2, whiteSpace: 'pre-line' }}>
          {'COLLECT 🪙 COINS\nDODGE TRAFFIC\nANSWER TRIVIA AT\nEACH CHECKPOINT!'}
        </div>
        <PixelButton onClick={onStart} color="#DA251D">▶ START RACE</PixelButton>
      </div>
    </div>
  );
}

/** CHECKPOINT MODAL */
function CheckpointModal({ cpNumber, question, answered, wasCorrect, onAnswer, onContinue }) {
  const LABELS = ['A', 'B', 'C', 'D'];
  return (
    <div style={overlayBg}>
      <div style={{ ...modalBox, width: 410, animation: 'slideIn 0.3s ease-out' }}>
        {/* Header */}
        <div style={{ color: '#DA251D', fontSize: 9, textAlign: 'center', marginBottom: 4,
          textShadow: '0 0 10px #DA251D', animation: 'cpTextBlink 1s infinite' }}>
          ★ CHECKPOINT {cpNumber}/{NUM_CHECKPOINTS} ★
        </div>
        <div style={{ width: '100%', height: 2, background: '#DA251D', boxShadow: '0 0 8px #DA251D', marginBottom: 16 }} />

        {/* Question */}
        <div style={{ color: '#fff', fontSize: 8, textAlign: 'center', lineHeight: 2.2, marginBottom: 16, whiteSpace: 'pre-wrap' }}>
          {question.question}
        </div>

        {/* Answer options */}
        {!answered && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%', marginBottom: 10 }}>
            {question.options.map((opt, i) => (
              <button key={i} onClick={() => onAnswer(i)} style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 7, padding: '10px 8px',
                background: '#0d0d1e', color: '#ddd',
                border: '2px solid #4a90d9',
                borderRadius: 4, cursor: 'pointer',
                lineHeight: 1.9, textAlign: 'left',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#0a1a40'; e.currentTarget.style.borderColor = '#FFD700'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#0d0d1e'; e.currentTarget.style.borderColor = '#4a90d9'; e.currentTarget.style.color = '#ddd'; }}
              >
                <span style={{ color: '#FFD700' }}>{LABELS[i]}.</span> {opt}
              </button>
            ))}
          </div>
        )}

        {/* Result banner */}
        {answered && (
          <div style={{
            textAlign: 'center', fontSize: 10, marginBottom: 20, lineHeight: 2.2,
            color: wasCorrect ? '#39ff14' : '#ff4444',
            animation: 'blink 0.5s ease-in-out 4',
            padding: '12px 0',
            whiteSpace: 'pre-line',
          }}>
            {wasCorrect
              ? `✓ CORRECT!\n+${COIN_BONUS} COINS AWARDED!`
              : '✗ WRONG!\nNO BONUS COINS'}
          </div>
        )}

        {answered && (
          <PixelButton onClick={onContinue} color="#39ff14">▶ CONTINUE RACING</PixelButton>
        )}
      </div>
    </div>
  );
}

/** FINISH SCREEN */
function FinishScreen({ coins, correct, total, onRestart }) {
  const grade = correct >= 7 ? 'S' : correct >= 5 ? 'A' : correct >= 3 ? 'B' : 'C';
  const gradeColor = { S: '#FFD700', A: '#39ff14', B: '#4a90d9', C: '#ff9800' }[grade];
  const cpBonus = correct * COIN_BONUS;

  return (
    <div style={overlayBg}>
      <div style={{ ...modalBox, width: 400, animation: 'slideIn 0.4s ease-out' }}>
        <div style={{ color: '#FFD700', fontSize: 15, textAlign: 'center', marginBottom: 4, animation: 'neonPulse 1.1s infinite' }}>
          FINISH!
        </div>
        <div style={{ color: '#DA251D', fontSize: 8, textAlign: 'center', marginBottom: 14 }}>
          RACE COMPLETE
        </div>
        <div style={{ width: '100%', height: 2, background: '#DA251D', boxShadow: '0 0 8px #DA251D', marginBottom: 18 }} />

        <StatRow label="TOTAL COINS"   value={`🪙 ${coins}`}        valueColor="#FFD700" valueFontSize={12} />
        <StatRow label="TRIVIA SCORE"  value={`${correct} / ${total}`} valueColor="#fff" />
        <StatRow label="CP BONUS"      value={`+${cpBonus} 🪙`}       valueColor="#39ff14" />

        <div style={{ width: '100%', height: 1, background: '#333', margin: '12px 0' }} />

        <StatRow label="FINAL GRADE" value={grade} valueColor={gradeColor} valueFontSize={22} extra="animation: neonPulse 1s infinite" />

        <div style={{ marginTop: 20, width: '100%' }}>
          <PixelButton onClick={onRestart} color="#FFD700">↺ PLAY AGAIN</PixelButton>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, valueColor = '#fff', valueFontSize = 10 }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      width: '100%', marginBottom: 10,
      fontFamily: '"Press Start 2P", monospace',
    }}>
      <span style={{ color: '#777', fontSize: 7 }}>{label}</span>
      <span style={{ color: valueColor, fontSize: valueFontSize }}>{value}</span>
    </div>
  );
}

/** Reusable pixel-art button */
function PixelButton({ onClick, color = '#FFD700', children }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: '"Press Start 2P", monospace',
      fontSize: 9, padding: '12px 18px',
      background: 'transparent', color,
      border: `3px solid ${color}`,
      borderRadius: 4, cursor: 'pointer',
      letterSpacing: 1,
      boxShadow: `0 0 14px ${color}55`,
      display: 'block', width: '100%', textAlign: 'center',
      lineHeight: 1.6,
    }}
    onMouseEnter={e => {
      e.currentTarget.style.background = `${color}1a`;
      e.currentTarget.style.boxShadow = `0 0 22px ${color}aa`;
    }}
    onMouseLeave={e => {
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.boxShadow = `0 0 14px ${color}55`;
    }}
    >
      {children}
    </button>
  );
}

// ============================================================
// SHARED STYLE OBJECTS
// ============================================================
const overlayBg = {
  position: 'absolute', inset: 0,
  background: 'rgba(2, 10, 2, 0.92)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 100,
  fontFamily: '"Press Start 2P", monospace',
};

const modalBox = {
  background: '#060f06',
  border: '3px solid #DA251D',
  borderRadius: 8,
  padding: '24px 22px',
  width: 360,
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  boxShadow: '0 0 32px #DA251D55, 0 0 80px #00000099',
  fontFamily: '"Press Start 2P", monospace',
};

const S = {
  gameContainer: {
    position: 'relative',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    overflow: 'hidden',
    // Vietnam night: deep crimson-tinged sky fades down into dense jungle
    background: [
      // sky glow at very top (distant city / dawn haze — Vietnam red tint)
      'radial-gradient(ellipse 300px 140px at 50% -10px, rgba(100,12,12,0.55) 0%, transparent 70%)',
      // vertical atmosphere gradient
      'linear-gradient(180deg, #0e0812 0%, #0c1a0c 18%, #0a160a 55%, #071207 100%)',
    ].join(', '),
    fontFamily: '"Press Start 2P", monospace',
    userSelect: 'none',
    flexShrink: 0,
  },

  scanlines: {
    position: 'absolute', inset: 0,
    background: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 4px)',
    pointerEvents: 'none', zIndex: 200,
  },

  // Jungle grass shoulder — left
  grassLeft: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0,
    width: ROAD_LEFT,
    // layered jungle texture: dark green with subtle lighter streaks
    background: 'repeating-linear-gradient(170deg, #0e2a0e 0px, #162e16 8px, #0b230b 16px, #1a3a1a 24px)',
    zIndex: 1,
  },

  // Jungle grass shoulder — right
  grassRight: {
    position: 'absolute',
    top: 0, bottom: 0, right: 0,
    width: GAME_WIDTH - ROAD_RIGHT,
    background: 'repeating-linear-gradient(170deg, #0e2a0e 0px, #162e16 8px, #0b230b 16px, #1a3a1a 24px)',
    zIndex: 1,
  },

  road: {
    position: 'absolute',
    top: 0, bottom: 0,
    left: ROAD_LEFT, width: ROAD_WIDTH,
    // dark asphalt grey — no blue tint
    background: 'linear-gradient(180deg, #3a3a3a 0%, #2e2e2e 50%, #323232 100%)',
    overflow: 'hidden',
    zIndex: 2,
  },

  edgeLine: {
    position: 'absolute', top: 0, bottom: 0, width: 5,
    background: '#ffffff',
    opacity: 0.85,
    boxShadow: '0 0 4px rgba(255,255,255,0.4)',
  },

  hitFlash: {
    position: 'absolute', inset: 0,
    background: 'rgba(218, 37, 29, 0.40)',
    zIndex: 60, pointerEvents: 'none',
    animation: 'blink 0.1s linear 5',
  },

  coinFlashOverlay: {
    position: 'absolute',
    top: '42%', left: '50%',
    color: '#FFD700', fontSize: 14,
    fontFamily: '"Press Start 2P", monospace',
    zIndex: 65, pointerEvents: 'none',
    animation: 'coinPop 0.45s ease-out forwards',
    whiteSpace: 'nowrap',
  },
};
