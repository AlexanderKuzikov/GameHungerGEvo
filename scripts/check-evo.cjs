"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, "В index.html должен быть один встроенный script");
const script = scriptMatch[1];
new vm.Script(script, { filename: "index.html:inline" });
assert.ok(!/(?:src|href)=["']https?:\/\//i.test(html), "Игра не должна загружать внешние ресурсы");
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "Все id в HTML должны быть уникальны");
for (const id of ["world", "intro", "brush-tools", "population-canvas", "event-log", "pause-button", "reset-button"]) {
  assert.ok(ids.includes(id), `Отсутствует обязательный элемент #${id}`);
}

const sandbox = { console, Date, Math, Number, String, Boolean, Object, Array, Set, Map, JSON };
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: "index.html:inline" });
const { Ecology, TYPE, TERRAIN, GRID_WIDTH, GRID_HEIGHT, STEP_SECONDS, YEAR_SECONDS, getWorldLayout, screenToGrid } = sandbox.LivingCodex;
assert.ok(Ecology && TYPE && GRID_WIDTH === 180 && GRID_HEIGHT === 100, "Публичный экологический интерфейс недоступен");

{
  const portrait = getWorldLayout(100, 200);
  assert.equal(portrait.rotated, true, "Вертикальный viewport должен поворачивать кодекс");
  const topLeft = screenToGrid(portrait, portrait.x, portrait.y);
  const bottomRight = screenToGrid(portrait, portrait.x + portrait.width, portrait.y + portrait.height);
  assert.ok(Math.abs(topLeft.x - 179) < 0.01 && Math.abs(topLeft.y) < 0.01, "Левый верхний угол портрета должен соответствовать правому верхнему углу сетки");
  assert.ok(Math.abs(bottomRight.x) < 0.01 && Math.abs(bottomRight.y - 99) < 0.01, "Правый нижний угол портрета должен соответствовать левому нижнему углу сетки");
  const landscape = getWorldLayout(200, 100);
  assert.equal(landscape.rotated, false, "Широкий viewport не должен поворачивать кодекс");
  assert.equal(screenToGrid(portrait, -10, -10), null, "Клик вне поля не должен рисовать на краю сетки");
}

function blankEcology(seed = 12345) {
  const ecology = new Ecology(seed);
  ecology.life.fill(TYPE.EMPTY);
  ecology.energy.fill(0);
  ecology.age.fill(0);
  ecology.infection.fill(0);
  ecology.detritus.fill(0);
  ecology.spores.fill(0);
  ecology.sporeType.fill(0);
  ecology.terrain.fill(TERRAIN.SOIL);
  ecology.moisture.fill(0.85);
  ecology.nutrients.fill(0.75);
  ecology.temperature.fill(0.45);
  ecology.nextLineageId = 1000;
  ecology.updateStats();
  ecology.writeTerrainData();
  return ecology;
}

function indexAt(x, y) {
  return y * GRID_WIDTH + x;
}

const first = new Ecology(12345);
const second = new Ecology(12345);
assert.equal(first.seed, second.seed);
assert.deepEqual(Array.from(first.terrain), Array.from(second.terrain), "Одинаковый seed должен давать одинаковый рельеф");
assert.deepEqual(Array.from(first.life), Array.from(second.life), "Одинаковый seed должен давать одинаковую колонию");
assert.ok(first.stats.total > 100, "Начальная колония должна содержать жизнь");

{
  const ecology = blankEcology();
  ecology.mutationRate = 0;
  const a = indexAt(10, 10);
  const b = indexAt(11, 10);
  const c = indexAt(10, 11);
  const target = indexAt(11, 11);
  ecology.seedOrganism(a, TYPE.PRODUCER);
  ecology.seedOrganism(b, TYPE.PRODUCER);
  ecology.seedOrganism(c, TYPE.PRODUCER);
  for (let gene = 0; gene < 6; gene += 1) {
    ecology.genes[a * 6 + gene] = 0.7 + gene * 0.02;
    ecology.genes[b * 6 + gene] = 0.8 + gene * 0.02;
    ecology.genes[c * 6 + gene] = 0.9 + gene * 0.02;
  }
  ecology.step();
  assert.equal(ecology.life[target], TYPE.PRODUCER, "Ровно три соседа-продуцента должны давать рождение по B3");
  for (let gene = 0; gene < 6; gene += 1) {
    const expected = (0.7 + 0.8 + 0.9) / 3 + gene * 0.02;
    assert.ok(Math.abs(ecology.genes[target * 6 + gene] - expected) < 0.001, `Новорождённый должен наследовать ген ${gene}`);
  }
}

{
  const ecology = blankEcology();
  const center = indexAt(20, 20);
  ecology.seedOrganism(center, TYPE.PRODUCER);
  ecology.seedOrganism(indexAt(19, 20), TYPE.PRODUCER);
  ecology.seedOrganism(indexAt(21, 20), TYPE.PRODUCER);
  ecology.step();
  assert.equal(ecology.life[center], TYPE.PRODUCER, "Два или три соседа должны сохранять продуцента по S23");
}

{
  const ecology = blankEcology();
  const center = indexAt(30, 30);
  ecology.seedOrganism(center, TYPE.PRODUCER);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ecology.seedOrganism(indexAt(30 + dx, 30 + dy), TYPE.PRODUCER);
  ecology.step();
  assert.equal(ecology.life[center], TYPE.EMPTY, "Четыре соседа должны убивать продуцента по S23");
}

{
  const ecology = blankEcology();
  const center = indexAt(35, 35);
  ecology.seedOrganism(center, TYPE.PRODUCER);
  ecology.step();
  assert.equal(ecology.life[center], TYPE.EMPTY, "Одинокий продуцент должен погибнуть по S23");
  assert.ok(ecology.spores[center] > 0, "Погибший продуцент должен оставить банк спор");
  ecology.rng = () => 0;
  ecology.moisture[center] = 1;
  ecology.nutrients[center] = 1;
  ecology.sporeType[center] = TYPE.PRODUCER;
  ecology.step();
  assert.equal(ecology.life[center], TYPE.PRODUCER, "Банк спор должен позволить повторному прорастанию");
  assert.ok(ecology.life[indexAt(34, 35)] === TYPE.PRODUCER || ecology.life[indexAt(36, 35)] === TYPE.PRODUCER, "Пророст должен создавать колонию, способную выжить по S23");
}

{
  const ecology = blankEcology();
  const consumer = indexAt(40, 40);
  const food = indexAt(41, 40);
  ecology.seedOrganism(consumer, TYPE.CONSUMER);
  ecology.seedOrganism(food, TYPE.PRODUCER);
  ecology.energy[consumer] = 0.8;
  ecology.energy[food] = 0.9;
  ecology.rng = () => 0;
  ecology.step();
  assert.equal(ecology.life[food], TYPE.EMPTY, "Консумент должен поедать соседнего продуцента");
  assert.ok(ecology.energy[consumer] > 0.8, "Консумент должен получать энергию из пищи");
  assert.ok(ecology.detritus[food] > 0, "После поедания должен появляться детрит");
}

{
  const ecology = blankEcology();
  const parasite = indexAt(50, 50);
  const host = indexAt(51, 50);
  ecology.seedOrganism(parasite, TYPE.PARASITE);
  ecology.seedOrganism(host, TYPE.PRODUCER);
  ecology.energy[parasite] = 0.7;
  ecology.step();
  assert.ok(ecology.infection[host] > 0, "Паразит должен инфицировать соседнего хозяина");
  assert.ok(ecology.energy[parasite] > 0.7, "Паразит должен получать энергию от хозяина");
}

{
  const ecology = blankEcology();
  const fungus = indexAt(60, 60);
  ecology.seedOrganism(fungus, TYPE.DECOMPOSER);
  ecology.detritus[fungus] = 0.6;
  const beforeNutrients = ecology.nutrients[fungus];
  ecology.step();
  assert.ok(ecology.detritus[fungus] < 0.6, "Редуцент должен потреблять детрит");
  assert.ok(ecology.nutrients[fungus] > beforeNutrients, "Редуцент должен возвращать питание");
}

{
  const ecology = new Ecology(777);
  ecology.mutationRate = 0.2;
  const initialTraits = ecology.stats.traits[TYPE.PRODUCER].slice();
  for (let i = 0; i < 1200; i += 1) ecology.step();
  ecology.updateStats();
  assert.ok(ecology.stats.mutations > 0, "При размножении должны происходить мутации");
  const changed = ecology.stats.traits[TYPE.PRODUCER].some((value, gene) => Math.abs(value - initialTraits[gene]) > 0.0001);
  assert.ok(changed, "Средние признаки продуцентов должны меняться под отбором");
}

{
  const ecology = new Ecology(999);
  for (let i = 0; i < Math.round(YEAR_SECONDS / STEP_SECONDS); i += 1) ecology.step();
  assert.equal(ecology.year, 2, "Полный цикл должен начинать новую эпоху");
  assert.equal(ecology.seasonIndex, 0, "После полного цикла снова должна быть весна");
}

{
  const ecology = new Ecology(2026);
  ecology.paint(90, 50, TYPE.PREDATOR, 3);
  assert.ok(ecology.life.slice(indexAt(87, 50), indexAt(94, 50)).some((value) => value === TYPE.PREDATOR), "Кисть должна добавлять выбранный вид");
  ecology.paint(90, 50, "erase", 4);
  assert.ok(ecology.life.slice(indexAt(85, 50), indexAt(96, 50)).every((value) => value === TYPE.EMPTY), "Ластик должен очищать клетки");
  ecology.disturb("drought");
  assert.ok(ecology.stats.meanMoisture < 0.9, "Засуха должна снижать влажность");
}

{
  const ecology = new Ecology(31415);
  for (let i = 0; i < 3000; i += 1) ecology.step();
  assert.ok(ecology.history.length <= ecology.historyLimit, "История популяций должна быть ограничена");
  assert.ok(ecology.events.length <= 24, "Журнал событий должен быть ограничен");
  assert.ok(ecology.stats.total <= GRID_WIDTH * GRID_HEIGHT, "Популяция не может превышать размер сетки");
  assert.ok([ecology.stats.meanTemperature, ecology.stats.meanMoisture, ecology.stats.meanNutrients].every(Number.isFinite), "Климат не должен содержать NaN");
  assert.ok(ecology.stats.traits.every((traits) => traits.every(Number.isFinite)), "Гены не должны содержать NaN");
}

console.log("Живой кодекс: синтаксис, Conway, трофическая сеть, мутации, сезоны и стабильность проверены");
