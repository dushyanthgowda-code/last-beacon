window.addEventListener('DOMContentLoaded', function () {
  LB.UI.init();
  // Optional: cache everything for installable offline use when served over http(s).
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
  }
});
