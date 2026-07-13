<script setup>
  import { ref } from 'vue' 
</script>

<template>
  <RouterView/>
</template>

<style>
  /*
    Each theme now also defines --board-light / --board-dark, used to paint
    the actual chessboard squares (see Analysis.vue's :deep(.cg-board) rule),
    so the board itself follows the selected theme instead of staying a fixed
    brown regardless of what's picked in Settings.

    Palette pass: the old blue/green/cherry variants used near-saturated
    "web UI" colors (#0ea5e9, #10b981, #dc2626) that clashed with the
    wood-panel aesthetic. All accent colors below are pulled in toward
    lower saturation / mid brightness so nothing reads as a bright web button.
  */

  :root, [data-theme="brown"] {
    --bg-1: #4b2e12; --bg-2: #6f4518; --bg-3: #7f4f24;
    --panel-1: #8B5A32; --panel-2: #6D4524;
    --list-1: #a57548; --list-2: #7d5530;
    --btn-active: #5e3c20; --btn-idle: #8d5b33;
    --title-btn-active-1: #414833; --title-btn-active-2: #333d29;
    --title-btn-idle-1: #656d4a; --title-btn-idle-2: #414833;
    --text-highlight: #d9b382;
    --board-light: #e8d9b5; --board-dark: #b58863;
  }

  [data-theme="wood"] {
    --bg-1: #2c1e16; --bg-2: #3d2b1f; --bg-3: #543a28;
    --panel-1: #4a3322; --panel-2: #332216;
    --list-1: #63452e; --list-2: #4a3322;
    --btn-active: #2a1c12; --btn-idle: #543a28;
    --title-btn-active-1: #2c3e2e; --title-btn-active-2: #1b261c;
    --title-btn-idle-1: #4a634a; --title-btn-idle-2: #2c3e2e;
    --text-highlight: #e6c8a3;
    --board-light: #d3bd93; --board-dark: #7c5b3b;
  }

  /* Muted slate-blue, replacing the previous bright sky-blue (#0ea5e9 etc). */
  [data-theme="blue"] {
    --bg-1: #1b2836; --bg-2: #24344a; --bg-3: #2f4761;
    --panel-1: #2a3c52; --panel-2: #1c2a3a;
    --list-1: #34495e; --list-2: #263647;
    --btn-active: #3c5e7d; --btn-idle: #4b7291;
    --title-btn-active-1: #2c4257; --title-btn-active-2: #203040;
    --title-btn-idle-1: #4b7291; --title-btn-idle-2: #2c4257;
    --text-highlight: #a9c6d8;
    --board-light: #dbe4ea; --board-dark: #6f8ea3;
  }

  /* Muted plum, replacing the previous bright violet (#8b5cf6 etc). */
  [data-theme="purple"] {
    --bg-1: #241c34; --bg-2: #362a49; --bg-3: #443660;
    --panel-1: #362a49; --panel-2: #251c34;
    --list-1: #443660; --list-2: #332748;
    --btn-active: #5c4a78; --btn-idle: #6f5c8d;
    --title-btn-active-1: #453a5e; --title-btn-active-2: #332a45;
    --title-btn-idle-1: #6f5c8d; --title-btn-idle-2: #453a5e;
    --text-highlight: #baa8d1;
    --board-light: #e3dcee; --board-dark: #8a76a8;
  }

  /* Muted sage/forest, replacing the previous bright emerald (#10b981 etc). */
  [data-theme="green"] {
    --bg-1: #1f2b1f; --bg-2: #2b3c2b; --bg-3: #384f38;
    --panel-1: #2e402e; --panel-2: #202c20;
    --list-1: #3a4f3a; --list-2: #2b3c2b;
    --btn-active: #4a634a; --btn-idle: #5c7a5c;
    --title-btn-active-1: #3a4f3a; --title-btn-active-2: #2b3c2b;
    --title-btn-idle-1: #5c7a5c; --title-btn-idle-2: #3a4f3a;
    --text-highlight: #a3bfa3;
    --board-light: #e6ead9; --board-dark: #7c9470;
  }

  [data-theme="midnight"] {
    --bg-1: #000000; --bg-2: #111111; --bg-3: #222222;
    --panel-1: #1a1a1a; --panel-2: #0a0a0a;
    --list-1: #2a2a2a; --list-2: #1a1a1a;
    --btn-active: #444444; --btn-idle: #5c5c5c;
    --title-btn-active-1: #333333; --title-btn-active-2: #111111;
    --title-btn-idle-1: #4d4d4d; --title-btn-idle-2: #333333;
    --text-highlight: #cfcfcf;
    --board-light: #b8b8b8; --board-dark: #4a4a4a;
  }

  [data-theme="slate"] {
    --bg-1: #2c3644; --bg-2: #3d4a5a; --bg-3: #4f5f70;
    --panel-1: #3d4a5a; --panel-2: #2c3644;
    --list-1: #4f5f70; --list-2: #3d4a5a;
    --btn-active: #5b6d7e; --btn-idle: #728496;
    --title-btn-active-1: #4f5f70; --title-btn-active-2: #3d4a5a;
    --title-btn-idle-1: #728496; --title-btn-idle-2: #4f5f70;
    --text-highlight: #cdd7e0;
    --board-light: #dde3e8; --board-dark: #7c8ea0;
  }

  /* Muted brick, replacing the previous bright red (#dc2626 etc). */
  [data-theme="cherry"] {
    --bg-1: #2e1616; --bg-2: #4a2020; --bg-3: #5c2828;
    --panel-1: #4a2020; --panel-2: #301616;
    --list-1: #5c2828; --list-2: #431d1d;
    --btn-active: #6e3a3a; --btn-idle: #874949;
    --title-btn-active-1: #543030; --title-btn-active-2: #3d2222;
    --title-btn-idle-1: #6e4444; --title-btn-idle-2: #543030;
    --text-highlight: #cf9d9d;
    --board-light: #e8d5cf; --board-dark: #a2645a;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  html, body {
    width: 100%;
    height: 100%;
  }

  body {
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      color: #e6e6e6;
      background: linear-gradient(
        135deg,
        var(--bg-1) 0%,
        var(--bg-2) 45%,
        var(--bg-3) 100%
      );
      line-height: 1.5;
      background-attachment: fixed;
  }

  body, button {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  ol, ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  button {
    font-family: inherit;
    cursor: pointer;
  }

  img {
    max-width: 100%;
    display: block;
  }

  .app-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    max-width: 1600px;
    margin: 0 auto;
    align-items: start;
    padding: 1rem;
    gap: 1rem;
  }
</style>