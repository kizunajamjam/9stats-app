// Vstats Pro - 9-Player Mode Logic

// 試合セッション状態管理
const state = {
    scores: {
        home: 0,
        away: 0,
        setsHome: 0,
        setsAway: 0
    },
    isSecondServe: false, // サーブ試行回数フラグ (9人制ルール)
    roster: [],   // 登録選手（最大20名）: {id, number, name}
    lineup: [],   // 出場中9スロット分のroster idを格納する配列
    nextId: 0,    // 選手登録用の連番ID
    matchInfo: { date: "", venue: "", teamName: "", opponent: "" }, // 試合情報（日時・会場・チーム名）
    rules: { targetScore: 21, deuceMargin: 2, setsToWin: 2 }, // セットルール（点数・デュース差・試合に必要な先取セット数）
    sets: [],          // セットごとのスタッツ: [{ stats: { [rosterId]: statsObj }, lineup? }]
    currentSetIndex: 0, // 現在記録中（ライブ）のセット
    viewingSetIndex: 0, // 記録画面で表示中のセット（タブ切り替えで変わる）
    historyId: null     // 現在の試合を保存した実績レコードのid（再保存は新規追加せず上書きする）
};

const MAX_ROSTER_SIZE = 20;
const LINEUP_SIZE = 9;

// 初期データ設定
const defaultPlayerNames = [
    "選手 1", "選手 2", "選手 3", "選手 4", "選手 5",
    "選手 6", "選手 7", "選手 8", "選手 9"
];

const STORAGE_KEY = "9stats_match_state";
const HISTORY_KEY = "9stats_match_history";

// --- Undo（直前の操作を最大UNDO_LIMIT件まで取り消せる） ---

const UNDO_LIMIT = 15;
const undoStack = [];

// 操作前のスナップショットを記録
function pushUndoSnapshot() {
    undoStack.push(JSON.stringify({
        scores: state.scores,
        isSecondServe: state.isSecondServe,
        sets: state.sets,
        currentSetIndex: state.currentSetIndex,
        viewingSetIndex: state.viewingSetIndex,
        lineup: state.lineup
    }));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    updateUndoButtonState();
}

// 直前の操作を取り消す
function undoLastAction() {
    const snapshotJson = undoStack.pop();
    if (!snapshotJson) return;
    const snapshot = JSON.parse(snapshotJson);
    state.scores = snapshot.scores;
    state.isSecondServe = snapshot.isSecondServe;
    state.sets = snapshot.sets;
    state.currentSetIndex = snapshot.currentSetIndex;
    state.viewingSetIndex = snapshot.viewingSetIndex;
    state.lineup = snapshot.lineup;

    saveState();
    updateScoreUI();
    renderPlayers();
    updateServeIndicator();
    updateUndoButtonState();
}

// Undoボタンの有効/無効を更新
function updateUndoButtonState() {
    const btn = document.getElementById("undo-btn");
    if (btn) btn.disabled = undoStack.length === 0;
}

// --- 記録画面用の確認・通知・メモ入力ダイアログ ---
// 標準のconfirm/alert/promptは画面の向き（横向き固定）に合わせて回転しないため、
// 記録画面用の操作にはこの自作ダイアログを使う。Promiseで結果を返す。

let appDialogResolve = null;

function showAppDialog({ title = "", message = "", showInput = false, defaultValue = "", showCancel = true, okText = "OK", cancelText = "キャンセル" }) {
    return new Promise(resolve => {
        appDialogResolve = resolve;
        document.getElementById("app-dialog-title").textContent = title;
        document.getElementById("app-dialog-message").textContent = message;

        const input = document.getElementById("app-dialog-input");
        input.style.display = showInput ? "block" : "none";
        input.value = defaultValue;

        document.getElementById("app-dialog-cancel-btn").style.display = showCancel ? "inline-block" : "none";
        document.getElementById("app-dialog-cancel-btn").textContent = cancelText;
        document.getElementById("app-dialog-ok-btn").textContent = okText;

        document.getElementById("app-dialog-overlay").style.display = "flex";
        if (showInput) input.focus();
    });
}

// ダイアログのOK/キャンセルボタンから呼ばれる。confirmedがfalsyならnullを返す
function resolveAppDialog(confirmed) {
    document.getElementById("app-dialog-overlay").style.display = "none";
    const resolve = appDialogResolve;
    appDialogResolve = null;
    if (!resolve) return;

    if (!confirmed) {
        resolve(null);
        return;
    }
    const input = document.getElementById("app-dialog-input");
    resolve(input.style.display === "none" ? true : input.value);
}

// --- 画面遷移（ホーム / 記録 / 設定 / 実績） ---

const SCREEN_IDS = ["home-screen", "record-screen", "settings-screen", "history-screen", "help-screen"];

function showScreen(activeId) {
    SCREEN_IDS.forEach(id => {
        document.getElementById(id).style.display = (id === activeId) ? "flex" : "none";
    });
    // 横向き固定（縦持ち時の回転）は記録画面のみに適用する
    document.documentElement.classList.toggle("force-landscape", activeId === "record-screen");
}

function goHome() {
    showScreen("home-screen");
}

function goRecord() {
    showScreen("record-screen");
}

function goSettings() {
    document.getElementById("input-date").value = state.matchInfo.date;
    document.getElementById("input-venue").value = state.matchInfo.venue;
    document.getElementById("input-team").value = state.matchInfo.teamName;
    document.getElementById("input-opponent").value = state.matchInfo.opponent;
    document.getElementById("input-target-score").value = state.rules.targetScore;
    document.getElementById("input-deuce-margin").value = state.rules.deuceMargin;
    document.getElementById("input-sets-to-win").value = state.rules.setsToWin;
    renderRoster();
    showScreen("settings-screen");
}

function goHistory() {
    showHistoryList();
    showScreen("history-screen");
}

function goHelp() {
    showScreen("help-screen");
}

// 試合状態の保存（試合中のリロード/再起動でデータを失わないようにする）
function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// 保存済み状態の復元。無ければ新規初期化。
function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;

    try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed.roster) || parsed.roster.length < 1 || parsed.roster.length > MAX_ROSTER_SIZE) return false;
        if (!Array.isArray(parsed.lineup) || parsed.lineup.length !== LINEUP_SIZE) return false;
        if (!parsed.roster.every(p => p.id !== undefined && p.number !== undefined && p.name !== undefined)) return false;
        if (!parsed.matchInfo) return false;
        if (!Array.isArray(parsed.sets) || parsed.sets.length < 1) return false;
        if (!parsed.sets.every(s => s && typeof s.stats === "object")) return false;
        if (typeof parsed.currentSetIndex !== "number" || parsed.currentSetIndex < 0 || parsed.currentSetIndex >= parsed.sets.length) return false;

        state.scores = parsed.scores;
        state.isSecondServe = parsed.isSecondServe;
        state.roster = parsed.roster;
        state.lineup = parsed.lineup;
        state.nextId = typeof parsed.nextId === "number"
            ? parsed.nextId
            : (parsed.roster.reduce((max, p) => Math.max(max, p.id), -1) + 1);
        state.matchInfo = parsed.matchInfo;
        state.rules = (parsed.rules && typeof parsed.rules.targetScore === "number" && typeof parsed.rules.deuceMargin === "number")
            ? { targetScore: parsed.rules.targetScore, deuceMargin: parsed.rules.deuceMargin, setsToWin: typeof parsed.rules.setsToWin === "number" ? parsed.rules.setsToWin : 2 }
            : { targetScore: 21, deuceMargin: 2, setsToWin: 2 };
        state.sets = parsed.sets;
        state.currentSetIndex = parsed.currentSetIndex;
        state.viewingSetIndex = (typeof parsed.viewingSetIndex === "number" && parsed.viewingSetIndex >= 0 && parsed.viewingSetIndex < parsed.sets.length)
            ? parsed.viewingSetIndex
            : parsed.currentSetIndex;
        state.historyId = typeof parsed.historyId === "number" ? parsed.historyId : null;
        return true;
    } catch (e) {
        return false;
    }
}

// スタッツの初期値オブジェクトを生成
function createEmptyStats() {
    return {
        serve: { P: 0, M: 0 },                // エース / 失点
        receive: { A: 0, B: 0, C: 0, D: 0 },  // 優 / 良 / 可 / 不可(失点)
        attack: { P: 0, M: 0 },               // スパイクポイント / スパイク失点
        block: { P: 0, M: 0 },                // ブロックポイント / ブロック失点
        other: { P: 0, M: 0 }                 // その他得点 / その他ミス
    };
}

// 選手登録メンバーを1人生成（識別情報のみ。スタッツはセットごとに別管理する）
function createRosterMember(name, number) {
    return {
        id: state.nextId++,
        number: number || "",
        name: name
    };
}

// 指定セット・選手のスタッツを取得（無ければ作成して書き込む。記録系の更新でのみ使用）
function getOrCreateSetStats(setIndex, rosterId) {
    const set = state.sets[setIndex];
    if (!set.stats[rosterId]) {
        set.stats[rosterId] = createEmptyStats();
    }
    return set.stats[rosterId];
}

// 指定セット・選手のスタッツを参照のみ行う（表示用。未記録なら空の値を返す）
function peekSetStats(setIndex, rosterId) {
    const set = state.sets[setIndex];
    if (set && set.stats[rosterId]) return set.stats[rosterId];
    return createEmptyStats();
}

function initMatch() {
    state.scores = { home: 0, away: 0, setsHome: 0, setsAway: 0 };
    state.isSecondServe = false;
    state.roster = [];
    state.lineup = [];
    state.nextId = 0;
    state.matchInfo = {
        date: new Date().toISOString().slice(0, 10),
        venue: "",
        teamName: "",
        opponent: ""
    };
    state.rules = { targetScore: 21, deuceMargin: 2, setsToWin: 2 };
    state.sets = [{ stats: {} }];
    state.currentSetIndex = 0;
    state.viewingSetIndex = 0;
    state.historyId = null;

    for (let i = 0; i < LINEUP_SIZE; i++) {
        const member = createRosterMember(defaultPlayerNames[i], "");
        state.roster.push(member);
        state.lineup.push(member.id);
    }

    saveState();
    updateScoreUI();
    renderPlayers();
    updateServeIndicator();
}

// 保存データがあれば復元、無ければ新規開始
function startMatch() {
    if (loadState()) {
        updateScoreUI();
        renderPlayers();
        updateServeIndicator();
    } else {
        initMatch();
    }
}

// HTMLエスケープ（選手名インジェクション対策）
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// roster idから選手データを取得
function getRosterMember(id) {
    return state.roster.find(p => p.id === id);
}

// セット切り替えタブの描画（ヘッダーにコンパクト表示。自チーム取得=青 / 相手取得=橙 / 進行中=灰）
// メモが入っているセットには右上に小さい点を付ける
function renderSetTabs() {
    const tabsEl = document.getElementById("set-tabs");
    if (!tabsEl) return;
    tabsEl.innerHTML = state.sets.map((set, idx) => {
        const isActive = idx === state.viewingSetIndex;
        let winClass = "";
        if (set.winner === "home") winClass = " won-home";
        else if (set.winner === "away") winClass = " won-away";
        const noteDot = set.note ? `<span class="set-tab-note-dot"></span>` : "";
        return `<button class="set-tab-btn${isActive ? " active" : ""}${winClass}" onclick="switchViewingSet(${idx})">${idx + 1}${noteDot}</button>`;
    }).join("");
}

// 表示中のセットを切り替え、そのセットのメモを入力・編集するダイアログを開く
async function switchViewingSet(idx) {
    if (idx < 0 || idx >= state.sets.length) return;
    state.viewingSetIndex = idx;
    renderPlayers();

    const note = await showAppDialog({
        title: `セット${idx + 1}のメモ`,
        showInput: true,
        defaultValue: state.sets[idx].note || ""
    });
    if (note === null) return;

    state.sets[idx].note = note;
    saveState();
    renderSetTabs();
}

// スタッツ記録セル12列分のHTMLを生成（記録中セットならボタン、それ以外なら閲覧専用表示）
function buildStatCellsHtml(playerId, stats, isLive) {
    const cells = [
        { cls: "g-serve point", fn: "recordServe", arg: "'P'", val: stats.serve.P },
        { cls: "g-serve miss", fn: "recordServe", arg: "'M'", val: stats.serve.M },
        { cls: "g-receive a", fn: "recordReceive", arg: "'A'", val: stats.receive.A },
        { cls: "g-receive b", fn: "recordReceive", arg: "'B'", val: stats.receive.B },
        { cls: "g-receive c", fn: "recordReceive", arg: "'C'", val: stats.receive.C },
        { cls: "g-receive miss", fn: "recordReceive", arg: "'D'", val: stats.receive.D },
        { cls: "g-attack point", fn: "recordAttack", arg: "'P'", val: stats.attack.P },
        { cls: "g-attack miss", fn: "recordAttack", arg: "'M'", val: stats.attack.M },
        { cls: "g-block point", fn: "recordBlock", arg: "'P'", val: stats.block.P },
        { cls: "g-block miss", fn: "recordBlock", arg: "'M'", val: stats.block.M },
        { cls: "g-other point", fn: "recordOther", arg: "'P'", val: stats.other.P },
        { cls: "g-other miss", fn: "recordOther", arg: "'M'", val: stats.other.M }
    ];
    return cells.map(c => isLive
        ? `<button class="cell-btn ${c.cls}" onclick="${c.fn}(${playerId}, ${c.arg})"><span class="count">${c.val}</span></button>`
        : `<div class="cell-btn readonly ${c.cls}"><span class="count">${c.val}</span></div>`
    ).join("");
}

// 選手リストの描画（出場中の9スロット分。表示中セットが記録中セットなら編集可、過去セットなら閲覧専用）
function renderPlayers() {
    renderSetTabs();

    const listContainer = document.getElementById("players-list");
    listContainer.innerHTML = "";

    const isLive = state.viewingSetIndex === state.currentSetIndex;
    const viewedSet = state.sets[state.viewingSetIndex];
    const lineupForView = isLive ? state.lineup : (viewedSet.lineup || state.lineup);

    lineupForView.forEach((rosterId, idx) => {
        const player = getRosterMember(rosterId);
        const row = document.createElement("div");
        row.className = "player-row";

        if (!player) {
            // 交代で選手が外れたままの空きスロット
            const noCell = isLive
                ? `<button class="player-no-btn" onclick="openSubPicker(${idx})">-</button>`
                : `<span class="player-no-btn readonly">-</span>`;
            row.innerHTML = `
                ${noCell}
                <div class="player-name-container"><span class="player-empty-label">未設定</span></div>
                ${buildStatCellsHtml(null, createEmptyStats(), false)}
            `;
            listContainer.appendChild(row);
            return;
        }

        const stats = peekSetStats(state.viewingSetIndex, player.id);
        const noCell = isLive
            ? `<button class="player-no-btn" onclick="openSubPicker(${idx})">${escapeHtml(player.number)}</button>`
            : `<span class="player-no-btn readonly">${escapeHtml(player.number)}</span>`;

        row.innerHTML = `
            ${noCell}
            <div class="player-name-container">
                <span class="player-name-display">${escapeHtml(player.name)}</span>
            </div>
            ${buildStatCellsHtml(player.id, stats, isLive)}
        `;
        listContainer.appendChild(row);
    });
}

// 選手名の変更保存（記録画面の表示も更新する）
function updateRosterName(rosterId, newName) {
    const player = getRosterMember(rosterId);
    if (player) player.name = newName;
    renderPlayers();
    saveState();
}

// 背番号が他の選手と重複していないか確認
function isNumberDuplicate(number, excludeRosterId) {
    if (!number) return false; // 空欄は重複チェック対象外
    return state.roster.some(p => p.id !== excludeRosterId && p.number === number);
}

// 背番号の変更保存（重複している場合は拒否する）
function updateRosterNumber(rosterId, newNumber) {
    const player = getRosterMember(rosterId);
    if (!player) return;

    if (newNumber && isNumberDuplicate(newNumber, rosterId)) {
        alert(`背番号「${newNumber}」は既に他の選手が使用しています。`);
        renderRoster();
        return;
    }

    player.number = newNumber;
    renderPlayers();
    renderRoster();
    saveState();
}

// 試合情報（日時・会場・チーム名・対戦相手）の変更保存
function updateMatchInfo(field, value) {
    state.matchInfo[field] = value;
    saveState();
}

// セットルール（点数・デュース差・先取セット数）の変更保存
function updateRule(field, value) {
    let num = parseInt(value, 10);
    if (isNaN(num)) {
        num = field === "targetScore" ? 21 : (field === "setsToWin" ? 2 : 0);
    }
    if (field === "targetScore" && num < 1) num = 1;
    if (field === "deuceMargin" && num < 0) num = 0;
    if (field === "setsToWin" && num < 1) num = 1;
    state.rules[field] = num;
    saveState();
}

// 選手登録リスト（最大20名・背番号・選手名）の描画
function renderRoster() {
    document.getElementById("roster-count").textContent = `(${state.roster.length}/${MAX_ROSTER_SIZE})`;
    document.getElementById("roster-add-btn").disabled = state.roster.length >= MAX_ROSTER_SIZE;

    const rosterList = document.getElementById("roster-list");
    rosterList.innerHTML = "";

    state.roster.forEach((player) => {
        const inLineup = state.lineup.includes(player.id);
        const row = document.createElement("div");
        row.className = "roster-row";
        row.innerHTML = `
            <span class="roster-status${inLineup ? " active" : ""}">${inLineup ? "出場" : "ベンチ"}</span>
            <input type="text" class="roster-number-input" value="${escapeHtml(player.number)}" placeholder="番号" onchange="updateRosterNumber(${player.id}, this.value)">
            <input type="text" class="roster-name-input" value="${escapeHtml(player.name)}" placeholder="選手名" onchange="updateRosterName(${player.id}, this.value)">
        `;
        rosterList.appendChild(row);
    });
}

// 選手登録の追加（最大20名まで）
function addRosterPlayer() {
    if (state.roster.length >= MAX_ROSTER_SIZE) return;
    const member = createRosterMember(`選手 ${state.roster.length + 1}`, "");
    state.roster.push(member);
    saveState();
    renderRoster();
}

// --- 選手交代（出場スロットの入れ替え） ---

// 交代候補（ベンチ）選手を選ぶ画面を開く
function openSubPicker(slotIndex) {
    const benchPlayers = state.roster.filter(p => !state.lineup.includes(p.id));
    const listEl = document.getElementById("sub-modal-list");

    if (benchPlayers.length === 0) {
        listEl.innerHTML = `<div class="history-empty-msg">交代可能な選手がいません。設定画面で選手を追加してください。</div>`;
    } else {
        listEl.innerHTML = benchPlayers.map(p => `
            <button class="sub-modal-item" onclick="substitutePlayer(${slotIndex}, ${p.id})">${p.number ? escapeHtml(p.number) + " " : ""}${escapeHtml(p.name)}</button>
        `).join("");
    }

    document.getElementById("sub-modal-overlay").style.display = "flex";
}

function closeSubPicker() {
    document.getElementById("sub-modal-overlay").style.display = "none";
}

// 出場スロットの選手を入れ替える
function substitutePlayer(slotIndex, rosterId) {
    pushUndoSnapshot();
    state.lineup[slotIndex] = rosterId;
    saveState();
    renderPlayers();
    closeSubPicker();
}

// スコアUIの更新
function updateScoreUI() {
    document.getElementById("score-home").innerText = state.scores.home;
    document.getElementById("score-away").innerText = state.scores.away;
}

// 手動スコア調整（ヘッダーの+/-ボタン用。Undoスナップショットを記録してから調整する）
function manualAdjustScore(side, amount) {
    pushUndoSnapshot();
    adjustScore(side, amount);
}

// スコア調整の内部処理（スタッツ記録系からも呼ばれるため、ここではUndo記録は行わない）
function adjustScore(side, amount) {
    state.scores[side] = Math.max(0, state.scores[side] + amount);

    updateScoreUI();
    resetServeState();
    renderPlayers();
    saveState();

    // セット進行管理（設定画面で指定したセット点数・デュース差を使用）
    const other = side === 'home' ? 'away' : 'home';
    const leadScore = state.scores[side];
    const otherScore = state.scores[other];
    if (leadScore >= state.rules.targetScore && leadScore - otherScore >= state.rules.deuceMargin) {
        confirmSetEnd(side);
    }
}

// セット終了の確認ダイアログを表示し、確定したらセットを終了して次のセットの記録を始める
async function confirmSetEnd(side) {
    const confirmed = await showAppDialog({
        title: `セット${state.currentSetIndex + 1}を終了しますか？`,
        message: `自:${state.scores.home} 相:${state.scores.away}`
    });
    if (!confirmed) return;

    if (side === 'home') {
        state.scores.setsHome += 1;
    } else {
        state.scores.setsAway += 1;
    }
    state.scores.home = 0;
    state.scores.away = 0;

    // 終了したセットに勝者とその時点のラインアップを記録し、新しいセットの記録を開始する
    state.sets[state.currentSetIndex].winner = side;
    state.sets[state.currentSetIndex].lineup = JSON.parse(JSON.stringify(state.lineup));
    state.sets.push({ stats: {} });
    state.currentSetIndex += 1;
    state.viewingSetIndex = state.currentSetIndex;

    updateScoreUI();
    renderPlayers();
    saveState();

    // 先取セット数に達したら試合終了を通知する（保存・リセットは「終了」ボタンで行う）
    if (state.scores.setsHome >= state.rules.setsToWin || state.scores.setsAway >= state.rules.setsToWin) {
        await showAppDialog({
            title: "試合終了です！",
            message: `セット ${state.scores.setsHome}-${state.scores.setsAway}\n「終了」ボタンで記録を保存してください。`,
            showCancel: false
        });
    }
}

// サーブ状態表示更新
function updateServeIndicator() {
    const dot = document.getElementById("serve-status-dot");
    const text = document.getElementById("serve-status-text");
    if (state.isSecondServe) {
        dot.className = "status-dot second-serve";
        text.innerText = "2nd";
    } else {
        dot.className = "status-dot";
        text.innerText = "1st";
    }
}

// サーブ状態のリセット
function resetServeState() {
    state.isSecondServe = false;
    updateServeIndicator();
}

// --- スタッツ記録ロジック（roster idを直接指定する） ---

// サーブ記録（9人制専用サーブ2本制ルール）
function recordServe(rosterId, type) {
    const player = getRosterMember(rosterId);
    if (!player) return;
    pushUndoSnapshot();
    const stats = getOrCreateSetStats(state.currentSetIndex, rosterId);

    if (type === 'P') {
        // サーブ得点：得点加算、自チームに+1点、サーブ状態リセット
        stats.serve.P += 1;
        adjustScore('home', 1);
        resetServeState();
    } else if (type === 'M') {
        // サーブミス
        stats.serve.M += 1;
        if (!state.isSecondServe) {
            // 1回目：エラーのみインクリメント、失点しない、2ndサーブ移行
            state.isSecondServe = true;
            updateServeIndicator();
        } else {
            // 2回目（セカンドサーブミス）：相手得点に+1、1stサーブリセット
            adjustScore('away', 1);
            resetServeState();
        }
    }

    renderPlayers();
    saveState();
}

// アタック記録（スパイクポイント / スパイク失点）
function recordAttack(rosterId, type) {
    const player = getRosterMember(rosterId);
    if (!player) return;
    pushUndoSnapshot();
    const stats = getOrCreateSetStats(state.currentSetIndex, rosterId);
    stats.attack[type] += 1;

    if (type === 'P') {
        adjustScore('home', 1); // スパイクポイント
    } else if (type === 'M') {
        adjustScore('away', 1); // スパイク失点
    }

    resetServeState();
    renderPlayers();
    saveState();
}

// レシーブ記録（A:優 / B:良 / C:可 / D:不可=失点）
function recordReceive(rosterId, type) {
    const player = getRosterMember(rosterId);
    if (!player) return;
    pushUndoSnapshot();
    const stats = getOrCreateSetStats(state.currentSetIndex, rosterId);
    stats.receive[type] += 1;

    // レシーブ不可（D）は相手得点
    if (type === 'D') {
        adjustScore('away', 1);
    }

    resetServeState();
    renderPlayers();
    saveState();
}

// ブロック記録（ブロックポイント / ブロック失点）
function recordBlock(rosterId, type) {
    const player = getRosterMember(rosterId);
    if (!player) return;
    pushUndoSnapshot();
    const stats = getOrCreateSetStats(state.currentSetIndex, rosterId);
    stats.block[type] += 1;

    if (type === 'P') {
        adjustScore('home', 1); // ブロックポイント
    } else if (type === 'M') {
        adjustScore('away', 1); // ブロック失点（アウト・吸い込み等）
    }

    resetServeState();
    renderPlayers();
    saveState();
}

// その他記録（セッターツーアタック等の得点 / ダブルコンタクト・キャッチ・タッチネット等のミス）
function recordOther(rosterId, type) {
    const player = getRosterMember(rosterId);
    if (!player) return;
    pushUndoSnapshot();
    const stats = getOrCreateSetStats(state.currentSetIndex, rosterId);
    stats.other[type] += 1;

    if (type === 'P') {
        adjustScore('home', 1);
    } else if (type === 'M') {
        adjustScore('away', 1);
    }

    resetServeState();
    renderPlayers();
    saveState();
}

// スコア・セットスタッツの初期化処理（リセットと試合終了の両方から共通で使う）
function resetScoresAndStats() {
    state.scores = { home: 0, away: 0, setsHome: 0, setsAway: 0 };
    state.isSecondServe = false;
    state.sets = [{ stats: {} }];
    state.currentSetIndex = 0;
    state.viewingSetIndex = 0;
    state.historyId = null;
}

// マッチリセット（選手登録・背番号・試合情報は保持し、スコアとスタッツのみ初期化）
async function resetMatch() {
    const confirmed = await showAppDialog({
        title: "リセットしますか？",
        message: "スコアとスタッツをリセットします。選手登録・背番号・試合情報は保持されます。"
    });
    if (!confirmed) return;

    pushUndoSnapshot();
    resetScoresAndStats();

    saveState();
    updateScoreUI();
    renderPlayers();
    updateServeIndicator();
}

// 試合終了（現在の記録を履歴に保存してから、次の試合のためにスコア・スタッツをリセットする）
async function endMatch() {
    const confirmed = await showAppDialog({
        title: "試合を終了しますか？",
        message: `記録を保存します（セット ${state.scores.setsHome}-${state.scores.setsAway}）`
    });
    if (!confirmed) return;

    saveMatchSnapshotToHistory();

    pushUndoSnapshot();
    resetScoresAndStats();
    saveState();
    updateScoreUI();
    renderPlayers();
    updateServeIndicator();

    goHome();
}

// CSV用フィールドエスケープ（カンマ・改行・ダブルクオートを含む値に対応）
function csvField(value) {
    const str = String(value);
    if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// CSV本文の生成（試合情報 + 登録選手スタッツ）
function buildCSVContent(matchInfo, players) {
    let csvContent = "data:text/csv;charset=utf-8,";

    // 試合情報
    csvContent += `日時,${csvField(matchInfo.date)}\n`;
    csvContent += `会場,${csvField(matchInfo.venue)}\n`;
    csvContent += `自チーム名,${csvField(matchInfo.teamName)}\n`;
    csvContent += `対戦相手,${csvField(matchInfo.opponent)}\n`;
    csvContent += "\n";

    // ヘッダー行
    csvContent += "背番号,選手名,サーブ本数,サーブエース(P),サーブ失点(M),レシーブ優(A),レシーブ良(B),レシーブ可(C),レシーブ不可(D),スパイク決定率(%),スパイク本数,スパイク得点(P),スパイク失点(M),ブロック本数,ブロック得点(P),ブロック失点(M),その他得点(P),その他ミス(M)\n";

    // 選手データ
    players.forEach(player => {
        const serveTotal = player.serve.P + player.serve.M;
        const totalAttack = player.attack.P + player.attack.M;
        const attackRate = totalAttack > 0 ? ((player.attack.P / totalAttack) * 100).toFixed(1) : "0.0";
        const blockTotal = player.block.P + player.block.M;

        const row = [
            csvField(player.number),
            csvField(player.name),
            serveTotal, player.serve.P, player.serve.M,
            player.receive.A, player.receive.B, player.receive.C, player.receive.D,
            attackRate, totalAttack, player.attack.P, player.attack.M,
            blockTotal, player.block.P, player.block.M,
            player.other.P, player.other.M
        ].join(",");

        csvContent += row + "\n";
    });

    return csvContent;
}

// CSVのダウンロード処理
function downloadCSV(csvContent, filename) {
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- 実績（試合履歴）---

// 履歴一覧の読み込み
function loadHistory() {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (!saved) return [];
    try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

// 履歴一覧の保存
function saveHistory(history) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// 登録選手ごとに全セット分のスタッツを合算する（実績保存・CSV出力は通算成績で表示するため）
function computeTotalsForRoster(roster, sets) {
    return roster.map(player => {
        const total = createEmptyStats();
        sets.forEach(set => {
            const s = set.stats[player.id];
            if (!s) return;
            total.serve.P += s.serve.P; total.serve.M += s.serve.M;
            total.receive.A += s.receive.A; total.receive.B += s.receive.B;
            total.receive.C += s.receive.C; total.receive.D += s.receive.D;
            total.attack.P += s.attack.P; total.attack.M += s.attack.M;
            total.block.P += s.block.P; total.block.M += s.block.M;
            total.other.P += s.other.P; total.other.M += s.other.M;
        });
        return { number: player.number, name: player.name, ...total };
    });
}

// 現在記録中の試合を履歴に保存する（選手スタッツは全セット通算）。実績画面・試合終了の両方から呼ばれる
// 同じ試合を再度保存した場合は新規レコードを追加せず、既存レコードを上書き更新する
function saveMatchSnapshotToHistory() {
    const history = loadHistory();
    const snapshot = {
        updatedAt: new Date().toISOString(),
        matchInfo: JSON.parse(JSON.stringify(state.matchInfo)),
        scores: JSON.parse(JSON.stringify(state.scores)),
        roster: computeTotalsForRoster(state.roster, state.sets)
    };

    const existingIndex = state.historyId !== null ? history.findIndex(m => m.id === state.historyId) : -1;
    if (existingIndex !== -1) {
        history[existingIndex] = { id: state.historyId, ...snapshot };
    } else {
        state.historyId = Date.now();
        history.unshift({ id: state.historyId, ...snapshot });
    }

    saveHistory(history);
    saveState();
}

// 保存日時の表示用フォーマット（未保存・不正な値は"-"を返す）
function formatDateTime(isoStr) {
    const d = new Date(isoStr);
    if (!isoStr || isNaN(d.getTime())) return "-";
    return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// 履歴の削除
function deleteHistoryMatch(id) {
    if (!confirm("この試合の記録を削除しますか？")) return;
    const history = loadHistory().filter(m => m.id !== id);
    saveHistory(history);
    showHistoryList();
}

// 履歴一覧画面の表示
function showHistoryList() {
    document.getElementById("history-detail-view").style.display = "none";
    document.getElementById("history-list-view").style.display = "block";
    renderHistoryList();
}

// 履歴一覧の描画
function renderHistoryList() {
    const history = loadHistory();
    const listEl = document.getElementById("history-list");

    if (history.length === 0) {
        listEl.innerHTML = `<div class="history-empty-msg">保存された試合記録はまだありません。</div>`;
        return;
    }

    listEl.innerHTML = "";
    history.forEach(match => {
        const info = match.matchInfo || {};
        const opponentLabel = info.opponent ? `対 ${escapeHtml(info.opponent)}` : "対戦相手未設定";
        const teamLabel = info.teamName ? escapeHtml(info.teamName) : "自チーム";

        const item = document.createElement("div");
        item.className = "history-item";
        item.innerHTML = `
            <div class="history-item-info" onclick="showHistoryDetail(${match.id})">
                <div class="history-item-title">${escapeHtml(info.date || "")} ${teamLabel} ${opponentLabel}</div>
                <div>セット ${match.scores.setsHome}-${match.scores.setsAway}（最終 ${match.scores.home}-${match.scores.away}）${info.venue ? " / " + escapeHtml(info.venue) : ""}</div>
                <div class="history-item-updated">最終更新: ${formatDateTime(match.updatedAt)}</div>
            </div>
            <button class="history-item-delete" onclick="deleteHistoryMatch(${match.id})">削除</button>
        `;
        listEl.appendChild(item);
    });
}

// 履歴詳細画面の表示
function showHistoryDetail(id) {
    const match = loadHistory().find(m => m.id === id);
    if (!match) return;

    document.getElementById("history-list-view").style.display = "none";
    document.getElementById("history-detail-view").style.display = "block";

    const info = match.matchInfo || {};
    document.getElementById("history-detail-summary").innerHTML = `
        <div>日時: ${escapeHtml(info.date || "-")}　会場: ${escapeHtml(info.venue || "-")}</div>
        <div>${escapeHtml(info.teamName || "自チーム")} vs ${escapeHtml(info.opponent || "対戦相手未設定")}</div>
        <div>セット ${match.scores.setsHome}-${match.scores.setsAway}（最終スコア ${match.scores.home}-${match.scores.away}）</div>
        <div class="history-item-updated">最終更新: ${formatDateTime(match.updatedAt)}</div>
    `;

    const roster = match.roster || [];
    const rows = roster.map(player => {
        const serveTotal = player.serve.P + player.serve.M;
        const totalAttack = player.attack.P + player.attack.M;
        const attackRate = totalAttack > 0 ? ((player.attack.P / totalAttack) * 100).toFixed(1) : "0.0";
        const blockTotal = player.block.P + player.block.M;
        return `
            <tr>
                <td>${escapeHtml(player.number)}</td>
                <td>${escapeHtml(player.name)}</td>
                <td>${serveTotal}</td><td>${player.serve.P}</td><td>${player.serve.M}</td>
                <td>${player.receive.A}</td><td>${player.receive.B}</td><td>${player.receive.C}</td><td>${player.receive.D}</td>
                <td>${attackRate}%</td><td>${totalAttack}</td><td>${player.attack.P}</td><td>${player.attack.M}</td>
                <td>${blockTotal}</td><td>${player.block.P}</td><td>${player.block.M}</td>
                <td>${player.other.P}</td><td>${player.other.M}</td>
            </tr>
        `;
    }).join("");

    document.getElementById("history-detail-table").innerHTML = `
        <div class="history-detail-table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>番</th><th>名</th>
                        <th>サ</th><th>サP</th><th>サM</th>
                        <th>レA</th><th>レB</th><th>レC</th><th>レD</th>
                        <th>率</th><th>ス</th><th>アP</th><th>アM</th>
                        <th>ブ</th><th>ブP</th><th>ブM</th>
                        <th>他P</th><th>他M</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;

    document.getElementById("history-detail-csv-btn").onclick = () => {
        const csvContent = buildCSVContent(info, roster);
        downloadCSV(csvContent, `9stats_${info.date || "match"}.csv`);
    };
}

// 初期化実行
window.onload = function () {
    startMatch();
    updateUndoButtonState();
    goHome();
};
