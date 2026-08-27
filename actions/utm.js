/* UTM capture + propagation module
   ---------------------------------
   - captureUTM(): on every page load, reads utm_* params from URL and saves to
     localStorage under 'zenedu_utm' with 30-day expiry. Only the params that
     actually exist in the URL are saved. If no UTM in URL — does NOT touch
     existing stored record.
   - appendUTMToUrl(baseUrl): reads stored UTM (if present and not expired) and
     appends them as query params to baseUrl, returning the decorated URL.
     Failsafe: any error → returns baseUrl unchanged.
*/
(function () {
  var STORAGE_KEY = 'zenedu_utm';
  var TTL_DAYS = 30;
  var FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

  function captureUTM() {
    try {
      var params = new URLSearchParams(window.location.search);
      var utm = {};
      var hasAny = false;
      FIELDS.forEach(function (f) {
        var v = params.get(f);
        if (v) {
          utm[f] = v;
          hasAny = true;
        }
      });
      if (!hasAny) return; /* don't clobber existing record */
      var record = {
        utm: utm,
        expires: Date.now() + TTL_DAYS * 86400 * 1000
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch (e) { /* storage unavailable — silently no-op */ }
  }

  function appendUTMToUrl(baseUrl) {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return baseUrl;
      var data = JSON.parse(raw);
      if (!data || !data.expires || data.expires < Date.now()) {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        return baseUrl;
      }
      if (!data.utm || typeof data.utm !== 'object') return baseUrl;
      var keys = Object.keys(data.utm);
      if (!keys.length) return baseUrl;
      var u = new URL(baseUrl);
      keys.forEach(function (k) {
        if (data.utm[k]) u.searchParams.set(k, data.utm[k]);
      });
      return u.toString();
    } catch (e) {
      return baseUrl;
    }
  }

  /* Expose globally so cart code can decorate URLs at click time */
  window.captureUTM = captureUTM;
  window.appendUTMToUrl = appendUTMToUrl;

  /* Auto-run on every load */
  if (document.readyState !== 'loading') {
    captureUTM();
  } else {
    document.addEventListener('DOMContentLoaded', captureUTM);
  }
})();
