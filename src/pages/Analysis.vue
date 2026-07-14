<script setup>
  import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch } from 'vue'
  import { Chess } from 'chess.js'
  import { TheChessboard } from 'vue3-chessboard'
  import 'vue3-chessboard/style.css'
  import Title from "../assets/Title.vue"
  import SettingsPanel from "../assets/SettingsPanel.vue"
  import { startEngine, getEvaluation, cancelAnalysis, setOnLichessRateLimited } from "../engine/engine.js"
  import { useRoute, useRouter } from 'vue-router'
  
  // Auth Integration imports
  import { auth, db } from '../firebase'
  import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
  import { collection, addDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore'

  const currentTheme = ref(localStorage.getItem('chesslab_theme') || 'brown')

  watch(currentTheme, (newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('chesslab_theme', newTheme)
  }, { immediate: true })

  const activeColor = ref('var(--btn-active)')
  const passiveColor = ref('var(--btn-idle)')

  let boardReady = false
  let engineReady = false 

  // Auth State
  const currentUser = ref(null)
  const authEmail = ref('')
  const authPassword = ref('')
  const isRegistering = ref(false)
  const authError = ref(null)
  const showGlobalAuthModal = ref(false)

  onMounted(async () => {
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('click', closeContextMenu)
    window.addEventListener('scroll', closeContextMenu, true)
    
    if(reportTitle.value) reportTitle.value.style.backgroundColor = passiveColor.value
    if(explorerTitle.value) explorerTitle.value.style.backgroundColor = passiveColor.value

    onAuthStateChanged(auth, (user) => {
      currentUser.value = user
    })

    setOnLichessRateLimited(() => {
      showToast("Using fully local analysis for now")
    })

    await startEngine();
    engineReady = true

    if (route.query.fen) {
      await loadFen(route.query.fen)
      await getAccuracy()
    } else if (route.query.moves) {
      await tryLoadImportedGame()
    } else {
      await getAccuracy()
    }
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('click', closeContextMenu)
    window.removeEventListener('scroll', closeContextMenu, true)
    clearTimeout(toastTimeout)
    clearTimeout(longPressTimer)
  })

  // State
  const route = useRoute()
  const router = useRouter()
  const isSettingsOpen = ref(false)
  const isFlipped = computed(() => (rotate.value / 180) % 2 === 1)

  const chess = new Chess()
  const greedyChess = new Chess()
  const excellentChess = new Chess()
  const bestChess = new Chess()
  const thirdChess = new Chess()

  const DEPTH_STORAGE_KEY = 'chesslab_targetDepth'
  function loadStoredDepth() {
    const stored = Number(localStorage.getItem(DEPTH_STORAGE_KEY))
    return stored >= 10 && stored <= 30 ? stored : 10
  }

  const moveData = shallowRef(null)
  const boardAPI = shallowRef(null)
  const isAnalyzing = ref(false)
  const isImporting = ref(false)
  const importProgress = ref({ current: 0, total: 0 })
  let importCancelled = false
  const currentDepth = ref(10)
  const targetDepth = ref(loadStoredDepth())
  const height = ref(47.75)
  const cp = ref(0)
  const rotate = ref(0)
  const isAccuracy = ref("")
  const color = ref("")
  const sanLine = ref([])
  const bestMoveSan = ref('')
  const excellentSanLine = ref([])
  const treeVersion = ref(0)
  const movesListUCI = ref([])
  const lastMoveSquare = ref(null)
  const lastMoveAccuracy = ref(null)
  const boardRef = ref(null)
  const movesListRef = ref(null)
  const thirdSanLine = ref([])
  const soundOn = ref(true)
  const showBestArrow = ref(true)
  const bestArrowSquares = ref(null) 
  const toastMessage = ref('')
  const activeTab = ref('moves')
  const explorerTitle = ref(null)
  const contextMenu = ref({ visible: false, x: 0, y: 0, nodeId: null })

  // Imported player info
  const whiteName = ref('White')
  const blackName = ref('Black')
  const whiteRating = ref(null)
  const blackRating = ref(null)
  const hasPlayerInfo = ref(false)

  // Lichess opening explorer
  const LICHESS_TOKEN = import.meta.env.VITE_LICHESS_TOKEN
  const opening = ref("")
  const openingEco = ref("")
  
  const explorerStats = shallowRef(null)     
  const explorerMoves = shallowRef([])       
  
  const explorerLoading = ref(false)
  const explorerError = ref("")

  async function handleGlobalAuthAction() {
    authError.value = null
    try {
      if (isRegistering.value) {
        await createUserWithEmailAndPassword(auth.value || auth, authEmail.value, authPassword.value)
      } else {
        await signInWithEmailAndPassword(auth.value || auth, authEmail.value, authPassword.value)
      }
      authEmail.value = ''
      authPassword.value = ''
      showGlobalAuthModal.value = false
      showToast("Authentication successful!")
    } catch (e) {
      authError.value = e.message
    }
  }

  async function handleGlobalLogout() {
    await signOut(auth)
    showToast("Logged out smoothly")
  }

  async function autoSaveAnalysedGameToLibrary() {
    if (!currentUser.value || movesListUCI.value.length === 0) return
    try {
      const finalPgn = chess.pgn()
      const q = query(
        collection(db, 'games'),
        where('userId', '==', currentUser.value.uid),
        where('pgn', '==', finalPgn)
      )
      const snap = await getDocs(q)
      if (snap.empty) {
        await addDoc(collection(db, 'games'), {
          userId: currentUser.value.uid,
          pgn: finalPgn,
          white: { username: whiteName.value, rating: Number(whiteRating.value) || 0, result: 'unknown' },
          black: { username: blackName.value, rating: Number(blackRating.value) || 0, result: 'unknown' },
          time_class: 'analysed',
          createdAt: serverTimestamp()
        })
      }
    } catch (e) {
      console.error("Analysis auto-save failure:", e)
    }
  }

  async function importLichessExplorer(){
    explorerLoading.value = true
    explorerError.value = ""

    const uciList = movesListUCI.value
    if (uciList.length > 40) {
      explorerLoading.value = false
      return
    }

    const bookList = uciList.join(",")
    const url = bookList
        ? `https://explorer.lichess.ovh/masters?play=${bookList}`
        : `https://explorer.lichess.ovh/masters`

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${LICHESS_TOKEN}`,
          'Accept': 'application/json'
        }
      })

      if (response.status === 204) {
        opening.value = "No master games at this position"
        openingEco.value = ""
        explorerStats.value = null
        explorerMoves.value = []
        explorerError.value = ""
        return
      }

      if (!response.ok) {
        explorerError.value = `Explorer error (${response.status})`
        explorerStats.value = null
        explorerMoves.value = []
        return
      }

      const data = await response.json()

      if (data.opening) {
          opening.value = data.opening.name
          openingEco.value = data.opening.eco
      } else {
          opening.value = uciList.length === 0 ? "Starting position" : "Out of book"
          openingEco.value = ""
      }

      const total = (data.white ?? 0) + (data.draws ?? 0) + (data.black ?? 0)
      explorerStats.value = total > 0 ? {
          white: Math.round((data.white / total) * 100),
          draws: Math.round((data.draws / total) * 100),
          black: Math.round((data.black / total) * 100),
          total
      } : null

      explorerMoves.value = (data.moves ?? [])
        .map(m => {
          const moveTotal = (m.white ?? 0) + (m.draws ?? 0) + (m.black ?? 0)
          return {
            san: m.san,
            uci: m.uci,
            total: moveTotal,
            percent: total > 0 ? Math.round((moveTotal / total) * 100) : 0,
            white: moveTotal > 0 ? Math.round((m.white / moveTotal) * 100) : 0,
            draws: moveTotal > 0 ? Math.round((m.draws / moveTotal) * 100) : 0,
            black: moveTotal > 0 ? Math.round((m.black / moveTotal) * 100) : 0,
          }
        })
        .sort((a, b) => b.total - a.total)

      explorerError.value = ""

    } catch (error) {
      console.warn("Explorer fetch failed:", error)
      explorerError.value = "No connection to explorer"
      explorerStats.value = null
      explorerMoves.value = []
    } finally {
      explorerLoading.value = false
    }
  }

  function playExplorerMove(uci) {
    const result = applyUciMove(uci)
    if (!result) return
    soundForLastMove(result)
    boardAPI.value.setPosition(chess.fen())
    getAccuracy()
  }

  if (route.query.white || route.query.black) {
    hasPlayerInfo.value = true
    if (route.query.white) whiteName.value = route.query.white
    if (route.query.black) blackName.value = route.query.black
    if (route.query.whiteRating) whiteRating.value = route.query.whiteRating
    if (route.query.blackRating) blackRating.value = route.query.blackRating
  }

  const topPlayer = computed(() => (
    isFlipped.value
      ? { name: whiteName.value, rating: whiteRating.value, side: 'white' }
      : { name: blackName.value, rating: blackRating.value, side: 'black' }
  ))

  const bottomPlayer = computed(() => (
    isFlipped.value
      ? { name: blackName.value, rating: blackRating.value, side: 'black' }
      : { name: whiteName.value, rating: whiteRating.value, side: 'white' }
  ))

  let longPressTimer = null
  let longPressTriggered = false
  let toastTimeout = null
  let audioCtx = null
  let lastPress = 0

  const moveTree = {
    id: 0, san: null, uci: null, fen: chess.fen(), accuracy: null, analysisData: null, parent: null, children: []
  }

  let nodeIdCounter = 1
  const nodeMap = { 0: moveTree }
  const currentNode = shallowRef(moveTree)

  const renderedMoves = computed(() => {
    treeVersion.value
    const rows = []

    function makeCell(node, moveNum, showAsStart, depth) {
      const isWhite = moveNum % 2 === 1
      return {
        key: `cell-${node.id}`,
        node,
        displayNum: Math.ceil(moveNum / 2),
        isWhite,
        showNum: isWhite || showAsStart,
        variant: depth > 0
      }
    }

    function walk(startNode, moveNum, depth = 0, isStartOfLine = true) {
      let current = startNode
      let ply = moveNum
      let firstRow = true

      if (!current.san) {
        if (current.children.length === 0) return
        walk(current.children[0], ply, depth, isStartOfLine)
        for (const variant of current.children.slice(1)) {
          walk(variant, ply, depth + 1, true)
        }
        return
      }

      while (current) {
        const mainReply = current.children[0] ?? null

        rows.push({
          key: `row-${current.id}`,
          depth,
          cells: [
            makeCell(current, ply, firstRow && isStartOfLine, depth),
            mainReply ? makeCell(mainReply, ply + 1, false, depth) : null
          ]
        })

        for (const variant of current.children.slice(1)) {
          walk(variant, ply + 1, depth + 1, true)
        }

        if (mainReply) {
          for (const variant of mainReply.children.slice(1)) {
            walk(variant, ply + 2, depth + 1, true)
          }
        }

        if (!mainReply) break
        current = mainReply.children[0] ?? null
        ply += 2
        firstRow = false
      }
    }

    walk(moveTree, 1)
    return rows
  })

  const movesTitle = ref(null)
  const reportTitle = ref(null)

  function changeActiveToMoves(){
    activeTab.value = 'moves'
    if (movesTitle.value) movesTitle.value.style.backgroundColor = activeColor.value
    if (reportTitle.value) reportTitle.value.style.backgroundColor = passiveColor.value
    if (explorerTitle.value) explorerTitle.value.style.backgroundColor = passiveColor.value
  }

  function changeActiveToReport(){
    activeTab.value = 'report'
    if (reportTitle.value) reportTitle.value.style.backgroundColor = activeColor.value
    if (movesTitle.value) movesTitle.value.style.backgroundColor = passiveColor.value
    if (explorerTitle.value) explorerTitle.value.style.backgroundColor = passiveColor.value
  }

  function changeActiveToExplorer(){
    activeTab.value = 'explorer'
    if (explorerTitle.value) explorerTitle.value.style.backgroundColor = activeColor.value
    if (movesTitle.value) movesTitle.value.style.backgroundColor = passiveColor.value
    if (reportTitle.value) reportTitle.value.style.backgroundColor = passiveColor.value
  }

  function deleteMove(nodeId) {
    const node = nodeMap[nodeId]
    if (!node || node.parent === null) return 

    const parent = node.parent
    const idx = parent.children.indexOf(node)
    if (idx !== -1) parent.children.splice(idx, 1)

    function collectIds(n, ids) {
      ids.push(n.id)
      for (const child of n.children) collectIds(child, ids)
      return ids
    }
    const idsToRemove = collectIds(node, [])
    const currentWasRemoved = idsToRemove.includes(currentNode.value.id)

    for (const id of idsToRemove) delete nodeMap[id]

    treeVersion.value++

    if (currentWasRemoved) {
      jumpToNode(parent.id)
    }
  }

  function showContextMenu(x, y, nodeId) {
    const menuWidth = 160
    const menuHeight = 44
    contextMenu.value = {
      visible: true,
      x: Math.min(x, window.innerWidth - menuWidth - 8),
      y: Math.min(y, window.innerHeight - menuHeight - 8),
      nodeId
    }
  }

  function closeContextMenu() { contextMenu.value.visible = false }

  function openContextMenu(event, nodeId) {
    showContextMenu(event.clientX, event.clientY, nodeId)
  }

  function handleDeleteFromMenu() {
    if (contextMenu.value.nodeId !== null) deleteMove(contextMenu.value.nodeId)
    closeContextMenu()
  }

  function handleTouchStart(event, nodeId) {
    longPressTriggered = false
    longPressTimer = setTimeout(() => {
      longPressTriggered = true
      const touch = event.touches[0]
      showContextMenu(touch.clientX, touch.clientY, nodeId)
      if (navigator.vibrate) navigator.vibrate(10)
    }, 500)
  }

  function cancelLongPress() { clearTimeout(longPressTimer) }

  function handleCellClick(nodeId) {
    if (longPressTriggered) {
      longPressTriggered = false
      return
    }
    jumpToNode(nodeId)
  }

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
        move:    { freq: 520, gain: 0.06, dur: 0.09 },
        capture: { freq: 260, gain: 0.10, dur: 0.14 },
        check:   { freq: 880, gain: 0.10, dur: 0.20 },
      }
      const p = presets[type] ?? presets.move

      osc.type = type === 'capture' ? 'square' : 'sine'
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

  watch(showBestArrow, (val) => {
    if (!val && boardAPI.value) boardAPI.value.hideMoves()
    else drawBestArrow()
  })

  watch(currentNode, () => {
    if (activeTab.value === 'explorer') {
      importLichessExplorer()
    }
  }, { immediate: true })

  watch(activeTab, (newTab) => {
    if (newTab === 'explorer') {
      importLichessExplorer()
    }
  })

  function showToast(message) {
    toastMessage.value = message
    clearTimeout(toastTimeout)
    toastTimeout = setTimeout(() => { toastMessage.value = '' }, 1800)
  }

  async function copyToClipboard(text, label) {
    try {
      await navigator.clipboard.writeText(text)
      showToast(`${label} copied to clipboard`)
    } catch (e) {
      showToast(`Couldn't copy ${label.toLowerCase()}`)
    }
  }

  function copyPGN() { copyToClipboard(chess.pgn() || '(no moves yet)', 'PGN') }
  function copyFEN() { copyToClipboard(chess.fen(), 'FEN') }

  function drawBestArrow() {
    if (!showBestArrow.value || !boardAPI.value || !bestArrowSquares.value) return
    const { from, to } = bestArrowSquares.value
    boardAPI.value.drawMove(from, to, 'green')
  }

  async function onBoardCreated(api) {
    boardAPI.value = api
    chess.reset()
    boardAPI.value.setPosition(chess.fen())
    boardReady = true
    await tryLoadImportedGame()
  }

  async function handleBothMoves(move) {
    const uci = move.promotion ? `${move.from}${move.to}${move.promotion}` : `${move.from}${move.to}`
    const sanMove = chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined })
    
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
      treeVersion.value++
    }

    movesListUCI.value.push(uci)
    await getAccuracy()
  }

  function undoMove() {
    lastMoveSquare.value = null
    lastMoveAccuracy.value = null
    if (currentNode.value.parent === null) return
    chess.undo()
    currentNode.value = currentNode.value.parent
    movesListUCI.value.pop()
    boardAPI.value.setPosition(chess.fen())
  }

  function redoMove() {
    lastMoveSquare.value = null
    lastMoveAccuracy.value = null
    if (currentNode.value.children.length === 0) return
    const nextNode = currentNode.value.children[0]
    const sanMove = chess.move(nextNode.uci)
    if (sanMove) soundForLastMove(sanMove)
    movesListUCI.value.push(nextNode.uci)
    currentNode.value = nextNode
    boardAPI.value.setPosition(nextNode.fen)
  }

  function undoAccuracy() { undoMove(); getAccuracy(); }
  function redoAccuracy() { redoMove(); getAccuracy(); }

  function jumpToNode(nodeId) {
    const node = nodeMap[nodeId]
    if (!node || node === currentNode.value) return

    const uciMoves = []
    let current = node
    while (current.parent !== null) {
      uciMoves.unshift(current.uci)
      current = current.parent
    }

    chess.reset()
    for (const uci of uciMoves) chess.move(uci)

    movesListUCI.value = uciMoves
    currentNode.value = node
    boardAPI.value.setPosition(node.fen)
    moveData.value = null
    isAccuracy.value = ""
    color.value = ""
    getAccuracy()
  }

  function goToStart() { jumpToNode(0) }
  function goToEnd() {
    let node = currentNode.value
    while (node.children.length > 0) node = node.children[0]
    jumpToNode(node.id)
  }

  function resetBoard() {
    chess.reset()
    boardAPI.value.setPosition(chess.fen())
    movesListUCI.value = []
    currentNode.value = moveTree
    moveTree.children = []
    moveTree.fen = chess.fen()
    nodeIdCounter = 1
    for (const key in nodeMap) {
      if (parseInt(key) !== 0) delete nodeMap[key]
    }
    treeVersion.value++
    getAccuracy()
  }

  function resetAccuracy() {
    resetBoard()
    isAccuracy.value = ""
    color.value = ""
    moveData.value = null
  }

  async function getAccuracy() {
    await cancelAnalysis() 
    
    const cached = currentNode.value.analysisData
    if (cached && cached.depth >= targetDepth.value) {
      moveData.value = cached
      lastMoveSquare.value = movesListUCI.value.at(-1)?.slice(2, 4) ?? null
      lastMoveAccuracy.value = cached.move_accuracy
      currentDepth.value = cached.depth
      
      isAnalyzing.value = false
      if (showBestArrow.value && boardAPI.value) boardAPI.value.hideMoves()
      
      evalSize()
      moveDescription()
      sanBest()
      uciSecondLine()
      uciThirdLine()
      uciLine()
      drawBestArrow()
      return 
    }

    isAnalyzing.value = true
    bestArrowSquares.value = null
    if (showBestArrow.value && boardAPI.value) boardAPI.value.hideMoves()

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
        uciSecondLine()
        uciThirdLine()
        uciLine()
        drawBestArrow()
        
        if (!isImporting.value) {
          treeVersion.value++
        }
      },
      beforeFen,
      afterFen,
      moveTree.fen
    )
  }

  function onDepthChange() {
    localStorage.setItem(DEPTH_STORAGE_KEY, String(targetDepth.value))
    getAccuracy()
  }

  function formatEval(evalObj) {
    if (!evalObj) return ""
    if (evalObj.type === "cp") return (evalObj.value / 100).toFixed(2)
    if (evalObj.type === "mate") return `#${evalObj.value}`
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

  function flipBoard() {
    boardAPI.value.toggleOrientation()
    rotate.value += 180
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
  }

  function moveDescription() {
    isAccuracy.value = ''
    if (!currentNode.value.san) return
    const descriptions = {
      great:      { color: '#4c8cb5', text: ' is a great move!'},
      brilliant:  { color: '#03aea7', text: ' is a brilliant move!!' },
      book:       { color: '#ad8760', text: ' is a book move' },
      best:       { color: '#6ad13f', text: ' is the best move' },
      excellent:  { color: '#90bc36', text: ' is an excellent move' },
      good:       { color: '#8eae83', text: ' is a good move' },
      inaccuracy: { color: '#f2bc43', text: ' is an inaccuracy' },
      mistake:    { color: '#f38800', text: ' is a mistake' },
      blunder:    { color: '#FF0000', text: ' is a blunder' },
    }
    const config = descriptions[moveData.value.move_accuracy]
    if (!config) return
    color.value = config.color
    isAccuracy.value = prettyMove(currentNode.value.san)  + config.text
  }

  function displayBest() {
    if (['brilliant', 'best', 'great', 'book'].includes(moveData.value.move_accuracy)) return ""
    if (moveData.value.best_move === "") return ""
    return prettyMove(bestMoveSan.value) + " was the best"
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

  function sanBest() {
    if (!moveData.value?.best_move) return
    const baseFen = currentNode.value.parent ? currentNode.value.parent.fen : moveTree.fen
    bestChess.load(baseFen)
    const bestMoveBefore = moveData.value.best_move
    const bestMove = bestChess.move(bestMoveBefore, { sloppy: true })
    if (!bestMove) return
    bestMoveSan.value = bestMove.san
  }

  function uciSecondLine() {
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

  function prettyMove(move) {
    const pieces = { 'K': '♚', 'Q': '♛', 'R': '♜', 'B': '♝', 'N': '♞' }
    return move.replace(/[KQRBN]/g, p => pieces[p])
  }

  function squareStyle(square) {
    if (!square) return {}
    const file = square.charCodeAt(0) - 97
    const rank = parseInt(square[1]) - 1
    const isFlipped = (rotate.value / 180) % 2 === 1
    const col = isFlipped ? 7 - file : file
    const row = isFlipped ? rank : 7 - rank
    return {
        position: 'absolute',
        left: `${(col + 1) * 12.5}%`,
        top: `${row * 12.5}%`,  
        transform: 'translate(-70%, -35%)',
    }
  }

  async function playMove() {
      if (!moveData.value?.best_move) return
      const uci = moveData.value.best_move
      const from = uci.slice(0, 2)
      const to = uci.slice(2, 4)
      const promotion = uci.length > 4 ? uci[4] : undefined

      undoMove()

      const sanMove = chess.move({ from, to, promotion: promotion ?? undefined })
      if (!sanMove) return

      soundForLastMove(sanMove)

      const existing = currentNode.value.children.find(c => c.uci === uci)
      if (existing) {
          currentNode.value = existing
      } else {
          const newNode = {
              id: nodeIdCounter++, san: sanMove.san, uci, fen: chess.fen(), accuracy: null, parent: currentNode.value, children: []
          }
          nodeMap[newNode.id] = newNode
          currentNode.value.children.push(newNode)
          currentNode.value = newNode
      }

      movesListUCI.value.push(uci)
      boardAPI.value.setPosition(chess.fen())  
      treeVersion.value++
      getAccuracy()  
  }

  const handleKeyDown = (event) => {
      const delay = 200 
      const currentTime = Date.now()

      if (event.repeat) return
      if (isImporting.value) return 

      switch (event.key) {
          case 'ArrowLeft':
              if (currentTime - lastPress < delay) return
              lastPress = currentTime
              undoAccuracy()
              break
          case 'ArrowRight':
              if (currentTime - lastPress < delay) return
              lastPress = currentTime
              redoAccuracy()
              break
          case 'Home':
              event.preventDefault()
              goToStart()
              break
          case 'End':
              event.preventDefault()
              goToEnd()
              break
      }
  }

  function applyUciMove(uci) {
      const from = uci.slice(0, 2)
      const to = uci.slice(2, 4)
      const promotion = uci.length > 4 ? uci[4] : undefined

      const sanMove = chess.move({ from, to, promotion: promotion ?? undefined })
      if (!sanMove) return false

      const existing = currentNode.value.children.find(c => c.uci === uci)
      if (existing) {
        currentNode.value = existing
      } else {
        const newNode = {
              id: nodeIdCounter++, san: sanMove.san, uci, fen: chess.fen(), accuracy: null, parent: currentNode.value, children: []
          }
          nodeMap[newNode.id] = newNode
          currentNode.value.children.push(newNode)
          currentNode.value = newNode
          
          if (!isImporting.value) {
            treeVersion.value++
          }
        }

        movesListUCI.value.push(uci)
        return sanMove
  }

  function playLineMoves(uciList, count) {
      if (!uciList) return
      let lastSanMove = null
      for (let i = 0; i < count; i++) {
        const uci = uciList[i]
        if (!uci) break
        const result = applyUciMove(uci)
        if (!result) break
        lastSanMove = result
      }
      if (lastSanMove) soundForLastMove(lastSanMove)
      boardAPI.value.setPosition(chess.fen())
      treeVersion.value++
      getAccuracy()
  }

  async function loadFen(fen){
    chess.load(fen)
    moveTree.fen = fen
    currentNode.value = moveTree
    if (boardAPI.value) boardAPI.value.setPosition(fen)
  }

  async function loadImportedGame(uciList) {
    isImporting.value = true
    importCancelled = false
    importProgress.value = { current: 0, total: uciList.length }
    try {
      for (const uci of uciList) {
        if (importCancelled) break
        const result = applyUciMove(uci)
        if (!result) break
        await getAccuracy()
        importProgress.value.current++
        boardAPI.value.setPosition(chess.fen())
      }
      if (!importCancelled) {
        goToStart()
        treeVersion.value++
        // Game has finished full engine evaluation -> automatically archive to cloud
        await autoSaveAnalysedGameToLibrary()
      }
    } finally {
      isImporting.value = false
    }
  }

  async function tryLoadImportedGame() {
    if (boardReady && engineReady && route.query.moves) {
      const importedUciList = route.query.moves.split('-')
      await loadImportedGame(importedUciList)
    }
  }

  async function cancelImport() {
    importCancelled = true
    await cancelAnalysis()
    isImporting.value = false
    resetAccuracy()
    hasPlayerInfo.value = false
    router.replace({ path: '/', query: {} })
  }

  const classificationOrder = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder']

  const classificationMeta = {
    brilliant:  { label: 'Brilliant',  color: '#03aea7' },
    great:      { label: 'Great',      color: '#4c8cb5' },
    best:       { label: 'Best',       color: '#6ad13f' },
    excellent:  { label: 'Excellent',  color: '#90bc36' },
    good:       { label: 'Good',       color: '#8eae83' },
    book:       { label: 'Book',       color: '#ad8760' },
    inaccuracy: { label: 'Inaccuracy', color: '#f2bc43' },
    mistake:    { label: 'Mistake',    color: '#f38800' },
    blunder:    { label: 'Blunder',    color: '#FF0000' }
  }

  const accuracyWeights = {
    brilliant: 100, great: 100, best: 100, book: 100,
    excellent: 90, good: 80, inaccuracy: 20, mistake: 10, blunder: 0
  }

  const gameReportStats = computed(() => {
    treeVersion.value

    function emptyCounts() {
      return classificationOrder.reduce((acc, key) => ({ ...acc, [key]: 0 }), {})
    }

    const white = { counts: emptyCounts(), weightedSum: 0, moveCount: 0 }
    const black = { counts: emptyCounts(), weightedSum: 0, moveCount: 0 }

    let current = moveTree.children[0] ?? null
    let ply = 1 

    while (current) {
      const side = ply % 2 === 1 ? white : black

      if (current.accuracy && side.counts.hasOwnProperty(current.accuracy)) {
        side.counts[current.accuracy]++
        side.weightedSum += accuracyWeights[current.accuracy] ?? 0
        side.moveCount++
      }

      current = current.children[0] ?? null
      ply++
    }

    const finalize = (side) => ({
      counts: side.counts,
      accuracy: side.moveCount > 0 ? (side.weightedSum / side.moveCount) : null
    })

    return { white: finalize(white), black: finalize(black) }
  })

  const importProgressPercent = computed(() => {
    if (!importProgress.value.total) return 0
    return Math.round((importProgress.value.current / importProgress.value.total) * 100)
  })
</script>

<template>
  <SettingsPanel 
    v-model:isOpen="isSettingsOpen"
    v-model:targetDepth="targetDepth"
    v-model:soundOn="soundOn"
    v-model:showBestArrow="showBestArrow"
    v-model:boardTheme="currentTheme"
    @depthChanged="onDepthChange"
  />

  <Transition name="loading-fade">
    <div v-if="isImporting" class="analysis-loading-overlay">
      <div class="loading-content">
        <div class="loading-spinner">
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
        </div>
        <p class="loading-title">Analyzing Game</p>
        <p class="loading-subtitle">Move {{ importProgress.current }} / {{ importProgress.total }} · Depth {{ targetDepth }}</p>
        <div class="loading-progress-bar">
          <div class="loading-progress-fill" :style="{ width: importProgressPercent + '%' }"></div>
        </div>
        <button class="cancel-import-btn" @click="cancelImport">Cancel review</button>
      </div>
    </div>
  </Transition>

  <!-- Global Account Dashboard Actions Block -->
  <div class="global-top-auth-action">
    <div v-if="currentUser" class="auth-pill-status">
      <span class="user-txt">👤 {{ currentUser.email }}</span>
      <button class="pill-btn danger" @click="handleGlobalLogout">Sign Out</button>
    </div>
    <div v-else class="auth-pill-status">
      <button class="pill-btn primary" @click="showGlobalAuthModal = true">Sign In / Register</button>
    </div>
  </div>

  <div class="grid-layout">
    <Title class="title-slot"/>
    <div class="board-area">
      <div class="board-wrapper" ref="boardRef">
        <div class="player-bar" v-if="hasPlayerInfo">
          <span class="player-color-dot" :class="topPlayer.side"></span>
          <span class="player-name">{{ topPlayer.name }}</span>
          <span class="player-rating" v-if="topPlayer.rating">{{ topPlayer.rating }}</span>
        </div>
        
        <div class="board-row">
          <div class="board-col">
            <TheChessboard 
              class="game-board"
              @move="handleBothMoves" 
              @board-created="onBoardCreated" 
              :board-config="{ coordinates: true }" 
            />
            <img
              v-if="lastMoveSquare && lastMoveAccuracy"
              :src="accuracySymbol(lastMoveAccuracy)"
              class="board-acc-icon"
              :style="squareStyle(lastMoveSquare)"
            />
          </div>
          
          <div class="evalbar">
            <div class="evalbar-inner">
              <template v-if="!isFlipped">
                <div class="blackeval" :style="{ height: height + '%', borderRadius: '10px 10px 0 0' }"></div>
                <div class="whiteeval" :style="{ height: (100 - height) + '%', borderRadius: '0 0 10px 10px' }"></div>
              </template>
              <template v-else>
                <div class="whiteeval" :style="{ height: (100 - height) + '%', borderRadius: '10px 10px 0 0' }"></div>
                <div class="blackeval" :style="{ height: height + '%', borderRadius: '0 0 10px 10px' }"></div>
              </template>
            </div>
            <p class="evalnum">{{ formatEval(moveData?.eval) }}</p>
          </div>
        </div>

        <div class="player-bar bottom" v-if="hasPlayerInfo">
          <span class="player-color-dot" :class="bottomPlayer.side"></span>
          <span class="player-name">{{ bottomPlayer.name }}</span>
          <span class="player-rating" v-if="bottomPlayer.rating">{{ bottomPlayer.rating }}</span>
        </div>
        
        <div class="boardtools">
          <button class="jumpstart" @click="goToStart" :disabled="isImporting || currentNode.parent === null" title="Jump to start"><<</button>
          <button class="undo" @click="undoAccuracy" title="previous" :disabled="isImporting || currentNode.parent === null"><-</button>
          <button class="reverse" @click="flipBoard" title="flip board">↳↰</button>
          <button class="redo" title="next" @click="redoAccuracy" :disabled="isImporting || currentNode.children.length === 0">-></button>
          <button class="jumpend" @click="goToEnd" :disabled="isImporting || currentNode.children.length === 0" title="Jump to end">>></button>
        </div>
      </div>
    </div>
    
    <div class="analysis-container">
      <div class="analyze">
        <div class="analyzis-header">
          <h2 class="analyzis">
            Analysis
            <span v-if="isAnalyzing" class="thinking-dot" title="Engine is thinking"></span>
          </h2>
          <button class="settings-btn" @click="isSettingsOpen = true" title="Settings">⚙️</button>
        </div>
        <div v-if="moveData" class="move-data">
          <p class="depthnum">Depth {{ currentDepth }}</p>
          
          <div class="line">
            <span class="evalnum2">{{ formatEval(moveData?.eval) }}</span>
            <span v-for="(move, idx) in sanLine" :key="'best-' + idx" class="line-move" @click="playLineMoves(moveData.best_line, idx + 1)">
              {{ prettyMove(move) }}&nbsp;
            </span>
          </div>

          <div class="secondline" v-if="excellentSanLine.length">
            <span class="evalnum3">{{ moveData?.excellent_eval != null ? (moveData.excellent_eval / 100).toFixed(2) : "" }}</span>
            <span v-for="(move, idx) in excellentSanLine" :key="'exc-' + idx" class="line-move" @click="playLineMoves(moveData.excellent_line, idx + 1)">
              {{ prettyMove(move) }}&nbsp;
            </span>
          </div>

          <div class="secondline" v-if="thirdSanLine.length">
            <span class="evalnum3">{{ moveData?.third_eval != null ? (moveData.third_eval / 100).toFixed(2) : "" }}</span>
            <span v-for="(move, idx) in thirdSanLine" :key="'third-' + idx" class="line-move" @click="playLineMoves(moveData.third_line, idx + 1)">
              {{ prettyMove(move) }}&nbsp;
            </span>
          </div>
          
          <p :style="{color: color}" class="accuracydescribtion">{{ isAccuracy }}</p>
          <p class="bestmove" v-if="movesListUCI.length > 0" @click="playMove">{{ displayBest() }}</p>
          
          <div class="sharebar">
            <button class="sharebtn" @click="copyPGN">Copy PGN</button>
            <button class="sharebtn" @click="copyFEN">Copy FEN</button>
          </div>
        </div>
      </div>
      <div class="moves">
        
        <div class="movesButtons">
          <button class="movehistory" @click="changeActiveToMoves()" ref="movesTitle">Moves</button>
          <button class="movehistory" @click="changeActiveToReport()" ref="reportTitle">Report</button>
          <button class="movehistory" @click="changeActiveToExplorer()" ref="explorerTitle">Explorer</button>
        </div>
        
        <div class="moveslist" v-if="activeTab === 'moves'" ref="movesListRef">
          <template v-for="row in renderedMoves" :key="row.key">
            <div class="move-row" :class="{ variant: row.depth > 0 }" :style="{ '--indent': `${row.depth * 1.05}rem` }">
              <div
                v-for="(cell, index) in row.cells"
                :key="cell ? cell.key : `${row.key}-empty-${index}`"
                class="move-cell"
                :class="[{ active: cell && cell.node === currentNode, variant: cell && cell.variant }, { empty: !cell }]"
                @click="cell && handleCellClick(cell.node.id)"
                @contextmenu.prevent="cell && openContextMenu($event, cell.node.id)"
                @touchstart="cell && handleTouchStart($event, cell.node.id)"
                @touchend="cancelLongPress"
                @touchmove="cancelLongPress"
              >
                <template v-if="cell">
                  <span v-if="cell.showNum" class="move-num">{{ cell.displayNum }}{{ cell.isWhite ? '.' : '...' }}</span>
                  <span class="move-san-text">{{ cell.node.san }}</span>
                  <img v-if="cell.node.accuracy" :src="accuracySymbol(cell.node.accuracy)" class="acc-badge" :class="cell.node.accuracy"/>
                </template>
              </div>
            </div>
          </template>
        </div>

        <div class="report" v-else-if="activeTab === 'report'">
          <div class="report-columns">
            <div class="report-col">
              <div class="report-side-header">
                <span class="side-swatch white-swatch"></span>
                <span>White</span>
              </div>
              <div class="accuracy-score" v-if="gameReportStats.white.accuracy !== null">
                {{ gameReportStats.white.accuracy.toFixed(1) }}<span class="accuracy-percent">%</span>
              </div>
              <div class="accuracy-score empty" v-else>—</div>

              <div
                v-for="key in classificationOrder"
                :key="'w-' + key"
                class="report-row"
                :class="{ dim: gameReportStats.white.counts[key] === 0 }"
              >
                <img :src="accuracySymbol(key)" class="report-row-icon" />
                <span class="report-row-label" :style="{ color: classificationMeta[key].color }">{{ classificationMeta[key].label }}</span>
                <span class="report-row-count">{{ gameReportStats.white.counts[key] }}</span>
              </div>
            </div>

            <div class="report-col">
              <div class="report-side-header">
                <span class="side-swatch black-swatch"></span>
                <span>Black</span>
              </div>
              <div class="accuracy-score" v-if="gameReportStats.black.accuracy !== null">
                {{ gameReportStats.black.accuracy.toFixed(1) }}<span class="accuracy-percent">%</span>
              </div>
              <div class="accuracy-score empty" v-else>—</div>

              <div
                v-for="key in classificationOrder"
                :key="'b-' + key"
                class="report-row"
                :class="{ dim: gameReportStats.black.counts[key] === 0 }"
              >
                <img :src="accuracySymbol(key)" class="report-row-icon" />
                <span class="report-row-label" :style="{ color: classificationMeta[key].color }">{{ classificationMeta[key].label }}</span>
                <span class="report-row-count">{{ gameReportStats.black.counts[key] }}</span>
              </div>
            </div>
          </div>
        </div>

      <div class="explorer" v-else-if="activeTab === 'explorer'">
        <div v-if="explorerLoading" class="explorer-status">Loading…</div>
        <div v-else-if="explorerError" class="explorer-status error">{{ explorerError }}</div>
        <template v-else>
          <div class="explorer-header">
            <span class="explorer-eco" v-if="openingEco">{{ openingEco }}</span>
            <span class="explorer-name">{{ opening }}</span>
          </div>

          <div class="explorer-table" v-if="explorerMoves.length">
            <div class="explorer-row explorer-row-head">
              <span class="col-move">Move</span>
              <span class="col-games">Games</span>
              <span class="col-split">White / Draw / Black</span>
            </div>

            <div
              v-for="m in explorerMoves"
              :key="m.uci"
              class="explorer-row"
              @click="playExplorerMove(m.uci)"
            >
              <span class="col-move">{{ prettyMove(m.san) }}</span>
              <span class="col-games">
                <span class="games-percent">{{ m.percent }}%</span>
                <span class="games-count">{{ m.total.toLocaleString() }}</span>
              </span>
              <span class="col-split">
                <div class="split-bar">
                  <div class="split-white" :style="{ width: m.white + '%' }" :title="`White ${m.white}%`"></div>
                  <div class="split-draw" :style="{ width: m.draws + '%' }" :title="`Draws ${m.draws}%`"></div>
                  <div class="split-black" :style="{ width: m.black + '%' }" :title="`Black ${m.black}%`"></div>
                </div>
              </span>
            </div>
          </div>
          <div class="explorer-status" v-else>No games found for this position</div>
        </template>
      </div>

      </div>
    </div>
  </div>

  <!-- Central Modal Box Pop-up Layer -->
  <div v-if="showGlobalAuthModal" class="global-modal-backdrop" @click.self="showGlobalAuthModal = false">
    <div class="auth-dialog">
      <h3>{{ isRegistering ? 'Create Account' : 'Login Port' }}</h3>
      <input v-model="authEmail" type="email" placeholder="Email Address" class="dialog-input" />
      <input v-model="authPassword" type="password" placeholder="Password Code" class="dialog-input" />
      <button class="pill-btn primary full-width" @click="handleGlobalAuthAction">Submit Entry</button>
      <p v-if="authError" class="dialog-error">{{ authError }}</p>
      <button class="swap-mode-btn" @click="isRegistering = !isRegistering">
        {{ isRegistering ? 'Existing Profile? Log In' : 'New Here? Create Account' }}
      </button>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      @click.stop
    >
      <button class="context-menu-item delete" @click="handleDeleteFromMenu">Delete move</button>
    </div>
  </Teleport>

  <Transition name="toast-fade">
    <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
  </Transition>
</template>

<style scoped>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght=600;700&family=Inter:wght=400;500;600;700&display=swap');

  /* Updated layout: review.vue covers the whole page with title next to it */
  .grid-layout {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 1.5rem;
    display: grid;
    grid-template-columns: auto 1.3fr 1fr;
    grid-template-areas: "title board analysis";
    gap: 2rem;
    width: 100vw;
    min-height: 100vh;
    max-width: none;
    margin: 0;
    box-sizing: border-box;
  }

  .global-top-auth-action {
    position: absolute;
    top: 1rem;
    right: 2rem;
    z-index: 100;
  }

  .auth-pill-status {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    background: rgba(0, 0, 0, 0.45);
    padding: 0.4rem 0.8rem;
    border-radius: 30px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .user-txt { color: #f4f0e3; font-size: 0.82rem; font-weight: 500; }

  .pill-btn {
    border: none;
    padding: 0.35rem 0.9rem;
    font-size: 0.78rem;
    font-weight: 700;
    border-radius: 20px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .pill-btn.primary { background: var(--btn-active); color: #f4f0e3; }
  .pill-btn.danger { background: rgba(230, 80, 80, 0.15); color: #ffb0a8; border: 1px solid rgba(230,80,80,0.3); }
  .full-width { width: 100%; }

  .global-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 300;
  }

  .auth-dialog {
    background: #1c1c22;
    padding: 2.2rem;
    border-radius: 14px;
    width: 300px;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    border: 1px solid rgba(255,255,255,0.08);
  }

  .auth-dialog h3 { font-family: serif; font-size: 1.25rem; color: #f5f5dc; text-align: center; margin: 0; }

  .dialog-input {
    padding: 0.55rem 0.7rem;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.3);
    color: #fff;
  }

  .dialog-error { color: #ffb0a8; font-size: 0.8rem; background: rgba(255,0,0,0.1); padding: 0.4rem; border-radius: 4px; }

  .swap-mode-btn { background: none; border: none; color: var(--text-highlight); font-size: 0.78rem; text-decoration: underline; cursor: pointer; }

  .title-slot { grid-area: title; min-width: 0; }

  .board-area {
    grid-area: board;
    display: flex;
    justify-content: center;
    width: 100%;
    min-width: 0;
  }

  .board-wrapper {
    position: relative;
    width: 100%;
    max-width: min(95vw, 38rem); 
    min-width: 0;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
  }

  .board-col {
    flex: 1 1 auto;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .game-board {
    width: 100% !important;
    height: auto !important;
    aspect-ratio: 1 / 1 !important;
    display: block;
  }

  :deep(.cg-wrap) {
    overflow: hidden;
    width: 100% !important;
    height: 100% !important;
    box-shadow: 0 15px 40px rgba(0, 0, 0, 0.4);
    border-radius: 8px;
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

  .board-row {
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
  }

  .evalbar {
    width: clamp(24px, 4vw, 40px);
    flex-shrink: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .evalbar-inner {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: inset 0 2px 5px rgba(0,0,0,0.5);
  }

  .player-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.7rem;
    margin-bottom: 0.2rem;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.22);
    color: #f4f0e3;
    font-size: clamp(0.82rem, 1.8vw, 0.95rem);
    width: 100%;
    box-sizing: border-box;
  }

  .player-bar.bottom { margin-bottom: 0; margin-top: 0.2rem; }

  .player-color-dot {
    width: 0.6rem; height: 0.6rem; border-radius: 50%; flex-shrink: 0;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3);
  }
  .player-color-dot.white { background: #f4f0e3; }
  .player-color-dot.black { background: #1a1a1a; }

  .player-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .player-rating {
    font-family: "JetBrains Mono", monospace; font-size: 0.8em; color: rgba(244, 240, 227, 0.75);
    margin-left: auto; background: rgba(0, 0, 0, 0.25); border-radius: 6px; padding: 0.05rem 0.4rem; flex-shrink: 0;
  }

  .moves {
    margin-top: 10px; background: linear-gradient(145deg, var(--panel-1), var(--panel-2)); border-radius: 16px;
    width: 100%; max-width: 500px; height: clamp(300px, 50vh, 500px);
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    overflow-y: auto; overflow-x: hidden; box-sizing: border-box; border: 1px solid rgba(255, 255, 255, 0.08);
    margin: 0 auto; scrollbar-width: thin; scrollbar-color: rgba(194, 197, 170, 0.4) rgba(0, 0, 0, 0.2);
  }

  @media (min-width: 1200px) { .moves { max-width: 20rem; } }

  .moveslist {
    margin: 0 auto; padding: 12px; width: 100%; box-sizing: border-box;
    background: linear-gradient(135deg, var(--list-1), var(--list-2)); border-radius: 14px;
    font-size: clamp(0.9rem, 2vw, 1rem); box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.25);
    display: flex; flex-direction: column; gap: 0.55rem; scroll-behavior: smooth;
  }

  .movesButtons { display: flex; justify-content: center; gap: 0.5rem; }

  .move-row {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem;
    align-items: start; margin-left: var(--indent, 0rem); padding-left: 0.35rem; position: relative;
  }

  .move-row.variant { border-left: 2px solid rgba(232, 232, 208, 0.16); }

  .move-cell {
    min-height: 2.45rem; padding: 0.55rem 0.7rem; border-radius: 12px; cursor: pointer; color: #f4f0e3;
    font-weight: 500; transition: all 0.15s ease; display: flex; align-items: center; flex-wrap: wrap;
    gap: 0.35rem; background: rgba(0, 0, 0, 0.12); border: 1px solid rgba(255, 255, 255, 0.06);
    box-sizing: border-box; overflow: hidden; user-select: none;
  }

  .move-cell:hover { background: rgba(103, 122, 228, 0.18); transform: translateY(-1px); }

  .move-cell.active {
    background: linear-gradient(135deg, rgba(103, 122, 228, 0.42), rgba(103, 122, 228, 0.22));
    border-color: rgba(220, 228, 255, 0.7); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 18px rgba(103, 122, 228, 0.25);
  }

  .move-cell.variant { color: #dbe4ff; background: rgba(255, 255, 255, 0.06); }
  .move-cell.empty { pointer-events: none; background: transparent; border-color: transparent; box-shadow: none; }

  .move-num { color: rgba(232, 232, 208, 0.72); font-size: 0.78em; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 999px; background: rgba(0, 0, 0, 0.16); }

  .move-san-text { font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .acc-badge { width: 20px; height: 20px; border-radius: 50%; margin-left: 2px; }

  .analysis-container { grid-area: analysis; display: flex; flex-direction: column; gap: 1rem; min-width: 0; }

  .analyze {
    border-radius: 15px; width: 100%; max-width: 500px; min-height: 200px; padding-bottom: 1rem;
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2)); box-sizing: border-box;
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.08); margin: auto;
  }

  @media (min-width: 1200px) { .analyze { max-width: 20rem; } }

  .analyzis-header { display: flex; justify-content: flex-end; align-items: center; gap: 3rem; padding: 1rem 1rem 0.5rem; }

  .analyzis {
    font-family: serif; color: #f5f5dc; font-weight: 700; text-transform: uppercase;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3); letter-spacing: 2px; font-size: clamp(1.1rem, 2.5vw, 1.4rem);
    display: flex; align-items: center; gap: 0.5rem; margin: 0;
  }

  .settings-btn {
    background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 8px;
    width: 36px; height: 36px; flex-shrink: 0; display: flex; justify-content: center; align-items: center;
    cursor: pointer; transition: all 0.2s ease;
  }
  .settings-btn:hover { background: rgba(0, 0, 0, 0.4); transform: scale(1.05); }

  .thinking-dot {
    width: 0.5rem; height: 0.5rem; border-radius: 50%; background: #6ad13f; box-shadow: 0 0 8px rgba(106, 209, 63, 0.9);
    animation: thinkingPulse 1s ease-in-out infinite;
  }

  @keyframes thinkingPulse { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }

  .analysis-loading-overlay {
    position: fixed; inset: 0; z-index: 500; display: flex; align-items: center; justify-content: center;
    background: rgba(15, 10, 6, 0.25); backdrop-filter: blur(4px) saturate(105%);
  }

  .loading-content {
    display: flex; flex-direction: column; align-items: center; gap: 0.9rem; padding: 2rem 2.5rem;
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2)); border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 18px; box-shadow: 0 20px 45px rgba(0, 0, 0, 0.5); max-width: min(90vw, 22rem);
  }

  .loading-spinner { position: relative; width: 64px; height: 64px; }

  .spinner-ring {
    position: absolute; inset: 0; border-radius: 50%; border: 3px solid transparent;
    border-top-color: var(--text-highlight); animation: spinRing 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
  }
  .spinner-ring:nth-child(2) { inset: 8px; border-top-color: #a8d97a; animation-duration: 1.6s; animation-direction: reverse; }
  .spinner-ring:nth-child(3) { inset: 16px; border-top-color: #f4f0e3; animation-duration: 2s; }

  @keyframes spinRing { to { transform: rotate(360deg); } }

  .loading-title {
    font-family: serif; color: #f5f5dc; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1.5px; font-size: 1.05rem; margin: 0; text-align: center; text-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }
  .loading-subtitle { font-family: "JetBrains Mono", monospace; color: rgba(244, 240, 227, 0.8); font-size: 0.82rem; margin: 0; text-align: center; }

  .loading-progress-bar { width: 180px; height: 5px; border-radius: 999px; background: rgba(0, 0, 0, 0.35); overflow: hidden; margin-top: 0.2rem; }
  .loading-progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--text-highlight), #a8d97a); transition: width 0.3s ease; }

  .cancel-import-btn {
    margin-top: 0.5rem; padding: 0.55rem 1.3rem; border-radius: 8px; border: 1px solid rgba(255, 107, 107, 0.35);
    background: rgba(255, 60, 60, 0.12); color: #ffb0a8; font-weight: 600; font-size: 0.85rem; cursor: pointer; transition: background 0.2s ease, border-color 0.2s ease;
  }
  .cancel-import-btn:hover { background: rgba(255, 60, 60, 0.22); border-color: rgba(255, 107, 107, 0.55); }

  .movehistory {
    font-family: serif; position: sticky; text-align: center; color: #f5f5dc; font-weight: 700; text-transform: uppercase;
    margin: 20px 0; text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3); letter-spacing: 2.5px; padding: 0.5rem 1.5rem;
    border-radius: 5px; background-color: var(--btn-idle); border: none; font-size: clamp(1rem, 2vw, 1.2rem);
  }

  .boardtools {
    display: flex; gap: 0.75rem; justify-content: center; align-items: center; min-height: 3.2rem; width: 100%; box-sizing: border-box;
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2)); border: 2px solid rgba(182, 173, 144, 0.4);
    padding: 0.5rem 1rem; border-radius: 10px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); margin: 0.4rem 0 0 0; flex-wrap: wrap; position: relative;
  }

  .reverse, .undo, .redo, .jumpstart, .jumpend {
    background-color: var(--btn-idle); width: clamp(35px, 8vw, 40px); height: clamp(35px, 8vw, 40px);
    border: none; border-radius: 15px; font-size: clamp(16px, 4vw, 20px); color: #e8e8d0; cursor: pointer; transition: all 0.2s ease; flex-shrink: 0;
  }
  .reverse:disabled, .undo:disabled, .redo:disabled, .jumpstart:disabled, .jumpend:disabled { opacity: 0.4; cursor: not-allowed; }

  .reverse:hover:not(:disabled), .undo:hover:not(:disabled), .redo:hover:not(:disabled), .jumpstart:hover:not(:disabled), .jumpend:hover:not(:disabled) {
      background: linear-gradient(145deg, var(--panel-1), var(--panel-2)); border-color: rgba(232, 232, 208, 0.6); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  }

  .blackeval, .whiteeval { width: 100%; transition: all 0.5s ease; position: relative; }
  .blackeval { background-color: #38412e; }
  .whiteeval { background-color: #626949; }

  .evalnum {
      font-family: "JetBrains Mono", monospace; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      font-size: clamp(0.8rem, 1.2vw, 1rem); font-weight: 500; color: #fff8ef; text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.6);
      background: rgba(0, 0, 0, 0.3); padding: 0.25rem 0.5rem; border-radius: 6px; backdrop-filter: blur(4px); z-index: 10;
  }

  .accuracydescribtion { font-weight: 500; text-align: center; font-size: clamp(1rem, 2.1vw, 1.2rem); margin-top: 1rem; padding: 0 1rem; word-wrap: break-word; }
  .bestmove { color: #41a24e; text-align: center; font-weight: 600; margin-top: 0.1rem; font-size: clamp(0.9rem, 1rem, 1.1rem); padding: 0 1rem; cursor: pointer; text-decoration: underline; }
  .move-data { padding: 0 1rem; }
  .depthnum { font-family: 'Inter', sans-serif; text-align: center; color: rgba(245, 245, 220, 0.7); font-size: 0.78rem; font-weight: 600; text-transform: uppercase; margin: 0.3rem 0 0.5rem; }

  .line, .secondline {
      font-family: "JetBrains Mono", monospace; display: flex; white-space: nowrap; align-items: center; gap: 0.5rem;
      font-size: clamp(0.85rem, 2vw, 1rem); padding: 0.5rem; margin: 8px 0; background: rgba(0, 0, 0, 0.25);
      border-radius: 10px; color: #eae4d8; box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.4); overflow-x: auto;
  }
</style>