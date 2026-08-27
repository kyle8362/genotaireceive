/* =====================================================================
 * 模組：QIAGEN 備庫存系統 (stock)
 * ---------------------------------------------------------------------
 * 以 iframe 內嵌外部庫存系統網頁，點左側按鈕即在右側顯示，
 * 不需跳出本系統。
 *
 * 權限：宣告 permKey = 'stock'，
 *       「成員設定管理 → 成員權限」會自動長出勾選框，
 *       未勾選的帳號看不到按鈕，也無法進入此分頁。
 *
 * 要改網址只動下方 STOCK_URL 一行。
 * ===================================================================== */
(function () {
    'use strict';

    var core = null;

    /* ---------- 設定區 ---------- */
    var STOCK_URL = 'https://qiagen-stock-production.up.railway.app/';

    // 未在「成員權限」個別勾選時的預設值。
    //   ['creator','senior']            = 僅創世神／高級管理者預設可見
    //   ['creator','senior','admin']    = 加上管理者
    //   null                            = 全員預設可見
    // 一旦管理員在成員權限勾／取消，勾選結果優先於此。
    var DEFAULT_ACCESS_ROLES = ['creator', 'senior'];

    var loaded = false;   // 首次進入才載入 iframe，平時不佔資源

    /* ---------- CSS（全部以 #stockView 收斂） ---------- */
    var CSS = `
    .btn-stock { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }

    #stockView { height: 100%; }
    #stockView header { margin-bottom: 1rem; }
    #stockView .stock-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
    #stockView .stock-btn { padding: 8px 14px; border-radius: 6px; border: 1px solid #bbf7d0; background: #fff; color: #15803d; font-weight: 600; font-size: 0.88rem; cursor: pointer; font-family: inherit; white-space: nowrap; }
    #stockView .stock-btn:hover { background: #f0fdf4; }
    #stockView .stock-hint { font-size: 0.8rem; color: var(--text-light); }

    #stockView .stock-frame-wrap { position: relative; flex-grow: 1; min-height: 480px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: #fff; }
    #stockView iframe { width: 100%; height: 100%; border: 0; display: block; }
    #stockView .stock-loading { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px; background: #fff; color: var(--primary); font-size: 0.95rem; }
    #stockView .stock-blocked { display: none; padding: 1.25rem; background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 8px; font-size: 0.9rem; line-height: 1.8; margin-bottom: 12px; }

    @media (max-width: 768px) {
        #stockView .stock-frame-wrap { min-height: 70vh; }
        #stockView .stock-btn { flex-grow: 1; text-align: center; padding: 11px 14px; }
    }
    `;

    /* ---------- HTML ---------- */
    var VIEW_HTML = `
    <div id="stockView" class="view-section">
        <header>
            <h1>QIAGEN 備庫存系統</h1>
            <div class="date-header">外部系統內嵌畫面</div>
        </header>

        <div class="stock-blocked" id="stockBlocked">
            ⚠️ <b>此頁面無法內嵌顯示</b><br>
            外部系統可能設定了禁止內嵌的安全標頭，或需要先登入。<br>
            請改用下方「在新視窗開啟」按鈕操作。
        </div>

        <div class="stock-toolbar">
            <button class="stock-btn" onclick="StockModule.reload()">🔄 重新載入</button>
            <button class="stock-btn" onclick="StockModule.openExternal()">↗ 在新視窗開啟</button>
            <span class="stock-hint">若畫面空白或要求登入，請先用「在新視窗開啟」登入一次。</span>
        </div>

        <div class="stock-frame-wrap" id="stockFrameWrap">
            <iframe id="stockFrame" title="QIAGEN 備庫存系統"
                    referrerpolicy="no-referrer-when-downgrade"
                    allow="clipboard-read; clipboard-write"></iframe>
            <div class="stock-loading" id="stockLoading">⏳ 載入中...</div>
        </div>
    </div>`;

    /* =================================================================
     * iframe 控制
     * ================================================================= */
    function showLoading(show) {
        var el = document.getElementById('stockLoading');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    function loadFrame() {
        var frame = document.getElementById('stockFrame');
        if (!frame) return;
        showLoading(true);
        document.getElementById('stockBlocked').style.display = 'none';

        frame.onload = function () { showLoading(false); };
        frame.onerror = function () { showBlocked(); };
        frame.src = STOCK_URL;
        loaded = true;

        // 若 8 秒仍未觸發 onload，判定為被外部系統阻擋
        setTimeout(function () {
            var l = document.getElementById('stockLoading');
            if (l && l.style.display !== 'none') showBlocked();
        }, 8000);
    }

    function showBlocked() {
        showLoading(false);
        var b = document.getElementById('stockBlocked');
        if (b) b.style.display = 'block';
    }

    function reload() {
        loaded = false;
        loadFrame();
    }

    function openExternal() {
        window.open(STOCK_URL, '_blank', 'noopener');
    }

    /* =================================================================
     * 模組定義
     * ================================================================= */
    var StockModule = {
        key: 'stock',
        viewId: 'stockView',
        navButtonId: 'stockBtn',
        navButtonClass: 'btn-stock',

        // 讓「成員設定管理 → 成員權限」自動長出這一項勾選框
        permKey: 'stock',
        permLabel: '📊 QIAGEN 備庫存系統',
        requiredRoles: DEFAULT_ACCESS_ROLES || undefined,

        init: function (appCore) {
            core = appCore;
            core.injectStyle(CSS);
            core.mountView(VIEW_HTML);
        },

        // 切到此分頁時才載入 iframe
        activate: function () {
            if (!loaded) loadFrame();
        },

        /* --- 對外 API（HTML onclick 用） --- */
        reload: reload,
        openExternal: openExternal
    };

    window.StockModule = StockModule;
    window.AppCore.registerModule(StockModule);
})();
