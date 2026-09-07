const TRAY_LYRICS_BOUNDS = Object.freeze({ width: 720, height: 76 });

function shouldHideToTray(isQuitting) {
  return !isQuitting;
}

module.exports = { TRAY_LYRICS_BOUNDS, shouldHideToTray };
