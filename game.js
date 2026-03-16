const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const hud = {
  lives: document.getElementById("lives"),
  enemies: document.getElementById("enemies"),
  score: document.getElementById("score"),
  level: document.getElementById("level"),
  message: document.getElementById("message"),
};

const TILE = 32;
const MAP_COLS = 26;
const MAP_ROWS = 26;
const PLAYER_SPEED = 2.4;
const ENEMY_SPEED = 1.45;
const BULLET_SPEED = 6.2;
const PLAYER_FIRE_COOLDOWN = 320;
const ENEMY_FIRE_CHANCE = 0.012;

const DIRS = {
  up: { x: 0, y: -1, angle: -Math.PI / 2 },
  down: { x: 0, y: 1, angle: Math.PI / 2 },
  left: { x: -1, y: 0, angle: Math.PI },
  right: { x: 1, y: 0, angle: 0 },
};

const COLORS = {
  brick: "#9f5935",
  steel: "#94a0b8",
  water: "#225d8a",
  forest: "#2d6a36",
  base: "#ffcf5a",
  player: "#ffd86b",
  enemy: "#ff7a59",
  bullet: "#fff1d6",
};

const mapTemplate = [
  "..........................",
  ".####......@@......####...",
  ".#..#................#.#..",
  ".####..~~~~....~~~~..###..",
  "........~~~~....~~~~......",
  "...@@................@@...",
  "..####....######....####..",
  "..........................",
  "..~~~~....@@..@@....~~~~..",
  "..~~~~..............~~~~..",
  "..........####............",
  ".##....................##.",
  ".##....@@........@@....##.",
  "......####......####......",
  "..........................",
  "..####..............####..",
  "..#..#....~~~~~~....#..#..",
  "..####....~~~~~~....####..",
  "..........................",
  "....@@....######....@@....",
  "..............####........",
  "..####................##..",
  "..####....@@....@@....##..",
  "..........####............",
  ".........##BB##...........",
  ".........##HH##...........",
];

const state = {
  keys: new Set(),
  walls: [],
  water: [],
  forest: [],
  bullets: [],
  enemies: [],
  player: null,
  base: null,
  score: 0,
  lives: 3,
  level: 1,
  enemyQueue: 12,
  gameOver: false,
  victory: false,
  lastTime: 0,
  spawnTimer: 0,
};

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function getTileRect(col, row) {
  return { x: col * TILE, y: row * TILE, w: TILE, h: TILE };
}

function createTank(x, y, color, isPlayer) {
  return {
    x,
    y,
    w: TILE,
    h: TILE,
    dir: "up",
    speed: isPlayer ? PLAYER_SPEED : ENEMY_SPEED,
    color,
    isPlayer,
    cooldown: 0,
    aiTimer: 0,
    stuckTime: 0,
    alive: true,
  };
}

function rectBlockedByTerrain(rect) {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.w > canvas.width ||
    rect.y + rect.h > canvas.height
  ) {
    return true;
  }

  if (state.walls.some((wall) => rectsOverlap(rect, wall))) {
    return true;
  }

  if (state.water.some((tile) => rectsOverlap(rect, tile))) {
    return true;
  }

  return state.base ? rectsOverlap(rect, state.base) : false;
}

function rectBlockedByTanks(rect, ignoreTank = null) {
  const tanks = [state.player, ...state.enemies].filter(Boolean);
  return tanks.some(
    (tank) => tank !== ignoreTank && tank.alive && rectsOverlap(rect, tank),
  );
}

function findSpawnPosition(preferredPositions, ignoreTank = null) {
  const maxRadius = Math.max(MAP_COLS, MAP_ROWS);

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (const preferred of preferredPositions) {
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) {
            continue;
          }

          const candidate = {
            x: preferred.x + offsetX * TILE,
            y: preferred.y + offsetY * TILE,
            w: TILE,
            h: TILE,
          };

          if (rectBlockedByTerrain(candidate) || rectBlockedByTanks(candidate, ignoreTank)) {
            continue;
          }

          return { x: candidate.x, y: candidate.y };
        }
      }
    }
  }

  return null;
}

function spawnTank(preferredPositions, color, isPlayer, fallbackMessage) {
  const safePosition = findSpawnPosition(preferredPositions);

  if (!safePosition) {
    const spawn = { x: 0, y: 0 };
    const tank = createTank(spawn.x, spawn.y, color, isPlayer);
    tank.alive = false;

    if (fallbackMessage) {
      updateHud(fallbackMessage);
    }

    return tank;
  }

  const tank = createTank(safePosition.x, safePosition.y, color, isPlayer);

  if (fallbackMessage && (safePosition.x !== preferredPositions[0].x || safePosition.y !== preferredPositions[0].y)) {
    updateHud(fallbackMessage);
  }

  return tank;
}

function resetWorld() {
  state.walls = [];
  state.water = [];
  state.forest = [];
  state.bullets = [];
  state.enemies = [];
  state.score = 0;
  state.lives = 3;
  state.level = 1;
  state.enemyQueue = 12;
  state.gameOver = false;
  state.victory = false;
  state.spawnTimer = 0;
  loadMap();
  state.player = spawnTank(
    [
      { x: TILE * 12, y: TILE * 21 },
      { x: TILE * 11, y: TILE * 21 },
      { x: TILE * 13, y: TILE * 21 },
    ],
    COLORS.player,
    true,
    "出生点受阻，已使用后备位置",
  );
  updateHud("准备战斗");
}

function loadMap() {
  state.base = null;

  for (let row = 0; row < mapTemplate.length; row += 1) {
    for (let col = 0; col < mapTemplate[row].length; col += 1) {
      const cell = mapTemplate[row][col];
      const rect = getTileRect(col, row);

      if (cell === "#") {
        state.walls.push({ ...rect, type: "brick", hp: 1 });
      } else if (cell === "@") {
        state.walls.push({ ...rect, type: "steel", hp: 99 });
      } else if (cell === "~") {
        state.water.push(rect);
      } else if (cell === "H") {
        state.forest.push(rect);
      } else if (cell === "B") {
        state.base = { ...rect, alive: true };
      }
    }
  }
}

function updateHud(message) {
  hud.lives.textContent = String(state.lives);
  hud.enemies.textContent = String(state.enemyQueue + state.enemies.length);
  hud.score.textContent = String(state.score);
  hud.level.textContent = String(state.level);
  hud.message.textContent = message;
}

function restartPlayer() {
  state.player = spawnTank(
    [
      { x: TILE * 12, y: TILE * 21 },
      { x: TILE * 11, y: TILE * 21 },
      { x: TILE * 13, y: TILE * 21 },
    ],
    COLORS.player,
    true,
    "重生点受阻，已切换到安全位置",
  );
}

function spawnEnemy() {
  if (state.enemyQueue <= 0 || state.enemies.length >= 4) {
    return;
  }

  const spawnGroups = [
    [{ x: TILE, y: 0 }, { x: TILE, y: TILE }],
    [{ x: TILE * 12, y: 0 }, { x: TILE * 12, y: TILE }],
    [{ x: TILE * 24, y: 0 }, { x: TILE * 24, y: TILE }],
  ];
  const preferredPositions =
    spawnGroups[Math.floor(Math.random() * spawnGroups.length)];
  const spawn = findSpawnPosition(preferredPositions);

  if (!spawn) {
    return;
  }

  const candidate = createTank(spawn.x, spawn.y, COLORS.enemy, false);
  candidate.dir = "down";

  const blocked = rectBlockedByTerrain(candidate) || rectBlockedByTanks(candidate);

  if (!blocked) {
    state.enemies.push(candidate);
    state.enemyQueue -= 1;
  }
}

function fireBullet(tank) {
  if (tank.cooldown > 0 || state.gameOver) {
    return;
  }

  const dir = DIRS[tank.dir];
  const size = 8;
  state.bullets.push({
    x: tank.x + tank.w / 2 - size / 2 + dir.x * 14,
    y: tank.y + tank.h / 2 - size / 2 + dir.y * 14,
    w: size,
    h: size,
    dx: dir.x * BULLET_SPEED,
    dy: dir.y * BULLET_SPEED,
    fromPlayer: tank.isPlayer,
    alive: true,
  });
  tank.cooldown = tank.isPlayer ? PLAYER_FIRE_COOLDOWN : 900;
}

function tankBlocked(rect, tank) {
  if (rectBlockedByTerrain(rect)) {
    return true;
  }

  const others = tank.isPlayer ? state.enemies : [state.player, ...state.enemies];
  return others.some((other) => other !== tank && other.alive && rectsOverlap(rect, other));
}

function tryMoveTank(tank, dt, dirName) {
  tank.dir = dirName;
  const dir = DIRS[dirName];
  const next = {
    x: tank.x + dir.x * tank.speed * dt,
    y: tank.y + dir.y * tank.speed * dt,
    w: tank.w,
    h: tank.h,
  };

  if (!tankBlocked(next, tank)) {
    tank.x = next.x;
    tank.y = next.y;
    tank.stuckTime = 0;
    return true;
  }

  tank.stuckTime += dt;
  return false;
}

function handlePlayer(dt) {
  const player = state.player;
  if (!player || !player.alive) {
    return;
  }

  player.cooldown = Math.max(0, player.cooldown - dt * 16.67);

  if (state.keys.has("ArrowUp")) {
    tryMoveTank(player, dt, "up");
  } else if (state.keys.has("ArrowDown")) {
    tryMoveTank(player, dt, "down");
  } else if (state.keys.has("ArrowLeft")) {
    tryMoveTank(player, dt, "left");
  } else if (state.keys.has("ArrowRight")) {
    tryMoveTank(player, dt, "right");
  }
}

function updateEnemyAI(enemy, dt) {
  enemy.cooldown = Math.max(0, enemy.cooldown - dt * 16.67);
  enemy.aiTimer -= dt;

  if (enemy.aiTimer <= 0) {
    const options = ["down", "left", "right", "up"];
    enemy.dir = options[Math.floor(Math.random() * options.length)];
    enemy.aiTimer = 28 + Math.random() * 45;
  }

  const moved = tryMoveTank(enemy, dt, enemy.dir);
  if (!moved && enemy.stuckTime > 12) {
    enemy.aiTimer = 0;
  }

  if (Math.random() < ENEMY_FIRE_CHANCE * dt) {
    fireBullet(enemy);
  }
}

function damageWall(wall) {
  if (wall.type === "brick") {
    wall.hp -= 1;
  }
}

function updateBullets(dt) {
  for (const bullet of state.bullets) {
    if (!bullet.alive) {
      continue;
    }

    bullet.x += bullet.dx * dt;
    bullet.y += bullet.dy * dt;

    if (
      bullet.x < 0 ||
      bullet.y < 0 ||
      bullet.x + bullet.w > canvas.width ||
      bullet.y + bullet.h > canvas.height
    ) {
      bullet.alive = false;
      continue;
    }

    const wall = state.walls.find((item) => rectsOverlap(bullet, item));
    if (wall) {
      damageWall(wall);
      bullet.alive = false;
      continue;
    }

    if (state.base && state.base.alive && rectsOverlap(bullet, state.base)) {
      state.base.alive = false;
      bullet.alive = false;
      state.gameOver = true;
      updateHud("基地被摧毁，任务失败");
      continue;
    }

    if (bullet.fromPlayer) {
      const enemy = state.enemies.find((item) => item.alive && rectsOverlap(bullet, item));
      if (enemy) {
        enemy.alive = false;
        bullet.alive = false;
        state.score += 100;
        updateHud("命中敌军");
        continue;
      }
    } else if (state.player && state.player.alive && rectsOverlap(bullet, state.player)) {
      bullet.alive = false;
      state.lives -= 1;

      if (state.lives <= 0) {
        state.player.alive = false;
        state.gameOver = true;
        updateHud("坦克全毁，战斗结束");
      } else {
        restartPlayer();
        updateHud("你被击中了");
      }
    }
  }

  for (let i = 0; i < state.bullets.length; i += 1) {
    const a = state.bullets[i];
    if (!a.alive) {
      continue;
    }

    for (let j = i + 1; j < state.bullets.length; j += 1) {
      const b = state.bullets[j];
      if (b.alive && a.fromPlayer !== b.fromPlayer && rectsOverlap(a, b)) {
        a.alive = false;
        b.alive = false;
      }
    }
  }

  state.walls = state.walls.filter((wall) => wall.hp > 0);
  state.bullets = state.bullets.filter((bullet) => bullet.alive);
  state.enemies = state.enemies.filter((enemy) => enemy.alive);

  if (!state.gameOver && state.enemyQueue === 0 && state.enemies.length === 0) {
    state.victory = true;
    state.gameOver = true;
    updateHud("胜利，基地安全");
  }
}

function drawTile(rect, color) {
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

function drawTank(tank) {
  ctx.save();
  ctx.translate(tank.x + tank.w / 2, tank.y + tank.h / 2);
  ctx.rotate(DIRS[tank.dir].angle);

  ctx.fillStyle = tank.color;
  ctx.fillRect(-12, -16, 10, 32);
  ctx.fillRect(2, -16, 10, 32);
  ctx.fillRect(-10, -10, 20, 20);
  ctx.fillStyle = "#3d2b1f";
  ctx.fillRect(-4, -18, 8, 18);
  ctx.fillStyle = tank.color;
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBase() {
  if (!state.base) {
    return;
  }

  const base = state.base;
  ctx.fillStyle = base.alive ? COLORS.base : COLORS.danger;
  ctx.fillRect(base.x, base.y, base.w, base.h);
  ctx.fillStyle = "#4d2f12";
  ctx.fillRect(base.x + 6, base.y + 6, base.w - 12, base.h - 12);
  ctx.fillStyle = "#fff2c5";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("★", base.x + base.w / 2, base.y + 22);
}

function drawOverlay() {
  if (!state.gameOver) {
    return;
  }

  ctx.fillStyle = "rgba(8, 7, 6, 0.55)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff2d8";
  ctx.textAlign = "center";
  ctx.font = "bold 52px sans-serif";
  ctx.fillText(state.victory ? "YOU WIN" : "GAME OVER", canvas.width / 2, 330);
  ctx.font = "24px sans-serif";
  ctx.fillText("按 R 重新开始", canvas.width / 2, 382);
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  state.water.forEach((tile) => drawTile(tile, COLORS.water));
  state.walls.forEach((wall) =>
    drawTile(wall, wall.type === "brick" ? COLORS.brick : COLORS.steel),
  );
  drawBase();

  if (state.player && state.player.alive) {
    drawTank(state.player);
  }

  state.enemies.forEach(drawTank);

  state.forest.forEach((tile) => {
    ctx.fillStyle = COLORS.forest;
    ctx.fillRect(tile.x + 5, tile.y + 5, tile.w - 10, tile.h - 10);
  });

  ctx.fillStyle = COLORS.bullet;
  state.bullets.forEach((bullet) => {
    ctx.fillRect(bullet.x, bullet.y, bullet.w, bullet.h);
  });

  drawOverlay();
}

function gameLoop(timestamp) {
  if (!state.lastTime) {
    state.lastTime = timestamp;
  }

  const dt = Math.min((timestamp - state.lastTime) / 16.67, 2.2);
  state.lastTime = timestamp;

  if (!state.gameOver) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnEnemy();
      state.spawnTimer = 90;
    }

    handlePlayer(dt);
    state.enemies.forEach((enemy) => updateEnemyAI(enemy, dt));
    updateBullets(dt);
  }

  render();
  requestAnimationFrame(gameLoop);
}

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    if (state.player && state.player.alive) {
      fireBullet(state.player);
    }
    return;
  }

  if (event.key.toLowerCase() === "r") {
    resetWorld();
    return;
  }

  if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    state.keys.add(event.key);
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key.startsWith("Arrow")) {
    state.keys.delete(event.key);
  }
});

resetWorld();
requestAnimationFrame(gameLoop);
