<script setup>
  import { ref } from 'vue' 
</script>

<template>
  <RouterView/>
</template>

<style>
  <style>
  /* --- THEME VARIABLES --- */
  :root, [data-theme="brown"] {
    --bg-1: #4b2e12; --bg-2: #6f4518; --bg-3: #7f4f24;
    --panel-1: #8B5A32; --panel-2: #6D4524;
    --list-1: #a57548; --list-2: #7d5530;
    --btn-active: #5e3c20; --btn-idle: #8d5b33;
    --title-btn-active-1: #414833; --title-btn-active-2: #333d29;
    --title-btn-idle-1: #656d4a; --title-btn-idle-2: #414833;
    --text-highlight: #d9b382;
  }

  [data-theme="wood"] {
    --bg-1: #2c1e16; --bg-2: #3d2b1f; --bg-3: #543a28;
    --panel-1: #4a3322; --panel-2: #332216;
    --list-1: #63452e; --list-2: #4a3322;
    --btn-active: #2a1c12; --btn-idle: #543a28;
    --title-btn-active-1: #2c3e2e; --title-btn-active-2: #1b261c;
    --title-btn-idle-1: #4a634a; --title-btn-idle-2: #2c3e2e;
    --text-highlight: #e6c8a3;
  }

  [data-theme="blue"] {
    --bg-1: #0f172a; --bg-2: #1e293b; --bg-3: #334155;
    --panel-1: #1e293b; --panel-2: #0f172a;
    --list-1: #334155; --list-2: #1e293b;
    --btn-active: #0ea5e9; --btn-idle: #38bdf8;
    --title-btn-active-1: #0284c7; --title-btn-active-2: #0369a1;
    --title-btn-idle-1: #38bdf8; --title-btn-idle-2: #0284c7;
    --text-highlight: #7dd3fc;
  }

  [data-theme="purple"] {
    --bg-1: #2e1065; --bg-2: #4c1d95; --bg-3: #5b21b6;
    --panel-1: #4c1d95; --panel-2: #2e1065;
    --list-1: #6d28d9; --list-2: #4c1d95;
    --btn-active: #8b5cf6; --btn-idle: #a78bfa;
    --title-btn-active-1: #7c3aed; --title-btn-active-2: #6d28d9;
    --title-btn-idle-1: #a78bfa; --title-btn-idle-2: #7c3aed;
    --text-highlight: #c4b5fd;
  }

  [data-theme="green"] {
    --bg-1: #064e3b; --bg-2: #065f46; --bg-3: #047857;
    --panel-1: #065f46; --panel-2: #064e3b;
    --list-1: #059669; --list-2: #065f46;
    --btn-active: #10b981; --btn-idle: #34d399;
    --title-btn-active-1: #059669; --title-btn-active-2: #047857;
    --title-btn-idle-1: #34d399; --title-btn-idle-2: #059669;
    --text-highlight: #6ee7b7;
  }

  [data-theme="midnight"] {
    --bg-1: #000000; --bg-2: #111111; --bg-3: #222222;
    --panel-1: #1a1a1a; --panel-2: #0a0a0a;
    --list-1: #2a2a2a; --list-2: #1a1a1a;
    --btn-active: #444444; --btn-idle: #666666;
    --title-btn-active-1: #333333; --title-btn-active-2: #111111;
    --title-btn-idle-1: #555555; --title-btn-idle-2: #333333;
    --text-highlight: #e0e0e0;
  }

  [data-theme="slate"] {
    --bg-1: #334155; --bg-2: #475569; --bg-3: #64748b;
    --panel-1: #475569; --panel-2: #334155;
    --list-1: #64748b; --list-2: #475569;
    --btn-active: #94a3b8; --btn-idle: #cbd5e1;
    --title-btn-active-1: #64748b; --title-btn-active-2: #475569;
    --title-btn-idle-1: #cbd5e1; --title-btn-idle-2: #64748b;
    --text-highlight: #f1f5f9;
  }

  [data-theme="cherry"] {
    --bg-1: #450a0a; --bg-2: #7f1d1d; --bg-3: #991b1b;
    --panel-1: #7f1d1d; --panel-2: #450a0a;
    --list-1: #b91c1c; --list-2: #7f1d1d;
    --btn-active: #dc2626; --btn-idle: #f87171;
    --title-btn-active-1: #b91c1c; --title-btn-active-2: #991b1b;
    --title-btn-idle-1: #f87171; --title-btn-idle-2: #b91c1c;
    --text-highlight: #fca5a5;
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
      /* Updated to use CSS Variables */
      background: linear-gradient(
        135deg,
        var(--bg-1) 0%,
        var(--bg-2) 45%,
        var(--bg-3) 100%
      );
      line-height: 1.5;
      background-attachment: fixed;
  }

  /* ... rest of your existing global styles ... */
</style>
</style>

