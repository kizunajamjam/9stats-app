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
            <div class="player-no">${idx + 1}</div>
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

// 選手名の変更保存
function updatePlayerName(index, newName) {
    state.players[index].name = newName;
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

// 設定画面（選手名・背番号・チーム名・日時・会場）を開く
function openSettings() {
    document.getElementById("input-date").value = state.matchInfo.date;
    document.getElementById("input-venue").value = state.matchInfo.venue;
    document.getElementById("input-team").value = state.matchInfo.teamName;
    document.getElementById("input-opponent").value = state.matchInfo.opponent;
    renderRoster();
    document.getElementById("settings-screen").classList.add("open");
}

// 設定画面を閉じてメイン画面に戻る（選手名の変更を反映）
function closeSettings() {
    document.getElementById("settings-screen").classList.remove("open");
    renderPlayers();
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

// マッチリセット
function resetMatch() {
    if (confirm("試合データをすべてリセットしますか？")) {
        initMatch();
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

// CSVエクスポート
function exportCSV() {
    let csvContent = "data:text/csv;charset=utf-8,";

    // 試合情報
    csvContent += `日時,${csvField(state.matchInfo.date)}\n`;
    csvContent += `会場,${csvField(state.matchInfo.venue)}\n`;
    csvContent += `自チーム名,${csvField(state.matchInfo.teamName)}\n`;
    csvContent += `対戦相手,${csvField(state.matchInfo.opponent)}\n`;
    csvContent += "\n";

    // ヘッダー行
    csvContent += "背番号,選手名,サーブエース(P),サーブ失点(M),サーブ成功(A),スパイク得点(P),スパイク失点(M),スパイク決定率(%),レシーブ優(A),レシーブ良(B),レシーブ可(C),レシーブ不可(D),ブロック得点(P),ブロック失点(M),その他得点(P),その他ミス(M)\n";

    // 選手データ
    state.players.forEach(player => {
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

    // ダウンロード処理
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "9stats_player_stats.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 初期化実行
window.onload = startMatch;
