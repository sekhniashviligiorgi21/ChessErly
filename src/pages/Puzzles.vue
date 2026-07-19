<script setup>
  import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
  import { Chess } from 'chess.js'
  import { TheChessboard } from 'vue3-chessboard'
  import { auth, db } from '../firebase'
  import { onAuthStateChanged } from 'firebase/auth'
  import { collection, query, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
  import 'vue3-chessboard/style.css'
  import Title from "../assets/Title.vue"
  import { startEngine, getEvaluation, cancelAnalysis } from "../engine/engine.js"

  // --- Theme ---
  const currentTheme = ref(localStorage.getItem('chesslab_theme') || 'brown')
  watch(currentTheme, (newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('chesslab_theme', newTheme)
  }, { immediate: true })

  // --- Auth & Puzzle Pool ---
  const currentUser = ref(null)
  const allPuzzles = ref([])
  const puzzleQueue = ref([])
  const loading = ref(true)
  const puzzlesExhausted = ref(false)
  const solutionShown = ref(false)

  const currentPuzzle = shallowRef(null)
  const status = ref('idle') // 'idle', 'correct', 'wrong'
  const message = ref('Find the best move.')
  const activeTab = ref('puzzle')

  // Computed visibility for Analysis tab
  const canViewAnalysis = computed(() => status.value === 'correct' || solutionShown.value)

  // --- Hint System ---
  const hintShown = ref(false)
  const hintUsed = ref(false)
  const hintSquare = ref(null)

  function showHint() {
    if (status.value !== 'idle') return
    hintShown.value = true
    hintUsed.value = true
    
    // Highlight the piece that needs to move
    if (currentPuzzle.value?.bestMove) {
      hintSquare.value = currentPuzzle.value.bestMove.slice(0, 2)
    }
  }

  // --- Sound ---
  const soundOn = ref(localStorage.getItem('chesslab_puzzle_sound') !== 'false')
  watch(soundOn, (val) => localStorage.setItem('chesslab_puzzle_sound', String(val)))
  let audioCtx = null

  function ensureAudioCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      audioCtx = new Ctx()
    }
    if (audioCtx.state === 'suspended') audioCtx.resume()
    return audioCtx
  }

  function playSound(type) {
    if (!soundOn.value) return
    try {
      const ctx = ensureAudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      const now = ctx.currentTime

      const presets = {
        move:    { freq: 520, gain: 0.06, dur: 0.09, type: 'sine' },
        capture: { freq: 260, gain: 0.10, dur: 0.14, type: 'square' },
        check:   { freq: 880, gain: 0.10, dur: 0.20, type: 'sine' },
        correct: { freq: 660, gain: 0.10, dur: 0.30, type: 'sine' },
        wrong:   { freq: 160, gain: 0.10, dur: 0.30, type: 'square' },
      }
      const p = presets[type] ?? presets.move

      osc.type = p.type
      osc.frequency.setValueAtTime(p.freq, now)
      gain.gain.setValueAtTime(p.gain, now)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.dur)
      osc.start(now)
      osc.stop(now + p.dur + 0.02)
    } catch (e) {}
  }

  function soundForLastMove(sanMove) {
    if (chess.inCheck()) playSound('check')
    else if (sanMove?.captured) playSound('capture')
    else playSound('move')
  }

  // --- Rating Delta Popup ---
  const ratingDelta = ref(null)
  let ratingDeltaKey = 0
  function popRatingDelta(delta) {
    ratingDeltaKey++
    const key = ratingDeltaKey
    ratingDelta.value = { value: delta, key }
    setTimeout(() => {
      if (ratingDelta.value?.key === key) ratingDelta.value = null
    }, 1200)
  }

  // Persisted Session Stats
  const savedStats = JSON.parse(localStorage.getItem('chesslab_puzzle_session') || '{"solved":0,"failed":0}')
  const sessionStats = ref(savedStats)
  const streak = ref(Number(localStorage.getItem('chesslab_puzzle_streak')) || 0)

  const userRating = ref(Number(localStorage.getItem('chesslab_puzzle_rating')) || 1200)
  const boardAPI = shallowRef(null)
  const isFlipped = ref(false)

  // --- Engine & Analysis State ---
  let boardReady = false
  let engineReady = false
  const moveData = shallowRef(null)
  const isAnalyzing = ref(false)
  const currentDepth = ref(10)
  const targetDepth = ref(15)
  const sanLine = ref([])
  const excellentSanLine = ref([])
  const thirdSanLine = ref([])
  const bestMoveSan = ref('')
  const bestArrowSquares = ref(null)
  const height = ref(50)
  const cp = ref(0)
  const isAccuracy = ref("")
  const color = ref("")
  const lastMoveSquare = ref(null)
  const lastMoveAccuracy = ref(null)

  const chess = new Chess()
  const bestChess = new Chess()
  const greedyChess = new Chess()
  const excellentChess = new Chess()
  const thirdChess = new Chess()

  const moveTree = {
    id: 0, san: null, uci: null, fen: chess.fen(), accuracy: null, analysisData: null, parent: null, children: []
  }
  let nodeIdCounter = 1
  const nodeMap = { 0: moveTree }
  const currentNode = shallowRef(moveTree)
  const movesListUCI = ref([])

  onMounted(async () => {
    window.addEventListener('keydown', handleKeyDown)

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

    await startEngine()
    engineReady = true
    if (currentPuzzle.value) getAccuracy()
  })

  onBeforeUnmount(async () => {
    window.removeEventListener('keydown', handleKeyDown)
    await cancelAnalysis()
  })

  watch(sessionStats, (val) => {
    localStorage.setItem('chesslab_puzzle_session', JSON.stringify(val))
  }, { deep: true })

  watch(streak, (val) => {
    localStorage.setItem('chesslab_puzzle_streak', String(val))
  })

  // --- Keyboard Shortcuts ---
  function handleKeyDown(event) {
    if (event.repeat) return
    const key = event.key.toLowerCase()

    if ((key === ' ' || key === 'enter') && status.value !== 'idle') {
      event.preventDefault()
      loadRandomPuzzle()
    } else if (key === 'h' && status.value === 'idle' && !hintShown.value) {
      showHint()
    } else if (key === 's' && status.value === 'idle') {
      showSolution()
    }
  }

  async function fetchPuzzles() {
    if (!currentUser.value) return
    try {
      const q = query(collection(db, `users/${currentUser.value.uid}/games`))
      const snap = await getDocs(q)
      let temp = []

      snap.forEach(docSnap => {
        const data = docSnap.data()
        if (data.puzzles && Array.isArray(data.puzzles)) {
          data.puzzles.forEach((p, i) => {
            if (p.fen && p.bestMove && !p.solved) {
              temp.push({ ...p, id: `${docSnap.id}_${i}`, gameId: docSnap.id, indexInArray: i })
            }
          })
        }
      })

      allPuzzles.value = temp
      puzzlesExhausted.value = false

      if (allPuzzles.value.length > 0) {
        prepareQueue()
        loadRandomPuzzle()
      } else {
        puzzlesExhausted.value = true
      }
    } catch (e) {
      console.error("Failed to fetch puzzles:", e)
    }
  }

  function prepareQueue() {
    puzzleQueue.value = [...allPuzzles.value].sort(() => Math.random() - 0.5)
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

  function formatEval(evalObj) {
    if (chess.isGameOver()) {
      if (chess.isCheckmate()) return chess.turn() === 'w' ? '0-1' : '1-0'
      if (chess.isStalemate() || chess.isInsufficientMaterial() || chess.isThreefoldRepetition() || chess.isDraw()) return '1/2-1/2'
    }
    if (!evalObj) return "0.0"
    if (evalObj.type === "cp") return (evalObj.value / 100).toFixed(2)
    if (evalObj.type === "mate") return `M${evalObj.value}`
    return ""
  }

  function evalSize() {
    if (!moveData.value || !moveData.value.eval) return
    const evalValue = moveData.value.eval.value
    const evalType = moveData.value.eval.type
    if (evalType === "mate") {
      if (evalValue >= 0) { cp.value = 800; height.value = 0 }
      else { cp.value = -800; height.value = 100 }
      return
    }
    cp.value = Math.max(-800, Math.min(800, evalValue))
    height.value = 50 - (cp.value / 800) * 50
  }

  function loadRandomPuzzle() {
    if (puzzleQueue.value.length === 0) {
      puzzlesExhausted.value = true
      currentPuzzle.value = null
      return
    }

    currentPuzzle.value = puzzleQueue.value.pop()
    status.value = 'idle'
    solutionShown.value = false
    hintShown.value = false
    hintUsed.value = false
    hintSquare.value = null
    message.value = `Find the best move for ${currentPuzzle.value.turn === 'white' ? 'White' : 'Black'}.`
    activeTab.value = 'puzzle' // Reset to puzzle tab

    // Reset tree
    chess.load(currentPuzzle.value.fen)
    moveTree.fen = currentPuzzle.value.fen
    moveTree.children = []
    nodeIdCounter = 1
    for (const key in nodeMap) {
      if (parseInt(key) !== 0) delete nodeMap[key]
    }
    currentNode.value = moveTree
    movesListUCI.value = []

    if (boardAPI.value) {
      const shouldBeFlipped = currentPuzzle.value.turn === 'black'
      if (shouldBeFlipped !== isFlipped.value) {
        boardAPI.value.toggleOrientation()
        isFlipped.value = shouldBeFlipped
      }
      boardAPI.value.setPosition(currentPuzzle.value.fen)
      boardAPI.value.hideMoves()
    }

    getAccuracy()
  }

  function onBoardCreated(api) {
    boardAPI.value = api
    boardReady = true
    if (currentPuzzle.value) {
      nextTick(() => {
        const shouldBeFlipped = currentPuzzle.value.turn === 'black'
        if (shouldBeFlipped !== isFlipped.value) {
          boardAPI.value.toggleOrientation()
          isFlipped.value = shouldBeFlipped
        }
        boardAPI.value.setPosition(currentPuzzle.value.fen)
      })
    }
  }

  async function handleBothMoves(move) {
    if (status.value !== 'idle' || !currentPuzzle.value) {
      boardAPI.value.setPosition(currentNode.value.fen)
      return
    }

    if (boardAPI.value) boardAPI.value.hideMoves()
    hintSquare.value = null // Clear hint highlight on move

    const uci = move.promotion ? `${move.from}${move.to}${move.promotion}` : `${move.from}${move.to}`
    let sanMove
    try {
      sanMove = chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined })
    } catch (e) {
      sanMove = null
    }

    if (!sanMove) {
      boardAPI.value.setPosition(currentNode.value.fen)
      return
    }

    soundForLastMove(sanMove)

    const existing = currentNode.value.children.find(c => c.uci === uci)
    if (existing) {
      currentNode.value = existing
    } else {
      const newNode = {
        id: nodeIdCounter++, san: sanMove.san, uci, fen: chess.fen(), accuracy: null, analysisData: null, parent: currentNode.value, children: []
      }
      nodeMap[newNode.id] = newNode
      currentNode.value.children.push(newNode)
      currentNode.value = newNode
    }

    movesListUCI.value.push(uci)
    await getAccuracy(true) // true = check puzzle solution
  }

  async function getAccuracy(checkSolution = false) {
    await cancelAnalysis()

    const cached = currentNode.value.analysisData
    if (cached && cached.depth >= targetDepth.value) {
      moveData.value = cached
      lastMoveSquare.value = movesListUCI.value.at(-1)?.slice(2, 4) ?? null
      lastMoveAccuracy.value = cached.move_accuracy
      currentDepth.value = cached.depth
      isAnalyzing.value = false
      evalSize()
      moveDescription()
      sanBest()
      uciLine()
      uciSecondLine()
      uciThirdLine()
      drawBestArrow()
      if (checkSolution) checkPuzzleSolution()
      return
    }

    isAnalyzing.value = true
    bestArrowSquares.value = null

    const beforeFen = currentNode.value.parent ? currentNode.value.parent.fen : moveTree.fen
    const afterFen = currentNode.value.fen

    await getEvaluation(
      movesListUCI.value.length === 0 ? '' : movesListUCI.value.at(-1),
      movesListUCI.value.slice(0, -1),
      targetDepth.value,
      (result) => {
        moveData.value = result
        lastMoveSquare.value = movesListUCI.value.at(-1)?.slice(2, 4) ?? null
        lastMoveAccuracy.value = result.move_accuracy
        
        currentNode.value.accuracy = result.move_accuracy
        currentNode.value.analysisData = result
        currentDepth.value = result.depth
        isAnalyzing.value = false

        evalSize()
        moveDescription()
        sanBest()
        uciLine()
        uciSecondLine()
        uciThirdLine()
        drawBestArrow()

        if (checkSolution) checkPuzzleSolution()
      },
      beforeFen,
      afterFen,
      moveTree.fen,
      3 // MultiPV 3
    )
  }

  function checkPuzzleSolution() {
    if (status.value !== 'idle') return
    const acc = moveData.value?.move_accuracy
    const playedUci = currentNode.value.uci
    const playedSan = currentNode.value.san
    const dbBestMove = currentPuzzle.value.bestMove

    if (['brilliant', 'great', 'best', 'excellent'].includes(acc) || playedUci === dbBestMove) {
      streak.value += 1
      const basePoints = hintUsed.value ? 8 : 15
      const streakBonus = hintUsed.value ? 0 : (streak.value - 1) * 2
      const totalPoints = basePoints + streakBonus

      status.value = 'correct'
      sessionStats.value.solved++
      updateRating(totalPoints)
      popRatingDelta(totalPoints)
      playSound('correct')

      message.value = streak.value > 1 ? `Correct! +${totalPoints} points (🔥 ${streak.value}x Streak)` : `Correct! +${totalPoints} points.`
      
      // Mark puzzle as solved in Firestore
      if (currentUser.value && currentPuzzle.value.gameId && currentPuzzle.value.indexInArray !== undefined) {
        updateDoc(doc(db, `users/${currentUser.value.uid}/games`, currentPuzzle.value.gameId), {
          [`puzzles.${currentPuzzle.value.indexInArray}.solved`]: true
        }).catch(e => console.error("Failed to mark puzzle as solved:", e))
      }
      
      activeTab.value = 'analysis' // Auto switch to analysis tab
    } else {
      streak.value = 0
      updateRating(-10)
      popRatingDelta(-10)
      playSound('wrong')
      sessionStats.value.failed++
      status.value = 'wrong'
      message.value = 'Incorrect. That is not the best move. (-10 Rating)'

      // Reset board to puzzle start 
      if (boardAPI.value) {
        setTimeout(() => {
          boardAPI.value.setPosition(currentPuzzle.value.fen)
        }, 600)
      }
    }
  }

  function showSolution() {
    if (status.value === 'idle') {
      streak.value = 0
      updateRating(-10)
      popRatingDelta(-10)
      sessionStats.value.failed++
    }
    status.value = 'wrong'
    solutionShown.value = true
    message.value = 'Solution shown. Check the analysis tab!'

    if (boardAPI.value && currentPuzzle.value) {
      boardAPI.value.setPosition(currentPuzzle.value.fen)
      const from = currentPuzzle.value.bestMove.slice(0, 2)
      const to = currentPuzzle.value.bestMove.slice(2, 4)
      boardAPI.value.drawMove(from, to, 'green')
    }
    activeTab.value = 'analysis'
  }

  function drawBestArrow() {
    if (!boardAPI.value || !bestArrowSquares.value) return
    if (status.value === 'idle') return 
    boardAPI.value.drawMove(bestArrowSquares.value.from, bestArrowSquares.value.to, 'green')
  }

  function uciLine() {
    sanLine.value = []
    bestArrowSquares.value = null
    let lineNum = 0
    greedyChess.load(chess.fen())
    for (let i = 0; i < 30; i++) {
      const greedyMoveBefore = moveData.value.best_line[lineNum]
      if (!greedyMoveBefore) break
      const greedyMove = greedyChess.move(greedyMoveBefore, { sloppy: true })
      if (!greedyMove) break
      sanLine.value.push(greedyMove.san)
      if (lineNum === 0) bestArrowSquares.value = { from: greedyMove.from, to: greedyMove.to }
      lineNum++
    }
  }

  function uciSecondLine() {
    if (!moveData.value?.excellent_line) return
    excellentSanLine.value = []
    let secondLineNum = 0
    excellentChess.load(chess.fen())
    for (let i = 0; i < 30; i++) {
      const excellentMoveBefore = moveData.value.excellent_line[secondLineNum]
      if (!excellentMoveBefore) break
      const excellentMove = excellentChess.move(excellentMoveBefore, { sloppy: true })
      if (!excellentMove) break
      excellentSanLine.value.push(excellentMove.san)
      secondLineNum++
    }
  }

  function uciThirdLine() {
    if (!moveData.value?.third_line) return
    thirdSanLine.value = []
    let thirdLineNum = 0
    thirdChess.load(chess.fen())
    for (let i = 0; i < 30; i++) {
      const thirdMoveBefore = moveData.value.third_line[thirdLineNum]
      if (!thirdMoveBefore) break
      const thirdMove = thirdChess.move(thirdMoveBefore, { sloppy: true })
      if (!thirdMove) break
      thirdSanLine.value.push(thirdMove.san)
      thirdLineNum++
    }
  }

  function sanBest() {
    if (!moveData.value?.best_move) return
    const baseFen = currentNode.value.parent ? currentNode.value.parent.fen : moveTree.fen
    bestChess.load(baseFen)
    const bestMoveBefore = moveData.value.best_move
    const bestMove = bestChess.move(bestMoveBefore, { sloppy: true })
    if (!bestMove) return
    bestMoveSan.value = bestMove.san
  }

  function prettyMove(move) {
    const pieces = { 'K': '♚', 'Q': '♛', 'R': '♜', 'B': '♝', 'N': '♞' }
    return move ? move.replace(/[KQRBN]/g, p => pieces[p]) : ''
  }

  function accuracySymbol(acc) {
    if (acc === "brilliant") return '/moveClassifications/brilliant.png'
    if (acc === "best") return '/moveClassifications/best.png'
    if (acc === "excellent") return '/moveClassifications/excellent.png'
    if (acc === "good") return '/moveClassifications/good.png'
    if (acc === "inaccuracy") return '/moveClassifications/inaccuracy.png'
    if (acc === "mistake") return '/moveClassifications/mistake.png'
    if (acc === "blunder") return '/moveClassifications/blunder.png'
    if (acc === "great") return '/moveClassifications/great.png'
    if (acc === "book") return '/moveClassifications/book.png'
    return ''
  }

  function moveDescription() {
    isAccuracy.value = ''
    if (!currentNode.value.san) return
    const descriptions = {
      great:      { color: '#4c8cb5',  text: ' is a great move!'},
      brilliant:  { color: '#03aea7', text: ' is a brilliant move!!' },
      book:       { color: '#ad8760',   text: ' is a book move' },
      best:       { color: '#6ad13f',   text: ' is the best move' },
      excellent:  { color: '#90bc36',   text: ' is an excellent move' },
      good:       { color: '#8eae83', text: ' is a good move' },
      inaccuracy: { color: '#f2bc43',   text: ' is an inaccuracy' },
      mistake:    { color: '#f38800',   text: ' is a mistake' },
      blunder:    { color: '#FF0000',   text: ' is a blunder' },
    }
    const config = descriptions[moveData.value?.move_accuracy]
    if (!config) return
    color.value = config.color
    isAccuracy.value = prettyMove(currentNode.value.san) + config.text
  }

  function displayBest() {
    if (!moveData.value) return ""
    if (['brilliant', 'best', 'great', 'book'].includes(moveData.value.move_accuracy)) return ""
    if (moveData.value.best_move === "") return ""
    return prettyMove(bestMoveSan.value) + " was the best"
  }

  function squareStyle(square) {
    if (!square) return {}
    const file = square.charCodeAt(0) - 97
    const rank = parseInt(square[1]) - 1
    const flipped = isFlipped.value
    const col = flipped ? 7 - file : file
    const row = flipped ? rank : 7 - rank
    return {
      position: 'absolute',
      left: `${col * 12.5}%`,
      top: `${row * 12.5}%`,
      width: '12.5%',
      height: '12.5%',
      zIndex: 15,
      pointerEvents: 'none',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }
</script>

<template>
  <div class="grid-layout">
    <Title class="title-slot" />

    <!-- Empty States & Loaders -->
    <div v-if="loading" class="empty-state">
      <div class="loading-spinner"><div class="spinner-ring"></div><div class="spinner-ring"></div><div class="spinner-ring"></div></div>
      <p>Loading your puzzles...</p>
    </div>

    <div v-else-if="!currentUser" class="empty-state">
      <h2>Log In Required</h2>
      <p>Please log in from the top right to access and track your puzzles.</p>
    </div>

    <div v-else-if="puzzlesExhausted" class="empty-state exhausted-state">
      <div class="trophy-icon">🏆</div>
      <h2>All Caught Up!</h2>
      <p>You have successfully solved all the available puzzles generated from your games.</p>
      <div class="exhausted-actions">
        <router-link to="/Review" class="tool-btn primary">Import & Analyze a Game</router-link>
      </div>
      <p class="muted">Chesserly automatically creates puzzles based on mistakes you make in your imported games.</p>
    </div>

    <!-- Main Puzzle Layout -->
    <template v-else>
      <div class="board-area">
        <div class="board-wrapper">
          <div class="player-bar">
            <span class="player-color-dot" :class="currentPuzzle?.turn"></span>
            <span class="player-name">{{ currentPuzzle?.turn === 'white' ? 'White to Play' : 'Black to Play' }}</span>
          </div>

          <div class="board-row">
            <div class="evalbar" :class="{ 'is-visible': canViewAnalysis }">
              <div class="evalbar-inner">
                <template v-if="!isFlipped">
                  <div class="blackeval" :style="{ height: height + '%' }"></div>
                  <div class="whiteeval" :style="{ height: (100 - height) + '%' }"></div>
                </template>
                <template v-else>
                  <div class="whiteeval" :style="{ height: (100 - height) + '%' }"></div>
                  <div class="blackeval" :style="{ height: height + '%' }"></div>
                </template>
              </div>
              <p class="evalnum">{{ formatEval(moveData?.eval) }}</p>
            </div>

            <div class="board-col">
              <TheChessboard
                class="game-board"
                @move="handleBothMoves"
                @board-created="onBoardCreated"
                :board-config="{ coordinates: true, animation: { enabled: false } }"
              />
              
              <!-- Move Classification Icon -->
              <img
                v-if="lastMoveSquare && lastMoveAccuracy && canViewAnalysis"
                :src="accuracySymbol(lastMoveAccuracy)"
                class="board-acc-icon"
                :style="squareStyle(lastMoveSquare)"
              />
              
              <!-- Hint Highlight Circle -->
              <div v-if="hintSquare" :style="squareStyle(hintSquare)" class="hint-overlay">
                <div class="hint-circle"></div>
              </div>
            </div>
          </div>

          <div class="player-bar bottom">
            <span class="player-color-dot" :class="currentPuzzle?.turn === 'white' ? 'black' : 'white'"></span>
            <span class="player-name">Your Past Self</span>
          </div>
        </div>
      </div>

      <!-- Right Sidebar -->
      <div class="puzzle-sidebar">
        <!-- Tabs -->
        <div class="tabs-container">
          <button class="tab-btn" :class="{ active: activeTab === 'puzzle' }" @click="activeTab = 'puzzle'">
            Puzzle
          </button>
          <button 
            class="tab-btn" 
            :class="{ active: activeTab === 'analysis' }" 
            :disabled="!canViewAnalysis"
            @click="canViewAnalysis && (activeTab = 'analysis')"
          >
            Analysis
          </button>
        </div>

        <!-- Puzzle Tab Content -->
        <div v-show="activeTab === 'puzzle'" class="puzzle-tab-content">
          <div class="puzzle-header">
            <span class="player-color-dot" :class="currentPuzzle?.turn"></span>
            <span class="player-name">{{ currentPuzzle?.turn === 'white' ? 'White to Play' : 'Black to Play' }}</span>
            <div class="streak-badge" v-if="streak > 1">🔥 {{ streak }}</div>
          </div>

          <div class="rating-block">
            <span class="rating-label">Rating</span>
            <div class="rating-row">
              <span class="rating-value">{{ userRating }}</span>
              <Transition name="pop">
                <span
                  v-if="ratingDelta"
                  :key="ratingDelta.key"
                  class="rating-delta"
                  :class="ratingDelta.value >= 0 ? 'positive' : 'negative'"
                >
                  {{ ratingDelta.value >= 0 ? '+' : '' }}{{ ratingDelta.value }}
                </span>
              </Transition>
            </div>
            <span class="puzzles-remaining">{{ puzzleQueue.length }} puzzles remaining</span>
          </div>

          <div class="chat-bubble" :class="status">
            <p>{{ message }}</p>
          </div>

          <div class="action-buttons">
            <button v-if="status === 'idle' && !hintShown" class="tool-btn primary" @click="showHint">
              💡 Hint
            </button>
            <button v-if="status === 'idle' && hintShown" class="tool-btn outline" @click="showSolution">
              👁️ Show Solution
            </button>
            
            <button v-if="status === 'correct'" class="tool-btn primary" @click="loadRandomPuzzle">
              Next Puzzle →
            </button>
            
            <button v-if="status === 'wrong' && !solutionShown" class="tool-btn outline" @click="showSolution">
              Show Solution
            </button>
            <button v-if="status === 'wrong' && solutionShown" class="tool-btn primary" @click="loadRandomPuzzle">
              Next Puzzle →
            </button>
          </div>
          
          <div class="bottom-row">
            <p class="kbd-hint">Space: Next &nbsp;·&nbsp; H: Hint &nbsp;·&nbsp; S: Solution</p>
            <button class="icon-btn-sound" @click="soundOn = !soundOn">
              {{ soundOn ? '🔊' : '🔇' }}
            </button>
          </div>
        </div>

        <!-- Analysis Tab Content -->
        <div v-show="activeTab === 'analysis'" class="analysis-tab-content">
          <div class="analysis-panel">
            <div class="analyzis-header">
              <h3 class="analyzis-title">
                Engine Analysis
                <span v-if="isAnalyzing" class="thinking-dot" title="Engine is thinking"></span>
              </h3>
            </div>

            <div v-if="moveData" class="move-data">
              <p class="depthnum">Depth {{ currentDepth }}</p>
              
              <div class="line">
                <span class="evalnum2">{{ formatEval(moveData?.eval) }}</span>
                <span v-for="(move, idx) in sanLine" :key="'best-' + idx" class="line-move">
                  {{ prettyMove(move) }}&nbsp;
                </span>
              </div>

              <div class="secondline" v-if="excellentSanLine.length">
                <span class="evalnum3">{{ moveData?.excellent_eval != null ? (moveData.excellent_eval / 100).toFixed(2) : "" }}</span>
                <span v-for="(move, idx) in excellentSanLine" :key="'exc-' + idx" class="line-move">
                  {{ prettyMove(move) }}&nbsp;
                </span>
              </div>

              <div class="secondline" v-if="thirdSanLine.length">
                <span class="evalnum3">{{ moveData?.third_eval != null ? (moveData.third_eval / 100).toFixed(2) : "" }}</span>
                <span v-for="(move, idx) in thirdSanLine" :key="'third-' + idx" class="line-move">
                  {{ prettyMove(move) }}&nbsp;
                </span>
              </div>

              <p :style="{color: color}" class="accuracydescribtion">{{ isAccuracy }}</p>
              <p class="bestmove" v-if="movesListUCI.length > 0">{{ displayBest() }}</p>
            </div>
            <div v-else class="move-data">
              <p class="depthnum">Waiting for engine...</p>
            </div>
          </div>
        </div>

      </div>
    </template>
  </div>
</template>

<style scoped>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');

  .grid-layout {
    box-sizing: border-box;
    max-width: 1400px;
    margin: 0 auto;
    padding: clamp(0.5rem, 3vw, 1rem);
    display: grid;
    grid-template-columns: 1fr;
    grid-template-areas: "title" "board" "sidebar";
    gap: 1.5rem;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  }

  @media (min-width: 768px) {
    .grid-layout {
      grid-template-columns: auto 1fr;
      grid-template-areas: "title board" "title sidebar";
      gap: 1.5rem 2rem;
    }
  }

  @media (min-width: 1200px) {
    .grid-layout {
      grid-template-columns: auto 2fr 1.2fr;
      grid-template-areas: "title board sidebar";
      gap: 2rem;
    }
  }

  .title-slot { grid-area: title; min-width: 0; }
  .board-area { grid-area: board; display: flex; justify-content: center; width: 100%; min-width: 0; }
  .puzzle-sidebar { grid-area: sidebar; max-width: 380px; width: 100%; margin: 0 auto; }
  .empty-state { grid-column: 1; grid-row: 2 / 4; }
  @media (min-width: 768px) { .empty-state { grid-column: 2; grid-row: 1 / 3; } }
  @media (min-width: 1200px) { .empty-state { grid-column: 2 / 4; grid-row: 1; } }

  .empty-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1rem; min-height: 50vh; padding: 3rem 1rem; text-align: center;
    color: rgba(244, 240, 227, 0.7); font-size: 1rem;
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2));
    border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px;
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45);
  }
  .exhausted-state h2 { margin: 0; font-family: serif; font-size: 2rem; color: #f5f5dc; }
  .trophy-icon { font-size: 4rem; text-shadow: 0 4px 15px rgba(255, 215, 0, 0.3); }
  .exhausted-actions { margin-top: 1rem; }
  .empty-state .muted { max-width: 400px; margin-top: 1.5rem; font-size: 0.85rem; color: rgba(244, 240, 227, 0.4); }

  .loading-spinner { position: relative; width: 56px; height: 56px; margin-bottom: 1rem; }
  .spinner-ring {
    position: absolute; inset: 0; border: 3px solid transparent; border-radius: 50%;
    border-top-color: var(--text-highlight); animation: spinRing 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
  }
  .spinner-ring:nth-child(2) { inset: 7px; border-top-color: #a8d97a; animation-duration: 1.6s; animation-direction: reverse; }
  .spinner-ring:nth-child(3) { inset: 14px; border-top-color: #f4f0e3; animation-duration: 2s; }
  @keyframes spinRing { to { transform: rotate(360deg); } }

  .board-wrapper {
    position: relative; width: 100%; max-width: min(95vw, 40rem); min-width: 0; margin: 0 auto;
    display: flex; flex-direction: column;
  }
  .board-col { flex: 1 1 auto; min-width: 0; position: relative; display: flex; flex-direction: column; }
  .game-board { width: 100% !important; height: auto !important; aspect-ratio: 1 / 1 !important; display: block; }

  :deep(.cg-wrap) {
    width: 100% !important; height: 100% !important; overflow: hidden;
    border-radius: 8px; box-shadow: 0 15px 40px rgba(0, 0, 0, 0.4);
  }
  :deep(cg-board) {
    background: conic-gradient(
      var(--board-dark) 90deg, var(--board-light) 90deg 180deg,
      var(--board-dark) 180deg 270deg, var(--board-light) 270deg
    ) !important;
    background-size: 25% 25% !important;
  }
  .board-row { display: flex; justify-content: center; gap: 0.75rem; width: 100%; }

  .player-bar {
    box-sizing: border-box; display: flex; align-items: center; gap: 0.5rem;
    width: 100%; padding: 0.35rem 0.7rem; margin-bottom: 0.2rem; border-radius: 8px;
    background: rgba(0, 0, 0, 0.22); color: #f4f0e3; font-size: clamp(0.82rem, 1.8vw, 0.95rem);
  }
  .player-bar.bottom { margin-top: 0.2rem; margin-bottom: 0; }
  .player-color-dot { width: 0.6rem; height: 0.6rem; flex-shrink: 0; border-radius: 50%; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3); }
  .player-color-dot.white { background: #f4f0e3; }
  .player-color-dot.black { background: #1a1a1a; }
  .player-name { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }

  .evalbar {
    position: relative; width: clamp(24px, 4vw, 40px); flex-shrink: 0; display: flex;
    flex-direction: column; opacity: 0; pointer-events: none; transition: opacity 0.3s ease;
  }
  .evalbar.is-visible { opacity: 1; }
  .evalbar-inner {
    position: relative; width: 100%; height: 100%; display: flex; flex-direction: column;
    overflow: hidden; border-radius: 10px; box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.5);
  }
  .blackeval, .whiteeval { width: 100%; transition: height 0.6s cubic-bezier(0.4, 0, 0.2, 1); }
  .blackeval { background-color: #38412e; }
  .whiteeval { background-color: #626949; }
  .evalnum {
    position: absolute; top: 50%; left: 50%; z-index: 10; width: max-content; padding: 0.25rem 0.4rem;
    transform: translate(-50%, -50%); white-space: nowrap; font-family: "JetBrains Mono", monospace;
    font-size: clamp(0.62rem, 1vw, 0.85rem); font-weight: 600; color: #fff8ef;
    text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.6); background: rgba(0, 0, 0, 0.3);
    border-radius: 6px; backdrop-filter: blur(4px);
  }

  /* --- Sidebar Layout --- */
  .puzzle-sidebar {
    display: flex; flex-direction: column; min-height: 450px;
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2));
    border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px;
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .tabs-container {
    display: flex; width: 100%; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .tab-btn {
    flex: 1; padding: 1rem 0.5rem; background: transparent; border: none; cursor: pointer;
    color: rgba(244, 240, 227, 0.5); font-size: 0.9rem; font-weight: 600; letter-spacing: 0.5px;
    text-transform: uppercase; transition: all 0.2s ease; position: relative;
  }
  .tab-btn.active {
    color: #f5f5dc; background: rgba(255, 255, 255, 0.03);
  }
  .tab-btn.active::after {
    content: ''; position: absolute; bottom: 0; left: 20%; right: 20%; height: 3px;
    background: var(--text-highlight); border-radius: 3px 3px 0 0;
  }
  .tab-btn:disabled {
    cursor: not-allowed; opacity: 0.3;
  }

  .puzzle-tab-content, .analysis-tab-content {
    display: flex; flex-direction: column; padding: 1.5rem; gap: 1.5rem; flex: 1;
  }

  .puzzle-header {
    display: flex; align-items: center; gap: 0.5rem; font-weight: 600; color: #f4f0e3;
    font-size: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .streak-badge {
    margin-left: auto; padding: 0.25rem 0.6rem; font-size: 0.75rem; font-weight: 700; color: #ffb74d;
    background: rgba(255, 165, 0, 0.15); border: 1px solid rgba(255, 165, 0, 0.3); border-radius: 6px;
  }

  .rating-block {
    display: flex; flex-direction: column; align-items: center; gap: 0.25rem; padding: 0.5rem 0;
  }
  .rating-label {
    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 1.5px; color: rgba(244, 240, 227, 0.5);
  }
  .rating-row {
    position: relative; display: flex; align-items: baseline; justify-content: center;
  }
  .rating-value {
    font-family: "JetBrains Mono", monospace; font-size: 3rem; font-weight: 700; line-height: 1; color: var(--text-highlight);
  }
  .rating-delta {
    position: absolute; left: 100%; bottom: 10%; white-space: nowrap; margin-left: 0.75rem;
    font-family: "JetBrains Mono", monospace; font-size: 1.2rem; font-weight: 700;
  }
  .rating-delta.positive { color: #a8d97a; }
  .rating-delta.negative { color: #ff8a80; }
  .pop-enter-active { animation: popUp 1.2s ease forwards; }
  @keyframes popUp {
    0%   { opacity: 0; transform: translateY(4px); }
    15%  { opacity: 1; transform: translateY(-2px); }
    75%  { opacity: 1; transform: translateY(-10px); }
    100% { opacity: 0; transform: translateY(-16px); }
  }
  .puzzles-remaining {
    font-size: 0.75rem; color: rgba(244, 240, 227, 0.4); font-weight: 500;
  }

  .chat-bubble {
    padding: 1rem; border-radius: 12px; font-size: 0.95rem; font-weight: 500; text-align: center;
    color: #f4f0e3; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08);
    transition: all 0.3s ease;
  }
  .chat-bubble.correct {
    color: #a8d97a; background: rgba(168, 217, 122, 0.1); border-color: rgba(168, 217, 122, 0.2);
  }
  .chat-bubble.wrong {
    color: #ff8a80; background: rgba(255, 138, 128, 0.1); border-color: rgba(255, 138, 128, 0.2);
  }

  .action-buttons {
    margin-top: auto; display: flex; flex-direction: column; gap: 0.75rem;
  }
  .tool-btn {
    display: block; padding: 0.85rem 1.5rem; text-align: center; text-decoration: none;
    font-size: 1rem; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease;
  }
  .tool-btn.outline { color: #e8e8d0; background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.1); }
  .tool-btn.outline:hover { background: rgba(255, 255, 255, 0.1); }
  .tool-btn.primary { color: #15130d; background: var(--text-highlight); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3); }
  .tool-btn.primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4); filter: brightness(1.1); }

  .bottom-row {
    display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;
  }
  .kbd-hint { margin: 0; font-size: 0.65rem; text-align: center; color: rgba(244, 240, 227, 0.3); }
  .icon-btn-sound {
    width: 2rem; height: 2rem; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    font-size: 0.9rem; color: #e8e8d0; background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 6px; cursor: pointer; transition: background 0.2s ease;
  }
  .icon-btn-sound:hover { background: rgba(255, 255, 255, 0.1); }

  /* --- Analysis Panel Styles --- */
  .analysis-panel {
    display: flex; flex-direction: column; height: 100%; gap: 0.5rem;
  }
  .analyzis-header { margin-bottom: 0.5rem; }
  .analyzis-title {
    display: flex; align-items: center; gap: 0.5rem; margin: 0; font-family: serif;
    font-size: 1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #f5f5dc;
  }
  .thinking-dot {
    width: 0.4rem; height: 0.4rem; border-radius: 50%; background: #6ad13f;
    box-shadow: 0 0 8px rgba(106, 209, 63, 0.9); animation: thinkingPulse 1s ease-in-out infinite;
  }
  @keyframes thinkingPulse { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }

  .depthnum {
    margin: 0 0 0.5rem; font-family: 'Inter', sans-serif; font-size: 0.75rem; font-weight: 600;
    text-transform: uppercase; color: rgba(245, 245, 220, 0.6);
  }
  .line, .secondline {
    font-family: "JetBrains Mono", monospace; display: flex; white-space: nowrap; align-items: center;
    gap: 0.5rem; font-size: clamp(0.85rem, 2vw, 1rem); padding: 0.5rem; margin: 8px 0;
    background: rgba(0, 0, 0, 0.25); border-radius: 10px; color: #eae4d8;
    box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.4); overflow-x: auto; scrollbar-width: thin;
  }
  .evalnum2, .evalnum3 {
    font-size: clamp(1rem, 2vw, 1.3rem); color: #171717; background-color: #606847; border-radius: 10px;
    flex-shrink: 0; min-width: 4.4rem; width: auto; padding: 0 0.5rem; text-align: center;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .line-move { padding: 0 2px; }

  .accuracydescribtion {
    font-weight: 500; text-align: center; font-size: clamp(1rem, 2.1vw, 1.2rem);
    margin-top: 1rem; padding: 0 1rem; word-wrap: break-word;
  }
  .bestmove {
    color: #41a24e; text-align: center; font-weight: 600; margin-top: 0.1rem;
    font-size: clamp(0.9rem, 1rem, 1.1rem); padding: 0 1rem;
  }

  /* --- Board Overlays --- */
  .board-acc-icon {
    position: absolute; width: 4.5%; height: 4.5%; border-radius: 50%; pointer-events: none; z-index: 20;
    transform: translate(-50%, -50%);
  }

  .hint-overlay {
    z-index: 10; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    pointer-events: none;
  }
  .hint-circle {
    width: 70%; 
    height: 70%; 
    border-radius: 50%; 
    background: radial-gradient(circle, rgba(255, 215, 0, 0.4) 0%, rgba(255, 215, 0, 0) 70%);
    box-shadow: 0 0 15px 5px rgba(255, 215, 0, 0.3);
    animation: hintPulse 1.5s infinite;
  }
  @keyframes hintPulse {
    0% { transform: scale(0.7); opacity: 0.5; }
    50% { transform: scale(1.1); opacity: 1; }
    100% { transform: scale(0.7); opacity: 0.5; }
  }
</style>