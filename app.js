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
    players: [] // 9名の選手データ
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
        state.scores = parsed.scores;
        state.isSecondServe = parsed.isSecondServe;
        state.players = parsed.players;
        return true;
    } catch (e) {
        return false;
    }
}

function initMatch() {
    state.scores = { home: 0, away: 0, setsHome: 0, setsAway: 0 };
    state.isSecondServe = false;
    state.players = [];

    for (let i = 0; i < 9; i++) {
        state.players.push({
            id: i,
            name: defaultPlayerNames[i],
            serve: { P: 0, M: 0, A: 0 },   // 得点 / エラー / 成功 (A: Attempt/Success)
            attack: { A: 0, B: 0, C: 0, D: 0 }, // 得点 / 被ブロック / ミス / その他
            receive: { A: 0, B: 0, C: 0 }, // ス / P / M (A: 優 / B: 良 / C: 誤)
            block: { P: 0, T: 0, M: 0 }    // 得点 / ワンタッチ / ミス
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
        const totalAttack = player.attack.A + player.attack.B + player.attack.C + player.attack.D;
        const attackRate = totalAttack > 0 ? ((player.attack.A / totalAttack) * 100).toFixed(1) : "0.0";

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
                <button class="stat-btn point" onclick="recordAttack(${idx}, 'A')">
                    <span class="count">${player.attack.A}</span>
                </button>
                <button class="stat-btn blocked" onclick="recordAttack(${idx}, 'B')">
                    <span class="count">${player.attack.B}</span>
                </button>
                <button class="stat-btn miss" onclick="recordAttack(${idx}, 'C')">
                    <span class="count">${player.attack.C}</span>
                </button>
                <button class="stat-btn" onclick="recordAttack(${idx}, 'D')">
                    <span class="count">${player.attack.D}</span>
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
            </div>
            
            <!-- ブロック -->
            <div class="btn-group btn-group-block">
                <button class="stat-btn point" onclick="recordBlock(${idx}, 'P')">
                    <span class="count">${player.block.P}</span>
                </button>
                <button class="stat-btn touch" onclick="recordBlock(${idx}, 'T')">
                    <span class="count">${player.block.T}</span>
                </button>
                <button class="stat-btn miss" onclick="recordBlock(${idx}, 'M')">
                    <span class="count">${player.block.M}</span>
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

// アタック記録
function recordAttack(playerIdx, type) {
    const player = state.players[playerIdx];
    player.attack[type] += 1;
    
    if (type === 'A') {
        adjustScore('home', 1); // アタック得点
    } else if (type === 'B' || type === 'C') {
        adjustScore('away', 1); // アタック失点（被ブロック/ミス）
    }
    
    resetServeState();
    renderPlayers();
    saveState();
}

// レシーブ記録
function recordReceive(playerIdx, type) {
    const player = state.players[playerIdx];
    player.receive[type] += 1;
    
    // レシーブエラー（不可）は相手得点
    if (type === 'C') {
        adjustScore('away', 1);
    }
    
    resetServeState();
    renderPlayers();
    saveState();
}

// ブロック記録
function recordBlock(playerIdx, type) {
    const player = state.players[playerIdx];
    player.block[type] += 1;
    
    if (type === 'P') {
        adjustScore('home', 1); // ブロック得点
    } else if (type === 'M') {
        adjustScore('away', 1); // 吸い込みミス等による失点
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

    // ヘッダー行
    csvContent += "選手名,サーブ得点(P),サーブ失策(M),サーブ成功(A),アタック得点(A),アタック被ブ(B),アタック失策(C),アタック他(D),アタック決定率(%),レシーブ優(A),レシーブ良(B),レシーブ不可(C),ブロック得点(P),ブロックワンタッチ(T),ブロック吸込失策(M)\n";

    // 選手データ
    state.players.forEach(player => {
        const totalAttack = player.attack.A + player.attack.B + player.attack.C + player.attack.D;
        const attackRate = totalAttack > 0 ? ((player.attack.A / totalAttack) * 100).toFixed(1) : "0.0";

        const row = [
            csvField(player.name),
            player.serve.P, player.serve.M, player.serve.A,
            player.attack.A, player.attack.B, player.attack.C, player.attack.D,
            attackRate,
            player.receive.A, player.receive.B, player.receive.C,
            player.block.P, player.block.T, player.block.M
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
