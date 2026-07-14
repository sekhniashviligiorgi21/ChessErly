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

  [data-theme="midnight"] {
    --bg-1: #000000; --bg-2: #111111; --bg-3: #222222;
    --panel-1: #1a1a1a; --panel-2: #0a0a0a;
    --list-1: #2a2a2a; --list-2: #1a1a1a;
    --btn-active: #444444; 
    --btn-idle: #5c5c5c;
    --title-btn-active-1: #333333; 
    --title-btn-active-2: #111111;
    --title-btn-idle-1: #4d4d4d; 
    --title-btn-idle-2: #333333;
    --text-highlight: #cfcfcf;
    --board-light: #b8b8b8; 
    --board-dark: #4a4a4a;
  }

  [data-theme="wood"] {
    --bg-1: #241a12; --bg-2: #3a2818; --bg-3: #58402a;
    --panel-1: #4a3320; --panel-2: #2e2013;
    --list-1: #6b4b30; --list-2: #4a3320;
    --btn-active: #2a1c10; --btn-idle: #6b4b30;
    --title-btn-active-1: #2c3e2e; --title-btn-active-2: #1b261c;
    --title-btn-idle-1: #4a634a; --title-btn-idle-2: #2c3e2e;
    --text-highlight: #f0d0a3;
    --board-light: #e0c99a; --board-dark: #2f2114;
  }

  /* --- OVERHAULED THEMES BELOW --- */

  [data-theme="blue"] {
    /* Deep slate/navy backgrounds */
    --bg-1: #0f172a; --bg-2: #162032; --bg-3: #1e293b;
    --panel-1: #162438; --panel-2: #0b1121;
    --list-1: #1e2e45; --list-2: #131c2d;
    /* Vibrant blue accents */
    --btn-active: #1d4ed8; --btn-idle: #2563eb;
    --title-btn-active-1: #1e3a8a; --title-btn-active-2: #172554;
    --title-btn-idle-1: #3b82f6; --title-btn-idle-2: #2563eb;
    --text-highlight: #93c5fd;
    /* Classic pleasing blue chess board */
    --board-light: #d8e1e8; --board-dark: #5e7d9e;
  }

  [data-theme="purple"] {
    /* Muted charcoal/aubergine backgrounds */
    --bg-1: #15101c; --bg-2: #1c1526; --bg-3: #281e36;
    --panel-1: #20172e; --panel-2: #120d18;
    --list-1: #2a1f3a; --list-2: #1b1325;
    /* Royal amethyst accents */
    --btn-active: #6b21a8; --btn-idle: #8b5cf6;
    --title-btn-active-1: #4c1d95; --title-btn-active-2: #3b0764;
    --title-btn-idle-1: #9333ea; --title-btn-idle-2: #7e22ce;
    --text-highlight: #d8b4fe;
    /* Lavender-tinted board */
    --board-light: #e5dfee; --board-dark: #81669c;
  }

  [data-theme="green"] {
    /* Extremely dark desaturated forest backgrounds */
    --bg-1: #111411; --bg-2: #161c16; --bg-3: #1f281f;
    --panel-1: #192119; --panel-2: #0f120f;
    --list-1: #212c21; --list-2: #161d16;
    /* Clean, legible green accents */
    --btn-active: #3f6341; --btn-idle: #578a57;
    --title-btn-active-1: #243b25; --title-btn-active-2: #182919;
    --title-btn-idle-1: #5c8a5c; --title-btn-idle-2: #4a754a;
    --text-highlight: #86efac;
    /* Classic iconic chess green board */
    --board-light: #eaebd1; --board-dark: #739552;
  }

  [data-theme="cherry"] {
    /* Very dark, warm charcoal backgrounds */
    --bg-1: #1a1212; --bg-2: #241616; --bg-3: #301d1d;
    --panel-1: #261717; --panel-2: #140d0d;
    --list-1: #331e1e; --list-2: #211313;
    /* Ruby/crimson accents */
    --btn-active: #822828; --btn-idle: #ab3a3a;
    --title-btn-active-1: #4a1818; --title-btn-active-2: #331010;
    --title-btn-idle-1: #b84545; --title-btn-idle-2: #9c3535;
    --text-highlight: #fca5a5;
    /* Warm terracotta and cream board */
    --board-light: #edd8d3; --board-dark: #b35952;
  }

  [data-theme="slate"] {
    /* Cool, metallic dark greys */
    --bg-1: #13151a; --bg-2: #1b1e24; --bg-3: #242830;
    --panel-1: #1d2027; --panel-2: #101216;
    --list-1: #262b34; --list-2: #191c22;
    /* Muted steel-blue accents */
    --btn-active: #475569; --btn-idle: #64748b;
    --title-btn-active-1: #2d3748; --title-btn-active-2: #1a202c;
    --title-btn-idle-1: #718096; --title-btn-idle-2: #4a5568;
    --text-highlight: #cbd5e1;
    /* Icy grey/blue board */
    --board-light: #dde2e8; --board-dark: #6f7f94;
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