<script setup>
  import { ref } from 'vue'
  import Title from '../assets/Title.vue'
  import { Chess } from 'chess.js'
  import { useRouter } from 'vue-router'

  const router = useRouter()

  const username = ref('')
  const year = ref('')
  const month = ref('month')
  const games = ref([])
  const selectedGame = ref(null)
  const loading = ref(false)
  const error = ref(null)
  const gameUci = ref([])
  const reviewMoves = ref([])
  const reviewIndex = ref(0)
  const moveslist = ref([])
  const chess = new Chess()
  const importSite = ref('chess.com')

  async function chessImport() {
    loading.value = true
    error.value = null
    games.value = []
    selectedGame.value = null

    try {
      if (!year.value || month.value === 'month' || !username.value) {
        throw new Error('Please fill in username, year, and month.')
      }

      const paddedMonth = String(month.value).padStart(2, '0')

      if (importSite.value === 'chess.com') {
        // --- CHESS.COM FLOW ---
        const res = await fetch(`https://api.chess.com/pub/player/${username.value}/games/${year.value}/${paddedMonth}`)
        if (!res.ok) throw new Error('Failed to fetch from Chess.com')
        const data = await res.json()
        games.value = data.games || []

      } else {
        // --- LICHESS FLOW ---
        // 1. Calculate UNIX timestamps for the start and end of the chosen month
        const startDate = new Date(Date.UTC(year.value, month.value - 1, 1)).getTime()
        const endDate = new Date(Date.UTC(year.value, month.value, 1)).getTime()

        // 2. Add pgnInJson=true to get the PGNs, and use the timestamp boundaries
        const res = await fetch(`https://lichess.org/api/games/user/${username.value}?since=${startDate}&until=${endDate}&pgnInJson=true`, {
          headers: { 'Accept': 'application/x-ndjson' }
        })
        if (!res.ok) throw new Error('Failed to fetch from Lichess')
        
        const text = await res.text()
        
        if (text.trim()) {
          // 3. Normalize Lichess data to act exactly like Chess.com data
          games.value = text.trim().split('\n').map(line => {
            const lGame = JSON.parse(line)
            
            // Map Lichess winners to Chess.com result strings
            let wRes = 'draw'
            let bRes = 'draw'
            if (lGame.winner === 'white') { wRes = 'win'; bRes = 'lose' }
            else if (lGame.winner === 'black') { wRes = 'lose'; bRes = 'win' }

            return {
              pgn: lGame.pgn || "", 
              time_class: lGame.speed || "unknown",
              white: {
                username: lGame.players?.white?.user?.name || "Anonymous",
                rating: lGame.players?.white?.rating || 0,
                result: wRes
              },
              black: {
                username: lGame.players?.black?.user?.name || "Anonymous",
                rating: lGame.players?.black?.rating || 0,
                result: bRes
              }
            }
          })
        } else {
          games.value = []
        }
      }

    } catch (e) {
      error.value = e.message
      console.error(e)
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
    
    const tempChess = new Chess()
    moveslist.value = gameUci.value.map(uci => {
      // Must pass object to modern chess.js to prevent crashes
      const m = tempChess.move({ 
        from: uci.substring(0, 2), 
        to: uci.substring(2, 4), 
        promotion: uci[4] 
      })
      return m ? m.san : uci
    })
  }

  function replayMoves() {
    chess.reset()
    const tempChess = new Chess()
    moveslist.value = reviewMoves.value.map(uci => {
      // Must pass object to modern chess.js to prevent crashes
      const m = tempChess.move({ 
        from: uci.substring(0, 2), 
        to: uci.substring(2, 4), 
        promotion: uci[4] 
      })
      return m ? m.san : uci
    })
  }

  function convertPgnToUci(pgn) {
    if (!pgn) return []
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
    
    let result = '½-½'
    if (me.result === 'win') {
      result = '1-0'
    } else if (['resigned', 'checkmated', 'abandoned', 'lose'].includes(me.result)) {
      result = '0-1'
    }
    
    return {
      opponent: opponent.username,
      result,
      myColor: isWhite ? 'White' : 'Black',
      myRating: me.rating,
      oppRating: opponent.rating
    }
  }

  function analyseGame(){
    if (!selectedGame.value || gameUci.value.length === 0) return
  
    const moveString = gameUci.value.join('-')
  
    router.push({ 
      path: '/', 
      query: { moves: moveString } 
    })
  }
</script>

<template>
  <div class="grid-layout">
    <Title/>
    <div class="content-area">
      <div class="import-container">
        <h1 class="import-title">Import your game</h1>
        
        <!-- Fixed: Bound v-model directly to select element -->
        <select v-model="importSite" class="website-input">
          <option value="chess.com">chess.com</option>
          <option value="lichess">lichess</option>
        </select>
        
        <div class="controls">
          <input v-model="username" placeholder="Username" class="input" />
          <input v-model="year" placeholder="Enter the year" class="input" />
          
          <select v-model="month" class="input">
            <option value="month" disabled>month</option>
            <option v-for="m in 12" :key="m" :value="m">
              {{ String(m).padStart(2, '0') }}
            </option>
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
          <button class="analyse-btn" @click="analyseGame()">Analyse</button>
        </div>
        <div v-else-if="games.length && !loading" class="empty">
          No game selected yet.
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
    margin: 0 auto;
  }
  .content-area {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 1.5rem;
    width: 100%;
  }
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
  .website-input {
    padding: 0.3rem;
    border-radius: 4px;
    background: #1e1e1e;
    color: white;
    border: 1px solid #444;
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
    color: white;
  }
  .game-row:hover {
    background: #2a2a2a;
  }
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
  .color-dot.white {
    background: #fff;
  }
  .color-dot.black {
    background: #555;
    border: 1px solid #888;
  }
  .opponent {
    flex: 1;
    font-weight: 500;
  }
  .rating {
    color: #aaa;
    font-size: 0.85rem;
  }
  .time-class {
    color: #aaa;
    font-size: 0.8rem;
    text-transform: capitalize;
  }
  .result {
    font-weight: bold;
    font-size: 0.9rem;
  }
  .error {
    color: #ff4a4a;
  }
  .selection-bar {
    display: flex;
    padding: 0.6rem 0.75rem;
    background: #1e1e1e;
    border-radius: 8px;
    border: 1px solid #5c9e5c;
    width: 100%;
    height: auto;
    align-items: center;
    justify-content: center;
    gap: 2rem;
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
  .analyse-btn {
    width: 80px;
    height: 25px;
    border-radius: 5px;
    font-family: sans-serif;
    color: #fefefe;
    background-color: #2a3d2a;
    border: none;
    cursor: pointer;
  }
  .analyse-btn:hover {
    background-color: #4e824e;
  }
</style>
