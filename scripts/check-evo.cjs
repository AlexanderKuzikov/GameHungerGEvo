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
for (const id of ["world", "intro", "brush-tools", "population-canvas", "event-log", "pause-button", "reset-button", "mobile-tools", "mobile-panel"]) {
  assert.ok(ids.includes(id), `Отсутствует обязательный элемент #${id}`);
}

const sandbox = { console, Date, Math, Number, String, Boolean, Object, Array, Set, Map, JSON };
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: "index.html:inline" });
const { Ecology, TYPE, TERRAIN, GRID_WIDTH, GRID_HEIGHT, STEP_SECONDS, YEAR_SECONDS, getWorldLayout, gridToScreen, screenToGrid } = sandbox.LivingCodex;
assert.ok(Ecology && TYPE && GRID_WIDTH === 180 && GRID_HEIGHT === 100, "Публичный экологический интерфейс недоступен");

{
  const portrait = getWorldLayout(100, 200);
  assert.equal(portrait.rotated, true, "Вертикальный viewport должен поворачивать кодекс");
  const topLeft = screenToGrid(portrait, portrait.x, portrait.y);
  const bottomRight = screenToGrid(portrait, portrait.x + portrait.width, portrait.y + portrait.height);
  assert.ok(Math.abs(topLeft.x - 179) < 0.01 && Math.abs(topLeft.y) < 0.01, "Левый верхний угол портрета должен соответствовать правому верхнему углу сетки");
  assert.ok(Math.abs(bottomRight.x) < 0.01 && Math.abs(bottomRight.y - 99) < 0.01, "Правый нижний угол портрета должен соответствовать левому нижнему углу сетки");
  const cellCenter = screenToGrid(portrait, portrait.x + portrait.width * 0.495, portrait.y + portrait.height * (1 - 89.5 / 180));
  assert.ok(Math.abs(cellCenter.x - 89.5) < 0.01 && Math.abs(cellCenter.y - 49.5) < 0.01, "Pointer mapping должен использовать полный размер сетки");
  const screenCenter = gridToScreen(portrait, 89.5, 49.5);
  const roundTrip = screenToGrid(portrait, screenCenter.x, screenCenter.y);
  assert.ok(Math.abs(roundTrip.x - 89.5) < 0.01 && Math.abs(roundTrip.y - 49.5) < 0.01, "Grid→screen→grid должен быть обратим в портрете");
  const landscape = getWorldLayout(200, 100);
  assert.equal(landscape.rotated, false, "Широкий viewport не должен поворачивать кодекс");
  assert.equal(screenToGrid(portrait, -10, -10), null, "Клик вне поля не должен рисовать на краю сетки");
}
assert.ok(script.includes("vec2(v_uv.x, 1.0 - v_uv.y)"), "WebGL должен использовать top-left контракт экранных координат");
assert.ok(script.includes("context.rotate(-Math.PI / 2)"), "Canvas portrait должен использовать тот же поворот, что pointer mapping");
assert.ok(script.includes("type > 1.5 && type < 2.5"), "Пустые клетки не должны попадать в ветку консументов");
assert.ok(script.includes("type > 2.5 && type < 3.5"), "Пустые клетки не должны попадать в ветку хищников");
assert.ok(script.includes("type > 3.5 && type < 4.5"), "Пустые клетки не должны попадать в ветку паразитов");
assert.ok(script.includes("type > 4.5 && type < 5.5"), "Пустые клетки не должны попадать в ветку редуцентов");
assert.ok(script.includes("!this.terrainUploaded || ecology.terrainDirty || ecologyChanged"), "Смена экологии должна инвалидировать terrain texture");
assert.ok(!/(?<!- )smoothstep\([^,]+,\s*-/.test(script), "GLSL smoothstep не должен получать обратный порядок граней");

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
  const expectedGenome = [1.2, 1.4, 0.6, 0.7, 0.8, 0.9];
  for (let gene = 0; gene < 6; gene += 1) ecology.genes[center * 6 + gene] = expectedGenome[gene];
  ecology.step();
  assert.equal(ecology.life[center], TYPE.PRODUCER, "Два или три соседа должны сохранять продуцента по S23");
  for (let gene = 0; gene < 6; gene += 1) assert.ok(Math.abs(ecology.genes[center * 6 + gene] - expectedGenome[gene]) < 1e-6, `Выживший организм должен сохранять ген ${gene}`);
}

{
  const ecology = blankEcology();
  const consumer = indexAt(25, 25);
  ecology.seedOrganism(consumer, TYPE.CONSUMER);
  const expectedGenome = [1.1, 1.2, 1, 0.3, 0.4, 0.5];
  for (let gene = 0; gene < 6; gene += 1) ecology.genes[consumer * 6 + gene] = expectedGenome[gene];
  ecology.energy[consumer] = 0.8;
  ecology.rng = () => 0;
  ecology.step();
  assert.equal(ecology.life[consumer], TYPE.EMPTY, "Голодный подвижный консумент должен переместиться");
  let target = -1;
  for (let slot = 0; slot < 8; slot += 1) {
    const neighbor = ecology.neighbors[consumer * 8 + slot];
    if (neighbor >= 0 && ecology.life[neighbor] === TYPE.CONSUMER) { target = neighbor; break; }
  }
  assert.ok(target >= 0, "Переместившийся консумент должен остаться в соседней клетке");
  for (let gene = 0; gene < 6; gene += 1) assert.ok(Math.abs(ecology.genes[target * 6 + gene] - expectedGenome[gene]) < 1e-6, `Перемещение должно сохранять ген ${gene}`);
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
  const expectedGenome = [1.2, 1.4, 0.6, 0.7, 0.8, 0.9];
  ecology.mutationRate = 0;
  ecology.seedOrganism(center, TYPE.PRODUCER, expectedGenome, 4242);
  ecology.step();
  assert.equal(ecology.life[center], TYPE.EMPTY, "Одинокий продуцент должен погибнуть по S23");
  assert.ok(ecology.spores[center] > 0, "Погибший продуцент должен оставить банк спор");
  assert.equal(ecology.sporeLineage[center], 4242, "Спора должна сохранять родословную");
  for (let gene = 0; gene < 6; gene += 1) assert.ok(Math.abs(ecology.sporeGenes[center * 6 + gene] - expectedGenome[gene]) < 1e-6, `Спора должна сохранять ген ${gene}`);
  ecology.rng = () => 0;
  ecology.moisture[center] = 1;
  ecology.nutrients[center] = 1;
  ecology.sporeType[center] = TYPE.PRODUCER;
  ecology.step();
  assert.equal(ecology.life[center], TYPE.PRODUCER, "Банк спор должен позволить повторному прорастанию");
  assert.equal(ecology.lineage[center], 4242, "Прорастание должно сохранять род");
  for (let gene = 0; gene < 6; gene += 1) assert.ok(Math.abs(ecology.genes[center * 6 + gene] - expectedGenome[gene]) < 1e-6, `Прорастание должно наследовать ген ${gene}`);
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
  ecology.seedOrganism(indexAt(50, 51), TYPE.PRODUCER);
  ecology.seedOrganism(indexAt(51, 49), TYPE.PRODUCER);
  ecology.energy[parasite] = 0.7;
  ecology.step();
  assert.equal(ecology.life[host], TYPE.PRODUCER, "Хозяин с двумя соседями должен выживать по S23");
  assert.ok(ecology.infection[host] > 0, "Паразит должен инфицировать живого соседнего хозяина");
  assert.ok(ecology.energy[parasite] > 0.7, "Паразит должен получать энергию от хозяина");
}

{
  const ecology = blankEcology();
  const predator = indexAt(60, 60);
  const parasite = indexAt(62, 61);
  const host = indexAt(61, 61);
  ecology.seedOrganism(predator, TYPE.PREDATOR);
  ecology.seedOrganism(parasite, TYPE.PARASITE);
  ecology.seedOrganism(host, TYPE.CONSUMER);
  ecology.energy[parasite] = 0.7;
  ecology.rng = () => 0;
  ecology.orderOffset = (predator - 7919 + ecology.size) % ecology.size;
  ecology.step();
  assert.equal(ecology.life[host], TYPE.EMPTY, "Хищник должен съесть хозяина раньше паразита");
  assert.equal(ecology.infection[host], 0, "Паразит не должен заражать уже съеденную клетку");
}

{
  const ecology = blankEcology();
  const producer = indexAt(80, 80);
  const consumer = indexAt(81, 80);
  ecology.seedOrganism(producer, TYPE.PRODUCER);
  ecology.seedOrganism(consumer, TYPE.CONSUMER);
  ecology.energy[producer] = 0.8;
  ecology.energy[consumer] = 0.8;
  ecology.rng = () => 0;
  ecology.orderOffset = (producer - 7919 + ecology.size) % ecology.size;
  ecology.step();
  assert.equal(ecology.life[producer], TYPE.EMPTY, "Одинокий продуцент должен умереть первым");
  assert.ok(ecology.energy[consumer] < 0.8, "Консумент не должен питаться уже умершим продуцентом");
  assert.ok(ecology.detritus[producer] < 0.3, "Естественная смерть не должна удваивать детрит");
}

{
  const ecology = blankEcology();
  const consumer = indexAt(85, 80);
  const producer = indexAt(86, 80);
  ecology.seedOrganism(consumer, TYPE.CONSUMER);
  ecology.seedOrganism(producer, TYPE.PRODUCER);
  ecology.energy[producer] = 0.8;
  ecology.energy[consumer] = 0.8;
  ecology.rng = () => 0;
  ecology.orderOffset = (consumer - 7919 + ecology.size) % ecology.size;
  ecology.step();
  assert.ok(ecology.energy[consumer] > 0.8, "Консумент должен успеть съесть живого продуцента");
  assert.ok(ecology.detritus[producer] < 0.3, "Съеденная клетка не должна получать детрит дважды");
}

{
  const ecology = blankEcology();
  const host = indexAt(90, 80);
  const parasite = indexAt(91, 80);
  ecology.seedOrganism(host, TYPE.PRODUCER);
  ecology.seedOrganism(parasite, TYPE.PARASITE);
  ecology.energy[parasite] = 0.7;
  ecology.rng = () => 0;
  ecology.orderOffset = (host - 7919 + ecology.size) % ecology.size;
  ecology.step();
  assert.equal(ecology.life[host], TYPE.EMPTY, "Хозяин должен умереть первым");
  assert.ok(ecology.energy[parasite] < 0.7, "Паразит не должен получать энергию от умершего хозяина");
  assert.equal(ecology.infection[host], 0, "Мёртвый хозяин не должен быть инфицирован");
}

{
  const ecology = blankEcology();
  const consumer = indexAt(70, 70);
  const predator = indexAt(69, 70);
  const escape = indexAt(72, 70);
  ecology.seedOrganism(consumer, TYPE.CONSUMER);
  ecology.seedOrganism(predator, TYPE.PREDATOR);
  ecology.energy[consumer] = 0.8;
  const predatorEnergy = ecology.energy[predator];
  ecology.chooseForageTarget = () => escape;
  ecology.rng = () => 0;
  ecology.orderOffset = (consumer - 7919 + ecology.size) % ecology.size;
  ecology.step();
  assert.equal(ecology.life[escape], TYPE.CONSUMER, "Консумент должен уйти до обработки хищником");
  assert.ok(ecology.energy[predator] < predatorEnergy, "Хищник не должен получать энергию из уже покинутой клетки");
  assert.equal(ecology.detritus[consumer], 0, "Покинутая клетка не должна становиться детритом");
}

{
  const ecology = blankEcology();
  const fungus = indexAt(60, 60);
  ecology.seedOrganism(fungus, TYPE.DECOMPOSER);
  ecology.detritus[fungus] = 0.6;
  ecology.detritus[indexAt(61, 60)] = 0.5;
  const beforeNutrients = ecology.nutrients[fungus];
  ecology.step();
  assert.ok(ecology.detritus[fungus] < 0.6, "Редуцент должен потреблять детрит");
  assert.ok(Math.abs(ecology.detritus[indexAt(61, 60)] - 0.496) < 1e-6, "Редуцент не должен списывать чужой соседний детрит");
  assert.ok(ecology.nutrients[fungus] > beforeNutrients, "Редуцент должен возвращать питание");
}

{
  const ecology = blankEcology();
  const index = indexAt(75, 75);
  ecology.nutrients[index] = 0;
  ecology.detritus[index] = 0.5;
  ecology.moisture[index] = 1;
  ecology.step();
  assert.ok(ecology.nutrients[index] > 0, "Выветривание и детрит должны возвращать питание в почву");
  assert.ok(ecology.moisture[index] < 1, "Избыточная влажность должна дренироваться");
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

if (process.argv.includes("--long")) {
  for (const seed of [777, 2026]) {
    const ecology = new Ecology(seed);
    const totalTicks = Math.round(10 * YEAR_SECONDS / STEP_SECONDS);
    const lastYearStart = totalTicks - Math.round(YEAR_SECONDS / STEP_SECONDS);
    const recentSeen = [false, false, false, false, false];
    for (let i = 0; i < totalTicks; i += 1) {
      ecology.step();
      if (i % 12 === 0 && i >= lastYearStart) {
        for (let type = TYPE.PRODUCER; type <= TYPE.DECOMPOSER; type += 1) recentSeen[type] = recentSeen[type] || ecology.stats.populations[type] > 0;
      }
    }
    assert.ok(ecology.stats.total > 20, `Seed ${seed}: экосистема не должна вымирать полностью`);
    for (let type = TYPE.PRODUCER; type <= TYPE.DECOMPOSER; type += 1) assert.ok(recentSeen[type], `Seed ${seed}: трофический уровень ${type} должен присутствовать в последнем году`);
  }
}

console.log("Живой кодекс: синтаксис, Conway, трофическая сеть, мутации, сезоны и стабильность проверены");
