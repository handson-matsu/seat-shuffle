/* Versioned roster files. Validation and browser downloads only; no network or persistent browser storage. */
"use strict";
const rosterFile = (() => {
  const format = "seat-shuffle-roster", version = 1;
  const maxBytes = 5 * 1024 * 1024;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const nonempty = value => typeof value === "string" && value.trim().length > 0;
  const assert = condition => { if (!condition) throw new Error("名簿ファイルの内容が正しくありません。参加者や座席のデータを確認してください。現在の作業内容は変更していません。"); };
  function validate(data) {
    assert(object(data) && data.format === format);
    if (data.version !== version) throw new Error("この名簿ファイルのバージョンには対応していません。現在の作業内容は変更していません。");
    assert(nonempty(data.name) && data.name === data.name.trim());
    assert(Array.isArray(data.people) && data.people.length > 0);
    const people = new Set();
    for (const person of data.people) {
      assert(object(person) && nonempty(person.id) && nonempty(person.name) && person.name === person.name.trim() && !/[\r\n]/.test(person.name));
      assert(!people.has(person.id)); people.add(person.id);
    }
    const arrangement = data.lastArrangement;
    if (arrangement !== null) {
      assert(object(arrangement) && Array.isArray(arrangement.columns));
      const columns = arrangement.columns;
      assert(columns.length >= 1 && columns.length <= 20 && columns.every(n => Number.isInteger(n) && n >= 1 && n <= 100));
      assert(columns.reduce((sum, n) => sum + n, 0) <= 200);
      const seats = new Set(columns.flatMap((count, column) => Array.from({ length: count }, (_, row) => `c${column}r${row}`)));
      assert(Array.isArray(arrangement.assignments) && Array.isArray(arrangement.offsets));
      const assignedPeople = new Set(), assignedSeats = new Set(), offsetSeats = new Set();
      for (const pair of arrangement.assignments) {
        assert(Array.isArray(pair) && pair.length === 2);
        const [person, seat] = pair;
        assert(people.has(person) && seats.has(seat) && !assignedPeople.has(person) && !assignedSeats.has(seat));
        assignedPeople.add(person); assignedSeats.add(seat);
      }
      for (const pair of arrangement.offsets) {
        assert(Array.isArray(pair) && pair.length === 2);
        const [seat, offset] = pair;
        assert(seats.has(seat) && !offsetSeats.has(seat) && object(offset));
        assert([offset.x, offset.y].every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1000000));
        offsetSeats.add(seat);
      }
      assert(typeof arrangement.savedAt === "string" && Number.isFinite(Date.parse(arrangement.savedAt)));
    }
    // Copy only the supported fields, so extra fields (including attendance) never enter exports.
    return {
      format, version, name: data.name,
      people: data.people.map(({ id, name }) => ({ id, name })),
      lastArrangement: arrangement === null ? null : {
        columns: [...arrangement.columns], assignments: arrangement.assignments.map(pair => [...pair]),
        offsets: arrangement.offsets.map(([id, { x, y }]) => [id, { x, y }]), savedAt: arrangement.savedAt,
      },
    };
  }
  async function read(file) {
    if (!/\.json$/i.test(file.name)) throw new Error("席替え用のJSONファイル（.json）を選択してください。");
    if (file.size > maxBytes) throw new Error("ファイルが大きすぎます。5MB以内の名簿ファイルを選択してください。");
    let text;
    try { text = await file.text(); }
    catch { throw new Error("ファイルを読み込めませんでした。もう一度ファイルを選択してください。"); }
    let data;
    try { data = JSON.parse(text.replace(/^\uFEFF/, "")); }
    catch { throw new Error("JSONを読み取れません。ファイルが破損しているか、JSON形式ではありません。現在の作業内容は変更していません。"); }
    return validate(data);
  }
  function download(data) {
    const clean = validate(data);
    const blob = new Blob([JSON.stringify(clean, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
    if (blob.size > maxBytes) throw new Error("名簿データが5MBを超えるため書き出せません。参加者情報を減らしてください。");
    const safeName = [...clean.name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")].slice(0, 60).join("").replace(/[. ]+$/g, "") || "名簿";
    const filename = `${safeName}_席替え.json`;
    let url;
    const link = document.createElement("a");
    try {
      url = URL.createObjectURL(blob);
      link.href = url; link.download = filename;
      document.body.append(link); link.click();
    } catch { throw new Error("名簿ファイルを書き出せませんでした。ブラウザのダウンロード設定を確認し、もう一度お試しください。"); }
    finally {
      link.remove();
      // Allow mobile browsers time to consume the URL before releasing it.
      if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    return filename;
  }
  return { format, version, validate, read, download };
})();
