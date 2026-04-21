(function () {
  var _fakeExports = {};
  var _fakeModule  = { exports: _fakeExports };

  try {
    Object.defineProperty(window, 'module', {
      get: function () { return _fakeModule; },
      set: function () { /* absorb re-injection attempts */ },
      configurable: true,
      enumerable:   false
    });
  } catch (_) {
    try { window.module = undefined; } catch (_2) {}
  }

  try { window.exports = undefined; } catch (_) {}

  try {
    if (window.define && typeof window.define === 'function' && window.define.amd) {
      window.define = undefined;
    }
  } catch (_) {}

  window.__recoverUMD = function (globalName) {
    var exp = _fakeModule.exports;
    if (exp && exp !== _fakeExports) {
      if (!window[globalName]) {
        window[globalName] = exp;
      }
    }
    _fakeExports = {};
    _fakeModule.exports = _fakeExports;
  };
}());
