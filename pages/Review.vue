<script setup>
  import { ref, onMounted } from 'vue'
  import Title from "../assets/Title.vue"
  import { Chess } from 'chess.js'   
  import { TheChessboard } from 'vue3-chessboard'  
  import 'vue3-chessboard/style.css'; 

  const username = ref(null)
  const year = ref(null)
  const month = ref(null)
  const games = ref([])
  const selectedGame = ref(null)
  const loading = ref(false)
  const error = ref(null)
  const gameUci = ref([])
  const reviewMoves = ref([])
  const reviewIndex = ref(0)
  const boardAPI = ref(null)
  const moveslist = ref([])
  const rotate = ref(0)
  const chess = new Chess()

  function handleMove(move) {
    const uci = move.promotion
      ? `${move.from}${move.to}${move.promotion}`
      : `${move.from}${move.to}`

    chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined })

    const playedMoves = reviewMoves.value.slice(0, reviewIndex.value)
    playedMoves.push(uci)
  }

  async function chessImport() {
    loading.value = true
    error.value = null
    games.value = []
    try {
      const paddedMonth = String(month.value).padStart(2, '0')
      const res = await fetch(
        `https://api.chess.com/pub/player/${username.value}/games/${year.value}/${paddedMonth}`
      )
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`)
      const data = await res.json()
      games.value = data.games || []
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  function selectGame(game) {
    selectedGame.value = game
    gameUci.value = convertPgnToUci(game.pgn)
    reviewMoves.value = gameUci.value
    reviewIndex.value = 0
    chess.reset()
    boardAPI.value?.setPosition(chess.fen())
    const tempChess = new Chess()
    moveslist.value = gameUci.value.map(uci => {
      const m = tempChess.move(uci, { sloppy: true })
      return m ? m.san : uci
    })
  }

  function nextMove() {
    if (reviewIndex.value >= reviewMoves.value.length) return
    chess.move(reviewMoves.value[reviewIndex.value], { sloppy: true })
    boardAPI.value?.setPosition(chess.fen())
    reviewIndex.value++
  }

  function prevMove() {
    if (reviewIndex.value <= 0) return
    chess.undo()
    boardAPI.value?.setPosition(chess.fen())
    reviewIndex.value--
  }

  function jumpTo(index) {
    chess.reset()
    for (let i = 0; i <= index; i++) {
      chess.move(reviewMoves.value[i], { sloppy: true })
    }
    boardAPI.value?.setPosition(chess.fen())
    reviewIndex.value = index + 1
  }

  function flipboard() {
    boardAPI.value.toggleOrientation()
    rotate.value += 180
  }

  function replayMoves() {
    chess.reset()
    const tempChess = new Chess()
    moveslist.value = reviewMoves.value.map(uci => {
      const m = tempChess.move(uci, { sloppy: true })
      return m ? m.san : uci
    })
  }

  function convertPgnToUci(pgn) {
    const c = new Chess()
    c.loadPgn(pgn)
    return c.history({ verbose: true }).map(move => {
      let uci = move.from + move.to
      if (move.promotion) uci += move.promotion
      return uci
    })
  }

  function formatResult(game) {
    const isWhite = game.white.username.toLowerCase() === username.value.toLowerCase()
    const me = isWhite ? game.white : game.black
    const opponent = isWhite ? game.black : game.white
    const result = me.result === 'win' ? '1-0' : me.result === 'resigned' || me.result === 'checkmated' ? '0-1' : '½-½'
    return { opponent: opponent.username, result, myColor: isWhite ? 'White' : 'Black', myRating: me.rating, oppRating: opponent.rating }
  }
</script>

<template>
  <div class="grid-layout">
    <Title/>
    <div class="content-area">

      <!-- Left: board + tools -->
      <div class="board-section">
        <div class="chessboard">
          <TheChessboard @move="handleMove" @board-created="(api) => (boardAPI = api)" :board-config="{coordinates: true}" />
        </div>
        <div class="boardtools">
          <button class="reverse" @click="flipboard">↳↰</button>
          <p class="reversetip">Flip Board</p>
          <button class="undo" @click="prevMove" :disabled="reviewIndex === 0">↶</button>
          <p class="undotip">Previous Move</p>
          <button class="redo" @click="nextMove" :disabled="reviewIndex === reviewMoves.length">↷</button>
          <p class="redotip">Next Move</p>
          <span class="move-counter">{{ reviewIndex }} / {{ reviewMoves.length }}</span>
        </div>
      </div>

      <!-- Right: move history + import -->
      <div class="right-column">
        <div class="moves">
          <h2 class="movehistory">Move history</h2>
          <ol class="moveslist">
            <template v-for="(move, index) in moveslist" :key="index">
              <li class="list" v-if="index % 2 === 0">
                <span class="white-move" :class="{activemove: reviewIndex - 1 === index}" @click="jumpTo(index)">
                  {{ move }}
                </span>
                <span class="movespan" v-if="moveslist[index + 1]" :class="{activemove: reviewIndex - 1 === index + 1}" @click="jumpTo(index + 1)">
                  {{ moveslist[index + 1] }}
                </span>
              </li>
            </template>
          </ol>
        </div>
        <div class="import-container">
          <h1 class="import-title">Import your game</h1>
          <div class="controls">
            <input v-model="username" placeholder="Chess.com username" class="input" />
            <input v-model="year" placeholder="Enter the year" class="input"/>
            <select v-model="month" class="input">
              <option value="month" disabled>month</option>
              <option v-for="m in 12" :key="m" :value="m">{{ String(m).padStart(2, '0') }}</option>
            </select>
            <button class="import_btn" @click="chessImport" :disabled="loading">
              {{ loading ? 'Loading...' : 'Import' }}
            </button>
          </div>

          <div v-if="error" class="error">{{ error }}</div>

          <div v-if="games.length" class="games-list">
            <div
              v-for="(game, i) in games"
              :key="i"
              class="game-row"
              :class="{ selected: selectedGame === game }"
              @click="selectGame(game)"
            >
              <span class="color-dot" :class="formatResult(game).myColor.toLowerCase()"></span>
              <span class="opponent">vs {{ formatResult(game).opponent }}</span>
              <span class="rating">{{ formatResult(game).myRating }} vs {{ formatResult(game).oppRating }}</span>
              <span class="result" :class="formatResult(game).result">{{ formatResult(game).result }}</span>
              <span class="time-class">{{ game.time_class }}</span>
            </div>
          </div>

          <div v-if="selectedGame" class="selection-bar">
            <span class="selected-msg">✓ Game selected</span>
          </div>
          <div v-else-if="!loading" class="empty">No game selected yet.</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .grid-layout {
    padding: 1rem;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1.5rem;
    max-width: 1600px;
    margin: 0 auto;
  }

  .content-area {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 1.5rem;
  }

  .board-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
    flex-shrink: 0;
  }

  .chessboard {
    width: 100%;
  }

  :deep(.cg-wrap) {
    overflow: hidden;
    width: 100%;
    aspect-ratio: 1;
    max-width: min(90vw, 35rem);
    height: auto;
    box-shadow: 0 15px 40px rgba(0, 0, 0, 0.4);
    border-radius: 8px;
  }

  .boardtools {
    display: flex;
    gap: 1rem;
    justify-content: center;
    align-items: center;
    min-height: 3.2rem;
    width: 100%;
    background: linear-gradient(145deg, #8b5a32, #6d4524);
    border: 2px solid rgba(182, 173, 144, 0.4);
    padding: 0.5rem 1rem;
    border-radius: 10px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    flex-wrap: wrap;
    position: relative;
  }

  .reverse, .undo, .redo {
    background-color: #9d6639;
    width: clamp(35px, 8vw, 40px);
    height: clamp(35px, 8vw, 40px);
    border: none;
    border-radius: 15px;
    font-size: clamp(16px, 4vw, 20px);
    color: #e8e8d0;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .reverse:disabled, .undo:disabled, .redo:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .reverse:hover:not(:disabled),
  .undo:hover:not(:disabled),
  .redo:hover:not(:disabled) {
    background: linear-gradient(145deg, #9d6640, #7d5530);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  }

  .reverse:active, .undo:active, .redo:active {
    transform: translateY(2px);
  }

  .reversetip, .undotip, .redotip {
    display: none;
  }

  @media (min-width: 768px) {
    .reversetip, .undotip, .redotip {
      display: block;
      opacity: 0;
      position: absolute;
      font-size: clamp(14px, 2vw, 17px);
      padding: 0.5rem;
      border-radius: 10px;
      text-align: center;
      background-color: #242424;
      pointer-events: none;
      white-space: nowrap;
      margin-top: -4.5rem;
      transform: translateX(-50%);
      left: 50%;
    }

    .reverse:hover + .reversetip,
    .undo:hover + .undotip,
    .redo:hover + .redotip {
      animation: fadeIn 0.4s 0.3s forwards;
    }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 0.8; }
  }

  .move-counter {
    color: #e8e8d0;
    font-size: 0.9rem;
    min-width: 50px;
    text-align: center;
  }

  .analyze-here-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  }

  .analyze-here-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Right column */
  .right-column {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    flex: 1;
    min-width: 0;
  }

  .moves {
    background: linear-gradient(145deg, #8b5a32, #6d4524);
    border-radius: 16px;
    width: 100%;
    max-height: 300px;
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    overflow-y: auto;
    overflow-x: hidden;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.08);
    scrollbar-width: thin;
    scrollbar-color: rgba(194, 197, 170, 0.4) rgba(0, 0, 0, 0.2);
    min-height: 300px;
  }

  .movehistory {
    position: sticky;
    top: 0;
    text-align: center;
    color: #f5f5dc;
    font-weight: 600;
    margin: 12px 0;
    font-size: clamp(1.2rem, 3vw, 1.5rem);
    background: linear-gradient(145deg, #8b5a32, #6d4524);
    padding: 0.5rem 0;
  }

  .moveslist {
    margin: 0 auto;
    padding: 10px;
    width: 90%;
    background: linear-gradient(135deg, #a57548, #7d5530);
    border-radius: 14px;
    list-style: none;
    font-size: clamp(0.9rem, 2vw, 1rem);
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.25);
  }

  .list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    padding: 4px 8px;
    margin-bottom: 6px;
    border-radius: 10px;
    color: #e8e8d0;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
    border: 1px solid rgba(194, 197, 170, 0.3);
    font-weight: 500;
  }

  .white-move, .movespan {
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .white-move:hover, .movespan:hover {
    background: rgba(103, 122, 228, 0.2);
  }

  .activemove {
    background: rgba(103, 122, 228, 0.45) !important;
    color: #fff;
    font-weight: 700;
    box-shadow: 0 2px 8px rgba(103, 122, 228, 0.4);
  }

  .movespan {
    color: #b8c5ff;
  }

  /* Import panel */
  .import-container {
    display: flex;
    padding: 1rem;
    align-items: center;
    flex-direction: column;
    gap: 1rem;
    border: 1px solid #8c613f;
    border-radius: 20px;
    background-color: #83542f;
  }

  .import-title {
    text-align: center;
    color: #f5f5dc;
  }

  .controls {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .input {
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    border: 1px solid #444;
    background: #1e1e1e;
    color: white;
  }

  .import_btn {
    padding: 0.4rem 1rem;
    border-radius: 6px;
    background: #343f2a;
    color: #fff;
    border: none;
    cursor: pointer;
  }

  .import_btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .games-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-height: 300px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: #353e2a #1e1e1e;
    width: 100%;
  }

  .game-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    background: #1e1e1e;
    cursor: pointer;
    transition: background 0.2s;
  }

  .game-row:hover { background: #2a2a2a; }

  .game-row.selected {
    background: #2a3d2a;
    border: 1px solid #5c9e5c;
  }

  .color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .color-dot.white { background: #fff; }
  .color-dot.black { background: #555; border: 1px solid #888; }

  .opponent { flex: 1; font-weight: 500; }
  .rating { color: #aaa; font-size: 0.85rem; }
  .time-class { color: #aaa; font-size: 0.8rem; text-transform: capitalize; }
  .result { font-weight: bold; font-size: 0.9rem; }
  .error { color: red; }

  .selection-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.6rem 0.75rem;
    background: #1e1e1e;
    border-radius: 8px;
    border: 1px solid #5c9e5c;
    width: 100%;
  }

  .selected-msg {
    color: #5c9e5c;
    font-weight: 500;
  }

  .empty {
    color: #5d9e5d;
    padding: 0.6rem 0.75rem;
    background: #1e1e1e;
    border-radius: 8px;
    border: 1px solid #5c9e5c;
  }
</style>


