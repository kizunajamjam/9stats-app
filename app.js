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
    roster: [],   // 登録選手（最大20名）: {id, number, name, serve, attack, receive, block, other}
    lineup: [],   // 出場中9スロット分のroster idを格納する配列
    nextId: 0,    // 選手登録用の連番ID
    matchInfo: { date: "", venue: "", teamName: "", opponent: "" }, // 試合情報（日時・会場・チーム名）
    rules: { targetScore: 21, deuceMargin: 2 } // セットルール（点数・デュース差）
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
        roster: state.roster,
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
    state.roster = snapshot.roster;
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

// --- 画面遷移（ホーム / 記録 / 設定 / 実績） ---

const SCREEN_IDS = ["home-screen", "record-screen", "settings-screen", "history-screen"];

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
    renderRoster();
    showScreen("settings-screen");
}

function goHistory() {
    showHistoryList();
    showScreen("history-screen");
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
        if (!parsed.roster.every(p => p.id !== undefined && p.number !== undefined && p.other && p.receive && p.receive.D !== undefined)) return false;
        if (!parsed.matchInfo) return false;

        state.scores = parsed.scores;
        state.isSecondServe = parsed.isSecondServe;
        state.roster = parsed.roster;
        state.lineup = parsed.lineup;
        state.nextId = typeof parsed.nextId === "number"
            ? parsed.nextId
            : (parsed.roster.reduce((max, p) => Math.max(max, p.id), -1) + 1);
        state.matchInfo = parsed.matchInfo;
        state.rules = (parsed.rules && typeof parsed.rules.targetScore === "number" && typeof parsed.rules.deuceMargin === "number")
            ? parsed.rules
            : { targetScore: 21, deuceMargin: 2 };
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

// 選手登録メンバーを1人生成
function createRosterMember(name, number) {
    const member = {
        id: state.nextId++,
        number: number || "",
        name: name
    };
    Object.assign(member, createEmptyStats());
    return member;
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
    state.rules = { targetScore: 21, deuceMargin: 2 };

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

// 選手リストの描画（出場中の9スロット分）
function renderPlayers() {
    const listContainer = document.getElementById("players-list");
    listContainer.innerHTML = "";

    state.lineup.forEach((rosterId, idx) => {
        const player = getRosterMember(rosterId);
        const row = document.createElement("div");
        row.className = "player-row";

        if (!player) {
            // 交代で選手が外れたままの空きスロット
            row.innerHTML = `
                <button class="player-no-btn" onclick="openSubPicker(${idx})">-</button>
                <div class="player-name-container"><span class="player-empty-label">未設定</span></div>
                <div></div><div></div>
                <div></div><div></div><div></div><div></div>
                <div></div><div></div>
                <div></div><div></div>
                <div></div><div></div>
            `;
            listContainer.appendChild(row);
            return;
        }

        row.innerHTML = `
            <button class="player-no-btn" onclick="openSubPicker(${idx})">${escapeHtml(player.number)}</button>
            <div class="player-name-container">
                <input type="text" class="player-name-input" value="${escapeHtml(player.name)}" onchange="updateRosterName(${player.id}, this.value)">
            </div>

            <!-- サービス: エース / 失点 -->
            <button class="cell-btn g-serve point" onclick="recordServe(${player.id}, 'P')"><span class="count">${player.serve.P}</span></button>
            <button class="cell-btn g-serve miss" onclick="recordServe(${player.id}, 'M')"><span class="count">${player.serve.M}</span></button>

            <!-- レシーブ: 優 / 良 / 可 / 不可 -->
            <button class="cell-btn g-receive a" onclick="recordReceive(${player.id}, 'A')"><span class="count">${player.receive.A}</span></button>
            <button class="cell-btn g-receive b" onclick="recordReceive(${player.id}, 'B')"><span class="count">${player.receive.B}</span></button>
            <button class="cell-btn g-receive c" onclick="recordReceive(${player.id}, 'C')"><span class="count">${player.receive.C}</span></button>
            <button class="cell-btn g-receive miss" onclick="recordReceive(${player.id}, 'D')"><span class="count">${player.receive.D}</span></button>

            <!-- アタック: 得点 / 失点 -->
            <button class="cell-btn g-attack point" onclick="recordAttack(${player.id}, 'P')"><span class="count">${player.attack.P}</span></button>
            <button class="cell-btn g-attack miss" onclick="recordAttack(${player.id}, 'M')"><span class="count">${player.attack.M}</span></button>

            <!-- ブロック: 得点 / 失点 -->
            <button class="cell-btn g-block point" onclick="recordBlock(${player.id}, 'P')"><span class="count">${player.block.P}</span></button>
            <button class="cell-btn g-block miss" onclick="recordBlock(${player.id}, 'M')"><span class="count">${player.block.M}</span></button>

            <!-- その他: 得点 / ミス -->
            <button class="cell-btn g-other point" onclick="recordOther(${player.id}, 'P')"><span class="count">${player.other.P}</span></button>
            <button class="cell-btn g-other miss" onclick="recordOther(${player.id}, 'M')"><span class="count">${player.other.M}</span></button>
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

// セットルール（点数・デュース差）の変更保存
function updateRule(field, value) {
    let num = parseInt(value, 10);
    if (isNaN(num)) {
        num = field === "targetScore" ? 21 : 2;
    }
    if (field === "targetScore" && num < 1) num = 1;
    if (field === "deuceMargin" && num < 0) num = 0;
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
    document.getElementById("sets-home").innerText = state.scores.setsHome;
    document.getElementById("sets-away").innerText = state.scores.setsAway;
}

// 手動スコア調整（ヘッダーの+/-ボタン用。Undoスナップショットを記録してから調整する）
function manualAdjustScore(side, amount) {
    pushUndoSnapshot();
    adjustScore(side, amount);
}

// スコア調整の内部処理（スタッツ記録系からも呼ばれるため、ここではUndo記録は行わない）
function adjustScore(side, amount) {
    state.scores[side] = Math.max(0, state.scores[side] + amount);

    // セット進行管理（設定画面で指定したセット点数・デュース差を使用）
    const other = side === 'home' ? 'away' : 'home';
    const leadScore = state.scores[side];
    const otherScore = state.scores[other];
    if (leadScore >= state.rules.targetScore && leadScore - otherScore >= state.rules.deuceMargin) {
        if (side === 'home') {
            state.scores.setsHome += 1;
        } else {
            state.scores.setsAway += 1;
        }
        state.scores.home = 0;
        state.scores.away = 0;
    }

    updateScoreUI();
    resetServeState();
    saveState();
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

    if (type === 'P') {
        // サーブ得点：得点加算、自チームに+1点、サーブ状態リセット
        player.serve.P += 1;
        adjustScore('home', 1);
        resetServeState();
    } else if (type === 'M') {
        // サーブミス
        player.serve.M += 1;
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
    player.attack[type] += 1;

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
    player.receive[type] += 1;

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
    player.block[type] += 1;

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
    player.other[type] += 1;

    if (type === 'P') {
        adjustScore('home', 1);
    } else if (type === 'M') {
        adjustScore('away', 1);
    }

    resetServeState();
    renderPlayers();
    saveState();
}

// マッチリセット（選手登録・背番号・試合情報は保持し、スコアとスタッツのみ初期化）
function resetMatch() {
    if (confirm("スコアとスタッツをリセットしますか？（選手登録・背番号・試合情報は保持されます）")) {
        pushUndoSnapshot();
        state.scores = { home: 0, away: 0, setsHome: 0, setsAway: 0 };
        state.isSecondServe = false;
        state.roster.forEach(player => {
            Object.assign(player, createEmptyStats());
        });

        saveState();
        updateScoreUI();
        renderPlayers();
        updateServeIndicator();
    }
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

// CSVエクスポート（現在記録中の試合・登録選手全員分）
function exportCSV() {
    const csvContent = buildCSVContent(state.matchInfo, state.roster);
    downloadCSV(csvContent, "9stats_player_stats.csv");
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

// 現在記録中の試合を履歴に保存
function saveCurrentMatchToHistory() {
    const history = loadHistory();
    history.unshift({
        id: Date.now(),
        savedAt: new Date().toISOString(),
        matchInfo: JSON.parse(JSON.stringify(state.matchInfo)),
        scores: JSON.parse(JSON.stringify(state.scores)),
        roster: JSON.parse(JSON.stringify(state.roster)),
        lineup: JSON.parse(JSON.stringify(state.lineup))
    });
    saveHistory(history);
    showHistoryList();
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
