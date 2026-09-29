/* No dependencies. Each mode keeps its own draw state. */
"use strict";
const $ = id => document.getElementById(id);
const state = { columns: [4, 5, 5, 4], mode: "number", numberSeats: [], people: [], assignments: new Map(), lastNumber: null, lastName: null, editing: false, offsets: new Map(), confirmed: false };
const totalSeats = () => state.columns.reduce((sum, n) => sum + n, 0);
const namesFromInput = () => $("names-input").value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

// Rejection sampling avoids modulo bias; Fisher–Yates samples without replacement.
function randomInt(max) {
  const values = new Uint32Array(1);
  const limit = Math.floor(4294967296 / max) * max;
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % max;
}
function shuffled(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function availableSeats(used) {
  const occupied = new Set(used);
  return Array.from({ length: totalSeats() }, (_, i) => i + 1).filter(n => !occupied.has(n));
}
function drawOne(used) {
  const free = availableSeats(used);
  return free.length ? free[randomInt(free.length)] : null;
}
function notice(message = "") { $("notice").textContent = message; }
function hasDraws() { return state.numberSeats.length > 0 || state.assignments.size > 0; }
function clearDraws(all = false) {
  if (all || state.mode === "number") { state.numberSeats = []; state.lastNumber = null; }
  if (all || state.mode === "name") { state.assignments.clear(); state.lastName = null; }
}
function addStepper(input, name) {
  const control = document.createElement("span");
  control.className = "number-stepper";
  const minus = document.createElement("button"), plus = document.createElement("button");
  const sync = () => {
    const value = input.valueAsNumber;
    minus.disabled = Number.isFinite(value) && value <= Number(input.min);
    plus.disabled = Number.isFinite(value) && value >= Number(input.max);
  };
  for (const [button, delta, text] of [[minus, -1, "−"], [plus, 1, "＋"]]) {
    button.type = "button";
    button.textContent = text;
    button.setAttribute("aria-label", `${name}を1${delta < 0 ? "減らす" : "増やす"}`);
    button.addEventListener("click", () => {
      const value = input.valueAsNumber;
      input.value = Math.max(Number(input.min), Math.min(Number(input.max), Number.isFinite(value) ? Math.trunc(value) + delta : Number(input.min)));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  input.replaceWith(control);
  control.append(minus, input, plus);
  input.addEventListener("input", sync);
  sync();
}
function makeColumnFields(count) {
  const previous = [...$("column-fields").querySelectorAll("input")].map(input => input.value);
  $("column-fields").replaceChildren();
  for (let i = 0; i < count; i++) {
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.textContent = `${i + 1}列目`;
    label.htmlFor = `column-seats-${i}`;
    const input = document.createElement("input");
    Object.assign(input, { type: "number", min: "1", max: "100", required: true, value: previous[i] ?? state.columns[i] ?? 4, inputMode: "numeric" });
    input.setAttribute("aria-label", `${i + 1}列目の座席数`);
    input.id = label.htmlFor;
    field.append(label, input);
    addStepper(input, `${i + 1}列目の座席数`);
    $("column-fields").append(field);
  }
}
$("column-count").addEventListener("input", event => {
  const n = Number(event.target.value);
  if (Number.isInteger(n) && n >= 1 && n <= 20) makeColumnFields(n);
});
$("layout-form").addEventListener("submit", event => {
  event.preventDefault();
  const columns = [...$("column-fields").querySelectorAll("input")].map(input => Number(input.value));
  if (columns.length !== Number($("column-count").value) || columns.some(n => !Number.isInteger(n) || n < 1 || n > 100)) return;
  if (columns.reduce((a, b) => a + b, 0) > 200) { $("layout-error").textContent = "座席は合計200席以内で設定してください。"; return; }
  if (hasDraws() && !confirm("座席配置を変更すると、両モードの抽選結果が消えます。作成しますか？")) return;
  state.columns = columns;
  state.offsets.clear();
  clearDraws(true);
  $("layout-error").textContent = "";
  $("layout-settings").open = false;
  render();
  notice("座席配置を作成しました。");
});
function applyOffset(seat) {
  const offset = state.offsets.get(Number(seat.dataset.seat)) || { x: 0, y: 0 };
  seat.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
}
function moveSeat(seat, dx, dy) {
  const key = Number(seat.dataset.seat);
  const old = state.offsets.get(key) || { x: 0, y: 0 };
  const rect = seat.getBoundingClientRect(), board = $("seat-board").getBoundingClientRect();
  const x = Math.max(old.x + board.left + 3 - rect.left, Math.min(old.x + dx, old.x + board.right - 3 - rect.right));
  const y = Math.max(old.y + board.top + 3 - rect.top, Math.min(old.y + dy, old.y + board.bottom - 3 - rect.bottom));
  state.offsets.set(key, { x, y });
  applyOffset(seat);
}
function renderBoard() {
  const board = $("seat-board");
  board.replaceChildren();
  board.style.setProperty("--columns", state.columns.length);
  if (state.columns.length > 4) {
    board.style.setProperty("--column-gap", `${Math.max(4, 8 - (state.columns.length - 4) * 2)}px`);
    board.style.setProperty("--seat-font", `${Math.max(14, 21 - (state.columns.length - 4) * 2)}px`);
    board.style.setProperty("--name-font", "12px");
  } else {
    ["--column-gap", "--seat-font", "--name-font"].forEach(property => board.style.removeProperty(property));
  }
  board.classList.toggle("editing", state.editing);
  $("seat-total").textContent = `${totalSeats()} 席`;
  const used = state.mode === "number" ? new Set(state.numberSeats) : new Set(state.assignments.values());
  const last = state.mode === "number" ? state.lastNumber : state.lastName;
  const bySeat = new Map([...state.assignments].map(([id, seat]) => [seat, state.people[id]]));
  let number = 0;
  state.columns.forEach((count, index) => {
    const column = document.createElement("div"); column.className = "seat-column";
    const label = document.createElement("div"); label.className = "column-label"; label.textContent = `${index + 1}列目`; column.append(label);
    for (let i = 0; i < count; i++) {
      number++;
      const seat = document.createElement("button");
      seat.type = "button"; seat.className = "seat"; seat.dataset.seat = number;
      seat.tabIndex = state.editing ? 0 : -1;
      const name = state.mode === "name" ? bySeat.get(number) : undefined;
      seat.classList.toggle("assigned", used.has(number)); seat.classList.toggle("highlight", last === number); seat.classList.toggle("has-name", name !== undefined);
      const num = document.createElement("span"); num.className = "seat-number"; num.textContent = `${number}${name !== undefined ? "番" : ""}`; seat.append(num);
      if (name !== undefined) { const text = document.createElement("span"); text.className = "seat-name"; text.textContent = name; seat.append(text); }
      seat.setAttribute("aria-label", `${number}番席${name !== undefined ? `、${name}` : used.has(number) ? "、抽選済み" : "、空席"}`);
      applyOffset(seat); column.append(seat);
    }
    board.append(column);
  });
  board.querySelectorAll(".seat").forEach(seat => moveSeat(seat, 0, 0));
}
function renderNames() {
  $("names-form").hidden = state.confirmed;
  $("names-ready").hidden = !state.confirmed;
  const tooMany = state.people.length > totalSeats();
  $("names-status").textContent = `座席は${totalSeats()}席、参加者は${state.people.length}人です。抽選済み ${state.assignments.size}人 / 残り ${state.people.length - state.assignments.size}人${totalSeats() > state.people.length ? `（空席 ${totalSeats() - state.people.length}席）` : ""}`;
  $("names-error").textContent = state.confirmed && tooMany ? "参加者が座席数を超えています。参加者を変更するか、座席を増やしてください。" : "";
  $("shuffle-all").disabled = tooMany || !state.people.length;
  $("name-buttons").replaceChildren();
  state.people.forEach((name, id) => {
    const button = document.createElement("button"); button.textContent = name;
    const assigned = state.assignments.has(id);
    button.disabled = assigned || tooMany;
    if (assigned) { const small = document.createElement("small"); small.textContent = `抽選済み・${state.assignments.get(id)}番席`; button.append(small); }
    button.addEventListener("click", () => selectPerson(id));
    $("name-buttons").append(button);
  });
}
function render() {
  renderBoard(); renderNames();
  updateInputCount();
  const remaining = totalSeats() - state.numberSeats.length;
  $("number-counter").replaceChildren();
  const strong = document.createElement("strong"); strong.textContent = remaining;
  $("number-counter").append("残り ", strong, ` 席　／　抽選済み ${state.numberSeats.length}人`);
  $("draw-number").disabled = remaining === 0;
  $("draw-number").textContent = remaining ? "くじを引く →" : "全員の席が決まりました";
}
function setMode(mode) {
  state.mode = mode;
  $("number-tab").setAttribute("aria-pressed", mode === "number");
  $("name-tab").setAttribute("aria-pressed", mode === "name");
  $("number-panel").hidden = mode !== "number"; $("name-panel").hidden = mode !== "name"; $("change-names").hidden = mode !== "name";
  notice(); render();
}
$("number-tab").onclick = () => setMode("number");
$("name-tab").onclick = () => setMode("name");
function showDialog({ person = "", title, number = "", note = "", action, onAction }) {
  $("result-person").textContent = person; $("result-title").textContent = title; $("result-number").textContent = number; $("result-note").textContent = note;
  $("dialog-action").textContent = action;
  $("dialog-action").onclick = onAction;
  if (!$("draw-dialog").open) $("draw-dialog").showModal();
  $("dialog-action").focus();
}
function showResult(seat, name) {
  showDialog({ title: name === undefined ? "あなたは" : `${name}さんは`, number: `${seat}番！`, note: "座席配置の黄色い席を確認してください。", action: "席を確認・次の人へ", onAction: () => { $("draw-dialog").close(); $("seat-board").scrollIntoView({ block: "center" }); } });
}
$("draw-number").onclick = () => {
  const seat = drawOne(state.numberSeats); if (seat === null) return;
  state.numberSeats.push(seat); state.lastNumber = seat; render(); showResult(seat);
};
function selectPerson(id) {
  if (state.assignments.has(id) || state.people.length > totalSeats()) return;
  showDialog({ person: `${state.people[id]}さん`, title: "席を引いてください", note: "準備ができたら、下のボタンをタップ！", action: "抽選！", onAction: () => {
    if (state.assignments.has(id)) return;
    const seat = drawOne(state.assignments.values()); if (seat === null) return;
    state.assignments.set(id, seat); state.lastName = seat; render(); showResult(seat, state.people[id]);
  } });
}
function updateInputCount() {
  const count = namesFromInput().length;
  $("names-count").textContent = `座席は${totalSeats()}席、参加者は${count}人です。${count > totalSeats() ? "参加者が多すぎます。" : count < totalSeats() ? `空席${totalSeats() - count}席で抽選できます。` : "人数が一致しています。"}`;
}
$("names-input").oninput = updateInputCount;
$("names-form").onsubmit = event => {
  event.preventDefault(); const people = namesFromInput();
  if (!people.length) { $("names-error").textContent = "参加者を1人以上入力してください。"; return; }
  state.people = people; state.assignments.clear(); state.lastName = null; state.confirmed = true; render(); notice();
};
$("shuffle-all").onclick = () => {
  if (!state.people.length || state.people.length > totalSeats()) return;
  if (state.assignments.size && !confirm("全員の席をシャッフルし直しますか？ 現在の名前の抽選結果は消えます。")) return;
  const seats = shuffled(availableSeats([]));
  state.assignments = new Map(state.people.map((_, id) => [id, seats[id]])); state.lastName = null;
  render(); notice("全員の席が決まりました！ 座席配置を確認してください。"); $("seat-board").scrollIntoView({ block: "center" });
};
$("reset-draw").onclick = () => {
  const count = state.mode === "number" ? state.numberSeats.length : state.assignments.size;
  if (!count) { notice("まだ抽選されていません。"); return; }
  if (!confirm("現在のモードの抽選結果を消して、初めからやり直しますか？")) return;
  clearDraws(); render(); notice("抽選をリセットしました。");
};
$("change-names").onclick = () => {
  if (state.assignments.size && !confirm("参加者を変更すると、名前の抽選結果が消えます。変更しますか？")) return;
  state.assignments.clear(); state.lastName = null; state.confirmed = false; render(); updateInputCount(); $("names-input").focus(); notice();
};
$("rebuild-layout").onclick = () => { $("layout-settings").open = true; $("layout-settings").scrollIntoView({ block: "start" }); $("column-count").focus({ preventScroll: true }); };
$("edit-position").onclick = () => {
  state.editing = !state.editing; $("edit-position").setAttribute("aria-pressed", state.editing); $("edit-position").textContent = state.editing ? "調整を完了" : "位置を調整"; $("drag-hint").hidden = !state.editing; renderBoard();
};
$("reset-position").onclick = () => {
  if ([...state.offsets.values()].some(p => p.x || p.y) && !confirm("移動した席を自動配置の位置に戻しますか？ 抽選結果は残ります。")) return;
  state.offsets.clear(); renderBoard(); notice("座席の位置を自動配置に戻しました。");
};
let drag = null;
$("seat-board").addEventListener("pointerdown", event => {
  const seat = event.target.closest(".seat");
  if (!state.editing || !seat || drag || event.button !== 0) return;
  drag = { seat, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  seat.setPointerCapture(event.pointerId); seat.classList.add("dragging");
});
$("seat-board").addEventListener("pointermove", event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  moveSeat(drag.seat, event.clientX - drag.x, event.clientY - drag.y); drag.x = event.clientX; drag.y = event.clientY;
});
function endDrag(event) { if (drag && event.pointerId === drag.pointerId) { drag.seat.classList.remove("dragging"); drag = null; } }
$("seat-board").addEventListener("pointerup", endDrag);
$("seat-board").addEventListener("pointercancel", endDrag);
$("seat-board").addEventListener("lostpointercapture", endDrag);
$("seat-board").addEventListener("keydown", event => {
  const seat = event.target.closest(".seat"), deltas = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] };
  if (state.editing && seat && deltas[event.key]) { event.preventDefault(); moveSeat(seat, ...deltas[event.key]); }
});
new ResizeObserver(() => { $("seat-board").querySelectorAll(".seat").forEach(seat => moveSeat(seat, 0, 0)); }).observe($("seat-board"));
addStepper($("column-count"), "列数");
makeColumnFields(4); render(); updateInputCount();

// Record one visit per page load, matching number-slide-puzzle's request settings.
try {
  fetch('https://script.google.com/macros/s/AKfycbxssCIHsD-N97SHxNC_GN0ihYeC0qy-lb-EY0KmSs6Gnztaph1sITMerLVEnNWOGkYc/exec?app=seat-shuffle', {
    method: 'GET',
    mode: 'no-cors',
    cache: 'no-store',
    credentials: 'omit',
    keepalive: true,
  }).catch(() => {});
} catch {
  // Access logging must never interrupt the app; do not retry.
}
