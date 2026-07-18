<script setup>
  import { ref, shallowRef, computed, onMounted, watch } from 'vue'
  import Title from '../assets/Title.vue'
  import { auth, db } from '../firebase'
  import { onAuthStateChanged } from 'firebase/auth'
  import { collection, query, getDocs, doc, getDoc, setDoc } from 'firebase/firestore'
  import { Chess } from 'chess.js'
  import { TheChessboard } from 'vue3-chessboard'
  import 'vue3-chessboard/style.css'

  // --- Apply theme instantly ---
  const currentTheme = ref(localStorage.getItem('chesslab_theme') || 'brown')
  watch(currentTheme, (newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('chesslab_theme', newTheme)
  }, { immediate: true })

  const currentUser = ref(null)
  const allPuzzles = ref([])
  const loading = ref(true)
  
  const currentPuzzle = shallowRef(null)
  const status = ref('idle') // 'idle', 'correct', 'wrong'
  const message = ref('Find the best move for your side.')
  
  const userRating = ref(Number(localStorage.getItem('chesslab_puzzle_rating')) || 1200)
  const boardAPI = shallowRef(null)
  const chess = new Chess()
  const isFlipped = ref(false)

  onMounted(() => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser.value = user
        await fetchRating()
        await fetchPuzzles()
      } else {
        currentUser.value = null
        allPuzzles.value = []
      }
      loading.value = false
    })
  })

  async function fetchPuzzles() {
    if (!currentUser.value) return
    try {
      const q = query(collection(db, `users/${currentUser.value.uid}/games`))
      const snap = await getDocs(q)
      let temp = []
      
      snap.forEach(doc => {
        const data = doc.data()
        if (data.puzzles && Array.isArray(data.puzzles)) {
          data.puzzles.forEach((p, i) => {
            if (p.fen && p.bestMove) {
              temp.push({ ...p, id: `${doc.id}_${i}`, gameId: doc.id })
            }
          })
        }
      })
      
      allPuzzles.value = temp
      if (allPuzzles.value.length > 0) {
        loadRandomPuzzle()
      } else {
        message.value = 'No puzzles generated yet. Analyze your games to find your blunders!'
      }
    } catch (e) {
      console.error("Failed to fetch puzzles:", e)
    }
  }

  async function fetchRating() {
    if (!currentUser.value) return
    try {
      const statRef = doc(db, `users/${currentUser.value.uid}/stats/puzzle`)
      const statSnap = await getDoc(statRef)
      if (statSnap.exists()) {
        userRating.value = statSnap.data().rating || 1200
      } else {
        await setDoc(statRef, { rating: userRating.value })
      }
      localStorage.setItem('chesslab_puzzle_rating', String(userRating.value))
    } catch (e) {
      console.error("Failed to fetch rating:", e)
    }
  }

  async function updateRating(delta) {
    userRating.value += delta
    localStorage.setItem('chesslab_puzzle_rating', String(userRating.value))
    if (currentUser.value) {
      try {
        const statRef = doc(db, `users/${currentUser.value.uid}/stats/puzzle`)
        await setDoc(statRef, { rating: userRating.value }, { merge: true })
      } catch (e) {
        console.error("Failed to update rating:", e)
      }
    }
  }

  function loadRandomPuzzle() {
    if (allPuzzles.value.length === 0) return
    const idx = Math.floor(Math.random() * allPuzzles.value.length)
    currentPuzzle.value = allPuzzles.value[idx]
    status.value = 'idle'
    message.value = `Find the best move for ${currentPuzzle.value.turn === 'white' ? 'White' : 'Black'}.`
    
    chess.load(currentPuzzle.value.fen)
    const shouldBeFlipped = chess.turn() === 'b'
    
    if (boardAPI.value) {
      if (shouldBeFlipped !== isFlipped.value) {
        boardAPI.value.toggleOrientation()
        isFlipped.value = shouldBeFlipped
      }
      boardAPI.value.setPosition(currentPuzzle.value.fen)
      boardAPI.value.hideMoves()
    }
  }

  function onBoardCreated(api) {
    boardAPI.value = api
    if (currentPuzzle.value) {
      boardAPI.value.setPosition(currentPuzzle.value.fen)
    }
  }

  function handleMove(move) {
    if (status.value !== 'idle' || !currentPuzzle.value) return // Prevent moving after solved/failed

    const uci = move.promotion ? `${move.from}${move.to}${move.promotion}` : `${move.from}${move.to}`
    
    if (uci === currentPuzzle.value.bestMove) {
      status.value = 'correct'
      message.value = 'Correct! +15 Rating points.'
      updateRating(15)
    } else {
      status.value = 'wrong'
      message.value = 'Not the best move. -10 Rating points.'
      updateRating(-10)
      
      // Show the correct move
      if (boardAPI.value) {
        boardAPI.value.setPosition(currentPuzzle.value.fen) // Undo wrong move
        const from = currentPuzzle.value.bestMove.slice(0, 2)
        const to = currentPuzzle.value.bestMove.slice(2, 4)
        boardAPI.value.drawMove(from, to, 'green')
      }
    }
  }

  function retryPuzzle() {
    status.value = 'idle'
    message.value = `Find the best move for ${currentPuzzle.value.turn === 'white' ? 'White' : 'Black'}.`
    if (boardAPI.value) {
      boardAPI.value.hideMoves()
      boardAPI.value.setPosition(currentPuzzle.value.fen)
    }
  }
</script>

<template>
  <div class="page-layout">
    <Title />
    <div class="content-area">
      <div class="puzzle-card">
        <div class="puzzle-header">
          <div>
            <h1 class="puzzle-title">Learn from your mistakes</h1>
            <p class="puzzle-subtitle">Train your tactical vision using positions from your own past blunders.</p>
          </div>
          <div class="rating-badge">
            <span class="rating-label">Puzzle Rating</span>
            <span class="rating-value">🏆 {{ userRating }}</span>
          </div>
        </div>

        <div v-if="loading" class="empty-state">
          <div class="loading-spinner"><div class="spinner-ring"></div><div class="spinner-ring"></div><div class="spinner-ring"></div></div>
          <p>Loading your puzzles...</p>
        </div>

        <div v-else-if="!currentUser" class="empty-state"><p>Please log in to access your puzzles.</p></div>
        
        <div v-else-if="allPuzzles.length === 0" class="empty-state">
          <p>No puzzles generated yet.</p>
          <p class="muted">Analyze your games to automatically generate puzzles from your blunders.</p>
        </div>

        <div v-else class="puzzle-interface">
          <div class="board-side">
            <div class="board-wrapper">
              <TheChessboard 
                class="game-board"
                @move="handleMove" 
                @board-created="onBoardCreated" 
                :board-config="{ coordinates: true, animation: { enabled: false } }" 
              />
            </div>
          </div>
          
          <div class="info-side">
            <div class="status-box" :class="status">
              <p>{{ message }}</p>
            </div>

            <div class="puzzle-meta">
              <span class="meta-label">Side to move</span>
              <span class="meta-value">{{ currentPuzzle?.turn === 'white' ? 'White' : 'Black' }}</span>
            </div>

            <div class="action-buttons">
              <button v-if="status === 'idle'" class="action-btn hint-btn" @click="status = 'wrong'; updateRating(-10); boardAPI.drawMove(currentPuzzle.bestMove.slice(0,2), currentPuzzle.bestMove.slice(2,4), 'green')">
                Show Solution (-10)
              </button>
              <button v-else class="action-btn retry-btn" @click="retryPuzzle">
                Retry Puzzle
              </button>
              <button class="action-btn next-btn" @click="loadRandomPuzzle">
                Next Puzzle →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');

  .page-layout {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    padding: clamp(0.5rem, 3vw, 1rem);
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
    justify-self: center;
    min-width: 100%; 
    margin: 0 auto;
    box-sizing: border-box;
  }

  @media (min-width: 768px) {
    .page-layout {
      grid-template-columns: auto 1fr;
      gap: 1.5rem;
    }
  }

  .content-area {
    display: flex;
    justify-content: stretch;
    width: 100%;
    min-width: 0;
  }

  .puzzle-card {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: clamp(1.5rem, 3vw, 2.5rem);
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2));
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  .puzzle-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .puzzle-title {
    font-family: serif;
    color: #f5f5dc;
    font-weight: 700;
    text-transform: uppercase;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
    letter-spacing: 2px;
    font-size: clamp(1.3rem, 3vw, 1.7rem);
    margin: 0 0 0.4rem;
  }

  .puzzle-subtitle {
    color: rgba(244, 240, 227, 0.72);
    font-size: 0.9rem;
    margin: 0;
  }

  .rating-badge {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.3);
    padding: 0.75rem 1.25rem;
    border-radius: 12px;
    border: 1px solid var(--text-highlight);
  }

  .rating-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgba(244, 240, 227, 0.6);
  }

  .rating-value {
    font-family: "JetBrains Mono", monospace;
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--text-highlight);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 0.5rem;
    color: rgba(244, 240, 227, 0.6);
    font-size: 1rem;
    text-align: center;
    padding: 3rem 1rem;
  }

  .empty-state .muted {
    font-size: 0.85rem;
    color: rgba(244, 240, 227, 0.4);
  }

  .loading-spinner {
    position: relative;
    width: 56px;
    height: 56px;
    margin-bottom: 1rem;
  }

  .spinner-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid transparent;
    border-top-color: var(--text-highlight);
    animation: spinRing 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
  }
  .spinner-ring:nth-child(2) { inset: 7px; border-top-color: #a8d97a; animation-duration: 1.6s; animation-direction: reverse; }
  .spinner-ring:nth-child(3) { inset: 14px; border-top-color: #f4f0e3; animation-duration: 2s; }
  @keyframes spinRing { to { transform: rotate(360deg); } }

  .puzzle-interface {
    display: flex;
    gap: 2rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .board-side {
    flex: 1 1 300px;
    min-width: 0;
    max-width: 600px;
  }

  .board-wrapper {
    width: 100%;
    aspect-ratio: 1/1;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 15px 40px rgba(0, 0, 0, 0.4);
  }

  .game-board {
    width: 100% !important;
    height: 100% !important;
  }

  :deep(.cg-wrap) {
    width: 100% !important;
    height: 100% !important;
  }

  :deep(cg-board) {
    background: conic-gradient(
      var(--board-dark) 90deg,
      var(--board-light) 90deg 180deg,
      var(--board-dark) 180deg 270deg,
      var(--board-light) 270deg
    ) !important;
    background-size: 25% 25% !important;
  }

  .info-side {
    flex: 1 1 250px;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .status-box {
    padding: 1.5rem;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.08);
    text-align: center;
    font-weight: 600;
    font-size: 1.1rem;
    color: #f4f0e3;
    min-height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .status-box.correct {
    background: rgba(106, 209, 63, 0.15);
    border-color: #8fd97a;
    color: #a8d97a;
  }

  .status-box.wrong {
    background: rgba(255, 100, 90, 0.15);
    border-color: #ff8a80;
    color: #ffb0a8;
  }

  .puzzle-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(0,0,0,0.2);
    padding: 0.75rem 1rem;
    border-radius: 8px;
  }

  .meta-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(244, 240, 227, 0.6);
  }

  .meta-value {
    font-family: "JetBrains Mono", monospace;
    font-weight: 700;
    color: var(--text-highlight);
    text-transform: capitalize;
  }

  .action-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: auto;
  }

  .action-btn {
    padding: 0.75rem 1rem;
    border-radius: 8px;
    border: none;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s ease;
    color: #f4f0e3;
  }

  .hint-btn {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .retry-btn {
    background: var(--btn-idle);
  }

  .next-btn {
    background: var(--btn-active);
  }

  .action-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
</style>