/* =====================================================================
 * 模組：QIAGEN 備庫存系統 (stock)  ─ v84
 * ---------------------------------------------------------------------
 * 以 iframe 內嵌外部庫存系統網頁，點左側按鈕即在右側顯示。
 * 權限：permKey = 'stock'，由「成員設定管理 → 成員權限」控管。
 * 要改網址只動下方 STOCK_URL 一行。
 * ===================================================================== */
(function () {
    'use strict';

    var core = null;

    /* ---------- 設定區 ---------- */
    var STOCK_URL = 'https://qiagen-stock-production.up.railway.app/';

    // 未在「成員權限」個別勾選時的預設值
    //   ['creator','senior']         = 僅創世神／高級管理者
    //   ['creator','senior','admin'] = 加上管理者
    //   null                         = 全員預設可見
    var DEFAULT_ACCESS_ROLES = ['creator', 'senior'];

    var loaded = false;

    /* ---------- CSS ---------- */
    var CSS = `
    .btn-stock { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }

    #stockView { height: 100%; }

    /* 標題與按鈕同一列：標題靠左、操作鈕靠右上 */
    #stockView .stock-head {
        display: flex; justify-content: space-between; align-items: flex-start;
        gap: 12px; flex-wrap: wrap; margin-bottom: 10px;
    }
    #stockView .stock-head h1 { margin: 0; font-size: 1.5rem; color: #111827; line-height: 1.3; }
    #stockView .stock-head .sub { font-size: 0.8rem; color: var(--text-light); margin-top: 2px; }
    #stockView .stock-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
    #stockView .stock-btn { padding: 7px 13px; border-radius: 6px; border: 1px solid #bbf7d0; background: #fff; color: #15803d; font-weight: 600; font-size: 0.85rem; cursor: pointer; font-family: inherit; white-space: nowrap; }
    #stockView .stock-btn:hover { background: #f0fdf4; }

    #stockView .stock-frame-wrap { position: relative; flex-grow: 1; min-height: 560px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: #fff; }
    #stockView iframe { width: 100%; height: 100%; border: 0; display: block; }
    #stockView .stock-loading { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; background: #fff; color: var(--primary); font-size: 0.95rem; }
    #stockView .stock-blocked { display: none; padding: 12px 14px; background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 8px; font-size: 0.88rem; line-height: 1.7; margin-bottom: 10px; }

    @media (max-width: 768px) {
        #stockView .stock-head { flex-direction: column; align-items: stretch; }
        #stockView .stock-actions { width: 100%; }
        #stockView .stock-btn { flex: 1; text-align: center; padding: 10px 12px; }
        #stockView .stock-frame-wrap { min-height: 72vh; }
    }
    `;

    /* ---------- HTML ---------- */
    var VIEW_HTML = `
    <div id="stockView" class="view-section">
        <div class="stock-head">
            <div>
                <h1>QIAGEN 備庫存系統</h1>
                <div class="sub">外部系統內嵌畫面</div>
            </div>
            <div class="stock-actions">
                <button class="stock-btn" onclick="StockModule.reload()">🔄 重新載入</button>
                <button class="stock-btn" onclick="StockModule.openExternal()">↗ 新視窗開啟</button>
            </div>
        </div>

        <div class="stock-blocked" id="stockBlocked">
            ⚠️ <b>此頁面無法內嵌顯示</b>　外部系統可能禁止內嵌或需先登入，請改用「新視窗開啟」。
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

    function reload() { loaded = false; loadFrame(); }
    function openExternal() { window.open(STOCK_URL, '_blank', 'noopener'); }

    /* =================================================================
     * 模組定義
     * ================================================================= */
    var StockModule = {
        key: 'stock',
        viewId: 'stockView',
        navButtonId: 'stockBtn',
        navButtonClass: 'btn-stock',

        permKey: 'stock',
        permLabel: '📊 QIAGEN 備庫存系統',
        requiredRoles: DEFAULT_ACCESS_ROLES || undefined,

        init: function (appCore) {
            core = appCore;
            core.injectStyle(CSS);
            core.mountView(VIEW_HTML);
        },

        activate: function () { if (!loaded) loadFrame(); },

        reload: reload,
        openExternal: openExternal
    };

    window.StockModule = StockModule;
    window.AppCore.registerModule(StockModule);
})();
