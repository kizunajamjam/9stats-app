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
    players: [], // 9名の選手データ
    matchInfo: { date: "", venue: "", teamName: "", opponent: "" } // 試合情報（日時・会場・チーム名）
};

// 初期データ設定 (9名)
const defaultPlayerNames = [
    "選手 1", "選手 2", "選手 3", "選手 4", "選手 5",
    "選手 6", "選手 7", "選手 8", "選手 9"
];

const STORAGE_KEY = "9stats_match_state";
const HISTORY_KEY = "9stats_match_history";

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
        if (!Array.isArray(parsed.players) || parsed.players.length !== 9) return false;
        if (!parsed.players.every(p => p.other && p.receive.D !== undefined && p.number !== undefined)) return false;
        if (!parsed.matchInfo) return false;
        state.scores = parsed.scores;
        state.isSecondServe = parsed.isSecondServe;
        state.players = parsed.players;
        state.matchInfo = parsed.matchInfo;
        return true;
    } catch (e) {
        return false;
    }
}

function initMatch() {
    state.scores = { home: 0, away: 0, setsHome: 0, setsAway: 0 };
    state.isSecondServe = false;
    state.players = [];
    state.matchInfo = {
        date: new Date().toISOString().slice(0, 10),
        venue: "",
        teamName: "",
        opponent: ""
    };

    for (let i = 0; i < 9; i++) {
        state.players.push({
            id: i,
            name: defaultPlayerNames[i],
            number: "", // 背番号
            serve: { P: 0, M: 0, A: 0 },   // エース / 失点 / 成功 (A: 成功してラリー継続)
            attack: { P: 0, M: 0 },        // スパイクポイント / スパイク失点
            receive: { A: 0, B: 0, C: 0, D: 0 }, // 優(セッター不動) / 良(セッター動) / 可(アンダー・二段) / 不可(失点)
            block: { P: 0, M: 0 },         // ブロックポイント / ブロック失点（アウト・吸い込み）
            other: { P: 0, M: 0 }          // その他得点（セッターツーアタック等） / その他ミス（ダブルコンタクト・キャッチ・タッチネット等）
        });
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

// 選手リストの描画
function renderPlayers() {
    const listContainer = document.getElementById("players-list");
    listContainer.innerHTML = "";

    state.players.forEach((player, idx) => {
        const row = document.createElement("div");
        row.className = "player-row";
        
        // アタック決定率の計算
        const totalAttack = player.attack.P + player.attack.M;
        const attackRate = totalAttack > 0 ? ((player.attack.P / totalAttack) * 100).toFixed(1) : "0.0";

        row.innerHTML = `
            <div class="player-no">${player.number ? escapeHtml(player.number) : idx + 1}</div>
            <div class="player-name-container">
                <input type="text" class="player-name-input" value="${escapeHtml(player.name)}" onchange="updatePlayerName(${idx}, this.value)">
            </div>

            <!-- サーブ -->
            <div class="btn-group btn-group-serve">
                <button class="stat-btn point" onclick="recordServe(${idx}, 'P')">
                    <span class="count">${player.serve.P}</span>
                </button>
                <button class="stat-btn miss" onclick="recordServe(${idx}, 'M')">
                    <span class="count">${player.serve.M}</span>
                </button>
                <button class="stat-btn" onclick="recordServe(${idx}, 'A')">
                    <span class="count">${player.serve.A}</span>
                </button>
            </div>

            <!-- アタック -->
            <div class="btn-group btn-group-attack">
                <button class="stat-btn point" onclick="recordAttack(${idx}, 'P')">
                    <span class="count">${player.attack.P}</span>
                </button>
                <button class="stat-btn miss" onclick="recordAttack(${idx}, 'M')">
                    <span class="count">${player.attack.M}</span>
                </button>
            </div>

            <!-- 決定率 -->
            <div class="attack-rate-display" id="rate-${idx}">${attackRate}%</div>

            <!-- レシーブ -->
            <div class="btn-group btn-group-receive">
                <button class="stat-btn a" onclick="recordReceive(${idx}, 'A')">
                    <span class="count">${player.receive.A}</span>
                </button>
                <button class="stat-btn b" onclick="recordReceive(${idx}, 'B')">
                    <span class="count">${player.receive.B}</span>
                </button>
                <button class="stat-btn c" onclick="recordReceive(${idx}, 'C')">
                    <span class="count">${player.receive.C}</span>
                </button>
                <button class="stat-btn miss" onclick="recordReceive(${idx}, 'D')">
                    <span class="count">${player.receive.D}</span>
                </button>
            </div>

            <!-- ブロック -->
            <div class="btn-group btn-group-block">
                <button class="stat-btn point" onclick="recordBlock(${idx}, 'P')">
                    <span class="count">${player.block.P}</span>
                </button>
                <button class="stat-btn miss" onclick="recordBlock(${idx}, 'M')">
                    <span class="count">${player.block.M}</span>
                </button>
            </div>

            <!-- その他 -->
            <div class="btn-group btn-group-other">
                <button class="stat-btn point" onclick="recordOther(${idx}, 'P')">
                    <span class="count">${player.other.P}</span>
                </button>
                <button class="stat-btn miss" onclick="recordOther(${idx}, 'M')">
                    <span class="count">${player.other.M}</span>
                </button>
            </div>
        `;
        listContainer.appendChild(row);
    });
}

// 選手名の変更保存（記録画面の表示も更新する）
function updatePlayerName(index, newName) {
    state.players[index].name = newName;
    renderPlayers();
    saveState();
}

// 背番号の変更保存
function updatePlayerNumber(index, newNumber) {
    state.players[index].number = newNumber;
    saveState();
}

// 試合情報（日時・会場・チーム名・対戦相手）の変更保存
function updateMatchInfo(field, value) {
    state.matchInfo[field] = value;
    saveState();
}

// 選手登録リスト（背番号・選手名）の描画
function renderRoster() {
    const rosterList = document.getElementById("roster-list");
    rosterList.innerHTML = "";

    state.players.forEach((player, idx) => {
        const row = document.createElement("div");
        row.className = "roster-row";
        row.innerHTML = `
            <span class="player-no">${idx + 1}</span>
            <input type="text" class="roster-number-input" value="${escapeHtml(player.number)}" placeholder="番号" onchange="updatePlayerNumber(${idx}, this.value)">
            <input type="text" class="roster-name-input" value="${escapeHtml(player.name)}" placeholder="選手名" onchange="updatePlayerName(${idx}, this.value)">
        `;
        rosterList.appendChild(row);
    });
}

// スコアUIの更新
function updateScoreUI() {
    document.getElementById("score-home").innerText = state.scores.home;
    document.getElementById("score-away").innerText = state.scores.away;
    document.getElementById("sets-home").innerText = state.scores.setsHome;
    document.getElementById("sets-away").innerText = state.scores.setsAway;
}

// 手動スコア調整
function adjustScore(side, amount) {
    state.scores[side] = Math.max(0, state.scores[side] + amount);

    // セット進行管理 (21点先取・2点差が必要)
    const other = side === 'home' ? 'away' : 'home';
    const leadScore = state.scores[side];
    const otherScore = state.scores[other];
    if (leadScore >= 21 && leadScore - otherScore >= 2) {
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

// --- スタッツ記録ロジック ---

// サーブ記録（9人制専用サーブ2本制ルール）
function recordServe(playerIdx, type) {
    const player = state.players[playerIdx];
    
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
    } else if (type === 'A') {
        // サーブ成功（ラリー開始）
        player.serve.A += 1;
        resetServeState();
    }

    renderPlayers();
    saveState();
}

// アタック記録（スパイクポイント / スパイク失点）
function recordAttack(playerIdx, type) {
    const player = state.players[playerIdx];
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
function recordReceive(playerIdx, type) {
    const player = state.players[playerIdx];
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
function recordBlock(playerIdx, type) {
    const player = state.players[playerIdx];
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
function recordOther(playerIdx, type) {
    const player = state.players[playerIdx];
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

// マッチリセット（選手名・背番号・試合情報は保持し、スコアとスタッツのみ初期化）
function resetMatch() {
    if (confirm("スコアとスタッツをリセットしますか？（選手名・背番号・試合情報は保持されます）")) {
        state.scores = { home: 0, away: 0, setsHome: 0, setsAway: 0 };
        state.isSecondServe = false;
        state.players.forEach(player => {
            player.serve = { P: 0, M: 0, A: 0 };
            player.attack = { P: 0, M: 0 };
            player.receive = { A: 0, B: 0, C: 0, D: 0 };
            player.block = { P: 0, M: 0 };
            player.other = { P: 0, M: 0 };
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

// CSV本文の生成（試合情報 + 選手スタッツ）
function buildCSVContent(matchInfo, players) {
    let csvContent = "data:text/csv;charset=utf-8,";

    // 試合情報
    csvContent += `日時,${csvField(matchInfo.date)}\n`;
    csvContent += `会場,${csvField(matchInfo.venue)}\n`;
    csvContent += `自チーム名,${csvField(matchInfo.teamName)}\n`;
    csvContent += `対戦相手,${csvField(matchInfo.opponent)}\n`;
    csvContent += "\n";

    // ヘッダー行
    csvContent += "背番号,選手名,サーブエース(P),サーブ失点(M),サーブ成功(A),スパイク得点(P),スパイク失点(M),スパイク決定率(%),レシーブ優(A),レシーブ良(B),レシーブ可(C),レシーブ不可(D),ブロック得点(P),ブロック失点(M),その他得点(P),その他ミス(M)\n";

    // 選手データ
    players.forEach(player => {
        const totalAttack = player.attack.P + player.attack.M;
        const attackRate = totalAttack > 0 ? ((player.attack.P / totalAttack) * 100).toFixed(1) : "0.0";

        const row = [
            csvField(player.number),
            csvField(player.name),
            player.serve.P, player.serve.M, player.serve.A,
            player.attack.P, player.attack.M,
            attackRate,
            player.receive.A, player.receive.B, player.receive.C, player.receive.D,
            player.block.P, player.block.M,
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

// CSVエクスポート（現在記録中の試合）
function exportCSV() {
    const csvContent = buildCSVContent(state.matchInfo, state.players);
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
        players: JSON.parse(JSON.stringify(state.players))
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

    const rows = match.players.map(player => {
        const totalAttack = player.attack.P + player.attack.M;
        const attackRate = totalAttack > 0 ? ((player.attack.P / totalAttack) * 100).toFixed(1) : "0.0";
        return `
            <tr>
                <td>${escapeHtml(player.number)}</td>
                <td>${escapeHtml(player.name)}</td>
                <td>${player.serve.P}</td><td>${player.serve.M}</td><td>${player.serve.A}</td>
                <td>${player.attack.P}</td><td>${player.attack.M}</td><td>${attackRate}%</td>
                <td>${player.receive.A}</td><td>${player.receive.B}</td><td>${player.receive.C}</td><td>${player.receive.D}</td>
                <td>${player.block.P}</td><td>${player.block.M}</td>
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
                        <th>サP</th><th>サM</th><th>サA</th>
                        <th>アP</th><th>アM</th><th>率</th>
                        <th>レA</th><th>レB</th><th>レC</th><th>レD</th>
                        <th>ブP</th><th>ブM</th>
                        <th>他P</th><th>他M</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;

    document.getElementById("history-detail-csv-btn").onclick = () => {
        const csvContent = buildCSVContent(info, match.players);
        downloadCSV(csvContent, `9stats_${info.date || "match"}.csv`);
    };
}

// 初期化実行
window.onload = function () {
    startMatch();
    goHome();
};
