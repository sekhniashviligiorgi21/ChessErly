<script setup>
  import Analysis from "./pages/Analysis.vue"
  import Title from "./assets/Title.vue"
</script>

<template>
  <Analysis/>
</template>

<style>
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
        #4b2e12 0%,
        #6f4518 45%,
        #7f4f24 100%
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
</style>
