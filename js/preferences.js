(function () {
  'use strict';

  var panel = document.getElementById('preferences');
  if (!panel) return;

  var store = 'halo-appearance-v1';
  var root = document.documentElement;
  var systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  var theme = document.getElementById('appearanceTheme');
  var size = document.getElementById('appearanceSize');
  var contrast = document.getElementById('appearanceContrast');
  var saved;
  try { saved = JSON.parse(localStorage.getItem(store)); } catch (error) { /* Use os padrões. */ }

  if (saved) {
    theme.value = saved.theme;
    size.value = saved.size;
    contrast.checked = saved.contrast === true;
  }
  if (!theme.value) theme.value = 'system';
  if (!size.value) size.value = 'normal';

  function apply() {
    root.dataset.theme = theme.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme.value;
    root.dataset.textSize = size.value;
    root.toggleAttribute('data-high-contrast', contrast.checked);
  }

  apply();
  if (systemTheme.addEventListener) systemTheme.addEventListener('change', apply);
  else systemTheme.addListener(apply);

  panel.addEventListener('change', function () {
    apply();
    try {
      localStorage.setItem(store, JSON.stringify({ theme: theme.value, size: size.value, contrast: contrast.checked }));
    } catch (error) { /* As preferências continuam válidas nesta aba. */ }
  });

  var disclosures = [panel, document.getElementById('mapStyle')].filter(Boolean);
  disclosures.forEach(function (disclosure) {
    disclosure.addEventListener('toggle', function () {
      if (!disclosure.open) return;
      disclosures.forEach(function (other) {
        if (other !== disclosure) other.open = false;
      });
    });
    disclosure.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !disclosure.open) return;
      event.preventDefault();
      disclosure.open = false;
      disclosure.querySelector('summary').focus();
    });
  });
})();
