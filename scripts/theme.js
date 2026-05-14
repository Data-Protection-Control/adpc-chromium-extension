(function () {
  // Hide until theme is resolved to prevent flash
  document.documentElement.style.visibility = 'hidden';

  chrome.storage.local.get('themePreference', function (data) {
    document.documentElement.dataset.theme = data.themePreference || 'system';
    document.documentElement.style.visibility = '';
  });

  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.themePreference) {
      document.documentElement.dataset.theme = changes.themePreference.newValue || 'system';
    }
  });
}());
