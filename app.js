/* No dependencies. Each mode keeps its own draw state. */
"use strict";
const $ = id => document.getElementById(id);
const state = { columns: [4, 5, 5, 4], mode: "number", numberSeats: [], people: [], assignments: new Map(), lastNumber: null, lastName: null, editing: false, offsets: new Map(), confirmed: false, absent: new Set(), attendanceEditing: false };
const totalSeats = () => state.columns.reduce((sum, n) => sum + n, 0);
// A seat's identity is its column/row, not its current display number.
const seatIds = (columns = state.columns) => columns.flatMap((count, column) => Array.from({ length: count }, (_, row) => `c${column}r${row}`));
const seatNumber = id => seatIds().indexOf(id) + 1;
const personById = id => state.people.find(person => person.id === id);
const eligiblePeople = () => state.people.filter(person => !state.absent.has(person.id));
const newId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, "0")).join("");
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
  return seatIds().filter(id => !occupied.has(id));
}
function drawOne(used) {
  const free = availableSeats(used);
  return free.length ? free[randomInt(free.length)] : null;
}
function notice(message = "") { $("notice").textContent = message; }
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
  const changed = JSON.stringify(columns) !== JSON.stringify(state.columns);
  const oldIds = seatIds(), nextIds = seatIds(columns), nextSet = new Set(nextIds);
  const used = new Set([...state.numberSeats, ...state.assignments.values()]);
  if (oldIds.some(id => !nextSet.has(id) && used.has(id))) {
    $("layout-error").textContent = "すでに決まっている座席が含まれるため、この座席は削除できません。先に該当する抽選をリセットしてください。";
    return;
  }
  const renumbered = state.numberSeats.some(id => oldIds.indexOf(id) !== nextIds.indexOf(id));
  if (renumbered && !confirm("座席番号の対応が変わります。番号くじの抽選結果だけをリセットして変更しますか？ 名前の抽選結果は残ります。")) return;
  if (renumbered) { state.numberSeats = []; state.lastNumber = null; }
  state.columns = columns;
  if (changed) state.offsets.clear();
  $("layout-error").textContent = "";
  $("layout-settings").open = false;
  render();
  notice(renumbered ? "座席配置を変更し、番号くじだけをリセットしました。名前の抽選結果は保持しています。" : changed ? "座席配置を変更しました。既存の抽選結果を保持し、手動位置を標準配置に戻しました。" : "座席構成に変更はありません。");
});
function applyOffset(seat) {
  const offset = state.offsets.get(seat.dataset.seatId) || { x: 0, y: 0 };
  seat.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
}
function moveSeat(seat, dx, dy) {
  const key = seat.dataset.seatId;
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
  const bySeat = new Map([...state.assignments].map(([id, seat]) => [seat, personById(id)?.name]));
  let number = 0;
  state.columns.forEach((count, index) => {
    const column = document.createElement("div"); column.className = "seat-column";
    const label = document.createElement("div"); label.className = "column-label"; label.textContent = `${index + 1}列目`; column.append(label);
    for (let i = 0; i < count; i++) {
      number++;
      const seat = document.createElement("button");
      seat.type = "button"; seat.className = "seat"; seat.dataset.seat = number; seat.dataset.seatId = `c${index}r${i}`;
      const seatId = seat.dataset.seatId;
      seat.tabIndex = state.editing ? 0 : -1;
      const name = state.mode === "name" ? bySeat.get(seatId) : undefined;
      seat.classList.toggle("assigned", used.has(seatId)); seat.classList.toggle("highlight", last === seatId); seat.classList.toggle("has-name", name !== undefined);
      const num = document.createElement("span"); num.className = "seat-number"; num.textContent = `${number}${name !== undefined ? "番" : ""}`; seat.append(num);
      if (name !== undefined) { const text = document.createElement("span"); text.className = "seat-name"; text.textContent = name; seat.append(text); }
      seat.setAttribute("aria-label", `${number}番席${name !== undefined ? `、${name}` : used.has(seatId) ? "、抽選済み" : "、空席"}`);
      applyOffset(seat); column.append(seat);
    }
    board.append(column);
  });
  board.querySelectorAll(".seat").forEach(seat => moveSeat(seat, 0, 0));
}
function renderNames() {
  $("names-form").hidden = state.confirmed;
  $("names-ready").hidden = !state.confirmed;
  const eligible = eligiblePeople(), free = availableSeats(state.assignments.values()).length;
  const tooMany = eligible.length > totalSeats();
  $("names-status").textContent = `名簿 ${state.people.length}人 / 抽選対象 ${eligible.length}人 / 欠席 ${state.absent.size}人。抽選済み ${state.assignments.size}人 / 未配置 ${eligible.length - state.assignments.size}人 / 空席 ${free}席${free === 0 ? "（満席）" : ""}`;
  $("names-error").textContent = state.confirmed && tooMany ? "参加者が座席数を超えています。参加者を変更するか、座席を増やしてください。" : "";
  $("capacity-hint").hidden = !state.confirmed || !tooMany;
  $("shuffle-all").disabled = !eligible.length;
  $("edit-attendance").textContent = state.attendanceEditing ? "欠席者設定を閉じる" : "欠席者を設定";
  $("edit-attendance").setAttribute("aria-expanded", state.attendanceEditing);
  $("attendance-count").textContent = `欠席 ${state.absent.size}人`;
  $("name-buttons").replaceChildren();
  state.people.forEach(({ name, id }) => {
    const item = document.createElement("div"); item.className = "person-item";
    const button = document.createElement("button"); button.textContent = name; button.className = "person-draw";
    const assigned = state.assignments.has(id), absent = state.absent.has(id);
    button.disabled = assigned || absent || free === 0;
    if (absent) {
      const badge = document.createElement("span"); badge.className = "absence-badge"; badge.textContent = "欠席"; button.append(badge);
    } else if (assigned || free === 0) {
      const small = document.createElement("small");
      small.textContent = assigned ? `抽選済み・${seatNumber(state.assignments.get(id))}番席` : "未配置・空席なし";
      button.append(small);
    }
    button.addEventListener("click", () => selectPerson(id));
    const label = document.createElement("label"), checkbox = document.createElement("input");
    checkbox.type = "checkbox"; checkbox.checked = absent;
    checkbox.setAttribute("aria-label", `${name}を欠席（対象外）にする`);
    checkbox.onchange = () => {
      if (checkbox.checked && assigned && !confirm(`${name}さんを欠席にすると、この人の抽選結果を解除します。よろしいですか？`)) { checkbox.checked = false; return; }
      if (checkbox.checked) {
        state.absent.add(id);
        if (state.lastName === state.assignments.get(id)) state.lastName = null;
        state.assignments.delete(id);
      } else state.absent.delete(id);
      render();
      // Restore keyboard focus after rebuilding the list.
      $("name-buttons").querySelectorAll("input")[state.people.findIndex(person => person.id === id)]?.focus({ preventScroll: true });
    };
    label.append(checkbox, "欠席（対象外）");
    label.hidden = !state.attendanceEditing;
    item.classList.toggle("attendance-editing", state.attendanceEditing);
    item.classList.toggle("absent", absent); item.append(button, label); $("name-buttons").append(item);
  });
  renderRosterControls();
}
$("edit-attendance").onclick = () => { state.attendanceEditing = !state.attendanceEditing; renderNames(); };
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
  showDialog({ title: name === undefined ? "あなたは" : `${name}さんは`, number: `${seatNumber(seat)}番！`, note: "座席配置の黄色い席を確認してください。", action: "席を確認・次の人へ", onAction: () => { $("draw-dialog").close(); $("seat-board").scrollIntoView({ block: "center" }); } });
}
$("draw-number").onclick = () => {
  const seat = drawOne(state.numberSeats); if (seat === null) return;
  state.numberSeats.push(seat); state.lastNumber = seat; render(); showResult(seat);
};
function selectPerson(id) {
  if (!personById(id) || state.assignments.has(id) || state.absent.has(id) || !availableSeats(state.assignments.values()).length) return;
  showDialog({ person: `${personById(id).name}さん`, title: "席を引いてください", note: "準備ができたら、下のボタンをタップ！", action: "抽選！", onAction: () => {
    if (!personById(id) || state.assignments.has(id) || state.absent.has(id)) return;
    const seat = drawOne(state.assignments.values()); if (seat === null) { $("draw-dialog").close(); notice("満席のため、これ以上配置できません。座席を追加してください。"); return; }
    state.assignments.set(id, seat); state.lastName = seat; render(); showResult(seat, personById(id).name);
  } });
}
function updateInputCount() {
  const count = namesFromInput().length;
  $("names-count").textContent = `座席は${totalSeats()}席、参加者は${count}人です。${count > totalSeats() ? "座席数を超えていますが抽選できます。超過分は未配置になります。" : count < totalSeats() ? `空席${totalSeats() - count}席で抽選できます。` : "人数が一致しています。"}`;
}
$("names-input").oninput = () => { updateInputCount(); renderRosterControls(); };
$("names-form").onsubmit = event => {
  event.preventDefault(); const people = namesFromInput();
  if (!people.length) { $("names-error").textContent = "参加者を1人以上入力してください。"; return; }
  state.people = peopleFromNames(people); state.absent = new Set([...state.absent].filter(id => state.people.some(person => person.id === id))); state.assignments.clear(); state.lastName = null; state.confirmed = true; render(); notice();
};
$("shuffle-all").onclick = () => {
  const eligible = eligiblePeople();
  if (!eligible.length) return;
  if (state.assignments.size && !confirm("全員の席をシャッフルし直しますか？ 現在の名前の抽選結果は消えます。")) return;
  const seats = shuffled(availableSeats([]));
  state.assignments = new Map(shuffled(eligible).slice(0, seats.length).map((person, index) => [person.id, seats[index]])); state.lastName = null;
  render(); notice(`抽選対象 ${eligible.length}人のうち${state.assignments.size}人を配置しました。未配置 ${eligible.length - state.assignments.size}人。座席配置を確認してください。`); $("seat-board").scrollIntoView({ block: "center" });
};
$("reset-draw").onclick = () => {
  const count = state.mode === "number" ? state.numberSeats.length : state.assignments.size;
  if (!count) { notice("まだ抽選されていません。"); return; }
  if (!confirm("現在のモードの抽選結果を消して、初めからやり直しますか？")) return;
  clearDraws(); render(); notice("抽選をリセットしました。");
};
$("change-names").onclick = () => {
  if (state.assignments.size && !confirm("参加者を変更すると、名前の抽選結果が消えます。変更しますか？")) return;
  state.assignments.clear(); state.lastName = null; state.confirmed = false; state.attendanceEditing = false; render(); updateInputCount(); $("names-input").focus(); notice();
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
// File contents and the explicitly captured arrangement live only in this page's memory.
let currentRoster = null, pendingRoster = null, fileReadSequence = 0, arrangementPendingExport = false;
const clone = value => JSON.parse(JSON.stringify(value));
const sameNames = (people, names) => people.length === names.length && people.every((person, index) => person.name === names[index]);
const samePeople = (a, b) => a.length === b.length && a.every((person, index) => person.id === b[index].id && person.name === b[index].name);
function peopleFromNames(names) {
  if (sameNames(state.people, names)) return clone(state.people);
  if (currentRoster && sameNames(currentRoster.people, names)) return clone(currentRoster.people);
  return names.map(name => ({ id: newId(), name }));
}
function renderRosterControls() {
  $("arrangement-actions").hidden = !state.confirmed;
  $("save-arrangement").disabled = !state.people.length || !sameNames(state.people, namesFromInput());
  const snapshot = currentRoster?.lastArrangement;
  $("roster-status").textContent = !snapshot ? "" : !sameNames(currentRoster.people, namesFromInput()) ? "参加者を変更しています。前回配置を含めるには、名前を確定して「この配置を保存」で更新してください。" : arrangementPendingExport ? "配置を名簿データに反映済みです。端末に残すには「名簿を保存」を押してください。" : "名簿データに前回配置があります。現在の配置で更新する場合は「この配置を保存」を押してください。";
}
$("roster-name").oninput = renderRosterControls;
$("save-roster").onclick = () => {
  notice(); $("file-error").textContent = "";
  const name = $("roster-name").value.trim(), names = namesFromInput();
  if (!name || !names.length) {
    $("file-error").textContent = "名簿名と参加者を1人以上入力してください。";
    $("roster-settings").open = true;
    return;
  }
  const people = peopleFromNames(names);
  const keepArrangement = currentRoster && samePeople(currentRoster.people, people);
  if (currentRoster?.lastArrangement && !keepArrangement && !confirm("参加者情報が変わっているため、前回配置を含めずに書き出しますか？ 含めたい場合は名前を確定し、「この配置を保存」で更新してください。")) return;
  const data = { format: rosterFile.format, version: rosterFile.version, name, people, lastArrangement: keepArrangement ? clone(currentRoster.lastArrangement) : null };
  try {
    const filename = rosterFile.download(data);
    currentRoster = clone(data); arrangementPendingExport = false;
    renderRosterControls();
    notice(`「${filename}」のダウンロードを開始しました。ブラウザで保存先・保存結果を確認してください。開いたファイルは自動更新されません。`);
  } catch (error) { $("file-error").textContent = error.message; }
};
function clearPendingRoster() {
  pendingRoster = null;
  $("roster-import").hidden = true;
  $("roster-import-info").textContent = "";
}
$("open-roster").onclick = () => {
  // Reset the input so choosing the same file again also triggers change.
  $("roster-file-input").value = "";
  $("roster-file-input").click();
};
$("roster-file-input").onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  const sequence = ++fileReadSequence;
  clearPendingRoster(); notice(); $("file-error").textContent = "";
  try {
    const data = await rosterFile.read(file);
    if (sequence !== fileReadSequence) return;
    pendingRoster = data;
    $("roster-settings").open = true;
    $("roster-import-info").textContent = `「${data.name}」（${data.people.length}人）を読み込みます。${data.lastArrangement ? "前回配置を復元するか選んでください。" : "前回配置は含まれていません。"}`;
    $("restore-arrangement").hidden = !data.lastArrangement;
    $("roster-import").hidden = false;
    $("load-roster").focus();
  } catch (error) {
    if (sequence === fileReadSequence) $("file-error").textContent = error.message;
  }
};
$("cancel-import").onclick = () => { fileReadSequence++; clearPendingRoster(); $("open-roster").focus(); };
function loadRoster(restore) {
  const roster = pendingRoster;
  if (!roster || (restore && !roster.lastArrangement)) return;
  notice();
  const arrangement = restore ? roster.lastArrangement : null;
  const nextIds = arrangement ? seatIds(arrangement.columns) : seatIds();
  if (arrangement && state.numberSeats.some(id => !nextIds.includes(id))) {
    $("file-error").textContent = "復元すると番号くじで使用済みの座席が削除されるため、復元できません。先に番号くじの抽選をリセットしてください。";
    return;
  }
  const resetNumbers = arrangement && state.numberSeats.some(id => seatIds().indexOf(id) !== nextIds.indexOf(id));
  if ((namesFromInput().length || currentRoster || resetNumbers) && !confirm(`「${roster.name}」${restore ? "の前回配置を復元" : "の名簿を読み込み"}しますか？ 現在の参加者・欠席設定・名前の抽選結果・書き出し前の名簿データを置き換えます。${resetNumbers ? " 座席番号が変わるため、番号くじの抽選結果もリセットします。" : ""}`)) return;
  state.people = clone(roster.people); state.absent.clear(); state.attendanceEditing = false;
  state.assignments = new Map(arrangement ? arrangement.assignments : []);
  state.lastName = null; state.confirmed = true;
  if (arrangement) {
    state.columns = [...arrangement.columns]; state.offsets = new Map(clone(arrangement.offsets));
    if (resetNumbers) { state.numberSeats = []; state.lastNumber = null; }
    $("column-count").value = state.columns.length;
    $("column-count").dispatchEvent(new Event("input"));
    $("column-fields").replaceChildren(); makeColumnFields(state.columns.length);
    $("layout-error").textContent = "";
  }
  // Roster-only use still retains the file's explicit snapshot for the next export.
  currentRoster = clone(roster); arrangementPendingExport = false;
  clearPendingRoster();
  $("names-input").value = state.people.map(person => person.name).join("\n");
  $("roster-name").value = roster.name;
  $("file-error").textContent = "";
  setMode("name");
  notice(restore ? "前回の配置を復元しました。欠席設定は全員出席に戻しています。" : "名簿を読み込みました。今日の欠席者を設定して抽選できます。");
}
$("load-roster").onclick = () => loadRoster(false);
$("restore-arrangement").onclick = () => loadRoster(true);
$("save-arrangement").onclick = () => {
  if (!state.confirmed || !state.people.length || !sameNames(state.people, namesFromInput())) return;
  if (currentRoster?.lastArrangement && !confirm("名簿データの前回配置を現在の配置で更新しますか？ 端末のファイルはまだ更新されません。")) return;
  currentRoster = {
    format: rosterFile.format, version: rosterFile.version, name: $("roster-name").value.trim(), people: clone(state.people),
    lastArrangement: { columns: [...state.columns], assignments: [...state.assignments], offsets: clone([...state.offsets]), savedAt: new Date().toISOString() },
  };
  arrangementPendingExport = true;
  $("file-error").textContent = "";
  renderRosterControls();
  notice("この配置を名簿データに反映しました。端末に残すには「名簿を保存」を押してください。既存ファイルは自動更新されません。");
};


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
